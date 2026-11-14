// ============ #774 / #917: the client renders a locked day from counts ============
//
// The server builds a locked day itself: an index, a flag, an empty stop list
// and two counts. These tests pin the client half. The mapping reads counts
// only, an unknown count never reads as zero, and no locked surface prints a
// creator title or a place name.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { ItineraryDay, ItineraryStop } from '../src/data/types'
import {
  emptyLockedDay, fullPlanRead, hasWireLockedDay, isWireLocked, lockedDayCounts, lockedDayTitle,
  planStopCount, readableDayStart, wireLockedSummary, withoutLockMarker,
} from '../src/lib/lockedDay'
import { rowToTrip, type TripRow } from '../src/lib/tripRow'
import { planBody, renderBodyHTML, touristTripJsonLd } from '../api/_publicBody.js'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
/** Code only, so prose about a removed line cannot satisfy or break a pin. */
const codeOf = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|\n)[^\S\n]*\/\/[^\n]*/g, '$1')

const stop = (over: Partial<ItineraryStop> = {}): ItineraryStop => ({
  id: 's', title: 'A stop', category: 'food', locationName: 'A place', lat: 10, lng: 76,
  visitMinutes: 30, entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'optional',
  status: 'confirmed', orderInDay: 0, ...over,
})
/** The exact shape `get_public_trip` sends for a locked day. */
const wireDay = (index: number, preview: unknown = { stopCount: 3, categories: { temple: 1, other: 1 } }): ItineraryDay =>
  ({ id: `locked-day-${index}`, index, locked: true, stops: [], lockedPreview: preview }) as ItineraryDay
const openDay = (index: number, stops: ItineraryStop[] = [stop()]): ItineraryDay =>
  ({ id: `day-${index}`, index, title: `Open ${index}`, stops })

describe('lockedDayCounts: the only reader of the wire shape', () => {
  it('gives null for a day the server sent in full', () => {
    expect(lockedDayCounts(openDay(0))).toBeNull()
    expect(isWireLocked(openDay(0))).toBe(false)
    expect(isWireLocked(undefined)).toBe(false)
  })

  it('reads the two counts of a locked day', () => {
    const counts = lockedDayCounts(wireDay(1))
    expect(counts?.stopCount).toBe(3)
    expect(counts?.categories).toHaveLength(2)
    expect(counts?.categories).toEqual(expect.arrayContaining([{ category: 'temple' }, { category: 'other' }]))
  })

  it('keeps unknown apart from zero', () => {
    // A zero is a real answer. A missing or broken count is not a zero.
    expect(lockedDayCounts(wireDay(1, { stopCount: 0, categories: {} }))).toEqual({ stopCount: 0, categories: [] })
    for (const broken of [null, 'three', 7, [], { stopCount: '3' }, { stopCount: -1 }, { stopCount: 2.5 }, { stopCount: 9e9 }]) {
      expect(lockedDayCounts(wireDay(1, broken))?.stopCount, JSON.stringify(broken)).toBeNull()
    }
    // A locked day with no preview field at all.
    expect(lockedDayCounts({ id: 'locked-day-1', index: 1, locked: true, stops: [] })).toEqual({ stopCount: null, categories: [] })
  })

  it('never lets a category name through unless it is a known one', () => {
    const counts = lockedDayCounts(wireDay(1, { stopCount: 2, categories: { 'Secret Cafe, MG Road': 1, food: 1, nature: 'x', beach: -2 } }))
    expect(counts?.categories).toEqual(expect.arrayContaining([{ category: 'other' }, { category: 'food' }]))
    expect(counts?.categories).toHaveLength(2)
    expect(JSON.stringify(counts)).not.toContain('Secret Cafe')
  })

  it('does not treat a truthy value as the lock flag', () => {
    expect(isWireLocked({ locked: 'true' as unknown as boolean })).toBe(false)
    expect(hasWireLockedDay([openDay(0), wireDay(1)])).toBe(true)
    expect(hasWireLockedDay([openDay(0)])).toBe(false)
  })
})

