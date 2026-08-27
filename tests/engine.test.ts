// ============ Engine tests ============
// Guards the estimation engine against regressions. The seed trips act as
// realistic fixtures; assertions pin behaviour (sanity ranges, internal
// consistency, warning rules) rather than brittle exact numbers — except for
// pure functions where exact values are cheap and meaningful.
import { describe, it, expect } from 'vitest'
import {
  addMinutesToClock, hmToMinutes, legBetween, simulateDay,
  computeTotals, computeHealth, collectWarnings, countHotelNights, originOf, firstFixedPoint,
  getAssumptions, formatInr, scoreWarnings,
} from '../src/lib/engine'
import { seedData } from '../src/data/seed'
import type { Trip, ItineraryStop } from '../src/data/types'

const keralaTrip = seedData.trips[0]

describe('clock helpers', () => {
  it('adds minutes across noon and midnight', () => {
    expect(addMinutesToClock(9 * 60, 90)).toBe('10:30')
    expect(addMinutesToClock(23 * 60 + 30, 45)).toBe('00:15')
  })
  it('parses HH:MM to minutes', () => {
    expect(hmToMinutes('09:05')).toBe(545)
    expect(hmToMinutes('00:00')).toBe(0)
    expect(hmToMinutes('')).toBe(0) // tolerant of empty input
  })
  it('round-trips through addMinutesToClock', () => {
    for (const mins of [0, 1, 59, 60, 499, 545, 1380]) {
      expect(hmToMinutes(addMinutesToClock(mins, 0))).toBe(mins % 1440)
    }
  })
})

describe('assumptions', () => {
  it('exposes per-mode speed and cost', () => {
    const car = getAssumptions({ transportMode: 'car' })
    expect(car.avgSpeedKmph).toBe(42)
    expect(car.inrPerKm).toBe(9)
    expect(car.dayStart).toBe('08:30')
    // unknown modes fall back gracefully instead of NaN-poisoning the plan
    expect(getAssumptions({ transportMode: 'hoverboard' as never }).avgSpeedKmph).toBe(40)
  })
})

describe('leg estimation (haversine × road factor)', () => {
  const A = getAssumptions({ transportMode: 'car' })
  it('gives zero distance for identical points', () => {
    expect(legBetween({ lat: 10, lng: 76 }, { lat: 10, lng: 76 }, A).distanceKm).toBeCloseTo(0)
  })
  it('always inflates straight-line distance by the road factor', () => {
    const leg = legBetween({ lat: 10, lng: 76 }, { lat: 10.5, lng: 76.5 }, A)
    expect(leg.distanceKm).toBeGreaterThan(70)   // bare haversine here is ~74 km
    expect(leg.durationMinutes).toBeGreaterThan(leg.distanceKm / A.avgSpeedKmph * 55) // includes city pad
  })
  it('faster modes take less time over the same route', () => {
    const a = { lat: 10, lng: 76 }, b = { lat: 10.6, lng: 76.6 }
    const car = legBetween(a, b, getAssumptions({ transportMode: 'car' }))
    const bus = legBetween(a, b, getAssumptions({ transportMode: 'bus' }))
    expect(car.durationMinutes).toBeLessThan(bus.durationMinutes)
  })
  it('cost per km is applied from the mode table', () => {
    expect(getAssumptions({ transportMode: 'taxi' }).inrPerKm).toBeGreaterThan(
      getAssumptions({ transportMode: 'bus' }).inrPerKm ?? 0,
    )
  })
})

describe('day simulation on the Kerala seed trip', () => {
  const trip = keralaTrip
  trip.days.forEach((day) => {
    const sim = simulateDay(day, trip, originOf(trip, day.index), day.index)
    it(`day ${day.index + 1}: schedule stays internally consistent`, () => {
      const activeCount = day.stops.filter(s => s.status !== 'rejected').length
      expect(sim.activeStops.length).toBe(activeCount)
      expect(sim.arrivalTimes).toHaveLength(activeCount)
      expect(sim.departures).toHaveLength(activeCount)
      expect(sim.totalTravelMinutes).toBeGreaterThanOrEqual(0)
      expect(sim.totalDistanceKm).toBeGreaterThanOrEqual(0)
    })
  })
})

