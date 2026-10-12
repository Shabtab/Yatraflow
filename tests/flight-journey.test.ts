// ============ A flight-mode day is three legs, not one ============
// The reported defect: with flight selected, the map drew ROAD directions, the
// timeline showed DRIVING time, and the sector was priced at the car's ₹/km over
// great-circle distance. These tests pin the shape that replaces it — home →
// origin airport → sector → the trip's end — and the rule that a flight trip is
// never road-measured.
import { describe, it, expect } from 'vitest'
import {
  buildJourney, computeTotals, journeyGeometry, flightForDay, resolveAirports,
  flightBlockMinutes, flightFareInrPerPerson, isAirMode, isRoadMeasuredMode,
  AIRPORT_CHECKIN_MIN,
} from '../src/lib/engine'
import { nearestAirport, airportByIata } from '../src/lib/air'
import type { Trip, FlightLeg } from '../src/data/types'

const DEL = { lat: 28.5562, lng: 77.1 }
const BOM = { lat: 19.0896, lng: 72.8656 }
/** Central Delhi — deliberately NOT the airport, so the run to the field exists. */
const HOME = { lat: 28.6139, lng: 77.209 }

/** A one-day flight trip, Delhi to Mumbai, with optional recorded flights. */
function flightTrip(flights?: FlightLeg[]): Trip {
  return {
    id: 't1', name: 'Delhi to Mumbai', startLocation: 'Delhi',
    startLocationCoords: HOME,
    destinations: ['Mumbai'], destinationCoords: [BOM],
    startDate: '2026-11-01', endDate: '2026-11-01',
    travellers: 2, transportMode: 'flight', budgetPerPersonInr: 20000,
    travelStyle: 'balanced', fixedCommitments: [], days: [], expenses: [],
    coverEmoji: 'x', visibility: 'private', createdAt: 1, updatedAt: 1,
    ...(flights ? { flights } : {}),
  } as Trip
}

const flight = (over: Partial<FlightLeg> = {}): FlightLeg => ({
  id: 'flt-1', dayIndex: 0, fromAirport: 'DEL', toAirport: 'BOM', ...over,
})

describe('the mode gate', () => {
  it('flight is an air mode and is NOT road-measured', () => {
    expect(isAirMode('flight')).toBe(true)
    // The whole defect: a flight trip used to be measured as a road, so the map
    // drew OSRM's driving directions and the timeline inherited their minutes.
    expect(isRoadMeasuredMode('flight')).toBe(false)
    expect(isAirMode('car')).toBe(false)
    expect(isAirMode(undefined)).toBe(false)
  })
})

describe('resolveAirports', () => {
  it('resolves stored IATA codes', () => {
    const r = resolveAirports(flight(), DEL, BOM)
    expect(r?.from.iata).toBe('DEL')
    expect(r?.to.iata).toBe('BOM')
  })

  it('falls back to the nearest field when a code is unknown', () => {
    const r = resolveAirports(flight({ fromAirport: 'ZZZ' }), DEL, BOM)
    expect(r?.from.iata).toBe('DEL')
    expect(r?.to.iata).toBe('BOM')
  })

  it('is null when an end has no field in range — never an unplaced leg', () => {
    // An unknown code AND no field near the end point: nothing to plan between.
    expect(resolveAirports(flight({ toAirport: 'ZZZ' }), DEL, { lat: 5, lng: 75 })).toBeNull()
  })
})

describe('flightBlockMinutes', () => {
  it('uses the stated departure and arrival when both are given', () => {
    // Domestic sectors are all IST, so the difference IS the block time.
    expect(flightBlockMinutes(flight({ departAt: '06:00', arriveAt: '08:15' }), DEL, BOM)).toBe(135)
  })

  it('handles a red-eye that lands after midnight', () => {
    expect(flightBlockMinutes(flight({ departAt: '23:00', arriveAt: '01:10' }), DEL, BOM)).toBe(130)
  })

  it('falls back to the model when either clock is missing or junk', () => {
    const modelled = flightBlockMinutes(flight(), DEL, BOM)
    expect(modelled).toBeGreaterThan(0)
    expect(flightBlockMinutes(flight({ departAt: '06:00' }), DEL, BOM)).toBe(modelled)
    expect(flightBlockMinutes(flight({ departAt: 'nope', arriveAt: 'x' }), DEL, BOM)).toBe(modelled)
  })
})

describe('flightFareInrPerPerson', () => {
  it('uses the stated fare when the traveller gave one', () => {
    expect(flightFareInrPerPerson(flight({ costInrPerPerson: 4321 }), DEL, BOM)).toBe(4321)
  })

  it('falls back to the indicative estimate, and never to zero', () => {
    const f = flightFareInrPerPerson(flight(), DEL, BOM)
    expect(f).toBeGreaterThan(0)
    expect(flightFareInrPerPerson(flight({ costInrPerPerson: 0 }), DEL, BOM)).toBe(f)
  })
})

