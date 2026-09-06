// ============ duplicateTripPublic — premium stripping on fork ============
// Forking a published itinerary used to be a total bypass: duplicateTrip
// copied premium days verbatim. duplicateTripPublic must keep free days
// intact and reduce every other day's stops to locked stubs.
//
// Same mocked-supabase pattern as tests/store-persistence.test.ts (node env,
// no network — the trip insert is fire-and-forget and merely flushed).
import { describe, it, expect, vi } from 'vitest'
import { seedData } from '../src/data/seed'

const { calls } = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; method: string }>,
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    let method: string | undefined
    const builder: Record<string, unknown> = {}
    const chain = (m: string) => { method = m; return builder }
    builder.update = () => chain('update')
    builder.insert = () => chain('insert')
    builder.delete = () => chain('delete')
    builder.select = () => builder
    builder.eq = () => builder
    builder.in = () => builder
    builder.limit = () => builder
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      new Promise(resolve => { if (method) calls.push({ table, method }); resolve({ data: null, error: null }) }).then(res)
    return builder
  }
  return {
    isSupabaseConfigured: false,
    supabase: { from: (t: string) => makeBuilder(t) },
  }
})

import { duplicateTripPublic, tripById } from '../src/store/store'
import type { Trip, ItineraryStop } from '../src/data/types'

const source = seedData.trips[0] as Trip
const ownerId = 'fork-owner'

// Stop ids are regenerated on fork — match source stops to their copies by
// title within the day (titles are preserved, even on premium stubs).
function stopOf(trip: Trip, dayIndex: number, title: string): ItineraryStop {
  const day = trip.days.find(d => d.index === dayIndex)!
  return day.stops.find(s => s.title === title)!
}

const LOCKED = 'Locked — the full plan is on the original itinerary.'

describe('duplicateTripPublic premium stripping', () => {
  it('keeps free days fully intact and strips premium days to stubs', () => {
    const copy = duplicateTripPublic(source, ownerId, [0])
    const freeStop = stopOf(source, 0, 'Blossom International Park evening walk')
    const freeCopy = stopOf(copy, 0, freeStop.title)
    // Free day: every meaningful field survives.
    expect(freeCopy.description).toBe(freeStop.description)
    expect(freeCopy.notes).toBe(freeStop.notes)
    expect(freeCopy.entryFeeInrPerPerson).toBe(freeStop.entryFeeInrPerPerson)
    expect(freeCopy.transportCostInrTotal).toBe(freeStop.transportCostInrTotal)
    expect(freeCopy.openTime).toBe(freeStop.openTime)
    expect(freeCopy.status).toBe(freeStop.status)

    // Premium day (day 1): stub, not a copy.
    const premiumSrc = stopOf(source, 1, source.days[1]!.stops[0]!.title)
    const premiumCopy = stopOf(copy, 1, premiumSrc.title)
    expect(premiumCopy.title).toBe(premiumSrc.title) // shape survives
    expect(premiumCopy.priority).toBe(premiumSrc.priority)
    expect(premiumCopy.description).toBe(LOCKED)
    expect(premiumCopy.notes).toBe('')
    expect(premiumCopy.entryFeeInrPerPerson).toBe(0)
    expect(premiumCopy.transportCostInrTotal).toBe(0)
    expect(premiumCopy.openTime).toBeUndefined()
    expect(premiumCopy.closeTime).toBeUndefined()
    expect(premiumCopy.status).toBe('confirmed')
    expect(premiumCopy.visitMinutes).toBe(premiumSrc.visitMinutes) // untouched pass-through
  })

  it('every stop of a premium day is stripped, free day count unchanged', () => {
    const copy = duplicateTripPublic(source, ownerId, [0])
    const premiumDays = copy.days.filter(d => d.index !== 0)
    expect(premiumDays.length).toBe(source.days.length - 1)
    for (const d of premiumDays) {
      expect(d.stops.length).toBe(source.days.find(x => x.index === d.index)!.stops.length)
      for (const s of d.stops) expect(s.description).toBe(LOCKED)
    }
  })

  it('an all-free fork is a full copy of every day', () => {
    const all = source.days.map(d => d.index)
    const copy = duplicateTripPublic(source, ownerId, all)
    for (const d of source.days) {
      for (const s of d.stops) {
        const c = stopOf(copy, d.index, s.title)
        expect(c.description).toBe(s.description)
        expect(c.entryFeeInrPerPerson).toBe(s.entryFeeInrPerPerson)
      }
    }
  })

  it('drops expenses and fixed commitments tagged to locked days, keeps the rest', () => {
    const withDayExpenses: Trip = {
      ...source,
      expenses: [
        ...source.expenses,
        { id: 'ex_locked', label: 'Houseboat premium add-on', category: 'accommodation', amountInr: 14500, dayIndex: 3 },
        { id: 'ex_free', label: 'Park entry (day 0)', category: 'entry-fees', amountInr: 500, dayIndex: 0 },
      ],
    }
    const copy = duplicateTripPublic(withDayExpenses, ownerId, [0])
    // Trip-level expenses (no dayIndex) ride along.
    expect(copy.expenses.some(e => e.label === 'Fuel estimate (~430 km)')).toBe(true)
    // Day-0 expense survives; the day-3 (locked) expense is stripped.
    expect(copy.expenses.some(e => e.label === 'Park entry (day 0)')).toBe(true)
    expect(copy.expenses.some(e => e.label === 'Houseboat premium add-on')).toBe(false)
    // Fixed commitments on locked days (day 3 pair) don't ship with the fork.
    expect(copy.fixedCommitments.map(f => f.title)).toEqual(['Hotel check-in — Kochi'])
  })

  it('an all-free fork keeps every expense and fixed commitment', () => {
    const all = source.days.map(d => d.index)
    const copy = duplicateTripPublic(source, ownerId, all)
    expect(copy.expenses.length).toBe(source.expenses.length)
    expect(copy.fixedCommitments.length).toBe(source.fixedCommitments.length)
  })

  it('is a fresh private trip owned by the forker, persisted with the stripped plan', async () => {
    calls.length = 0
    const copy = duplicateTripPublic(source, ownerId, [0])
    expect(copy.id).not.toBe(source.id)
    expect(copy.visibility).toBe('private')
    expect(copy.name).toBe(`${source.name} (copy)`)
    expect(copy.members).toEqual([{ userId: ownerId, role: 'owner', joinedAt: expect.any(Number) }])
    // Day ids are regenerated so the fork never shares row identity with the source.
    for (const d of copy.days) expect(source.days.some(x => x.id === d.id)).toBe(false)
    // Fire-and-forget persistence flushes to the mocked client.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls.some(c => c.table === 'trips' && c.method === 'insert')).toBe(true)
    expect(calls.some(c => c.table === 'trip_members' && c.method === 'insert')).toBe(true)
    // The cached copy is the stripped one — re-read it from the store.
    expect(tripById(copy.id)!.days[1]!.stops[0]!.description).toBe(LOCKED)
  })
})
