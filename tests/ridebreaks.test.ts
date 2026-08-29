// ============ Long-ride break planner tests ============
// The Kolkata → Siliguri pair is the canonical fixture: ~462 km straight line
// → ~577 km with the road factor → ~14 h of wheel time on the blended car
// speed. Assertions pin behaviour (slot counts, positions, clocks) using the
// engine's own math for self-consistency, not brittle magic numbers.
import { describe, it, expect } from 'vitest'
import {
  planRide, recommendedStyle, RIDE_STYLES,
  MEAL_MINUTES, TEA_MINUTES, MAX_BREAKS,
} from '../src/lib/ridebreaks'
import { simulateDay, collectWarnings, legBetween, getAssumptions, originOf, addMinutesToClock } from '../src/lib/engine'
import type { Trip, ItineraryDay, ItineraryStop } from '../src/data/types'

const KOLKATA = { lat: 22.5726, lng: 88.3639 }
const SILIGURI = { lat: 26.7271, lng: 88.3953 }
const MIDPOINT = { lat: 24.64985, lng: 88.3796 }

function anchorStop(name: string, p: { lat: number; lng: number }, orderInDay = 1): ItineraryStop {
  return {
    id: `st_${name.toLowerCase()}`, title: name, category: 'travel', locationName: name,
    lat: p.lat, lng: p.lng, visitMinutes: 0,
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'must-do', status: 'confirmed', orderInDay, auto: true,
  }
}

function foodStop(p: { lat: number; lng: number }, orderInDay: number): ItineraryStop {
  return {
    id: 'st_food', title: 'Highway dhaba', category: 'food', locationName: 'Highway dhaba',
    lat: p.lat, lng: p.lng, visitMinutes: 40,
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'nice-to-have', status: 'confirmed', orderInDay,
  }
}

function makeTrip(day: ItineraryDay): Trip {
  return {
    id: 't_test', name: 'Kolkata → Siliguri ride', startLocation: 'Kolkata',
    startLocationCoords: KOLKATA,
    destinations: ['Siliguri'], destinationCoords: [SILIGURI],
    startDate: '2026-10-01', endDate: '2026-10-01', travellers: 1,
    transportMode: 'car', budgetPerPersonInr: 5000, travelStyle: 'balanced',
    fixedCommitments: [], days: [day], expenses: [],
    coverEmoji: '🧭', visibility: 'private', createdAt: 0, updatedAt: 0,
  }
}

function plainDay(startTime?: string): ItineraryDay {
  return { id: 'day0', index: 0, stops: [anchorStop('Siliguri', SILIGURI)], ...(startTime ? { startTime } : {}) }
}

const trip = makeTrip(plainDay())
const expectedDrive = legBetween(KOLKATA, SILIGURI, getAssumptions(trip)).durationMinutes

describe('long-ride detection', () => {
  it('flags the ~577 km Kolkata → Siliguri day as a long ride', () => {
    const plan = planRide(plainDay(), trip)
    expect(plan.isLongRide).toBe(true)
    expect(plan.driveMinutes).toBeCloseTo(expectedDrive, 0)
    expect(plan.distanceKm).toBeGreaterThan(500)
  })

  it('ignores short self-drive days', () => {
    const near = { lat: 22.75, lng: 88.40 } // ~20 km out
    const t = makeTrip({ id: 'day0', index: 0, stops: [anchorStop('Somewhere near', near)] })
    const plan = planRide(t.days[0], t)
    expect(plan.isLongRide).toBe(false)
    expect(plan.breaks).toHaveLength(0)
  })

  it('ignores long non-self-drive days (train trip between the same cities)', () => {
    const trainTrip: Trip = { ...trip, transportMode: 'train' }
    const plan = planRide(plainDay(), trainTrip)
    expect(plan.isLongRide).toBe(false)
    expect(plan.style).toBe('nonstop')
  })
})

