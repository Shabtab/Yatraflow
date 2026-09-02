// ============ Engine tests ============
// Guards the estimation engine against regressions. The seed trips act as
// realistic fixtures; assertions pin behaviour (sanity ranges, internal
// consistency, warning rules) rather than brittle exact numbers — except for
// pure functions where exact values are cheap and meaningful.
import { describe, it, expect } from 'vitest'
import {
  addMinutesToClock, hmToMinutes, legBetween, simulateDay,
  computeTotals, computeHealth, collectWarnings, countHotelNights, originOf, firstFixedPoint,
  getAssumptions, formatInr, scoreWarnings, predecessorOf, nextAfter, estimateLeg,
  FUEL_PRICE_INR_PER_L, parseFuelEconomyKmL, isImplausibleFuelEconomy, parseFuelPricePerL,
  isRoundTrip, lastActiveStopPoint, buildJourney, minutesToHM,
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
  it('derives ₹/km from stated fuel economy for self-drive modes', () => {
    const car = getAssumptions({ transportMode: 'car', fuelEconomyKmL: 15 })
    expect(car.kmPerLiter).toBe(15)
    expect(car.fuelPricePerL).toBe(FUEL_PRICE_INR_PER_L)
    expect(car.inrPerKm).toBeCloseTo(FUEL_PRICE_INR_PER_L / 15, 6)
    const bike = getAssumptions({ transportMode: 'motorcycle', fuelEconomyKmL: 35 })
    expect(bike.kmPerLiter).toBe(35)
    expect(bike.inrPerKm).toBeCloseTo(FUEL_PRICE_INR_PER_L / 35, 6)
  })
  it('ignores fuel economy for modes without a fuel tank', () => {
    const train = getAssumptions({ transportMode: 'train', fuelEconomyKmL: 15 })
    expect(train.kmPerLiter).toBeUndefined()
    expect(train.inrPerKm).toBe(1.6)
  })
  it('falls back to the mode table when economy is missing or nonsensical', () => {
    expect(getAssumptions({ transportMode: 'car' }).inrPerKm).toBe(9)
    expect(getAssumptions({ transportMode: 'car', fuelEconomyKmL: 0 }).inrPerKm).toBe(9)
    expect(getAssumptions({ transportMode: 'car', fuelEconomyKmL: -5 }).inrPerKm).toBe(9)
  })
})

