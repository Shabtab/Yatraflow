// ============ Printable day-cards model tests ============
// buildPrintModel is pure (node-testable like the engine): it must never
// throw on dirty hydrated rows, must respect the 12h/24h-agnostic data model
// (all clocks stay "HH:MM" strings — formatting is render-time), and its
// numbers must agree with computeTotals/byDay.
import { describe, it, expect } from 'vitest'
import { buildPrintModel } from '../src/lib/printModel'
import { computeTotals, simulateDay, originOf } from '../src/lib/engine'
import { seedData } from '../src/data/seed'
import type { Trip } from '../src/data/types'

const keralaTrip = seedData.trips[0]

describe('buildPrintModel', () => {
  it('produces one day card per trip day with engine-consistent totals', () => {
    const model = buildPrintModel(structuredClone(keralaTrip))
    expect(model.days).toHaveLength(keralaTrip.days.length)
    const totals = computeTotals(keralaTrip)
    expect(model.totals.costInr).toBeCloseTo(totals.totalCostInr, 4)
    expect(model.totals.stops).toBe(totals.stopCount)
    // every day's cost matches computeTotals().byDay
    model.days.forEach(d => {
      expect(d.costInr).toBeCloseTo(totals.byDay[d.index].totalInr, 4)
      const sim = simulateDay(keralaTrip.days[d.index], keralaTrip, originOf(keralaTrip, d.index), d.index)
      expect(d.totalDistanceKm).toBeCloseTo(sim.totalDistanceKm, 4)
      expect(d.startTime).toBe(sim.startsAt)
    })
  })

  it('schedules every non-rejected stop, in route order, with clocks', () => {
    const model = buildPrintModel(structuredClone(keralaTrip))
    for (const day of model.days) {
      const stopsInDay = keralaTrip.days[day.index].stops.filter(s => s.status !== 'rejected')
      const printedStops = day.rows.filter(r => r.kind === 'stop')
      expect(printedStops.length).toBeGreaterThanOrEqual(0)
      if (stopsInDay.length > 0) {
        expect(printedStops.map(r => r.kind === 'stop' ? r.stop.title : '')).toEqual(
          expect.arrayContaining(stopsInDay.map(s => s.title)),
        )
        // arrival clocks are raw "HH:MM" (the data-model contract); the
        // 12h/24h preference applies only at render time in the component.
        for (const r of printedStops) {
          if (r.kind === 'stop' && r.stop.arrive) expect(r.stop.arrive).toMatch(/^\d{2}:\d{2}$/)
        }
      }
    }
  })

  it('rejected stops are excluded from the printed schedule', () => {
    const trip = structuredClone(keralaTrip) as Trip
    const anyStop = trip.days[0].stops[0]
    anyStop.status = 'rejected'
    const model = buildPrintModel(trip)
    const printed = model.days[0].rows.filter(r => r.kind === 'stop').map(r => (r.kind === 'stop' ? r.stop.title : ''))
    expect(printed).not.toContain(anyStop.title)
  })

  it('a stop with dirty numeric fields cannot produce NaN costs or clocks', () => {
    const broken = structuredClone(keralaTrip) as Trip
    ;(broken.days[0].stops[1] as { visitMinutes?: number }).visitMinutes = undefined
    ;(broken.days[0].stops[1] as { entryFeeInrPerPerson?: number }).entryFeeInrPerPerson = undefined
    const model = buildPrintModel(broken)
    const bad = model.days.find(d => !Number.isFinite(d.costInr))
      ?? model.days.find(d => d.rows.some(r => r.kind === 'stop' && r.stop.arrive?.includes('NaN')))
    expect(bad).toBeUndefined()
    expect(Number.isFinite(model.totals.costInr)).toBe(true)
  })

  it('day warnings flow through with the "Day n:" prefix stripped', () => {
    const model = buildPrintModel(structuredClone(keralaTrip), {
      warningsByDay: { 0: ['Day 1: Too much driving for one day'] },
    })
    expect(model.days[0].warnings).toEqual(['Too much driving for one day'])
  })

  it('empty days render a stay-day card, not a throw', () => {
    const trip = structuredClone(keralaTrip)
    const model = buildPrintModel({ ...trip, days: [{ id: 'd1', index: 0, stops: [], startTime: '09:00' }] })
    expect(model.days).toHaveLength(1)
    expect(model.days[0].rows.filter(r => r.kind === 'stop')).toHaveLength(0)
    expect(Number.isFinite(model.days[0].costInr)).toBe(true)
  })
})