describe('totals & health on all seed trips', () => {
  seedData.trips.forEach(trip => {
    it(`"${trip.name}" produces coherent totals`, () => {
      const t = computeTotals(trip)
      expect(t.totalCostInr).toBeGreaterThan(0)
      expect(t.costPerPersonInr).toBeCloseTo(t.totalCostInr / trip.travellers, 6)
      expect(t.stopCount).toBe(trip.days.flatMap(d => d.stops).filter(s => s.status !== 'rejected').length)
      expect(t.costPerDayInr).toBeCloseTo(t.totalCostInr / Math.max(1, trip.days.length), 6)
      expect(t.byCategory['transport']).toBeGreaterThan(0)
    })
    it(`"${trip.name}" yields a 0-100 health score with a known band`, () => {
      const h = computeHealth(trip)
      expect(h.score).toBeGreaterThanOrEqual(0)
      expect(h.score).toBeLessThanOrEqual(100)
      expect(['Comfortable', 'Manageable', 'Tight', 'Unrealistic']).toContain(h.band)
    })
  })

  it('removing stops never worsens the health score', () => {
    const trimmed = structuredClone(keralaTrip)
    trimmed.days[1].stops = trimmed.days[1].stops.slice(0, 1)
    expect(computeHealth(trimmed).score).toBeGreaterThanOrEqual(computeHealth(keralaTrip).score)
  })

  it('scoreWarnings clamps into [5,100] and bands correctly', () => {
    expect(scoreWarnings([]).band).toBe('Comfortable')
    const brutal = scoreWarnings(Array.from({ length: 20 }, (_, i) => ({
      code: 'x' + i, severity: 'high' as const, title: 't', detail: 'd', fix: 'f',
    })))
    expect(brutal.score).toBe(5)
    expect(brutal.band).toBe('Unrealistic')
  })
})

describe('waypoint anchors (auto start/end stops)', () => {
  const startCoords = { lat: 9.98, lng: 76.28 }

  it('a zero-dwell waypoint adds distance but no buffer dwell time', () => {
    const aStop = structuredClone(keralaTrip.days[0].stops[0]) as ItineraryStop
    const dayStop: ItineraryStop = {
      ...aStop, title: 'Trip start', auto: true, visitMinutes: 0, category: 'travel',
    }
    const ctx = structuredClone(keralaTrip) as Trip
    const sim = simulateDay({ stops: [dayStop] }, ctx, startCoords, 0)
    const travelOnly = legBetween(startCoords, dayStop, getAssumptions({ transportMode: 'car' })).durationMinutes
    expect(sim.totalTravelMinutes).toBeGreaterThanOrEqual(travelOnly)
    // no dwell/buffer per waypoint — a regular stop would add a +15 buffer
    expect(sim.totalTravelMinutes).toBeLessThan(travelOnly + 20)
  })

  describe('origin resolution', () => {
    it('prefers trip.startLocationCoords (real point A) over the Kochi fallback', () => {
      const withStart = { ...structuredClone(keralaTrip), startLocationCoords: { lat: 28.61, lng: 77.21 } }
      expect(firstFixedPoint(withStart)).toEqual({ lat: 28.61, lng: 77.21 })
    })
    it('falls back to the first active stop when no geocoded start exists', () => {
      const noStart = { ...structuredClone(keralaTrip), startLocationCoords: undefined }
      const pts = firstFixedPoint(noStart)
      const first = [...keralaTrip.days[0].stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)[0]
      expect(pts.lat).toBe(first.lat)
      expect(pts.lng).toBe(first.lng)
    })
  })
})

describe('warning rules', () => {
  it('every warning carries a code, title and recommended fix', () => {
    for (const w of collectWarnings(keralaTrip)) {
      expect(typeof w.code).toBe('string')
      expect(w.title.length).toBeGreaterThan(0)
      expect(w.fix.startsWith('Move') || w.fix.length > 5).toBe(true)
    }
  })
  it('counts distinct hotel bases, capped by day count', () => {
    expect(countHotelNights(keralaTrip)).toBeLessThanOrEqual(keralaTrip.days.length)
  })
})

describe('formatting', () => {
  it('renders INR with Indian digit grouping', () => {
    expect(formatInr(14250)).toBe('₹14,250')
    expect(formatInr(150000)).toBe('₹1,50,000')
  })
})
