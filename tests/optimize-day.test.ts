// ============ Day route optimization tests ============
// optimizeDayOrder is pure — nearest-neighbour + 2-opt over haversine with
// anchors pinned. Pinned behaviours: crisscross days collapse, anchors stay
// first/last, mid-day anchors are refused (never dropped), <3 movable is a
// no-op, rejected stops survive the reorder.
import { describe, it, expect } from 'vitest'
import { optimizeDayOrder, dayRouteKm, originOf, measuredLegCount, optimiseKmLabel, legKey } from '../src/lib/engine'
import type { ItineraryStop, Trip } from '../src/data/types'

let seq = 0
function stop(lat: number, lng: number, over: Partial<ItineraryStop> = {}): ItineraryStop {
  return {
    id: `s-${++seq}`, title: `Stop ${seq}`, category: 'sightseeing', locationName: `P${seq}`,
    lat, lng, description: '', notes: undefined,
    visitMinutes: 60, openTime: '', closeTime: '',
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'nice-to-have', sourceUrl: '', status: 'confirmed',
    orderInDay: seq, ...over,
  } as ItineraryStop
}

/** 1° lat ≈ 111 km; 1° lng at ~10°N ≈ 109 km — use small deltas for clean km math. */
describe('optimizeDayOrder', () => {
  const origin = { lat: 10.000, lng: 10.000 }

  it('collapses a crisscross ordering into a monotone sweep', () => {
    // Stops placed east-to-west but ordered west-east-...-zigzag: A(far) B(near) C(far) D(near)
    const far1 = stop(10.000, 10.300), near1 = stop(10.000, 10.100), far2 = stop(10.000, 10.250), near2 = stop(10.000, 10.150)
    const zigzag = [far1, near1, far2, near2] as ItineraryStop[]
    zigzag.forEach((s, i) => { s.orderInDay = i + 1 })
    // The last day of a trip: nothing derives from its tail, so the whole day
    // is the sweep's to reorder.
    const res = optimizeDayOrder(origin, zigzag, { hasNextDay: false })
    expect(res.changed).toBe(true)
    expect(res.afterKm).toBeLessThan(res.beforeKm)
    // the optimal sweep visits them in km order from the origin
    const kmOrder = [...zigzag].sort((a, b) =>
      Math.hypot(a.lng - origin.lng, a.lat - origin.lat) - Math.hypot(b.lng - origin.lng, b.lat - origin.lat))
    expect(res.stops.map(s => s.id)).toEqual(kmOrder.map(s => s.id))
    // orderInDay renumbered 1..n
    res.stops.forEach((s, i) => expect(s.orderInDay).toBe(i + 1))
  })

  it('a well-ordered day comes back unchanged (changed: false)', () => {
    const ordered = [
      stop(10.000, 10.100),
      stop(10.000, 10.200),
      stop(10.000, 10.300),
      stop(10.000, 10.400),
    ] as ItineraryStop[]
    ordered.forEach((s, i) => { s.orderInDay = i + 1 })
    const res = optimizeDayOrder(origin, ordered)
    expect(res.changed).toBe(false)
    expect(res.beforeKm).toBeCloseTo(res.afterKm, 6)
    expect(res.stops.map(s => s.id)).toEqual(ordered.map(s => s.id))
  })

  it('never writes into the input stops (purity contract)', () => {
    // The UI calls this in a render-phase memo with LIVE store stops — a
    // renumber in place would reorder the day on screen before any approval
    // and poison the impact preview's before-state. Regression for the exact
    // mutation shipped in the original optimise-day commit.
    const input = [
      stop(10.000, 10.300), // far — will move later in the sweep
      stop(10.000, 10.100), // near
      stop(10.000, 10.250),
    ] as ItineraryStop[]
    input.forEach((s, i) => { s.orderInDay = i + 1 })
    const before = input.map(s => ({ id: s.id, orderInDay: s.orderInDay }))
    const res = optimizeDayOrder(origin, input, { hasNextDay: false })
    expect(res.changed).toBe(true)
    expect(input.map(s => ({ id: s.id, orderInDay: s.orderInDay }))).toEqual(before)
  })

  it('pins auto anchors to the front and back, optimizes only the middle', () => {
    const anchor = stop(10.000, 10.000, { auto: true, title: 'Hotel' })
    const dest = stop(10.000, 10.500, { auto: true, title: 'Destination' })
    const a = stop(10.010, 10.300), b = stop(10.010, 10.150), c = stop(10.010, 10.400)
    const day = [anchor, a, b, c, dest] as ItineraryStop[]
    day.forEach((s, i) => { s.orderInDay = i + 1 })
    const res = optimizeDayOrder(origin, day)
    const ids = res.stops.map(s => s.id)
    expect(ids[0]).toBe(anchor.id)   // start anchor stays first
    expect(ids[ids.length - 1]).toBe(dest.id) // destination anchor stays last
    // all stops present, no losses
    expect(ids).toHaveLength(5)
    expect(new Set(ids).size).toBe(5)
  })

  it('a mid-day auto anchor is refused — nothing is dropped or reordered', () => {
    const a = stop(10.000, 10.100)
    const mid = stop(10.000, 10.300, { auto: true })
    const b = stop(10.000, 10.200), c = stop(10.000, 10.400), d = stop(10.000, 10.150)
    const day = [a, mid, b, c, d] as ItineraryStop[]
    day.forEach((s, i) => { s.orderInDay = i + 1 })
    const res = optimizeDayOrder(origin, day)
    expect(res.changed).toBe(false)
    expect(res.stops.map(s => s.id)).toEqual(day.map(s => s.id))
  })

  it('fewer than 3 movable stops is a no-op', () => {
    const day = [stop(10.000, 10.400), stop(10.000, 10.100)] as ItineraryStop[]
    day.forEach((s, i) => { s.orderInDay = i + 1 })
    const res = optimizeDayOrder(origin, day)
    expect(res.changed).toBe(false)
    expect(res.stops.map(s => s.id)).toEqual(day.map(s => s.id))
  })

  it('rejected stops survive the reorder, appended after the actives', () => {
    const rej = stop(10.000, 10.450, { status: 'rejected', title: 'Rejected' })
    const a = stop(10.000, 10.100), b = stop(10.000, 10.400), c = stop(10.000, 10.200)
    const day = [rej, a, b, c] as ItineraryStop[]
    day.forEach((s, i) => { s.orderInDay = i + 1 })
    const res = optimizeDayOrder(origin, day, { hasNextDay: false })
    expect(res.stops.map(s => s.id)).toContain(rej.id)
    const rejIdx = res.stops.findIndex(s => s.id === rej.id)
    // rejected ride at the end (engine skips them wherever they sit)
    expect(rejIdx).toBe(res.stops.length - 1)
  })

  it('never returns a route longer than the input ordering', () => {
    // random-ish scatter — the 2-opt sweep must never make things worse
    const pts = [
      [10.05, 10.02], [10.01, 10.08], [10.04, 10.06], [10.02, 10.03],
      [10.06, 10.05], [10.03, 10.07], [10.00, 10.05], [10.05, 10.00],
    ]
    const day = pts.map(([lat, lng]) => stop(lat, lng)) as ItineraryStop[]
    day.forEach((s, i) => { s.orderInDay = i + 1 })
    const res = optimizeDayOrder(origin, day)
    expect(res.afterKm).toBeLessThanOrEqual(res.beforeKm + 1e-9)
    expect(res.afterKm).toBeCloseTo(dayRouteKm(origin, res.stops.filter(s => s.status !== 'rejected')), 6)
  })

  it('keeps the night base at the tail when no stop is flagged auto', () => {
    // The shelf itineraries carry no `auto` stops, so this is the only thing
    // holding a stored night's base in place. Geometry puts the base mid-day
    // (it sits between Sight A at 10.100 and Sight B at 10.200).
    const a = stop(10.000, 10.100, { title: 'Sight A' })
    const b = stop(10.000, 10.200, { title: 'Sight B' })
    const c = stop(10.000, 10.300, { title: 'Sight C' })
    const base = stop(10.000, 10.150, { category: 'hotel', title: 'Night base' })
    const day = [c, a, b, base] as ItineraryStop[]
    day.forEach((s, i) => { s.orderInDay = i + 1 })
    const res = optimizeDayOrder(origin, day)
    expect(res.changed).toBe(true)
    expect(res.stops.map(s => s.id)).toEqual([a.id, b.id, c.id, base.id])
  })

  it('a sightseeing tail is free on the trip’s LAST day, where nothing derives from it', () => {
    const a = stop(10.000, 10.100, { title: 'Sight A' })
    const b = stop(10.000, 10.200, { title: 'Sight B' })
    const c = stop(10.000, 10.300, { title: 'Sight C' })
    const evening = stop(10.000, 10.150, { title: 'Evening stop' })
    const day = [c, a, b, evening] as ItineraryStop[]
    day.forEach((s, i) => { s.orderInDay = i + 1 })
    const res = optimizeDayOrder(origin, day, { hasNextDay: false })
    const ids = res.stops.map(s => s.id)
    expect(ids[ids.length - 1]).not.toBe(evening.id)
    expect(ids).toHaveLength(4)
  })

  it('pins ANY stored tail when a later day wakes up from it — not just a bed (#341)', () => {
    // The reported shape: a food-tailed evening ("dinner in Candolim") is what
    // `dayEndPosition` hands the next morning. Pinning only hotel/rest stops
    // let the optimiser move tomorrow's start point up to ~16 km.
    const dinner = stop(10.000, 10.150, { category: 'food', title: 'Dinner in Candolim' })
    const day1 = [
      stop(10.000, 10.300, { title: 'D1 far' }),
      stop(10.000, 10.100, { title: 'D1 near' }),
      stop(10.000, 10.200, { title: 'D1 mid' }),
      dinner,
    ] as ItineraryStop[]
    day1.forEach((s, i) => { s.orderInDay = i + 1 })
    const day2 = [stop(10.400, 10.400, { title: 'D2 somewhere' })] as ItineraryStop[]
    const trip = {
      id: 't1', name: 'T', startLocation: 'A', destinations: ['B'],
      startLocationCoords: { lat: 10, lng: 10 },
      startDate: '2026-09-01', endDate: '2026-09-02', travellers: 2,
      transportMode: 'car', budgetPerPersonInr: 10000, travelStyle: 'balanced',
      fixedCommitments: [], expenses: [], coverEmoji: '🚗', visibility: 'private',
      createdAt: 0, updatedAt: 0,
      days: [
        { index: 0, title: 'Day 1', stops: day1 },
        { index: 1, title: 'Day 2', stops: day2 },
      ],
    } as unknown as Trip
    const wakeUpBefore = originOf(trip, 1)
    const res = optimizeDayOrder(originOf(trip, 0), day1, { hasNextDay: true })
    const optimised = { ...trip, days: [{ ...trip.days[0], stops: res.stops }, trip.days[1]] } as Trip
    // The property the fix exists for, asserted directly: the optimiser may
    // tidy the day, it may NOT move where tomorrow starts.
    expect(originOf(optimised, 1)).toEqual(wakeUpBefore)
    expect(res.stops[res.stops.length - 1].id).toBe(dinner.id)
  })

  it('optimising a day does not move the next day\u2019s wake-up point', () => {
    // dayEndPosition returns a day's last stored stop and originOf walks forward
    // through it, so re-ordering the night's base rewrote where the next morning
    // started (on the shelf itineraries: 14 day-pairs, worst 16.3 km, with the
    // day then planning its drive from the evening's last sight).
    const base = stop(10.000, 10.150, { category: 'hotel', title: 'Night 1' })
    const day1 = [
      stop(10.000, 10.300, { title: 'D1 far' }),
      stop(10.000, 10.100, { title: 'D1 near' }),
      stop(10.000, 10.200, { title: 'D1 mid' }),
      base,
    ] as ItineraryStop[]
    day1.forEach((s, i) => { s.orderInDay = i + 1 })
    const day2 = [stop(10.400, 10.400, { title: 'D2 somewhere' })] as ItineraryStop[]
    day2.forEach((s, i) => { s.orderInDay = i + 1 })
    const trip = {
      id: 't1', name: 'T', startLocation: 'A', destinations: ['B'],
      startLocationCoords: { lat: 10, lng: 10 },
      startDate: '2026-09-01', endDate: '2026-09-02', travellers: 2,
      transportMode: 'car', budgetPerPersonInr: 10000, travelStyle: 'balanced',
      fixedCommitments: [], expenses: [], coverEmoji: '\ud83d\ude97', visibility: 'private',
      createdAt: 0, updatedAt: 0,
      days: [
        { index: 0, title: 'Day 1', stops: day1 },
        { index: 1, title: 'Day 2', stops: day2 },
      ],
    } as unknown as Trip

    const wakeUpBefore = originOf(trip, 1)
    const res = optimizeDayOrder(originOf(trip, 0), day1)
    expect(res.changed).toBe(true)
    const optimised = {
      ...trip,
      days: [{ ...trip.days[0], stops: res.stops }, trip.days[1]],
    } as Trip
    expect(originOf(optimised, 1)).toEqual(wakeUpBefore)
  })

  it('labels an unmeasured estimate as one (#341)', () => {
    // Nothing measured → the dialog must say the number is an estimate, not
    // print chord km as road km behind a scale factor of 1.
    expect(optimiseKmLabel(12.4, 1, 0)).toBe('~12 km (est.)')
    // Measured road → the number stands on its own.
    expect(optimiseKmLabel(12.4, 1.25, 3)).toBe('16 km')
    // The signal itself: how many of the day's legs carry a road estimate.
    const a = { lat: 10, lng: 10 }, b = { lat: 10.1, lng: 10.2 }, c = { lat: 10.2, lng: 10.4 }
    expect(measuredLegCount([a, b, c], undefined)).toBe(0)
    expect(measuredLegCount([a, b, c], {})).toBe(0)
    expect(measuredLegCount([a, b, c], { [legKey(a, b)]: { distanceKm: 20, durationMinutes: 40 } })).toBe(1)
    expect(measuredLegCount([a, b, c], {
      [legKey(a, b)]: { distanceKm: 20, durationMinutes: 40 },
      [legKey(b, c)]: { distanceKm: 18, durationMinutes: 36 },
    })).toBe(2)
  })

  it('open time breaks near-ties: the earlier-opening stop is picked first', () => {
    // two candidates equidistant from origin; one opens at 09:00, other 17:00
    const early = stop(10.000, 10.100, { openTime: '09:00', title: 'Early' })
    const late = stop(10.000, 10.1001, { openTime: '17:00', title: 'Late' }) // ~11m further — well inside the 800m near-tie
    const others = [stop(10.000, 10.200), stop(10.000, 10.300)] as ItineraryStop[]
    const day = [others[0], others[1], late, early] as ItineraryStop[]
    day.forEach((s, i) => { s.orderInDay = i + 1 })
    const res = optimizeDayOrder(origin, day, { hasNextDay: false })
    const first = res.stops[0]
    expect(first.id).toBe(early.id)
  })
})
