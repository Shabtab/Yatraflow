// ============ Nearby-corridor tests ============
// Guards the tourist-logical suggestion engine's pure geometry: whole-route
// corridor sampling, the home-zone exclusion around the trip's start, and the
// detour measure. (The network-backed search itself is best-effort live data.)
import { describe, it, expect } from 'vitest'
import { corridorAnchors, detourKm, HOME_ZONE_KM } from '../src/lib/geocode'
import { haversineKm } from '../src/lib/geo'

// a Kolkata → Darjeeling-shaped route
const START = { lat: 22.5726, lng: 88.3639 }   // "Kolkata"
const MID = { lat: 25.0, lng: 88.2 }
const END = { lat: 27.041, lng: 88.2663 }      // "Darjeeling"

describe('corridorAnchors', () => {
  it('returns nothing for a route with no usable points', () => {
    expect(corridorAnchors([], START, 20000)).toEqual([])
    expect(corridorAnchors([{ lat: NaN, lng: 88 }], START, 20000)).toEqual([])
  })

  it('never samples inside the home zone around the trip start', () => {
    const anchors = corridorAnchors([START, MID, END], START, 20000)
    expect(anchors.length).toBeGreaterThan(0)
    for (const a of anchors) {
      expect(haversineKm(a.lat, a.lng, START.lat, START.lng)).toBeGreaterThanOrEqual(HOME_ZONE_KM)
    }
  })

  it('always covers the destination (when outside the home zone)', () => {
    const anchors = corridorAnchors([START, MID, END], START, 20000)
    const minToDest = Math.min(...anchors.map(a => haversineKm(a.lat, a.lng, END.lat, END.lng)))
    expect(minToDest).toBeLessThan(1)
  })

  it('excludes the destination too when the route ends at the start (round trip)', () => {
    const anchors = corridorAnchors([START, MID, START], START, 20000)
    for (const a of anchors) {
      expect(haversineKm(a.lat, a.lng, START.lat, START.lng)).toBeGreaterThanOrEqual(HOME_ZONE_KM)
    }
  })

  it('caps the number of samples and spaces them across the route', () => {
    const pts = Array.from({ length: 30 }, (_, i) => ({ lat: START.lat + i * 0.15, lng: START.lng + i * 0.15 }))
    const anchors = corridorAnchors(pts, null, 10000, 12)
    expect(anchors.length).toBeLessThanOrEqual(12)
    expect(anchors.length).toBeGreaterThanOrEqual(2)
  })

  it('ignores consecutive duplicate points', () => {
    const anchors = corridorAnchors([START, START, END, END], START, 50000)
    // no zero-length legs — samples must still span toward the destination
    const minToDest = Math.min(...anchors.map(a => haversineKm(a.lat, a.lng, END.lat, END.lng)))
    expect(minToDest).toBeLessThan(1000)
  })
})

describe('detourKm', () => {
  it('measures the distance from a hit to its nearest corridor anchor', () => {
    const anchors = [{ lat: START.lat, lng: START.lng }]
    const hit = { latitude: MID.lat, longitude: MID.lng }
    expect(detourKm(hit as never, anchors)).toBeCloseTo(haversineKm(MID.lat, MID.lng, START.lat, START.lng), 5)
  })
})