describe('ride styles', () => {
  it('pre-picks regular breaks for a 14 h ride and caps the halt count', () => {
    const plan = planRide(plainDay(), trip)
    expect(plan.style).toBe('regular-breaks')
    expect(plan.breaks.length).toBeGreaterThan(2)
    expect(plan.breaks.length).toBeLessThanOrEqual(MAX_BREAKS)
  })

  it('pushing through means zero halts and no extra time', () => {
    const plan = planRide(plainDay(), trip, undefined, 'nonstop')
    expect(plan.breaks).toHaveLength(0)
    expect(plan.breakMinutes).toBe(0)
    expect(plan.totalMinutes).toBe(plan.driveMinutes)
    expect(plan.finishWithBreaks).toBe(plan.finishClock)
  })

  it('one halt lands near the halfway point as a proper meal', () => {
    const plan = planRide(plainDay(), trip, undefined, 'one-halt')
    expect(plan.breaks).toHaveLength(1)
    const slot = plan.breaks[0]
    expect(slot.kind).toBe('meal')
    expect(slot.stopMinutes).toBe(MEAL_MINUTES)
    expect(slot.fraction).toBeGreaterThan(0.4)
    expect(slot.fraction).toBeLessThan(0.6)
    expect(plan.totalMinutes).toBeCloseTo(plan.driveMinutes + MEAL_MINUTES, 6)
  })

  it('regular breaks are tea-length except the mid-drive meal', () => {
    const plan = planRide(plainDay(), trip)
    const meals = plan.breaks.filter(b => b.kind === 'meal')
    const teas = plan.breaks.filter(b => b.kind === 'tea')
    expect(meals).toHaveLength(1)
    expect(teas.length).toBeGreaterThan(0)
    for (const b of teas) expect(b.stopMinutes).toBe(TEA_MINUTES)
    expect(plan.breakMinutes).toBe(MEAL_MINUTES + teas.length * TEA_MINUTES)
    expect(plan.totalMinutes).toBeCloseTo(plan.driveMinutes + plan.breakMinutes, 6)
  })

  it('exposes the four styles for the UI selector', () => {
    expect(RIDE_STYLES.map(s => s.key)).toEqual(['nonstop', 'one-halt', 'regular-breaks', 'custom'])
  })

  it('pre-picks by ride length: 3 h rides get one halt, 8 h rides get regular breaks', () => {
    expect(recommendedStyle(180)).toBe('one-halt')
    expect(recommendedStyle(480)).toBe('regular-breaks')
  })
})
describe('outbound departure day', () => {
  it('plans the drive to the destination when a day holds only the start anchor', () => {
    // Day 1 of a Kolkata → Siliguri trip holds only the auto start anchor; the
    // destination anchor lives on the last day — the big drive must still be planned.
    const multiDay: Trip = {
      ...trip,
      days: [
        { id: 'd0', index: 0, stops: [anchorStop('Kolkata', KOLKATA)] },
        { id: 'd1', index: 1, stops: [anchorStop('Siliguri', SILIGURI)] },
      ],
    }
    const plan = planRide(multiDay.days[0], multiDay)
    expect(plan.isLongRide).toBe(true)
    expect(plan.isOutboundDrive).toBe(true)
    expect(plan.targetLabel).toBe('Siliguri')
    expect(plan.driveMinutes).toBeCloseTo(expectedDrive, 0)
    expect(plan.distanceKm).toBeGreaterThan(500)
    // every halt appends after the start anchor (index 1) — inserting before it
    // would plan an origin → halt → origin out-and-back and wreck the ride
    for (const b of plan.breaks) expect(b.insertAt).toBe(1)
  })

  it('does not invent a long ride when the next stop is close', () => {
    const near = { lat: (KOLKATA.lat + SILIGURI.lat) / 2, lng: (KOLKATA.lng + SILIGURI.lng) / 2 }
    const midDay: Trip = {
      ...trip,
      days: [
        { id: 'd0', index: 0, stops: [anchorStop('Kolkata', KOLKATA)] },
        { id: 'd1', index: 1, stops: [anchorStop('Midway', near)] },
      ],
    }
    const plan = planRide(midDay.days[0], midDay)
    // ~290 km — real but under the long-ride bar, so stay quiet
    expect(plan.isOutboundDrive).toBe(false)
    expect(plan.isLongRide).toBe(false)
    expect(plan.breaks).toHaveLength(0)
  })

  it('keeps a real multi-stop departure day on its own in-day drive (not labelled outbound)', () => {
    const day: ItineraryDay = {
      id: 'day0', index: 0,
      stops: [anchorStop('Kolkata', KOLKATA), foodStop(MIDPOINT, 2), anchorStop('Siliguri', SILIGURI, 3)],
    }
    const plan = planRide(day, trip)
    expect(plan.isOutboundDrive).toBe(false)
    expect(plan.isLongRide).toBe(true)
    expect(plan.breaks.length).toBeGreaterThan(0)
  })
})

