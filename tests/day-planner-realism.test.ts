// Day Planner realism batch — the enhancement issues that sharpened the
// engine after the bug-hunt. Each describe maps to one issue number; the
// expectations are derived from the engine's own honest math (blended
// 42 km/h car speed), same convention as dayPlanner.test.ts.
import { describe, expect, it } from 'vitest'
import {
  isSelfDrivenMode,
  planDriveDays,
  planTravelClock,
  rainFactorFor,
  wheelCapHoursFor,
} from '../src/lib/ridePlan'
import { planRide as planRideSegments } from './helpers/sharedDrivingPlan'
import { computeTotals } from '../src/lib/engine'
import { seedData } from '../src/data/seed'

/** Blended all-India car speed the engine itself assumes (MODE_SPEED.car). */
const CAR_KMH = 42
const driveMinFor = (km: number) => Math.round((km / CAR_KMH) * 60)

describe('#141 — confidence-weighted rain: probability × severity', () => {
  it('no forecast → factor 1; probability-only input reproduces the old arithmetic', () => {
    expect(rainFactorFor(null)).toBe(1)
    expect(rainFactorFor(undefined)).toBe(1)
    expect(rainFactorFor(NaN)).toBe(1)
    expect(rainFactorFor(0)).toBe(1)
    // undefined code → exactly the old 1 − pct/200 line
    expect(rainFactorFor(60)).toBeCloseTo(0.7, 6)
    expect(rainFactorFor(90)).toBeCloseTo(0.55, 6)
  })

  it('drizzle-class codes DAMP the chance; storm-class codes WEIGHT it up', () => {
    // 90% chance of drizzle (code 53) ≈ 0.66 — annoying, not day-ending.
    expect(rainFactorFor(90, 53)).toBeCloseTo(1 - 0.45 * 0.75, 6)
    // 90% chance of a thunderstorm (code 95) clamps to the floor.
    expect(rainFactorFor(90, 95)).toBe(0.5)
    // light rain (61) sits between drizzle and storm.
    expect(rainFactorFor(90, 61)).toBeCloseTo(1 - 0.45 * 0.9, 6)
  })

  it('both tails stay inside the clamp: no day is ever "faster in rain"', () => {
    expect(rainFactorFor(100, 51)).toBeGreaterThan(0.5)
    expect(rainFactorFor(100, 99)).toBe(0.5)
  })

  it('the same rain chance plans MORE drivable km when it is drizzle, fewer in a storm', () => {
    const base = { totalKm: 1400, driveMinutes: driveMinFor(1400) }
    const dry = planDriveDays(base)
    const drizzle = planDriveDays({ ...base, rainFactor: rainFactorFor(90, 53) })
    const storm = planDriveDays({ ...base, rainFactor: rainFactorFor(90, 95) })
    expect(dry!.driveDayCount).toBe(4)
    expect(drizzle!.driveDayCount).toBe(6)
    expect(storm!.driveDayCount).toBe(7)
  })

  it('planTravelClock walks the per-day codes: a storm day 1 covers less than a dry 350', () => {
    const base = { totalKm: 1400, driveMinutes: driveMinFor(1400), dayStart: '08:30' as const }
    const dry = planTravelClock({ ...base, travelStyle: 'balanced' })
    const storm = planTravelClock({ ...base, travelStyle: 'balanced', dayRainPct: [90, null], dayWeatherCode: [95, null] })
    expect(dry.verdict).toBe('ok')
    expect(storm.verdict).toBe('ok')
    expect(storm.days[0].kmCovered).toBeLessThan(dry.days[0].kmCovered)
    // a shrunk wet day 1 spills honestly into more days, never silence
    expect(storm.days.length).toBeGreaterThan(dry.days.length)
  })
})

describe('#126 — the wheel cap knows the mode; conducted modes are not "driven"', () => {
  it('motorcycle rides 1.5 h below the same style car cap', () => {
    expect(wheelCapHoursFor('balanced')).toBe(10)
    expect(wheelCapHoursFor('balanced', 'motorcycle')).toBe(8.5)
    expect(wheelCapHoursFor('packed', 'motorcycle')).toBe(9.5)
    expect(wheelCapHoursFor('relaxed', 'motorcycle')).toBe(7)
  })

  it('isSelfDrivenMode: crew-driven modes true, conducted modes false', () => {
    for (const m of ['car', 'rental', 'motorcycle', 'mixed']) expect(isSelfDrivenMode(m)).toBe(true)
    for (const m of ['train', 'bus', 'flight', 'taxi']) expect(isSelfDrivenMode(m)).toBe(false)
    // garbage falls closed (no split verdict) rather than open
    expect(isSelfDrivenMode(undefined)).toBe(false)
    expect(isSelfDrivenMode('hoverboard')).toBe(false)
  })

  it('the motorcycle cap flows through the split: shorter days than the same car trip', () => {
    const base = { totalKm: 2400, driveMinutes: driveMinFor(2400) }
    const car = planDriveDays({ ...base, transportMode: 'car' })
    const bike = planDriveDays({ ...base, transportMode: 'motorcycle' })
    // car: 600 min × 0.7 km/min = 420 km/day → 6 days; bike: 510 × 0.7 = 357 → 7
    expect(car!.driveDayCount).toBe(6)
    expect(bike!.driveDayCount).toBeGreaterThan(car!.driveDayCount)
  })
})

