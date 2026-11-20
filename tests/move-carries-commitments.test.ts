import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { moveStopToDay, carryStopLinkedRecords } from '../src/lib/stopOrder'
import { commitmentStopIndex } from '../src/lib/engine'
import { moveToDayRequest } from '../src/pages/trip/map/editing/stopEdit'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Trip } from '../src/data/types'
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

describe('the Map edit card move carries linked records', () => {
  it('moveToDayRequest mutate moves the commitment and the expense with the stop', () => {
    const commitment = fc('Ferry', 0, 'S')
    const expense = ex('Ticket', 0, 'S')
    const trip = { days: [day(0, ['S', 'T']), day(1, ['U'])], fixedCommitments: [commitment], expenses: [expense] } as unknown as Trip
    const res = moveToDayRequest(trip, 'S', 1)
    expect(res.kind).toBe('ok')
    if (res.kind !== 'ok') return
    res.request.mutate(trip)
    expect(trip.days[1].stops.map(s => s.id)).toContain('S')
    expect(commitment.dayIndex).toBe(1)
    expect(expense.dayIndex).toBe(1)
    expect(commitmentStopIndex(trip.days[1].stops, commitment)).not.toBeNull()
  })
})

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

describe('every cross-day move carries linked records', () => {
  it('each moveStopToDay call in src is guarded and followed by carryStopLinkedRecords', () => {
    const files = sourceFiles(resolve(process.cwd(), 'src'))
    let calls = 0
    for (const file of files) {
      if (file.replace(/\\/g, '/').endsWith('src/lib/stopOrder.ts')) continue
      const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
      const all = text.match(/moveStopToDay\(draft\./g) ?? []
      const carried = text.match(/if \(moveStopToDay\(draft\.[^\n]*\)\) \{\n\s*(?:\w+ = )?carryStopLinkedRecords\(draft, /g) ?? []
      expect(carried.length, file).toBe(all.length)
      calls += all.length
    }
    // Board, Timeline drag, Timeline modal, workspace next-day, Map edit card.
    expect(calls).toBeGreaterThanOrEqual(5)
  })
})
