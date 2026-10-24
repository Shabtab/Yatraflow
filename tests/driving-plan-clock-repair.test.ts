import { describe, expect, it } from 'vitest'
import {
  assignSegmentHits,
  deriveDrivingPlan,
  effectiveDrivingDays,
  planRideSegments,
  type DrivingPlanDay,
} from '../src/lib/ridePlan'

const fourDayFacts = {
  totalKm: 1400,
  driveMinutes: 1500,
  transportMode: 'car',
  travelStyle: 'relaxed',
  driverCount: 1,
  hasVulnerable: true,
  dayStart: '08:30',
  anchors: { dinnerStartMin: 19 * 60, dinnerEndMin: 20 * 60 },
}

function expectCompleteLeg(days: readonly DrivingPlanDay[], totalKm: number) {
  expect(days.length).toBeGreaterThan(0)
  expect(days[0].startKm).toBe(0)
  expect(days.at(-1)?.endKm).toBe(totalKm)
  expect(days.at(-1)?.nightHaltKm).toBeNull()
  for (let index = 1; index < days.length; index++) {
    expect(days[index].startKm).toBe(days[index - 1].endKm)
    expect(days[index].endKm).toBeGreaterThan(days[index].startKm)
  }
}

describe('driving plan clock repairs', () => {
  it('keeps the clock overnight at 1340 km after a late start and rain', () => {
    const facts = {
      ...fourDayFacts,
      driveMinutes: 1200,
      dayStart: '16:00',
      dayRainPct: [0, 90, 90, 90, 90, 90],
    }
    const plan = deriveDrivingPlan(facts)
    expect(plan.verdict).toBe('ok')
    const nightHalts = plan.outbound.flatMap(day => day.nightHaltKm === null ? [] : [day.nightHaltKm])
    expect(nightHalts).toContain(1340)
    const segments = planRideSegments({ ...facts, dayBoundaries: plan.outbound })
    expect(segments.filter(segment => segment.dayEnd).map(segment => segment.targetKm)).toEqual(nightHalts)
    expect(segments.filter(segment => !segment.dayEnd).every(segment => segment.targetKm < 1340)).toBe(true)
    expect(segments.every(segment => segment.targetKm < facts.totalKm)).toBe(true)
    expectCompleteLeg(plan.outbound, facts.totalKm)
  })

  it('keeps exactly four outbound days for the relaxed vulnerable crew', () => {
    const plan = deriveDrivingPlan(fourDayFacts)
    expect(plan.outbound).toHaveLength(4)
    expect(plan.dayCount).toBe(4)
    expectCompleteLeg(plan.outbound, fourDayFacts.totalKm)
  })

  it.each([1340, 1375, 1399])('keeps a valid shared halt at %i km inside the cadence exclusion', endKm => {
    const plan = deriveDrivingPlan(fourDayFacts)
    const boundary = { ...plan.outbound[0], endKm, nightHaltKm: endKm }
    const invalidEnds = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1400, 1500]
    const segments = planRideSegments({
      ...fourDayFacts,
      includeFuel: true,
      dayBoundaries: [boundary, ...invalidEnds.map(endKm => ({ ...boundary, endKm }))],
    })
    const overnights = segments.filter(segment => segment.dayEnd)
    expect(overnights.map(segment => segment.targetKm)).toEqual([endKm])
    expect(overnights[0].minKm).toBeLessThanOrEqual(endKm)
    expect(overnights[0].maxKm).toBeGreaterThanOrEqual(endKm)
    expect(segments.filter(segment => !segment.dayEnd).every(segment => segment.targetKm < 1340)).toBe(true)
  })

  it('reads all four return departures by complete-trip day ordinal', () => {
    const dayStartTimes = ['08:30', '08:30', '08:30', '08:30', '14:00', '14:00', '14:00', '14:00']
    const plan = deriveDrivingPlan({ ...fourDayFacts, roundTrip: true, dayStartTimes })
    expect(plan.outbound).toHaveLength(4)
    expect(plan.return).not.toBeNull()
    const returnDays = plan.return ?? []
    expect(returnDays.slice(0, 4).map(day => day.dayIndex)).toEqual([4, 5, 6, 7])
    expect(returnDays.slice(0, 4).map(day => day.startMin)).toEqual([840, 840, 840, 840])
    expectCompleteLeg(returnDays, fourDayFacts.totalKm)
  })

  it('reads saved departures when late return days extend the leg', () => {
    const dayStartTimes = Array.from({ length: 40 }, (_, index) => index < 4 ? '08:30' : '14:00')
    const plan = deriveDrivingPlan({ ...fourDayFacts, roundTrip: true, dayStartTimes })
    const returnDays = plan.return ?? []
    expect(returnDays.length).toBeGreaterThan(4)
    expect(returnDays.every(day => day.startMin === 840)).toBe(true)
    expectCompleteLeg(returnDays, fourDayFacts.totalKm)
  })

  it.each([undefined, null, '', '14', '14:0', 'bad'])('keeps the default return departure for %s', savedStart => {
    const dayStartTimes = ['08:30', '08:30', '08:30', '08:30', savedStart]
    const plan = deriveDrivingPlan({ ...fourDayFacts, roundTrip: true, dayStartTimes })
    expect(plan.return?.[0].startMin).toBe(510)
    expect(plan.return?.every(day => day.startMin === 510)).toBe(true)
  })

  it('keeps accepted pins and contiguous effective spans', () => {
    const plan = deriveDrivingPlan(fourDayFacts)
    const segments = planRideSegments({ ...fourDayFacts, dayBoundaries: plan.outbound, haltPins: { 0: 390 } })
    const pinned = segments.find(segment => segment.dayEnd)
    expect(pinned?.targetKm).toBe(390)
    expect(pinned?.haltPinned).toBe(true)
    expect(pinned?.haltDriftToKm).toBe(350)
    const effective = effectiveDrivingDays(plan, assignSegmentHits([], segments, []))
    expect(effective[0].endKm).toBe(390)
    expect(effective[0].proposedEndKm).toBe(350)
    expectCompleteLeg(effective, fourDayFacts.totalKm)
  })

  it('keeps both leg endpoints in a round trip', () => {
    const plan = deriveDrivingPlan({ ...fourDayFacts, roundTrip: true })
    expectCompleteLeg(plan.outbound, fourDayFacts.totalKm)
    expectCompleteLeg(plan.return ?? [], fourDayFacts.totalKm)
  })
})
