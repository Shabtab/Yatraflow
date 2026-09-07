// ============ fetchSharedTrip: on-demand reads of non-member trips ============
// The public itinerary page and the invite gate need OTHER people's trips,
// which the membership-scoped hydration deliberately keeps out of the cache.
// Guards the fetch → merge contract: direct select first (published trips are
// public via RLS), RPC fallback for private invite previews, honest null when
// nothing readable exists — and a fetched trip lands in the cache so
// tripById() finds it on the next render.
import { describe, it, expect, vi } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: { tripRow: null as unknown, rpcRows: null as unknown },
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = () => builder
    builder.maybeSingle = () => builder
    builder.single = () => builder
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      new Promise(resolve => {
        resolve({ data: table === 'trips' ? state.tripRow : null, error: null })
      }).then(res)
    return builder
  }
  return {
    isSupabaseConfigured: false,
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: () => Promise.resolve({ data: state.rpcRows, error: null }),
    },
  }
})

import { fetchSharedTrip, tripById } from '../src/store/store'
import type { TripRow } from '../src/lib/tripRow'

function row(overrides: Partial<TripRow> = {}): TripRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    owner_id: '22222222-2222-4222-8222-222222222222',
    name: 'Creator/public trip',
    start_location: 'Kolkata',
    start_location_coords: null,
    destinations: ['Jaipur'],
    destination_coords: null,
    start_date: '2026-10-01',
    end_date: '2026-10-03',
    travellers: 2,
    transport_mode: 'car',
    budget_per_person_inr: 10000,
    travel_style: 'balanced',
    fixed_commitments: [],
    days: [],
    expenses: [],
    cover_emoji: '🧭',
    visibility: 'public',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  }
}

describe('fetchSharedTrip', () => {
  it('returns a directly-readable trip and merges it into the cache', async () => {
    state.tripRow = row()
    state.rpcRows = null
    const t = await fetchSharedTrip(row().id)
    expect(t?.name).toBe('Creator/public trip')
    expect(tripById(row().id)?.name).toBe('Creator/public trip')
  })

  it('falls back to the invite-preview RPC when the direct select is RLS-empty', async () => {
    const privateRow = row({
      id: '33333333-3333-4333-8333-333333333333',
      visibility: 'private',
      name: 'Private invite',
    })
    state.tripRow = null
    state.rpcRows = [privateRow]
    const t = await fetchSharedTrip(privateRow.id, true)
    expect(t?.name).toBe('Private invite')
    expect(tripById(privateRow.id)?.name).toBe('Private invite')
  })

  it('returns null when neither the select nor the RPC yields a row', async () => {
    state.tripRow = null
    state.rpcRows = []
    const t = await fetchSharedTrip('44444444-4444-4444-8444-444444444444')
    expect(t).toBeNull()
  })
})
