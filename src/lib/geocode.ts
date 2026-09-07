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
export { HOME_ZONE_KM, corridorAnchors, detourKm, detourMinutes, asymmetricDetourMinutes, filterPlannedNearby, anchorHash, routeHash } from './providers/hits'
export type { NearbyOpts, PlaceHit, PlannedStop } from './providers/hits'
export { googleEnabled } from './providers/google'
export { googleCitiesAlong } from './providers/google'
export { searchCitiesAlong } from './providers/free'
export { planRideSegments, assignSegmentHits, leftoverAsSight, reasonForSegmentHit, reasonForHit, type SegmentHit, type RideSegment } from './ridePlan'

import { hasCoords, rankAndCap, filterPlannedNearby, type NearbyOpts, type PlaceHit } from './providers/hits'
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
} from './providers/google'
import { googleCitiesAlong } from './providers/google'
import {
  planRideSegments, assignSegmentHits, annotateSegmentHits, cadenceForCrew, leftoverAsSight,
  type SegmentHit, type RideSegment,
} from './ridePlan'
import { resolveVehicleRange } from './vehicleProfile'

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
  // Dedupe across providers, but only when the hits actually point at the
  // same location — Open-Meteo and Google can legitimately both return
  // "Munnar" with different precision/coords, and both belong in the list.
  const keyOf = (h: PlaceHit) =>
    `${h.name.toLowerCase()}@${h.latitude != null ? h.latitude.toFixed(2) : ''},${h.longitude != null ? h.longitude.toFixed(2) : ''}`
  const seen = new Set<string>()
  const out: PlaceHit[] = []
  for (const hit of [...google, ...free]) {
    if (!hit.name) continue
    const key = keyOf(hit)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(hit)
  }
  return out.slice(0, 8)
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
): Promise<PlaceHit[]> {
  const out: PlaceHit[] = []
  const seen = new Set<string | number>()
  for (const a of anchors.slice(0, 4)) {
    try {
      const hits = await googleNearbyAtPoint({ lat: a.lat, lng: a.lng, radiusM, count })
      for (const h of hits) {
        if (!h.id || seen.has(h.id)) continue
        seen.add(h.id)
        out.push(h)
      }
      if (out.length >= count) break
    } catch { /* this anchor failed — try the next one */ }
  }
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
        routeCoords: route, routeTotalKm: opts.routeTotalKm, count,
        includeFuel: opts.includeFuel, purposes: opts.purposes,
      })
      if (hits.length > 0) return rankAndCap(hits, capped, radiusM, count, opts)
      // Round-trip routes (origin ≈ destination) legitimately return zero
      // Search-Along-Route results — the road never leaves the start area.
      // Google-only directive stays intact: supplement with point searches at
      // the first anchors rather than falling back to the free stack.
      if (isRoundTripRoute(route)) {
        const pointHits = await googlePointScan(capped, radiusM, count)
        return rankAndCap(pointHits, capped, radiusM, count, opts)
      }
      return rankAndCap(hits, capped, radiusM, count, opts)
    } catch { return [] as PlaceHit[] }
  } else if (googleEnabled()) {
    // single-anchor flows (empty-day chips): point search around the anchor
    try {
      const hits = await googleNearbyAtPoint({
        lat: capped[0].lat, lng: capped[0].lng, radiusM, count, includeFuel: opts.includeFuel,
      })
      return rankAndCap(hits, capped, radiusM, count, opts)
    } catch { return [] as PlaceHit[] }
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
  opts: NearbyOpts = {},
  radiusM = 35000,
): Promise<SegmentHit[]> {
  // 1. Plan segments first so we know which purposes we need to search for
  const vehicleRange = opts.vehicleRangeKm
    ?? (opts.vehicleProfile ? resolveVehicleRange(opts.vehicleProfile).planCadenceKm : undefined)
  const segments = planRideSegments({
    totalKm,
    driveMinutes,
    includeFuel: opts.includeFuel,
    multiDay: opts.multiDay,
    vehicleRangeKm: vehicleRange,
    dayStartTimes: opts.dayStartTimes,
    dayRainPct: opts.dayRainPct,
    roadGeometry: (opts.routeCoords ?? [])
      .filter(c => Number.isFinite(c[0]) && Number.isFinite(c[1]))
      .map(c => ({ lat: c[1], lng: c[0] })),
    ...cadenceForCrew(opts.travellers, opts.travelStyle),
  })
  if (segments.length === 0) return []
  const purposes = [...new Set(segments.map(s => s.purpose))]

  // 2. Search with purpose-specific queries (merged into one call per provider)
  //    Provider directive (2026-09-07): with a Google key, BOTH layers are
  //    Google-only — POIs AND the city anchor layer. The free-stack city
  //    search (Overpass+Wikipedia, source of stray "constituency" cards)
  //    runs only in keyless mode.
  const googleMode = googleEnabled()
  const [hits, cities] = await Promise.all([
    searchNearbyPoisMulti(anchors, radiusM, 16, { ...opts, purposes }).catch(() => [] as PlaceHit[]),
    (googleMode ? googleCitiesAlong(anchors, radiusM, 8) : searchCitiesAlong(anchors, radiusM, 8)).catch(() => [] as PlaceHit[]),
  ])
  const seen = new Set<string>()
  const candidates: PlaceHit[] = []
  for (const h of [...cities, ...hits]) {
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