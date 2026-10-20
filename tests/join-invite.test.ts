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
    builder.setHeader = () => builder
    // #804 (S3) — the member read is filtered by trip_id and user_id, so the
    // mock must remember those filters to answer it honestly.
    builder._filters = [] as Array<[string, unknown]>
    builder.eq = (col: string, val: unknown) => {
      ;(builder._filters as Array<[string, unknown]>).push([col, val])
      return builder
    }
    builder.in = () => builder
    // #804 (S3) — viewerIsMemberOf uses maybeSingle, so it must resolve to the
    // filtered row or null, not the builder itself (which is always truthy and
    // would make every caller look like a member).
    builder.maybeSingle = () => {
      const filters = (builder._filters as Array<[string, unknown]>)
      const rows = ((state.memberRows ?? []) as Array<Record<string, unknown>>)
        .filter(r => filters.every(([col, val]) => r[col] === val))
      const data = table === 'trips' ? state.tripRow : (rows[0] ?? null)
      return Promise.resolve({ data, error: (builder as { _err?: unknown })._err ?? null })
    }
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
      auth: {
        getSession: async () => ({
          data: { session: { access_token: 'synthetic-token', user: { id: ME } } },
          error: null,
        }),
      },
      from: (t: string) => makeBuilder(t),
      rpc: (name: string, args: Record<string, unknown>) => {
        writes.push({ table: `rpc:${name}`, kind: 'rpc', payload: args })
        // join_trip answers with the trip id, or null, and can plant an error.
        if (name === 'join_trip') {
          // #804 (B2a) — an account switch can land INSIDE this await. The hook
          // lets a test flip the signed-in user before the RPC resolves, which is
          // the only way to exercise the post-await identity re-check. It is a
          // callback because this mock is hoisted above the store import.
          const hook = state.switchDuringJoin as (() => void) | undefined
          if (hook) hook()
          // A successful join adds the caller as a member, so the full-row load
          // that follows sees them on the trip (the loader needs it, S2).
          const answer = state.joinResult ?? null
          if (answer && !state.joinError) {
            const rows = (state.memberRows ?? []) as Array<Record<string, unknown>>
            if (!rows.some(r => r.user_id === ME)) {
              rows.push({ trip_id: String(answer), user_id: ME, role: 'editor', joined_at: 3 })
              state.memberRows = rows
            }
          }
          const result = { data: answer, error: state.joinError ?? null }
          const then = (res: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve(result).then(res)
          return { setHeader: () => ({ then }), then }
        }
        return Promise.resolve({ data: state.rpcRows, error: null })
      },
    },
  }
})

import { readFileSync } from 'node:fs'
import { fetchTripByInviteCode, joinViaInvite, tripById } from '../src/store/store'

