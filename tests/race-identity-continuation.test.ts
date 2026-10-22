// ============ A race harness that can FAIL ============
//
// The first race harness in this repo could not fail. It flipped a field on its
// OWN mock and then asserted on that same field, so every assertion was
// circular: the code under test never had to change its behaviour for the test
// to pass. A gate reviewer deleted the identity re-check in
// `fetchTripByInviteCode` and all of its tests stayed green. A test that cannot
// tell a live guard from a deleted one is decoration.
//
// This file replaces it. Three rules hold the difference.
//
//   1. The identity change reaches the REAL store. The account switch goes
//      through `init()` and the Supabase auth callback, so the store's own
//      `cache.sessionUserId` changes and the store's own identity epoch
//      advances. A field on a mock is not an identity.
//   2. The assertions read what the STORE produced: the value the store
//      returned, the state the store's cache is in, and the requests the store
//      issued. A value the test wrote into a mock is not evidence.
//   3. Every test names the guard it pins, and the mutation table in
//      tests/race-harness-README.md records the scratch mutation that turns
//      that test red. A test with no red mutation is not a test.
//
// The race is the same in every case: the store enters an await, the world
// changes while the await is suspended, and the continuation that runs after
// the change is the one that shipped the bug. No test here waits for a clock.
// A deferred settles only when the test says so.
//
// The contract is the CURRENT one, after #804: `joinViaInvite` returns a
// `JoinResult`, the membership pre-query answers with certainty, and the invite
// preview is never cached.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createDeferred, flush, interleave, type Deferred } from './helpers/deferred'

// ---------- the mocked Supabase boundary ----------
//
// Only `src/lib/supabase` is mocked. Every await below is the store's own
// await, and every value the assertions read comes back out of the store.

const { state, requests, ids } = vi.hoisted(() => {
  const ids = {
    trip: '11111111-1111-4111-8111-111111111111',
    alice: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    bob: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }
  const state = {
    /** The account the SDK reports. The auth callback switches it. */
    sessionUserId: null as string | null,
    /** The auth callback that `init()` registered. */
    authHandler: null as ((event: string, session: unknown) => void) | null,
    /** The server's rows, per table. The mock filters them like PostgREST. */
    rows: {} as Record<string, Array<Record<string, unknown>>>,
    /** A held read or call: it waits for this before it answers. */
    gates: {} as Record<string, Deferred<unknown>>,
    /** A receipt that the held read was reached. */
    entered: {} as Record<string, Deferred<void>>,
    /** The rows the invite-code RPC answers with. */
    inviteRows: [] as Array<Record<string, unknown>>,
    /** The trip id the join RPC answers with. */
    joinTripId: null as unknown,
  }
  return { state, requests: [] as Array<{ kind: string; detail: string }>, ids }
})

