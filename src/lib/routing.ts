// ============ Real road routing ============
// Replaces haversine×1.25 estimates with real road distances/durations from
// the free OSRM demo server (no key). Falls back to the old estimate when the
// service is unreachable — the app never blocks on routing.
import { legBetween } from './engine'
import type { EngineAssumptions, LegEstimate } from './engine'

const OSRM = 'https://router.project-osrm.org/route/v1/driving'

interface OsrmRoute {
  distance: number      // metres
  duration: number      // seconds
  geometry?: { coordinates: [number, number][] } // [lng, lat]
}

/** Fetch a road route between two points. Returns null on any failure. */
async function osrmRoute(a: LatLng, b: LatLng): Promise<{ km: number; min: number; coords: [number, number][] } | null> {
  try {
    const url = `${OSRM}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data = await res.json()
    const r: OsrmRoute | undefined = data.routes?.[0]
    if (data.code !== 'Ok' || !r) return null
    return { km: r.distance / 1000, min: r.duration / 60, coords: r.geometry?.coordinates ?? [] }
  } catch {
    return null
  }
}

export interface LatLng { lat: number; lng: number }

export interface RoadLeg extends LegEstimate {
  /** true when this came from OSRM rather than the local estimate */
  fromOsrm: boolean
  /** simplified road geometry [lng, lat][] for map drawing (empty if fallback) */
  geometry: [number, number][]
}

/**
 * Road leg between two points: real routing with transparent fallback to the
 * engine's haversine estimate. `assumptions` only matters in fallback mode.
 */
export async function roadLegBetween(
  a: LatLng,
  b: LatLng,
  assumptions: EngineAssumptions,
): Promise<RoadLeg> {
  const r = await osrmRoute(a, b)
  if (r) {
    return { distanceKm: r.km, durationMinutes: Math.round(r.min), fromOsrm: true, geometry: r.coords }
  }
  const est = legBetween(a, b, assumptions)
  return { ...est, fromOsrm: false, geometry: [[a.lng, a.lat], [b.lng, b.lat]] }
}

/**
 * Route every consecutive pair of points. Sequential by design — OSRM's demo
 * server rate-limits bursts and results are cached per session anyway.
 */
export async function routePath(
  points: LatLng[],
  assumptions: EngineAssumptions,
): Promise<RoadLeg[]> {
  const legs: RoadLeg[] = []
  for (let i = 0; i < points.length - 1; i++) {
    legs.push(await roadLegBetween(points[i], points[i + 1], assumptions))
  }
  return legs
}
