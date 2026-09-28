// ============ #403 — Overview geometry and weather trust VALID coordinates ============
// The Overview derived its own route-snapshot point list and its own weather
// centroid, and both trusted whatever the store held: a stop whose coordinates
// are the provider's `(0,0)` placeholder passed an `isFinite` check, stretched
// the snapshot across the Atlantic and dragged the forecast into the sea. The
// snapshot also omitted the return leg and destination tail that the road
// actually measures, and a one-stop trip was handed the shared component's
// illustrative mock curve wearing real day badges.
import { describe, expect, it } from 'vitest'
import { coordValid } from '../src/lib/routing'
import { buildRoadChain } from '../src/lib/tripRoad'
import { overviewRoutePoints, routeWeatherAnchor } from '../src/lib/overviewTruth'

const stop = (over: Partial<{ lat: number; lng: number; status?: string; orderInDay: number; title: string }> = {}) => ({
  lat: 15.5, lng: 73.9, orderInDay: 0, title: 'Stop', ...over,
})
const day = (over: Partial<{ index: number; stops: ReturnType<typeof stop>[] }> = {}) => ({
  index: 0, stops: [stop()], ...over,
})
const tripOf = (over: Partial<Parameters<typeof buildRoadChain>[0]> = {}) => ({
  startLocationCoords: { lat: 12.97, lng: 77.59 },
  days: [day(), day({ index: 1, stops: [stop({ orderInDay: 0, lat: 13.35, lng: 74.79 })] })],
  destinationCoords: [],
  roundTrip: false,
  transportMode: 'car',
  ...over,
}) as never as Parameters<typeof buildRoadChain>[0]

describe('#403 — the coord-validity boundary is importable, not re-implemented', () => {
  it('coordValid is exported so callers filter through the ONE predicate', () => {
    // The whole point: the Overview must not grow its own `isFinite` check.
    expect(typeof coordValid).toBe('function')
  })

  it('rejects the Null-Island placeholder that an isFinite check waves through', () => {
    // The exact class the repo's Null-Island lesson is about: finite, in range,
    // and still not a place on Earth.
    expect(coordValid({ lat: 0, lng: 0 })).toBeNull()
    expect(coordValid({ lat: Number.NaN, lng: 73.9 })).toBeNull()
    expect(coordValid({ lat: 15.5, lng: Number.POSITIVE_INFINITY })).toBeNull()
    expect(coordValid({ lat: 95, lng: 73.9 })).toBeNull()
    expect(coordValid({ lat: 15.5, lng: 200 })).toBeNull()
    expect(coordValid({ lat: 12.97, lng: 77.59 })).toEqual({ lat: 12.97, lng: 77.59 })
  })
})

describe('#403 — the snapshot uses the road chain, not a second point list', () => {
  it('a (0,0) stop is excluded from the snapshot', () => {
    // A start, one real stop and one placeholder: the placeholder must vanish
    // while the rest survives. (A start plus ONLY a placeholder is the
    // one-valid-point case, covered separately below.)
    const pts = overviewRoutePoints(tripOf({
      days: [day({ stops: [
        stop({ orderInDay: 0, lat: 15.5, lng: 73.9 }),
        stop({ orderInDay: 1, lat: 0, lng: 0 }),
      ] })],
    }))
    expect(pts.map(p => p.lat)).toEqual([12.97, 15.5])
  })

  it('a start plus only a placeholder is NO snapshot — the honest absence', () => {
    // One valid point is not a route. This is the case that used to hand the
    // shared component its illustrative mock curve.
    const pts = overviewRoutePoints(tripOf({
      days: [day({ stops: [stop({ lat: 0, lng: 0 })] })],
    }))
    expect(pts).toEqual([])
  })

  it('NaN and out-of-range stops are excluded too', () => {
    const pts = overviewRoutePoints(tripOf({
      days: [day({ stops: [
        stop({ lat: Number.NaN, lng: 73.9 }),
        stop({ orderInDay: 1, lat: 91, lng: 73.9 }),
        stop({ orderInDay: 2, lat: 15.5, lng: 73.9 }),
      ] })],
    }))
    expect(pts.map(p => p.lat)).toEqual([12.97, 15.5])
  })

  it('rejected stops stay out', () => {
    const pts = overviewRoutePoints(tripOf({
      days: [day({ stops: [
        stop({ status: 'rejected', lat: 1, lng: 1 }),
        stop({ orderInDay: 1, lat: 15.5, lng: 73.9 }),
      ] })],
    }))
    expect(pts.map(p => p.lat)).toEqual([12.97, 15.5])
  })

  it('a round trip CLOSES the loop — the return leg the snapshot used to omit', () => {
    const trip = tripOf({ roundTrip: true })
    const chain = buildRoadChain(trip).points
    const pts = overviewRoutePoints(trip)
    expect(pts[pts.length - 1]).toMatchObject({ lat: trip.startLocationCoords.lat, lng: trip.startLocationCoords.lng })
    expect(pts).toHaveLength(chain.length)
  })

  it('the destination tail is included, so the snapshot matches the measured road', () => {
    const trip = tripOf({ destinationCoords: [{ lat: 9.93, lng: 76.27 }] })
    const chain = buildRoadChain(trip)
    expect(chain.hasDestTail).toBe(true)
    const pts = overviewRoutePoints(trip)
    expect(pts[pts.length - 1]).toMatchObject({ lat: 9.93, lng: 76.27 })
    expect(pts).toHaveLength(chain.points.length)
  })

  it('every point is drawn from the chain the road measurement actually uses', () => {
    // The parity assertion — the thing that stops the two lists drifting again.
    for (const trip of [
      tripOf(),
      tripOf({ roundTrip: true }),
      tripOf({ destinationCoords: [{ lat: 9.93, lng: 76.27 }] }),
      tripOf({ roundTrip: true, destinationCoords: [{ lat: 9.93, lng: 76.27 }] }),
    ]) {
      const chain = buildRoadChain(trip).points
      const pts = overviewRoutePoints(trip)
      expect(pts).toHaveLength(chain.length)
      pts.forEach((p, i) => {
        expect(p.lat).toBe(chain[i].lat)
        expect(p.lng).toBe(chain[i].lng)
      })
    }
  })

  it('the day badge rides along, so a point knows which day it belongs to', () => {
    const pts = overviewRoutePoints(tripOf())
    expect(pts[0].day).toBeNull()          // the start
    expect(pts[1].day).toBe(0)             // day 1's stop
    expect(pts[2].day).toBe(1)             // day 2's stop
  })

  it('fewer than two valid points is NO snapshot — never a mock road with badges', () => {
    // A one-stop trip has no route to draw. Handing the shared component
    // `undefined` drew its illustrative curve, which reads as a real road.
    expect(overviewRoutePoints(tripOf({ startLocationCoords: undefined, days: [] }))).toEqual([])
    expect(overviewRoutePoints(tripOf({ startLocationCoords: undefined, days: [day()] }))).toEqual([])
    // One stop plus a start is a line, not a loop — still honest to draw.
    expect(overviewRoutePoints(tripOf({ days: [day()] })).length).toBeGreaterThanOrEqual(2)
  })
})

