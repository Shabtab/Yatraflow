// ============ Transport pricing: one basis before and after creation (#521) ============
// The create estimate used to bill rentPerDayInr and localTrain while persisted
// billing read neither, so the same trip priced differently across creation.
// resolveTransportPricing is the one module both paths speak; these pin the
// per-field decisions AND the same-fixture-through-both-paths parity.
import { describe, it, expect } from 'vitest'
import {
  resolveTransportPricing, getAssumptions, computeTotals, simulateDay, originOf,
  legBetween, lastActiveStopPoint, firstFixedPoint,
  MODE_COST_PER_KM, LOCAL_TRAIN_COST_PER_KM,
} from '../src/lib/engine'
import { estimateTripStarter } from '../src/lib/tripStarter'
import { seedData } from '../src/data/seed'
import type { LatLngPoint } from '../src/data/types'

const keralaTrip = seedData.trips[0]

describe('resolveTransportPricing', () => {
  it('carries a stated rental rate on top of the blended table', () => {
    const p = resolveTransportPricing({ transportMode: 'rental', rentPerDayInr: 2000 })
    expect(p.inrPerKm).toBe(MODE_COST_PER_KM.rental)
    expect(p.rentPerDayInr).toBe(2000)
    expect(p.localTrain).toBe(false)
  })
  it('rounds a fractional rental rate the way the estimate always has', () => {
    expect(resolveTransportPricing({ transportMode: 'rental', rentPerDayInr: 1999.6 }).rentPerDayInr).toBe(2000)
  })
  it('reads no rent without a rental mode — a stale value cannot leak', () => {
    expect(resolveTransportPricing({ transportMode: 'car', rentPerDayInr: 2000 }).rentPerDayInr).toBeUndefined()
    expect(resolveTransportPricing({ transportMode: 'taxi', rentPerDayInr: 2000 }).rentPerDayInr).toBeUndefined()
  })
  it('treats absent/garbage rent as no rent', () => {
    for (const rent of [undefined, 0, -50, NaN]) {
      expect(resolveTransportPricing({ transportMode: 'rental', rentPerDayInr: rent }).rentPerDayInr).toBeUndefined()
    }
    expect(resolveTransportPricing({ transportMode: 'rental' }).rentPerDayInr).toBeUndefined()
  })
  it('prices a suburban train trip at the local fare', () => {
    const p = resolveTransportPricing({ transportMode: 'train', localTrain: true })
    expect(p.inrPerKm).toBe(LOCAL_TRAIN_COST_PER_KM)
    expect(p.localTrain).toBe(true)
  })
  it('keeps the express rate without the flag', () => {
    const p = resolveTransportPricing({ transportMode: 'train' })
    expect(p.inrPerKm).toBe(MODE_COST_PER_KM.train)
    expect(p.localTrain).toBe(false)
  })
  it('ignores the suburban flag off train mode', () => {
    const p = resolveTransportPricing({ transportMode: 'car', localTrain: true })
    expect(p.inrPerKm).toBe(MODE_COST_PER_KM.car)
    expect(p.localTrain).toBe(false)
  })
  it('stacks rent on top of a stated fuel economy, like the estimate always has', () => {
    const p = resolveTransportPricing({ transportMode: 'rental', fuelEconomyKmL: 15, rentPerDayInr: 2000 })
    expect(p.kmPerLiter).toBe(15)
    expect(p.rentPerDayInr).toBe(2000)
  })
  it('reaches the assumptions both billing paths read', () => {
    const a = getAssumptions({ transportMode: 'rental', rentPerDayInr: 2000 })
    expect(a.rentPerDayInr).toBe(2000)
    expect(a.inrPerKm).toBe(MODE_COST_PER_KM.rental)
    const t = getAssumptions({ transportMode: 'train', localTrain: true })
    expect(t.inrPerKm).toBe(LOCAL_TRAIN_COST_PER_KM)
    expect(t.localTrain).toBe(true)
  })
})

