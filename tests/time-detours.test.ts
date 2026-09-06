// Horizon 2.2: detours in time, not km.
// Same 10 km off-route costs a bus more minutes than a car.
// Unknown detours (on-route hits) cost zero.
import { describe, it, expect } from 'vitest'
import { detourMinutes } from '../src/lib/providers/hits'
import { scoreHitForSegment, type RideSegment } from '../src/lib/ridePlan'
import type { PlaceHit } from '../src/lib/providers/hits'

const anchors = [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }]

function offRouteHit(): PlaceHit {
  return { id: 'x', name: 'X', latitude: 0.1, longitude: 0, kind: 'poi', category: 'food', offRouteKm: 10 }
}

describe('detourMinutes', () => {
  it('converts km to minutes at the given speed', () => {
    expect(detourMinutes(offRouteHit(), anchors, 60)).toBeCloseTo(10, 5)
    expect(detourMinutes(offRouteHit(), anchors, 30)).toBeCloseTo(20, 5)
  })

  it('treats unknown detours as on-route zero', () => {
    const h: PlaceHit = { id: 'g', name: 'G', latitude: 0.1, longitude: 0, kind: 'poi', fromGoogleAlongRoute: true }
    expect(detourMinutes(h, anchors, 60)).toBe(0)
  })

  it('falls back to 40 km/h on garbage speed', () => {
    expect(detourMinutes(offRouteHit(), anchors, NaN)).toBeCloseTo(15, 5)
  })
})

describe('scoreHitForSegment time weighting', () => {
  const segment: RideSegment = {
    index: 0, purpose: 'meal', label: 'Lunch', targetKm: 300,
    minKm: 225, maxKm: 375, kmFromPrev: 300, minutesFromPrev: 240, hint: '',
  }

  it('penalizes the same detour more at slower speeds', () => {
    const slow = scoreHitForSegment({ ...offRouteHit(), alongRouteKm: 300 }, segment, anchors, { speedKmph: 30 })
    const fast = scoreHitForSegment({ ...offRouteHit(), alongRouteKm: 300 }, segment, anchors, { speedKmph: 60 })
    expect(slow).not.toBeNull()
    expect(fast).not.toBeNull()
    expect(slow!).toBeGreaterThan(fast!)
  })
})
