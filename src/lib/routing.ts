// ============ Real road routing ============
// Primary source: Google Routes API (computeRoutes) for India-tuned road
// distance/time + geometry (issue #6). Free fallback: the OSRM demo server
// (no key). The app never blocks on routing — any Google failure (no key,
// quota, network) transparently drops to OSRM, and OSRM failure drops to the
// engine's haversine estimate. Provider-parity with geocode.ts facade.
//
// #polylines (Sep 2026): the facade used to fire N−1 SEQUENTIAL per-leg
// fetches per chain — a 20-stop trip cost 19 serial round-trips against the
// shared rate-limited OSRM demo, so the map drew straight chords for seconds
// (or permanently, once the rate limiter answered). Now:
//   1. one OSRM request carries the WHOLE chain (waypoints joined with `;`)
//      and the per-leg geometry/duration/annotations are split back out —
//      chunked at 25 waypoints so huge corridors degrade gracefully;
//   2. the per-leg fallback (Google-first) runs legs in PARALLEL — the old
//      "sequential by design" comment was only ever about being polite to one
//      demo server, and the chain request IS the polite path now;
//   3. every fetch takes the caller's AbortSignal, so a cancelled effect
//      stops burning the rate-limit budget instead of discarding results;
//   4. a small session cache remembers measured legs (rounded pair + mode),
//      so the workspace chain, the map's day lines, the Board and the stop
//      editor share one measurement instead of re-fetching the same roads.
// Estimate legs are deliberately NOT cached: a rate-limited leg must stay
// free to succeed on the next open, never pinned as a chord for the session.
import { legBetween } from './engine'
import type { EngineAssumptions, LegEstimate } from './engine'
import { googleRoute, routesEnabled, type RouteResult, type CorridorResult, type RoadLegResult } from './providers/routes'
import { haversineKm } from './geo'
import type { RoadProfilePoint } from './ridePlan'

const OSRM = 'https://router.project-osrm.org/route/v1/driving'

/** Waypoints per OSRM chain request before we chunk (demo-server headroom). */
const OSRM_CHAIN_WAYPOINTS = 25

/**
 * Final gate before any OSRM fetch: the URL must be EXACTLY our fixed origin
 * + driving path, with a coordinate path of digits/dot/comma/semicolon and a
 * query built only from the known parameter vocabulary. Stop coordinates are
 * already strict-checked by coordValid(); this closes the same taint AT the
 * HTTP-client boundary, so no interpolated value can ever reach fetch in any
 * other shape. (Static engines model regex allowlists as sanitization —
 * helper boundaries and encodeURIComponent alone did not cut it.) The path
 * class carries `-` — negative lat/lng are legitimate (-90…90 / -180…180).
 */
const OSRM_URL_OK = /^https:\/\/router\.project-osrm\.org\/route\/v1\/driving\/[-0-9.,;]+\?[a-z=,&]+$/

function osrmUrl(coordsPath: string): string | null {
  const candidate = `${OSRM}/${coordsPath}?overview=full&geometries=geojson&annotations=distance,duration`
  if (!OSRM_URL_OK.test(candidate)) return null
  // WHATWG URL validation (the OWASP SSRF-prevention pattern): the parser
  // THROWS on malformed input, and the origin assertion pins the fetch target
  // to the fixed OSRM host no matter what the interpolation produced. fetch
  // only ever sees a URL that survived both gates.
  try {
    const parsed = new URL(candidate)
    if (parsed.origin !== 'https://router.project-osrm.org') return null
    return parsed.toString()
  } catch {
    return null
  }
}

interface OsrmRoute {
  distance: number      // metres
  duration: number      // seconds
  geometry?: { coordinates: [number, number][] } // [lng, lat]
  /** Per-coordinate segment annotations (asked for with annotations=…): entry i
   *  describes the hop from coordinate i to i+1. This is the only intra-leg
   *  terrain signal any provider here gives us (#204). */
  legs?: { annotation?: { distance?: number[]; duration?: number[] } }[]
}

