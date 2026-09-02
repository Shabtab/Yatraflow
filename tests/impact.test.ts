// ============ Impact-preview tests ============
// Guards the delta math shown in the impact dialog. Regression: the time delta
// summed driving minutes only, so adding a 20-minute halt reported a ~0 time
// extension — the halt's own duration was invisible to the preview.
import { describe, it, expect } from 'vitest'
import { computeImpact } from '../src/lib/impact'
import { getAssumptions } from '../src/lib/engine'
import { seedData } from '../src/data/seed'
import type { Trip, ItineraryStop } from '../src/data/types'

const kerala = seedData.trips[0]
const A = getAssumptions(kerala)

function haltStop(minutes: number): Omit<ItineraryStop, 'id' | 'orderInDay'> {
  const day = kerala.days[0]
  const a = day.stops[0]
  const b = day.stops[1] ?? day.stops[0]
  return {
    title: 'Tea & stretch break', category: 'rest', locationName: 'Ride break en route',
    lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2,
    description: '', notes: '', visitMinutes: minutes, openTime: '', closeTime: '',
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
    priority: 'optional', sourceUrl: '', status: 'confirmed',
  }
}

function withHaltInserted(minutes: number): Trip {
  const proposed = structuredClone(kerala) as Trip
  const day = proposed.days[0]
  day.stops.splice(1, 0, { ...haltStop(minutes), id: 'st_test_halt', orderInDay: 2 })
  day.stops.forEach((s, i) => { s.orderInDay = i + 1 })
  return proposed
}

describe('computeImpact — time on the road', () => {
  it('a halt’s own duration shows up in the time delta', () => {
    const mins = 20
    const impact = computeImpact(kerala, withHaltInserted(mins), 'add', 0)
    // The halt contributes its duration + the engine's per-stop buffer, on top
    // of any extra driving the inserted leg adds. Before the fix this was ~0.
    expect(impact.timeDeltaMin).toBeGreaterThanOrEqual(mins + A.bufferMinutesPerStop)
  })

  it('a longer halt moves the delta further than a short one', () => {
    const short = computeImpact(kerala, withHaltInserted(10), 'add', 0).timeDeltaMin
    const long = computeImpact(kerala, withHaltInserted(60), 'add', 0).timeDeltaMin
    expect(long - short).toBeGreaterThanOrEqual(50)
  })

  it('the duration itself drives the delta, not just the extra leg', () => {
    const zero = computeImpact(kerala, withHaltInserted(0), 'add', 0).timeDeltaMin
    const twenty = computeImpact(kerala, withHaltInserted(20), 'add', 0).timeDeltaMin
    expect(twenty - zero).toBeGreaterThanOrEqual(20)
  })
})