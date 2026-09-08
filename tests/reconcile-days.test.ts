// ============ Trip dates & day reconciliation tests ============
// reconcileDays is pure (no store access) — node-testable directly. updateTrip's
// date handling + persist-after-patch ordering are pinned with the mocked-supabase
// + fetchSharedTrip seeding pattern from fetch-shared-trip.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ItineraryDay } from '../src/data/types'

function mkDays(n: number, stopsPerDay: number[] = []): ItineraryDay[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `day-${i}`, index: i, stops: Array.from({ length: stopsPerDay[i] ?? 0 }, (_, j) => ({
      id: `s-${i}-${j}`, orderInDay: j,
    })) as ItineraryDay['stops'],
  }))
}

describe('reconcileDays', () => {
  it('lengthening appends empty days with fresh ids and re-sequenced indexes', () => {
    const before = mkDays(3)
    const { days, error } = reconcileDays(before, '2026-10-01', '2026-10-05') // 5 days
    expect(error).toBeUndefined()
    expect(days).toHaveLength(5)
    expect(days.map(d => d.index)).toEqual([0, 1, 2, 3, 4])
    expect(days[3].stops).toEqual([])
    expect(days[4].stops).toEqual([])
    // original days keep their ids; new days get distinct ones
    expect(days[0].id).toBe('day-0')
    expect(days[3].id).not.toBe(days[4].id)
    // input not mutated
    expect(before).toHaveLength(3)
  })

  it('shortening drops trailing EMPTY days', () => {
    const { days, error } = reconcileDays(mkDays(5), '2026-10-01', '2026-10-03') // 3 days
    expect(error).toBeUndefined()
    expect(days).toHaveLength(3)
    expect(days.map(d => d.index)).toEqual([0, 1, 2])
  })

  it('shortening past a day with stops is blocked with a named day', () => {
    // day 3 (index 3) holds stops; shrinking 5 → 3 would have to drop it
    const { days, error } = reconcileDays(mkDays(5, [0, 0, 0, 2, 0]), '2026-10-01', '2026-10-03')
    expect(error).toContain('Day 4')
    expect(days).toHaveLength(5) // unchanged on error
  })

  it('a mid-range day with stops does not block when the shrink only drops empty trailing days', () => {
    // stops on day 2, which stays inside the kept 3-day range
    const { days, error } = reconcileDays(mkDays(5, [0, 0, 2, 0, 0]), '2026-10-01', '2026-10-03')
    expect(error).toBeUndefined()
    expect(days).toHaveLength(3)
    expect(days[2].stops).toHaveLength(2)
  })

  it('a day referenced only by a fixed commitment is load-bearing when protected', () => {
    const days = mkDays(4)
    const protectedIdx = new Set([3]) // e.g. a hotel check-in on the last day
    const blocked = reconcileDays(days, '2026-10-01', '2026-10-03', protectedIdx)
    expect(blocked.error).toBeDefined()
    const unprotected = reconcileDays(days, '2026-10-01', '2026-10-03')
    expect(unprotected.error).toBeUndefined()
    expect(unprotected.days).toHaveLength(3)
  })

  it('same-length range is a no-op returning equivalent days', () => {
    const before = mkDays(3, [1, 0, 2])
    const { days, error } = reconcileDays(before, '2026-10-01', '2026-10-03')
    expect(error).toBeUndefined()
    expect(days).toHaveLength(3)
    expect(days[2].stops).toHaveLength(2)
  })

  it('end before start and malformed dates are rejected', () => {
    expect(reconcileDays(mkDays(3), '2026-10-05', '2026-10-01').error).toContain('end date')
    expect(reconcileDays(mkDays(3), 'garbage', '2026-10-01').error).toContain('valid')
    expect(reconcileDays(mkDays(3), '2026-10-01', '').error).toContain('valid')
  })

  it('a 1-day range works when the grid is already 1 day', () => {
    const ok = reconcileDays(mkDays(1), '2026-10-01', '2026-10-01')
    expect(ok.error).toBeUndefined()
    expect(ok.days).toHaveLength(1)
  })
})

// ---------------- updateTrip date handling + write-through ----------------

const { state } = vi.hoisted(() => ({
  state: {
    tripRow: null as unknown,
    updates: [] as Array<{ payload: unknown; eq: unknown }>,
  },
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = (_c: string, v: unknown) => {
      if (table === 'trips' && state.updates.length) state.updates[state.updates.length - 1].eq = v
      return builder
    }
    builder.update = (payload: unknown) => {
      state.updates.push({ payload, eq: null })
      return builder
    }
    builder.maybeSingle = () => builder
    builder.single = () => builder
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      new Promise(resolve => {
        // select() paths: trips table serves the seeded row; the optional-column
        // probes error out (columns "missing") which the store handles.
        resolve(table === 'trips' && builder.__isSelect
          ? { data: state.tripRow, error: null }
          : { data: null, error: table.startsWith('trips') ? null : { message: 'denied' } })
      }).then(res)
    builder.__isSelect = false
    const origSelect = builder.select
    builder.select = () => { builder.__isSelect = true; return origSelect() }
    return builder
  }
  return {
    isSupabaseConfigured: false,
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  }
})