describe('same fixture through both paths (#521)', () => {
  const KOCHI: LatLngPoint = { lat: 9.9312, lng: 76.2673 }
  const MUNNAR: LatLngPoint = { lat: 10.0889, lng: 77.0595 }

  it('a rental trip bills rent × days on top of km costs after creation', () => {
    const trip = { ...structuredClone(keralaTrip), transportMode: 'rental' as const, rentPerDayInr: 2000 }
    const t = computeTotals(trip)
    const A = getAssumptions(trip)
    let legsCost = 0
    trip.days.forEach(d => {
      const sim = simulateDay(d, trip, originOf(trip, d.index), d.index)
      sim.legs.forEach(l => { legsCost += l.distanceKm * (A.inrPerKm ?? 0) })
    })
    const turnaround = lastActiveStopPoint(trip)
    if (turnaround) legsCost += legBetween(turnaround, firstFixedPoint(trip), A).distanceKm * (A.inrPerKm ?? 0)
    const explicit = trip.expenses
      .filter(e => e.category === 'transport')
      .reduce((s, e) => s + (e.perPerson ? e.amountInr * trip.travellers : e.amountInr), 0)
    const dayCount = trip.days.length
    expect(t.byCategory['transport']).toBeCloseTo(legsCost + explicit + 2000 * dayCount, 4)
    // every itinerary day carries its rent-day (the return-home leg lands on
    // the last day's bucket on top, so this is a floor, not an equality —
    // the equality lives in the resolver + category assertions above)
    let bucketSum = 0
    for (const b of t.byDay) {
      const sim = simulateDay(
        trip.days.find(d => d.index === b.dayIndex)!, trip,
        originOf(trip, b.dayIndex), b.dayIndex,
      )
      let dayLegs = 0
      sim.legs.forEach(l => { dayLegs += l.distanceKm * (A.inrPerKm ?? 0) })
      expect(b.transportInr - dayLegs).toBeGreaterThanOrEqual(2000 - 1e-4)
      bucketSum += b.transportInr
    }
    // the per-day stacks plus the explicit transport lines sum to the trip
    // total (explicit expenses land in the category, never in a day bucket)
    expect(bucketSum + explicit).toBeCloseTo(t.byCategory['transport'], 4)
  })

  it('the create estimate stacks the identical rent term on the identical rate', () => {
    const bill = estimateTripStarter({
      startDate: '2026-09-12', endDate: '2026-09-18',
      travellers: 2, mode: 'rental',
      orderedPoints: [KOCHI, MUNNAR],
      returnCount: 0, roundTrip: false,
      stayStyle: 'comfort', rentPerDay: 2000,
    })
    // same rate the persisted bill resolves (blended rental, no economy stated)
    expect(bill.transportFormula).toContain(`× ₹${MODE_COST_PER_KM.rental}/km`)
    expect(bill.transportFormula).toContain('₹2000 × 7d rent')
    expect(bill.transportCost).toBe(Math.round(bill.roadKm! * MODE_COST_PER_KM.rental) + 2000 * 7)
  })

  it('a suburban train trip bills the local fare on both paths', () => {
    const trip = { ...structuredClone(keralaTrip), transportMode: 'train' as const, localTrain: true }
    expect(getAssumptions(trip).inrPerKm).toBe(LOCAL_TRAIN_COST_PER_KM)
    const bill = estimateTripStarter({
      startDate: '2026-09-12', endDate: '2026-09-18',
      travellers: 2, mode: 'train',
      orderedPoints: [KOCHI, MUNNAR],
      returnCount: 0, roundTrip: false,
      stayStyle: 'comfort', localTrain: true,
    })
    expect(bill.transportFormula).toContain('(local train)')
    expect(bill.transportCost).toBe(Math.round(bill.roadKm! * LOCAL_TRAIN_COST_PER_KM))
  })
})