describe('buildJourney on a flight-mode day', () => {
  it('walks home → origin airport → sector → destination airport → the trip end', () => {
    const t = flightTrip([flight()])
    t.days = [{ id: 'd0', index: 0, stops: [] }]
    const j = buildJourney(t, t.days[0])
    const kinds = j.points.map(p => p.legIn?.kind)
    // one air leg, and only one
    expect(kinds.filter(k => k === 'air')).toHaveLength(1)
    // the air leg lands on the destination airport
    const airIdx = j.points.findIndex(p => p.legIn?.kind === 'air')
    expect(j.points[airIdx].title).toContain('BOM')
    // and the point before it is the origin airport
    expect(j.points[airIdx - 1].title).toContain('DEL')
    // the journey ends at the trip's destination, past the airport
    expect(j.endTitle).toContain('Mumbai')
  })

  it('times the ground legs with the road model and the sector with block time', () => {
    const t = flightTrip([flight({ departAt: '06:00', arriveAt: '08:15' })])
    t.days = [{ id: 'd0', index: 0, stops: [] }]
    const j = buildJourney(t, t.days[0])
    const air = j.points.find(p => p.legIn?.kind === 'air')!
    expect(air.legIn!.durationMinutes).toBe(135)
    // the run from home to the airport is NOT priced at flight speed — that was
    // the "20 km to the airport costs four minutes" bug
    const toAirport = j.points.find(p => p.title.includes('DEL'))!
    expect(toAirport.legIn!.durationMinutes).toBeGreaterThan(20)
    expect(j.driveMinutes).toBeGreaterThan(135)
  })

  it('prices the sector by fare × travellers, never by ₹/km of great-circle', () => {
    const t = flightTrip([flight({ costInrPerPerson: 4000 })])
    t.travellers = 3
    t.days = [{ id: 'd0', index: 0, stops: [] }]
    const j = buildJourney(t, t.days[0])
    const air = j.points.find(p => p.legIn?.kind === 'air')!
    expect(air.legIn!.costInr).toBe(12000)
    // and the day's transport bill carries the fare
    expect(j.transportCostInr).toBeGreaterThanOrEqual(12000)
  })

  it('still decomposes before any flight is recorded — nearest airports', () => {
    const t = flightTrip()
    t.days = [{ id: 'd0', index: 0, stops: [] }]
    const j = buildJourney(t, t.days[0])
    expect(j.points.some(p => p.legIn?.kind === 'air')).toBe(true)
    expect(j.points.some(p => p.title.includes('DEL'))).toBe(true)
    expect(j.points.some(p => p.title.includes('BOM'))).toBe(true)
  })

  it('does NOT invent a second flight on a sightseeing day', () => {
    const t = flightTrip([flight()])
    t.days = [
      { id: 'd0', index: 0, stops: [] },
      {
        id: 'd1', index: 1, stops: [{
          id: 's1', title: 'Gateway of India', category: 'sightseeing', locationName: 'Gateway of India',
          lat: 18.922, lng: 72.834, visitMinutes: 60, entryFeeInrPerPerson: 0,
          transportCostInrTotal: 0, priority: 'must-do', status: 'confirmed', orderInDay: 0,
        }],
      },
    ]
    const j = buildJourney(t, t.days[1])
    expect(j.points.some(p => p.legIn?.kind === 'air')).toBe(false)
  })

  it('back-computes the start clock from a STATED departure, not an estimate', () => {
    const stated = flightTrip([flight({ departAt: '06:00' })])
    stated.days = [{ id: 'd0', index: 0, stops: [] }]
    const estimated = flightTrip([flight()])
    estimated.days = [{ id: 'd0', index: 0, stops: [] }]
    const a = buildJourney(stated, stated.days[0])
    const b = buildJourney(estimated, estimated.days[0])
    // a 06:00 departure pulls the whole day earlier than the 08:30 default
    expect(a.startTime < b.startTime).toBe(true)
    // and the result is a parseable 24h clock, not a human "3h 28m"
    expect(a.startTime).toMatch(/^\d{2}:\d{2}$/)
    // an estimate never moves the start
    expect(b.startTime).toBe('08:30')
  })
})

describe('computeTotals on a flight trip', () => {
  it('bills the sector as a fare, so the transport line is not ₹/km × great-circle', () => {
    const t = flightTrip([flight({ costInrPerPerson: 5000 })])
    t.travellers = 2
    t.days = [{ id: 'd0', index: 0, stops: [] }]
    const totals = computeTotals(t)
    // 2 travellers × ₹5,000, plus the two ground legs — and NOT 1150 km × 6.5
    expect(totals.byCategory.transport).toBeGreaterThanOrEqual(10000)
  })
})

describe('journeyGeometry', () => {
  it('gives the sector an arc and keeps road legs as chords when unmeasured', () => {
    const t = flightTrip([flight()])
    t.days = [{ id: 'd0', index: 0, stops: [] }]
    const j = buildJourney(t, t.days[0])
    const geo = journeyGeometry(j.points)
    expect(geo).not.toBeNull()
    // an arc is many points; a chord would be two
    expect(geo!.length).toBeGreaterThan(10)
    // starts at home and ends at the trip's destination
    expect(geo![0]).toEqual(HOME)
    expect(geo![geo!.length - 1]).toEqual(BOM)
  })

  it('is null for a journey that never moves', () => {
    const t = flightTrip([flight({ fromAirport: 'BOM', toAirport: 'BOM' })])
    t.days = [{ id: 'd0', index: 0, stops: [] }]
    // start and destination are the same field, and the sector is a no-op
    t.startLocationCoords = { ...BOM }
    const j = buildJourney(t, t.days[0])
    expect(j.points).toHaveLength(1)
    expect(journeyGeometry(j.points)).toBeNull()
  })
})

describe('flightForDay', () => {
  it('finds the flight on its own day and nothing on another', () => {
    const t = flightTrip([flight({ dayIndex: 2 })])
    expect(flightForDay(t, 2)?.id).toBe('flt-1')
    expect(flightForDay(t, 0)).toBeNull()
  })
})

describe('the defaults the UI offers', () => {
  it('agree with what the engine resolves', () => {
    expect(nearestAirport(DEL)?.iata).toBe('DEL')
    expect(airportByIata('BOM')?.city).toBe('Mumbai')
  })

  it('keeps a two-hour check-in window ahead of a stated departure', () => {
    expect(AIRPORT_CHECKIN_MIN).toBe(120)
  })
})
