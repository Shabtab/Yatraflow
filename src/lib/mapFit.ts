// ============ Map fit bounds (pure) ============
// The viewport must frame what the map DRAWS, not just where the stop pins
// stand. A day's journey carries a synthesized origin (where yesterday ended)
// that is drawn as an endpoint flag AND as the road line's far end, and a
// round trip's home pin sits beyond the last stop — none of those are stops.
// Fitting stop bounds alone glued the camera to a stop cluster at maxZoom
// while the route ran off-screen: the reported case is Day 2 of the sample
// Rajasthan trip, two pins inside Jodhpur framed at zoom 12 while 280 km of
// drawn road to Jaipur sat16,000 px outside the canvas.
//
// Pure and node-testable: no maplibre, no DOM.

export interface LatLng {
  lat: number
  lng: number
}

/** `fitBounds` accepts `[[minLng, minLat], [maxLng, maxLat]]`. */
export type BoundsTuple = [[number, number], [number, number]]

/** Bounds of every point the current view draws (stops ∪ journey chain ∪ any
 *  extras the caller passes), or null when there is nothing to frame.
 *  Non-finite coordinates are skipped (a NaN would poison every comparison),
 *  and a near-zero span is padded by ~0.08° — MapLibre computes maxZoom from
 *  the box, and a zero-size box fits one pixel at maxZoom instead of the
 *  place. */
export function boundsOf(points: readonly LatLng[]): BoundsTuple | null {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
  }
  if (!Number.isFinite(minLng)) return null
  if (maxLng - minLng < 1e-4) { minLng -= 0.08; maxLng += 0.08 }
  if (maxLat - minLat < 1e-4) { minLat -= 0.08; maxLat += 0.08 }
  return [[minLng, minLat], [maxLng, maxLat]]
}

/** How many road vertices the all-view fit samples. The fit is a camera
 *  operation, not a geometry audit — the bounding box of a decimated line sits
 *  within metres of the full one — while `fitPointsKey` is a `toFixed(4)` join
 *  over every point, so the set stays small on purpose. */
export const FIT_ROAD_SAMPLES = 24

export interface AllViewFitInput {
  /** The pins the view draws. */
  stops: readonly LatLng[]
  /** `buildRoadChain(trip).points` — start, ordered stops, the drive home, and
   *  the trailing destination. Its ENDPOINTS are what stop bounds miss. */
  chainPoints?: readonly LatLng[] | null
  /** The drawn road in GeoJSON `[lng, lat]` order (null while unmeasured). */
  roadGeometry?: readonly (readonly [number, number])[] | null
  /** Decimation budget for the road; its last vertex is always included. */
  samples?: number
}

/**
 * EVERYTHING the full-trip view draws, which is what its fit has to frame (#330).
 *
 * The old set was the stop pins plus home-when-shown, and it framed a line that is
 * longer than the stops in three places: the trip-start leg (the start coordinate
 * was never added in all-days mode at all), the destination tail
 * (`buildRoadChain`'s `hasDestTail` — drawn, never fitted), and the road's own
 * curvature (a reroute around a ghat or a lake bows outside the chain's box, which
 * the old comment dismissed as staying "well inside the 70px padding" — an
 * assertion nobody had measured).
 *
 * The endpoints come from the chain builder's own output rather than a
 * re-implementation of its ordering rules, so `roadChainSig` and this can never
 * disagree about where a trip begins or ends.
 *
 * ALL-days view only, on purpose: a day view fits its own journey chain, and
 * mixing the whole-trip road into that would frame a previous day's line while the
 * current one is still measuring. Fit the drawing, but fit the RIGHT drawing.
 */
export function allViewFitPoints(input: AllViewFitInput): LatLng[] {
  const pts: LatLng[] = input.stops.map(p => ({ lat: p.lat, lng: p.lng }))
  for (const p of input.chainPoints ?? []) pts.push({ lat: p.lat, lng: p.lng })
  const road = input.roadGeometry
  const n = road?.length ?? 0
  if (road && n >= 2) {
    const budget = Math.max(2, input.samples ?? FIT_ROAD_SAMPLES)
    const step = Math.max(1, Math.floor(n / budget))
    for (let i = 0; i < n - 1; i += step) pts.push({ lat: road[i][1], lng: road[i][0] })
    const last = road[n - 1]
    pts.push({ lat: last[1], lng: last[0] })
  }
  return pts
}
