// ============ Place search facade ============
// Google-first when VITE_GOOGLE_MAPS_API_KEY is configured, the 100% free
// stack underneath as the automatic fallback on key-absence, any error, or
// quota exhaustion (providers/quota.ts). Consumers keep importing from here
// exactly as before — downstream logic (corridor sampling, home zone, gap
// bias, ranking, budget math) never touches a provider directly.
//
//   providers/hits.ts    shared PlaceHit model + pure tourist-ranking logic
//   providers/free.ts    Mappls · Open-Meteo · Wikipedia · OSM engines
//   providers/google.ts  Places API (New): Autocomplete, Search-Along-Route
//                        (Text Search Pro), opening hours on the same events
//   providers/quota.ts   Phase-B per-SKU soft-cap guard (localStorage)
//
// Note: `resolveHitCoords` is kept (not deleted as first sketched in the
// report) because in free mode Mappls hits still arrive without coordinates
// ("the app behaves exactly as today when the key is absent"). Google picks
// resolve via one Place Details call instead of OSM Nominatim.
export { DEBOUNCE_MS } from './providers/free'
export { mapplsEnabled, parseOpeningHours, fetchOpeningHours, type OpeningHours } from './providers/free'
export { HOME_ZONE_KM, corridorAnchors, detourKm, detourMinutes, asymmetricDetourKm, asymmetricDetourMinutes, filterPlannedNearby, anchorHash, routeHash, alongRouteKmOf, directionalKm } from './providers/hits'
export type { NearbyOpts, PlaceHit, PlannedStop } from './providers/hits'
export { googleEnabled } from './providers/google'
export { googleSearchText, QuotaExhaustedError } from './providers/google'
export { googleCitiesAlong } from './providers/google'
export { searchCitiesAlong } from './providers/free'
export { planRideSegments, assignSegmentHits, leftoverAsSight, reasonForSegmentHit, reasonForHit, kmFromStartForHit, planDriveDays, planTravelClock, deriveDrivingPlan, effectiveDrivingDays, drivingPlanFingerprint, anchorsForCrew, isSelfDrivenMode, rainFactorFor, DEFER_START, type SegmentHit, type RideSegment, type DriveDaysPlan, type TravelClockVerdict, type DrivingPlan, type DrivingPlanDay, type DrivingPlanInput } from './ridePlan'
export { hasCoords } from './providers/hits'
import { plannerDrives } from './transportPolicy'
import type { TransportMode } from '../data/types'

import { hasCoords, rankAndCap, filterPlannedNearby, kmFromStartForHit, type NearbyOpts, type PlaceHit } from './providers/hits'
import { haversineKm } from './geo'
import {
  searchPlacesFree,
  searchNearbyPoisMultiFree,
  searchCitiesAlong,
  resolveHitCoords as resolveFreeHitCoords,
} from './providers/free'
import {
  googleEnabled,
  googleAutocomplete,
  googleNearbyAlongRoute,
  googleNearbyAtPoint,
  googleResolveHitCoords,
  googleSearchText,
  QuotaExhaustedError,
} from './providers/google'
import { googleCitiesAlong } from './providers/google'
import {
  planRideSegments, assignSegmentHits, annotateSegmentHits, cadenceForCrew, leftoverAsSight,
  preferTownGrade,
  type DrivingPlan, type SegmentHit,
} from './ridePlan'
import { resolveVehicleRange } from './vehicleProfile'
import { addMinutesToClock } from './engine'

/**
 * Search cities AND points of interest at once. Google autocomplete first
 * (India-best coverage, real place ids) with the free stack merged underneath
 * so small towns never disappear; without a Google key this is exactly the
 * old free search.
 */
export async function searchPlaces(q: string, opts?: { indiaOnly?: boolean }): Promise<PlaceHit[]> {
  const needle = q.trim()
  if (needle.length < 2) return []
  if (!googleEnabled()) return searchPlacesFree(q, opts)
  const [google, free] = await Promise.all([
    googleAutocomplete(needle, opts?.indiaOnly ?? true).catch(() => [] as PlaceHit[]),
    searchPlacesFree(q, opts).catch(() => [] as PlaceHit[]),
  ])
  return dedupePlaceHits([...google, ...free])
}

/** Cross-provider dedupe: same name AND same ~100 m location is one place.
 *  `limit` caps the returned pool — the geocode box keeps the UI-sized 8, while
 *  the route-aware search-to-add passes a larger pool so its detour ranking can
 *  still surface a closer free-stack hit that would otherwise be sliced off in
 *  provider order before ranking ever saw it. */
