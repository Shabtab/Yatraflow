// ============ One road measurement per trip (#188) ============
// The #184 acceptance: the whole-trip road chain is measured ONCE, with one
// retry, and every consumer derives from that single result. Pure node tests —
// a stubbed fetch is the counter, no DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildRoadChain, measureRoadChain, correctionsFromLegs, mapRoadViewFromLegs,
  mapReturnGeometryFromLegs, resolvedLegs, routeDrawGrade, roadChainSig,
  type RoadChain,
} from '../src/lib/tripRoad'
import { clearRouteCacheForTests } from '../src/lib/routing'
import type { RoadLeg } from '../src/lib/routing'
import { getAssumptions } from '../src/lib/engine'
import { dayRoadSlices } from '../src/lib/mapStyles/routeTreatment'

const P = (lat: number, lng: number) => ({ lat, lng })

/** Source text of a file under src/, for the binding checks below. */
const readSrc = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** A minimal trip shape for the chain builder (only the picked fields matter). */
function tripOf(opts: {
  start?: { lat: number; lng: number } | null
  days?: { index: number; stops: { lat: number; lng: number; status?: string; orderInDay?: number }[] }[]
  destinationCoords?: { lat: number; lng: number }[]
  roundTrip?: boolean
  transportMode?: string
}) {
  return {
    startLocationCoords: opts.start ?? null,
    days: (opts.days ?? []).map(d => ({
      index: d.index,
      stops: d.stops.map((s, i) => ({
        lat: s.lat, lng: s.lng, status: s.status ?? 'confirmed', orderInDay: s.orderInDay ?? i,
      })),
    })),
    destinationCoords: opts.destinationCoords ?? [],
    roundTrip: opts.roundTrip ?? false,
    transportMode: opts.transportMode ?? 'car',
  } as never as Parameters<typeof buildRoadChain>[0]
}

/** The engine assumptions the measurement runs against (car, defaults). */
const ASSUMPTIONS = getAssumptions({ transportMode: 'car' } as never as Parameters<typeof getAssumptions>[0])

/** OSRM-shaped response (no Google key configured → the facade uses OSRM). */
function osrmResponse(km = 10) {
  return new Response(JSON.stringify({
    code: 'Ok',
    routes: [{ distance: km * 1000, duration: km * 60, geometry: { coordinates: [[77, 10], [77.1, 10.1]] } }],
  }), { status: 200 })
}

/** OSRM chain response for n waypoints, in the real shape. The road shape sits on the route; each leg carries its counts. */
function osrmChainResponse(waypointCount: number) {
  const coordinates: [number, number][] = []
  for (let i = 0; i < waypointCount; i++) coordinates.push([77 + i * 0.1, 10 + i * 0.1])
  const legs: { distance: number; duration: number; annotation: { distance: number[]; duration: number[] } }[] = []
  for (let i = 0; i < waypointCount - 1; i++) {
    legs.push({ distance: 10_000, duration: 600, annotation: { distance: [10_000], duration: [600] } })
  }
  const route = { distance: 10_000 * legs.length, duration: 600 * legs.length, geometry: { type: 'LineString', coordinates }, legs }
  return new Response(JSON.stringify({ code: 'Ok', routes: [route] }), { status: 200 })
}

