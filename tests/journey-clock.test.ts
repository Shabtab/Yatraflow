// Horizon 2.3: journey clock.
// A 6 AM start puts the km-based "lunch" at ~9:30 AM. Meals must slide into
// the 11:30-14:30 window; unset day starts fall back to 08:30.
import { describe, it, expect } from 'vitest'
import { planRideSegments } from '../src/lib/ridePlan'

const base = { totalKm: 1400, driveMinutes: 1000, includeFuel: false, multiDay: false }

describe('journey clock', () => {
  it('leaves lunch alone for a default 08:30 start', () => {
    const s = planRideSegments(base)
    const lunch = s.find(x => x.label === 'Lunch' || x.purpose === 'meal')!
    expect(lunch.targetKm).toBeCloseTo(300, 0)
    expect(lunch.etaMinutes).toBeDefined()
  })

  it('slides lunch into the 11:30-14:30 window for a 6 AM start', () => {
    const s = planRideSegments({ ...base, dayStartTimes: ['06:00'] })
    const lunch = s.find(x => x.purpose === 'meal')!
    expect(lunch.etaMinutes).toBeDefined()
    expect(lunch.etaMinutes!).toBeGreaterThanOrEqual(685)
    expect(lunch.etaMinutes!).toBeLessThanOrEqual(875)
  })

  it('defaults unset day starts to 08:30', () => {
    const a = planRideSegments(base)
    const b = planRideSegments({ ...base, dayStartTimes: [] })
    expect(a.map(x => x.targetKm)).toEqual(b.map(x => x.targetKm))
  })
})