function dedupePlaceHits(hits: PlaceHit[], limit = 8): PlaceHit[] {
  // Dedupe across providers, but only when the hits actually point at the
  // same location — Open-Meteo and Google can legitimately both return
  // "Munnar" with different precision/coords, and both belong in the list.
  const keyOf = (h: PlaceHit) =>
    `${h.name.toLowerCase()}@${h.latitude != null ? h.latitude.toFixed(2) : ''},${h.longitude != null ? h.longitude.toFixed(2) : ''}`
  const seen = new Set<string>()
  const out: PlaceHit[] = []
  for (const hit of hits) {
    if (!hit.name) continue
    const key = keyOf(hit)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(hit)
  }
  return out.slice(0, limit)
}

/**
 * Search for the Map tab's add-to-trip box — the surface that RANKS and
 * ANNOTATES every row by road position BEFORE any pick. It cannot use
 * `searchPlaces`: autocomplete hits are deliberate (0,0) placeholders there
 * (resolved on pick, see providers/google §1), and projecting a placeholder
 * onto the route measures Null Island — live 2026-09-14, every result row
 * showed the identical "~1675 km into the trip · 8448 km off-route".
 *
 * Google mode runs ONE Text Search (real locations in the same single Text
 * Search Pro event the corridor scan already pays), free stack merged
 * underneath. When the caller passes the trip's route geometry the search is
 * biased ALONG THAT ROAD (Search-Along-Route) — without it the request carries
 * no spatial constraint and Google applies its implicit IP-based bias, which
 * fills the rows with the searcher's own city (found live 2026-09-24: a lunch
 * search on a slot showed the user's city, not the corridor). Quota
 * exhaustion THROWS (surfaced honestly by the caller — no silent fallback);
 * other Google failures degrade to the free stack like the geocode box always
 * has. Any remaining coord-less hit (Mappls "coords pending") is resolved,
 * and still-placeholder rows are dropped — a route-aware list never measures
 * Null Island.
 */
export interface SearchTextOpts {
  indiaOnly?: boolean
  /** The trip's route geometry ([lng, lat][], OSRM format) — biases the search along the trip's road. */
  routeCoords?: [number, number][] | null
  /** Fallback corridor anchors when no route geometry is available — the free stack ranks against these. */
  anchors?: { lat: number; lng: number }[] | null
  signal?: AbortSignal
}

