import { describe, expect, it } from 'vitest'
import { dayStripItems } from '../src/lib/dayStrip'
import type { ItineraryDay, ItineraryStop } from '../src/data/types'

/* MR7. The strip marks a city change on a BOUNDARY, so the cases that matter
   are the ones where an off-by-one puts the marker on the wrong day. */

let seq = 0
function stop(patch: Partial<ItineraryStop> = {}): ItineraryStop {
  seq += 1
  return {
    id: `s${seq}`, title: `Stop ${seq}`, category: 'sight',
    locationName: 'Somewhere', lat: 26.9, lng: 75.8, visitMinutes: 60,
    entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'must-do',
    status: 'confirmed', orderInDay: 0, ...patch,
  }
}
function day(index: number, patch: Partial<ItineraryDay> = {}): ItineraryDay {
  const stops = patch.stops ?? []
  return { id: `d${index}`, index, stops, ...patch }
}

describe('dayStripItems', () => {
  it('labels every day from its own index, not its array position', () => {
    const items = dayStripItems([day(0), day(1), day(2)])
    expect(items.map(i => i.label)).toEqual(['Day 1', 'Day 2', 'Day 3'])
    expect(items.map(i => i.dayIndex)).toEqual([0, 1, 2])
  })

  it('sorts by index, because array order is not a contract', () => {
    const items = dayStripItems([day(2), day(0), day(1)])
    expect(items.map(i => i.dayIndex)).toEqual([0, 1, 2])
    expect(items.map(i => i.label)).toEqual(['Day 1', 'Day 2', 'Day 3'])
  })

  it('never reads the day title as a place — a title names an activity (P3)', () => {
    // "Arrival" and "Fort visit" are activity descriptions. Read as cities,
    // two Jaipur days produced a city-change marker inside one city.
    const items = dayStripItems([day(0, { title: 'Arrival', stops: [stop({ locationName: 'Jaipur' })] })])
    expect(items[0].place).toBe('Jaipur')
    const titled = dayStripItems([day(0, { title: 'Kochi to Alleppey' })])
    expect(titled[0].place).toBeNull()
  })

  it('keeps two same-city days unmarked even when their titles differ', () => {
    const items = dayStripItems([
      day(0, { title: 'Arrival', stops: [stop({ locationName: 'Jaipur' })] }),
      day(1, { title: 'Fort visit', stops: [stop({ locationName: 'Jaipur' })] }),
    ])
    expect(items.map(i => i.changesCity)).toEqual([false, false])
  })

  it('names the place from the base stop — the last in plan order', () => {
    // The base is where the day ends and you sleep, so a drive day sits at
    // its destination — the marker lands on the day the route moves.
    const items = dayStripItems([day(0, { stops: [
      stop({ locationName: 'Kochi', orderInDay: 1 }),
      stop({ locationName: 'Munnar', orderInDay: 2 }),
    ] })])
    expect(items[0].place).toBe('Munnar')
  })

  it('reads plan order for the base, not array position', () => {
    const items = dayStripItems([day(0, { stops: [
      stop({ locationName: 'Munnar', orderInDay: 2 }),
      stop({ locationName: 'Kochi', orderInDay: 1 }),
    ] })])
    expect(items[0].place).toBe('Munnar')
  })

  it('a rejected stop does not place the day', () => {
    const items = dayStripItems([day(0, { stops: [
      stop({ locationName: 'Kochi', orderInDay: 1 }),
      stop({ locationName: 'Munnar', orderInDay: 2, status: 'rejected' }),
    ] })])
    expect(items[0].place).toBe('Kochi')
  })

  it('a base that names nowhere prints no place', () => {
    const items = dayStripItems([day(0, { stops: [stop({ locationName: '  ' })] })])
    expect(items[0].place).toBeNull()
  })

  it('prints no place for a day that names nowhere, rather than reusing the last one', () => {
    const items = dayStripItems([day(0, { stops: [stop({ locationName: 'Kochi' })] }), day(1)])
    expect(items[1].place).toBeNull()
  })

  it('marks no change on the first day — there is nothing to change from', () => {
    const items = dayStripItems([day(0, { stops: [stop({ locationName: 'Kochi' })] })])
    expect(items[0].changesCity).toBe(false)
  })

  it('marks the change on the day the city moves, not the day before it', () => {
    const items = dayStripItems([
      day(0, { stops: [stop({ locationName: 'Kochi' })] }),
      day(1, { stops: [stop({ locationName: 'Kochi' })] }),
      day(2, { stops: [stop({ locationName: 'Munnar' })] }),
    ])
    // Day 3 is where the route moves. The marker belongs on Day 3.
    expect(items.map(i => i.changesCity)).toEqual([false, false, true])
  })

  it('compares case- and space-insensitively, so padding is not a move', () => {
    const items = dayStripItems([
      day(0, { stops: [stop({ locationName: 'Kochi' })] }),
      day(1, { stops: [stop({ locationName: '  kochi ' })] }),
    ])
    expect(items[1].changesCity).toBe(false)
  })

  it('does not make an unnamed day look like a change on the day after it', () => {
    const items = dayStripItems([
      day(0, { stops: [stop({ locationName: 'Kochi' })] }),
      day(1),                                   // unplanned: names nowhere
      day(2, { stops: [stop({ locationName: 'Kochi' })] }),
    ])
    expect(items.map(i => i.changesCity)).toEqual([false, false, false])
    expect(items[2].place).toBe('Kochi')
  })

  it('counts the stops written on the day', () => {
    const items = dayStripItems([day(0, { stops: [stop(), stop(), stop()] }), day(1)])
    expect(items.map(i => i.stopCount)).toEqual([3, 0])
  })

  it('returns nothing for a trip with no days', () => {
    expect(dayStripItems([])).toEqual([])
  })
})
