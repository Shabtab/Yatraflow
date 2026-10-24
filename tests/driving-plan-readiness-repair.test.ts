// Lane 2 / #846 — the closing overnight's day attribution.
//
// A closing overnight IS its day's boundary. Attribution used to read the
// candidate's own `cumKm`, so a stay whose candidate sat a few km past the
// boundary filed itself into the NEXT day: the day it closes lost its stay and
// the following day held two nights. These tests pin the boundary rule through
// the real `tripDayAttribution`, `daySlots` and `tripReadiness`.
import { describe, expect, it } from 'vitest'
import { daySlots, tripDayAttribution, tripReadiness, type DaySlotsDeps } from '../src/lib/daySlots'
import {
  assignSegmentHits,
  deriveDrivingPlan,
  effectiveDrivingDays,
  planRideSegments,
  type DrivingPlanDay,
  type RideSegment,
  type SegmentHit,
} from '../src/lib/ridePlan'
import type { PlaceHit } from '../src/lib/providers/hits'
import type { Trip } from '../src/data/types'

/** A minimal engine segment. `dayEnd` marks the closing overnight. */
function seg(purpose: RideSegment['purpose'], targetKm: number, over: Partial<RideSegment> = {}): RideSegment {
  return {
    index: 0,
    purpose,
    label: purpose,
    targetKm,
    minKm: Math.max(0, targetKm - 60),
    maxKm: targetKm + 60,
    kmFromPrev: 100,
    minutesFromPrev: 120,
    hint: '',
    ...over,
  }
}

/** A candidate pinned on the corridor at `cumKm`. */
function hit(id: string, cumKm: number): PlaceHit {
  return {
    id,
    name: id,
    latitude: 10,
    longitude: 76,
    kind: 'poi',
    category: 'food',
    cumKm,
  }
}

function sh(segment: RideSegment, h: PlaceHit | null): SegmentHit {
  return { segment, hit: h, score: 12 }
}

/** The plan's authoritative day projection, positionally aligned with `trip.days`. */
function boundaries(ends: number[]): DrivingPlanDay[] {
  return ends.map((endKm, dayIndex) => ({
    leg: 'outbound' as const,
    dayIndex,
    startKm: dayIndex === 0 ? 0 : ends[dayIndex - 1],
    endKm,
    nightHaltKm: null,
    nightHaltEtaMin: null,
    startMin: 8 * 60 + 30,
  }))
}

/** A four-day trip. `indexes` lets a fixture skip a deleted day. */
function tripOf(indexes: number[]): Trip {
  return {
    id: 'trip-846',
    name: 'Four-day corridor',
    startLocation: 'Kochi',
    destinations: ['Delhi'],
    startDate: '2026-01-01',
    endDate: '2026-01-04',
    travellers: 2,
    transportMode: 'car',
    budgetPerPersonInr: 0,
    days: indexes.map(index => ({ id: `d${index}`, index, stops: [] })),
  } as unknown as Trip
}

const ANCHORS = [{ lat: 10, lng: 76 }]
const DAY_ROAD_KM = [350, 350, 350, 350]

/** The four-day fixture: each day closes at its boundary; day 0's candidate
 *  sits 10 km PAST the boundary it closes. */
function fourDayHalts(): SegmentHit[] {
  return [
    sh(seg('meal', 200, { etaMinutes: 735 }), null),
    sh(seg('overnight', 350, { dayEnd: true, etaMinutes: 1260 }), hit('stay-350', 360)),
    sh(seg('meal', 500, { etaMinutes: 735 }), null),
    sh(seg('overnight', 700, { dayEnd: true, etaMinutes: 1260 }), hit('stay-700', 700)),
    sh(seg('meal', 900, { etaMinutes: 735 }), null),
    sh(seg('overnight', 1050, { dayEnd: true, etaMinutes: 1260 }), hit('stay-1050', 1050)),
    sh(seg('meal', 1200, { etaMinutes: 735 }), null),
  ]
}

function depsFor(haltSegments: SegmentHit[], trip: Trip, planned: DrivingPlanDay[] | null): DaySlotsDeps {
  const attribution = tripDayAttribution(trip, DAY_ROAD_KM, planned)
  return {
    haltSegments,
    dayStops: [],
    anchors: ANCHORS,
    dayOfSegment: attribution.dayOfSegment,
    daySpanKm: attribution.daySpanKm,
  }
}