describe('#144 — the fuel tick just before a night halt folds into it', () => {
  // 700 km @ blended car speed → 2 × 350; the overnight sits at 350.
  // vehicleRangeKm 400 → fuelEvery = 340 → one tick 10 km BEFORE the halt.
  const foldCase = { totalKm: 700, driveMinutes: driveMinFor(700), includeFuel: true, multiDay: true, vehicleRangeKm: 400 }
  // vehicleRangeKm 240 → fuelEvery = 204 → ticks mid-day 1 (204) and day 2 (554).
  const keepCase = { ...foldCase, vehicleRangeKm: 240 }

  it('no fuel segment lands in the 110 km window before an overnight', () => {
    const segs = planRideSegments(foldCase)
    const halts = segs.filter(s => s.dayEnd)
    expect(halts.length).toBeGreaterThan(0)
    for (const h of halts) {
      const stragglers = segs.filter(s => s.purpose === 'fuel' && s.targetKm < h.targetKm && h.targetKm - s.targetKm < 110)
      expect(stragglers).toEqual([])
    }
  })

  it('the pre-halt straggler is GONE — nothing duplicates the halt evening', () => {
    const segs = planRideSegments(foldCase)
    const halts = segs.filter(s => s.dayEnd)
    // No FUEL tick sits as a separate stop just before a halt: it is folded
    // away (#144 / #144A). A mid-afternoon stretch or a slid lunch ~2 h out
    // is NOT a duplicate evening — it is a real stop the driver needs (the
    // km-only "nothing within 110 km" version of this test contradicted the
    // time-bounded #131a absorb from #189, where a 98 km = 2 h 20 m gap is
    // lunch, not dinner-at-the-halt).
    for (const h of halts) {
      const stragglers = segs.filter(s => !s.dayEnd && s.purpose === 'fuel' && s.targetKm < h.targetKm && h.targetKm - s.targetKm < 110)
      expect(stragglers).toEqual([])
    }
  })

  it('a mid-day fuel tick away from an overnight is untouched', () => {
    const segs = planRideSegments(keepCase)
    expect(segs.some(s => s.label.includes('Fuel'))).toBe(true)
  })

  it('meal + fuel still fold into ONE stop when the cadences collide (800 km, fuel 204/meal 300 → collide at ~700 in day 2)', () => {
    const segs = planRideSegments({ totalKm: 800, driveMinutes: driveMinFor(800), includeFuel: true, multiDay: true, vehicleRangeKm: 240 })
    const mealFuel = segs.find(s => s.label === 'Meal + fuel')
    expect(mealFuel).toBeDefined()
  })
})

describe('#146 — lodging identity keys on the provider place-id first', () => {
  const trip = () => {
    const t = structuredClone(seedData.trips[0])
    t.days.forEach(d => { d.stops = d.stops.filter(s => s.category !== 'hotel') })
    return t
  }
  const mk = (id: string, name: string, lat: number, lng: number, placeId?: string) => ({
    id, title: name, category: 'hotel', locationName: name, placeId,
    lat, lng, description: '', notes: '',
    visitMinutes: 600, openTime: '', closeTime: '', entryFeeInrPerPerson: 0,
    transportCostInrTotal: 0, priority: 'must-do', sourceUrl: '', status: 'suggested', orderInDay: 99,
  })

  it('same place-id, wildly different coords (provider pin fix) → ONE base', () => {
    const t = trip()
    const day = t.days[t.days.length - 1]
    const last = day.stops[day.stops.length - 1]
    day.stops.push(mk('h1', 'Hotel Taj', last.lat, last.lng, 'g-place-111') as never)
    day.stops.push(mk('h2', 'Taj Hotel (renamed)', last.lat + 3, last.lng + 3, 'g-place-111') as never)
    expect(computeTotals(t).lodgingNights).toBe(1)
  })

  it('different place-ids on the same coordinates → TWO bases', () => {
    const t = trip()
    const day = t.days[t.days.length - 1]
    const last = day.stops[day.stops.length - 1]
    day.stops.push(mk('h1', 'Hotel A', last.lat, last.lng, 'g-place-111') as never)
    day.stops.push(mk('h2', 'Hotel B', last.lat + 0.001, last.lng + 0.001, 'g-place-222') as never)
    expect(computeTotals(t).lodgingNights).toBe(2)
  })

  it('the cluster and name fallbacks survive: geocoded and hand-typed stops keep #125a', () => {
    const t = trip()
    const day = t.days[t.days.length - 1]
    const last = day.stops[day.stops.length - 1]
    // no place-id, same coords → cluster → ONE base
    day.stops.push(mk('h1', 'Hotel Taj', last.lat, last.lng) as never)
    day.stops.push(mk('h2', 'Hotel Taj, Mumbai', last.lat + 0.002, last.lng + 0.002) as never)
    expect(computeTotals(t).lodgingNights).toBe(1)
    // per-day stacks still sum to the trip total (v0.36 invariant)
    const totals = computeTotals(t)
    expect(totals.byDay.reduce((s, d) => s + d.totalInr, 0)).toBeCloseTo(totals.totalCostInr, 4)
  })
})
