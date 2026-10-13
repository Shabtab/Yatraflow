import { describe, expect, it } from 'vitest'
import type { FlightLeg, ItineraryStop, Trip } from '../src/data/types'
import { airportByIata } from '../src/lib/air'
import { buildDayCards } from '../src/lib/dayCards'
import {
  buildJourney, collectWarnings, computeTotals, estimateLeg, groundAssumptions, legBetween, legKey, originOf, simulateDay,
} from '../src/lib/engine'

const HOME = { lat: 28.6139, lng: 77.209 }
const STAY = { lat: 18.922, lng: 72.834 }
const DEL = airportByIata('DEL')!
const BOM = airportByIata('BOM')!
const booked: FlightLeg = {
  id: 'flight', dayIndex: 0, fromAirport: 'DEL', toAirport: 'BOM',
  departAt: '06:00', arriveAt: '08:15', costInrPerPerson: 5000,
}

function stop(id: string, point: { lat: number; lng: number }, order: number, auto = true): ItineraryStop {
  return {
    id, title: id, locationName: id, ...point, orderInDay: order, auto,
    category: auto ? 'travel' : 'sightseeing', visitMinutes: auto ? 0 : 60,
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'must-do', status: 'confirmed',
  }
}

function trip(stops: ItineraryStop[] = [], flight: FlightLeg = booked): Trip {
  return {
    id: 'trip', name: 'Flight trip', startLocation: 'Delhi', startLocationCoords: HOME,
    destinations: ['Mumbai'], destinationCoords: [STAY], startDate: '2026-11-01', endDate: '2026-11-01',
    travellers: 2, transportMode: 'flight', budgetPerPersonInr: 20000, travelStyle: 'balanced',
    days: [{ id: 'day', index: 0, stops }], flights: [flight], fixedCommitments: [], expenses: [],
    coverEmoji: 'x', visibility: 'private', createdAt: 1, updatedAt: 1,
  }
}

