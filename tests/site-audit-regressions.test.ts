import { describe, it, expect } from 'vitest'
import { seedData } from '../src/data/seed'
import type { Trip } from '../src/data/types'
import { buildJourney, computeHealth, flightFareInrPerPerson, groundAssumptions, legBetween, legKey, originOf, predecessorOf, resolveAirports } from '../src/lib/engine'
import { parseTripImport } from '../src/lib/tripImport'
import { buildTripExport } from '../src/lib/itinerarySpec'
import { encodeTripSnapshot, decodeTripSnapshot } from '../src/lib/snapshot'
import { buildPrintModel } from '../src/lib/printModel'
import { buildIcs } from '../src/lib/ics'
import { estimateTripStarter } from '../src/lib/tripStarter'
import { settingsPreview } from '../src/lib/settingsPreview'

const delhi = { lat: 28.6139, lng: 77.209 }
const mumbai = { lat: 18.922, lng: 72.834 }
function flightTrip(): Trip {
  return { ...structuredClone(seedData.trips[0]), name: 'Flight check', startLocation: 'Delhi',
    startLocationCoords: delhi, destinations: ['Mumbai'], destinationCoords: [mumbai],
    startDate: '2026-12-31', endDate: '2027-01-01', transportMode: 'flight', roundTrip: false,
    days: [0, 1].map(index => ({ id: `d${index}`, index, stops: [] })), expenses: [], fixedCommitments: [],
    flights: [{ id: 'f1', dayIndex: 0, fromAirport: 'DEL', toAirport: 'BOM',
      departAt: '23:00', arriveAt: '01:15', costInrPerPerson: 5000, flightNumber: 'TEST123', notes: 'Gate check' }],
  }
}

describe('flight backup and snapshot preservation', () => {
  it('imports fares, clocks, notes, partial flights, and transport preferences', () => {
    const t = flightTrip()
    t.flights!.push({ id: 'f2', dayIndex: 1, fromAirport: 'BOM', toAirport: 'DEL' })
    Object.assign(t, { tankL: 30, rentPerDayInr: 1800, localTrain: false })
    const back = parseTripImport(JSON.stringify(buildTripExport(t))).trip
    expect(back.flights).toHaveLength(2)
    expect(back.flights![0]).toMatchObject({ ...t.flights![0], id: expect.any(String) })
    expect(back.flights![0].id).not.toBe('f1')
    expect(back).toMatchObject({ tankL: 30, rentPerDayInr: 1800, localTrain: false })
  })
  it('remaps flight references when imported day indexes change', () => {
    const t = flightTrip()
    t.days[0].index = 5
    t.days[1].index = 8
    t.flights![0].dayIndex = 5
    expect(parseTripImport(JSON.stringify(t)).trip.flights![0].dayIndex).toBe(0)
  })
  it('retains flight identities in clean snapshots', async () => {
    const t = flightTrip()
    const back = await decodeTripSnapshot(await encodeTripSnapshot(t))
    expect(back.flights).toEqual(t.flights)
  })
  it('drops bad days and sanitizes invalid clocks and fares', () => {
    const t = flightTrip()
    t.flights!.push({ ...t.flights![0], id: 'bad', dayIndex: 9 })
    t.flights![0].departAt = '28:99'
    t.flights![0].costInrPerPerson = -2
    const back = parseTripImport(JSON.stringify(t)).trip
    expect(back.flights).toHaveLength(1)
    expect(back.flights![0].departAt).toBeUndefined()
    expect(back.flights![0].costInrPerPerson).toBeUndefined()
  })
})

