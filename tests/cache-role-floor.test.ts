// ============ #804 round 10 B1 — an observed role applies to a CACHED trip too
//
// The realtime handler used to record an observed downgrade only when the trip
// was NOT cached. A cached editor who was downgraded kept edit rights, and the
// next full read put the stale editor row back. A cached grant also could not
// clear a floor recorded earlier, so that account stayed stale forever.
//
// These tests load the real store module and drive it through the same mocked
// client path the app uses: `applyRealtimeEvent` for the membership row and the
// real loader functions for the reads.
import { describe, expect, it, vi } from 'vitest'

const ME = '33333333-3333-4333-8333-333333333333'
const OWNER = '22222222-2222-4222-8222-222222222222'

const { state } = vi.hoisted(() => ({
  state: {
    tripRow: null as unknown,
    memberRows: [] as Array<Record<string, unknown>>,
    rpcRows: null as unknown,
  },
}))

vi.mock('../src/lib/supabase', () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.setHeader = () => b
    b.eq = () => b
    b.maybeSingle = () => Promise.resolve({ data: table === 'trips' ? state.tripRow : null, error: null })
    b.limit = () => b
    b.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data: table === 'trips' ? state.tripRow : state.memberRows, error: null }).then(res)
    return b
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'synthetic-token', user: { id: ME } } }, error: null }),
      },
      from: (t: string) => builder(t),
      rpc: () => ({ setHeader: () => ({ then: (r: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: state.rpcRows, error: null }).then(r) }) }),
    },
  }
})

import { _applyRealtimeEventForTest, getSnapshot, loadTripForTest, tripById } from '../src/store/store'

const TRIP = '11111111-1111-4111-8111-111111111111'

function tripRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TRIP, owner_id: OWNER, name: 'Goa Beach Week', start_location: 'Mumbai', start_location_coords: null,
    destinations: ['Goa'], destination_coords: null, start_date: '2026-10-01', end_date: '2026-10-04',
    travellers: 3, transport_mode: 'car', budget_per_person_inr: 12000, travel_style: 'relaxed',
    fixed_commitments: [], days: [], expenses: [], cover_emoji: 'x', invite_code: 'CODE', visibility: 'private',
    created_at: 1_700_000_000_000, updated_at: 1_700_000_000_000, write_version: 1,
    flights: [], tank_l: null, rent_per_day_inr: null, local_train: null, ref: null,
    fuel_economy_km_per_l: null, fuel_price_per_l: null, round_trip: null, cover_image_url: null,
    stay_style: null, driver_count: null, has_vulnerable: null, drive_after_dinner_min: null,
    vehicle_profile: null, deleted_at: null,
    ...overrides,
  }
}

function member(role: string) {
  return { trip_id: TRIP, user_id: ME, role, joined_at: 1 }
}

function roleNow(): string | null {
  return tripById(TRIP)?.members?.find(m => m.userId === ME)?.role ?? null
}

/** A fresh case: the same account, an empty cache, and no recorded floor. The
 *  floor map lives for the account's lifetime, so a case starts by clearing it
 *  through the authoritative grant that owns that transition. */
function reset(role: string) {
  const db = getSnapshot() as unknown as { sessionUserId: string | null; trips: unknown[] }
  db.sessionUserId = ME
  db.trips = []
  state.tripRow = tripRow()
  state.memberRows = [member(role), { trip_id: TRIP, user_id: OWNER, role: 'owner', joined_at: 1 }]
  realtime('UPDATE', member('editor'))
}

/** One realtime membership payload, through the containment wrapper the app uses. */
function realtime(eventType: 'INSERT' | 'UPDATE' | 'DELETE', newRow: Record<string, unknown>) {
  _applyRealtimeEventForTest('trip_members', {
    eventType,
    new: newRow,
    old: { trip_id: TRIP, user_id: ME, role: 'editor', joined_at: 1 },
  } as never)
}

describe('B1 — a downgrade that arrives for a CACHED trip blocks a stale editor read', () => {
  it('the downgrade is recorded, and the next full read cannot restore editor', async () => {
    reset('editor')
    expect(await loadTripForTest(TRIP)).toBe('loaded')
    expect(roleNow()).toBe('editor')

    realtime('UPDATE', member('viewer'))
    // The cached row takes the observed downgrade at once.
    expect(roleNow()).toBe('viewer')

    // The server read now shows the stale editor row: the recorded downgrade
    // must refuse it.
    state.memberRows = [member('editor'), { trip_id: TRIP, user_id: OWNER, role: 'owner', joined_at: 1 }]
    expect(await loadTripForTest(TRIP)).toBe('stale')
    expect(roleNow(), 'no read may restore a downgraded grant').toBe('viewer')
  })

  it('a cached GRANT clears the floor an earlier downgrade recorded', async () => {
    reset('viewer')
    expect(await loadTripForTest(TRIP)).toBe('loaded')
    expect(roleNow()).toBe('viewer')

    // The downgrade is the floor. Then the server's authoritative grant arrives,
    // both as the realtime row and as the next read's answer.
    realtime('UPDATE', member('viewer'))
    state.memberRows = [member('editor'), { trip_id: TRIP, user_id: OWNER, role: 'owner', joined_at: 1 }]
    realtime('UPDATE', member('editor'))
    expect(roleNow()).toBe('editor')
    expect(await loadTripForTest(TRIP), 'a grant clears the floor, so the next read is accepted').toBe('loaded')
    expect(roleNow()).toBe('editor')
  })

  it('an UPDATE that names no role is treated as a downgrade', async () => {
    reset('editor')
    expect(await loadTripForTest(TRIP)).toBe('loaded')
    realtime('UPDATE', { trip_id: TRIP, user_id: ME })
    expect(await loadTripForTest(TRIP)).toBe('stale')
  })

  it('a removal is a downgrade on the cached branch as well', async () => {
    reset('editor')
    expect(await loadTripForTest(TRIP)).toBe('loaded')
    realtime('DELETE', { trip_id: TRIP, user_id: ME })
    expect(tripById(TRIP), 'a removal evicts the cached trip').toBeUndefined()
  })
})