describe('flight journey regressions', () => {
  it('flies before the destination anchor created with the trip', () => {
    const t = trip([stop('home', HOME, 0), stop('stay', STAY, 1)])
    const j = buildJourney(t, t.days[0])
    expect(j.points.map(p => p.stop.id)).toEqual([
      'home', 'journey_air_0_DEL', 'journey_air_0_BOM', 'stay',
    ])
    expect(j.points.filter(p => p.legIn?.kind === 'air')).toHaveLength(1)
    expect(j.distanceKm).toBeLessThan(1250)
  })

  it('keeps origin visits before the flight and destination visits after it', () => {
    const t = trip([stop('home', HOME, 0), stop('Delhi visit', HOME, 1, false), stop('Mumbai visit', STAY, 2, false)])
    t.days[0].startTime = '02:00'
    const j = buildJourney(t, t.days[0])
    expect(j.points.map(p => p.stop.id)).toEqual([
      'home', 'Delhi visit', 'journey_air_0_DEL', 'journey_air_0_BOM', 'Mumbai visit',
    ])
  })

  it('still estimates the outbound flight when the arrival day has a visit', () => {
    const t = trip([stop('home', HOME, 0), stop('Mumbai visit', STAY, 1, false)])
    t.flights = []
    expect(buildJourney(t, t.days[0]).points.some(p => p.legIn?.kind === 'air')).toBe(true)
  })

  it('keeps airport waiting and stated departure and arrival in the schedule', () => {
    const t = trip()
    const j = buildJourney(t, t.days[0])
    const departure = j.points.find(p => p.stop.id === 'journey_air_0_DEL')!
    const arrival = j.points.find(p => p.legIn?.kind === 'air')!
    expect(departure.arrive).toBe('04:00')
    expect(departure.depart).toBe('06:00')
    expect(departure.dwellMinutes).toBeCloseTo(120, 0)
    expect(arrival.arrive).toBe('08:15')
    expect(j.totalMinutes).toBeCloseTo(j.driveMinutes + departure.dwellMinutes)
  })

  it('waits for a later stated departure after an origin visit', () => {
    const t = trip([stop('Delhi visit', HOME, 0, false), stop('stay', STAY, 1)], {
      ...booked, departAt: '14:00', arriveAt: '16:15',
    })
    const j = buildJourney(t, t.days[0])
    expect(j.points.find(p => p.stop.id === 'journey_air_0_DEL')!.depart).toBe('14:00')
    expect(j.points.find(p => p.legIn?.kind === 'air')!.arrive).toBe('16:15')
  })

  it('warns when origin activities prevent reaching check-in on time', () => {
    const t = trip([stop('Delhi visit', HOME, 0, false), stop('stay', STAY, 1)])
    expect(collectWarnings(t).some(w => w.code === 'flight-checkin' && w.dayIndex === 0)).toBe(true)
  })

  it('handles a flight landing after midnight', () => {
    const t = trip([], { ...booked, departAt: '23:00', arriveAt: '01:15' })
    const j = buildJourney(t, t.days[0])
    expect(j.points.find(p => p.stop.id === 'journey_air_0_DEL')!.depart).toBe('23:00')
    expect(j.points.find(p => p.legIn?.kind === 'air')!.arrive).toBe('01:15')
  })

  it('starts the previous evening for a flight shortly after midnight', () => {
    const t = trip([], { ...booked, departAt: '01:00', arriveAt: '03:15' })
    const j = buildJourney(t, t.days[0])
    expect(j.startTime).toBe('22:28')
    expect(j.points.find(p => p.stop.id === 'journey_air_0_DEL')!.arrive).toBe('23:00')
    expect(j.points.find(p => p.legIn?.kind === 'air')!.arrive).toBe('03:15')
  })

  it('uses corrected ground time when calculating departure from home', () => {
    const t = trip()
    const corrections = { [legKey(HOME, DEL)]: { distanceKm: 22, durationMinutes: 60 } }
    const j = buildJourney(t, t.days[0], corrections)
    expect(j.startTime).toBe('03:00')
    expect(j.points.find(p => p.stop.id === 'journey_air_0_DEL')!.arrive).toBe('04:00')
  })

  it('includes both transfers and one group fare in every cost calculation', () => {
    const t = trip()
    const j = buildJourney(t, t.days[0])
    const ground = groundAssumptions(t)
    const transferCost = (legBetween(HOME, DEL, ground).distanceKm + legBetween(BOM, STAY, ground).distanceKm) * 9
    const expected = 10000 + transferCost
    expect(j.transportCostInr).toBeCloseTo(expected)
    expect(computeTotals(t).byCategory.transport).toBeCloseTo(expected)
    expect(computeTotals(t).byDay[0].transportInr).toBeCloseTo(expected)
    expect(simulateDay(t.days[0], t, HOME, 0).legs).toHaveLength(3)
  })

  it('uses car speed after the flight and on local sightseeing days', () => {
    const t = trip([stop('stay', STAY, 0)])
    const j = buildJourney(t, t.days[0])
    expect(j.points.at(-1)!.legIn!.durationMinutes).toBeCloseTo(legBetween(BOM, STAY, groundAssumptions(t)).durationMinutes)
    const localTrip = trip([stop('local visit', { lat: 19.2, lng: 72.85 }, 0, false)])
    localTrip.startLocationCoords = STAY
    localTrip.flights = []
    const local = buildJourney(localTrip, localTrip.days[0])
    expect(local.points[1].legIn!.durationMinutes).toBeCloseTo(
      legBetween(STAY, localTrip.days[0].stops[0], groundAssumptions(localTrip)).durationMinutes,
    )
  })

  it('preserves stated ground fares without changing the flight fare', () => {
    const stay = { ...stop('stay', STAY, 0), transportCostInrTotal: 750 }
    const t = trip([stay])
    const j = buildJourney(t, t.days[0])
    const expected = 10000 + legBetween(HOME, DEL, groundAssumptions(t)).distanceKm * 9 + 750
    expect(j.transportCostInr).toBeCloseTo(expected)
    expect(computeTotals(t).byCategory.transport).toBeCloseTo(expected)
  })

  it('estimates a new local stop with ground assumptions', () => {
    const t = trip()
    const expected = legBetween(BOM, STAY, groundAssumptions(t))
    expect(estimateLeg(BOM, STAY, t)).toEqual({ ...expected, costInr: expected.distanceKm * 9 })
  })

  it('does not invent an airport excursion on a local stay day', () => {
    const t = trip([stop('stay', STAY, 0)])
    t.startLocationCoords = STAY
    t.flights = []
    expect(buildJourney(t, t.days[0]).points).toHaveLength(1)
  })

  it('carries an empty flight day endpoint into the next morning', () => {
    const t = trip()
    t.destinationCoords = []
    t.destinations = []
    t.days.push({ id: 'next', index: 1, stops: [] })
    expect(originOf(t, 1)).toEqual({ lat: BOM.lat, lng: BOM.lng })
  })

  it('does not treat an airport transfer beside an air leg as backtracking', () => {
    const t = trip([stop('home', HOME, 0), stop('stay', STAY, 1)])
    expect(collectWarnings(t).some(w => w.code === 'backtrack')).toBe(false)
  })

  it('keeps a stated morning departure before destination activities', () => {
    const t = trip([stop('Mumbai visit', STAY, 0, false)])
    const j = buildJourney(t, t.days[0])
    expect(j.points.find(p => p.legIn?.kind === 'air')!.arrive).toBe('08:15')
    expect(collectWarnings(t).some(w => w.code === 'flight-checkin')).toBe(false)
  })
})

describe('flight edits and cached day facts', () => {
  it.each([
    ['departure', { departAt: '10:00', arriveAt: '12:15' }],
    ['fare', { costInrPerPerson: 9000 }],
    ['airport', { toAirport: 'PNQ' }],
    ['removal', null],
  ] as const)('refreshes facts after flight %s changes', (_label, patch) => {
    const t = trip()
    const first = buildDayCards(t, t.days)
    const edited = { ...t, flights: patch ? [{ ...booked, ...patch }] : [] }
    const reused = buildDayCards(edited, edited.days, undefined, first)
    const fresh = buildDayCards(edited, edited.days)
    expect(reused.byDay.get(0)).not.toBe(first.byDay.get(0))
    expect(reused.byDay.get(0)).toEqual(fresh.byDay.get(0))
  })

  it('refreshes group fares when the traveller count changes', () => {
    const t = trip()
    const first = buildDayCards(t, t.days)
    const edited = { ...t, travellers: 3 }
    const next = buildDayCards(edited, edited.days, undefined, first)
    expect(next.byDay.get(0)!.journey.transportCostInr - first.byDay.get(0)!.journey.transportCostInr).toBe(5000)
  })

  it('refreshes a later origin after the previous flight airport changes', () => {
    const t = trip()
    t.destinationCoords = []
    t.destinations = []
    t.days.push({ id: 'next', index: 1, stops: [] })
    const first = buildDayCards(t, t.days)
    const edited = { ...t, flights: [{ ...booked, toAirport: 'PNQ' }] }
    const next = buildDayCards(edited, edited.days, undefined, first)
    expect(next.byDay.get(1)!.origin).not.toEqual(first.byDay.get(1)!.origin)
    expect(next.byDay.get(1)).toEqual(buildDayCards(edited, edited.days).byDay.get(1))
  })
})
