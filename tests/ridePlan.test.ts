// ============ Ride-plan engine tests ============
// Pure logic, node env — no DOM, no fetch. Guards the fatigue-budget segment
// plan (cadence, day boundaries, windows, fuel cadence) and the assignment
// pass (purpose-fit vs detour vs distance-to-target, cities for overnights,
// dedupe). The network-backed search itself stays best-effort live data.
import { describe, it, expect } from 'vitest'
import {
  planRideSegments, assignSegmentHits, fitScoreForPurpose, nearestCityName, kmFromStartForHit,
  STRETCH_INTERVAL_KM, MEAL_INTERVAL_KM, ENDNO_KM, MIN_BREAK_GAP_KM,
  type RideSegment,
} from '../src/lib/ridePlan'
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
    expect(overnights.map(o => o.targetKm)).toEqual([550, 1100])
    // first stop is a stretch ~150 km in, and nothing past total − ENDNO
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
      const gap = s[i].targetKm - s[i - 1].targetKm
      if (s[i].dayEnd) continue // the day's final stop may sit near closing time
      expect(gap).toBeGreaterThanOrEqual(MIN_BREAK_GAP_KM - 1e-6)
    }
  })

  it('resets the stretch cadence after an overnight (day-relative, not origin-relative)', () => {
    const s = planRideSegments({ totalKm: 1400, driveMinutes: 1000, includeFuel: true, multiDay: true })
    const firstOvernight = s.find(x => x.dayEnd)!
    const next = s[s.indexOf(firstOvernight) + 1]
    // next stop lands ~150 km into day 2 (~700 from origin), not at a stale 600
    expect(next.targetKm - firstOvernight.targetKm).toBeCloseTo(STRETCH_INTERVAL_KM, 0)
  })

  it('drops fuel cadence when includeFuel is off and omits overnights for single-day drives', () => {
    const s = planRideSegments({ totalKm: 1400, driveMinutes: 1000, includeFuel: false, multiDay: true })
    expect(s.some(x => x.purpose === 'fuel')).toBe(false)
    const single = planRideSegments({ totalKm: 1000, driveMinutes: 700, includeFuel: true, multiDay: false })
    expect(single.some(x => x.dayEnd)).toBe(false)
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