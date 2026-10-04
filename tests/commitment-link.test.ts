import { describe, it, expect } from 'vitest'
import { createTrip, duplicateTrip, linkCommitmentStop } from '../src/store/store'
import { parseTripImport } from '../src/lib/tripImport'
import { commitmentStopIndex } from '../src/lib/engine'
import { seedData } from '../src/data/seed'

const base = seedData.trips[0].days[0].stops[0]

function seedStop(id: string, name: string) {
  return { ...structuredClone(base), id, title: name, locationName: name, lat: 10, lng: 76, orderInDay: 1 }
}

function newTripInput(commitments: Array<{ title: string; type: 'event'; dayIndex: number; time: string; destName?: string }>) {
  return {
    name: 'Link Test', startLocation: 'Kochi', destinations: ['Munnar'],
    startDate: '2026-09-01', endDate: '2026-09-03', travellers: 2,
    transportMode: 'car' as const, budgetPerPersonInr: 5000, travelStyle: 'balanced' as const,
    fixedCommitments: commitments,
  }
}

describe('linkCommitmentStop', () => {
  it('matches the destination name against title or place, any case', () => {
    const stops = [seedStop('a', 'Cochin'), seedStop('b', 'Harbor')]
    expect(linkCommitmentStop(stops, 'harbor')).toBe('b')
    expect(linkCommitmentStop([seedStop('a', 'Jetty')], 'JETTY')).toBe('a')
    expect(linkCommitmentStop(stops, 'Nowhere')).toBeUndefined()
    expect(linkCommitmentStop(stops, '')).toBeUndefined()
  })
})

describe('creation links a commitment to its stop', () => {
  it('a picked destination resolves to the seeded stop id', () => {
    const trip = createTrip('owner-link', newTripInput([
      { title: 'Boarding', type: 'event', dayIndex: 0, time: '12:00', destName: 'Munnar' },
    ]), [[seedStop('seed-m', 'Munnar')]])
    const fc = trip.fixedCommitments[0]
    expect(fc.stopId).toBe('seed-m')
    expect('destName' in fc).toBe(false)
    expect(commitmentStopIndex(trip.days[0].stops, fc)).toBe(0)
  })

  it('an unknown destination stays unlinked', () => {
    const trip = createTrip('owner-link', newTripInput([
      { title: 'Boarding', type: 'event', dayIndex: 0, time: '12:00', destName: 'Nowhere' },
    ]), [[seedStop('seed-m', 'Munnar')]])
    expect(trip.fixedCommitments[0].stopId).toBeUndefined()
  })
})

describe('duplication rewrites the link through fresh stop ids', () => {
  it('the copy links its own stop, not the source one', () => {
    const trip = createTrip('owner-link', newTripInput([
      { title: 'Boarding', type: 'event', dayIndex: 0, time: '12:00', destName: 'Munnar' },
    ]), [[seedStop('seed-m', 'Munnar')]])
    const copy = duplicateTrip(trip, 'owner-link-2')
    const fc = copy.fixedCommitments[0]
    expect(fc.stopId).toBe(copy.days[0].stops[0].id)
    expect(fc.stopId).not.toBe('seed-m')
    expect(commitmentStopIndex(copy.days[0].stops, fc)).toBe(0)
  })
})

describe('import keeps a sound link and drops a dangling one', () => {
  function rawTrip(stopId: string | undefined) {
    return {
      days: [{ index: 0, stops: [{ ...seedStop('st1', 'Jetty'), category: 'transport-hub' }] }],
      fixedCommitments: [{ title: 'Boarding', type: 'event', dayIndex: 0, time: '12:00', stopId }],
    }
  }

  it('a link into the same day survives', () => {
    const parsed = parseTripImport(JSON.stringify({ trip: rawTrip('st1') }))
    expect(parsed.trip.fixedCommitments[0].stopId).toBe('st1')
  })

  it('a dangling link is dropped with a repair note', () => {
    const parsed = parseTripImport(JSON.stringify({ trip: rawTrip('gone') }))
    expect(parsed.trip.fixedCommitments[0].stopId).toBeUndefined()
    expect(parsed.report.repairs.some(r => r.includes('dropped the link'))).toBe(true)
  })
})