vi.mock('../src/lib/supabase', () => {
  type Filter = { col: string; val: unknown; kind: 'eq' | 'in' }

  /**
   * The name of a read, so a test can hold ONE read without holding the
   * others. The store reads `trip_members` in three shapes: the membership
   * pre-query (one row, filtered by user), the loader's member list (many rows,
   * filtered by trip), and the hydrate's scope read (many rows, filtered by an
   * id list). Only the first two take part in a join.
   */
  function readName(table: string, mode: 'one' | 'many', filters: Filter[]): string {
    const eq = filters.filter(f => f.kind === 'eq').map(f => f.col)
    if (table === 'trip_members' && mode === 'one' && eq.includes('user_id')) return 'membership-prequery'
    if (table === 'trip_members' && mode === 'many' && eq.includes('trip_id')) return 'members-list'
    if (table === 'trips' && mode === 'one' && eq.includes('id')) return 'trip-row'
    return `${table}-${mode}`
  }

  function rowsFor(table: string, filters: Filter[]): Array<Record<string, unknown>> {
    let rows = state.rows[table] ?? []
    for (const f of filters) {
      if (f.kind === 'eq') rows = rows.filter(r => r[f.col] === f.val)
      else rows = rows.filter(r => (f.val as unknown[]).includes(r[f.col]))
    }
    return rows
  }

  const builderFor = (table: string) => {
    const builder: Record<string, unknown> = {}
    const filters: Filter[] = []
    let mode: 'one' | 'many' = 'many'
    const answer = (): { data: unknown; error: null } => {
      const rows = rowsFor(table, filters)
      return { data: mode === 'one' ? (rows[0] ?? null) : rows, error: null }
    }
    const deliver = () => {
      const name = readName(table, mode, filters)
      const gate = state.gates[name]
      if (!gate) return Promise.resolve(answer())
      // The receipt: the test knows the store is inside this await.
      state.entered[name]?.resolve()
      // The answer is read when the read lands, so a change made while the
      // read is in flight is what the store sees.
      return gate.promise.then(answer)
    }
    builder.select = () => builder
    builder.eq = (col: string, val: unknown) => { filters.push({ col, val, kind: 'eq' }); return builder }
    builder.in = (col: string, val: unknown) => { filters.push({ col, val, kind: 'in' }); return builder }
    builder.setHeader = () => builder
    builder.is = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.maybeSingle = () => { mode = 'one'; return deliver() }
    builder.then = (resolve: (result: unknown) => unknown, reject?: (error: unknown) => unknown) =>
      deliver().then(resolve, reject)
    builder.insert = () => Promise.resolve({ data: null, error: null })
    builder.update = () => Promise.resolve({ data: null, error: null })
    builder.delete = () => Promise.resolve({ data: null, error: null })
    builder.upsert = () => Promise.resolve({ data: null, error: null })
    return builder
  }

  /**
   * An RPC answer. The store pins a bearer with `setHeader` on some calls and
   * awaits the result directly on others, so the answer carries both.
   */
  function rpcResult(name: string, answer: () => { data: unknown; error: null }) {
    const result: Record<string, unknown> = {}
    result.setHeader = () => result
    result.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      const gate = state.gates[name]
      if (!gate) return Promise.resolve(answer()).then(resolve, reject)
      state.entered[name]?.resolve()
      return gate.promise.then(answer).then(resolve, reject)
    }
    return result
  }

  return {
    isSupabaseConfigured: true,
    supabase: {
      from: (table: string) => builderFor(table),
      rpc: (name: string, args: Record<string, unknown>) => {
        requests.push({ kind: 'rpc', detail: `${name} ${JSON.stringify(args)}` })
        if (name === 'join_trip') {
          // The server grants the membership. The client cannot know that, so
          // the mock, which is the server, writes the row.
          state.rows.trip_members = [
            ...(state.rows.trip_members ?? []),
            { trip_id: ids.trip, user_id: state.sessionUserId, role: 'editor', joined_at: 1 },
          ]
          return rpcResult(name, () => ({ data: state.joinTripId, error: null }))
        }
        if (name === 'get_trip_by_invite_code') {
          return rpcResult(name, () => ({ data: state.inviteRows, error: null }))
        }
        return rpcResult(name, () => ({ data: [], error: null }))
      },
      auth: {
        getSession: () => Promise.resolve({
          data: {
            session: state.sessionUserId
              ? { access_token: 'synthetic-token', user: { id: state.sessionUserId } }
              : null,
          },
          error: null,
        }),
        onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
          state.authHandler = callback
          return { data: { subscription: {} } }
        },
        signOut: async () => ({ error: null }),
      },
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
      }),
      removeChannel: async () => undefined,
    },
  }
})

// The store's own side effects must not reach the network or the DOM.
vi.mock('../src/components/ui', () => ({ toast: vi.fn() }))
vi.mock('../src/lib/tripDna', () => ({ attachDnaAccount: vi.fn(), detachDnaAccount: vi.fn() }))
vi.mock('../src/lib/createEvents', () => ({ backfillCreateFunnelSession: vi.fn() }))
vi.mock('../src/lib/writeQueue', () => ({
  clearWritesFor: vi.fn(),
  pendingWrites: vi.fn(async () => []),
  queueWrite: vi.fn(async () => true),
  dropWriteIfCurrent: vi.fn(),
  requeueIfCurrent: vi.fn(),
  replayVerdict: vi.fn(() => 'apply'),
  shouldRetry: vi.fn(() => true),
}))
vi.mock('../src/lib/offlineCache', () => ({
  clearSnapshot: vi.fn(),
  saveSnapshot: vi.fn(),
  loadSnapshot: vi.fn(async () => null),
}))

const { trip: TRIP, alice: ALICE, bob: BOB } = ids
const CODE = 'GOA-K7QFH3WT'

