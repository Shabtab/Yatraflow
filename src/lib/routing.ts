// ============ Real road routing ============
// Primary source: Google Routes API (computeRoutes) for India-tuned road
// distance/time + geometry (issue #6). Free fallback: the OSRM demo server
// (no key). The app never blocks on routing — any Google failure (no key,
// quota, network) transparently drops to OSRM, and OSRM failure drops to the
// engine's haversine estimate. Provider-parity with geocode.ts facade.
import { legBetween } from './engine'
import type { EngineAssumptions, LegEstimate } from './engine'
import { googleRoute, routesEnabled, type RouteResult } from './providers/routes'

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
  /** which provider produced this leg */
  source: 'google' | 'osrm' | 'estimate'
  /** simplified road geometry [lng, lat][] for map drawing (empty if estimate fallback) */
  geometry: [number, number][]
}

/**
 * Try Google Routes first when a key is configured, then OSRM, then the local
 * haversine estimate. `assumptions` only matters in the final fallback mode.
 */
async function bestRoute(a: LatLng, b: LatLng, mode: string): Promise<RoadLeg> {
  if (routesEnabled()) {
    try {
      const r: RouteResult = await googleRoute(a, b, mode)
      return {
        distanceKm: r.km,
        durationMinutes: Math.round(r.min),
        source: 'google',
        geometry: r.coords.length ? r.coords : [[a.lng, a.lat], [b.lng, b.lat]],
      }
    } catch {
      /* Google failed (quota/network/key) — fall through to OSRM */
    }
  }
  const r = await osrmRoute(a, b)
  if (r) {
    return {
      distanceKm: r.km,
      durationMinutes: Math.round(r.min),
      source: 'osrm',
      geometry: r.coords.length ? r.coords : [[a.lng, a.lat], [b.lng, b.lat]],
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
): Promise<RoadLeg> {
  const leg = await bestRoute(a, b, assumptions.mode)
  if (leg.source === 'estimate') {
    // re-run against the real assumptions for an accurate haversine number
    const est = legBetween(a, b, assumptions)
    return { ...est, source: 'estimate', geometry: leg.geometry }
  }
  return leg
}

/**
 * Route every consecutive pair of points. Sequential by design — provider
 * rate-limits bursts and results are cached per session anyway.
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