function leg(km: number, min: number): RoadLeg {
  return { distanceKm: km, durationMinutes: min, source: 'osrm', geometry: [[77, 10], [77.1, 10.1]] }
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('buildRoadChain', () => {
  it('keeps point metadata aligned through sorting, rejection and the tail', () => {
    const trip = tripOf({ start: P(1, 2), days: [{ index: 2, stops: [{ lat: 3, lng: 4 }, { lat: 5, lng: 6, status: 'rejected' }] }], roundTrip: true, destinationCoords: [P(7, 8)] })
    trip.days[0].stops[0].id = 'stop-1'
    const chain = buildRoadChain(trip)
    // #1006: on a round trip the destination belongs to the OUTBOUND journey, so
    // it sits before the drive home, never after it.
    expect(chain.ptKind).toEqual(['start', 'stop', 'destination', 'return'])
    expect(chain.ptStopId).toEqual([null, 'stop-1', null, null])
    expect(chain.ptDay).toEqual([null, 2, null, null])
    expect(chain.points).toEqual([P(1, 2), P(3, 4), P(7, 8), P(1, 2)])
  })
  it('walks start → stops in day/order sequence and marks the outbound boundary', () => {
    const chain = buildRoadChain(tripOf({
      start: P(26.9, 75.8),
      days: [
        { index: 0, stops: [{ lat: 26.5, lng: 76.0 }] },
        { index: 1, stops: [{ lat: 25.5, lng: 77.0 }] },
      ],
    }))
    expect(chain.points.length).toBe(3)
    expect(chain.ptDay).toEqual([null, 0, 1])
    // no return leg on a one-way trip — the whole chain is outbound
    expect(chain.outboundCount).toBe(3)
  })

  it('sorts days and stops regardless of array order', () => {
    const chain = buildRoadChain(tripOf({
      start: P(26.9, 75.8),
      days: [
        { index: 1, stops: [{ lat: 25.5, lng: 77.0, orderInDay: 1 }, { lat: 25.6, lng: 77.1, orderInDay: 0 }] },
        { index: 0, stops: [{ lat: 26.5, lng: 76.0 }] },
      ],
    }))
    expect(chain.points[1]).toEqual(P(26.5, 76.0))
    expect(chain.points[2]).toEqual(P(25.6, 77.1))
    expect(chain.points[3]).toEqual(P(25.5, 77.0))
  })

  it('drops rejected stops', () => {
    const chain = buildRoadChain(tripOf({
      start: P(26.9, 75.8),
      days: [{ index: 0, stops: [{ lat: 26.5, lng: 76.0, status: 'rejected' }, { lat: 26.4, lng: 76.1 }] }],
    }))
    expect(chain.points.length).toBe(2)
  })

  it('appends the round-trip return-to-start BEYOND the outbound boundary', () => {
    const chain = buildRoadChain(tripOf({
      start: P(26.9, 75.8),
      days: [{ index: 0, stops: [{ lat: 26.5, lng: 76.0 }] }],
      roundTrip: true,
    }))
    // start, stop, back to start
    expect(chain.points.length).toBe(3)
    expect(chain.points[2]).toEqual(P(26.9, 75.8))
    // the outbound is start → stop only; the ride home is NOT part of the map view
    expect(chain.outboundCount).toBe(2)
  })

  it('appends a trailing destination only when it is not already the last point', () => {
    const withDest = buildRoadChain(tripOf({
      start: P(26.9, 75.8),
      days: [{ index: 0, stops: [{ lat: 26.5, lng: 76.0 }] }],
      destinationCoords: [P(25.0, 78.0)],
    }))
    expect(withDest.points.length).toBe(3)
    expect(withDest.points[2]).toEqual(P(25.0, 78.0))
    expect(withDest.hasDestTail).toBe(true)
    const alreadyLast = buildRoadChain(tripOf({
      start: P(26.9, 75.8),
      days: [{ index: 0, stops: [{ lat: 26.5, lng: 76.0 }] }],
      destinationCoords: [P(26.5, 76.0)],
    }))
    expect(alreadyLast.points.length).toBe(2)
    expect(alreadyLast.hasDestTail).toBe(false)
  })
})

describe('measureRoadChain — the one chain, one retry (#188 acceptance)', () => {
  // No Google key → the facade measures via OSRM alone, so the fetch count IS
  // the leg count (with a key, every leg tries Google Routes first).
  // #polylines: the facade now measures the whole chain as ONE OSRM request,
  // so "3 leg fetches" became "1 chain fetch" — the no-duplicate intent held.
  beforeEach(() => { vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', ''); clearRouteCacheForTests() })

  it('measures a 4-point chain as exactly ONE chain fetch (no duplicate legs)', async () => {
    const f = vi.fn(async () => osrmChainResponse(4))
    vi.stubGlobal('fetch', f)
    const out = await measureRoadChain([P(10, 77), P(10.1, 77.1), P(10.2, 77.2), P(10.3, 77.3)], ASSUMPTIONS)
    expect(out.ok).toBe(true)
    // 4 points = 3 legs = ONE OSRM chain request — not 3 fetches, not 6
    expect(f).toHaveBeenCalledTimes(1)
    expect(out.ok && out.legs.length === 3).toBe(true)
  })

  it('does NOT retry when the first measurement resolves real roads', async () => {
    const f = vi.fn(async () => osrmChainResponse(2))
    vi.stubGlobal('fetch', f)
    const sleep = vi.fn(async () => {})
    await measureRoadChain([P(10, 77), P(10.1, 77.1)], ASSUMPTIONS, { sleep })
    expect(sleep).not.toHaveBeenCalled()
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('treats an all-estimate chain as UNRESOLVED (a rate-limited OSRM must not pass as a road)', async () => {
    // every OSRM call 503s → routePath degrades to haversine chords internally
    const f = vi.fn(async () => new Response('down', { status: 503 }))
    vi.stubGlobal('fetch', f)
    const sleep = vi.fn(async () => {})
    const out = await measureRoadChain([P(10, 77), P(10.1, 77.1)], ASSUMPTIONS, { sleep, retryDelayMs: 0 })
    expect(out.ok).toBe(false)
    expect(sleep).toHaveBeenCalledTimes(1) // retried once, still chords
  })

  it('retries ONCE after a transient failure; the retry resolves the road', async () => {
    const sleep = vi.fn(async () => {})
    let calls = 0
    const measure = async () => {
      calls += 1
      if (calls === 1) return [{ distanceKm: 5, durationMinutes: 6, source: 'estimate' as const, geometry: [] }]
      return [leg(100, 120)]
    }
    const out = await measureRoadChain([P(10, 77), P(10.1, 77.1)], ASSUMPTIONS, { sleep, measure })
    expect(out.ok).toBe(true)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(calls).toBe(2)
  })

  it('gives up honestly after the retry — exactly two attempts, then ok:false', async () => {
    const measure = vi.fn(async () => [{ distanceKm: 5, durationMinutes: 6, source: 'estimate' as const, geometry: [] }])
    const sleep = vi.fn(async () => {})
    const out = await measureRoadChain([P(10, 77), P(10.1, 77.1)], ASSUMPTIONS, { sleep, measure, retryDelayMs: 0 })
    expect(out.ok).toBe(false)
    expect(measure).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  it('survives a measurement that throws (and still retries once)', async () => {
    const measure = vi.fn(async () => { throw new Error('boom') })
    const sleep = vi.fn(async () => {})
    const out = await measureRoadChain([P(10, 77), P(10.1, 77.1)], ASSUMPTIONS, { sleep, measure })
    expect(out.ok).toBe(false)
    expect(measure).toHaveBeenCalledTimes(2)
  })

  it('honours the configured retry delay', async () => {
    const sleep = vi.fn(async () => {})
    await measureRoadChain([P(10, 77), P(10.1, 77.1)], ASSUMPTIONS, {
      sleep, retryDelayMs: 1234,
      measure: async () => { throw new Error('boom') },
    })
    expect(sleep).toHaveBeenCalledWith(1234)
  })

  // ---- #325: the workspace path is abortable, like the day-filter path ----

  it('attempts exactly once when aborted mid-flight — no retry, no 2s sleep', async () => {
    const controller = new AbortController()
    const sleep = vi.fn(async () => {})
    const measure = vi.fn(async () => {
      // the user switched trips while the first OSRM chain was in flight
      controller.abort()
      return [{ distanceKm: 5, durationMinutes: 6, source: 'estimate' as const, geometry: [] }]
    })
    const out = await measureRoadChain([P(10, 77), P(10.1, 77.1)], ASSUMPTIONS, {
      sleep, measure, signal: controller.signal,
    })
    expect(out.ok).toBe(false)
    // An abort is "stop silently", not a transient failure that earns a retry:
    // the old code slept the full delay and refetched against a trip the user
    // had already left.
    expect(measure).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('stops at the network layer too — one fetch, not two (#325)', async () => {
    const controller = new AbortController()
    const f = vi.fn(async () => { controller.abort(); return new Response('down', { status: 503 }) })
    vi.stubGlobal('fetch', f)
    const sleep = vi.fn(async () => {})
    // 503 → routePath degrades to haversine internally → unresolved → the abort
    // check before the retry sleep is what stops the second request.
    const out = await measureRoadChain([P(10, 77), P(10.1, 77.1)], ASSUMPTIONS, {
      sleep, retryDelayMs: 0, signal: controller.signal,
    })
    expect(out.ok).toBe(false)
    expect(f).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('never starts a measurement whose signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const measure = vi.fn(async () => [leg(100, 120)])
    const out = await measureRoadChain([P(10, 77), P(10.1, 77.1)], ASSUMPTIONS, {
      measure, signal: controller.signal,
    })
    expect(out.ok).toBe(false)
    expect(measure).not.toHaveBeenCalled()
  })

  it('lets a road that already resolved win over a late abort — the caller drops it', async () => {
    // The division of labour the hook relies on: this layer stops the WORK, the
    // hook's `cancelled` flag is what discards a result nobody is waiting for.
    const controller = new AbortController()
    const measure = async () => { controller.abort(); return [leg(100, 120)] }
    const out = await measureRoadChain([P(10, 77), P(10.1, 77.1)], ASSUMPTIONS, {
      measure, signal: controller.signal,
    })
    expect(out.ok).toBe(true)
  })
})

describe('the wiring: one measurement site, no second caller (#188)', () => {
  // Source invariant, in the project's established shape (route-integrity /
  // mobile-shell): the map surface must not measure the road itself. Before
  // #188 the workspace and the Map tab each ran their own routePath chain over
  // the same points — doubling OSRM load (the shared demo server's rate limits
  // caused #185's transient failures) and letting the drawn line disagree with
  // the detour math. Nothing in tsc/tests/build caught it, so pin it here.
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

  it('the Map tab never calls routePath — it consumes the workspace measurement', () => {
    const mapTab = read('../src/pages/trip/MapTab.tsx')
    expect(mapTab).not.toMatch(/routePath\s*\(/)
    expect(mapTab).toMatch(/road:\s*TripRoadView/)
    expect(mapTab).toMatch(/mapRoadViewFromLegs\(/)
  })

  it('TripMap has no bare routePath caller — Board fallback goes through tripRoad', () => {
    const tripMap = read('../src/components/TripMap.tsx')
    expect(tripMap).not.toMatch(/routePath\s*\(/)
    expect(tripMap).toMatch(/measureDayRide\(/)
    expect(tripMap).toMatch(/allowSelfMeasurement/)
  })

  it('the workspace measures through tripRoad (not a private routePath chain)', () => {
    const workspace = read('../src/pages/TripWorkspace.tsx')
    expect(workspace).toMatch(/useTripRoad\(trip\)/)
    expect(workspace).toMatch(/measureRoadChain\(/)
    // the old per-workspace chain builder is gone from the component
    expect(workspace).not.toMatch(/routePath\s*\(/)
    expect(workspace).not.toMatch(/useTripCorrections/)
  })

  it('tripRoad.ts is the single owner of the whole-trip chain', () => {
    const tripRoad = read('../src/lib/tripRoad.ts')
    const calls = tripRoad.match(/routePath\(/g) ?? []
    // ONE shared default in `activeMeasure` serves both entry points, so the
    // file holds a single call site. A stray second one still fails this pin.
    expect(calls.length).toBe(1)
  })

  // The reported defect: a flight trip was measured as a ROAD. Google Routes has
  // no FLYING travelMode (the request errors) and OSRM's endpoint is hardcoded to
  // /driving/, so both answer with driving directions — which got drawn as the
  // map's line and read as the trip's travel time. Both measurement entry points
  // must refuse a mode the routing layer cannot describe.
  it('neither measurement path measures a mode the routing layer cannot describe', () => {
    const workspace = read('../src/pages/TripWorkspace.tsx')
    expect(workspace).toMatch(/isRoadMeasuredMode\(trip\.transportMode\)/)
    expect(workspace).toMatch(/measureRoadChain\(/)

    const tripMap = read('../src/components/TripMap.tsx')
    expect(tripMap).toMatch(/isAirMode\(trip\.transportMode\)/)
    // and the flight trip's line comes from the journey, never from a road
    const mapTab = read('../src/pages/trip/MapTab.tsx')
    expect(mapTab).toMatch(/tripJourneyGeometry\(/)
    expect(mapTab).toMatch(/airPlan\?\.geometry \?\? roadView\.geometry/)
  })

  it('the engine owns the road-vs-air split, not a page file', () => {
    const engine = read('../src/lib/engine.ts')
    expect(engine).toMatch(/export function tripJourneyGeometry\(/)
    expect(engine).toMatch(/export function journeyGeometry\(/)
    expect(engine).toMatch(/export function groundAssumptions\(/)
    // no page file may carry its own copy of the point-count rule
    for (const f of ['../src/pages/trip/MapTab.tsx', '../src/pages/trip/timeline/FlightsPanel.tsx']) {
      expect(read(f)).not.toMatch(/pts\.length >= 2/)
    }
  })

  it('the Board draws the journey on a flight trip, not a blank map', () => {
    const board = read('../src/components/BoardView.tsx')
    // the Board has no road chain to draw for a flight trip, so it takes the
    // same engine derivation the Map tab does
    expect(board).toMatch(/isAirMode\(trip\.transportMode\) \? tripJourneyGeometry\(/)
    expect(board).toMatch(/mainRouteGeometry=\{airGeometry \?\? roadView\.geometry\}/)
  })
})

describe('derivations from the one measurement', () => {    const chain: RoadChain = {
      points: [P(10, 77), P(10.1, 77.1), P(10.2, 77.2), P(10, 77)],
      ptDay: [null, 0, 1, null],
      outboundCount: 3, // start + 2 stops; the 4th point is the ride home
      hasDestTail: false,
    }

  it('derives the return geometry from the measured chain without a destination-tail false positive', () => {
    const returnLeg: RoadLeg = { ...leg(250, 300), geometry: [[77.2, 10.2], [77, 10]] }
    expect(mapReturnGeometryFromLegs(chain, [leg(100, 120), leg(150, 180), returnLeg])).toEqual(returnLeg.geometry)
    const oneWayTail = { ...chain, points: [P(10, 77), P(10.1, 77.1), P(11, 78)], outboundCount: 2, hasDestTail: true }
    expect(mapReturnGeometryFromLegs(oneWayTail, [leg(100, 120), leg(150, 180)])).toBeNull()
  })

  it('correctionsFromLegs keys both directions (the drive home retraces the road)', () => {
    const legs = [leg(100, 120), leg(150, 180), leg(250, 300)]
    const corr = correctionsFromLegs(chain, legs)
    const keys = Object.keys(corr)
    expect(keys.length).toBe(6) // 3 legs, each mirrored
    const anyKey = keys[0]
    expect(corr[anyKey].distanceKm).toBeGreaterThan(0)
  })

  it('the map view uses ONLY the outbound legs — a round trip never double-counts the journey', () => {
    const legs = [leg(100, 120), leg(150, 180), leg(250, 300)] // third leg is the ride home
    const view = mapRoadViewFromLegs(chain, legs, [0, 1])
    expect(view.totalKm).toBe(250) // 100 + 150, NOT + 250
    expect(view.totalMin).toBe(300)
    expect(view.dayRoadKm).toEqual([100, 150]) // attributed by arrival day
    expect(view.geometry?.length).toBe(4) // two legs × two points — the ride home is NOT drawn
  })

  it('a one-way DESTINATION tail is drawn (the line reaches the destination) without entering the totals', () => {
    // chain: start → stop0 → stop1 → destination tail (hasDestTail, not the ride home)
    const withTail: RoadChain = {
      points: [P(10, 77), P(10.1, 77.1), P(10.2, 77.2), P(9.5, 76.5)],
      ptDay: [null, 0, 1, null],
      outboundCount: 3,
      hasDestTail: true,
    }
    const legs = [leg(100, 120), leg(150, 180), leg(60, 70)] // third leg = destination tail
    const view = mapRoadViewFromLegs(withTail, legs, [0, 1])
    expect(view.totalKm).toBe(250) // tail km stay OUT of the plan totals
    expect(view.dayRoadKm).toEqual([100, 150])
    expect(view.geometry?.length).toBe(6) // all THREE legs drawn — the line reaches the destination
  })

  it('one-way trips keep every leg in the map view', () => {
    const oneWay: RoadChain = { points: [P(10, 77), P(10.1, 77.1), P(10.2, 77.2)], ptDay: [null, 0, 1], outboundCount: 3, hasDestTail: false }
    const view = mapRoadViewFromLegs(oneWay, [leg(100, 120), leg(150, 180)], [0, 1])
    expect(view.totalKm).toBe(250)
  })

  it('returns an empty view when there is nothing measured', () => {
    expect(mapRoadViewFromLegs(null, null, [0]).geometry).toBeNull()
    expect(mapRoadViewFromLegs(chain, [], [0]).totalKm).toBeNull()
    expect(mapRoadViewFromLegs(chain, null, [0]).dayRoadKm).toBeNull()
  })
})

// ============ Grading what is drawn (#370) ============
// The Board's mini-map drew a stops-only road while its numbers described the
// full chain, and when the measurement failed it painted straight chords with
// the same paint as a road. One shared rule now grades a line from the measured
// geometry it should have come from, and one shared rule decides whether a
// chain resolved at all.
describe('routeDrawGrade / resolvedLegs (#370)', () => {
  it('only real road geometry grades as measured', () => {
    expect(routeDrawGrade([[77, 10], [77.1, 10.1]])).toBe('measured')
    // no measurement (failed, or still pending) and a single point are both
    // honest guesses — the chord fallback must never wear road paint
    expect(routeDrawGrade(null)).toBe('rough')
    expect(routeDrawGrade(undefined)).toBe('rough')
    expect(routeDrawGrade([])).toBe('rough')
    expect(routeDrawGrade([[77, 10]])).toBe('rough')
  })

  it('an all-estimate chain is unresolved; one real leg makes it a road', () => {
    const chords = [leg(5, 6), leg(7, 8)].map(l => ({ ...l, source: 'estimate' as const }))
    expect(resolvedLegs(chords)).toBeNull()
    expect(resolvedLegs([chords[0], leg(100, 120)])).not.toBeNull()
    expect(resolvedLegs([])).toBeNull()
  })

  it('both measurement paths speak the one rule (no private copies)', () => {
    const tripRoad = readSrc('../src/lib/tripRoad.ts')
    const uses = tripRoad.match(/resolvedLegs\(/g) ?? []
    // the definition + measureDayRide + measureRoadChain
    expect(uses.length).toBe(3)
    // …and the rule itself lives in exactly one body (the two measurement
    // paths used to carry byte-identical private copies)
    const bodies = tripRoad.match(/legs\.some\(l => l\.source !== 'estimate'\)/g) ?? []
    expect(bodies.length).toBe(1)
  })
})

describe('the Board draws the workspace road, graded (#370)', () => {
  it('the Board renders the same two derivations the Map tab uses', () => {
    const board = readSrc('../src/components/BoardView.tsx')
    expect(board).toMatch(/mapRoadViewFromLegs\(road\?\.chain \?\? null, road\?\.legs \?\? null, trip\.days\.map\(d => d\.index\)\)/)
    expect(board).toMatch(/mapReturnGeometryFromLegs\(road\?\.chain \?\? null, road\?\.legs \?\? null\)/)
    expect(board).toMatch(/<MemoTripMap trip=\{trip\} focusDay=\{focusedDay\} showToolbar=\{false\}[\s\S]{0,120}mainRouteGeometry=\{airGeometry \?\? roadView\.geometry\} returnRouteGeometry=\{mapReturnGeometry\}[\s\S]{0,80}allowSelfMeasurement=\{false\}/)
    // #425 PR 2: the focused day is the shared axis, not board-owned state
    expect(board).toMatch(/const focusedDay = dayFocus \?\? localFocusDay/)
    // the board no longer measures a road of its own
    expect(board).not.toMatch(/routePath\s*\(/)
  })

  it('the workspace hands the board its one measurement', () => {
    const workspace = readSrc('../src/pages/TripWorkspace.tsx')
    expect(workspace).toMatch(/<BoardView trip=\{effective\}[\s\S]{0,220}road=\{road\}/)
  })

  it('the measurement outcome reaches the board, gated to driven trips', () => {
    const board = readSrc('../src/components/BoardView.tsx')
    expect(board).toMatch(/road\?\.status === 'failed'/)
    expect(board).toMatch(/isRoadMeasuredMode\(trip\.transportMode\)/)
    expect(board).toMatch(/Road: not measured/)
  })

  it('the map grades every line it draws and shares the chain signature', () => {
    const tripMap = readSrc('../src/components/TripMap.tsx')
    expect(tripMap).toMatch(/import \{[^}]*roadChainSig[^}]*routeDrawGrade[^}]*\} from '\.\.\/lib\/tripRoad'/)
    // ONE chain identity: the workspace's superset signature, not a private
    // stops-only hash ("same trip, two cache keys" was the bug)
    expect(tripMap).toMatch(/roadChainSig\(trip\)/)
    expect(tripMap).not.toMatch(/allPoints\.map\(p => `\$\{p\.lat\.toFixed\(5\)\}/)
    // all three drawn lines grade: main, the selected day, the drive home
    const grades = tripMap.match(/routeDrawGrade\(geom/g) ?? []
    expect(grades.length).toBe(3)
  })
})

// ============ A round trip draws no stray line home (#1006) ============
// The live trip: Siliguri → Chandigarh → Kaza → Chandra Taal, round trip, and a
// destination anchor that IS the last stop. The chain builder tested the
// destination against the ride-home point (Siliguri), not the last stop, so it
// added a Siliguri → Chandra Taal "tail" leg after the return. The map then
// joined the outbound line (ends at Chandra Taal) to that tail (starts at
// Siliguri): one ~1,200 km straight segment, painted in the last day's colour.
describe('round trip destination tail (#1006)', () => {
  const SILIGURI = P(26.7271012, 88.3952861)
  const CHANDIGARH = P(30.7333, 76.7794)
  const KAZA = P(32.2276, 78.0719)
  const CHANDRA_TAAL = P(32.4823581, 77.6156642)
  const MAX_SEGMENT_KM = 300

  const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const r = Math.PI / 180
    const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2
      + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2
    return 2 * 6371 * Math.asin(Math.sqrt(h))
  }
  /** A measured road leg: a dense polyline (a vertex every ~20 km), like OSRM's. */
  const roadLeg = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): RoadLeg => {
    const dist = km(a, b)
    const n = Math.max(2, Math.ceil(dist / 20))
    const geometry: [number, number][] = Array.from({ length: n + 1 }, (_, i) => [
      a.lng + ((b.lng - a.lng) * i) / n,
      a.lat + ((b.lat - a.lat) * i) / n,
    ])
    return { distanceKm: dist, durationMinutes: dist * 1.5, source: 'osrm', geometry }
  }
  const legsOf = (chain: { points: { lat: number; lng: number }[] }) =>
    chain.points.slice(1).map((p, i) => roadLeg(chain.points[i], p))
  /** Largest straight segment between two consecutive vertices, in km. */
  const maxSegment = (g: [number, number][] | null) => {
    let worst = 0
    for (let i = 1; g && i < g.length; i++) {
      worst = Math.max(worst, km({ lat: g[i - 1][1], lng: g[i - 1][0] }, { lat: g[i][1], lng: g[i][0] }))
    }
    return worst
  }

  const days = [
    { index: 0, stops: [CHANDIGARH] },
    { index: 1, stops: [KAZA] },
    { index: 2, stops: [CHANDRA_TAAL] },
  ]
  const liveTrip = () => tripOf({ start: SILIGURI, days, roundTrip: true, destinationCoords: [CHANDRA_TAAL] })

  it('(a) adds no tail when the last destination is the last stop', () => {
    const chain = buildRoadChain(liveTrip())
    expect(chain.hasDestTail).toBe(false)
    expect(chain.ptKind).toEqual(['start', 'stop', 'stop', 'stop', 'return'])
    expect(chain.points[chain.points.length - 1]).toEqual(SILIGURI)
    expect(chain.outboundCount).toBe(4)
  })

  it('(b) puts a destination with no stop BEFORE the ride home, and draws no jump', () => {
    const lake = P(32.9, 77.3)
    const chain = buildRoadChain(tripOf({ start: SILIGURI, days, roundTrip: true, destinationCoords: [lake] }))
    expect(chain.ptKind).toEqual(['start', 'stop', 'stop', 'stop', 'destination', 'return'])
    expect(chain.hasDestTail).toBe(false)
    expect(chain.outboundCount).toBe(5) // the destination is outbound; the return is the only point after it
    const legs = legsOf(chain)
    const view = mapRoadViewFromLegs(chain, legs, [0, 1, 2])
    expect(maxSegment(view.geometry)).toBeLessThan(MAX_SEGMENT_KM)
    // the line reaches the destination …
    expect(view.geometry?.[view.geometry.length - 1]).toEqual([lake.lng, lake.lat])
    // … and the ride home is its own line, starting at the destination
    const home = mapReturnGeometryFromLegs(chain, legs)
    expect(home?.[0]).toEqual([lake.lng, lake.lat])
    expect(home?.[home.length - 1]).toEqual([SILIGURI.lng, SILIGURI.lat])
    // per-day road km is untouched by the destination leg (it has no day)
    expect(view.dayRoadKm?.length).toBe(3)
  })

  it('(c) keeps the one-way destination tail as before', () => {
    const oneWay = buildRoadChain(tripOf({ start: SILIGURI, days, destinationCoords: [P(32.9, 77.3)] }))
    expect(oneWay.ptKind).toEqual(['start', 'stop', 'stop', 'stop', 'destination'])
    expect(oneWay.hasDestTail).toBe(true)
    expect(oneWay.outboundCount).toBe(4)
    const legs = legsOf(oneWay)
    const view = mapRoadViewFromLegs(oneWay, legs, [0, 1, 2])
    expect(view.geometry?.length).toBe(legs.flatMap(l => l.geometry).length) // all four legs drawn
    expect(view.totalKm).toBeCloseTo(legs.slice(0, 3).reduce((s, l) => s + l.distanceKm, 0)) // tail km stay out
    expect(mapReturnGeometryFromLegs(oneWay, legs)).toBeNull()
  })

  it('(d) never draws or slices a segment longer than 300 km (measured legs)', () => {
    const chain = buildRoadChain(liveTrip())
    const legs = legsOf(chain)
    const view = mapRoadViewFromLegs(chain, legs, [0, 1, 2])
    expect(maxSegment(view.geometry)).toBeLessThan(MAX_SEGMENT_KM)
    // the ride-home day: Chandra Taal → Siliguri, cut from the drawn road
    const slices = dayRoadSlices(view.geometry, { '3': [CHANDRA_TAAL, SILIGURI] }, 3)
    for (const s of slices) expect(maxSegment(s.coordinates)).toBeLessThan(MAX_SEGMENT_KM)
  })

  it('backstop: a tail that does not follow the outbound legs is never drawn', () => {
    // The pre-#1006 chain shape: start, stops, return, then a "tail" that
    // starts at home. Its geometry must not be flattened onto the outbound line.
    const stale: RoadChain = {
      points: [SILIGURI, CHANDIGARH, KAZA, CHANDRA_TAAL, SILIGURI, CHANDRA_TAAL],
      ptDay: [null, 0, 1, 2, null, null],
      outboundCount: 4,
      hasDestTail: true,
    }
    const view = mapRoadViewFromLegs(stale, legsOf(stale), [0, 1, 2])
    expect(maxSegment(view.geometry)).toBeLessThan(MAX_SEGMENT_KM)
    expect(view.geometry?.[view.geometry.length - 1]).toEqual([CHANDRA_TAAL.lng, CHANDRA_TAAL.lat])
    // the pre-fix flatten would end at the tail; the outbound line is exactly three legs
    expect(view.geometry?.length).toBe(legsOf(stale).slice(0, 3).flatMap(l => l.geometry).length)
  })

  it('backstop: a day slice with one long straight segment is refused, a short one is not', () => {
    const jump: [number, number][] = [[77.0, 10.0], [77.1, 10.0], [88.0, 26.0], [88.1, 26.0]]
    expect(dayRoadSlices(jump, { '1': [P(10, 77.0), P(26, 88.1)] }, 1)).toEqual([])
    const ok: [number, number][] = [[77.0, 10.0], [77.1, 10.0], [77.2, 10.0]]
    expect(dayRoadSlices(ok, { '1': [P(10, 77.0), P(10, 77.2)] }, 1).length).toBe(1)
    // a great-circle flight arc is allowed its long segments (the caller opts out)
    const arc: [number, number][] = [[77.0, 10.0], [88.0, 26.0]]
    expect(dayRoadSlices(arc, { '1': [P(10, 77.0), P(26, 88.0)] }, 1, Infinity).length).toBe(1)
  })
})