/** The chain-request shape: route.legs[i] carries ITS OWN geometry. */
interface OsrmChainRoute {
  code?: string
  routes?: {
    legs?: {
      distance?: number
      duration?: number
      geometry?: { coordinates: [number, number][] }
      annotation?: { distance?: number[]; duration?: number[] }
    }[]
  }[]
}

/** Combine a caller's signal with the per-request timeout where supported. */
function requestSignal(signal: AbortSignal | undefined): AbortSignal {
  // an already-aborted caller must hand the fetch an ABORTED signal — a fresh
  // timeout here would send post-abort fallback fetches out un-aborted
  if (signal?.aborted) return AbortSignal.abort()
  const timeout = AbortSignal.timeout(8000)
  if (!signal) return timeout
  const Any = AbortSignal as unknown as { any?: (sigs: AbortSignal[]) => AbortSignal }
  return Any.any ? Any.any([signal, timeout]) : timeout
}

/**
 * A stop's coordinates, validated at the untyped-JSON boundary. Stop data
 * hydrates from Supabase without runtime types, so values are strictly
 * checked HERE — before they may reach a cache key or a request URL (a
 * malformed or out-of-range coordinate refuses the measurement and the
 * caller falls back to the estimate path, exactly like a network failure).
 *
 * #403: exported, and STRENGTHENED. The Overview's route snapshot and its
 * weather centroid each re-implemented a weaker version of this test
 * (`Number.isFinite` alone) and therefore accepted the provider's `(0,0)`
 * placeholder — finite, in range, and not a place on Earth. It stretched the
 * snapshot across the Atlantic and moved the weather centroid halfway to Null
 * Island, where the fetch SUCCEEDED for the wrong ocean, which is worse than
 * failing.
 *
 * The zero-axis rule is NOT new to the repo: `hasCoords` (providers/hits.ts) has
 * rejected a zero latitude OR longitude for every provider pick since the
 * Null-Island incident of 2026-09-14, and `itinerarySpec.ts` names the exact
 * string a hydration row carries. What was missing was that this boundary — the
 * one that guards the ROAD — never asked the question, so a `(0,0)` that reached
 * the store by any other path still measured a drive through the ocean. One
 * predicate, imported by all three surfaces, is the only way they can agree on
 * what a coordinate is; a caller cannot be trusted to re-derive it.
 *
 * A genuine point on the equator or the prime meridian (lat 0 / lng 0 with the
 * other axis real) is still valid — that is a real place, and #326's
 * either-zero rule is deliberately about the PAIR, not each axis alone.
 */
export function coordValid(p: LatLng): { lat: number; lng: number } | null {
  // typeof-first: Number() coercion would accept '12.9' (a malformed row) and
  // — far worse — turn null into 0, the Null-Island sentinel (#151's guard).
  if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return null
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null
  if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) return null
  // The Null-Island placeholder, which no provider has ever returned as a real
  // result: a trip measured through it is an ocean round-trip (#326, #151).
  if (p.lat === 0 && p.lng === 0) return null
  return { lat: p.lat, lng: p.lng }
}

/** One validated stop as an OSRM path segment (`lng,lat`). */
function coordParam(p: LatLng): string | null {
  const v = coordValid(p)
  if (!v) return null
  // encodeURIComponent is a runtime NO-OP here — a validated numeric renders
  // as digits and `.` only, both unreserved — but it is the sanitizer that
  // cuts the static user-controlled-URL taint flagged by SAST (Codacy).
  return `${encodeURIComponent(String(v.lng))},${encodeURIComponent(String(v.lat))}`
}

