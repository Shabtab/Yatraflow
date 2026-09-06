// Horizon 2.4: weather join.
// Rainy days downrank exposed sights and uprank sheltered picks;
// cards say so.
import { describe, it, expect } from 'vitest'
import {
  planRideSegments, scoreHitForSegment, reasonForSegmentHit, type RideSegment,
} from '../src/lib/ridePlan'
import type { PlaceHit } from '../src/lib/providers/hits'

const anchors = [{ lat: 0, lng: 0 }, { lat: 5, lng: 0 }]

function segAt(targetKm: number, rainy?: boolean): RideSegment {
  return {
    index: 0, purpose: 'stretch', label: 'Short break', targetKm,
    minKm: targetKm - 75, maxKm: targetKm + 75,
    kmFromPrev: targetKm, minutesFromPrev: 200,
    hint: '', ...(rainy ? { rainy, rainPct: 90 } : {}),
  }
}

function hit(id: string, category: string): PlaceHit {
  return { id, name: id, latitude: 300 / 111.32, longitude: 0, kind: 'poi', category, alongRouteKm: 300 }
}

describe('weather-aware scoring', () => {
  it('prefers sheltered picks on rainy segments', () => {
    const rainy = segAt(300, true)
    const beach = scoreHitForSegment(hit('beach', 'beach'), rainy, anchors, {})
    const museum = scoreHitForSegment(hit('museum', 'museum'), rainy, anchors, {})
    expect(beach).not.toBeNull()
    expect(museum).not.toBeNull()
    expect(museum! < beach!).toBe(true)
  })

  it('leaves dry scoring untouched', () => {
    const dry = segAt(300)
    const beach = scoreHitForSegment(hit('beach', 'beach'), dry, anchors, {})
    const museum = scoreHitForSegment(hit('museum', 'museum'), dry, anchors, {})
    expect(beach).not.toBeNull()
    expect(museum).not.toBeNull()
    // identical positions and base fits on a stretch segment: weather off, scores tie
    expect(beach!).toBe(museum!)
  })
})

describe('planRideSegments day rain', () => {
  it('flags segments on rainy days', () => {
    const s = planRideSegments({
      totalKm: 1400, driveMinutes: 1000, includeFuel: false, multiDay: true,
      dayRainPct: [90, 10],
    })
    expect(s.some(x => x.rainy)).toBe(true)
    expect(s.filter(x => x.targetKm < 550).every(x => x.rainy)).toBe(true)
    expect(s.filter(x => x.targetKm >= 550).every(x => !x.rainy)).toBe(true)
  })
})

describe('rainy reason strings', () => {
  it('calls out the indoor pick', () => {
    const r = reasonForSegmentHit(
      { segment: segAt(300, true), hit: { ...hit('museum', 'museum'), nearestCity: 'Kochi' }, score: 0 },
      2,
    )
    expect(r).toContain('indoor pick — 90% rain')
  })
})
