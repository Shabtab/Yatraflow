// A college must never fill a fuel halt: need-based purposes (fuel, meal,
// overnight) reject hits with zero purpose-fit instead of assigning the
// least-bad wrong-kind place.
import { describe, it, expect } from 'vitest'
import { planRideSegments, scoreHitForSegment, assignSegmentHits } from '../src/lib/ridePlan'

const anchors = [{ lat: 0, lng: 0 }, { lat: 4, lng: 0 }]

function hitAt(name: string, category: string, lat: number) {
  return { id: name, name, latitude: lat, longitude: 0, kind: 'poi' as const, category }
}

function fuelSeg() {
  const segs = planRideSegments({ totalKm: 400, driveMinutes: 360, includeFuel: true, vehicleRangeKm: 200 })
  const seg = segs.find(s => s.purpose === 'fuel')
  expect(seg).toBeDefined()
  return seg!
}

describe('need-purpose fit gate', () => {
  it('rejects a college for a fuel halt', () => {
    const college = hitAt('Degree College', 'college', 1)
    expect(scoreHitForSegment(college, fuelSeg(), anchors, {})).toBeNull()
  })

  it('rejects a generic sight for meal and overnight halts', () => {
    const segs = planRideSegments({ totalKm: 700, driveMinutes: 560, multiDay: true })
    const meal = segs.find(s => s.purpose === 'meal')!
    const night = segs.find(s => s.purpose === 'overnight')!
    const sight = hitAt('Viewpoint', 'sightseeing', 2)
    expect(meal).toBeDefined()
    expect(night).toBeDefined()
    expect(scoreHitForSegment(sight, meal, anchors, {})).toBeNull()
    expect(scoreHitForSegment(sight, night, anchors, {})).toBeNull()
  })

  it('still accepts real fuel, food and hotel picks', () => {
    const segs = planRideSegments({ totalKm: 700, driveMinutes: 560, multiDay: true, includeFuel: true, vehicleRangeKm: 200 })
    const fuel = segs.find(s => s.purpose === 'fuel')!
    const meal = segs.find(s => s.purpose === 'meal')!
    const night = segs.find(s => s.purpose === 'overnight')!
    expect(scoreHitForSegment(hitAt('Pump', 'transport-hub', 1), fuel, anchors, {})).not.toBeNull()
    expect(scoreHitForSegment(hitAt('Dhaba', 'food', 2), meal, anchors, {})).not.toBeNull()
    expect(scoreHitForSegment(hitAt('Lodge', 'hotel', 3), night, anchors, {})).not.toBeNull()
  })

  it('leaves generic breaks ungated', () => {
    const segs = planRideSegments({ totalKm: 400, driveMinutes: 360 })
    const stretch = segs.find(s => s.purpose === 'stretch')!
    expect(scoreHitForSegment(hitAt('Place', 'sightseeing', 1), stretch, anchors, {})).not.toBeNull()
  })

  it('leaves the fuel segment empty rather than mismatched', () => {
    const seg = fuelSeg()
    const assigned = assignSegmentHits([hitAt('Degree College', 'college', 1)], [seg], anchors, {})
    expect(assigned).toHaveLength(1)
    expect(assigned[0].hit).toBeNull()
  })
})