/** Fetch a road route between two points. Returns null on any failure. */
async function osrmRoute(a: LatLng, b: LatLng, signal?: AbortSignal): Promise<{ km: number; min: number; coords: [number, number][]; segments?: RoadProfilePoint[] } | null> {
  try {
    // `overview=full` + `annotations` so the leg carries per-coordinate times:
    // the Day Planner's terrain profile needs to see a ghat INSIDE a leg, which
    // a per-stop measurement cannot (#204). Same request count — wider payload.
    const ca = coordParam(a)
    const cb = coordParam(b)
    if (!ca || !cb) return null
    const url = osrmUrl(`${ca};${cb}`)
    if (!url) return null
    const res = await fetch(url, { signal: requestSignal(signal) })
    if (!res.ok) return null
    const data = await res.json()
    const r: OsrmRoute | undefined = data.routes?.[0]
    if (data.code !== 'Ok' || !r) return null
    return {
      km: r.distance / 1000,
      min: r.duration / 60,
      coords: r.geometry?.coordinates ?? [],
      segments: annotationsToProfile(r.legs?.[0]?.annotation),
    }
  } catch {
    return null
  }
}

/**
 * One OSRM request for a WHOLE chain of waypoints. Returns the per-leg road
 * data split back out (leg i = points[i] → points[i+1]), or null when the
 * server refuses — the caller then falls back to per-leg measurement.
 * Chunked at OSRM_CHAIN_WAYPOINTS so a 60-stop corridor still resolves as a
 * few parallel requests instead of one oversized (rejected) one.
 */
async function osrmRouteChain(points: LatLng[], signal?: AbortSignal): Promise<RoadLeg[] | null> {
  if (points.length < 2) return []
  const chunks: LatLng[][] = []
  for (let i = 0; i < points.length - 1; i += OSRM_CHAIN_WAYPOINTS - 1) {
    chunks.push(points.slice(i, i + OSRM_CHAIN_WAYPOINTS))
  }
  try {
    const results = await Promise.all(chunks.map(chunk => osrmChainOnce(chunk, signal)))
    if (results.some(r => r === null)) return null
    return results.flatMap(r => r as RoadLeg[])
  } catch {
    return null
  }
}

async function osrmChainOnce(points: LatLng[], signal?: AbortSignal): Promise<RoadLeg[] | null> {
  const coords = points.map(coordParam)
  if (coords.some(c => c === null)) return null
  const url = osrmUrl(coords.join(';'))
  if (!url) return null
  try {
    const res = await fetch(url, { signal: requestSignal(signal) })
    if (!res.ok) return null
    const data = (await res.json()) as OsrmChainRoute
    const r = data.routes?.[0]
    if (data.code !== 'Ok' || !r || !r.legs || r.legs.length !== points.length - 1) return null
    const out: RoadLeg[] = []
    for (let i = 0; i < r.legs.length; i++) {
      const l = r.legs[i]
      const a = points[i]
      const b = points[i + 1]
      if (typeof l.distance !== 'number' || typeof l.duration !== 'number') return null
      const segs = annotationsToProfile(l.annotation)
      out.push({
        distanceKm: l.distance / 1000,
        durationMinutes: Math.round(l.duration / 60),
        source: 'osrm',
        geometry: l.geometry?.coordinates?.length ? l.geometry.coordinates : [[a.lng, a.lat], [b.lng, b.lat]],
        ...(segs ? { segments: segs } : {}),
      })
    }
    return out
  } catch {
    return null
  }
}

/**
 * OSRM's per-coordinate distance/duration arrays → a cumulative (km, min)
 * profile for one leg. Null when the arrays are missing, mismatched or carry
 * no usable hop, so callers fall back to the leg's own endpoints.
 */
function annotationsToProfile(ann?: { distance?: number[]; duration?: number[] }): RoadProfilePoint[] | undefined {
  const dist = ann?.distance
  const dur = ann?.duration
  if (!dist || !dur || dist.length === 0 || dist.length !== dur.length) return undefined
  const pts: RoadProfilePoint[] = [{ km: 0, min: 0 }]
  let km = 0
  let min = 0
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i]
    const t = dur[i]
    if (!Number.isFinite(d) || !Number.isFinite(t) || d < 0 || t < 0) continue
    km += d / 1000
    min += t / 60
    pts.push({ km, min })
  }
  return pts.length >= 2 ? pts : undefined
}