describe('#846 a closing overnight belongs to the day it closes', () => {
  const trip = tripOf([0, 1, 2, 3])
  const planned = boundaries([350, 700, 1050, 1400])
  const attribution = tripDayAttribution(trip, DAY_ROAD_KM, planned)
  const halts = fourDayHalts()

  it('day 0 retains its closing overnight when the candidate sits past the boundary', () => {
    const slots = daySlots(0, depsFor(halts, trip, planned))
    const stay = slots.find(s => s.key === 'stay')
    expect(stay?.segment?.dayEnd).toBe(true)
    expect(stay?.segment?.targetKm).toBe(350)
  })

  it('day 1 gains no duplicate overnight', () => {
    const closers = halts.filter(s => s.segment.dayEnd && attribution.dayOfSegment(s) === 1)
    expect(closers).toHaveLength(1)
    expect(closers[0].segment.targetKm).toBe(700)
    const stays = daySlots(1, depsFor(halts, trip, planned)).filter(s => s.key === 'stay')
    expect(stays).toHaveLength(1)
    expect(stays[0].segment?.targetKm).toBe(700)
  })

  it('an accepted pin keeps its own attribution', () => {
    // The real chain: a plan, a corridor pinned at 390, and the EFFECTIVE day
    // projection the Map tab hands attribution. Each overnight's candidate sits
    // 12 km past its pinned/derived boundary.
    const facts = {
      totalKm: 1400,
      driveMinutes: 1500,
      transportMode: 'car',
      travelStyle: 'relaxed',
      driverCount: 1,
      hasVulnerable: true,
      dayStart: '08:30',
      anchors: { dinnerStartMin: 19 * 60, dinnerEndMin: 20 * 60 },
    }
    const plan = deriveDrivingPlan(facts)
    const corridor = planRideSegments({ ...facts, dayBoundaries: plan.outbound, haltPins: { 0: 390 } })
    const effective = effectiveDrivingDays(plan, assignSegmentHits([], corridor, []))
    expect(effective[0].endKm).toBe(390)
    const pinnedTrip = tripOf(effective.map((_, i) => i))
    const pinnedAttribution = tripDayAttribution(
      pinnedTrip,
      effective.map(() => 350),
      effective,
    )
    const overnights = corridor.filter(segment => segment.dayEnd)
    expect(overnights.length).toBe(effective.length - 1)
    const annotated = overnights.map((segment, i) => sh(segment, hit(`pin-${i}`, segment.targetKm + 12)))
    for (const [i, s] of annotated.entries()) {
      expect(pinnedAttribution.dayOfSegment(s)).toBe(i)
    }
    const day0 = daySlots(0, {
      haltSegments: annotated,
      dayStops: [],
      anchors: ANCHORS,
      dayOfSegment: pinnedAttribution.dayOfSegment,
      daySpanKm: pinnedAttribution.daySpanKm,
    })
    expect(day0.find(s => s.key === 'stay')?.segment?.targetKm).toBe(390)
  })

  it('ordinary candidate attribution still follows the candidate', () => {
    const ordinary = [
      sh(seg('meal', 200, { etaMinutes: 735 }), hit('meal-340', 340)),
      sh(seg('meal', 300, { etaMinutes: 735 }), hit('meal-380', 380)),
      sh(seg('meal', 600, { etaMinutes: 735 }), hit('meal-600', 600)),
    ]
    expect(attribution.dayOfSegment(ordinary[0])).toBe(0)
    // A plain halt past the boundary keeps following its own distance: only a
    // CLOSING overnight is bound to the boundary it closes.
    expect(attribution.dayOfSegment(ordinary[1])).toBe(1)
    expect(attribution.dayOfSegment(ordinary[2])).toBe(1)
  })

  it('non-contiguous stored day indexes stay keyed by the day’s own index', () => {
    const skipped = tripOf([0, 2, 3, 4])
    const skippedAttribution = tripDayAttribution(skipped, DAY_ROAD_KM, planned)
    expect(skippedAttribution.dayForKm(700)).toBe(2)
    expect(skippedAttribution.dayForKm(350)).toBe(0)
    expect(skippedAttribution.daySpanKm(2)).toEqual({ fromKm: 350, toKm: 700 })
  })

  it('a proposed day with no stored shell stays unassigned', () => {
    // The plan needs five days; the trip stores four. A halt past the last
    // stored boundary must not invent day 5.
    const fiveDayPlan = boundaries([350, 700, 1050, 1400, 1750])
    const proposed = tripDayAttribution(tripOf([0, 1, 2, 3]), DAY_ROAD_KM, fiveDayPlan)
    const proposedHalt = sh(seg('meal', 1600, { etaMinutes: 735 }), hit('meal-1600', 1600))
    expect(proposed.dayOfSegment(proposedHalt)).toBeNull()
    // Past the plan entirely is unassigned too.
    const pastPlan = sh(seg('overnight', 1900, { dayEnd: true }), hit('stay-1900', 1900))
    expect(proposed.dayOfSegment(pastPlan)).toBeNull()
    // ...and no surface grows a day for it.
    const rows = tripReadiness(
      [...fourDayHalts(), proposedHalt, pastPlan],
      [0, 1, 2, 3].map(index => ({ index, stops: [] })),
      {
        haltSegments: [],
        dayStops: [],
        anchors: ANCHORS,
        dayOfSegment: proposed.dayOfSegment,
        daySpanKm: proposed.daySpanKm,
      },
    )
    expect(rows.map(r => r.dayIndex)).toEqual([0, 1, 2, 3])
  })
})
