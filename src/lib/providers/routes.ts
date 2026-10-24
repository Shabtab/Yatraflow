// ============ Google Routes API provider (issue #6) ============
// Primary source for leg road distances/times, mirroring the geocode facade
// (Google-first, free OSRM fallback, quota-guarded). computeRoutes returns
// India-tuned road geometry + polyline (the same [lng, lat][] shape the rest
// of the app already draws), so the map and the distance numbers come from the
// same provider — and OSRM (no key) remains the 100%-free fallback.
//
// Every entry point throws on failure — the routing facade (src/lib/routing.ts)
// catches and falls back to OSRM. The Phase-B quota guard (quota.ts) gates
// each call BEFORE it goes out, so the app silently drops to the free stack
// long before paid events can fire.
import { quotaAllows, quotaCount, type QuotaSku } from './quota'
import { decodePolyline } from './polyline'

const ROUTES = 'https://routes.googleapis.com/v2:computeRoutes'

/** Read lazily (not at module load) so tests can stub the env. */
function apiKey(): string {
  return ((import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? '').trim()
}

export function routesEnabled(): boolean {
  return apiKey().length > 0
}

/** Maps an engine transport mode to a Google Routes travelMode. */
export function travelModeFor(mode: string | undefined): string {
  switch (mode) {
    case 'car':
    case 'taxi':
      return 'DRIVE'
    case 'motorcycle':
      return 'TWO_WHEELER'
    case 'bus':
      return 'BUS'
    case 'train':
      return 'TRAIN'
    case 'flight':
      return 'FLYING' // rare for intra-city legs; OSRM geometry won't represent it
    default:
      return 'DRIVE'
  }
}

export interface RouteResult {
  /** road distance in km */
  km: number
  /** drive time in minutes */
  min: number
  /** decoded polyline as [lng, lat][] (OSRM-compatible) */
  coords: [number, number][]
}

interface RoutesResponse {
  routes?: Array<{
    distanceMeters?: number
    duration?: string // ISO 8601 duration, e.g. "1234s"
    polyline?: { encodedPolyline?: string }
    /** present when intermediates are requested: one leg per waypoint pair */
    legs?: Array<{
      distanceMeters?: number
      duration?: string
    }>
  }>
}

/** Per-leg slice of a corridor (intermediates) measurement. */
export interface RoadLegResult {
  km: number
  min: number
  /** road geometry [lng, lat][] for this leg only */
  coords: [number, number][]
}

/** Corridor result: legs aligned with the requested waypoint pairs. */
export interface CorridorResult {
  legs: RoadLegResult[]
}

// The codec lives in ./polyline. It re-exports decodePolyline, so existing imports keep working.
export { decodePolyline }

/**
 * Road route between two points via Google Routes API computeRoutes.
 * Throws on any failure (quota, network, non-OK) so the facade can fall back.
 * `via` waypoints (up to 25 total points per Google's limit) make this a
 * corridor measurement: ONE quota event covers the whole chain (#polylines).
 * The returned per-leg split is aligned with the requested legs.
 */
export async function googleRoute(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  travelMode: string,
  via: { lat: number; lng: number }[] = [],
): Promise<CorridorResult | RouteResult> {
  const sku: QuotaSku = 'routes'
  if (!routesEnabled()) throw new Error('routes: no Google key configured')
  if (!quotaAllows(sku)) throw new QuotaExhaustedError(sku)
  const res = await fetch(ROUTES, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
      destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
      ...(via.length ? { intermediates: via.map(p => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } })) } : {}),
      travelMode: travelModeFor(travelMode),
      routingPreference: 'TRAFFIC_UNAWARE',
      units: 'METRIC',
    }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`routes → HTTP ${res.status}`)
  quotaCount(sku) // count only once a request actually went out
  const data = (await res.json()) as RoutesResponse
  const r = data.routes?.[0]
  if (!r || typeof r.distanceMeters !== 'number' || !r.duration) {
    throw new Error('routes: empty/malformed response')
  }
  const seconds = parseIsoDuration(r.duration)
  const coords = r.polyline?.encodedPolyline ? decodePolyline(r.polyline.encodedPolyline) : []
  // Corridor shape: split the response into per-leg results aligned with the
  // requested legs. Google returns route.legs[i] per consecutive waypoint pair
  // (when intermediates are set); each leg carries its own distance/duration
  // and its polyline is the SLICE of the route polyline between the leg's
  // waypoints, which we cut by projecting the waypoints onto the polyline.
  if (via.length) {
    const points = [a, ...via, b]
    const legs = r.legs ?? []
    const ok = legs.length === points.length - 1 && legs.every(l => typeof l.distanceMeters === 'number' && typeof l.duration === 'string')
    if (!ok || coords.length < 2) {
      throw new Error('routes: corridor response missing per-leg data')
    }
    // #187 rule: assert the geometry before trusting it — each requested
    // waypoint must sit ON the returned polyline (within ~150 m). A response
    // that silently re-routed or dropped an intermediate would otherwise be
    // drawn as a road it never measured.
    for (const w of points) {
      const d = minDistanceMeters(coords, w)
      if (d > 150) throw new Error(`routes: waypoint ${d.toFixed(0)}m off the returned polyline`)
    }
    const out: RoadLegResult[] = []
    let cursor = 0
    for (let i = 0; i < legs.length; i++) {
      const legKm = legs[i].distanceMeters! / 1000
      const legMin = parseIsoDuration(legs[i].duration!) / 60
      const start = nearestIndexOnPolyline(coords, cursor, points[i])
      const end = nearestIndexOnPolyline(coords, start, points[i + 1])
      if (end <= start) throw new Error('routes: corridor leg split is degenerate')
      const seg = coords.slice(start, end + 1)
      out.push({
        km: legKm,
        min: legMin,
        coords: seg.length >= 2 ? seg : [coords[start], coords[end]],
        // Google leg totals already exclude the intra-leg dwell; keep the
        // segment honest even when the polyline slice is coarse.
      })
      cursor = end
    }
    return { legs: out }
  }
  return { km: r.distanceMeters / 1000, min: seconds / 60, coords }
}