export interface LatLng { lat: number; lng: number }

export interface RoadLeg extends LegEstimate {
  /** which provider produced this leg */
  source: 'google' | 'osrm' | 'estimate'
  /** road geometry [lng, lat][] for map drawing (empty if estimate fallback) */
  geometry: [number, number][]
  /** Per-coordinate (km, min) profile of THIS leg (#204), when the provider
   *  returned annotations — the terrain inside the leg, not just its endpoints.
   *  Absent from the Google and estimate paths, where the profile builder falls
   *  back to the leg's totals. */
  segments?: RoadProfilePoint[]
}

// ---- session leg cache -----------------------------------------------------
// Measured legs are remembered for the tab's lifetime, keyed by the rounded
// pair + mode. This is what makes the map's day chips instant on revisit and
// stops the workspace chain / Board / stop editor from re-fetching the same
// roads. LRU-capped; estimate legs never enter it (see header note).
const legCache = new Map<string, RoadLeg>()
const LEG_CACHE_MAX = 240

function legCacheKey(a: LatLng, b: LatLng, mode: string): string {
  const va = coordValid(a)
  const vb = coordValid(b)
  // Unvalidated coordinates never form a cache key either — the leg simply
  // won't cache (the measurement refuses at the URL boundary and estimates
  // are never stored). A FIXED sentinel is safe: valid keys always begin
  // `${mode}:`, and invalid legs never reach cacheSet. (No Math.random —
  // Codacy's weak-RNG rule rightly objects, and determinism costs nothing.)
  if (!va || !vb) return 'invalid:uncacheable'
  return `${mode}:${va.lat.toFixed(5)},${va.lng.toFixed(5)}>${vb.lat.toFixed(5)},${vb.lng.toFixed(5)}`
}

function cacheGet(key: string): RoadLeg | undefined {
  const hit = legCache.get(key)
  if (!hit) return undefined
  legCache.delete(key) // refresh LRU position
  legCache.set(key, hit)
  return hit
}

function cacheSet(key: string, leg: RoadLeg): void {
  if (leg.source === 'estimate') return
  legCache.set(key, leg)
  if (legCache.size > LEG_CACHE_MAX) {
    const oldest = legCache.keys().next().value
    if (oldest !== undefined) legCache.delete(oldest)
  }
}

/** Test seam: drop every cached leg (routing-routes tests re-stub fetch). */
export function clearRouteCacheForTests(): void {
  legCache.clear()
}

/** Test seam: how many legs are currently cached. */
export function routeCacheSizeForTests(): number {
  return legCache.size
}

/**
 * Try Google Routes first when a key is configured, then OSRM, then the local
 * haversine estimate. `assumptions` only matters in the final fallback mode.
 */
async function bestRoute(a: LatLng, b: LatLng, mode: string, signal?: AbortSignal): Promise<RoadLeg> {
  if (routesEnabled()) {
    try {
      const r = await googleRoute(a, b, mode) as RouteResult | CorridorResult
      if (!('legs' in r)) {
        return {
          distanceKm: r.km,
          durationMinutes: Math.round(r.min),
          source: 'google',
          geometry: r.coords.length ? r.coords : [[a.lng, a.lat], [b.lng, b.lat]],
        }
      }
      // a corridor-shaped response cannot come back without `via` — treat as refusal
      return {
        distanceKm: r.legs.reduce((s, l) => s + l.km, 0),
        durationMinutes: Math.round(r.legs.reduce((s, l) => s + l.min, 0)),
        source: 'google',
        geometry: r.legs.flatMap(l => l.coords),
      }
    } catch {
      /* Google failed (quota/network/key) — fall through to OSRM */
    }
  }
  const r = await osrmRoute(a, b, signal)
  if (r) {
    return {
      distanceKm: r.km,
      durationMinutes: Math.round(r.min),
      source: 'osrm',
      geometry: r.coords.length ? r.coords : [[a.lng, a.lat], [b.lng, b.lat]],
      ...(r.segments ? { segments: r.segments } : {}),
    }
  }
  const est = legBetween(a, b, assumptionsFromMode(mode))
  return {
    ...est,
    source: 'estimate',
    geometry: [[a.lng, a.lat], [b.lng, b.lat]],
  }
}