describe('wireLockedSummary: the locked storefront card', () => {
  it('shows the day number, the kind counts and no invented figure', () => {
    const day = wireDay(4)
    const summary = wireLockedSummary(day, lockedDayCounts(day)!)
    expect(summary.title).toBe('Day 5')
    expect(summary.placeCount).toBe(2)
    // `other` is not a known category, so it counts as a sight.
    expect(summary.kinds).toEqual([{ kind: 'sight', count: 1 }, { kind: 'temple', count: 1 }])
    // No road time and no pace word: both need coordinates the server withheld.
    expect(summary.travelMinutes).toBe(0)
    expect(summary.pace).toBeNull()
    expect(summary.hasFlight).toBe(false)
  })

  it('counts stays and transfers as no place, as a readable card does', () => {
    const day = wireDay(2, { stopCount: 2, categories: { hotel: 1, travel: 1 } })
    expect(wireLockedSummary(day, lockedDayCounts(day)!).placeCount).toBe(0)
  })

  it('names a locked day by its number only', () => {
    expect(lockedDayTitle(0)).toBe('Day 1')
  })
})

describe('planStopCount: one total from readable days and server counts', () => {
  it('adds the readable stops and the server counts', () => {
    const days = [openDay(0, [stop(), stop({ id: 'r', status: 'rejected' })]), wireDay(1)]
    expect(planStopCount(days)).toBe(4)
  })

  it('is unknown when one locked day has no count', () => {
    expect(planStopCount([openDay(0), wireDay(1, null)])).toBeNull()
  })
})

describe('readableDayStart: a free day after a locked day', () => {
  it('starts at its own first stop, because the real start is withheld', () => {
    const day = openDay(2, [stop({ id: 'b', orderInDay: 1, lat: 12, lng: 77 }), stop({ id: 'a', orderInDay: 0, lat: 11, lng: 76 })])
    expect(readableDayStart([openDay(0), wireDay(1), day], day)).toEqual({ lat: 11, lng: 76 })
  })

  it('leaves the engine origin alone when the day before is readable', () => {
    const day = openDay(1)
    expect(readableDayStart([openDay(0), day], day)).toBeNull()
    expect(readableDayStart([day], day)).toBeNull()
  })

  it('gives null when the day has no usable stop', () => {
    const day = openDay(2, [stop({ lat: Number.NaN })])
    expect(readableDayStart([wireDay(1), day], day)).toBeNull()
  })
})

