// PLAN-DAY-PLANNER §14 fixtures — these ARE the spec for the travel clock.
// The 700 km narratives are the headline fixtures; every expectation below is
// derived from the engine's own honest math (blended 42 km/h for car), not
// from the brainstorm's rounded clock times.
import { describe, expect, it } from 'vitest'
import {
  DINNER_WINDOW,
  HALT_MIN,
  LUNCH_WINDOW,
  MIN_BREAK_GAP_KM,
  MIN_PLANNED_DRIVE_KM,
  NIGHT_END_MIN,
  clampRainFactor,
  isDriveDay,
  planDriveDays,
  planTravelClock,
  TEA_WINDOW,
  wheelCapHoursFor,
  wheelCapHoursForParty,
  resolveAnchors,
  rainFactorFor,
} from '../src/lib/ridePlan'
import { planRide as planRideSegments } from './helpers/sharedDrivingPlan'
import { computeTotals } from '../src/lib/engine'
import { STAY_RATE_PER_NIGHT } from '../src/lib/planBench'
import { seedData } from '../src/data/seed'

/** Blended all-India car speed the engine itself assumes (MODE_SPEED.car). */
const CAR_KMH = 42
const driveMinFor = (km: number) => Math.round((km / CAR_KMH) * 60)

describe('planDriveDays — the split (P1-A, §14 balance fixtures)', () => {
  it('700 km → 2 × 350, load-balanced, never 585 + 115', () => {
    const v = planDriveDays({ totalKm: 700, driveMinutes: driveMinFor(700) })
    expect(v).not.toBeNull()
    expect(v!.driveDayCount).toBe(2)
    expect(v!.perDay).toBeCloseTo(350, 0)
    expect(v!.nightHalts).toEqual([350])
  })

  it('1200 km → 3 × 400 (load-balanced)', () => {
    const v = planDriveDays({ totalKm: 1200, driveMinutes: driveMinFor(1200) })
    expect(v!.driveDayCount).toBe(3)
    expect(v!.perDay).toBeCloseTo(400, 0)
  })

  it('300 km → 1 drive day, no overnight proposed', () => {
    const v = planDriveDays({ totalKm: 300, driveMinutes: driveMinFor(300) })
    expect(v!.driveDayCount).toBe(1)
    expect(v!.nightHalts).toEqual([])
  })

  it('rain 60% on the wheel cap shifts the split', () => {
    // rainFactor = 1 − 60/200 = 0.7 → cap 7 h → dailyKmBudget ≈ 294 → 3 days
    const v = planDriveDays({ totalKm: 700, driveMinutes: driveMinFor(700), rainFactor: 0.7 })
    expect(v!.driveDayCount).toBe(3)
  })

  it('packed pushes 11 h, relaxed rests at 8.5 h', () => {
    const packed = planDriveDays({ totalKm: 900, driveMinutes: driveMinFor(900), travelStyle: 'packed' })
    const relaxed = planDriveDays({ totalKm: 900, driveMinutes: driveMinFor(900), travelStyle: 'relaxed' })
    expect(packed!.driveDayCount).toBeLessThan(relaxed!.driveDayCount)
  })
})

