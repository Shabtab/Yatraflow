// ============ Joining via invite: write order + code lookup ============
// The join flow had two silent-failure bugs this pins:
// 1. WRITE ORDER — joinViaInvite must join through the join_trip RPC BEFORE the
//    activity log and owner notification: those are RLS-gated on
//    is_editor(), which is false until the membership exists, so a join that
//    fires side effects first writes nothing (console errors only).
// 2. CODE LOOKUP — fetchTripByInviteCode resolves a short code via the
//    get_trip_by_invite_code RPC and merges the trip into the cache, so
//    My Trips and the workspace find it.
import { describe, it, expect, vi } from 'vitest'

const { state, writes } = vi.hoisted(() => ({
  // rows returned per table / rpc
  state: { tripRow: null as unknown, rpcRows: null as unknown } as Record<string, unknown>,
  // ordered record of every supabase write, so order can be asserted
  writes: [] as Array<{ table: string; kind: string; payload?: unknown }>,
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = () => builder
    builder.in = () => builder
    builder.maybeSingle = () => builder
    builder.limit = () => builder
    // .update()/.insert() record the write and resolve clean unless the test
    // plants an error. Note: the real client resolves { data, error }; the
    // store's fire() and awaits read .error.
    builder.update = (payload: unknown) => {
      writes.push({ table, kind: 'update', payload })
      builder._err = state.updateError ?? null
      return builder
    }
    builder.insert = (payload: unknown) => {
      writes.push({ table, kind: 'insert', payload })
      builder._err = state.insertError ?? null
      return builder
    }
    builder._err = null
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({
        // #804 — joinViaInvite now reads the full row AND its members after the
        // join, so this mock must answer both. Before, only `trips` mattered.
        data: table === 'trips' ? state.tripRow : table === 'trip_members' ? (state.memberRows ?? []) : null,
        error: (builder as { _err?: unknown })._err ?? null,
      }).then(res)
    return builder
  }
  return {
    isSupabaseConfigured: false,
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: (name: string, args: Record<string, unknown>) => {
        writes.push({ table: `rpc:${name}`, kind: 'rpc', payload: args })
        // join_trip answers with the trip id, or null, and can plant an error.
        if (name === 'join_trip') {
          return Promise.resolve({ data: state.joinResult ?? null, error: state.joinError ?? null })
        }
        return Promise.resolve({ data: state.rpcRows, error: null })
      },
    },
  }
})

import { fetchTripByInviteCode, joinViaInvite, tripById } from '../src/store/store'
import * as store from '../src/store/store'
import type { TripRow } from '../src/lib/tripRow'

const CODE = 'GOABEACHWE-K7QF'
/** The account this harness signs in as; the join is written by them. */
const ME = '33333333-3333-4333-8333-333333333333'

function row(overrides: Partial<TripRow> = {}): TripRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    owner_id: '22222222-2222-4222-8222-222222222222',
    name: 'Goa Beach Week',
    start_location: 'Mumbai',
    start_location_coords: null,
    destinations: ['Goa'],
    destination_coords: null,
    start_date: '2026-10-01',
    end_date: '2026-10-04',
    travellers: 3,
    transport_mode: 'car',
    budget_per_person_inr: 12000,
    travel_style: 'relaxed',
    fixed_commitments: [],
    days: [],
    expenses: [],
    cover_emoji: '🧭',
    invite_code: CODE,
    visibility: 'private',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  }
}

describe('fetchTripByInviteCode', () => {
  it('resolves a code via the RPC and returns the trip WITHOUT caching it', async () => {
    // #804 — the preview row is partial (31 of 34 columns), so it is returned to
    // the caller and deliberately never merged into cache.trips. The gate keeps
    // it in local state; a partial row in the writable cache is what let a
    // whole-row write erase the five columns it had not read.
    state.rpcRows = [row({ invite_code: 'GOA-K7QF' })]
    state.tripRow = null
    const t = await fetchTripByInviteCode('goa k7qf'.replace(' ', '-'))
    expect(t?.name).toBe('Goa Beach Week')
    expect(tripById(row().id)).toBeUndefined()
  })

  it('normalises casual input before the RPC call', async () => {
    // A distinct id AND code: a code already on a cached trip short-circuits
    // on the cache hit path and never reaches the RPC.
    state.rpcRows = [row({ id: '55555555-5555-4555-8555-555555555555', invite_code: CODE })]
    const t = await fetchTripByInviteCode(' goabeachwe-k7qf ')
    expect(t).not.toBeNull()
    const rpcWrite = writes.filter(w => w.table === 'rpc:get_trip_by_invite_code').at(-1)!
    expect((rpcWrite.payload as { p_code: string }).p_code).toBe(CODE)
  })

  it('returns null for an unknown code', async () => {
    state.rpcRows = []
    const t = await fetchTripByInviteCode('NOPE-1234')
    expect(t).toBeNull()
  })
})

