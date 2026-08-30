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
  }>
}

/** Decode a Google encoded polyline into [lng, lat][] (1e5 precision). */
export function decodePolyline(str: string): [number, number][] {
  const out: [number, number][] = []
  let idx = 0
  let lat = 0
  let lng = 0
  while (idx < str.length) {
    let shift = 0
    let result = 0
    let b: number
    do {
      b = str.charCodeAt(idx++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlat = result & 1 ? ~(result >> 1) : result >> 1
    lat += dlat

    shift = 0
    result = 0
    do {
      b = str.charCodeAt(idx++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlng = result & 1 ? ~(result >> 1) : result >> 1
    lng += dlng

    out.push([lng / 1e5, lat / 1e5])
  }
  return out
}

/**
 * Road route between two points via Google Routes API computeRoutes.
 * Throws on any failure (quota, network, non-OK) so the facade can fall back.
 */
export async function googleRoute(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  travelMode: string,
): Promise<RouteResult> {
  const sku: QuotaSku = 'routes'
  if (!routesEnabled()) throw new Error('routes: no Google key configured')
  if (!quotaAllows(sku)) throw new QuotaExhaustedError(sku)
  const res = await fetch(ROUTES, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
      destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
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