describe('fuel-economy-aware costs', () => {
  it('estimateLeg prices legs from the stated economy', () => {
    const a = { lat: 22.5726, lng: 88.3639 }, b = { lat: 21.6627, lng: 87.7833 }
    const leg = estimateLeg(a, b, { transportMode: 'car', fuelEconomyKmL: 20 })
    expect(leg.costInr).toBeCloseTo(leg.distanceKm * (FUEL_PRICE_INR_PER_L / 20), 4)
  })
  it('computeTotals transport category follows the stated economy', () => {
    const eco = { ...structuredClone(keralaTrip), fuelEconomyKmL: 30 }
    const t = computeTotals(eco)
    const A = getAssumptions(eco)
    let legsCost = 0
    eco.days.forEach(d => {
      const sim = simulateDay(d, eco, originOf(eco, d.index), d.index)
      sim.legs.forEach(l => { legsCost += l.distanceKm * (A.inrPerKm ?? 0) })
    })
    // round trip default: the drive back to the start is priced like any leg
    const turnaround = lastActiveStopPoint(eco)
    if (turnaround) legsCost += legBetween(turnaround, firstFixedPoint(eco), A).distanceKm * (A.inrPerKm ?? 0)
    // byCategory['transport'] = distance-derived legs + explicit transport expenses
    const explicit = eco.expenses
      .filter(e => e.category === 'transport')
      .reduce((s, e) => s + (e.perPerson ? e.amountInr * eco.travellers : e.amountInr), 0)
    expect(t.byCategory['transport']).toBeCloseTo(legsCost + explicit, 4)
    // 30 km/L → ₹3.5/km, well under the blended ₹9/km default (same expenses both sides)
    const full = computeTotals(structuredClone(keralaTrip))
    expect(t.byCategory['transport'] ?? 0).toBeLessThan(full.byCategory['transport'] ?? 0)
  })
  it('parseFuelEconomyKmL accepts only sane km/L values', () => {
    expect(parseFuelEconomyKmL('18')).toBe(18)
    expect(parseFuelEconomyKmL('25.5')).toBe(25.5)
    expect(parseFuelEconomyKmL('')).toBeUndefined()
    expect(parseFuelEconomyKmL('0')).toBeUndefined()
    expect(parseFuelEconomyKmL('200')).toBeUndefined()
    expect(parseFuelEconomyKmL('abc')).toBeUndefined()
  })
  it('getAssumptions rejects impossible fuel economy (regression for #2)', () => {
    // 1 km/L and 500 km/L are physically impossible for a car — the engine
    // must ignore them and fall back to the blended ₹9/km table, NOT compute
    // a wildly wrong per-km rate.
    const absurdLow = getAssumptions({ transportMode: 'car', fuelEconomyKmL: 1 })
    const absurdHigh = getAssumptions({ transportMode: 'car', fuelEconomyKmL: 500 })
    expect(absurdLow.inrPerKm).toBe(9)
    expect(absurdHigh.inrPerKm).toBe(9)
    // a sane value still flows through
    expect(getAssumptions({ transportMode: 'car', fuelEconomyKmL: 15 }).inrPerKm).toBeCloseTo(FUEL_PRICE_INR_PER_L / 15, 6)
  })
  it('isImplausibleFuelEconomy flags out-of-band values without blocking', () => {
    expect(isImplausibleFuelEconomy('motorcycle', 5)).toBe(true)
    expect(isImplausibleFuelEconomy('car', 5)).toBe(true)
    expect(isImplausibleFuelEconomy('car', 18)).toBe(false)
    expect(isImplausibleFuelEconomy('motorcycle', 40)).toBe(false)
    expect(isImplausibleFuelEconomy('train', 5)).toBe(false)   // mode without an economy field
    expect(isImplausibleFuelEconomy('car', undefined)).toBe(false)
  })
  it('uses the stated local fuel price, else the indicative default', () => {
    const local = getAssumptions({ transportMode: 'car', fuelEconomyKmL: 15, fuelPricePerL: 92 })
    expect(local.fuelPricePerL).toBe(92)
    expect(local.fuelPriceIsUserSet).toBe(true)
    // engine rounds inrPerKm to 2 decimals (display-friendly; error is < ₹2 on a 500 km trip)
    expect(local.inrPerKm).toBeCloseTo(92 / 15, 2)
    const fallback = getAssumptions({ transportMode: 'car', fuelEconomyKmL: 15 })
    expect(fallback.fuelPricePerL).toBe(FUEL_PRICE_INR_PER_L)
    expect(fallback.fuelPriceIsUserSet).toBe(false)
  })
  it('parseFuelPricePerL accepts only sane rupee-per-litre values', () => {
    expect(parseFuelPricePerL('92.5')).toBe(92.5)
    expect(parseFuelPricePerL('105')).toBe(105)
    expect(parseFuelPricePerL('')).toBeUndefined()
    expect(parseFuelPricePerL('10')).toBeUndefined()    // implausible in any state
    expect(parseFuelPricePerL('300')).toBeUndefined()   // implausible in any state
    expect(parseFuelPricePerL('abc')).toBeUndefined()
  })
  it('isRoundTrip defaults on for self-drive modes and off otherwise', () => {
    expect(isRoundTrip({ transportMode: 'car' })).toBe(true)
    expect(isRoundTrip({ transportMode: 'motorcycle' })).toBe(true)
    expect(isRoundTrip({ transportMode: 'car', roundTrip: false })).toBe(false)
    expect(isRoundTrip({ transportMode: 'train' })).toBe(false)
  })
  it('round trips price the drive back to the start', () => {
    const tRound = computeTotals(structuredClone(keralaTrip))
    const tOneway = computeTotals({ ...structuredClone(keralaTrip), roundTrip: false })
    const extraKm = tRound.totalDistanceKm - tOneway.totalDistanceKm
    expect(extraKm).toBeGreaterThan(0)
    // the extra distance is priced exactly at the mode rate (₹9/km for car)
    expect(tRound.byCategory['transport']! - tOneway.byCategory['transport']!).toBeCloseTo(extraKm * 9, 0)
    // and the return drive also adds travel time
    expect(tRound.totalTravelMinutes).toBeGreaterThan(tOneway.totalTravelMinutes)
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

describe('leg-aware stop insertion', () => {
  // Kolkata → Mandarmani style fixture: start anchor + a Day-1 stop, Day 2 empty-ish
  const trip = {
    ...keralaTrip,
    startLocation: 'Kolkata',
    startLocationCoords: { lat: 22.5726, lng: 88.3639 },
    destinations: ['Mandarmani'],
    destinationCoords: [{ lat: 21.6627, lng: 87.7833 }],
    days: [
      { id: 'd0', index: 0, stops: keralaTrip.days[0]?.stops.slice(0, 1) ?? [] },
      { id: 'd1', index: 1, stops: [] },
    ],
  } as Trip

  it('predecessorOf: last stop of the day wins', () => {
    const p = predecessorOf(trip, 0)
    expect(p).not.toBeNull()
    expect(p!.point).toEqual({ lat: trip.days[0].stops[0].lat, lng: trip.days[0].stops[0].lng })
  })
  it('predecessorOf: falls back to previous day, then the start anchor', () => {
    expect(predecessorOf(trip, 1)!.name).toBe(trip.days[0].stops[0].locationName || trip.days[0].stops[0].title)
    const empty: Trip = { ...trip, days: [{ id: 'd0', index: 0, stops: [] }] }
    const fromStart = predecessorOf(empty, 0)
    expect(fromStart!.name).toBe('Kolkata (start)')
    expect(fromStart!.point).toEqual({ lat: 22.5726, lng: 88.3639 })
  })
  it('predecessorOf: null when no stops, no start coords, no prior days', () => {
    const orphan: Trip = { ...trip, startLocationCoords: undefined, days: [{ id: 'd0', index: 0, stops: [] }] }
    expect(predecessorOf(orphan, 0)).toBeNull()
  })
  it('nextAfter: first stop of a later day wins, else the end anchor', () => {
    const withNext: Trip = { ...trip, days: [trip.days[0], { id: 'd1', index: 1, stops: [{ ...(trip.days[0].stops[0]), id: 'x', locationName: 'Digha', orderInDay: 1 }] }] }
    expect(nextAfter(withNext, 0)!.name).toBe('Digha')
    expect(nextAfter(trip, 0)!.name).toBe('Mandarmani (end)')
  })
  it('nextAfter: null when nothing follows', () => {
    const tail: Trip = { ...trip, destinationCoords: undefined, days: [{ id: 'd0', index: 0, stops: trip.days[0].stops }] }
    expect(nextAfter(tail, 0)).toBeNull()
  })
  it('estimateLeg: zero-distance legs cost nothing', () => {
    const pt = { lat: 22.5726, lng: 88.3639 }
    const leg = estimateLeg(pt, pt, { transportMode: 'car' })
    expect(leg.distanceKm).toBeCloseTo(0)
    expect(leg.costInr).toBeCloseTo(0)
  })
  it('estimateLeg: cost tracks distance at the mode rate', () => {
    const leg = estimateLeg({ lat: 22.5726, lng: 88.3639 }, { lat: 21.6627, lng: 87.7833 }, { transportMode: 'car' })
    expect(leg.distanceKm).toBeGreaterThan(100)  // Kolkata→Mandarmani is ~170 road km
    expect(leg.costInr).toBeCloseTo(leg.distanceKm * 9, 0)
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

  /** Minimal single-day trip so journey synthesis (next-destination lookup) stays out of the way. */
  function bareTrip(): Trip {
    return {
      ...structuredClone(keralaTrip),
      startLocationCoords: startCoords,
      destinationCoords: undefined,
      destinations: [],
      roundTrip: false,
      days: [{ id: 'bd0', index: 0, stops: [] }],
    } as Trip
  }

  it('a start anchor sitting at the origin starts the day — no phantom drive', () => {
    const aStop = structuredClone(keralaTrip.days[0].stops[0]) as ItineraryStop
    const dayStop: ItineraryStop = {
      ...aStop, title: 'Trip start', auto: true, visitMinutes: 0, category: 'travel',
      lat: startCoords.lat, lng: startCoords.lng,
    }
    const sim = simulateDay({ stops: [dayStop] }, bareTrip(), startCoords, 0)
    expect(sim.totalTravelMinutes).toBeLessThan(5)
    expect(sim.totalDistanceKm).toBeCloseTo(0, 0)
  })

  it('a zero-dwell waypoint adds distance but no buffer dwell time', () => {
    const aStop = structuredClone(keralaTrip.days[0].stops[0]) as ItineraryStop
    const far = { lat: startCoords.lat + 0.5, lng: startCoords.lng + 0.5 }
    const wp: ItineraryStop = {
      ...aStop, title: 'Waypoint', auto: true, visitMinutes: 0, category: 'travel',
      lat: far.lat, lng: far.lng,
    }
    const sim = simulateDay({ stops: [wp] }, bareTrip(), startCoords, 0)
    const A = getAssumptions({ transportMode: 'car' })
    expect(sim.totalDistanceKm).toBeGreaterThan(legBetween(startCoords, far, A).distanceKm * 0.9)
    // no dwell/buffer per waypoint — a regular stop would add a +15 buffer
    expect(sim.totalTravelMinutes).toBeLessThan(legBetween(startCoords, far, A).durationMinutes + 5)
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

// ============ Route-day overlays (multi-day drives) ============

const KOLKATA = { lat: 22.5726, lng: 88.3639 }
const SILIGURI = { lat: 26.7271, lng: 88.3953 }

function travelAnchor(name: string, p: { lat: number; lng: number }, orderInDay: number, id: string): ItineraryStop {
  return {
    id, title: name, category: 'travel', locationName: name,
    lat: p.lat, lng: p.lng, visitMinutes: 0,
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'must-do', status: 'confirmed', orderInDay, auto: true,
  }
}

/** Two-day Kolkata → Siliguri drive built on the seed trip's shape. */
function makeKolkataSiliguriTrip(roundTrip?: boolean): Trip {
  const t = structuredClone(keralaTrip)
  t.transportMode = 'car'
  t.roundTrip = roundTrip
  t.startLocation = 'Kolkata'
  t.startLocationCoords = KOLKATA
  t.destinations = ['Siliguri']
  t.destinationCoords = [SILIGURI]
  t.fixedCommitments = []
  t.days = [
    { id: 'kd0', index: 0, stops: [travelAnchor('Kolkata', KOLKATA, 1, 'ka')] },
    { id: 'kd1', index: 1, stops: [travelAnchor('Siliguri', SILIGURI, 1, 'sa')] },
  ] as Trip['days']
  return t
}

// ============ Unified day journeys (one travel system, any distance) ============

function foodStop(p: { lat: number; lng: number }, orderInDay: number, id = 'st_food'): ItineraryStop {
  return {
    id, title: 'Highway dhaba', category: 'food', locationName: 'Highway dhaba',
    lat: p.lat, lng: p.lng, visitMinutes: 40,
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'nice-to-have', status: 'confirmed', orderInDay,
  }
}

const MANDARMANI = { lat: 21.6647, lng: 87.2833 }

/** ~150 km round trip — like Kolkata → Mandarmani, far below the old 350 km floor. */
function makeKolkataMandarmaniTrip(): Trip {
  const t = makeKolkataSiliguriTrip(true)
  t.destinations = ['Mandarmani']
  t.destinationCoords = [MANDARMANI]
  t.days = [
    { id: 'md0', index: 0, stops: [travelAnchor('Kolkata', KOLKATA, 1, 'ma')] },
    { id: 'md1', index: 1, stops: [travelAnchor('Mandarmani', MANDARMANI, 1, 'mb')] },
  ] as Trip['days']
  return t
}

describe('unified day journeys (one travel system, any distance)', () => {
  it('Day 1 of a round trip drives start → destination with a synthesized arrival anchor', () => {
    const t = makeKolkataSiliguriTrip(true)
    const j = buildJourney(t, t.days[0])
    expect(j.direction).toBe('outbound')
    expect(j.startTitle).toBe('Kolkata')
    expect(j.endTitle).toBe('Siliguri')
    expect(j.distanceKm).toBeGreaterThan(450)
    expect(j.driveMinutes).toBeGreaterThan(300)
    expect(j.points.map(p => p.kind)).toEqual(['start', 'destination'])
    expect(j.points[1].synthesized).toBe(true)
    expect(j.arrivalTime).toBe(addMinutesToClock(hmToMinutes(j.startTime), j.driveMinutes))
    expect(j.endsAtStart).toBe(false)
  })

  it('a planned halt sits between start and destination and pushes the arrival later', () => {
    const t = makeKolkataSiliguriTrip(true)
    const quarter = {
      lat: KOLKATA.lat + (SILIGURI.lat - KOLKATA.lat) / 4,
      lng: KOLKATA.lng + (SILIGURI.lng - KOLKATA.lng) / 4,
    }
    t.days[0].stops = [travelAnchor('Kolkata', KOLKATA, 1, 'ka'), foodStop(quarter, 2)]
    const j = buildJourney(t, t.days[0])
    expect(j.points.map(p => p.kind)).toEqual(['start', 'halt', 'destination'])
    expect(j.halts).toHaveLength(1)
    expect(j.distanceKm).toBeGreaterThan(450)          // the halt rides the real route
    expect(j.dwellMinutes).toBe(40 + 15)               // 40 min halt + the engine's per-stop buffer
    expect(j.arrivalTime).toBe(addMinutesToClock(hmToMinutes(j.startTime), j.driveMinutes + j.dwellMinutes))
  })

  it('the return day drives back home and ends at the start', () => {
    const t = makeKolkataSiliguriTrip(true)
    const j = buildJourney(t, t.days[1])
    expect(j.direction).toBe('return')
    expect(j.startTitle).toBe('Siliguri')
    expect(j.endTitle).toBe('Kolkata')
    expect(j.endsAtStart).toBe(true)
    expect(j.distanceKm).toBeGreaterThan(450)
    // the stored Siliguri anchor is the journey's start, not a visited stop
    expect(j.points[0].stop.id).toBe('sa')
  })

  it('simulateDay exposes the destination as an appended active stop with aligned times', () => {
    const t = makeKolkataSiliguriTrip(true)
    const sim = simulateDay(t.days[0], t, originOf(t, 0), 0)
    expect(sim.activeStops).toHaveLength(2)            // start anchor + synthesized destination
    expect(sim.activeStops[1].auto).toBe(true)
    expect(sim.arrivalTimes).toHaveLength(2)
    expect(sim.departures).toHaveLength(2)
    expect(sim.legs).toHaveLength(2)
    expect(sim.totalDistanceKm).toBeGreaterThan(450)   // day-header stats see the real drive now
    expect(sim.endsAt).not.toBe(sim.startsAt)
    expect(sim.endsAt).toBe(sim.arrivalTimes[1])       // the day ends on arrival
  })

  it('works the same below any km threshold — no long-ride special case', () => {
    const t = makeKolkataMandarmaniTrip()
    const j = buildJourney(t, t.days[0])
    expect(j.direction).toBe('outbound')
    expect(j.endTitle).toBe('Mandarmani')
    expect(j.distanceKm).toBeGreaterThan(100)
  })

  it('a one-way trip shows the drive to the destination and prices no drive home', () => {
    const t = makeKolkataSiliguriTrip(false)
    const j0 = buildJourney(t, t.days[0])
    expect(j0.direction).toBe('outbound')
    const j1 = buildJourney(t, t.days[1])
    expect(j1.direction).toBe('local')                 // Day 2 stays put in Siliguri
    expect(j1.startTitle).toBe('Siliguri')
    expect(j1.distanceKm).toBe(0)                      // no replayed drive on the tail day
    expect(j1.points[j1.points.length - 1].synthesized).toBe(false)
    const totals = computeTotals(t)
    // roundTrip: false → no drive home is priced anywhere
    expect(Math.round(totals.totalDistanceKm)).toBe(Math.round(j0.distanceKm + j1.distanceKm))
  })

  it('intermediate days of a round trip stay put — no replayed drive, no phantom return', () => {
    const t = makeKolkataSiliguriTrip(true)
    t.days = [
      { id: 'kd0', index: 0, stops: [travelAnchor('Kolkata', KOLKATA, 1, 'ka')] },
      { id: 'kd1', index: 1, stops: [travelAnchor('Siliguri', SILIGURI, 1, 'sa')] },
      { id: 'kd2', index: 2, stops: [travelAnchor('Siliguri', SILIGURI, 1, 'sb')] },
      { id: 'kd3', index: 3, stops: [travelAnchor('Siliguri', SILIGURI, 1, 'sc')] },
    ] as Trip['days']
    // Days 2–3 hold the destination anchor but are stay days: the drive home
    // belongs to the last day only, and no day replays the outbound drive.
    for (const day of [t.days[1], t.days[2]]) {
      const j = buildJourney(t, day)
      expect(j.direction).toBe('local')
      expect(j.startTitle).toBe('Siliguri')
      expect(j.points.map(p => p.kind)).toEqual(['start'])
      expect(j.distanceKm).toBe(0)
    }
    const last = buildJourney(t, t.days[3])
    expect(last.direction).toBe('return')
    expect(last.endsAtStart).toBe(true)
    // the route is priced exactly twice — out and back — not once per day
    const journeysKm = t.days.reduce((a, d) => a + buildJourney(t, d).distanceKm, 0)
    const totals = computeTotals(t)
    expect(Math.round(totals.totalDistanceKm)).toBe(Math.round(journeysKm))
    expect(Math.round(totals.totalDistanceKm)).toBe(Math.round(2 * buildJourney(t, t.days[0]).distanceKm))
  })

  it('computeTotals counts a planned return day exactly once — no double-counted drive home', () => {
    const t = makeKolkataSiliguriTrip(true)
    const journeysKm = t.days.reduce((a, d) => a + buildJourney(t, d).distanceKm, 0)
    const totals = computeTotals(t)
    expect(Math.round(totals.totalDistanceKm)).toBe(Math.round(journeysKm))
  })

  it('feeds the real drive into travel/fatigue warnings on a departure day', () => {
    const t = makeKolkataSiliguriTrip(true)
    const w = collectWarnings(t)
    // Day 1's stored chain is just the start anchor — the warnings can only
    // come from the unified journey's drive to Siliguri
    expect(w.some(x => x.code === 'fatigue' && x.title.startsWith('Day 1'))).toBe(true)
    expect(w.some(x => x.code === 'travel' && x.title.startsWith('Day 1'))).toBe(true)
  })

  it('keeps an ordinary visit day a plain chain — the destination is not appended onto visits', () => {
    const t = makeKolkataSiliguriTrip(true)
    t.days[0].stops = [
      travelAnchor('Kolkata', KOLKATA, 1, 'ka'),
      { ...foodStop({ lat: 24.5, lng: 88.2 }, 2), category: 'sightseeing', title: 'Planned visit', locationName: 'Planned visit' },
    ]
    const j = buildJourney(t, t.days[0])
    expect(j.points.map(p => p.kind)).toEqual(['start', 'visit'])
    expect(j.endTitle).toBe('Planned visit')
  })
})

describe('minutesToHM — non-finite guard', () => {
  it('renders an em dash instead of NaN for non-finite input', () => {
    expect(minutesToHM(NaN)).toBe('—')
    expect(minutesToHM(Infinity)).toBe('—')
    expect(minutesToHM(45)).toBe('0h 45m')
    expect(minutesToHM(130)).toBe('2h 10m')
  })
})

describe('dirty stop data', () => {
  it('a missing visitMinutes cannot make a day’s dwell or clocks NaN', () => {
    // Simulates a stored row read back without visit_minutes (undefined, not 0).
    const broken = structuredClone(keralaTrip) as Trip
    ;(broken.days[0].stops[1] as { visitMinutes?: number }).visitMinutes = undefined
    const sim = simulateDay(broken.days[0], broken, originOf(broken, 0), 0)
    expect(Number.isFinite(sim.dwellMinutes)).toBe(true)
    expect(sim.arrivalTimes.every(t => !t.includes('NaN'))).toBe(true)
    // The broken stop still counts its buffer as stop time.
    expect(sim.dwellMinutes).toBeGreaterThanOrEqual(getAssumptions(keralaTrip).bufferMinutesPerStop)
  })
})