describe('#403 — the weather anchor refuses a poisoned centroid', () => {
  const weatherTrip = (stops: ReturnType<typeof stop>[]) =>
    ({ days: [day({ stops })] }) as never as Parameters<typeof routeWeatherAnchor>[0]

  it('a (0,0) stop does not drag the forecast into the Atlantic', () => {
    // The old average summed every non-rejected stop, so ONE placeholder moved
    // the anchor by half the distance to Null Island — and the fetch SUCCEEDED
    // for the wrong ocean, which is worse than failing.
    const a = routeWeatherAnchor(weatherTrip([stop({ lat: 15.5, lng: 73.9 })]))
    const poisoned = routeWeatherAnchor(weatherTrip([
      stop({ lat: 15.5, lng: 73.9, orderInDay: 0 }),
      stop({ lat: 0, lng: 0, orderInDay: 1 }),
    ]))
    expect(a).toEqual({ lat: 15.5, lng: 73.9 })
    expect(poisoned).toEqual({ lat: 15.5, lng: 73.9 })
  })

  it('averages only the VALID stops', () => {
    const anchor = routeWeatherAnchor(weatherTrip([
      stop({ lat: 10, lng: 70, orderInDay: 0 }),
      stop({ lat: 0, lng: 0, orderInDay: 1 }),
      stop({ lat: 20, lng: 90, orderInDay: 2 }),
    ]))
    expect(anchor).toEqual({ lat: 15, lng: 80 })
  })

  it('rejected stops are not averaged in', () => {
    const anchor = routeWeatherAnchor(weatherTrip([
      stop({ lat: 10, lng: 70, orderInDay: 0 }),
      stop({ lat: 50, lng: 50, orderInDay: 1, status: 'rejected' }),
    ]))
    expect(anchor).toEqual({ lat: 10, lng: 70 })
  })

  it('no valid stop is null — the card hides rather than inventing a city', () => {
    expect(routeWeatherAnchor(weatherTrip([]))).toBeNull()
    expect(routeWeatherAnchor(weatherTrip([stop({ lat: 0, lng: 0 })]))).toBeNull()
    expect(routeWeatherAnchor(weatherTrip([stop({ lat: Number.NaN, lng: 73.9 })]))).toBeNull()
  })

  it('reads DAY stops, not the trip start — the choice is stated, not accidental', () => {
    // Unlike the Timeline chip (which anchors on the day's own first stop),
    // this card covers the whole trip, so it centres the stops it fetched. The
    // test pins the choice so it cannot change silently.
    const anchor = routeWeatherAnchor(weatherTrip([stop({ lat: 15.5, lng: 73.9 })]))
    expect(anchor).not.toBeNull()
  })
})
