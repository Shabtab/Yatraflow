// ============ The air model: airports, block time, fare, arc ============
// Everything here is a MODEL, not live data — the repo's transparency promise
// requires the numbers it produces to be labelled as estimates on every
// surface that shows them. These tests pin the model so a future change to it
// is a decision rather than a drift.
import { describe, it, expect } from 'vitest'
import {
  INDIAN_AIRPORTS, airportByIata, nearestAirport, nearestAirports,
  airBlockMinutes, airFareEstimateInr, airArc, airDistanceKm,
  AIRPORT_SEARCH_MAX_KM, AIR_FARE_MIN_INR, AIR_FARE_MAX_INR,
} from '../src/lib/air'

const DEL = { lat: 28.5562, lng: 77.1 }
const BOM = { lat: 19.0896, lng: 72.8656 }
const MAA = { lat: 12.9941, lng: 80.1709 }

describe('the airport list', () => {
  it('has unique IATA codes', () => {
    const codes = INDIAN_AIRPORTS.map(a => a.iata)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('has finite coordinates inside India\'s bounding box', () => {
    for (const a of INDIAN_AIRPORTS) {
      expect(a.lat, a.iata).toBeGreaterThan(5)
      expect(a.lat, a.iata).toBeLessThan(37)
      expect(a.lng, a.iata).toBeGreaterThan(68)
      expect(a.lng, a.iata).toBeLessThan(98)
    }
  })

  it('resolves a code case- and whitespace-insensitively', () => {
    expect(airportByIata('del')?.city).toBe('Delhi')
    expect(airportByIata('  BOM ')).not.toBeNull()
    expect(airportByIata('ZZZ')).toBeNull()
    expect(airportByIata('')).toBeNull()
    expect(airportByIata(undefined)).toBeNull()
  })
})

describe('nearestAirport', () => {
  it('picks the closest field to a point', () => {
    expect(nearestAirport(DEL)?.iata).toBe('DEL')
    expect(nearestAirport(BOM)?.iata).toBe('BOM')
  })

  it('returns a shorter list — not a far-away airport — when nothing is in range', () => {
    // The middle of the Indian Ocean: no field within 100 km.
    expect(nearestAirports({ lat: 5, lng: 75 }, 5, 100)).toEqual([])
    expect(nearestAirport({ lat: 5, lng: 75 }, 100)).toBeNull()
  })

  it('returns both fields for a city with two, nearest first', () => {
    // Goa has Dabolim (south) and Mopa (north); a point between them gets both.
    const near = nearestAirports({ lat: 15.55, lng: 73.85 }, 5)
    expect(near.map(a => a.iata)).toContain('GOI')
    expect(near.map(a => a.iata)).toContain('GOX')
    // nearest-first ordering is what lets a UI offer a choice
    expect(near[0].iata === 'GOI' || near[0].iata === 'GOX').toBe(true)
  })

  it('tolerates a null or non-finite point', () => {
    expect(nearestAirport(null)).toBeNull()
    expect(nearestAirport({ lat: Number.NaN, lng: 0 })).toBeNull()
  })
})

describe('airBlockMinutes', () => {
  it('grows with distance and is a multiple of 5', () => {
    const short = airBlockMinutes(DEL, { lat: 26.8242, lng: 75.8122 }) // DEL→JAI
    const long = airBlockMinutes(DEL, MAA) // DEL→MAA
    expect(long).toBeGreaterThan(short)
    expect(short % 5).toBe(0)
    expect(long % 5).toBe(0)
  })

  it('puts a real sector in a plausible band', () => {
    // DEL→BOM is ~1,150 km and blocks ~2 h 05 in practice.
    const min = airBlockMinutes(DEL, BOM)
    expect(min).toBeGreaterThanOrEqual(110)
    expect(min).toBeLessThanOrEqual(150)
  })

  it('is deterministic — the same pair always gives the same number', () => {
    expect(airBlockMinutes(DEL, BOM)).toBe(airBlockMinutes(DEL, BOM))
  })

  it('is zero for a degenerate pair rather than a negative block time', () => {
    expect(airBlockMinutes(DEL, DEL)).toBe(0)
  })
})

describe('airFareEstimateInr', () => {
  it('stays inside the clamp at both extremes', () => {
    expect(airFareEstimateInr(DEL, DEL)).toBe(AIR_FARE_MIN_INR)
    expect(airFareEstimateInr(DEL, { lat: -40, lng: 100 })).toBe(AIR_FARE_MAX_INR)
  })

  it('rises with distance inside the clamp', () => {
    expect(airFareEstimateInr(DEL, MAA)).toBeGreaterThan(airFareEstimateInr(DEL, BOM))
  })
})

describe('airArc', () => {
  it('starts and ends exactly on the endpoints', () => {
    const arc = airArc(DEL, BOM)
    expect(arc[0]).toEqual([DEL.lng, DEL.lat])
    expect(arc[arc.length - 1]).toEqual([BOM.lng, BOM.lat])
  })

  it('returns [lng, lat] pairs, the convention every other geometry uses', () => {
    const arc = airArc(DEL, BOM)
    for (const [lng, lat] of arc) {
      expect(lng).toBeGreaterThan(68)
      expect(lng).toBeLessThan(98)
      expect(lat).toBeGreaterThan(5)
      expect(lat).toBeLessThan(37)
    }
  })

  it('bows off the straight chord — it is a flight path, not a ruler line', () => {
    const arc = airArc(DEL, BOM)
    const [midLng, midLat] = arc[Math.floor(arc.length / 2)]
    // midpoint of the straight chord
    const chordLat = (DEL.lat + BOM.lat) / 2
    const chordLng = (DEL.lng + BOM.lng) / 2
    const off = airDistanceKm({ lat: midLat, lng: midLng }, { lat: chordLat, lng: chordLng })
    expect(off).toBeGreaterThan(1)
  })

  it('is empty for a non-finite endpoint rather than a broken polyline', () => {
    expect(airArc({ lat: Number.NaN, lng: 0 }, BOM)).toEqual([])
  })
})