describe('journey consumers after a flight', () => {
  it('inserts new stops from the actual arrival city', () => {
    const t = flightTrip()
    expect(predecessorOf(t, 1)?.point).toEqual(originOf(t, 1))
    expect(predecessorOf(t, 1)?.name).toBe('Mumbai')
  })
  it('does not invent an insertion origin for an unplaced trip', () => {
    const t = flightTrip()
    t.startLocationCoords = undefined
    t.flights = []
    expect(predecessorOf(t, 1)).toBeNull()
  })
  it('prints every flight and transfer once, with matching travel totals', () => {
    const t = flightTrip()
    const model = buildPrintModel(t)
    const legs = model.days[0].rows.filter(r => r.kind === 'leg')
    expect(legs.some(r => r.kind === 'leg' && r.leg.kind === 'air')).toBe(true)
    expect(legs.reduce((sum, r) => sum + (r.kind === 'leg' ? r.leg.durationMinutes : 0), 0))
      .toBeCloseTo(model.days[0].totalTravelMinutes)
    expect(model.days[1].routeLine).toBe('Based in Mumbai')
    expect(model.assumptionsLine).toContain('Per-person flight fares')
    expect(legs.find(r => r.kind === 'leg' && r.leg.kind === 'air')).toMatchObject({ leg: { flightNumber: 'TEST123', estimated: false } })
    t.flights = []
    expect(buildPrintModel(t).days[0].rows.find(r => r.kind === 'leg' && r.leg.kind === 'air')).toMatchObject({ leg: { estimated: true } })
  })
  it('exports recorded overnight flights with timed arrival on the next date', () => {
    const text = buildIcs(flightTrip()).replace(/\r\n /g, '')
    expect(text).toContain('DTSTART:20261231T230000')
    expect(text).toContain('DTEND:20270101T011500')
    expect(text).toContain('Flight TEST123')
    expect(text).not.toContain('driving')
  })
  it('skips invalid departure clocks without inventing a timed flight', () => {
    const t = flightTrip()
    t.flights![0].departAt = '24:00'
    expect(buildIcs(t)).not.toContain('-flight-f1@')
  })
})

describe('flight starter pricing', () => {
  const input = { startDate: '2026-12-31', endDate: '2027-01-01', travellers: 1,
    mode: 'flight' as const, orderedPoints: [delhi, mumbai], returnCount: 0, roundTrip: false, stayStyle: 'comfort' as const }
  it('charges per-head fares and shared ground transfers using engine assumptions', () => {
    const t = flightTrip()
    const airports = resolveAirports(t.flights![0], delhi, mumbai)!
    const fare = flightFareInrPerPerson({ ...t.flights![0], costInrPerPerson: undefined }, airports.from, airports.to)
    const ga = groundAssumptions(t)
    const groundKm = legBetween(delhi, airports.from, ga).distanceKm + legBetween(airports.to, mumbai, ga).distanceKm
    const one = estimateTripStarter(input)
    const four = estimateTripStarter({ ...input, travellers: 4 })
    expect(one.transportCost).toBe(Math.round(fare + groundKm * ga.inrPerKm!))
    expect(four.transportCost).toBe(Math.round(4 * fare + groundKm * ga.inrPerKm!))
  })
  it('keeps an incomplete route unpriced', () => {
    expect(estimateTripStarter({ ...input, orderedPoints: [delhi, null, mumbai] }).transportCost).toBeNull()
  })
})

describe('settings preview consistency', () => {
  it('matches Overview with measured roads before edits', () => {
    const t = flightTrip()
    t.transportMode = 'car'
    t.flights = undefined
    const points = buildJourney(t, t.days[0]).points
    const corrections = { [legKey(points[0], points[1])]: { distanceKm: 20, durationMinutes: 30 } }
    expect(settingsPreview(t, {}, t.days, corrections).health).toEqual(computeHealth(t, corrections))
    expect(settingsPreview(t, {}, t.days, corrections).estimated).toBe(false)
    const patch = { destinationCoords: [delhi], driverCount: 2 as const, fuelEconomyKmL: 30, fuelPricePerL: 100 }
    const result = settingsPreview(t, patch, t.days, corrections)
    expect(result.estimated).toBe(true)
    expect(result.health).toEqual(computeHealth({ ...t, ...patch }))
  })
  it('uses the reconciled day grid and all validated draft fields', () => {
    const t = flightTrip()
    const patch = { driverCount: 3 as const, hasVulnerable: true, driveAfterDinnerMin: 90, travellers: 6, budgetPerPersonInr: 1000 }
    const days = [...t.days, { id: 'extra', index: 2, stops: [] }]
    expect(settingsPreview(t, patch, days).health).toEqual(computeHealth({ ...t, ...patch, days }))
  })
})
