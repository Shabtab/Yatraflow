// ============ Impact preview honesty (#342) ============
// The sheet that guards every timeline edit: it must measure with the same
// road data the timeline renders, attribute an arrival to the stop it belongs
// to (not to whatever sits at that index afterwards), agree with the day pill
// about "busy", and not lose an opening-hours conflict to a NaN dwell.
import { describe, it, expect } from 'vitest'
import { computeImpact } from '../src/lib/impact'
import { simulateDay, originOf, legKey } from '../src/lib/engine'
import type { LegEstimate } from '../src/lib/engine'
import type { Trip, ItineraryStop } from '../src/data/types'

function stop(over: Partial<ItineraryStop> = {}): ItineraryStop {
  return {
    id: 's1', title: 'Stop', category: 'sightseeing', locationName: 'L',
    lat: 15.5, lng: 73.8, description: '', notes: '', visitMinutes: 60,
    openTime: '', closeTime: '', entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'nice-to-have', sourceUrl: '', status: 'confirmed', orderInDay: 1,
    ...over,
  } as ItineraryStop
}
function tripOf(days: unknown[], over: Partial<Trip> = {}): Trip {
  return {
    id: 't1', name: 'T', startLocation: 'Home',
    startLocationCoords: { lat: 15.4, lng: 73.7 },
    destinations: ['Base'], destinationCoords: [{ lat: 16.2, lng: 74.1 }],
    startDate: '2026-09-01', endDate: '2026-09-03', travellers: 2,
    transportMode: 'car', roundTrip: false, budgetPerPersonInr: 30000,
    travelStyle: 'balanced', fixedCommitments: [], days: days as Trip['days'],
    expenses: [], coverEmoji: '🚗', visibility: 'private', createdAt: 0, updatedAt: 0,
    ...over,
  }
}
const day = (index: number, stops: ItineraryStop[], over: Record<string, unknown> = {}) =>
  ({ id: `d${index}`, index, title: `Day ${index + 1}`, stops, ...over })

describe('the preview measures with the road data the timeline renders', () => {
  const before = tripOf([day(0, [stop({ id: 'a', title: 'Fort', visitMinutes: 60 })])])
  const after = tripOf([day(0, [
    stop({ id: 'a', title: 'Fort', visitMinutes: 60 }),
    stop({ id: 'b', title: 'Beach', lat: 15.7, lng: 74.0, visitMinutes: 60, orderInDay: 2 }),
  ])])
  const base = computeImpact(before, after, 'add', 0)
  // The measured road for exactly this leg — a ghat detour the chord hides.
  const corrections: Record<string, LegEstimate> = {
    [legKey(before.days[0].stops[0], after.days[0].stops[1])]: { distanceKm: 42, durationMinutes: 95 },
  }
  const road = computeImpact(before, after, 'add', 0, corrections)

  it('jumps when the road says the leg is longer than the chord', () => {
    expect(road.timeDeltaMin).toBeGreaterThan(base.timeDeltaMin)
    expect(road.distanceDeltaKm).toBeGreaterThan(base.distanceDeltaKm)
  })

  it('equals simulateDay’s own numbers — the same ones the timeline shows', () => {
    const simC = simulateDay(before.days[0], before, originOf(before, 0), 0, corrections)
    const simP = simulateDay(after.days[0], after, originOf(after, 0), 0, corrections)
    const surface = (simP.totalTravelMinutes + simP.dwellMinutes) - (simC.totalTravelMinutes + simC.dwellMinutes)
    expect(road.timeDeltaMin).toBeCloseTo(surface, 6)
  })

  it('still counts dwell time (drive + stops), the pinned behaviour', () => {
    // Two identical days except the added stop's dwell: the delta must carry it.
    const quick = tripOf([day(0, [stop({ id: 'a', visitMinutes: 60 }), stop({ id: 'b', lat: 15.7, lng: 74, visitMinutes: 10, orderInDay: 2 })])])
    const slow = tripOf([day(0, [stop({ id: 'a', visitMinutes: 60 }), stop({ id: 'b', lat: 15.7, lng: 74, visitMinutes: 70, orderInDay: 2 })])])
    const d = computeImpact(quick, slow, 'edit', 0)
    expect(d.timeDeltaMin).toBeCloseTo(60, 6)
  })
})