/** A preview row: the invite RPC names 31 of the 34 trip columns. */
function previewRow(): Record<string, unknown> {
  return {
    id: TRIP, owner_id: BOB, name: 'Goa Beach Week', start_location: 'Mumbai', start_location_coords: null,
    destinations: ['Goa'], destination_coords: null, start_date: '2026-10-01', end_date: '2026-10-04',
    travellers: 3, transport_mode: 'car', budget_per_person_inr: 12000, travel_style: 'relaxed',
    fixed_commitments: [], days: [], expenses: [], cover_emoji: '🧭', invite_code: CODE, visibility: 'private',
    created_at: 1_700_000_000_000, updated_at: 1_700_000_000_000, write_version: 1,
  }
}

/** A full row: the loader reads every column, and admission checks them all. */
function fullTripRow(): Record<string, unknown> {
  return {
    ...previewRow(),
    flights: [], tank_l: null, rent_per_day_inr: null, local_train: null, ref: null,
    fuel_economy_km_per_l: null, fuel_price_per_l: null, round_trip: null, cover_image_url: null,
    stay_style: null, driver_count: null, has_vulnerable: null, drive_after_dinner_min: null,
    vehicle_profile: null, deleted_at: null,
  }
}

/** A member row on the trip. */
function memberRow(userId: string, role: string): Record<string, unknown> {
  return { trip_id: TRIP, user_id: userId, role, joined_at: 1 }
}

/**
 * A fresh store with a signed-in account.
 *
 * `init()` is the store's own entry point. It reads the session from the SDK
 * and hydrates, so the store's cache holds the account and the store's identity
 * epoch has advanced. Nothing here writes a field on the mock to fake an
 * identity: the identity comes from the session the SDK reports.
 */
async function storeFor(account: string) {
  vi.resetModules()
  state.sessionUserId = account
  state.authHandler = null
  const store = await import('../src/store/store')
  store.init()
  await drain()
  return store
}

/**
 * Switch the account the way the app does: the SDK reports a new session.
 *
 * This is the REAL switch. The store registered this callback in `init()`, and
 * the store's own hydrate answers it: the store's cache holds the new account
 * and the store's identity epoch advances. A test that changed only a field on
 * the mock left the store believing it was still the old account, which is why
 * the first harness could not fail.
 */
function switchAccount(account: string): void {
  state.sessionUserId = account
  state.authHandler?.('SIGNED_IN', { user: { id: account } })
}

/** Hold one read open, and report when the store is inside it. */
function hold(name: string) {
  const entered = createDeferred<void>()
  const release = createDeferred<unknown>()
  state.entered[name] = entered
  state.gates[name] = release
  return { entered: entered.promise, release }
}

/** Let every pending continuation run. A task turn, not a wait for a clock. */
async function drain(): Promise<void> {
  await flush()
  await new Promise(resolve => setTimeout(resolve, 0))
  await flush()
}

/** The requests the STORE issued, read back from the request log. */
function issued(kind: string, detailIncludes?: string) {
  return requests.filter(r => r.kind === kind && (detailIncludes === undefined || r.detail.includes(detailIncludes)))
}

beforeEach(() => {
  requests.length = 0
  state.sessionUserId = null
  state.authHandler = null
  state.gates = {}
  state.entered = {}
  state.inviteRows = []
  state.joinTripId = null
  // ALICE holds no membership and no trip, so the join path reaches its own
  // membership pre-query and the invite path reaches its own RPC.
  state.rows = { trips: [], trip_members: [], profiles: [], published_itineraries: [] }
})

describe('the invite preview is an await a real account switch can land in', () => {
  it('a preview that resolves after the account changed is refused', async () => {
    // The guard: `fetchTripByInviteCode` re-checks the identity epoch and the
    // session account after its RPC await, and answers null when either moved.
    const store = await storeFor(ALICE)
    const held = hold('get_trip_by_invite_code')
    state.inviteRows = [previewRow()]

    const started = store.fetchTripByInviteCode(CODE)
    // The receipt: the store is inside the RPC await now.
    await held.entered
    // The account changes while the store waits.
    await interleave(held.entered, () => switchAccount(BOB), held.release)
    await drain()

    // The store's own answer, not a value the test wrote anywhere.
    const preview = await started
    expect(preview, 'a preview for the previous account must not be returned').toBeNull()
    // And the store's own cache stayed empty: the preview is never cached.
    expect(store.tripById(TRIP), 'the preview must not enter the cache').toBeUndefined()
    expect(store.getSnapshot().trips).toHaveLength(0)
  })

  it('a preview that resolves for the same account is returned', async () => {
    // The control. Without it, the test above could pass by refusing every
    // preview. This one proves the path still returns a preview when nothing
    // changed.
    const store = await storeFor(ALICE)
    const held = hold('get_trip_by_invite_code')
    state.inviteRows = [previewRow()]

    const started = store.fetchTripByInviteCode(CODE)
    await held.entered
    held.release.resolve(undefined)
    await drain()

    const preview = await started
    expect(preview, 'the preview must be returned for the current account').not.toBeNull()
    expect(preview?.id).toBe(TRIP)
    expect(preview?.name).toBe('Goa Beach Week')
  })
})

