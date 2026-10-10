import { describe, expect, it } from 'vitest'
import { savedShelfFor, SAVED_DAY_PREFIX, SAVED_STOP_PREFIX } from '../src/lib/savedShelf'
import type { ItineraryDay, ItineraryStop, Trip } from '../src/data/types'

/* The saved shelf reads MR8's ids back. Its rules have cases: an id outlives
   the plan, a day and a stop are different bookmarks, and a shelf row that
   opens nothing is worse than no row. Each one is pinned here. */

function stop(patch: Partial<ItineraryStop> = {}): ItineraryStop {
  return {
    id: 's1',
    title: 'Anjuna Flea Market',
    category: 'sight',
    locationName: 'Anjuna',
    lat: 15.6,
    lng: 73.7,
    visitMinutes: 60,
    entryFeeInrPerPerson: 0,
    transportCostInrTotal: 0,
    priority: 'must-do',
    status: 'confirmed',
    orderInDay: 0,
    ...patch,
  }
}

function day(index: number, stops: ItineraryStop[], patch: Partial<ItineraryDay> = {}): ItineraryDay {
  return { id: `d${index}`, index, stops, ...patch }
}

function trip(patch: Partial<Trip> = {}): Trip {
  return {
    id: 't1',
    name: 'Goa',
    startLocation: 'Mumbai',
    destinations: ['Goa'],
    startDate: '2026-11-02',
    endDate: '2026-11-06',
    travellers: 2,
    transportMode: 'car',
    days: [],
    ...patch,
  } as Trip
}

const goa = () => trip({
  days: [
    day(0, [stop({ id: 'sunset', title: 'Chapora sunset', orderInDay: 0 }), stop({ id: 'market', title: 'Anjuna Flea Market', orderInDay: 1 })]),
    day(1, [stop({ id: 'fort', title: 'Aguada Fort', locationName: 'Candolim', orderInDay: 0 })]),
  ],
})

describe('savedShelfFor', () => {
  it('names a saved day with its own label, place and stop count', () => {
    const rows = savedShelfFor(goa(), [`${SAVED_DAY_PREFIX}1`])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'day:1',
      kind: 'day',
      dayIndex: 1,
      title: 'Day 2',
      meta: 'Candolim · 1 stop',
      route: '/trip/t1/timeline?day=1',
    })
  })

  it('names a saved stop and opens it, not just its day', () => {
    const rows = savedShelfFor(goa(), [`${SAVED_STOP_PREFIX}market`])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'stop:market',
      kind: 'stop',
      dayIndex: 0,
      title: 'Anjuna Flea Market',
      meta: 'Day 1 · Anjuna',
      route: '/trip/t1/timeline?day=0&stop=market',
    })
  })

  it('reads a saved day and a saved stop as different rows', () => {
    const rows = savedShelfFor(goa(), ['day:0', 'stop:market'])
    expect(rows.map(r => r.kind)).toEqual(['day', 'stop'])
    // The day opens the whole day; the stop opens the stop inside it.
    expect(rows[0].route).toBe('/trip/t1/timeline?day=0')
    expect(rows[1].route).toBe('/trip/t1/timeline?day=0&stop=market')
  })

  it('follows a stop that a re-split moved to another day', () => {
    const moved = trip({ days: [day(0, []), day(1, [stop({ id: 'market', title: 'Anjuna Flea Market' })])] })
    expect(savedShelfFor(moved, ['stop:market'])[0].route).toBe('/trip/t1/timeline?day=1&stop=market')
    expect(savedShelfFor(moved, ['stop:market'])[0].meta).toBe('Day 2 · Anjuna')
  })

  it('drops an id whose day no longer exists', () => {
    expect(savedShelfFor(goa(), ['day:9'])).toEqual([])
  })

  it('drops an id whose stop was deleted', () => {
    expect(savedShelfFor(goa(), ['stop:gone'])).toEqual([])
  })

  it('drops junk instead of rendering a row that opens nothing', () => {
    expect(savedShelfFor(goa(), ['day:abc', 'stop:', 'other:1', 'day:', ''])).toEqual([])
  })

  it('keeps one row per id, however often the store repeats it', () => {
    const rows = savedShelfFor(goa(), ['day:0', 'day:0', 'stop:market', 'stop:market'])
    expect(rows.map(r => r.id)).toEqual(['day:0', 'stop:market'])
  })

  it('reads in plan order: each day before the stops inside it', () => {
    const rows = savedShelfFor(goa(), ['stop:fort', 'stop:market', 'day:1', 'day:0'])
    expect(rows.map(r => r.id)).toEqual(['day:0', 'stop:market', 'day:1', 'stop:fort'])
  })

  it('says nothing when nothing is saved', () => {
    expect(savedShelfFor(goa(), [])).toEqual([])
  })
})
