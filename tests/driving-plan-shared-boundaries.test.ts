import { describe, expect, it } from 'vitest'
import { planRideSegments, planTravelClock } from '../src/lib/ridePlan'

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
    const clock = planTravelClock(facts)
    expect(clock.verdict).toBe('ok')
    if (clock.verdict !== 'ok') return
    const clockNightHalts = clock.days.flatMap(day => day.nightHaltKm === null ? [] : [day.nightHaltKm])
    const corridor = planRideSegments({ ...facts, multiDay: true })
    const overnightTargets = corridor.filter(segment => segment.purpose === 'overnight').map(segment => segment.targetKm)
    expect(overnightTargets).toEqual(clockNightHalts)
  })
})
