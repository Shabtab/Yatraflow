import type { Trip } from '../data/types'
import { isIndiaStateCode } from '../data/indiaStates'
import type { IndiaStateShape } from '../data/indiaStateShapes'

/** A point on the map, in degrees. */
export interface GeoPoint {
  lat: number
  lng: number
}

/** A position as [longitude, latitude], the order of the shape data. */
type Position = readonly [number, number]
type Ring = readonly Position[]
type Polygon = readonly Ring[]

/** A point outside every state counts for the nearest state within this many km.
 *  Coastal and island towns fall just outside the simplified coastline. */
export const NEAREST_STATE_KM = 10

const KM_PER_DEG_LAT = 110.574
const KM_PER_DEG_LNG_AT_EQUATOR = 111.32

function lastItem<T>(items: readonly T[]): T | undefined {
  return items.slice(-1)[0]
}

function isGeoPoint(point: GeoPoint | null | undefined): point is GeoPoint {
  return point != null && Number.isFinite(point.lat) && Number.isFinite(point.lng)
}

/** Ray casting. True when [lng, lat] lies inside the closed ring. */
export function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false
  let previous = lastItem(ring)
  for (const current of ring) {
    const [x, y] = current
    if (previous) {
      const [px, py] = previous
      if ((y > lat) !== (py > lat) && lng < ((px - x) * (lat - y)) / (py - y) + x) inside = !inside
    }
    previous = current
  }
  return inside
}

/** Inside the outer ring and outside every hole. */
export function pointInPolygon(lng: number, lat: number, polygon: Polygon): boolean {
  const [outer, ...holes] = polygon
  if (!outer || !pointInRing(lng, lat, outer)) return false
  return !holes.some(hole => pointInRing(lng, lat, hole))
}

/** Inside any polygon of the state. A multipolygon is several polygons. */
export function pointInShape(lng: number, lat: number, shape: IndiaStateShape): boolean {
  return shape.polygons.some(polygon => pointInPolygon(lng, lat, polygon))
}

/** Distance in km from the point to one edge, on a local flat map. */
function segmentKm(lng: number, lat: number, a: Position, b: Position): number {
  const kx = KM_PER_DEG_LNG_AT_EQUATOR * Math.cos((lat * Math.PI) / 180)
  const ax = (a[0] - lng) * kx
  const ay = (a[1] - lat) * KM_PER_DEG_LAT
  const dx = (b[0] - lng) * kx - ax
  const dy = (b[1] - lat) * KM_PER_DEG_LAT - ay
  const length2 = dx * dx + dy * dy
  const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / length2))
  return Math.hypot(ax + t * dx, ay + t * dy)
}

/** Distance in km from the point to the nearest edge of the state. */
export function distanceToShapeKm(lng: number, lat: number, shape: IndiaStateShape): number {
  let best = Number.POSITIVE_INFINITY
  for (const polygon of shape.polygons) {
    for (const ring of polygon) {
      let previous = lastItem(ring)
      for (const current of ring) {
        if (previous) best = Math.min(best, segmentKm(lng, lat, previous, current))
        previous = current
      }
    }
  }
  return best
}

export interface StateHit {
  code: string
  /** inside: the point is within the state. nearest: outside, within NEAREST_STATE_KM. */
  via: 'inside' | 'nearest'
  km: number
}

/** The state that holds the point. Patches are checked first, so the Mahe and
 *  Yanam enclaves beat Andhra Pradesh. Outside every state, the
 *  nearest state within `nearestKm`. */
export function locateState(
  lng: number,
  lat: number,
  shapes: readonly IndiaStateShape[],
  patches: readonly IndiaStateShape[] = [],
  nearestKm: number = NEAREST_STATE_KM,
): StateHit | undefined {
  for (const patch of patches) {
    if (pointInShape(lng, lat, patch)) return { code: patch.code, via: 'inside', km: 0 }
  }
  for (const shape of shapes) {
    if (pointInShape(lng, lat, shape)) return { code: shape.code, via: 'inside', km: 0 }
  }
  let best: StateHit | undefined
  for (const shape of shapes) {
    const km = distanceToShapeKm(lng, lat, shape)
    if (km <= nearestKm && (best === undefined || km < best.km)) best = { code: shape.code, via: 'nearest', km }
  }
  return best
}

/** The points a trip's states come from: the start town, the end town (the last
 *  destination) and every stop. The road between stops is not counted. */
export function routePointsForTrip(trip: Trip): GeoPoint[] {
  const ends = [trip.startLocationCoords, lastItem(trip.destinationCoords ?? [])]
  const stops = trip.days.flatMap(day => day.stops.map(stop => ({ lat: stop.lat, lng: stop.lng })))
  return [...ends, ...stops].filter(isGeoPoint)
}

/** The sorted codes of the states a route covers, each code once. The shapes load
 *  only when this runs, so the storefront bundle never carries them. */
export async function statesForTrip(trip: Trip): Promise<string[]> {
  const points = routePointsForTrip(trip)
  if (points.length === 0) return []
  const { INDIA_STATE_SHAPES, INDIA_STATE_PATCHES } = await import('../data/indiaStateShapes')
  const codes = new Set<string>()
  for (const point of points) {
    const hit = locateState(point.lng, point.lat, INDIA_STATE_SHAPES, INDIA_STATE_PATCHES)
    if (hit && isIndiaStateCode(hit.code)) codes.add(hit.code)
  }
  return [...codes].sort()
}

/** The codes a publish sends. Undefined when the shapes fail to load, so publishing never fails. */
export async function publishableStateCodes(trip: Trip): Promise<string[] | undefined> {
  try {
    return await statesForTrip(trip)
  } catch {
    return undefined
  }
}
