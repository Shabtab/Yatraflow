// Horizon 1.2: two-pass assignment.
// Greedy steal: seg1 (fuel@300) grabs S-food@305 because it is close,
// even though S is the only good meal hit for seg2 (meal@310) and
// F-hub@250 serves seg1 fine. One improvement sweep must fix it:
// greedy total 85, optimal total 55.
import { describe, it, expect } from 'vitest'
import { assignSegmentHits, type RideSegment } from '../src/lib/ridePlan'
import type { PlaceHit } from '../src/lib/providers/hits'

function seg(purpose: RideSegment['purpose'], targetKm: number): RideSegment {
  return {
    index: 0, purpose, label: purpose, targetKm,
    minKm: targetKm - 75, maxKm: targetKm + 75,
    kmFromPrev: targetKm, minutesFromPrev: 0, hint: '',
  }
}

function hit(id: string, alongKm: number, category: string): PlaceHit {
  return { id, name: id, latitude: alongKm / 111.32, longitude: 0, kind: 'poi', category, alongRouteKm: alongKm }
}

describe('two-pass assignment', () => {
  it('returns the shared hit to the segment it fits best', () => {
    // Dense anchors along the corridor so straight-line detour is ~0 for all hits;
    // alongRouteKm carries each hit's exact road position.
    const anchors: { lat: number; lng: number }[] = []
    for (let km = 0; km <= 600; km += 25) anchors.push({ lat: km / 111.32, lng: 0 })
    const segments = [seg('fuel', 300), seg('meal', 310)]
    const S = hit('S-food', 305, 'food')
    const F = hit('F-hub', 250, 'transport-hub')
    const res = assignSegmentHits([S, F], segments, anchors)
    expect(res[0].hit!.id).toBe('F-hub')
    expect(res[1].hit!.id).toBe('S-food')
    // Optimal pairing scores 55 before detour residue; greedy without the sweep
    // scores ~85. The sweep must beat greedy.
    expect(res[0].score + res[1].score).toBeLessThan(85)
  })
})
