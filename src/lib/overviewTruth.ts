// ============ The Overview's two derivations, filtered (#403) ============
// Both of these used to be private `useMemo`s inside OverviewTab, and both
// trusted whatever the store held. They live here, pure and node-testable, for
// two reasons: the only way to test a coordinate rule is to call it directly,
// and a rule that lives in a page can only be reviewed by reading the page.
//
// What changed, and why it was possible at all:
//   · ONE geometry truth. The snapshot used to walk `startLocationCoords` and
//     the stops itself, which meant it silently disagreed with the road the Map
//     tab measures: `buildRoadChain` also appends the round-trip return leg and
//     the trailing destination, so a round trip drew OPEN on the Overview and
//     as a closed loop on the Map. The snapshot now reads the chain the road
//     measurement actually consumes, so there is nothing left to disagree about.
//   · ONE coordinate predicate. Both derivations used `Number.isFinite`, which
//     accepts the provider's `(0,0)` placeholder — finite, in range, and not a
//     place on Earth. It stretched the snapshot across the Atlantic and moved
//     the weather centroid halfway to Null Island, where the fetch SUCCEEDED
//     for the wrong ocean, which is worse than failing. Both now import
//     `coordValid`, the boundary routing.ts already enforced.
import { coordValid } from './routing'
import { buildRoadChain } from './tripRoad'

export interface OverviewRoutePoint {
  lat: number
  lng: number
  /** The day whose arrival leg this point belongs to; null for the start and
   *  for the return/destination legs, which no day badge should claim. */
  day: number | null
}

type ChainTrip = Parameters<typeof buildRoadChain>[0]

/**
 * The trip's route-snapshot geometry, or an EMPTY list when there is nothing
 * honest to draw.
 *
 * Returning `[]` rather than `undefined` is load-bearing: `RouteSnapshot` is a
 * shared component whose fallback is an *illustrative* curve, so a one-stop
 * trip used to be handed that mock wearing real day badges — a drawn road for a
 * trip that has no route. The caller branches on the empty list and says so
 * (the Overview's own branch; the public page keeps its existing behaviour).
 */
export function overviewRoutePoints(trip: ChainTrip): OverviewRoutePoint[] {
  const { points, ptDay } = buildRoadChain(trip)
  const valid: OverviewRoutePoint[] = []
  for (let i = 0; i < points.length; i++) {
    const p = coordValid(points[i])
    if (!p) continue
    valid.push({ lat: p.lat, lng: p.lng, day: ptDay[i] ?? null })
  }
  // A single point is not a route: a line needs two, and the shared component's
  // mock exists precisely for this case — which is what we are refusing to show.
  return valid.length >= 2 ? valid : []
}

/**
 * WHERE the trip-wide forecast is anchored: the centroid of its VALID,
 * non-rejected stops, or null when it has none.
 *
 * This is the day's own stops, not the trip start — the card covers the whole
 * trip, so centring the stops it fetched is the honest choice (stated here
 * because the Timeline chip makes the different, per-day choice, and the two
 * used to look like an accident). Note that a centroid is itself lossy for a
 * multi-city trip — the forecast lands between the cities — but validity
 * filtering is this fix; per-day anchoring is a separate, disclosed change.
 */
export function routeWeatherAnchor(trip: {
  days: Array<{ stops: Array<{ lat: number; lng: number; status?: string }> }>
}): { lat: number; lng: number } | null {
  const valid: Array<{ lat: number; lng: number }> = []
  for (const day of trip.days) {
    for (const s of day.stops) {
      if (s.status === 'rejected') continue
      const p = coordValid(s)
      if (p) valid.push(p)
    }
  }
  if (valid.length === 0) return null
  return {
    lat: valid.reduce((a, p) => a + p.lat, 0) / valid.length,
    lng: valid.reduce((a, p) => a + p.lng, 0) / valid.length,
  }
}