export async function searchPlacesText(q: string, opts?: SearchTextOpts): Promise<PlaceHit[]> {
  const needle = q.trim()
  if (needle.length < 2) return []
  let google: PlaceHit[] = []
  if (googleEnabled()) {
    try {
      google = await googleSearchText(needle, { routeCoords: opts?.routeCoords, signal: opts?.signal })
    } catch (e) {
      if (e instanceof QuotaExhaustedError) throw e // honest quota note, no fallback
      if (opts?.signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e
      // transient Google failure → degrade to the free stack (geocode-box contract)
    }
  }
  const free = await searchPlacesFree(q, opts).catch(() => [] as PlaceHit[])
  // Larger pool than the geocode box's 8: the caller ranks every hit by its
  // road detour and only then slices, so a closer free-stack hit must survive
  // the merge to be ranked in (see MapTab onSearch).
  const merged = dedupePlaceHits([...google, ...free], 24)
  const resolved = await Promise.all(merged.map(h => (hasCoords(h) ? h : resolveHitCoords(h).catch(() => h))))
  return resolved.filter(hasCoords)
}

/**
 * Resolve coordinates for a picked hit. Google suggestions resolve via one
 * Place Details (Essentials) call; free-stack Mappls hits keep the Nominatim
 * fallback. Returns the hit untouched on failure — callers treat a miss as
 * manual entry exactly like an unmatched text.
 */
export async function resolveHitCoords(hit: PlaceHit): Promise<PlaceHit> {
  if (hasCoords(hit)) return hit
  if (hit.source === 'google' && hit.placeId) {
    if (!googleEnabled()) return hit
    try { return await googleResolveHitCoords(hit) } catch { return hit }
  }
  return resolveFreeHitCoords(hit)
}

/**
 * Resolve-or-tell: like resolveHitCoords, but reports failure instead of
 * silently returning the (0,0) placeholder. Every write-into-a-trip path
 * must use this one — a placeholder stop pins the journey to Null Island
 * and every downstream honest number (legs, split verdicts, impact previews,
 * halt targets) measures an ocean round-trip. Returns null when the hit
 * could not be resolved; the caller keeps the stop out of the trip.
 */
export async function requireHitCoords(hit: PlaceHit): Promise<PlaceHit | null> {
  const resolved = await resolveHitCoords(hit)
  if (hasCoords(resolved)) return resolved
  return null
}

/** Single-anchor convenience wrapper (empty-day chips). */
export async function searchNearbyPois(lat: number, lng: number, radiusM = 10000, count = 10, opts: NearbyOpts = {}): Promise<PlaceHit[]> {
  return searchNearbyPoisMulti([{ lat, lng }], radiusM, count, opts)
}

/** routeCoords are [lng, lat] pairs (GeoJSON order). True when start ≈ end. */
function isRoundTripRoute(route: [number, number][]): boolean {
  const a = route[0]
  const b = route[route.length - 1]
  if (!a || !b || a.length < 2 || b.length < 2) return false
  return haversineKm(a[1], a[0], b[1], b[0]) <= 5
}

/**
 * Google-only round-trip supplement: point searches at the first few anchors.
 * Sequential (not Promise.all) so one failing anchor doesn't kill the scan,
 * and early-exits once the result count is met.
 */
async function googlePointScan(
  anchors: { lat: number; lng: number }[],
  radiusM: number,
  count: number,
  maxAnchors = 4,
  signal?: AbortSignal,
): Promise<PlaceHit[]> {
  const out: PlaceHit[] = []
  const seen = new Set<string | number>()
  let failedAnchors = 0
  let lastError: unknown = null
  for (const a of anchors.slice(0, maxAnchors)) {
    try {
      if (signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError')
      const hits = await googleNearbyAtPoint({ lat: a.lat, lng: a.lng, radiusM, count, signal })
      for (const h of hits) {
        if (!h.id || seen.has(h.id)) continue
        seen.add(h.id)
        out.push(h)
      }
      if (out.length >= count) break
    } catch (err) {
      if (err instanceof QuotaExhaustedError || signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw err
      /* this anchor failed — try the next one */
      failedAnchors++
      lastError = err
    }
  }
  // No hits and at least one anchor failed: the scan failed, it did not come back empty (#704).
  if (out.length === 0 && failedAnchors > 0) throw lastError
  return out
}

/**
 * Nearby ideas for the whole route. Google mode (key + OSRM geometry in
 * `opts.routeCoords`): Search-Along-Route — one Text Search Pro event per
 * category, opening hours and real road detours on every hit, ranked by the
 * same tourist engine. Single-anchor flows without route geometry (empty-day
 * chips) use a Google locationBias point search instead — same SKU, reported
 * hours, straight-line detour fallback. Per the 2026-09-07 provider directive,
 * Google mode NEVER falls back to the free stack — failures, quota trips and
 * empty scans render an honest "no match"; the free stack is keyless-mode only.
 * Round-trip routes (origin ≈ destination) get a point-search supplement, since
 * Search-Along-Route legitimately returns nothing when the road never leaves
 * the start area.
 */
export async function searchNearbyPoisMulti(
  anchors: { lat: number; lng: number }[],
  radiusM = 10000,
  count = 16,
  opts: NearbyOpts = {},
): Promise<PlaceHit[]> {
  const capped = anchors.filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lng)).slice(0, 12)
  if (capped.length === 0) return []
  const route = opts.routeCoords ?? []
  // Provider directive (2026-09-07): with a Google key configured, suggestions
  // are Google-ONLY — no silent free-stack fallback on Google failure, quota
  // exhaustion, or empty scans. A failed scan renders the honest "no match"
  // state; Wikipedia/Mappls/OSM serve ONLY when no key is configured.
  if (googleEnabled() && route.length >= 2) {
    try {
      const hits = await googleNearbyAlongRoute({
        routeCoords: route, count,
        includeFuel: opts.includeFuel, purposes: opts.purposes, signal: opts.signal,
      })
      if (hits.length > 0) return rankAndCap(hits, capped, radiusM, count, opts)
      // Round-trip routes (origin ≈ destination) legitimately return zero
      // Search-Along-Route results — the road never leaves the start area.
      // Google-only directive stays intact: supplement with point searches at
      // the first anchors rather than falling back to the free stack.
      if (isRoundTripRoute(route)) {
        const pointHits = await googlePointScan(capped, radiusM, count, 4, opts.signal)
        return rankAndCap(pointHits, capped, radiusM, count, opts)
      }
      return rankAndCap(hits, capped, radiusM, count, opts)
    } catch (err) {
      if (opts.rejectOnFailure || err instanceof QuotaExhaustedError || opts.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw err
      return [] as PlaceHit[]
    }
  } else if (googleEnabled()) {
    // No route geometry (road measurement failed/pending): a multi-anchor
    // corridor must NOT collapse to one point search at the trip start —
    // that is the "suggestions starved at the origin" failure (#185). Point-
    // scan the first corridor anchors instead; googlePointScan is sequential
    // with early exit, so the cost stays bounded. Single-anchor flows (empty-
    // day chips) keep the one-anchor search.
    try {
      const hits = capped.length >= 2
        ? await googlePointScan(capped, radiusM, count, 6, opts.signal)
        : await googleNearbyAtPoint({
            lat: capped[0].lat, lng: capped[0].lng, radiusM, count, includeFuel: opts.includeFuel, signal: opts.signal,
          })
      return rankAndCap(hits, capped, radiusM, count, opts)
    } catch (err) {
      if (opts.rejectOnFailure || err instanceof QuotaExhaustedError || opts.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) throw err
      return [] as PlaceHit[]
    }
  }
  return searchNearbyPoisMultiFree(capped, radiusM, count, opts, opts.purposes)
}

/**
 * Whole-journey ride plan: fatigue-budget segments, each with the single best
 * real stop, anchored on key cities for long / cross-day drives. Runs the
 * provider-agnostic segment math (ridePlan) over Google Search-Along-Route
 * hits (real along-route positions) + the free-stack city overlay (OSM /
 * Wikipedia populated places) + the free POI search as the fallback, so the
 * algorithm works identically with or without a key. Returns ordered
 * SegmentHit[] with position metadata (cumKm / legKm / legMinutes /
 * nearestCity / purpose). Any provider failure degrades to whatever survived;
 * a planning failure returns an empty list (caller toasts).
 */
export async function planJourneyHalts(
  anchors: { lat: number; lng: number }[],
  totalKm: number,
  driveMinutes: number,
  opts: NearbyOpts & { plan: DrivingPlan },
  radiusM = 35000,
): Promise<SegmentHit[]> {
  // 1. Plan segments first so we know which purposes we need to search for
  // The wheel decides whether a fuel or charge halt exists at all (2026-10-19).
  // A passenger trip keeps its electric profile on the row, but that profile
  // describes a vehicle it is not driving: no range, no charge cadence.
  const wheel = plannerDrives({ transportMode: opts.transportMode as TransportMode, drivesPart: opts.drivesPart })
  const vehicleRange = !wheel
    ? undefined
    : opts.vehicleRangeKm
      ?? (opts.vehicleProfile ? resolveVehicleRange(opts.vehicleProfile).planCadenceKm : undefined)
  const segments = planRideSegments({
    totalKm,
    driveMinutes,
    // The caller decides, but a stale caller that asks for fuel or charge on a
    // passenger trip must not produce a halt. Fuel and charge belong to the
    // traveller's own wheel.
    includeFuel: opts.includeFuel && wheel,
    includeCharge: opts.includeCharge && wheel,
    haltPins: opts.haltPins ?? undefined,
    dayBoundaries: opts.plan.outbound,
    vehicleRangeKm: vehicleRange,
    dayStartTimes: opts.plan.outbound.map(d => addMinutesToClock(d.startMin, 0)),
    dayRainPct: opts.dayRainPct,
    transportMode: opts.transportMode,
    drivesPart: opts.drivesPart,
    roadGeometry: (opts.routeCoords ?? [])
      .filter(c => Number.isFinite(c[0]) && Number.isFinite(c[1]))
      .map(c => ({ lat: c[1], lng: c[0] })),
    ...cadenceForCrew(opts.travellers, opts.travelStyle),
  })
  if (segments.length === 0) return []
  // See & do is fed by leftovers of the corridor scan (leftoverAsSight), so the
  // scan itself must ask for sights — the planner never makes 'sight' segments,
  // and without this the sightseeing column (and its map pins) is empty by
  // construction: every query would be food/fuel/hotel text searches.
  const purposes = [...new Set([...segments.map(s => s.purpose), 'sight' as const])]

  // 2. Search with purpose-specific queries (merged into one call per provider)
  //    Provider directive (2026-09-07, amended 2026-09-15 for #189): with a
  //    Google key the POI pipeline stays Google-only. The ONE exception is the
  //    night-halt town anchor — a halt needs a town with a BED, and Google's
  //    `locality` type bottoms out at VILLAGE level in rural India (live-
  //    verified: hamlets like "Gauriyapur", no population to rank by), while
  //    OSM's type-strict place=city|town returns real towns WITH populations
  //    (Chunar 37k, Mirzapur 234k, Hazaribagh). Both merge, towns first so the
  //    population-bearing entry wins the name dedupe. POIs, meals and fuel
  //    never touch the free stack.
  const googleMode = googleEnabled()
  // The city anchor layer must search at the NIGHT-HALT km positions, not at
  // the raw anchor list: anchors are the trip's stops, which cluster wherever
  // the traveller planned to be — cities searched near them cannot anchor a
  // halt at km 700 or 1,050 of a 1,400 km corridor (live-verified 2026-09-14:
  // every overnight then filled with a start-city suburb hundreds of km from
  // its halt). Each overnight's road point comes from the same geometry the
  // scan runs on. Keyless mode keeps the anchor-based Overpass/Wikipedia path.
  const roadPts = (opts.routeCoords ?? []).filter(c => Number.isFinite(c[0]) && Number.isFinite(c[1]))
  const cityAnchors = googleMode && roadPts.length >= 2 && totalKm > 0
    ? [
        ...anchors.slice(0, 1),
        ...segments.filter(s => s.purpose === 'overnight').map(s => {
          const idx = Math.min(roadPts.length - 1, Math.max(0, Math.round((s.targetKm / totalKm) * (roadPts.length - 1))))
          return { lat: roadPts[idx][1], lng: roadPts[idx][0] }
        }),
      ]
    : anchors
  const citySearch: Promise<PlaceHit[]> = !googleMode
    ? searchCitiesAlong(anchors, radiusM, 8).catch(() => [] as PlaceHit[])
    : Promise.all([
        searchCitiesAlong(cityAnchors, radiusM, 8).catch(() => [] as PlaceHit[]),
        googleCitiesAlong(cityAnchors, radiusM, 8, opts.signal).catch((err: unknown) => {
          if (err instanceof QuotaExhaustedError || opts.signal?.aborted) throw err
          return [] as PlaceHit[]
        }),
      ]).then(([towns, localities]) => [...towns, ...localities])
  const [hits, cities] = await Promise.all([
    searchNearbyPoisMulti(anchors, radiusM, 16, { ...opts, purposes }).catch((err: unknown) => {
      // #704: the Map tab asks to hear a failed search. Other callers keep the empty list.
      if (opts.rejectOnFailure) throw err
      return [] as PlaceHit[]
    }),
    citySearch,
  ])
  // A city that sits nowhere near any halt must not fill one: rural circles
  // often return zero localities while the start-city circle returns many,
  // and without this guard those start-city suburbs won the far halts by
  // being the only candidates (live-verified 2026-09-14). An honest GAP
  // beats a "night halt" 700 km from its halt.
  const haltKms = segments.filter(s => s.purpose === 'overnight').map(s => s.targetKm)
  const citiesNearHalts = googleMode && haltKms.length > 0
    ? cities.filter(c => {
        const pos = kmFromStartForHit(c, anchors)
        return pos != null && haltKms.some(km => Math.abs(pos - km) <= 120)
      })
    : cities
  // A night halt needs a town with a bed: when OSM returned real towns, its
  // population-ranked entries are the anchor pool (Google's rural `locality`
  // results are hamlets — see preferTownGrade). Urban corridors, where OSM has
  // no town and Google's locality data is strongest, keep the full list.
  const anchorPool = googleMode ? preferTownGrade(citiesNearHalts) : citiesNearHalts
  const seen = new Set<string>()
  const candidates: PlaceHit[] = []
  for (const h of [...anchorPool, ...hits]) {
    if (!h.name) continue
    const key = h.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push(h)
  }
  const unplanned = opts.plannedStops && opts.plannedStops.length > 0
    ? filterPlannedNearby(candidates, opts.plannedStops)
    : candidates
  const routePolyline = (opts.routeCoords ?? []).filter(c => Number.isFinite(c[0]) && Number.isFinite(c[1])).map(c => ({ lat: c[1], lng: c[0] }))
  const assignOpts = { homeCenter: opts.homeCenter ?? null, routePolyline: routePolyline.length >= 2 ? routePolyline : null, speedKmph: opts.speedKmph, dnaVector: opts.dnaVector }
  const assigned = assignSegmentHits(unplanned, segments, anchors, assignOpts)
  // Unassigned corridor hits surface as See & do — otherwise the sightseeing
  // column is empty by construction (the planner never makes 'sight' segments).
  const full = [...assigned, ...leftoverAsSight(unplanned, assigned, anchors, assignOpts)]
  return annotateSegmentHits(full, candidates)
}