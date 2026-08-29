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

// ============ Itinerary-gap awareness ============
import { computeCategoryBias } from '../src/lib/engine'
import type { Trip } from '../src/data/types'

function makeTrip(over: Partial<Trip>): Trip {
  return {
    id: 't1', name: 'T', startLocation: 'A', destinations: ['B'],
    startDate: '2026-09-01', endDate: '2026-09-02', travellers: 2,
    transportMode: 'car', budgetPerPersonInr: 10000, travelStyle: 'balanced',
    fixedCommitments: [], days: [], expenses: [], coverEmoji: '🚗',
    visibility: 'private', createdAt: 0, updatedAt: 0,
    ...over,
  } as Trip
}
function gapStop(cat: string, lat = 25, lng = 88) {
  return {
    id: 's_' + Math.random(), title: 'S', category: cat, locationName: 'L', lat, lng,
    description: '', notes: '', visitMinutes: 60, openTime: '', closeTime: '',
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'nice-to-have',
    sourceUrl: '', status: 'confirmed', orderInDay: 1,
  } as never
}
function gapDay(stops: unknown[]) {
  return { index: 0, title: '', stops } as never
}

describe('computeCategoryBias', () => {
  it('a bare itinerary seeds a things-to-do day', () => {
    const bias = computeCategoryBias(makeTrip({}))
    expect(bias.sightseeing).toBeGreaterThanOrEqual(5)
    expect(bias.nature).toBeGreaterThanOrEqual(5)
    expect(bias.food).toBeUndefined() // meals/stays follow base priority, no gap bump
  })

  it('a long self-drive day without a meal stop boosts food', () => {
    // two stops ~330 km apart
    const trip = makeTrip({ days: [gapDay([gapStop('sightseeing', 22.5, 88.3), gapStop('sightseeing', 25.5, 88.2)])] })
    expect(computeCategoryBias(trip).food).toBeGreaterThanOrEqual(5)
  })

  it('a long drive that already has a meal stop gets no food boost', () => {
    const trip = makeTrip({ days: [gapDay([gapStop('sightseeing', 22.5, 88.3), gapStop('food', 24.0, 88.2), gapStop('sightseeing', 25.5, 88.2)])] })
    expect(computeCategoryBias(trip).food).toBeUndefined()
  })

  it('multi-day self-drive without hotel stops boosts stays', () => {
    const trip = makeTrip({ days: [gapDay([gapStop('sightseeing')]), gapDay([gapStop('sightseeing', 25.5, 88.2)])] })
    expect(computeCategoryBias(trip).hotel).toBeGreaterThanOrEqual(5)
    const oneDay = makeTrip({ days: [gapDay([gapStop('sightseeing')])] })
    expect(computeCategoryBias(oneDay).hotel).toBeUndefined()
  })

  it('well-covered categories are demoted', () => {
    const trip = makeTrip({ days: [gapDay([gapStop('food'), gapStop('food', 25.1), gapStop('food', 25.2)])] })
    expect(computeCategoryBias(trip).food).toBeLessThanOrEqual(-4)
  })

  it('non-self-drive trips get no drive/stay gap logic', () => {
    const trip = makeTrip({ transportMode: 'train', days: [gapDay([gapStop('sightseeing', 22.5, 88.3), gapStop('sightseeing', 25.5, 88.2)]), gapDay([gapStop('sightseeing')])] })
    const bias = computeCategoryBias(trip)
    expect(bias.food).toBeUndefined()
    expect(bias.hotel).toBeUndefined()
  })
})

