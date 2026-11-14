import type { ExpressionSpecification } from 'maplibre-gl'

// Lens marks for the trip map: stay reach rings, empty-part rings and pick bands.
// These functions are pure, so the map and the tests read the same rules.

/** One stay reach ring. Points are [lng, lat] pairs, as the map wants them. */
export interface StayRing {
  id: string
  label: string
  ring: [number, number][]
}

/** One ring as a GeoJSON line feature. */
export interface StayRingFeature {
  type: 'Feature'
  properties: { id: string; label: string }
  geometry: { type: 'LineString'; coordinates: [number, number][] }
}

/** The rings as one FeatureCollection, ready for a line layer. */
export interface StayRingCollection {
  type: 'FeatureCollection'
  features: StayRingFeature[]
}

/** The band a pick carries. An absent band means the pick is in scope and in budget. */
export type PickBand = 'just-past' | 'over-budget'

/** The class a pick takes for its band. An absent band adds no class. */
export function pickBandClass(band: PickBand | null | undefined): string {
  if (band === 'just-past') return 'is-just-past'
  if (band === 'over-budget') return 'is-over-budget'
  return ''
}

/** The point with the highest latitude, which is the top of the ring on screen. */
export function ringLabelPoint(ring: readonly [number, number][]): [number, number] | null {
  let top: [number, number] | null = null
  for (const point of ring) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue
    if (!top || point[1] > top[1]) top = point
  }
  return top
}

/** The point with the lowest latitude. The board hangs its caption here. */
export function ringCaptionPoint(ring: readonly [number, number][]): [number, number] | null {
  let bottom: [number, number] | null = null
  for (const point of ring) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue
    if (!bottom || point[1] < bottom[1]) bottom = point
  }
  return bottom
}

/** A walk ring gets a walking icon. A drive ring gets a car. */
export function ringCaptionMode(id: string | null | undefined): 'walk' | 'drive' {
  return /drive/i.test(String(id ?? '')) ? 'drive' : 'walk'
}

/** Copy a ring and repeat its first point at the end, so the line closes. */
export function closeRing(ring: readonly [number, number][]): [number, number][] {
  const points = ring.filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1])).map(point => [point[0], point[1]] as [number, number])
  if (points.length === 0) return points
  const first = points[0]
  const last = points[points.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([first[0], first[1]])
  return points
}

/** One closed LineString feature per ring, with the label kept in the properties. */
export function stayRingsGeoJson(rings: readonly StayRing[]): StayRingCollection {
  return {
    type: 'FeatureCollection',
    features: rings.map(ring => ({
      type: 'Feature' as const,
      properties: { id: ring.id, label: ring.label },
      geometry: { type: 'LineString' as const, coordinates: closeRing(ring.ring) },
    })),
  }
}

/** One closed Polygon feature per ring. A fill layer draws the lagoon tint. */
export function stayRingsFillGeoJson(rings: readonly StayRing[]) {
  return {
    type: 'FeatureCollection' as const,
    features: rings.map(ring => ({
      type: 'Feature' as const,
      properties: { id: ring.id },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [closeRing(ring.ring)],
      },
    })),
  }
}

/** Bounds of one ring as [[minLng, minLat], [maxLng, maxLat]]. Null when empty. */
export function ringBounds(ring: readonly [number, number][]): [[number, number], [number, number]] | null {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const point of ring) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue
    if (point[0] < minLng) minLng = point[0]
    if (point[1] < minLat) minLat = point[1]
    if (point[0] > maxLng) maxLng = point[0]
    if (point[1] > maxLat) maxLat = point[1]
  }
  if (!Number.isFinite(minLng)) return null
  return [[minLng, minLat], [maxLng, maxLat]]
}

/** A [[west, south], [east, north]] extent, as MapLibre wants it. */
export type LngLatBounds = [[number, number], [number, number]]

/** Keep a camera fit inside a known route extent. An unknown extent stays as it is.
 *  A fit outside the route falls back to the route, so no lens change zooms out. */