describe('planTravelClock — the 700 km headline fixtures', () => {
  const km = 700
  const min = driveMinFor(km)

  it('08:30 start: 2 × 350, lunch in window, halt before night end, dinner at the halt', () => {
    const v = planTravelClock({ totalKm: km, driveMinutes: min, dayStart: '08:30' })
    expect(v.verdict).toBe('ok')
    if (v.verdict !== 'ok') return
    expect(v.days).toHaveLength(2)
    const [d1, d2] = v.days
    expect(d1.nightHaltKm).toBeCloseTo(350, 0)
    // day-2 cadence resets: its lunch lands ~150 km INTO day 2, not 450 from origin
    const d2Lunch = d2.anchors.find(a => a.name === 'lunch')
    expect(d2Lunch).toBeDefined()
    if (d2Lunch) expect(d2Lunch.km).toBeLessThan(350 + 200)
    // day-1 lunch fires in the window
    const d1Lunch = d1.anchors.find(a => a.name === 'lunch')
    expect(d1Lunch).toBeDefined()
    if (d1Lunch) expect(d1Lunch.etaMin).toBeGreaterThanOrEqual(LUNCH_WINDOW[0] - 1)
    // no breakfast: an 08:30 start has eaten at home
    expect(d1.anchors.find(a => a.name === 'breakfast')).toBeUndefined()
    // the halt lands early enough for dinner at the halt, well before night end
    expect(d1.dinnerAtHalt).toBe(true)
    expect(d1.nightHaltEtaMin!).toBeLessThan(NIGHT_END_MIN - 120)
  })

  it('05:00 start: breakfast fires on the road, halt early, dinner at the halt', () => {
    const v = planTravelClock({ totalKm: km, driveMinutes: min, dayStart: '05:00' })
    expect(v.verdict).toBe('ok')
    if (v.verdict !== 'ok') return
    expect(v.days).toHaveLength(2)
    const d1 = v.days[0]
    const breakfast = d1.anchors.find(a => a.name === 'breakfast')
    expect(breakfast).toBeDefined()
    if (breakfast) {
      expect(breakfast.etaMin).toBeGreaterThanOrEqual(8 * 60)
      expect(breakfast.etaMin).toBeLessThanOrEqual(9 * 60 + 30)
    }
    // an early start buys slack and rest, not more km: the halt lands before tea
    expect(d1.nightHaltEtaMin!).toBeLessThan(TEA_WINDOW[1])
    expect(d1.dinnerAtHalt).toBe(true)
  })

  it('14:00 start: day 1 shrinks to a dinner halt, the remainder re-balances', () => {
    const v = planTravelClock({ totalKm: km, driveMinutes: min, dayStart: '14:00' })
    expect(v.verdict).toBe('ok')
    if (v.verdict !== 'ok') return
    const d1 = v.days[0]
    // dinner = the night halt on a late-start day 1
    expect(d1.nightHaltEtaMin!).toBeGreaterThanOrEqual(DINNER_WINDOW[0])
    expect(d1.nightHaltEtaMin!).toBeLessThanOrEqual(DINNER_WINDOW[1])
    expect(d1.dinnerAtHalt).toBe(true)
    // the shrunk remainder never overloads a later day beyond the cap budget
    for (const d of v.days.slice(1)) {
      expect((d.kmCovered - d.startKm) / (km / min)).toBeLessThanOrEqual(10 * 60 + 1)
    }
  })

  it('300 km: 1 drive day, no overnight, arrival inside the waking span', () => {
    const v = planTravelClock({ totalKm: 300, driveMinutes: driveMinFor(300), dayStart: '08:30' })
    expect(v.verdict).toBe('ok')
    if (v.verdict !== 'ok') return
    expect(v.days).toHaveLength(1)
    expect(v.days[0].nightHaltKm).toBeNull()
    expect(v.split?.driveDayCount ?? 1).toBe(1)
  })

  it('22:00 start: defer proposal, no plan produced', () => {
    const v = planTravelClock({ totalKm: 700, driveMinutes: min, dayStart: '22:00' })
    expect(v.verdict).toBe('defer')
  })

  it('corrupt startTime never becomes midnight: "25:99" clamps to 23:59 → defer (#136)', () => {
    // hmToMinutes clamps 25:99 → 23:59 (1439), leaving zero honest wheel time
    // before NIGHT_END — a defer verdict, never a silent midnight start that
    // would flip to some other branch.
    const v = planTravelClock({ totalKm: 300, driveMinutes: driveMinFor(300), dayStart: '25:99' })
    expect(v.verdict).toBe('defer')
  })

  it('18:00 start: short hop to a night halt, dinner inside the window', () => {
    const v = planTravelClock({ totalKm: 700, driveMinutes: min, dayStart: '18:00' })
    expect(v.verdict).toBe('hop')
    if (v.verdict !== 'hop') return
    expect(v.hopKm).toBeGreaterThan(0)
    expect(v.nightHaltEtaMin).toBeGreaterThanOrEqual(DINNER_WINDOW[0])
    expect(v.nightHaltEtaMin).toBeLessThanOrEqual(NIGHT_END_MIN - 60)
  })

  it('a long drive walks ALL its days — the per-day budget is km covered, not the halt position', () => {
    // Regression (clock-map-zones): the re-balance loop used to subtract the
    // ABSOLUTE halt position from `remaining`, so on a ~3,300 km route (a
    // Kolkata→Delhi round trip) the walk truncated at ~4 days and the map
    // overlay painted half the journey.
    const v = planTravelClock({ totalKm: 3300, driveMinutes: driveMinFor(3300), dayStart: '08:30' })
    expect(v.verdict).toBe('ok')
    if (v.verdict !== 'ok') return
    const last = v.days[v.days.length - 1]
    expect(last.nightHaltKm).toBeNull()          // it really reached the end…
    expect(last.kmCovered).toBeCloseTo(3300, 0)  // …and the walk covers the whole route
    expect(v.days.length).toBeGreaterThanOrEqual(v.split?.driveDayCount ?? 1)
    for (let i = 1; i < v.days.length; i++)      // halts chain strictly, no day skips km
      expect(v.days[i].startKm).toBe(v.days[i - 1].kmCovered)
  })
})

