// ============ Road personality (Horizon 3.1) ============
// Pure, provider-agnostic. Classify a road window from its geometry:
// highway (straight, fast), state-road (default), ghat (twisty switchbacks),
// city (slow crawl when a speed is supplied). Dense polylines are
// stride-sampled to a fixed max so this never becomes a mobile CPU problem.
import { haversineKm } from './geo'

export type RoadKind = 'highway' | 'state-road' | 'ghat' | 'city'

export interface RoadWindow {
  kind: RoadKind
  /** path length / straight-line distance — 1.0 = perfectly straight */
  sinuosity: number
  /** total bearing change in radians per path km */
  twistPerKm: number
  /** human warning, or null when the road needs no warning */
  warning: string | null
}

/** Max points scanned per window — stride-sample denser polylines. */
const MAX_PTS = 200
const GHAT_SINUOSITY = 1.3
const GHAT_TWIST_PER_KM = 0.5
const HIGHWAY_SINUOSITY = 1.15
const HIGHWAY_TWIST_PER_KM = 0.15
/** Above this day-average km/h a non-ghat window is ordinary road; below it, crawl. */
export const CITY_SPEED_KMH = 30
/** Warning shown on city-crawl windows (exported so callers stay in sync). */
export const CITY_CRAWL_WARNING = 'city crawl ahead — short hops, slow traffic'

function distKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return haversineKm(a.lat, a.lng, b.lat, b.lng)
}

/**
 * Shortest signed longitude difference in degrees, wrapped to [-180, 180).
 * The bearing formula below is trig-periodic, so it was already correct for a
 * 179°E → 179°W step (measured difference vs raw: ~1e-15 rad, i.e. float
 * noise). This just states the short-way-round intent explicitly and keeps the
 * radian argument small — it is documentation, not a bug fix.
 */
export function normalizeLngDelta(deg: number): number {
  return ((deg + 540) % 360) - 180
}

function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLng = toRad(normalizeLngDelta(b.lng - a.lng))
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return Math.atan2(y, x)
}

/**
 * Classify one road window. Coords are {lat,lng} in window order.
 * Returns state-road for degenerate input (fewer than 2 finite points).
 */
export function classifyRoadWindow(
  coords: { lat: number; lng: number }[],
  opts: { avgSpeedKmh?: number } = {},
): RoadWindow {
  const pts = coords.filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lng))
  if (pts.length < 2) return { kind: 'state-road', sinuosity: 1, twistPerKm: 0, warning: null }
  const stride = Math.max(1, Math.ceil(pts.length / MAX_PTS))
  const sampled = pts.filter((_, i) => i % stride === 0)
  if (sampled[sampled.length - 1] !== pts[pts.length - 1]) sampled.push(pts[pts.length - 1])

  let pathKm = 0
  for (let i = 1; i < sampled.length; i++) pathKm += distKm(sampled[i - 1], sampled[i])
  const straightKm = distKm(sampled[0], sampled[sampled.length - 1])
  const sinuosity = straightKm > 0.01 ? pathKm / straightKm : 1

  let twist = 0
  for (let i = 2; i < sampled.length; i++) {
    const b1 = bearing(sampled[i - 2], sampled[i - 1])
    const b2 = bearing(sampled[i - 1], sampled[i])
    let d = Math.abs(b2 - b1)
    if (d > Math.PI) d = 2 * Math.PI - d
    twist += d
  }
  const twistPerKm = pathKm > 0 ? twist / pathKm : 0

  if (opts.avgSpeedKmh != null && Number.isFinite(opts.avgSpeedKmh) && opts.avgSpeedKmh < CITY_SPEED_KMH) {
    return { kind: 'city', sinuosity, twistPerKm, warning: 'city crawl ahead — short hops, slow traffic' }
  }
  if (sinuosity >= GHAT_SINUOSITY || twistPerKm >= GHAT_TWIST_PER_KM) {
    const km = Math.max(1, Math.round(pathKm))
    return { kind: 'ghat', sinuosity, twistPerKm, warning: `rest before the climb — ${km} km of switchbacks ahead` }
  }
  if (sinuosity < HIGHWAY_SINUOSITY && twistPerKm < HIGHWAY_TWIST_PER_KM) {
    return { kind: 'highway', sinuosity, twistPerKm, warning: null }
  }
  return { kind: 'state-road', sinuosity, twistPerKm, warning: null }
}
