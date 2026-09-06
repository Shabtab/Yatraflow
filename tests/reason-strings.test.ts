// Horizon 1.5: reason strings — every suggestion says why.
import { describe, it, expect } from 'vitest'
import { reasonForSegmentHit, reasonForHit, type SegmentHit } from '../src/lib/ridePlan'

function segHit(purpose: SegmentHit['segment']['purpose'], kmFromPrev: number, minutesFromPrev: number, nearestCity?: string): SegmentHit {
  return {
    segment: {
      index: 0, purpose, label: purpose, targetKm: 300,
      minKm: 225, maxKm: 375, kmFromPrev, minutesFromPrev,
      hint: '',
    },
    hit: {
      id: 'h', name: 'Dhaba', latitude: 1, longitude: 0, kind: 'poi',
      ...(nearestCity ? { nearestCity } : {}),
    },
    score: 0,
  }
}

describe('reasonForSegmentHit', () => {
  it('combines fatigue, detour and place slots', () => {
    expect(reasonForSegmentHit(segHit('meal', 300, 240, 'Jaipur'), 8)).toBe(
      'Breaks a 4 h drive · 8 km off-route · near Jaipur',
    )
  })

  it('says on route when detour is unknown', () => {
    expect(reasonForSegmentHit(segHit('stretch', 150, 120), null)).toBe(
      'Breaks a 2 h drive · on route',
    )
  })

  it('uses minutes for short legs', () => {
    expect(reasonForSegmentHit(segHit('stretch', 40, 35), 2)).toBe(
      'Breaks a 35 min drive · 2 km off-route',
    )
  })
})

describe('reasonForHit', () => {
  it('reads annotated hit stamps', () => {
    expect(reasonForHit({
      id: 'h', name: 'Dhaba', latitude: 1, longitude: 0, kind: 'poi',
      legMinutes: 240, offRouteKm: 8, nearestCity: 'Jaipur',
    })).toBe('Breaks a 4 h drive · 8 km off-route · near Jaipur')
  })

  it('returns null without a leg stamp', () => {
    expect(reasonForHit({ id: 'h', name: 'Dhaba', latitude: 1, longitude: 0, kind: 'poi' })).toBeNull()
  })
})