describe('planRideSegments — the short-trip silence fix', () => {
  it('80 km of 3 h ghat crawl earns its stretch by the clock (the 2 h rule owns it)', () => {
    const segs = planRideSegments({ totalKm: 80, driveMinutes: 180, multiDay: false })
    expect(segs.length).toBeGreaterThan(0)
    expect(segs.some(s => s.purpose === 'stretch')).toBe(true)
  })

  it('a genuinely short hop stays silent', () => {
    expect(planRideSegments({ totalKm: 40, driveMinutes: 45 })).toEqual([])
  })

  it('the destination exclusion zone scales down for short journeys', () => {
    const segs = planRideSegments({ totalKm: 120, driveMinutes: driveMinFor(120) })
    for (const s of segs) expect(s.maxKm).toBeLessThanOrEqual(120 - Math.min(60, 120 * 0.15) + 0.5)
    expect(MIN_PLANNED_DRIVE_KM).toBe(90)
  })
})

describe('halt durations (named constants, PLAN-DAY-PLANNER §5)', () => {
  it('dinner is a 60-min anchor that ends the day; tea is 20', () => {
    expect(HALT_MIN.dinner).toBe(60)
    expect(HALT_MIN.tea).toBe(20)
    expect(HALT_MIN.stretch).toBe(15)
  })
})

describe('P1-E — the structural-night bill line', () => {
  it('an accepted night halt prices the stay: bases × rooms × rate, per-day stacks still sum', () => {
    const trip = structuredClone(seedData.trips[0])
    // strip any pre-existing lodging so the delta is exactly this halt
    trip.days.forEach(d => { d.stops = d.stops.filter(s => s.category !== 'hotel') })
    const before = computeTotals(structuredClone(trip))
    // park the halt on the trip's final stop coords so the journey legs (and
    // the transport line) barely move — the delta is the stay, not the road
    const lastStop = [...trip.days[trip.days.length - 1].stops].slice(-1)[0]
    trip.days[trip.days.length - 1].stops.push({
      id: 'halt_test', title: 'Night halt', category: 'hotel', locationName: 'Una Test Base',
      lat: lastStop.lat, lng: lastStop.lng, description: '', notes: 'Added from the ride plan',
      visitMinutes: 600, openTime: '', closeTime: '', entryFeeInrPerPerson: 0,
      transportCostInrTotal: 0, priority: 'must-do', sourceUrl: '', status: 'suggested', orderInDay: 99,
    } as never)
    const after = computeTotals(structuredClone(trip))
    expect(after.lodgingNights).toBe(before.lodgingNights + 1)
    expect(after.lodgingInr).toBe(after.lodgingNights * after.lodgingRooms * after.lodgingRatePerNight)
    // the trip got dearer by at least the stay line (leg wiggle can add a few
    // rupees of transport, never remove the lodging line)
    expect(after.totalCostInr).toBeGreaterThan(before.totalCostInr + after.lodgingInr - 1)
    const byDaySum = after.byDay.reduce((s, d) => s + d.totalInr, 0)
    expect(byDaySum).toBeCloseTo(after.totalCostInr, 4)
  })

  it('lodging identity is the place, not the name string (#125a)', () => {
    const trip = structuredClone(seedData.trips[0])
    trip.days.forEach(d => { d.stops = d.stops.filter(s => s.category !== 'hotel') })
    const last = [...trip.days[trip.days.length - 1].stops].slice(-1)[0]
    const mk = (id: string, name: string, lat: number, lng: number) => ({
      id, title: name, category: 'hotel', locationName: name,
      lat, lng, description: '', notes: '',
      visitMinutes: 600, openTime: '', closeTime: '', entryFeeInrPerPerson: 0,
      transportCostInrTotal: 0, priority: 'must-do', sourceUrl: '', status: 'suggested', orderInDay: 99,
    })
    const day = trip.days[trip.days.length - 1]
    // Same property, name variant + a ~200 m pin difference → ONE base.
    day.stops.push(mk('h1', 'Hotel Taj', last.lat, last.lng) as never)
    day.stops.push(mk('h2', 'Hotel Taj, Mumbai', last.lat + 0.002, last.lng + 0.002) as never)
    expect(computeTotals(trip).lodgingNights).toBe(1)
    // Same chain name, different city (far coords) → TWO bases.
    day.stops.push(mk('h3', 'Hotel Taj', last.lat + 3, last.lng + 3) as never)
    expect(computeTotals(trip).lodgingNights).toBe(2)
    // The per-day stacks still sum to the trip total (v0.36 invariant survives).
    const t = computeTotals(trip)
    expect(t.byDay.reduce((s, d) => s + d.totalInr, 0)).toBeCloseTo(t.totalCostInr, 4)
  })
})

