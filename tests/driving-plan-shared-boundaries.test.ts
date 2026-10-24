import { describe, expect, it } from 'vitest'
import { deriveDrivingPlan, planRideSegments } from '../src/lib/ridePlan'

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
})