export function clampBoundsWithin(
  candidate: LngLatBounds | null,
  route: LngLatBounds | null,
): LngLatBounds | null {
  if (candidate == null || route == null) return candidate
  const [[west, south], [east, north]] = candidate
  const [[routeWest, routeSouth], [routeEast, routeNorth]] = route
  const clamped: LngLatBounds = [
    [Math.max(west, routeWest), Math.max(south, routeSouth)],
    [Math.min(east, routeEast), Math.min(north, routeNorth)],
  ]
  const [[cw, cs], [ce, cn]] = clamped
  if (!Number.isFinite(cw) || !Number.isFinite(cs) || !Number.isFinite(ce) || !Number.isFinite(cn)) return route
  return cw >= ce || cs >= cn ? route : clamped
}

/** The stop name tag's height and its drop under the mark. Values from the Drive board. */
export const STOP_TAG_BOX = { w: 132, h: 26, dy: 34 }

/** The tag width a stop name needs. A long name stops at `maxWidth` px. */
export function stopTagBox(title: string, maxWidth = 184): { w: number; h: number } {
  const chars = [...title.trim()].length
  return { w: Math.min(maxWidth, Math.max(56, Math.round(chars * 6.4 + 18))), h: STOP_TAG_BOX.h }
}

/** The base tag clears its mark by 7 px. The board shows 6 to 8 px. */
export const BASE_TAG_GAP = 7

/** The base tag box sits left of the stop box, centred on the stop's y. */
export function baseTagBox(
  stop: { x: number; y: number; w: number; h: number },
  tagW: number,
  tagH: number,
  gap: number = BASE_TAG_GAP,
): { x: number; y: number; w: number; h: number } {
  return { x: stop.x - stop.w / 2 - gap - tagW / 2, y: stop.y, w: tagW, h: tagH }
}

/** A numbered stop's tag sits beside its pin on the same line, as the Drive board shows. The stop box is 36 px and the pin 32 px. So 2 px here is 4 px from the pin. */
export const NUMBER_TAG_GAP = 2

/** A stop shows its tag on the active day. The stay base shows it on every day. */
export function showsStopTag(
  stop: { category?: string | null; dayIndex: number; auto?: boolean },
  activeDay: number | null,
): boolean {
  if (stop.auto) return false
  if (stop.category === 'hotel') return true
  return activeDay != null && stop.dayIndex === activeDay
}

/** The base tag shows the place name. A "Check in · " lead is UI copy, not a name. */
export function baseTagText(title: string | null | undefined): string {
  return String(title ?? '')
    .trim()
    .replace(/^check[\s-]*in\s*[·•:–—-]\s*/i, '')
    .trim()
}

/** Hotel tags: the active day always shows its tag. Other days need zoom 9. */
export function showsHotelTag(
  stop: { category?: string | null; dayIndex: number; auto?: boolean },
  activeDay: number | null,
  zoom: number,
): boolean {
  if (stop.auto) return false
  if (stop.category !== 'hotel') return false
  if (activeDay != null && stop.dayIndex === activeDay) return true
  return Number.isFinite(zoom) && zoom >= 9
}

/** The corridor is a Drive-lens wash. MapTab sends null for Stay, Fix and Gap. */
export function corridorDayForLens(
  lens: string | null | undefined,
  activeDay: number | null | undefined,
): number | null {
  return lens === 'drive' && activeDay != null ? activeDay : null
}

/** A corridor draws only for the one day the host names. */
export function drawsCorridor(corridorDay: number | null | undefined, dayIndex: number): boolean {
  return corridorDay != null && corridorDay === dayIndex
}

const CORRIDOR_WIDTH_STOPS = [[7, 8], [10, 18], [12, 28], [14, 46]] as const

function corridorWidth(scale: number): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], ...CORRIDOR_WIDTH_STOPS.flatMap(([zoom, width]) => [zoom, width * scale])]
}

/** Keep each edge at half the wash width at every zoom. */
export function corridorEdgeOffset(side: -1 | 1): ExpressionSpecification {
  return corridorWidth(side / 2)
}