describe('bug-hunt batch (issues #125-#140) — engine invariants', () => {
  it('style match is case/space-tolerant: "Packed " → 11 h cap (#132)', () => {
    expect(wheelCapHoursFor('Packed ')).toBe(11)
    expect(wheelCapHoursFor('RELAXED')).toBe(8.5)
    expect(wheelCapHoursFor('balanced')).toBe(10)
  })

  it('rain clamp is shared: >1 → 1, <0.5 → 0.5, NaN/undefined → 1 (#132)', () => {
    expect(clampRainFactor(1.4)).toBe(1)
    expect(clampRainFactor(0.2)).toBe(0.5)
    expect(clampRainFactor(NaN)).toBe(1)
    expect(clampRainFactor(undefined)).toBe(1)
    expect(clampRainFactor(0.7)).toBeCloseTo(0.7, 6)
  })

  it('isDriveDay is ONE floor for the planner and the timeline header (#134)', () => {
    expect(isDriveDay(80, 180)).toBe(true)   // ghat crawl earns DRIVE
    expect(isDriveDay(95, 10)).toBe(true)    // short highway hop
    expect(isDriveDay(80, 60)).toBe(false)   // neither floor crossed
    // and the planRideSegments silence guard obeys the same predicate
    expect(planRideSegments({ totalKm: 80, driveMinutes: 180, multiDay: false }).length).toBeGreaterThan(0)
    expect(planRideSegments({ totalKm: 40, driveMinutes: 45, multiDay: false })).toHaveLength(0)
  })

  it('per-day rain caps its own day only — the walk stays honest (#127)', () => {
    const dry = planTravelClock({ totalKm: 700, driveMinutes: 1000, dayStart: '08:30' })
    // day 2 gets the cloudburst (90% → 0.55 cap): its cap shrinks, so the
    // remainder spills into a third day — day 1's plan is untouched.
    const wet2 = planTravelClock({ totalKm: 700, driveMinutes: 1000, dayStart: '08:30', dayRainPct: [0, 90] })
    expect(dry.verdict).toBe('ok')
    expect(wet2.verdict).toBe('ok')
    if (dry.verdict !== 'ok' || wet2.verdict !== 'ok') return
    expect(dry.days.length).toBe(2)
    expect(wet2.days.length).toBeGreaterThanOrEqual(3)
    // day-1 halt identical: day-1 rain is what moved, not day 2's
    expect(wet2.days[0].nightHaltKm).toBe(dry.days[0].nightHaltKm)
    // and a scalar rainFactor still behaves as before (day-1 cap everywhere)
    const scalar = planTravelClock({ totalKm: 700, driveMinutes: 1000, dayStart: '08:30', rainFactor: 0.55 })
    if (scalar.verdict === 'ok') expect(scalar.days.length).toBeGreaterThanOrEqual(3)
  })

  it('final-day arrival is clock-checked, never silently after NIGHT_END (#138)', () => {
    // 300 km from 16:00 at 0.7 km/min: tea + 400 min of wheel land well past
    // 23:00. The walk says ok (it is drivable) but FLAGS the late arrival.
    const v = planTravelClock({ totalKm: 300, driveMinutes: 430, dayStart: '16:00' })
    expect(v.verdict).toBe('ok')
    if (v.verdict !== 'ok') return
    const last = v.days[v.days.length - 1]
    expect(last.arrivalEtaMin).not.toBeNull()
    expect(last.lateArrival).toBe(true)
    expect(last.arrivalEtaMin!).toBeGreaterThan(NIGHT_END_MIN)
    expect(last.dwellMin).toBeGreaterThanOrEqual(HALT_MIN.tea) // tea spent dwell
    // an 08:30 same-distance day arrives clean and un-flagged
    const okDay = planTravelClock({ totalKm: 300, driveMinutes: 430, dayStart: '08:30' })
    if (okDay.verdict === 'ok') {
      const l = okDay.days[okDay.days.length - 1]
      expect(l.arrivalEtaMin).not.toBeNull()
      expect(l.lateArrival).toBe(false)
    }
  })

  it('no night halt ever lands inside the ENDNO exclusion (#140)', () => {
    for (const start of ['08:30', '14:00', '16:30', '05:00']) {
      const v = planTravelClock({ totalKm: 620, driveMinutes: 900, dayStart: start })
      if (v.verdict !== 'ok') continue
      const split = v.split
      if (!split) continue
      const capKm = 620 - Math.min(60, split.perDay * 0.15)
      for (const d of v.days) {
        if (d.nightHaltKm != null) {
          expect(d.nightHaltKm).toBeLessThanOrEqual(capKm + 0.5)
        }
      }
    }
  })

  it('the segment plan absorbs a halt-adjacent meal and keeps every dwell-spaced ETA honest (#129/#131)', () => {
    const segs = planRideSegments({ totalKm: 900, driveMinutes: 1300, multiDay: true, dayStartTimes: ['08:30', '08:30'] })
    expect(segs.length).toBeGreaterThan(2)
    // #129, direct: on a single-day 700 km plan the meal (a high-priority
    // fold target) must spend the dwell of the stretch that came before it —
    // eta(meal) − pure-wheel eta ≥ the earlier stretch halt, never less.
    const day = planRideSegments({ totalKm: 700, driveMinutes: 1000, multiDay: false })
    const meal = day.find(s => s.purpose === 'meal')
    const stretchBefore = day.find(s => s.purpose === 'stretch' && s.targetKm < (meal?.targetKm ?? Infinity))
    expect(meal).toBeDefined()
    expect(stretchBefore).toBeDefined()
    const wheelOnly = 510 + meal!.targetKm * (1000 / 700) // 08:30 start + proportional wheel
    expect(meal!.etaMinutes! - wheelOnly).toBeGreaterThanOrEqual(HALT_MIN.stretch - 2)
    // and dwell is monotone along the day: a later halt's ETA excess can only
    // grow, never shrink (the early-day drop this fixture guards against).
    const after = day.filter(s => s.targetKm > meal!.targetKm && s.etaMinutes != null)
    for (const s of after) {
      expect(s.etaMinutes! - (510 + s.targetKm * (1000 / 700))).toBeGreaterThanOrEqual(HALT_MIN.stretch + HALT_MIN.meal - 2)
    }
    // #131a, time-bounded: no NON-overnight segment sits within ~1 h of wheel
    // time of the overnight that follows it — the halt absorbed it instead.
    // (The old km-only bound ate the slid lunch on EVERY load-balanced day:
    // it sits at the 14:30 window edge, ~98 km = 2 h 20 m before the halt.)
    const kmPerMin = 900 / 1300
    for (let i = 0; i < segs.length - 1; i++) {
      if (!segs[i].dayEnd && segs[i + 1].dayEnd) {
        expect((segs[i + 1].targetKm - segs[i].targetKm) / kmPerMin).toBeGreaterThanOrEqual(59)
      }
    }
  })

  it('a load-balanced 4-day corridor keeps its meals and fuel stops (#187 follow-up)', () => {
    // 1,402 km at the blended 42 km/h: 4 × 350 km days. Live-verified
    // 2026-09-14: the km-bounded overnight absorb ate the slid lunch on EVERY
    // day (98 km = 2 h 20 m before each halt), and the per-day-reset fuel
    // cadence (382.5 km) could never land inside a 350 km day — the whole
    // plan grew ZERO meal and ZERO fuel segments.
    const segs = planRideSegments({
      totalKm: 1402,
      driveMinutes: (1402 / 42) * 60,
      includeFuel: true,
      multiDay: true,
      vehicleRangeKm: 450,
      travelStyle: 'balanced',
      travellers: 2,
      dayStartTimes: ['08:30', '08:30', '08:30', '08:30'],
      dayRainPct: [null, null, null, null],
    })
    expect(segs.filter(s => s.purpose === 'meal').length).toBeGreaterThanOrEqual(3) // one per full driving day
    expect(segs.filter(s => s.purpose === 'fuel').length).toBeGreaterThanOrEqual(2) // 1,402 km / 382.5 km stride
    // refuel opportunities never leave the tank stranded: a refuel happens at
    // a dedicated fuel segment OR at a halt town (the #144A fold moves a fuel
    // tick that lands near a night halt INTO that halt — "Overnight + fuel" —
    // so the halt's own km counts as a refuel point), and every consecutive
    // pair of opportunities stays within the tank range.
    const refuelKms = [
      0,
      ...segs.filter(s => s.purpose === 'fuel' || s.purpose === 'overnight').map(s => s.targetKm),
      1402,
    ].sort((a, b) => a - b)
    for (let i = 1; i < refuelKms.length; i++) {
      expect(refuelKms[i] - refuelKms[i - 1]).toBeLessThanOrEqual(450)
    }
  })

  it('the trip bill and the bench price a room from ONE table (#125b)', () => {
    const trip = structuredClone(seedData.trips[0])
    trip.days.forEach(d => { d.stops = d.stops.filter(s => s.category !== 'hotel') })
    trip.days[0].stops.push({
      id: 'hotel_rate_check', title: 'Test Stay', category: 'hotel', locationName: 'Rate Base',
      lat: 9.93, lng: 76.26, description: '', notes: '',
      visitMinutes: 600, openTime: '', closeTime: '', entryFeeInrPerPerson: 0,
      transportCostInrTotal: 0, priority: 'must-do', sourceUrl: '', status: 'suggested', orderInDay: 1,
    } as never)
    const totals = computeTotals(trip)
    expect(totals.lodgingRatePerNight).toBe(STAY_RATE_PER_NIGHT.comfort)
  })

  // #213 Phase 4 — `stay_style` has no CHECK constraint (deliberately: the
  // vocabulary lives in src/data/types.ts). A stray value used to index
  // STAY_RATE_PER_NIGHT to undefined, so the whole lodging line went NaN and
  // the trip's total with it. The key is now validated.
  it('an unrecognised stay_style falls back to comfort instead of NaNing the bill', () => {
    const withStay = (stay: unknown) => {
      const trip = structuredClone(seedData.trips[0])
      trip.days.forEach(d => { d.stops = d.stops.filter(s => s.category !== 'hotel') })
      trip.days[0].stops.push({
        id: 'hotel_junk', title: 'Test Stay', category: 'hotel', locationName: 'Junk Base',
        lat: 9.93, lng: 76.26, description: '', notes: '',
        visitMinutes: 600, openTime: '', closeTime: '', entryFeeInrPerPerson: 0,
        transportCostInrTotal: 0, priority: 'must-do', sourceUrl: '', status: 'suggested', orderInDay: 1,
      } as never)
      trip.stayStyle = stay as never
      return computeTotals(trip)
    }
    // sanity: the valid tiers price from the table
    expect(withStay('luxury').lodgingRatePerNight).toBe(STAY_RATE_PER_NIGHT.luxury)
    expect(withStay('budget').lodgingRatePerNight).toBe(STAY_RATE_PER_NIGHT.budget)
    // junk values (wrong case, a retired name, a number) → comfort, never NaN
    for (const junk of ['Luxury', 'premium', '', 42, null, undefined]) {
      const t = withStay(junk)
      expect(t.lodgingRatePerNight).toBe(STAY_RATE_PER_NIGHT.comfort)
      expect(Number.isFinite(t.lodgingInr)).toBe(true)
      expect(Number.isFinite(t.totalCostInr)).toBe(true)
    }
  })

  it('the legacy travelStyle still prices the bed for a trip with no stay dial', () => {
    // Stored trips predate the dial; the fallback must keep working (and must
    // NOT be reached once the trip carries a valid stayStyle).
    const mk = () => {
      const trip = structuredClone(seedData.trips[0])
      trip.days.forEach(d => { d.stops = d.stops.filter(s => s.category !== 'hotel') })
      trip.days[0].stops.push({
        id: 'hotel_legacy', title: 'Test Stay', category: 'hotel', locationName: 'Legacy Base',
        lat: 9.93, lng: 76.26, description: '', notes: '',
        visitMinutes: 600, openTime: '', closeTime: '', entryFeeInrPerPerson: 0,
        transportCostInrTotal: 0, priority: 'must-do', sourceUrl: '', status: 'suggested', orderInDay: 1,
      } as never)
      return trip
    }
    const legacy = mk()
    legacy.stayStyle = undefined
    legacy.travelStyle = 'luxury'
    expect(computeTotals(legacy).lodgingRatePerNight).toBe(STAY_RATE_PER_NIGHT.luxury)
    // An explicit dial wins over the legacy style — the two are independent.
    const explicit = mk()
    explicit.stayStyle = 'budget'
    explicit.travelStyle = 'luxury'
    expect(computeTotals(explicit).lodgingRatePerNight).toBe(STAY_RATE_PER_NIGHT.budget)
    // And travelStyle alone never moves the bed once a dial exists.
    const comfort = mk()
    comfort.stayStyle = 'comfort'
    comfort.travelStyle = 'luxury'
    expect(computeTotals(comfort).lodgingRatePerNight).toBe(STAY_RATE_PER_NIGHT.comfort)
  })
})