describe('the join is an await a real account change can land in', () => {
  it('a join whose membership pre-query answers after the account changed is abandoned', async () => {
    // The guard: `joinAfterScope` re-checks the captured identity after the
    // membership pre-query await, and answers 'abandoned' when the account
    // moved. The identity is the store's own session and epoch.
    const store = await storeFor(ALICE)
    const held = hold('membership-prequery')
    state.joinTripId = TRIP
    state.rows.trips = [fullTripRow()]

    const started = store.joinViaInvite(TRIP, ALICE, CODE)
    // The receipt: the store is inside the membership read now.
    await held.entered
    // The account changes while the store waits.
    await interleave(held.entered, () => switchAccount(BOB), held.release)
    await drain()

    // The store's own verdict. 'abandoned' is the honest answer: the account
    // that asked is gone, so this client cannot claim a join for it.
    const outcome = await started
    expect(outcome, 'a join for a departed account must be abandoned').toBe('abandoned')
    // The store must not write a membership for the account that left.
    expect(issued('rpc', 'join_trip'), 'the join RPC is never reached').toHaveLength(0)
    expect(store.tripById(TRIP), 'nothing is admitted for a departed account').toBeUndefined()
  })
})

describe('the join is an await a membership change can land in', () => {
  it('a join whose full-row read answers after the membership was revoked reports not-member', async () => {
    // The guard: `admitFullRow` refuses a full row when the caller's own
    // membership row is absent, and `finishJoin` reports that as 'not-member'.
    //
    // The membership pre-query answers "member, certain", so the store claims
    // no join write and reads the full row. The membership is revoked while
    // that read is in flight, so the loader's answer is the one that counts.
    const store = await storeFor(ALICE)
    const held = hold('members-list')
    state.joinTripId = TRIP
    state.rows.trips = [fullTripRow()]
    state.rows.trip_members = [memberRow(ALICE, 'editor')]

    const started = store.joinViaInvite(TRIP, ALICE, CODE)
    // The receipt: the store is inside the loader's member read now.
    await held.entered
    // The membership is revoked while the store waits.
    state.rows.trip_members = []
    held.release.resolve(undefined)
    await drain()

    // The store's own verdict, from the current #804 JoinResult contract.
    const outcome = await started
    expect(outcome, 'a revoked membership is not a join').toBe('not-member')
    // And the store's own cache holds nothing: the refused row was not admitted.
    expect(store.tripById(TRIP), 'a refused row is not admitted').toBeUndefined()
    expect(store.getSnapshot().trips).toHaveLength(0)
  })

  it('a join whose membership is intact reports joined and admits the row', async () => {
    // The control for the test above. The same path and the same awaits, with
    // the membership still held. If this one failed, the refusal above would
    // be proving nothing but a broken path.
    const store = await storeFor(ALICE)
    const held = hold('members-list')
    state.joinTripId = TRIP
    state.rows.trips = [fullTripRow()]
    state.rows.trip_members = [memberRow(ALICE, 'editor')]

    const started = store.joinViaInvite(TRIP, ALICE, CODE)
    await held.entered
    held.release.resolve(undefined)
    await drain()

    const outcome = await started
    expect(outcome, 'an intact membership is a join').toBe('joined')
    expect(store.tripById(TRIP)?.id, 'the admitted row is in the cache').toBe(TRIP)
  })
})

describe('the harness itself must be able to fail', () => {
  it('the store really changed its session account on the switch', async () => {
    // The proof that the harness reaches the store and not the mock. Without
    // this, every other test in this file could be a mock that never touched
    // the product.
    const store = await storeFor(ALICE)
    expect(store.getSnapshot().sessionUserId, 'the store holds the signed-in account').toBe(ALICE)
    switchAccount(BOB)
    await drain()
    expect(store.getSnapshot().sessionUserId, 'the store follows the account switch').toBe(BOB)
  })
})
