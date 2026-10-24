// ============ Ride-plan engine tests ============
// Pure logic, node env — no DOM, no fetch. Guards the fatigue-budget segment
// plan (cadence, day boundaries, windows, fuel cadence) and the assignment
// pass (purpose-fit vs detour vs distance-to-target, cities for overnights,
// dedupe). The network-backed search itself stays best-effort live data.
import { describe, it, expect } from 'vitest'
import {
  assignSegmentHits, fitScoreForPurpose, nearestCityName, kmFromStartForHit,
  scoreHitForSegment, preferTownGrade, segmentsFromPlan, planDriveDays,
  STRETCH_INTERVAL_KM, MEAL_INTERVAL_KM, ENDNO_KM, MIN_BREAK_GAP_KM, STRETCH_CLOCK_MIN,
  type RideSegment,
} from '../src/lib/ridePlan'
import { planRide as planRideSegments } from './helpers/sharedDrivingPlan'
import type { PlaceHit } from '../src/lib/providers/hits'

// ---- helpers ---------------------------------------------------------------

/** A straight west-east corridor with an anchor every `stepsKm` km. */
function lineAnchors(stepsKm = 100, totalKm = 1400): { lat: number; lng: number }[] {
  const n = Math.round(totalKm / stepsKm)
  return Array.from({ length: n + 1 }, (_, i) => ({ lat: (i * stepsKm) / 111.32, lng: 0 }))
}

function hit(name: string, lat: number, lng = 0, over: Partial<PlaceHit> = {}): PlaceHit {
  return { id: name, name, latitude: lat, longitude: lng, kind: 'poi', ...over }
}

const kmAt = (anchorIdx: number, stepsKm = 100) => anchorIdx * stepsKm

/** A crafted segment at `targetKm` for assignment tests. */
function seg(purpose: RideSegment['purpose'], targetKm: number, halfWindow = 75): RideSegment {
  return {
    index: 0, purpose, label: purpose, targetKm,
    minKm: targetKm - halfWindow, maxKm: targetKm + halfWindow,
    kmFromPrev: targetKm, minutesFromPrev: 0, hint: '',
  }
}

// ============ planRideSegments — cadence & fatigue budget ============