describe('enhancement batch (issues #122–#146) — party, pins, charge, both walks', () => {
  it('conducted modes get no split verdict; self-drive modes keep theirs (#126)', () => {
    // released semantics (day-planner-realism): taxi is someone else's shift;
    // `mixed` stays plannable because it can include real driving.
    for (const m of ['train', 'bus', 'flight', 'taxi'])
      expect(planDriveDays({ totalKm: 1400, driveMinutes: 1600, transportMode: m })).toBeNull()
    expect(planDriveDays({ totalKm: 1400, driveMinutes: 2000, transportMode: 'car' })!.driveDayCount).toBeGreaterThan(1)
    expect(planDriveDays({ totalKm: 1400, driveMinutes: 2000, transportMode: 'mixed' })!.driveDayCount).toBeGreaterThan(1)
    // the clock walk agrees: nobody drives, no drive to plan (empty ok)
    const v = planTravelClock({ totalKm: 1400, driveMinutes: 1600, transportMode: 'bus' })
    expect(v.verdict).toBe('ok')
    if (v.verdict === 'ok') { expect(v.days).toEqual([]); expect(v.returnDays).toBeNull() }
  })

  it('the party and the saddle move the cap inside honest rails (#142)', () => {
    expect(wheelCapHoursForParty({ transportMode: 'car' })).toBe(10)
    expect(wheelCapHoursForParty({ transportMode: 'motorcycle' })).toBeCloseTo(8.5)
    expect(wheelCapHoursForParty({ transportMode: 'car', driverCount: 2 })).toBeCloseTo(12)
    expect(wheelCapHoursForParty({ transportMode: 'car', driverCount: 4 })).toBe(12) // rail
    expect(wheelCapHoursForParty({ transportMode: 'car', hasVulnerable: true })).toBe(9)
    expect(wheelCapHoursForParty({ transportMode: 'car', hasVulnerable: true, driverCount: 2 })).toBe(11)
    // the headline promise: 2 rotating drivers buy the route a day back
    expect(planDriveDays({ totalKm: 850, driveMinutes: driveMinFor(850) })!.driveDayCount).toBe(3)
    expect(planDriveDays({ totalKm: 850, driveMinutes: driveMinFor(850), driverCount: 2 })!.driveDayCount).toBe(2)
  })

  it('dinner is a party input, not a biological absolute (#122)', () => {
    // invariant: the night end never collapses inside dinner + an hour
    const fixed = resolveAnchors({ dinnerStartMin: 19 * 60, dinnerEndMin: 20 * 60, nightEndMin: 19 * 60 + 30 })
    expect(fixed.nightEndMin).toBe(20 * 60 + 60)
    // kids/seniors: a dinner-pinned day ends an hour earlier
    const base = { totalKm: 1000, driveMinutes: driveMinFor(1000), dayStart: '08:30', driverCount: 4 }
    const normal = planTravelClock(base)
    const early = planTravelClock({ ...base, anchors: { dinnerStartMin: 19 * 60, dinnerEndMin: 20 * 60 } })
    expect(normal.verdict).toBe('ok')
    expect(early.verdict).toBe('ok')
    if (normal.verdict === 'ok' && early.verdict === 'ok') {
      expect(normal.days[0].nightHaltEtaMin).toBe(20 * 60)
      expect(early.days[0].nightHaltEtaMin).toBe(19 * 60)
      expect(early.days[0].kmCovered).toBeLessThan(normal.days[0].kmCovered)
    }
  })

  it('the dhaba case drives on after dinner when the trip says so (#122)', () => {
    const base = { totalKm: 1000, driveMinutes: driveMinFor(1000), dayStart: '08:30', driverCount: 4 }
    const plain = planTravelClock(base)
    const dhaba = planTravelClock({ ...base, anchors: { allowPostDinnerDriveMin: 120 } })
    if (plain.verdict === 'ok' && dhaba.verdict === 'ok') {
      // the meal still happens, the day covers further to the boundary
      expect(dhaba.days[0].kmCovered).toBeGreaterThan(plain.days[0].kmCovered)
      expect(dhaba.days[0].nightHaltEtaMin!).toBeGreaterThan(plain.days[0].nightHaltEtaMin!)
      expect(dhaba.days[0].dwellMin).toBeGreaterThanOrEqual(HALT_MIN.dinner)
    }
  })

  it('same chance, different sky: drizzle damps the cap, storms floor it (#141)', () => {
    // probability x WMO severity (the released model — the plain 1-pct/200
    // line is the undefined-code fallback, pinned exhaustively in
    // tests/day-planner-realism.test.ts). This block owns the CLOCK-WALK half:
    // per-day codes cap only their own day's budget.
    const dry = planTravelClock({ totalKm: 1400, driveMinutes: driveMinFor(1400), dayStart: '08:30' })
    const drizzle = planTravelClock({ totalKm: 1400, driveMinutes: driveMinFor(1400), dayStart: '08:30', dayRainPct: [90, null], dayWeatherCode: [53, null] })
    const storm = planTravelClock({ totalKm: 1400, driveMinutes: driveMinFor(1400), dayStart: '08:30', dayRainPct: [90, null], dayWeatherCode: [95, null] })
    if (dry.verdict !== 'ok' || drizzle.verdict !== 'ok' || storm.verdict !== 'ok') throw new Error('expected ok')
    // day 1 covers less when it rains, and less still in a thunderstorm
    expect(drizzle.days[0].kmCovered).toBeLessThan(dry.days[0].kmCovered)
    expect(storm.days[0].kmCovered).toBeLessThan(drizzle.days[0].kmCovered)
    // day 2 (dry forecast) is untouched by which kind of rain fell on day 1
    expect(storm.days[1].kmCovered).toBeGreaterThan(storm.days[0].kmCovered)
  })

  it('accepted night-halt pins hold position, propose drift, stay quiet below it (#143)', () => {
    const base = { totalKm: 900, driveMinutes: 1300, multiDay: true }
    const derived = planRideSegments(base)
    const halt1 = derived.find(s => s.purpose === 'overnight')!
    expect(halt1.haltPinned).toBeUndefined()
    // beyond hysteresis: the pin holds, the derived position rides along as a proposal
    const pinned = planRideSegments({ ...base, haltPins: { 0: halt1.targetKm + 40 } })
    const moved = pinned.find(s => s.purpose === 'overnight')!
    expect(moved.targetKm).toBe(halt1.targetKm + 40)
    expect(moved.haltPinned).toBe(true)
    expect(moved.haltDriftToKm).toBe(Math.round(halt1.targetKm))
    // below hysteresis: silent, no proposal
    const quiet = planRideSegments({ ...base, haltPins: { 0: halt1.targetKm + 10 } })
    const kept = quiet.find(s => s.purpose === 'overnight')!
    expect(kept.haltPinned).toBe(true)
    expect(kept.haltDriftToKm).toBeUndefined()
  })

  it('fuel folds into a nearby meal, and an EV charges instead of fuelling (#144)', () => {
    // fuel tick 357 sits 37 km from the 320 meal tick (within 15% of the 357
    // stride): the fuel raw folds into the meal, which the lunch slide then
    // carries to the window edge — one combined stop, no standalone fuel.
    const segs = planRideSegments({ totalKm: 800, driveMinutes: 1143, includeFuel: true, vehicleRangeKm: 420, mealKm: 320 })
    expect(segs.some(s => s.purpose === 'meal' && s.label === 'Meal + fuel')).toBe(true)
    expect(segs.find(s => s.purpose === 'fuel')).toBeUndefined()
    // EV: tighter stride than fuel, "Charge" wording, 60-min dwell in the ETAs.
    // A charge tick within a collapse gap of a meal becomes "Meal + charge" —
    // 144A on EV terms — so charge stops are read by label, not bare purpose.
    const ev = planRideSegments({ totalKm: 700, driveMinutes: 1000, includeCharge: true, vehicleRangeKm: 300 })
    const charges = ev.filter(s => /charge/i.test(s.label))
    expect(charges.length).toBeGreaterThanOrEqual(2)
    for (const c of charges) expect(c.label).not.toMatch(/fuel/i)
    const stride = charges.map(c => c.targetKm)
    for (let i = 1; i < stride.length; i++) expect(stride[i] - stride[i - 1]).toBeLessThanOrEqual(240 + 1)
    // dwell-corrected ETAs: the later charge carries the 60-min plug-in in its clock
    const gap = charges[1].etaMinutes! - charges[0].etaMinutes!
    const wheelGap = (charges[1].targetKm - charges[0].targetKm) * (1000 / 700)
    expect(gap - wheelGap).toBeGreaterThanOrEqual(60 - 2)
    // includeFuel loses to includeCharge — never both wordings at once
    const both = planRideSegments({ totalKm: 700, driveMinutes: 1000, includeFuel: true, includeCharge: true, vehicleRangeKm: 300 })
    for (const s of both.filter(x => /charge/i.test(x.label))) expect(s.label).not.toMatch(/fuel/i)
  })

  it('a round trip walks the drive home as a second directed pass (#145)', () => {
    const out = planTravelClock({ totalKm: 700, driveMinutes: 1000, dayStart: '08:30' })
    expect(out.verdict).toBe('ok')
    if (out.verdict === 'ok') expect(out.returnDays).toBeNull()
    const rt = planTravelClock({ totalKm: 700, driveMinutes: 1000, dayStart: '08:30', roundTrip: true })
    expect(rt.verdict).toBe('ok')
    if (rt.verdict === 'ok') {
      expect(rt.returnDays!.length).toBeGreaterThan(0)
      const last = rt.returnDays![rt.returnDays!.length - 1]
      expect(last.kmCovered).toBeCloseTo(700, 0)      // the walk really reaches home
      expect(last.nightHaltKm).toBeNull()
      // return day indexes continue the outbound count
      expect(rt.returnDays![0].dayIndex).toBe(rt.days.length)
    }
  })

  it('lodging identity keys on the place id before names or pins (#146)', () => {
    const trip = structuredClone(seedData.trips[0])
    trip.days.forEach(d => { d.stops = d.stops.filter(s => s.category !== 'hotel') })
    const mk = (id: string, title: string, lat: number, lng: number, placeId?: string) => ({
      id, title, category: 'hotel', locationName: title, lat, lng, description: '', notes: '',
      visitMinutes: 600, openTime: '', closeTime: '', entryFeeInrPerPerson: 0,
      transportCostInrTotal: 0, priority: 'must-do', sourceUrl: '', status: 'suggested', orderInDay: 1,
      placeId,
    })
    // same place id, two spellings, three degrees apart — one booking
    trip.days[0].stops.push(mk('h1', 'Hotel Taj', 18.9, 72.8, 'gx1') as never)
    trip.days[1].stops.push(mk('h2', 'Hotel Taj, Mumbai', 21.9, 78.8, 'gx1') as never)
    expect(computeTotals(trip).lodgingNights).toBe(1)
    // two distinct place ids — two nights
    trip.days[2].stops.push(mk('h3', 'Tranquil Inn', 12.9, 77.5, 'gy7') as never)
    expect(computeTotals(trip).lodgingNights).toBe(2)
    // hand-typed stays without an id fall back to geo/name keying (#125a)
    trip.days[3].stops.push(mk('h4', 'Tranquil Inn near ring road', 12.902, 77.502) as never)
    expect(computeTotals(trip).lodgingNights).toBe(3)
  })
})