/** Thrown when the Phase-B soft cap says no more Routes events this month. */
export class QuotaExhaustedError extends Error {
  constructor(sku: QuotaSku) {
    super(`Google Routes quota soft-cap reached for ${sku} — falling back to OSRM`)
    this.name = 'QuotaExhaustedError'
  }
}

/** Parse an ISO 8601 duration ("1234s", "PT1H2M3S") into seconds. */
function parseIsoDuration(s: string): number {
  if (/^\d+s$/.test(s)) return Number(s.slice(0, -1))
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s)
  if (!m) return Number.NaN
  const d = Number(m[1] ?? 0)
  const h = Number(m[2] ?? 0)
  const min = Number(m[3] ?? 0)
  const sec = Number(m[4] ?? 0)
  return (d * 86400 + h * 3600 + min * 60 + sec)
}

/**
 * Distance in METERS from a point to the closest vertex of a polyline —
 * the waypoint-on-polyline assertion for corridor responses (#187's rule:
 * assert the geometry before trusting it). Vertex-level (not segment-level)
 * is deliberate: Google's own route polylines pass through their waypoints,
 * so a waypoint landing >150 m from every VERTEX means the response is not
 * the road we asked for.
 */
function minDistanceMeters(coords: [number, number][], p: { lat: number; lng: number }): number {
  let best = Infinity
  for (const [lng, lat] of coords) {
    const d = haversineMeters(lat, lng, p.lat, p.lng)
    if (d < best) best = d
    if (best === 0) break
  }
  return best
}

/**
 * Index of the polyline vertex closest to `p`, searching from `from` onward —
 * the monotonic cut point for slicing one route polyline into per-leg geometry.
 */
function nearestIndexOnPolyline(coords: [number, number][], from: number, p: { lat: number; lng: number }): number {
  let bestIdx = from
  let best = Infinity
  for (let i = from; i < coords.length; i++) {
    const d = haversineMeters(coords[i][1], coords[i][0], p.lat, p.lng)
    if (d < best) { best = d; bestIdx = i }
  }
  return bestIdx
}

/** Haversine in meters (local, avoids importing the engine into the provider). */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}