/** Narrow the wash at low zoom so tight bends do not overlap into dark folds. */
export const CORRIDOR_PAINT: {
  width: ExpressionSpecification
  opacity: number
  edgeWidth: number
  edgeOpacity: ExpressionSpecification
  edgeDash: [number, number]
  tolerance: number
} = { width: corridorWidth(1), opacity: 0.15, edgeWidth: 1, edgeOpacity: ['step', ['zoom'], 0, 9, 0.5], edgeDash: [3, 4], tolerance: 1.5 }

/** Remove close points before rounding the wash. MapLibre also simplifies the wash for each zoom. Ends stay fixed. */
export function thinCorridorLine(
  coordinates: readonly [number, number][],
  minDegrees = 0.004,
): [number, number][] {
  if (coordinates.length < 3) return coordinates.map(p => [p[0], p[1]] as [number, number])
  const out: [number, number][] = [[coordinates[0][0], coordinates[0][1]]]
  for (let i = 1; i < coordinates.length - 1; i++) {
    const last = out[out.length - 1]
    if (Math.hypot(coordinates[i][0] - last[0], coordinates[i][1] - last[1]) >= minDegrees) {
      out.push([coordinates[i][0], coordinates[i][1]])
    }
  }
  const end = coordinates[coordinates.length - 1]
  out.push([end[0], end[1]])
  return out
}

/** Round sharp wash corners with Chaikin cuts. Zoom paint limits edge offsets on distant bends. Ends stay fixed. */
export function smoothCorridorLine(
  coordinates: readonly [number, number][],
  rounds = 2,
): [number, number][] {
  let line: [number, number][] = coordinates.map(p => [p[0], p[1]] as [number, number])
  for (let r = 0; r < rounds && line.length > 2; r++) {
    const next: [number, number][] = [line[0]]
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, ay] = line[i]
      const [bx, by] = line[i + 1]
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75])
    }
    next.push(line[line.length - 1])
    line = next
  }
  return line
}

/** One LineString feature. Two offset layers draw the corridor's dashed edges. */
export function corridorEdgeGeoJson(coordinates: readonly [number, number][]) {
  return {
    type: 'FeatureCollection' as const,
    features: [{
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: coordinates.map(point => [point[0], point[1]]),
      },
    }],
  }
}

/** The stay-ring camera fit. The ring label and the base tag need their own room. */
export const STAY_RING_FRAME_PADDING = 96

/** The board's active ring covers about 0.4 of the canvas's shorter side. */
export const STAY_RING_CANVAS_FRACTION = 0.4

/** Expand a ring's bounds around its centre so the ring fills `fraction` of the
 *  framed canvas. The fit then uses the overlay insets, not a pixel padding. */
export function stayFrameBounds(
  ring: readonly [number, number][],
  fraction: number = STAY_RING_CANVAS_FRACTION,
): LngLatBounds | null {
  const bounds = ringBounds(ring)
  if (!bounds) return null
  const f = Number.isFinite(fraction) && fraction > 0 && fraction < 1 ? fraction : STAY_RING_CANVAS_FRACTION
  const [[west, south], [east, north]] = bounds
  const cx = (west + east) / 2
  const cy = (south + north) / 2
  const halfW = (east - west) / 2
  const halfH = (north - south) / 2
  const grow = 1 / f
  return [
    [cx - halfW * grow, cy - halfH * grow],
    [cx + halfW * grow, cy + halfH * grow],
  ]
}

/** The label of the fix mark. Unknown parts stay out. */
export function fixMarkLabel(
  stopName: string | null,
  arriveTime: string | null,
  jettyTime: string | null,
): string | null {
  if (stopName == null) return null
  const head = arriveTime == null ? stopName : `${stopName} ${arriveTime}`
  return jettyTime == null ? head : `${head} · jetty ${jettyTime}`
}

/** The visible fix-mark label. Both real times must be known. A missing fact
 *  keeps the mark bare, so no label is invented. */
export function fixMarkFactsLabel(
  stopName: string | null,
  commitmentText: string | null,
  arrivalText: string | null,
): string | null {
  if (stopName == null || commitmentText == null || arrivalText == null) return null
  if (stopName.trim() === '' || commitmentText.trim() === '' || arrivalText.trim() === '') return null
  return fixMarkLabel(stopName, commitmentText, arrivalText)
}
