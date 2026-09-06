// Horizon 2.1: crew-aware cadence.
// Relaxed crews and big groups tire faster; packed crews push further.
// Defaults stay 150/300 when no crew facts are given.
import { describe, it, expect } from 'vitest'
import { planRideSegments, cadenceForCrew } from '../src/lib/ridePlan'

describe('cadenceForCrew', () => {
  it('returns defaults with no facts', () => {
    expect(cadenceForCrew()).toEqual({ stretchKm: 150, mealKm: 300 })
  })

  it('shortens cadence for relaxed style', () => {
    expect(cadenceForCrew(2, 'relaxed')).toEqual({ stretchKm: 120, mealKm: 260 })
  })

  it('shortens cadence for big groups', () => {
    expect(cadenceForCrew(6, 'balanced')).toEqual({ stretchKm: 120, mealKm: 260 })
  })

  it('lengthens stretch for packed style', () => {
    expect(cadenceForCrew(2, 'packed')).toEqual({ stretchKm: 180, mealKm: 300 })
  })
})

describe('planRideSegments crew overrides', () => {
  const base = { totalKm: 1400, driveMinutes: 1000, includeFuel: false, multiDay: false }
  it('default first stretch is ~150 km', () => {
    expect(planRideSegments(base)[0].targetKm).toBeCloseTo(150, 0)
  })

  it('relaxed crew first stretch is ~120 km', () => {
    const s = planRideSegments({ ...base, ...cadenceForCrew(2, 'relaxed') })
    expect(s[0].targetKm).toBeCloseTo(120, 0)
  })
})