describe('planRideSegments', () => {
  it('returns nothing for a short drive', () => {
    expect(planRideSegments({ totalKm: 60, driveMinutes: 60 })).toEqual([])
    expect(planRideSegments({ totalKm: 0, driveMinutes: 0 })).toEqual([])
    expect(planRideSegments({ totalKm: NaN, driveMinutes: 0 })).toEqual([])
  })

  it('plans a Kolkata→Goa-shaped 1400 km multi-day car drive with overnights at day boundaries', () => {
    const s = planRideSegments({ totalKm: 1400, driveMinutes: 1000, includeFuel: true, multiDay: true })
    expect(s.length).toBeGreaterThanOrEqual(5)
    const overnights = s.filter(x => x.dayEnd)
    // P1-A — boundaries derive from the wheel cap (10 h × 84 km/h = 840 km/day
    // → 2 load-balanced days of 700), not the fixed 550 tick (which demanded a
    // 6.5 h day-1 and a 10.1 h day-2 — an imbalanced, near-impossible day-2).
    expect(overnights.map(o => o.targetKm)).toEqual([700])
    // first stop is a stretch ~150 km in (clock twin @ 84 km/h = 168 > 150,
    // so the km cadence holds), and nothing past total − ENDNO
    expect(s[0].purpose).toBe('stretch')
    expect(s[0].targetKm).toBeCloseTo(STRETCH_INTERVAL_KM, 5)
    for (const x of s) expect(x.targetKm).toBeLessThan(1400 - ENDNO_KM)
  })

  it('keeps a meal+fuel combination near the lunch cadence of day one', () => {
    const s = planRideSegments({ totalKm: 1400, driveMinutes: 1000, includeFuel: true, multiDay: true })
    const combo = s.find(x => x.label === 'Meal + fuel')
    expect(combo).toBeDefined()
    expect(combo!.targetKm).toBeCloseTo(MEAL_INTERVAL_KM, 0) // ~300 km
  })

  it('never places two in-day breaks closer than MIN_BREAK_GAP_KM (overnights exempt)', () => {
    const s = planRideSegments({ totalKm: 1400, driveMinutes: 1000, includeFuel: true, multiDay: true })
    for (let i = 1; i < s.length; i++) {
      if (s[i].dayEnd) continue // the day's final stop may sit near closing time
      if (s[i - 1].dayEnd) continue // the first stop after a halt: a night separates them
      const gap = s[i].targetKm - s[i - 1].targetKm
      expect(gap).toBeGreaterThanOrEqual(MIN_BREAK_GAP_KM - 1e-6)
    }
  })

  it('resets the stretch cadence after an overnight (day-relative, not origin-relative)', () => {
    const s = planRideSegments({ totalKm: 1400, driveMinutes: 1000, includeFuel: true, multiDay: true })
    const firstOvernight = s.find(x => x.dayEnd)!
    const next = s[s.indexOf(firstOvernight) + 1]
    // day 2's cadence restarts at the halt: the first stop lands early in the
    // new day (the morning refuel folds the stretch into it), never at a
    // stale origin-relative position like 600
    const intoDay = next.targetKm - firstOvernight.targetKm
    expect(intoDay).toBeGreaterThan(0)
    expect(intoDay).toBeLessThanOrEqual(STRETCH_INTERVAL_KM)
  })

  it('drops fuel cadence when includeFuel is off and omits overnights for single-day drives', () => {
    const s = planRideSegments({ totalKm: 1400, driveMinutes: 1000, includeFuel: false, multiDay: true })
    expect(s.some(x => x.purpose === 'fuel')).toBe(false)
    const single = planRideSegments({ totalKm: 1000, driveMinutes: 700, includeFuel: true, multiDay: false })
    expect(single.some(x => x.dayEnd)).toBe(false)
  })

  it('stretch fires by the clock on slow roads — 2 h of wheel time, not 3.6', () => {
    // 300 km over 7 h of wheel = blended 42.9 km/h (the all-India city mix):
    // the km cadence would wait 150 km (3.5 h); the clock twin tightens to
    // ≈ 86 km (2 h). Receipt: STRETCH 150 @ 42 km/h = 3.6 h between breaks.
    const s = planRideSegments({ totalKm: 300, driveMinutes: 420 })
    expect(s[0].purpose).toBe('stretch')
    expect(s[0].targetKm).toBeCloseTo((STRETCH_CLOCK_MIN / 60) * (300 / 7), 0)
  })

  it('highway journeys keep the 150 km stretch rhythm (the clock never loosens)', () => {
    const s = planRideSegments({ totalKm: 600, driveMinutes: 420 }) // 85.7 km/h
    expect(s[0].purpose).toBe('stretch')
    expect(s[0].targetKm).toBeCloseTo(STRETCH_INTERVAL_KM, 5)
  })

  it('respects a vehicle tank range for the fuel cadence', () => {
    // 600 km on a 300 km tank: fuel+meal fold at ~300 (85% of 300 ≈ 255 km is
    // inside lunch's window), and the short tank forces a SECOND fuel stop
    // (~510 km) that a default 450-km cadence would never schedule.
    const s = planRideSegments({ totalKm: 600, driveMinutes: 480, includeFuel: true, multiDay: false, vehicleRangeKm: 300 })
    const combo = s.find(x => x.label === 'Meal + fuel')
    expect(combo).toBeDefined()
    expect(combo!.targetKm).toBeCloseTo(300, 0)
    expect(s.some(x => x.purpose === 'fuel' && x.targetKm > 480)).toBe(true)
    for (const x of s) expect(x.targetKm).toBeLessThan(600 - ENDNO_KM)
  })

  it('all windows are sane: min < target < max, ordered, monotonic transport math', () => {
    const s = planRideSegments({ totalKm: 1400, driveMinutes: 1000, includeFuel: true, multiDay: true })
    let prevTarget = -Infinity
    for (const x of s) {
      expect(x.minKm).toBeLessThanOrEqual(x.targetKm)
      expect(x.targetKm).toBeLessThanOrEqual(x.maxKm)
      expect(x.targetKm).toBeGreaterThan(prevTarget)
      expect(x.minutesFromPrev).toBeGreaterThanOrEqual(0)
      prevTarget = x.targetKm
    }
    // km legs & minute legs are consistent with the total
    const totalLegKm = s.reduce((a, x) => a + x.kmFromPrev, 0)
    expect(totalLegKm).toBeLessThanOrEqual(1400)
  })
})

// ============ kmFromStartForHit ============