/**
 * Minimal EngineAssumptions for the haversine fallback. The real trip
 * assumptions are passed through roadLegBetween; this only backs the final
 * estimate fallback when no assumptions object reaches us.
 */
function assumptionsFromMode(mode: string): EngineAssumptions {
  return {
    mode,
    avgSpeedKmph: 40,
    bufferMinutesPerStop: 15,
    mealBreakMinutes: 60,
    dayStart: '08:30',
    dayEnd: '20:00',
    inrPerKm: 8,
  }
}

/**
 * Road leg between two points: Google-first, OSRM fallback, then haversine.
 * `assumptions` only matters in the haversine fallback mode.
 */
export async function roadLegBetween(
  a: LatLng,
  b: LatLng,
  assumptions: EngineAssumptions,
  signal?: AbortSignal,
): Promise<RoadLeg> {
  const cached = cacheGet(legCacheKey(a, b, assumptions.mode))
  if (cached) return cached
  const leg = await bestRoute(a, b, assumptions.mode, signal)
  if (leg.source === 'estimate') {
    // re-run against the real assumptions for an accurate haversine number
    const est = legBetween(a, b, assumptions)
    return { ...est, source: 'estimate', geometry: leg.geometry }
  }
  cacheSet(legCacheKey(a, b, assumptions.mode), leg)
  return leg
}

/**
 * One request for a whole waypoint span via whichever keyed provider answers:
 * Google Routes `intermediates` when a key is configured, else the OSRM chain.
 * Null = the provider refused; the caller falls back to parallel per-leg.
 */
async function measureSpanChain(span: LatLng[], mode: string, signal?: AbortSignal): Promise<RoadLeg[] | null> {
  if (routesEnabled()) {
    try {
      const chunked: RoadLeg[][] = []
      for (let i = 0; i < span.length - 1; i += GOOGLE_CHAIN_WAYPOINTS - 1) {
        const chunk = span.slice(i, i + GOOGLE_CHAIN_WAYPOINTS)
        const a = chunk[0]
        const b = chunk[chunk.length - 1]
        const via = chunk.slice(1, -1)
        const r: Awaited<ReturnType<typeof googleRoute>> = await googleRoute(a, b, mode, via)
        if (!('legs' in r)) return null
        if (r.legs.length !== chunk.length - 1) return null
        chunked.push(r.legs.map((l: RoadLegResult) => ({
          distanceKm: l.km,
          durationMinutes: Math.round(l.min),
          source: 'google' as const,
          geometry: l.coords.length ? l.coords : [[a.lng, a.lat], [b.lng, b.lat]],
        })))
      }
      return chunked.flat()
    } catch {
      return null // Google chain refused — per-leg fallback below
    }
  }
  return osrmRouteChain(span, signal)
}

/** Waypoints per Google Routes chain request (Google caps intermediates at 25). */
const GOOGLE_CHAIN_WAYPOINTS = 25

/**
 * Route every consecutive pair of points — the corridor as ONE chain request
 * when keyless (a 20-stop trip is one fetch, not nineteen serial
 * ones), with legs the cache already knows skipped from the measured span.
 * Google-keyed callers and chain-failure fallbacks measure legs in parallel:
 * the sequential loop this used to be was the reason a day's road line took
 * half a minute to finish drawing (#polylines). Unmeasured legs degrade to
 * the engine's haversine estimate, as always — planning never blocks.
 */