describe('halt placement', () => {
  it('places halts by wheel time with km, fraction and insertion index', () => {
    const plan = planRide(plainDay(), trip)
    // single leg (origin → destination anchor): every halt inserts at index 0
    for (const b of plan.breaks) {
      expect(b.insertAt).toBe(0)
      expect(b.fraction).toBeGreaterThan(0)
      expect(b.fraction).toBeLessThan(1)
      expect(b.atKm).toBeGreaterThan(0)
      expect(b.atKm).toBeLessThan(plan.distanceKm)
      expect(b.atDriveMinute).toBeLessThan(plan.driveMinutes)
    }
    // slots are strictly increasing along the drive
    for (let i = 1; i < plan.breaks.length; i++) {
      expect(plan.breaks[i].atDriveMinute).toBeGreaterThan(plan.breaks[i - 1].atDriveMinute)
      expect(plan.breaks[i].atKm).toBeGreaterThan(plan.breaks[i - 1].atKm)
    }
  })

  it('maps halts onto the right leg when the day already has a waypoint', () => {
    const third = { lat: (KOLKATA.lat * 2 + SILIGURI.lat) / 3, lng: (KOLKATA.lng * 2 + SILIGURI.lng) / 3 }
    const day: ItineraryDay = {
      id: 'day0', index: 0,
      stops: [anchorStop('Waypoint town', third, 1), anchorStop('Siliguri', SILIGURI, 2)],
    }
    const plan = planRide(day, trip)
    const early = plan.breaks.find(b => b.atDriveMinute < plan.driveMinutes / 3)
    const late = plan.breaks.find(b => b.atDriveMinute > plan.driveMinutes / 3)
    expect(early?.insertAt).toBe(0) // rides on leg 0 (origin → waypoint)
    expect(late?.insertAt).toBe(1)  // rides on leg 1 (waypoint → destination)
  })

  it('marks a slot as covered when the day already halts near it', () => {
    const day: ItineraryDay = {
      id: 'day0', index: 0,
      stops: [foodStop(MIDPOINT, 1), anchorStop('Siliguri', SILIGURI, 2)],
    }
    const plan = planRide(day, trip)
    const covered = plan.breaks.filter(b => b.alreadyStopped)
    expect(covered).toHaveLength(1) // the ~450 min slot sits ~28 min after the dhaba's arrival
    expect(covered[0].atDriveMinute).toBe(450)
  })

  it('does not mark slots covered when the existing halt is far away', () => {
    const nearStart = { lat: 22.80, lng: 88.37 } // ~25 km in — arrives ~45 min in
    const day: ItineraryDay = {
      id: 'day0', index: 0,
      stops: [foodStop(nearStart, 1), anchorStop('Siliguri', SILIGURI, 2)],
    }
    const plan = planRide(day, trip)
    expect(plan.breaks.some(b => b.alreadyStopped)).toBe(false)
  })
})