describe('kmFromStartForHit', () => {
  const anchors = lineAnchors(100, 500)

  it('prefers the provider-given road distance (Google alongRouteKm)', () => {
    const h = hit('R', 2.2, 0, { alongRouteKm: 120 })
    expect(kmFromStartForHit(h, anchors)).toBe(120)
  })

  it('maps a hit onto its nearest ordered anchor position', () => {
    const near1 = hit('A', kmAt(1, 100) / 111.32, 0)
    const near4 = hit('B', kmAt(4, 100) / 111.32, 0)
    const posA = kmFromStartForHit(near1, anchors)!
    const posB = kmFromStartForHit(near4, anchors)!
    expect(posB).toBeGreaterThan(posA)
    expect(posA).toBeCloseTo(100, 0)
    expect(posB).toBeCloseTo(400, 0)
  })

  it('returns null for unusable input', () => {
    expect(kmFromStartForHit(hit('X', NaN, 0), anchors)).toBeNull()
    expect(kmFromStartForHit(hit('X', 1, 0), [])).toBeNull()
  })
})

// ============ fitScoreForPurpose ============

describe('fitScoreForPurpose', () => {
  it('matches the affinity table (ideal pairings score 3)', () => {
    expect(fitScoreForPurpose(hit('R', 1, 0, { category: 'food' }), 'meal')).toBe(3)
    expect(fitScoreForPurpose(hit('P', 1, 0, { category: 'transport-hub' }), 'fuel')).toBe(3)
    expect(fitScoreForPurpose(hit('H', 1, 0, { category: 'hotel' }), 'overnight')).toBe(3)
    expect(fitScoreForPurpose(hit('V', 1, 0, { category: 'sightseeing' }), 'sight')).toBe(3)
    expect(fitScoreForPurpose(hit('V', 1, 0, { category: 'sightseeing' }), 'meal')).toBe(0)
  })

  it('rewards key cities for overnight / meal / fuel (interstate anchoring)', () => {
    const city = hit('Nagpur', 1, 0, { category: 'rest', kind: 'place', isPopulatedPlace: true, population: 2_500_000 })
    expect(fitScoreForPurpose(city, 'overnight')).toBe(3)
    expect(fitScoreForPurpose(city, 'meal')).toBeGreaterThanOrEqual(2)
    // an unremarkable place gets no such boost
    expect(fitScoreForPurpose(hit('X', 1, 0, { category: 'rest' }), 'overnight')).toBe(0)
  })

  it('a night halt anchors on a real TOWN — hamlet-grade anchors are dropped (#189)', () => {
    // Both are populated places, but a halt needs a bed: Google's rural
    // `locality` results are hamlets with no population, and their fit gap
    // against a town (2 vs 3) is erased by a few km of proximity. So when real
    // towns are available they ARE the anchor pool.
    const hamlet = hit('Gauriyapur', 1, 0, { category: 'rest', kind: 'place', isPopulatedPlace: true })
    const town = hit('Chunar', 1, 0, { category: 'rest', kind: 'place', isPopulatedPlace: true, population: 37_185 })
    const pool = preferTownGrade([hamlet, town])
    expect(pool).toEqual([town])
    // urban corridors where OSM has no town keep Google's localities — the
    // layer never empties for this reason
    expect(preferTownGrade([hamlet])).toEqual([hamlet])
    expect(preferTownGrade([])).toEqual([])
    // a town still scores better than a hamlet head-to-head
    const anchors = [{ lat: 1, lng: 0 }]
    const overnight = seg('overnight', 0)
    expect(scoreHitForSegment(town, overnight, anchors)!).toBeLessThan(scoreHitForSegment(hamlet, overnight, anchors)!)
  })

  it('a night-halt anchor far from its halt is REJECTED, not grabbed (#189)', () => {
    // Live-verified: a 350 km halt anchored on Jhumri Tilaiya, 800 km further
    // down the corridor — an early segment starved of nearby options took the
    // least-bad candidate instead of reporting an honest gap.
    const anchors = lineAnchors(100, 1400)
    const near = hit('Chunar', kmAt(7, 100) / 111.32, 0, { category: 'rest', isPopulatedPlace: true, population: 37_185 })
    const far = hit('Jhumri Tilaiya', kmAt(12, 100) / 111.32, 0, { category: 'rest', isPopulatedPlace: true, population: 1000 })
    const seg350 = seg('overnight', 350)
    expect(scoreHitForSegment(near, seg350, anchors)).toBeNull()
    expect(scoreHitForSegment(far, seg350, anchors)).toBeNull()
    // the halt it DOES sit near still accepts it
    expect(scoreHitForSegment(near, seg('overnight', 700), anchors)).not.toBeNull()
    // and the bound is anchor-only — a town can still serve another purpose
    expect(scoreHitForSegment(far, seg('stretch', 350), anchors)).not.toBeNull()
  })
})

// ============ assignSegmentHits ============