describe('arrival rows carry the right stop (identity, not index)', () => {
  const three = (order: string[]) => tripOf([day(0, order.map((id, i) => stop({
    id, title: { a: 'Fort', b: 'Beach', c: 'Temple' }[id]!,
    lat: 15.5 + i * 0.1, lng: 73.8 + i * 0.1, visitMinutes: 60, orderInDay: i + 1,
  })))])
  const before = three(['a', 'b', 'c'])
  const after = three(['c', 'a', 'b'])

  it('a pure reorder reports moved stops, never a misattributed title', () => {
    const res = computeImpact(before, after, 'reorder', 0)
    const simC = simulateDay(before.days[0], before, originOf(before, 0), 0)
    const simP = simulateDay(after.days[0], after, originOf(after, 0), 0)
    // What genuinely changed, keyed by id → the title it belongs to.
    const changed = new Map<string, string>()
    simP.activeStops.forEach((s, i) => {
      const cIdx = simC.activeStops.findIndex(c => c.id === s.id)
      if (cIdx >= 0 && simC.arrivalTimes[cIdx] !== simP.arrivalTimes[i]) changed.set(String(s.id), s.title)
    })
    expect(changed.size).toBeGreaterThan(0)
    expect(res.arrivalChanges).toHaveLength(changed.size)
    const titles = res.arrivalChanges.map(r => r.stopTitle).sort()
    expect(titles).toEqual([...changed.values()].sort())
    // Every row's "from" belongs to the same stop, not to its former neighbour.
    for (const row of res.arrivalChanges) {
      const beforeStop = simC.activeStops.find(s => s.title === row.stopTitle)!
      const beforeArr = simC.arrivalTimes[simC.activeStops.indexOf(beforeStop)]
      expect(row.from).toBe(beforeArr)
    }
  })

  it('an added stop shows as new, a removed one as gone', () => {
    const added = three(['a', 'b', 'c', 'd'])
    const onAdd = computeImpact(three(['a', 'b', 'c']), added, 'add', 0)
    expect(onAdd.arrivalChanges.some(r => r.from === '—')).toBe(true)
    const onRemove = computeImpact(three(['a', 'b', 'c']), three(['a', 'b']), 'remove', 0)
    expect(onRemove.arrivalChanges.some(r => r.to === '—')).toBe(true)
  })
})

describe('the sheet agrees with the pill', () => {
  const nStops = (n: number) => tripOf([day(0, Array.from({ length: n }, (_, i) =>
    stop({ id: `s${i}`, lat: 15.5 + i * 0.01, lng: 73.8 + i * 0.01, visitMinutes: 20, orderInDay: i + 1 })))])
  it('busy at six, same as the day pill’s n > 5 low state', () => {
    const six = computeImpact(nStops(5), nStops(6), 'add', 0)
    expect(six.tooBusy).toBe(true)
    const five = computeImpact(nStops(4), nStops(5), 'add', 0)
    expect(five.tooBusy).toBe(false)
  })
  it('reads the active stop count, not the stop array', () => {
    const withRejected = tripOf([day(0, [
      ...nStops(6).days[0].stops,
      stop({ id: 'x', title: 'Turned down', status: 'rejected', orderInDay: 7 }),
    ])])
    expect(computeImpact(nStops(6), withRejected, 'edit', 0).tooBusy).toBe(true)
  })
})

describe('opening hours survive a missing dwell', () => {
  it('a row with no visitMinutes still reports its conflict', () => {
    const bare = tripOf([day(0, [stop({
      id: 'a', title: 'Fort gate', openTime: '08:00', closeTime: '08:30',
      visitMinutes: undefined as never,
    })])])
    const res = computeImpact(tripOf([day(0, [])]), bare, 'add', 0)
    expect(res.openingHoursIssues).toHaveLength(1)
    expect(res.openingHoursIssues[0]).toContain('Fort gate')
  })
})

describe('cross-day honesty', () => {
  it('notes a moved wake-up point even when the next day is empty', () => {
    // Day 0 ends at the far stop; the proposal drops it, so day 1 wakes up
    // ~70 km earlier — an empty day's `endsAt` is its start time and never
    // moved, which is exactly how this used to slip through.
    const far = stop({ id: 'b', title: 'Beach', lat: 16.1, lng: 74.0, visitMinutes: 60, orderInDay: 2 })
    const before = tripOf([day(0, [stop({ id: 'a', title: 'Fort' }), far]), day(1, [])])
    const after = tripOf([day(0, [stop({ id: 'a', title: 'Fort' })]), day(1, [])])
    expect(computeImpact(before, after, 'remove', 0).crossDayNote).toBeTruthy()
    // A change with no cross-day effect stays quiet.
    const noop = tripOf([day(0, [stop({ id: 'a', title: 'Fort' })]), day(1, [])])
    expect(computeImpact(noop, noop, 'edit', 0).crossDayNote).toBeUndefined()
  })
})