const STORE = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
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
    // #804 (B2) — the loader refuses a row with no usable revision, and compares
    // timestamps as millisecond epochs. A fixture with `updated_at: 1` and no
    // `write_version` would be refused for the right reason but the wrong cause,
    // so it carries what a real row carries.
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    write_version: 1,
    // The five protected columns a full row carries; admission refuses a row
    // without them, because a whole-row write built from it would erase them.
    flights: [],
    tank_l: null,
    rent_per_day_inr: null,
    local_train: null,
    ref: null,
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
  it('joins through join_trip and claims no insertion', async () => {
    await seedTripWithOwner()
    writes.length = 0

    const meId = '33333333-3333-4333-8333-333333333333'
    const ok = await joinViaInvite(row().id, meId, CODE)
    expect(ok).toBe('joined')

    // R5 — the idempotent RPC cannot report an insertion, so this client writes
    // no activity row and sends no owner notice.
    expect(writes.filter(w => w.table === 'rpc:join_trip')).toHaveLength(1)
    expect(writes.filter(w => w.table === 'activity')).toHaveLength(0)
    expect(writes.filter(w => w.table === 'notifications')).toHaveLength(0)
    // The server adds the signed-in user, so the call names only the code.
    const joinCall = writes.find(w => w.table === 'rpc:join_trip')!
    expect(joinCall.payload).toEqual({ p_code: CODE })
    expect(tripById(row().id)?.members?.some(m => m.userId === meId)).toBe(true)
  })

  /** A trip this account is NOT on, so the join RPC is actually issued. */
  const freshJoinable = async (id: string) => {
    state.rpcRows = [row({ id })]
    state.tripRow = row({ id })
    state.joinResult = id
    state.joinError = null
    state.memberRows = [{ trip_id: id, user_id: row().owner_id, role: 'owner', joined_at: 1 }]
    await fetchTripByInviteCode(CODE)
    writes.length = 0
  }

  it('reports failure honestly when join_trip refuses the join', async () => {
    const t = '77777777-7777-4777-8777-777777777777'
    await freshJoinable(t)
    state.joinError = { message: 'row-level security policy violation' }

    // S2 — the caller must be the SIGNED-IN account, or the pre-RPC identity
    // guard refuses and the RPC is never reached, so the test would prove
    // nothing about the RPC's own failure handling. The trip is one this account
    // is not on, or the membership short-circuit would skip the RPC too.
    const ok = await joinViaInvite(t, ME, CODE)
    expect(ok).toBe('failed')
    expect(writes.filter(w => w.table === 'rpc:join_trip'), 'the RPC must actually run').toHaveLength(1)
    expect(writes.find(w => w.table === 'activity')).toBeUndefined()
    expect(writes.find(w => w.table === 'notifications')).toBeUndefined()
    // The preview is never cached, so there is no row to check; the absence of a
    // cache entry is itself the guarantee.
    expect(tripById(t)).toBeUndefined()

    state.joinError = null
  })

  it('treats a null answer from join_trip as a failed join', async () => {
    const t = '88888888-8888-4888-8888-888888888888'
    await freshJoinable(t)
    state.joinResult = null

    const ok = await joinViaInvite(t, ME, CODE)
    expect(ok).toBe('failed')
    expect(writes.filter(w => w.table === 'rpc:join_trip'), 'the RPC must actually run').toHaveLength(1)
    expect(writes.find(w => w.table === 'activity')).toBeUndefined()
    // The preview is never cached, so there is no row to check; the absence of a
    // cache entry is itself the guarantee.
    expect(tripById(t)).toBeUndefined()
  })

  it('treats an answer that names another trip as a failed join', async () => {
    const t = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    await freshJoinable(t)
    state.joinResult = '55555555-5555-4555-8555-555555555555'

    const ok = await joinViaInvite(t, ME, CODE)
    expect(ok).toBe('failed')
    expect(writes.filter(w => w.table === 'rpc:join_trip'), 'the RPC must actually run').toHaveLength(1)
    expect(writes.find(w => w.table === 'activity')).toBeUndefined()
    // The preview is never cached, so there is no row to check; the absence of a
    // cache entry is itself the guarantee.
    expect(tripById(t)).toBeUndefined()
  })
  it('is idempotent for an existing member', async () => {
    // A member already on the trip: the second call must not issue a join RPC.
    const t = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    state.rpcRows = [row({ id: t })]
    state.tripRow = row({ id: t })
    state.joinResult = t
    state.joinError = null
    state.memberRows = [
      { trip_id: t, user_id: row().owner_id, role: 'owner', joined_at: 1 },
      { trip_id: t, user_id: ME, role: 'editor', joined_at: 2 },
    ]
    await fetchTripByInviteCode(CODE)
    writes.length = 0
    const ok = await joinViaInvite(t, ME, CODE)
    expect(ok).toBe('joined')
    expect(writes.filter(w => w.table === 'rpc:join_trip')).toHaveLength(0)
  })

  it('S3 — an existing member sends the owner NO joined-as-editor notice', async () => {
    // Re-clicking an invite you are already on must not tell the owner that you
    // just joined. Only a call that WRITES a membership owes that notice.
    //
    // The RPC itself IS issued here, and that is correct: join_trip is
    // `on conflict do nothing`, so it is idempotent server-side. The RPC is not
    // the harm; a false notification is. This member was seeded as already on
    // the trip and never joined through this client, so the dedupe Set cannot
    // mask the result — only the owed flag can suppress the notice.
    const t = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    state.rpcRows = [row({ id: t })]
    state.tripRow = row({ id: t })
    state.joinResult = t
    state.joinError = null
    state.memberRows = [
      { trip_id: t, user_id: row().owner_id, role: 'owner', joined_at: 1 },
      { trip_id: t, user_id: ME, role: 'editor', joined_at: 2 },
    ]
    await fetchTripByInviteCode(CODE)
    writes.length = 0
    const ok = await joinViaInvite(t, ME, CODE)
    expect(ok).toBe('joined')
    expect(writes.filter(w => w.table === 'notifications'), 'a member re-opening a link notifies nobody').toHaveLength(0)
  })

  it('B2 — finishJoin carries an abandoned load through unchanged', () => {
    // The loader reports 'abandoned' when the account or access epoch changed
    // mid-read. finishJoin must carry that through: reporting 'joined-unloaded'
    // would claim a membership this client cannot verify, and reporting 'failed'
    // would claim there is none.
    const body = STORE.slice(STORE.indexOf('async function finishJoin('))
    const end = body.indexOf('\n}\n')
    const finish = end > 0 ? body.slice(0, end + 3) : body
    expect(finish).toContain("if (loaded === 'abandoned')")
    const abandonedAt = finish.indexOf("if (loaded === 'abandoned')")
    const unloadedAt = finish.indexOf("return 'joined-unloaded'")
    expect(abandonedAt).toBeGreaterThan(-1)
    expect(abandonedAt, 'abandoned is handled before any success or read claim').toBeLessThan(unloadedAt)
    // The abandoned branch returns 'abandoned' and reads nothing into a claim.
    expect(finish).toContain("return 'abandoned'")
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
  // #804 (S3) — the seed must NOT list this caller as a member. joinViaInvite
  // now asks the membership table before the RPC, and a seeded membership would
  // short-circuit the join the write-order test needs to observe. The owner row
  // stays, because notifyOwnerOf reads it from the loaded trip.
  state.memberRows = [
    { trip_id: row().id, user_id: row().owner_id, role: 'owner', joined_at: 1 },
  ]
  // The preview is no longer cached, so the seed does not look for it there.
  // The row is supplied by the mock's `trips` read, which is what the
  // full-row load reads after the join.
  await fetchTripByInviteCode(CODE)
  writes.length = 0
}
