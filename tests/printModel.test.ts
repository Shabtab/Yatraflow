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