describe('joinViaInvite (write order)', () => {
  it('joins through join_trip before the activity log and owner notification', async () => {
    await seedTripWithOwner()
    writes.length = 0

    const meId = '33333333-3333-4333-8333-333333333333'
    const ok = await joinViaInvite(row().id, meId, CODE)
    expect(ok).toBe(true)

    // Membership first, side effects after — and the joiner is on the trip.
    const order = writes.map(w => w.table)
    expect(order.indexOf('rpc:join_trip')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('rpc:join_trip')).toBeLessThan(order.indexOf('activity'))
    expect(order.indexOf('rpc:join_trip')).toBeLessThan(order.indexOf('notifications'))
    // The server adds the signed-in user, so the call names only the code.
    const joinCall = writes.find(w => w.table === 'rpc:join_trip')!
    expect(joinCall.payload).toEqual({ p_code: CODE })
    expect(tripById(row().id)?.members?.some(m => m.userId === meId)).toBe(true)
  })

  it('reports failure honestly when join_trip refuses the join', async () => {
    await seedTripWithOwner()
    writes.length = 0
    state.joinError = { message: 'row-level security policy violation' }

    const stranger = '44444444-4444-4444-8444-444444444444'
    const ok = await joinViaInvite(row().id, stranger, CODE)
    expect(ok).toBe(false)
    // No side effects fired, and the joiner was NOT optimistically added.
    expect(writes.find(w => w.table === 'activity')).toBeUndefined()
    expect(writes.find(w => w.table === 'notifications')).toBeUndefined()
    expect(tripById(row().id)?.members?.some(m => m.userId === stranger)).toBe(false)

    delete state.joinError
  })

  it('treats a null answer from join_trip as a failed join', async () => {
    await seedTripWithOwner()
    writes.length = 0
    state.joinResult = null

    const stranger = '44444444-4444-4444-8444-444444444444'
    const ok = await joinViaInvite(row().id, stranger, CODE)
    expect(ok).toBe(false)
    expect(writes.find(w => w.table === 'activity')).toBeUndefined()
    expect(tripById(row().id)?.members?.some(m => m.userId === stranger)).toBe(false)
  })

  it('treats an answer that names another trip as a failed join', async () => {
    await seedTripWithOwner()
    writes.length = 0
    state.joinResult = '55555555-5555-4555-8555-555555555555'

    const stranger = '44444444-4444-4444-8444-444444444444'
    const ok = await joinViaInvite(row().id, stranger, CODE)
    expect(ok).toBe(false)
    expect(writes.find(w => w.table === 'activity')).toBeUndefined()
    expect(tripById(row().id)?.members?.some(m => m.userId === stranger)).toBe(false)
  })

  it('is idempotent for an existing member', async () => {
    await seedTripWithOwner()
    const meId = '33333333-3333-4333-8333-333333333333'
    await joinViaInvite(row().id, meId, CODE)
    writes.length = 0
    const ok = await joinViaInvite(row().id, meId, CODE)
    expect(ok).toBe(true)
    expect(writes.filter(w => w.table === 'rpc:join_trip')).toHaveLength(0)
  })
})

/** Fresh trip + owner in the cache for the join tests (each test needs its
 *  own members state — the cache is module-global and mutates in place, so
 *  members are reset to just the owner before every assertion run). */
async function seedTripWithOwner(): Promise<void> {
  state.rpcRows = [row()]
  state.tripRow = row()
  state.joinResult = row().id
  state.joinError = null
  // #804 — joinViaInvite now AWAITS a full-row read after the join, and that
  // read is identity-guarded (the same #798 pattern the queue uses). The old
  // path never needed a session because it read tripById; this harness must
  // establish one, exactly as tests/fire-and-forget.test.ts does.
  const db = store.getSnapshot() as { sessionUserId: string | null }
  db.sessionUserId = ME
  // The loader reads the trip AND its members; the joiner is a member after the
  // join, and notifyOwnerOf needs an OWNER row in the cache to notify. Both are
  // supplied here so the write-order assertion can still see the notification.
  state.memberRows = [
    { trip_id: row().id, user_id: row().owner_id, role: 'owner', joined_at: 1 },
    { trip_id: row().id, user_id: ME, role: 'editor', joined_at: 2 },
  ]
  // The preview is no longer cached, so the seed does not look for it there.
  // The row is supplied by the mock's `trips` read, which is what the
  // full-row load reads after the join.
  await fetchTripByInviteCode(CODE)
  writes.length = 0
}