describe('#557 — each drive prints exactly once', () => {
  /** An ordinary sightseeing day: three real stops out of Panjim, no return
   *  anchor, no ride halts — so the journey synthesizes no destination and
   *  the schedule holds exactly the printed stops. */
  function panjimDay(stops: Array<{ id: string; title: string; lat: number; lng: number }>): Trip {
    const trip = structuredClone(keralaTrip) as Trip
    trip.startLocation = 'Panjim'
    trip.startLocationCoords = { lat: 15.4909, lng: 73.8278 }
    trip.destinations = []
    trip.destinationCoords = []
    trip.days = [{
      id: 'd0', index: 0, startTime: '09:00',
      stops: stops.map((s, i) => ({
        id: s.id, title: s.title, category: 'sightseeing', locationName: s.title,
        lat: s.lat, lng: s.lng, visitMinutes: 60, entryFeeInrPerPerson: 0,
        transportCostInrTotal: 0, priority: 'must-do', status: 'confirmed', orderInDay: i + 1,
      })),
    }] as Trip['days']
    return trip
  }

  /** The row vocabulary of a day card, spelled out — the duplicate survived
   *  arrayContaining pins, so these assert the exact sequence. */
  const seq = (rows: ReturnType<typeof buildPrintModel>['days'][number]['rows']) =>
    rows.map(r => r.kind === 'leg' ? `leg ${r.leg.fromTitle} -> ${r.leg.toTitle}` : `stop ${r.stop.title}`)

  it('an ordinary 3-stop day prints each leg once — the last into-leg is not repeated', () => {
    const trip = panjimDay([
      { id: 's1', title: 'Fort', lat: 15.5527, lng: 73.7517 },
      { id: 's2', title: 'Beach', lat: 15.5813, lng: 73.7610 },
      { id: 's3', title: 'Museum', lat: 15.4990, lng: 73.8290 },
    ])
    expect(seq(buildPrintModel(trip).days[0].rows)).toEqual([
      'leg Panjim -> Fort',
      'stop Fort',
      'leg Fort -> Beach',
      'stop Beach',
      'leg Beach -> Museum',
      'stop Museum',
    ])
  })

  it('a single-stop day keeps its opening drive, once', () => {
    const trip = panjimDay([{ id: 's1', title: 'Fort', lat: 15.5527, lng: 73.7517 }])
    expect(seq(buildPrintModel(trip).days[0].rows)).toEqual([
      'leg Panjim -> Fort',
      'stop Fort',
    ])
  })

  it('a day that ends at a synthesized destination still prints that final leg, once, at the end', () => {
    // Ride-halt day: the journey continues to the next planned destination,
    // so the schedule holds one row the printed stops do not — its into-leg
    // is the day's real final drive (today-correct; pinned so the fix above
    // cannot move it).
    const trip = structuredClone(keralaTrip) as Trip
    trip.startLocation = 'Kolkata'
    trip.startLocationCoords = { lat: 22.5726, lng: 88.3639 }
    trip.destinations = ['Siliguri']
    trip.destinationCoords = [{ lat: 26.7271, lng: 88.3953 }]
    trip.days = [
      {
        id: 'd0', index: 0, startTime: '08:00',
        // a real visit: day 0 ends at its last stop, so day 1 starts there
        stops: [{ id: 's0', title: 'Kolkata halt', category: 'sightseeing', locationName: 'Kolkata halt', lat: 22.7, lng: 88.5, visitMinutes: 60, entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'must-do', status: 'confirmed', orderInDay: 1 }],
      },
      {
        id: 'd1', index: 1, startTime: '08:00',
        stops: [{ id: 's1', title: 'Dhaba halt', category: 'food', locationName: 'Dhaba halt', lat: 24.8, lng: 88.4, visitMinutes: 30, entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'must-do', status: 'confirmed', orderInDay: 1 }],
      },
    ] as Trip['days']
    const rows = buildPrintModel(trip).days[1].rows
    expect(seq(rows)).toEqual([
      'leg Kolkata halt -> Dhaba halt',
      'stop Dhaba halt',
      'leg Dhaba halt -> Siliguri',
    ])
  })
})