describe('ride start time', () => {
  it('computes halt clock times and the finish clock from the day start', () => {
    const plan = planRide(plainDay(), trip)
    expect(plan.startClock).toBe('08:30')
    // halt 1 falls 150 wheel-minutes in
    expect(plan.breaks[0].clock).toBe(addMinutesToClock(hmToMinutesSafe('08:30'), 150))
    expect(plan.finishClock).toBe(addMinutesToClock(hmToMinutesSafe('08:30'), Math.round(plan.driveMinutes)))
    expect(plan.finishWithBreaks).toBe(addMinutesToClock(hmToMinutesSafe('08:30'), Math.round(plan.driveMinutes) + plan.breakMinutes))
  })

  it('shifts every clock when the rider starts before dawn', () => {
    const plan = planRide(plainDay('05:00'), trip)
    expect(plan.startClock).toBe('05:00')
    expect(plan.breaks[0].clock).toBe('07:30') // 05:00 + 2h30m of riding
  })
})

describe('engine integration', () => {
  it('simulateDay honours a per-day start time and falls back to the default', () => {
    const early = simulateDay(plainDay('06:00'), trip, originOf(trip, 0), 0)
    expect(early.startsAt).toBe('06:00')
    expect(early.arrivalTimes[0]).toBe(addMinutesToClock(6 * 60, Math.round(early.legs[0].durationMinutes)))

    const def = simulateDay(plainDay(), trip, originOf(trip, 0), 0)
    expect(def.startsAt).toBe('08:30')
    expect(def.arrivalTimes[0]).toBe(addMinutesToClock(hmToMinutesSafe('08:30'), Math.round(def.legs[0].durationMinutes)))
  })

  it('flags a fatigue warning on 7 h+ self-drive days without a halt', () => {
    const warnings = collectWarnings(trip)
    const fatigue = warnings.find(w => w.code === 'fatigue')
    expect(fatigue?.severity).toBe('high')
    expect(fatigue?.fix).toMatch(/long-ride planner/)
  })

  it('stays quiet about fatigue once the day has a proper halt', () => {
    const day: ItineraryDay = {
      id: 'day0', index: 0,
      stops: [foodStop(MIDPOINT, 1), anchorStop('Siliguri', SILIGURI, 2)],
    }
    expect(collectWarnings(makeTrip(day)).some(w => w.code === 'fatigue')).toBe(false)
  })
})

