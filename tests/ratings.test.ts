// Horizon 2.5: ratings in Google mode.
// Highly-rated meal/stay picks outrank geography-only equals.
import { describe, it, expect } from 'vitest'
import { poiTouristScore } from '../src/lib/providers/hits'
import { NEARBY_FIELD_MASK } from '../src/lib/providers/google'
import type { PlaceHit } from '../src/lib/providers/hits'

const anchors = [{ lat: 0, lng: 0 }]

function foodHit(over: Partial<PlaceHit> = {}): PlaceHit {
  return { id: 'f', name: 'F', latitude: 0, longitude: 0, kind: 'poi', category: 'food', ...over }
}

describe('rating boost', () => {
  it('ranks a 4.6-star pick above an unrated equal', () => {
    const rated = poiTouristScore(foodHit({ rating: 4.6, ratingCount: 120 }), anchors, 10000)
    const plain = poiTouristScore(foodHit(), anchors, 10000)
    expect(rated).toBeGreaterThan(plain)
  })

  it('ignores thin review counts', () => {
    const thin = poiTouristScore(foodHit({ rating: 5.0, ratingCount: 1 }), anchors, 10000)
    const plain = poiTouristScore(foodHit(), anchors, 10000)
    expect(thin).toBe(plain)
  })

  it('rewards 4.0+ modestly, 4.5+ strongly', () => {
    const low = poiTouristScore(foodHit({ rating: 4.1, ratingCount: 50 }), anchors, 10000)
    const high = poiTouristScore(foodHit({ rating: 4.7, ratingCount: 50 }), anchors, 10000)
    const plain = poiTouristScore(foodHit(), anchors, 10000)
    expect(low).toBeGreaterThan(plain)
    expect(high).toBeGreaterThan(low)
  })
})

describe('google field mask', () => {
  it('requests rating paths on the same search events', () => {
    expect(NEARBY_FIELD_MASK).toContain('places.rating')
    expect(NEARBY_FIELD_MASK).toContain('places.userRatingCount')
  })
})