describe('assignSegmentHits', () => {
  const anchors = lineAnchors(100, 1400)

  /** ~300 km along the corridor (near anchor index 3). */
  const at300 = (dLat = 0) => hit('cand', kmAt(3, 100) / 111.32 + dLat, 0)

  it('a meal segment picks the restaurant over a nearby temple', () => {
    const mealSeg = seg('meal', 300)
    const pool = [
      at300(0.02), // generic name/category → low fit
      hit('Temple', kmAt(3, 100) / 111.32, 0, { category: 'sightseeing' }),
      hit('Curry House', kmAt(3, 100) / 111.32, 0, { category: 'food' }),
    ]
    const [result] = assignSegmentHits(pool, [mealSeg], anchors)
    expect(result.hit?.name).toBe('Curry House')
  })

  it('an overnight segment prefers the big-city candidate over a rural hotel off-target', () => {
    const overnightSeg = seg('overnight', 550)
    const pool = [
      hit('Rural Grand', kmAt(7, 100) / 111.32, 0, { category: 'hotel' }), // fit 3 but far off target
      hit('Nagpur', kmAt(5, 100) / 111.32, 0, { category: 'rest', kind: 'place', isPopulatedPlace: true, population: 2_500_000 }),
    ]
    const [result] = assignSegmentHits(pool, [overnightSeg], anchors)
    expect(result.hit?.isPopulatedPlace).toBe(true)
  })

  it('the worst-detour candidate loses when everything else is equal', () => {
    const mealSeg = seg('meal', 300)
    const base = { category: 'food' as const }
    const pool = [
      hit('OnRoute', kmAt(3, 100) / 111.32, 0, base),
      hit('Detour', kmAt(3, 100) / 111.32, 0, { ...base, offRouteKm: 60 }),
    ]
    const [result] = assignSegmentHits(pool, [mealSeg], anchors)
    expect(result.hit?.name).toBe('OnRoute')
  })

  it('never reuses a hit across segments and leaves gaps when nothing fits', () => {
    const mealSeg = seg('meal', 300)
    const fuelSeg = seg('fuel', 450)
    const pool = [hit('Only Pump', kmAt(3, 100) / 111.32, 0, { category: 'transport-hub' })]
    const [m, f] = assignSegmentHits(pool, [mealSeg, fuelSeg], anchors)
    expect(m.hit?.name).toBe('Only Pump')
    expect(f.hit).not.toBe(m.hit) // used elsewhere → no repeat
  })

  it('drops hits inside the home zone around the trip start', () => {
    const anchorsLocal = lineAnchors(50, 300)
    const stretchSeg = seg('stretch', 150)
    const pool = [hit('Home Cafe', 5 / 111.32, 0, { category: 'cafe' })]
    const [result] = assignSegmentHits(pool, [stretchSeg], anchorsLocal, { homeCenter: { lat: 0, lng: 0 } })
    expect(result.hit).toBeNull()
  })
})

// ============ nearestCityName ============

describe('nearestCityName', () => {
  it('returns the nearest populated place within radius', () => {
    const cityPool = [
      hit('Wardha', 6 / 111.32, 0, { isPopulatedPlace: true, kind: 'place' }),
      hit('Nagpur', 5.4 / 111.32, 0, { isPopulatedPlace: true, kind: 'place', population: 2_500_000 }),
    ]
    const h = hit('Cafe', 5.5 / 111.32, 0)
    expect(nearestCityName(h, cityPool)).toBe('Nagpur')
  })

  it('ignores the hit itself and returns nothing beyond radius', () => {
    const pool = [hit('Nagpur', 0, 0, { isPopulatedPlace: true, kind: 'place' })]
    expect(nearestCityName(pool[0], pool)).toBeUndefined()
    // ~111 km away with a 100 km radius → no match
    expect(nearestCityName(hit('Far', 1.0, 0), pool, 100)).toBeUndefined()
  })
})

// ============ segmentsFromPlan — the user-authored halt planner ============

