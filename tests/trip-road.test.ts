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

/** An OSRM CHAIN response for n waypoints (leg i carries its own geometry). */
function osrmChainResponse(waypointCount: number) {
  const legs = []
  for (let i = 0; i < waypointCount - 1; i++) {
    legs.push({
      distance: 10_000,
      duration: 600,
      geometry: { coordinates: [[77 + i * 0.1, 10 + i * 0.1], [77 + (i + 1) * 0.1, 10 + (i + 1) * 0.1]] },
    })
  }
  return new Response(JSON.stringify({ code: 'Ok', routes: [{ legs }] }), { status: 200 })
}

function leg(km: number, min: number): RoadLeg {
  return { distanceKm: km, durationMinutes: min, source: 'osrm', geometry: [[77, 10], [77.1, 10.1]] }
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('buildRoadChain', () => {
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
    expect(calls.length).toBe(2) // measureRoadChain + measureDayRide (the map's day line)
  })
})

describe('derivations from the one measurement', () => {    const chain: RoadChain = {
      points: [P(10, 77), P(10.1, 77.1), P(10.2, 77.2), P(10, 77)],
      ptDay: [null, 0, 1, null],
      outboundCount: 3, // start + 2 stops; the 4th point is the ride home
      hasDestTail: false,
    }

  it('derives the return geometry from the measured chain without a destination-tail false positive', () => {
    const returnLeg = { ...leg(250, 300), geometry: [[77.2, 10.2], [77, 10]] }
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
    expect(board).toMatch(/<MemoTripMap trip=\{trip\} focusDay=\{focusedDay\} showToolbar=\{false\}[\s\S]{0,120}mainRouteGeometry=\{roadView\.geometry\} returnRouteGeometry=\{mapReturnGeometry\}[\s\S]{0,80}allowSelfMeasurement=\{false\}/)
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
    expect(board).toMatch(/Road not measured/)
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