describe('updateTrip date handling', () => {
  beforeEach(() => {
    state.tripRow = null
    state.updates.length = 0
  })

  async function seedTripFromRow() {
    const { fetchSharedTrip } = await import('../src/store/store')
    const { rowToTrip } = await import('../src/lib/tripRow')
    const row = state.tripRow as import('../src/lib/tripRow').TripRow
    const trip = rowToTrip(row, [{ userId: row.owner_id, role: 'owner', joinedAt: 1 }])
    state.tripRow = row // fetchSharedTrip's select re-reads state.tripRow
    await fetchSharedTrip(row.id)
    return trip
  }

  it('persisting a settings edit carries the PATCHED values, not the pre-patch snapshot', async () => {
    const { updateTrip, tripById } = await import('../src/store/store')
    const days = mkDays(3, [1, 0, 0]).map((d, i) => ({ ...d, stops: d.stops.map(s => ({ ...s, title: `s${i}`, dayIndex: i })) as ItineraryDay['stops'] }))
    state.tripRow = {
      id: '44444444-4444-4444-8444-44444444444B', owner_id: 'u-owner', name: 'Dates trip',
      start_location: 'Kochi', start_location_coords: null, destinations: ['Munnar'],
      destination_coords: null, start_date: '2026-10-01', end_date: '2026-10-03', travellers: 2,
      transport_mode: 'car', budget_per_person_inr: 5000, travel_style: 'balanced',
      fixed_commitments: [], days, expenses: [], cover_emoji: '🧭', visibility: 'public',
      created_at: 1, updated_at: 1,
    }
    const trip = await seedTripFromRow()
    expect(tripById(trip.id)).toBeDefined()

    updateTrip(trip.id, { budgetPerPersonInr: 12345 })
    await new Promise(r => setTimeout(r, 20))

    const write = state.updates.find(u => (u.payload as any)?.budget_per_person_inr !== undefined)
    expect(write).toBeDefined()
    expect((write!.payload as any).budget_per_person_inr).toBe(12345)
    expect((write!.payload as any).name).toBe('Dates trip')
  })

  it('extending the end date grows days in the cache and the persisted payload', async () => {
    const { updateTrip, tripById } = await import('../src/store/store')
    const days = mkDays(3)
    state.tripRow = {
      id: '44444444-4444-4444-8444-44444444444C', owner_id: 'u-owner', name: 'Dates trip',
      start_location: 'Kochi', start_location_coords: null, destinations: ['Munnar'],
      destination_coords: null, start_date: '2026-10-01', end_date: '2026-10-03', travellers: 2,
      transport_mode: 'car', budget_per_person_inr: 5000, travel_style: 'balanced',
      fixed_commitments: [], days, expenses: [], cover_emoji: '🧭', visibility: 'public',
      created_at: 1, updated_at: 1,
    }
    const trip = await seedTripFromRow()
    const before = tripById(trip.id)!.days.length
    expect(before).toBe(3)

    updateTrip(trip.id, { endDate: '2026-10-05' })
    await new Promise(r => setTimeout(r, 20))

    const after = tripById(trip.id)!
    expect(after.days).toHaveLength(5)
    expect(after.days[4].stops).toEqual([])
    const write = state.updates.find(u => Array.isArray((u.payload as any)?.days))
    expect(write).toBeDefined()
    expect((write!.payload as any).days).toHaveLength(5)
  })

  it('shrinking past a stop-holding day is refused and nothing persists', async () => {
    const { updateTrip, tripById } = await import('../src/store/store')
    const days = mkDays(4, [0, 0, 0, 2])
    state.tripRow = {
      id: '44444444-4444-4444-8444-44444444444D', owner_id: 'u-owner', name: 'Dates trip',
      start_location: 'Kochi', start_location_coords: null, destinations: ['Munnar'],
      destination_coords: null, start_date: '2026-10-01', end_date: '2026-10-04', travellers: 2,
      transport_mode: 'car', budget_per_person_inr: 5000, travel_style: 'balanced',
      fixed_commitments: [], days, expenses: [], cover_emoji: '🧭', visibility: 'public',
      created_at: 1, updated_at: 1,
    }
    const trip = await seedTripFromRow()

    updateTrip(trip.id, { endDate: '2026-10-02' }) // would drop days 3-4; day 4 has stops
    await new Promise(r => setTimeout(r, 20))

    expect(tripById(trip.id)!.days).toHaveLength(4)
    expect(state.updates.length).toBe(0)
  })
})

// pure import at the bottom so the vi.mock registers before the store loads
import { reconcileDays } from '../src/store/store'
