import { describe, expect, it } from 'vitest'
import { assignSegmentHits, deriveDrivingPlan, effectiveDrivingDays, planRideSegments } from '../src/lib/ridePlan'

describe('issue 832 F3 shared driving-plan boundaries', () => {
  it.each([1200, 1500])('the corridor overnight targets match the journey clock for %i wheel minutes', (driveMinutes) => {
    const facts = {
      totalKm: 1400,
      driveMinutes,
      transportMode: 'car',
      travelStyle: 'relaxed',
      driverCount: 1,
      hasVulnerable: true,
      dayStart: '08:30',
      anchors: { dinnerStartMin: 19 * 60, dinnerEndMin: 20 * 60 },
    }
    const plan = deriveDrivingPlan(facts)
    expect(plan.verdict).toBe('ok')
    const clockNightHalts = plan.outbound.flatMap(day => day.nightHaltKm === null ? [] : [day.nightHaltKm])
    const corridor = planRideSegments({ ...facts, dayBoundaries: plan.outbound })
    const overnightTargets = corridor.filter(segment => segment.purpose === 'overnight').map(segment => segment.targetKm)
    expect(plan.outbound).toHaveLength(plan.dayCount)
    expect(clockNightHalts).toHaveLength(plan.dayCount - 1)
    expect(overnightTargets).toEqual(clockNightHalts)
  })

  it('uses the walked boundaries when a late start moves them from the preliminary split', () => {
    const facts = { totalKm: 1400, driveMinutes: 1200, transportMode: 'car', dayStart: '12:00' }
    const plan = deriveDrivingPlan(facts)
    expect(plan.split?.nightHalts).toEqual([700])
    expect(plan.outbound.map(day => Math.round(day.endKm))).toEqual([484, 942, 1400])
    const corridor = planRideSegments({ ...facts, dayBoundaries: plan.outbound })
    expect(corridor.filter(segment => segment.purpose === 'overnight').map(segment => Math.round(segment.targetKm))).toEqual([484, 942])
  })

  it('uses the walked boundaries when per-day rain moves them from the preliminary split', () => {
    const facts = { totalKm: 1400, driveMinutes: 1200, transportMode: 'car', dayRainPct: [90, 10, 10] }
    const plan = deriveDrivingPlan(facts)
    expect(plan.split?.nightHalts).toEqual([700])
    expect(plan.outbound.map(day => Math.round(day.endKm))).toEqual([385, 723, 1062, 1400])
    const corridor = planRideSegments({ ...facts, dayBoundaries: plan.outbound })
    expect(corridor.filter(segment => segment.purpose === 'overnight').map(segment => Math.round(segment.targetKm))).toEqual([385, 723, 1062])
  })

  it('keeps a short late start as an explicit hop', () => {
    const plan = deriveDrivingPlan({ totalKm: 400, driveMinutes: 600, transportMode: 'car', dayStart: '18:00' })
    expect(plan.verdict).toBe('hop')
    expect(plan.dayCount).toBe(1)
    expect(plan.outbound).toHaveLength(1)
    expect(plan.outbound[0].endKm).toBeGreaterThan(0)
  })

  it('keeps a too-late start deferred with no invented day', () => {
    const plan = deriveDrivingPlan({ totalKm: 400, driveMinutes: 600, transportMode: 'car', dayStart: '21:30' })
    expect(plan.verdict).toBe('defer')
    expect(plan.outbound).toEqual([])
  })

  it('keeps effective day spans contiguous after an accepted halt pin', () => {
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
    const segments = planRideSegments({ ...facts, dayBoundaries: plan.outbound, haltPins: { 0: 390 } })
    const effective = effectiveDrivingDays(plan, assignSegmentHits([], segments, []))
    expect(effective[0].endKm).toBe(390)
    expect(effective[0].proposedEndKm).toBeCloseTo(350, 3)
    for (let index = 1; index < effective.length; index++) {
      expect(effective[index].startKm).toBe(effective[index - 1].endKm)
    }
    expect(effective.at(-1)?.endKm).toBe(1400)
  })

  it('uses a saved later-day departure in the shared clock and corridor', () => {
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
    const dayStartTimes = ['08:30', '14:00', '08:30', '08:30']
    const plan = deriveDrivingPlan({ ...facts, dayStartTimes })
    expect(plan.outbound[1].startMin).toBeGreaterThanOrEqual(14 * 60)
    const segments = planRideSegments({ ...facts, dayBoundaries: plan.outbound, dayStartTimes })
    const targets = segments.filter(segment => segment.dayEnd).map(segment => segment.targetKm)
    expect(targets).toEqual(plan.outbound.slice(0, -1).map(day => day.endKm))
    expect(segments.filter(segment => segment.dayEnd).every(segment => Number.isFinite(segment.etaMinutes))).toBe(true)
  })

  it('keeps default dinner anchors when ordinary crew supplies undefined overrides', () => {
    const facts = {
      totalKm: 1400,
      driveMinutes: 1500,
      transportMode: 'car',
      travelStyle: 'relaxed',
      driverCount: 1,
      hasVulnerable: false,
      dayStart: '08:30',
      anchors: { dinnerStartMin: undefined, dinnerEndMin: undefined, allowPostDinnerDriveMin: 0 },
    }
    const plan = deriveDrivingPlan(facts)
    expect(plan.outbound.length).toBeGreaterThan(1)
    expect(plan.outbound.every(day => Number.isFinite(day.startKm) && Number.isFinite(day.endKm))).toBe(true)
    const segments = planRideSegments({ ...facts, dayBoundaries: plan.outbound })
    expect(segments.filter(segment => segment.dayEnd)).toHaveLength(plan.outbound.length - 1)
  })
})