describe('segmentsFromPlan', () => {
  it('orders the user’s halts by km and keeps one segment each', () => {
    const plan = [
      { km: 300, minutes: 45, purpose: 'meal' as const },
      { km: 100, minutes: 20, purpose: 'stretch' as const },
    ]
    const segs = segmentsFromPlan(plan, 600)
    expect(segs.map(s => s.targetKm)).toEqual([100, 300])
    expect(segs[0].purpose).toBe('stretch')
    expect(segs[1].purpose).toBe('meal')
  })

  it('builds acceptance windows as midpoints to the neighbours', () => {
    const segs = segmentsFromPlan([
      { km: 100, minutes: 20, purpose: 'stretch' },
      { km: 300, minutes: 45, purpose: 'meal' },
      { km: 500, minutes: 30, purpose: 'stretch' },
    ], 600)
    expect(segs[0].minKm).toBe(0) // first halt may sit right at the start
    expect(segs[0].maxKm).toBe(200) // midpoint to the next halt
    expect(segs[1].minKm).toBe(200)
    expect(segs[1].maxKm).toBe(400)
    expect(segs[2].maxKm).toBe(550) // midpoint to the journey end, never past it
  })

  it('scales kmFromPrev and minutesFromPrev to the whole ride', () => {
    const segs = segmentsFromPlan([{ km: 300, minutes: 45, purpose: 'meal' }], 600, 480)
    expect(segs[0].kmFromPrev).toBe(300)
    expect(segs[0].minutesFromPrev).toBe(240) // half of 480 wheel minutes
  })

  it('ignores non-positive km and returns nothing for a short ride', () => {
    expect(segmentsFromPlan([{ km: -5, minutes: 20, purpose: 'stretch' }], 600)).toEqual([])
    expect(segmentsFromPlan([{ km: 100, minutes: 20, purpose: 'stretch' }], 0)).toEqual([])
  })

  it('marks an overnight halt as a day boundary', () => {
    const segs = segmentsFromPlan([{ km: 400, minutes: 0, purpose: 'overnight' }], 600)
    expect(segs[0].dayEnd).toBe(true)
    expect(segs.find(s => s.purpose === 'meal')?.dayEnd).toBeUndefined()
  })
})

// ============ planDriveDays — the Day Planner's split verdict (P1-A) ============
// Fixtures ARE the spec: PLAN-DAY-PLANNER §14. Every number is derived from
// the journey's own blended speed × the style-tuned wheel cap.

describe('planDriveDays', () => {
  it('700 km at the blended 42 km/h demands 2 load-balanced days of 350', () => {
    const d = planDriveDays({ totalKm: 700, driveMinutes: 1000 })!
    expect(d.driveDayCount).toBe(2)
    expect(d.perDay).toBeCloseTo(350, 5)
    expect(d.nightHalts).toEqual([350])
    expect(d.maxDailyWheelMin).toBeCloseTo(500, 5) // 8.3 h each — dinner ends the day
  })

  it('1200 km demands 3 × 400 — never a 585+115 imbalance', () => {
    const d = planDriveDays({ totalKm: 1200, driveMinutes: 1714 })!
    expect(d.driveDayCount).toBe(3)
    expect(d.perDay).toBeCloseTo(400, 5)
    expect(d.nightHalts).toEqual([400, 800])
  })

  it('a 300 km day needs no overnight', () => {
    const d = planDriveDays({ totalKm: 300, driveMinutes: 420 })!
    expect(d.driveDayCount).toBe(1)
    expect(d.nightHalts).toEqual([])
  })

  it('highway speeds stretch the daily budget: 1400 km at 84 km/h is 2 × 700', () => {
    const d = planDriveDays({ totalKm: 1400, driveMinutes: 1000 })!
    expect(d.driveDayCount).toBe(2)
    expect(d.perDay).toBeCloseTo(700, 5)
    expect(d.nightHalts).toEqual([700])
  })

  it('packed pushes to 11 h, relaxed rests at 8.5', () => {
    const packed = planDriveDays({ totalKm: 800, driveMinutes: 1143, travelStyle: 'packed' })!
    const relaxed = planDriveDays({ totalKm: 800, driveMinutes: 1143, travelStyle: 'relaxed' })!
    expect(packed.driveDayCount).toBe(2)
    expect(relaxed.driveDayCount).toBe(3)
    expect(packed.maxDailyWheelMin).toBeCloseTo(571.5, 5)
    expect(relaxed.maxDailyWheelMin).toBeCloseTo(381, 0)
  })

  it('rain shrinks the cap and shifts the split', () => {
    const dry = planDriveDays({ totalKm: 400, driveMinutes: 571 })!
    const wet = planDriveDays({ totalKm: 400, driveMinutes: 571, rainFactor: 0.85 })!
    expect(dry.driveDayCount).toBe(1)
    expect(wet.driveDayCount).toBe(2)
    expect(wet.nightHalts).toEqual([200])
  })

  it('guards garbage input', () => {
    expect(planDriveDays({ totalKm: 0, driveMinutes: 60 })).toBeNull()
    expect(planDriveDays({ totalKm: 100, driveMinutes: 0 })).toBeNull()
    expect(planDriveDays({ totalKm: NaN, driveMinutes: 60 })).toBeNull()
  })
})