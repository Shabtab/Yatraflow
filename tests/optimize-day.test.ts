// ============ Day route optimization tests ============
// optimizeDayOrder is pure — nearest-neighbour + 2-opt over haversine with
// anchors pinned. Pinned behaviours: crisscross days collapse, anchors stay
// first/last, mid-day anchors are refused (never dropped), <3 movable is a
// no-op, rejected stops survive the reorder.
import { describe, it, expect } from 'vitest'
import { optimizeDayOrder, dayRouteKm } from '../src/lib/engine'
import type { ItineraryStop } from '../src/data/types'

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
    const res = optimizeDayOrder(origin, zigzag)
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
    const res = optimizeDayOrder(origin, day)
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

  it('open time breaks near-ties: the earlier-opening stop is picked first', () => {
    // two candidates equidistant from origin; one opens at 09:00, other 17:00
    const early = stop(10.000, 10.100, { openTime: '09:00', title: 'Early' })
    const late = stop(10.000, 10.1001, { openTime: '17:00', title: 'Late' }) // ~11m further — well inside the 800m near-tie
    const others = [stop(10.000, 10.200), stop(10.000, 10.300)] as ItineraryStop[]
    const day = [others[0], others[1], late, early] as ItineraryStop[]
    day.forEach((s, i) => { s.orderInDay = i + 1 })
    const res = optimizeDayOrder(origin, day)
    const first = res.stops[0]
    expect(first.id).toBe(early.id)
  })
})
