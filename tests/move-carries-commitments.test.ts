import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { moveStopToDay, carryStopLinkedRecords } from '../src/lib/stopOrder'
import { commitmentStopIndex } from '../src/lib/engine'
import { seedData } from '../src/data/seed'
import type { ItineraryDay, FixedCommitment, Expense } from '../src/data/types'

const seedStop = seedData.trips[0].days[0].stops[0]

function makeStop(id: string, orderInDay: number) {
  return { ...structuredClone(seedStop), id, title: id, locationName: id, lat: 10, lng: 76, orderInDay }
}

function day(index: number, stopIds: string[]): ItineraryDay {
  return {
    ...structuredClone(seedData.trips[0].days[0]),
    index,
    stops: stopIds.map((id, i) => makeStop(id, i + 1)),
  }
}

function fc(title: string, dayIndex: number, stopId?: string): FixedCommitment {
  return {
    id: `fc-${title}`,
    title,
    type: 'event',
    dayIndex,
    time: '10:00',
    ...(stopId != null ? { stopId } : {}),
  }
}

function ex(label: string, dayIndex: number | undefined, stopId?: string): Expense {
  return {
    id: `ex-${label}`,
    label,
    category: 'transport',
    amountInr: 100,
    ...(stopId != null ? { stopId } : {}),
    ...(dayIndex != null ? { dayIndex } : {}),
  }
}

function threeDays() {
  return [day(0, ['S']), day(1, []), day(2, [])]
}

describe('carryStopLinkedRecords', () => {
  it('moves a linked commitment with its stop and returns its title', () => {
    const days = threeDays()
    const trip = { days, fixedCommitments: [fc('Train', 0, 'S')], expenses: [] }
    expect(moveStopToDay(days, 'S', 2, null)).toBe(true)
    expect(carryStopLinkedRecords(trip, 'S', 2)).toEqual(['Train'])
    expect(trip.fixedCommitments[0].dayIndex).toBe(2)
  })

  it('keeps the engine deadline check findable on the new day', () => {
    const days = threeDays()
    const commitment = fc('Train', 0, 'S')
    const trip = { days, fixedCommitments: [commitment], expenses: [] }
    expect(commitmentStopIndex(days[0].stops, commitment)).toBe(0)
    expect(moveStopToDay(days, 'S', 2, null)).toBe(true)
    expect(commitmentStopIndex(days[0].stops, commitment)).toBeNull()
    carryStopLinkedRecords(trip, 'S', 2)
    expect(typeof commitmentStopIndex(days[2].stops, commitment)).toBe('number')
  })

  it('leaves a commitment with no stopId untouched', () => {
    const days = threeDays()
    const generic = fc('Generic', 0)
    const trip = { days, fixedCommitments: [fc('Train', 0, 'S'), generic], expenses: [] }
    moveStopToDay(days, 'S', 2, null)
    expect(carryStopLinkedRecords(trip, 'S', 2)).toEqual(['Train'])
    expect(generic.dayIndex).toBe(0)
  })

  it('leaves a commitment linked to a different stop untouched', () => {
    const days = [day(0, ['S', 'T']), day(1, []), day(2, [])]
    const other = fc('Other', 0, 'T')
    const trip = { days, fixedCommitments: [fc('Train', 0, 'S'), other], expenses: [] }
    moveStopToDay(days, 'S', 2, null)
    carryStopLinkedRecords(trip, 'S', 2)
    expect(other.dayIndex).toBe(0)
  })

  it('moves a day-scoped expense but not a trip-wide one', () => {
    const days = threeDays()
    const scoped = ex('Ticket', 0, 'S')
    const tripWide = ex('Kitty', undefined, 'S')
    const trip = { days, fixedCommitments: [], expenses: [scoped, tripWide] }
    moveStopToDay(days, 'S', 2, null)
    carryStopLinkedRecords(trip, 'S', 2)
    expect(scoped.dayIndex).toBe(2)
    expect(tripWide.dayIndex).toBeUndefined()
  })

  it('returns [] and changes nothing on a same-day reorder', () => {
    const days = [day(0, ['S', 'T']), day(1, [])]
    const commitment = fc('Train', 0, 'S')
    const trip = { days, fixedCommitments: [commitment], expenses: [] }
    expect(moveStopToDay(days, 'S', 0, 1)).toBe(true)
    expect(carryStopLinkedRecords(trip, 'S', 0)).toEqual([])
    expect(commitment.dayIndex).toBe(0)
  })

  it('does not carry after a refused move to an unknown day', () => {
    const days = [day(0, ['S']), day(1, [])]
    const commitment = fc('Train', 0, 'S')
    const trip = { days, fixedCommitments: [commitment], expenses: [] }
    if (moveStopToDay(days, 'S', 99, null)) {
      carryStopLinkedRecords(trip, 'S', 99)
    }
    expect(commitment.dayIndex).toBe(0)
  })
})

describe('move paths keep their caller', () => {
  it('each move path calls the helper', () => {
    const files = [
      'src/lib/stopOrder.ts',
      'src/components/BoardView.tsx',
      'src/pages/trip/TimelineTab.tsx',
      'src/pages/TripWorkspace.tsx',
    ]
    for (const file of files) {
      const text = readFileSync(resolve(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n')
      expect(text, file).toContain('carryStopLinkedRecords(')
    }
  })
})