describe('a fork never carries the lock fields or a locked stop', () => {
  it('withoutLockMarker removes both fields and keeps the rest', () => {
    const plain = withoutLockMarker(wireDay(1))
    expect('locked' in plain).toBe(false)
    expect('lockedPreview' in plain).toBe(false)
    expect(plain.index).toBe(1)
  })

  it('emptyLockedDay keeps the position and nothing else', () => {
    const hostile = { ...openDay(3, [stop({ title: 'Secret Cafe' })]), startTime: '06:15', coverImageUrl: 'https://example.com/secret.jpg' }
    expect(emptyLockedDay(hostile)).toEqual({ id: 'day-3', index: 3, stops: [] })
  })

  it('the fork path and the copy builder use them', () => {
    const fork = codeOf(read('../src/lib/forkPub.ts'))
    expect(fork).toMatch(/free\.has\(d\.index\) && !isWireLocked\(d\) \? d : emptyLockedDay\(d\)/)
    expect(fork).toMatch(/isWireLocked\(d\)\s*\|\|/)
    const store = codeOf(read('../src/store/store.ts'))
    expect(store).toMatch(/withoutLockMarker\(/)
    // The copy builder used to keep the title and the coordinates of a locked stop.
    expect(store).not.toMatch(/description: LOCKED_STOP_DESCRIPTION/)
  })
})

describe('fullPlanRead: a loading line is true only while a read is in flight', () => {
  const held = { mayRead: true, holdsLockedCopy: true, firstReadSettled: true, purchaseInFlight: false, failed: false }

  it('does nothing for a stranger, and nothing when the full plan is here', () => {
    expect(fullPlanRead({ ...held, mayRead: false })).toBe('none')
    expect(fullPlanRead({ ...held, holdsLockedCopy: false })).toBe('none')
    // A failed read is not a state of a viewer who holds the full plan.
    expect(fullPlanRead({ ...held, holdsLockedCopy: false, failed: true })).toBe('none')
  })

  it('waits while the first read or a purchase is in flight', () => {
    expect(fullPlanRead({ ...held, firstReadSettled: false })).toBe('wait')
    expect(fullPlanRead({ ...held, purchaseInFlight: true })).toBe('wait')
  })

  it('asks when no read is in flight, so loading never stands with nothing behind it', () => {
    expect(fullPlanRead(held)).toBe('ask')
  })

  it('says failed after the read ran, and never asks again by itself', () => {
    expect(fullPlanRead({ ...held, failed: true })).toBe('failed')
    expect(fullPlanRead({ ...held, failed: true, purchaseInFlight: true })).toBe('failed')
  })
})

describe('rowToTrip keeps the wire shape intact', () => {
  it('a locked day survives the row mapper with its flag and its counts', () => {
    const row = {
      id: 't', owner_id: 'o', name: 'Plan', start_location: 'Kochi', start_location_coords: null,
      destinations: ['Munnar'], destination_coords: null, start_date: '2026-11-01', end_date: '2026-11-03',
      travellers: 2, transport_mode: 'car', budget_per_person_inr: 0, travel_style: 'balanced',
      fixed_commitments: [], expenses: [], cover_emoji: '', visibility: 'public', created_at: 1, updated_at: 1,
      days: [openDay(0), wireDay(1)],
    } as unknown as TripRow
    const trip = rowToTrip(row, [])
    expect(trip.days[1].stops).toEqual([])
    expect(lockedDayCounts(trip.days[1])?.stopCount).toBe(3)
    expect(lockedDayCounts(trip.days[0])).toBeNull()
  })

  it('a locked day with no stop list still maps to an empty list', () => {
    const row = { days: [{ id: 'locked-day-0', index: 0, locked: true }] } as unknown as TripRow
    const trip = rowToTrip(row, [])
    expect(trip.days[0].stops).toEqual([])
    expect(lockedDayCounts(trip.days[0])).toEqual({ stopCount: null, categories: [] })
  })
})

describe('the share page prints nothing from a locked day', () => {
  const publication = { title: 'Plan', premium_price_inr: 499, free_day_indexes: [0, 1] }

  it('a wire-locked day is closed even when the free list names it', () => {
    const parts = planBody(publication, { days: [openDay(0), wireDay(1)] })
    expect(parts[1].open).toBe(false)
    expect(parts[1].stops).toEqual([])
    expect(parts[1].title).toBe('')
  })

  it('a locked day prints no creator title, even from an older database', () => {
    // An un-migrated database still sends the title and the stop rows.
    const legacy = { id: 'd2', index: 2, title: 'SECRET774 creator title', stops: [stop({ title: 'SECRET774 stop', locationName: 'SECRET774 place' })] }
    const trip = { days: [openDay(0), wireDay(1), legacy] }
    const html = renderBodyHTML(publication, trip, 'https://example.com/#/pub/x')
    expect(html).not.toContain('SECRET774')
    expect(html).toContain('<h2>Day 3</h2>')
    expect(touristTripJsonLd(publication, trip, 'https://example.com/i/x')).not.toContain('SECRET774')
  })
})

describe('the public page renders a locked day from counts', () => {
  const page = codeOf(read('../src/pages/PublicItinerary.tsx'))

  it('never puts a stop title inside the locked overlay', () => {
    // The old overlay rendered real titles under a CSS blur. A readable day
    // still prints its titles, so the pin reads the overlay block only.
    const from = page.indexOf('className="pi-lock"')
    const to = page.indexOf('className="pi-lock-title"', from)
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    const overlay = page.slice(from, to)
    expect(overlay).not.toMatch(/\.title\b/)
    expect(overlay).not.toMatch(/locationName|\.lat\b|\.lng\b/)
    expect(page).toMatch(/lockedDayCounts\(day\)/)
  })

  it('names a locked day by its number in every surface', () => {
    expect(page).toMatch(/lockedDayTitle\(/)
    expect(page).toMatch(/wireLockedSummary\(/)
  })

  it('keeps loading, failed and locked apart for an owner whose plan has not arrived', () => {
    expect(page).toMatch(/Loading the full plan/)
    expect(page).toMatch(/The full plan did not load/)
    // The words come from the decision, and `ask` starts the read that makes
    // the loading line true.
    expect(page).toMatch(/fullPlan === 'failed' \? 'The full plan did not load/)
    expect(page).toMatch(/if \(fullPlan !== 'ask' \|\| pubId === null\) return/)
    expect(page).toMatch(/if \(fresh && !hasWireLockedDay\(fresh\.days\)\) setFetched\(fresh\)\s+else setFullPlanFailedFor\(pubId\)/)
  })
})