export async function routePath(
  points: LatLng[],
  assumptions: EngineAssumptions,
  signal?: AbortSignal,
): Promise<RoadLeg[]> {
  if (points.length < 2) return []
  const legs: RoadLeg[] = new Array(points.length - 1)
  const missing: number[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const hit = cacheGet(legCacheKey(points[i], points[i + 1], assumptions.mode))
    if (hit) legs[i] = hit
    else missing.push(i)
  }
  if (missing.length === 0) return legs

  // Measure the missing span. ONE request covers first→last missing leg: the
  // OSRM chain when keyless, Google Routes intermediates when keyed — both
  // cost a single quota/elasticity event for the whole corridor (#polylines;
  // the old keyed path spent one Google event PER LEG, 19× the quota for the
  // same corridor). Per-leg fallback runs in parallel when the chain refuses.
  const first = missing[0]
  const last = missing[missing.length - 1]
  const span = points.slice(first, last + 2)
  const chainLegs: RoadLeg[] | null = await measureSpanChain(span, assumptions.mode, signal)
  if (chainLegs && chainLegs.length === span.length - 1) {
    missing.forEach(legIndex => {
      // Cached legs inside the span shift missing's index; use the span offset.
      const leg = chainLegs![legIndex - first]
      legs[legIndex] = leg
      cacheSet(legCacheKey(points[legIndex], points[legIndex + 1], assumptions.mode), leg)
    })
    return legs
  }

  // Per-leg fallback (Google-first when keyed, OSRM per leg otherwise), all in
  // parallel. Any leg that still fails degrades to the haversine estimate.
  // An already-aborted caller skips straight to estimates — firing fetches it
  // would immediately discard only spends rate-limit budget.
  const settled = signal?.aborted
    ? missing.map(() => null)
    : await Promise.all(missing.map(async legIndex => {
      try {
        return await roadLegBetween(points[legIndex], points[legIndex + 1], assumptions, signal)
      } catch {
        return null
      }
    }))
  missing.forEach((legIndex, k) => {
    const leg = settled[k] ?? (() => {
      const est = legBetween(points[legIndex], points[legIndex + 1], assumptions)
      return { ...est, source: 'estimate' as const, geometry: [[points[legIndex].lng, points[legIndex].lat], [points[legIndex + 1].lng, points[legIndex + 1].lat]] as [number, number][] }
    })()
    legs[legIndex] = leg
    cacheSet(legCacheKey(points[legIndex], points[legIndex + 1], assumptions.mode), leg)
  })
  return legs
}

/**
 * Sample a road geometry ([lng, lat][]) into anchor points at ~spacingKm
 * intervals. Used to bias search queries along the actual road rather than
 * straight-line corridor anchors.
 */
export function routeGeometryToAnchors(
  geometry: [number, number][],
  spacingKm = 25,
  maxAnchors = 12,
): { lat: number; lng: number }[] {
  if (geometry.length === 0) return []
  const out: { lat: number; lng: number }[] = [{ lat: geometry[0][1], lng: geometry[0][0] }]
  let last = out[0]
  let cum = 0
  for (let i = 1; i < geometry.length; i++) {
    const pt = geometry[i]
    const d = haversineKm(last.lat, last.lng, pt[1], pt[0])
    cum += d
    if (cum >= spacingKm) {
      out.push({ lat: pt[1], lng: pt[0] })
      last = out[out.length - 1]
      cum = 0
      if (out.length >= maxAnchors) break
    }
  }
  // always include the final point if not already present
  const fin = geometry[geometry.length - 1]
  const lastPt = out[out.length - 1]
  if (lastPt.lat !== fin[1] || lastPt.lng !== fin[0]) {
    out.push({ lat: fin[1], lng: fin[0] })
  }
  return out
}
