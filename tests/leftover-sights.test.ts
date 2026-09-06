// See & do must show unassigned corridor hits — the halt planner only makes
// fuel/meal/rest/stretch/overnight segments, so without this the column is
// empty by construction.
import { describe, it, expect } from 'vitest'
import { leftoverAsSight, type SegmentHit } from '../src/lib/ridePlan'
import type { PlaceHit } from '../src/lib/providers/hits'

const anchors = [{ lat: 0, lng: 0 }, { lat: 5, lng: 0 }]

function hit(id: string, alongKm: number): PlaceHit {
  return { id, name: id, latitude: alongKm / 111.32, longitude: 0, kind: 'poi', category: 'sightseeing', alongRouteKm: alongKm }
}

function assigned(ids: string[]): SegmentHit[] {
  return ids.map((id, i) => ({
    segment: {
      index: i, purpose: 'meal', label: 'Lunch', targetKm: 300,
      minKm: 225, maxKm: 375, kmFromPrev: 300, minutesFromPrev: 200, hint: '',
    },
    hit: hit(id, 300), score: 10,
  }))
}

describe('leftoverAsSight', () => {
  it('wraps unassigned hits as sight segments at their road position', () => {
    const out = leftoverAsSight([hit('used', 300), hit('free', 500)], assigned(['used']), anchors, {})
    expect(out.map(r => r.hit!.id)).toEqual(['free'])
    expect(out[0].segment.purpose).toBe('sight')
    expect(out[0].segment.targetKm).toBeCloseTo(500, 5)
  })

  it('returns nothing when everything is assigned', () => {
    expect(leftoverAsSight([hit('used', 300)], assigned(['used']), anchors, {})).toEqual([])
  })

  it('caps the column', () => {
    const many = Array.from({ length: 20 }, (_, i) => hit(`h${i}`, 100 + i * 10))
    expect(leftoverAsSight(many, [], anchors, {}, 8)).toHaveLength(8)
  })
})