/** Local hmToMinutes to keep clock assertions readable. */
function hmToMinutesSafe(hm: string): number {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

// ============ Route-day overlays (multi-day drives) ============

/** Two-day Kolkata → Siliguri round trip: Day 1 holds the start anchor, Day 2 the destination anchor. */
function makeTwoDayTrip(roundTrip?: boolean): Trip {
  return {
    ...makeTrip(plainDay()),
    ...(roundTrip === undefined ? {} : { roundTrip }),
    days: [
      { id: 'd0', index: 0, stops: [anchorStop('Kolkata', KOLKATA)] },
      { id: 'd1', index: 1, stops: [anchorStop('Siliguri', SILIGURI)] },
    ],
  }
}

describe('return drive day (round trip)', () => {
  it('plans the ride back home on Day 2 instead of replaying the outbound leg', () => {
    const t = makeTwoDayTrip(true)
    const plan = planRide(t.days[1], t)
    expect(plan.isLongRide).toBe(true)
    expect(plan.isReturnDrive).toBe(true)
    expect(plan.isOutboundDrive).toBe(false)
    expect(plan.targetLabel).toBe('Kolkata')
    expect(plan.driveMinutes).toBeCloseTo(expectedDrive, 0)
    expect(plan.distanceKm).toBeGreaterThan(500)
    // halts append after the destination anchor (index 1) — inserting before it
    // would plan an out-and-back and wreck the wheel time
    for (const b of plan.breaks) expect(b.insertAt).toBe(1)
  })

  it('keeps Day 1 outbound on the same trip', () => {
    const t = makeTwoDayTrip(true)
    const plan = planRide(t.days[0], t)
    expect(plan.isOutboundDrive).toBe(true)
    expect(plan.isReturnDrive).toBe(false)
    expect(plan.targetLabel).toBe('Siliguri')
  })

  it('does not turn the destination day into a return drive on a one-way trip', () => {
    const t = makeTwoDayTrip(false)
    const plan = planRide(t.days[1], t)
    // no return overlay — a one-way trip has no drive home. (The day's plain
    // chain still replays the outbound leg — pre-existing one-way behaviour,
    // out of scope here.)
    expect(plan.isReturnDrive).toBe(false)
  })

  it('does not turn a single-day round trip into a return drive', () => {
    const plan = planRide(plainDay(), trip)
    expect(plan.isReturnDrive).toBe(false)
    expect(plan.isLongRide).toBe(true)
  })
})

describe('halts on route days', () => {
  it('carries a planned outbound halt inside the overlay drive at the right splice point', () => {
    const t = makeTwoDayTrip(true)
    const quarter = {
      lat: KOLKATA.lat + (SILIGURI.lat - KOLKATA.lat) / 4,
      lng: KOLKATA.lng + (SILIGURI.lng - KOLKATA.lng) / 4,
    }
    const day: ItineraryDay = {
      id: 'd0', index: 0,
      stops: [anchorStop('Kolkata', KOLKATA), foodStop(quarter, 2)],
    }
    const plan = planRide(day, t)
    expect(plan.isOutboundDrive).toBe(true)
    expect(plan.distanceKm).toBeGreaterThan(500)
    expect(plan.driveMinutes).toBeGreaterThan(expectedDrive * 0.9)
    // the halt rides the leg that ends at it → splices after the start anchor
    expect(plan.breaks[0].insertAt).toBe(1)
  })

  it('marks an existing return-day halt as covering a nearby slot', () => {
    const t = makeTwoDayTrip(true)
    const day: ItineraryDay = {
      id: 'd1', index: 1,
      stops: [anchorStop('Siliguri', SILIGURI), foodStop(MIDPOINT, 2)],
    }
    const plan = planRide(day, t)
    expect(plan.isReturnDrive).toBe(true)
    expect(plan.breaks.some(b => b.alreadyStopped)).toBe(true)
  })
})

describe('custom ride style', () => {
  it('places exactly the requested number of halts, evenly spaced', () => {
    const plan = planRide(plainDay(), trip, undefined, 'custom', 3)
    expect(plan.style).toBe('custom')
    expect(plan.breaks).toHaveLength(3)
    const gap = plan.breaks[1].atDriveMinute - plan.breaks[0].atDriveMinute
    expect(gap).toBeGreaterThan(0)
    expect(plan.breaks[2].atDriveMinute - plan.breaks[1].atDriveMinute).toBeCloseTo(gap, -1)
    expect(plan.breaks[0].atDriveMinute).toBeGreaterThanOrEqual(60) // past the lead-in window
    expect(plan.breaks[2].atDriveMinute).toBeLessThan(plan.driveMinutes)
  })

  it('defaults to two halts with one meal among them', () => {
    const plan = planRide(plainDay(), trip, undefined, 'custom')
    expect(plan.breaks).toHaveLength(2)
    expect(plan.breaks.filter(b => b.kind === 'meal')).toHaveLength(1)
  })

  it('caps the requested halt count at MAX_BREAKS', () => {
    const plan = planRide(plainDay(), trip, undefined, 'custom', 99)
    expect(plan.breaks.length).toBeLessThanOrEqual(MAX_BREAKS)
    expect(plan.breaks.length).toBeGreaterThanOrEqual(3)
  })
})

