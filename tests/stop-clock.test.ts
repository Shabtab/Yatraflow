import { describe, it, expect } from 'vitest'
import { buildStopClock } from '../src/lib/stopClock'
import { legKey, originOf, simulateDay } from '../src/lib/engine'
import { seedData } from '../src/data/seed'
import type { Trip } from '../src/data/types'

const ORIGIN = { lat: 22.5726, lng: 88.3639 }
const NEAR = { lat: 22.6, lng: 88.4 }
const FAR = { lat: 23.6, lng: 87.4 }

function makeTrip(): Trip {
  const t = structuredClone(seedData.trips[0])
  const base = structuredClone(t.days[0].stops[0])
  const near = { ...base, id: 'near', title: 'Near halt', locationName: 'Near halt', lat: NEAR.lat, lng: NEAR.lng, orderInDay: 1 }
  const far = { ...base, id: 'far', title: 'Far halt', locationName: 'Far halt', lat: FAR.lat, lng: FAR.lng, orderInDay: 2 }
  t.transportMode = 'car'
  t.roundTrip = false
  t.startLocationCoords = ORIGIN
  t.destinations = []
  t.destinationCoords = []
  t.fixedCommitments = []
  t.days = [{ ...structuredClone(t.days[0]), id: 'd0', index: 0, stops: [near, far] }]
  return t
}

describe('pin clocks read the measured schedule (#611)', () => {
  it('every pin arrival matches the Timeline row for the same stop', () => {
    const trip = makeTrip()
    const corrections = { [legKey(NEAR, FAR)]: { distanceKm: 150, durationMinutes: 200 } }
    const sim = simulateDay(trip.days[0], trip, originOf(trip, 0), 0, corrections)
    const clock = buildStopClock(trip, corrections)
    sim.activeStops.forEach((s, i) => {
      if (s.id === 'near' || s.id === 'far') {
        expect(clock.get(s.id)?.arrive).toBe(sim.arrivalTimes[i])
      }
    })
    expect(clock.get('far')?.arrive).not.toBe(simulateDay(trip.days[0], trip, originOf(trip, 0), 0).arrivalTimes[1])
  })

  it('a measured leg reads measured, an uncovered leg reads estimate', () => {
    const trip = makeTrip()
    const plain = buildStopClock(trip)
    expect(plain.get('near')?.estimated).toBe(true)
    expect(plain.get('far')?.estimated).toBe(true)
    const clock = buildStopClock(trip, { [legKey(NEAR, FAR)]: { distanceKm: 150, durationMinutes: 200 } })
    expect(clock.get('near')?.estimated).toBe(true)
    expect(clock.get('far')?.estimated).toBe(false)
  })
})
