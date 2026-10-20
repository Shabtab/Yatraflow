// ============ UNIT 1 — real product contracts: request identity and admission ============
//
// These drive `joinViaInvite` from the product store. Only the Supabase module
// boundary is mocked (synthetic answers), so every await below is the real one
// and every outcome is the store's own return value.
//
// Ordering proof: each race waits for an explicit receipt that the real await has
// been entered, changes the signed-in account, and only then releases it. There
// is no timer anywhere in this file.
//
// Contracts, and why they are expected to fail on the frozen source:
//   C1/a  a switch BEFORE initiation abandons and issues no request.
//         Today the store answers 'failed', which is a different claim.
//   R2/a  an unusable revision into an EMPTY cache is not 'joined'.
//         Today the refusal ('stale') is mapped to 'joined', so the gate would
//         navigate with nothing cached.
// The two green cases are the regressions that must keep holding.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createDeferred, flush, type Deferred } from './helpers/deferred'

const { state, events } = vi.hoisted(() => ({
  state: {
    gate: {} as Record<string, Deferred<unknown>>,
    entered: {} as Record<string, Deferred<void>>,
    sessionUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    memberRowForCaller: null as unknown,
    members: [] as Array<Record<string, unknown>>,
    tripRow: null as unknown,
    joinTripId: null as unknown,
    joinError: null as unknown,
  },
  events: [] as Array<unknown[]>,
}))

vi.mock('../src/lib/supabase', () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {}
    const filters: Array<[string, unknown]> = []
    b.select = () => b
    b.setHeader = () => b
    b.eq = (col: string, val: unknown) => {
      filters.push([col, val])
      return b
    }
    const hold = (name: string): Deferred<unknown> | null => {
      state.entered[name]?.resolve()
      const gate = state.gate[name]
      return gate && !gate.settled() ? gate : null
    }
    b.maybeSingle = () => {
      events.push(['read-one', table])
      const gate = hold(table)
      const answer = table === 'trips' ? state.tripRow : state.memberRowForCaller
      const done = () => ({ data: answer ?? null, error: null })
      return gate ? gate.promise.then(done) : Promise.resolve(done())
    }
    // The loader reads trip_members as a list, and `.then` is the dispatch.
    b.then = (res: (v: { data: unknown; error: unknown }) => unknown) => {
      events.push(['read-list', table])
      const gate = hold(table)
      const answer = table === 'trips' ? [state.tripRow] : state.members
      const done = () => ({ data: answer, error: null })
      return (gate ? gate.promise.then(done) : Promise.resolve(done())).then(res)
    }
    b.insert = (payload: unknown) => {
      events.push(['insert', table, payload])
      return Promise.resolve({ data: null, error: null })
    }
    b.update = (payload: unknown) => {
      events.push(['update', table, payload])
      return Promise.resolve({ data: null, error: null })
    }
    b.delete = () => Promise.resolve({ data: null, error: null })
    return b
  }

  return {
    isSupabaseConfigured: false,
    supabase: {
      // C1 — the store captures its bearer through the SDK session. This answers
      // as the signed-in fixture account, so a pinned request carries it.
      auth: {
        getSession: async () => ({
          data: { session: { access_token: 'synthetic-token', user: { id: state.sessionUserId } } },
          error: null,
        }),
      },
      from: (table: string) => builder(table),
      rpc: (name: string, args: Record<string, unknown>) => {
        events.push(['rpc', name, args])
        state.entered[name]?.resolve()
        const answer = () => ({ data: state.joinTripId, error: state.joinError })
        if (name !== 'join_trip') return Promise.resolve({ data: [], error: null })
        const gate = state.gate[name]
        const then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
          (gate && !gate.settled() ? gate.promise.then(answer) : Promise.resolve(answer())).then(res)
        const builderRpc = { setHeader: () => builderRpc, then }
        return builderRpc
      },
    },
  }
})

import { joinViaInvite, getSnapshot, tripById } from '../src/store/store'

const TRIP = '11111111-1111-4111-8111-111111111111'
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CODE = 'SYNTHETIC-CODE'

/** Hold a real await open and signal when the product has entered it. */
function hold(name: string) {
  const entered = createDeferred<void>()
  const release = createDeferred<unknown>()
  state.entered[name] = entered
  state.gate[name] = release
  return { entered: entered.promise, release }
}

function signIn(userId: string): void {
  state.sessionUserId = userId
  ;(getSnapshot() as { sessionUserId: string | null }).sessionUserId = userId
}

/** A row a real server read carries: every field the loader validates. */
function tripRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TRIP,
    owner_id: BOB,
    name: 'Goa Beach Week',
    start_location: 'Mumbai',
    start_location_coords: null,
    destinations: ['Goa'],
    destination_coords: null,
    start_date: '2026-10-01',
    end_date: '2026-10-04',
    travellers: 2,
    transport_mode: 'car',
    budget_per_person_inr: 12000,
    travel_style: 'relaxed',
    fixed_commitments: [],
    days: [],
    expenses: [],
    cover_emoji: '🧭',
    invite_code: CODE,
    visibility: 'private',
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    write_version: 1,
    // The five protected columns; admission refuses a full row without them.
    flights: [],
    tank_l: null,
    rent_per_day_inr: null,
    local_train: null,
    ref: null,
    ...overrides,
  }
}

function insertsOf(table: string): Array<unknown[]> {
  return events.filter(e => e[0] === 'insert' && e[1] === table)
}

function joinDispatches(): Array<unknown[]> {
  return events.filter(e => e[0] === 'rpc' && e[1] === 'join_trip')
}

beforeEach(() => {
  events.length = 0
  state.gate = {}
  state.entered = {}
  state.memberRowForCaller = null
  state.members = []
  state.tripRow = null
  state.joinTripId = null
  state.joinError = null
  signIn(ALICE)
  ;(getSnapshot() as { trips: unknown[] }).trips = []
})

describe('C1/a — a switch before initiation abandons and issues no request', () => {
  it('the real entry point returns abandoned and dispatches no join', async () => {
    // The gate captured ALICE, then the account became BOB before the call.
    signIn(BOB)

    const outcome = await joinViaInvite(TRIP, ALICE, CODE)

    expect(outcome).toBe('abandoned')
    expect(joinDispatches(), 'no join request is issued').toHaveLength(0)
    expect(insertsOf('activity')).toHaveLength(0)
    expect(insertsOf('notifications')).toHaveLength(0)
    expect(tripById(TRIP)).toBeUndefined()
  })
})

describe('C1/b — a switch inside the membership read abandons', () => {
  it('the continuation stops and writes nothing', async () => {
    state.joinTripId = TRIP
    const held = hold('trip_members')

    const started = joinViaInvite(TRIP, ALICE, CODE)
    await held.entered // receipt: the product is inside the membership read

    signIn(BOB)
    held.release.resolve(undefined)
    await flush()
    const outcome = await started

    expect(outcome).toBe('abandoned')
    expect(joinDispatches(), 'the join is never dispatched').toHaveLength(0)
    expect(insertsOf('activity')).toHaveLength(0)
    expect(tripById(TRIP)).toBeUndefined()
  })
})

describe('C1/c — a switch inside the join dispatch abandons the continuation', () => {
  it('the RPC is not followed by any effect for the new account', async () => {
    state.memberRowForCaller = null // certain "not a member", so the RPC runs
    state.joinTripId = TRIP
    state.tripRow = tripRow()
    state.members = [{ trip_id: TRIP, user_id: ALICE, role: 'editor', joined_at: 1 }]
    const held = hold('join_trip')

    const started = joinViaInvite(TRIP, ALICE, CODE)
    await held.entered // receipt: the dispatch has been entered

    signIn(BOB)
    held.release.resolve(undefined)
    await flush()
    const outcome = await started

    expect(outcome).toBe('abandoned')
    expect(insertsOf('activity'), 'no activity is claimed').toHaveLength(0)
    expect(insertsOf('notifications'), 'the owner is not told').toHaveLength(0)
    expect(tripById(TRIP)).toBeUndefined()
  })
})

describe('R2/a — an unusable revision into an empty cache is not a join', () => {
  it('the refusal is reported as joined-unloaded and the cache stays empty', async () => {
    // The caller is a member, and the full row arrives with no usable revision,
    // so the loader refuses it. The gate must not be told 'joined'.
    state.memberRowForCaller = { user_id: ALICE }
    state.members = [{ trip_id: TRIP, user_id: ALICE, role: 'editor', joined_at: 1 }]
    state.tripRow = tripRow({ write_version: undefined })

    const outcome = await joinViaInvite(TRIP, ALICE, CODE)

    expect(outcome).toBe('joined-unloaded')
    expect(tripById(TRIP), 'nothing was admitted').toBeUndefined()
  })

  it('an invalid revision is refused the same way as a missing one', async () => {
    state.memberRowForCaller = { user_id: ALICE }
    state.members = [{ trip_id: TRIP, user_id: ALICE, role: 'editor', joined_at: 1 }]
    state.tripRow = tripRow({ write_version: 2.5 })

    const outcome = await joinViaInvite(TRIP, ALICE, CODE)

    expect(outcome).toBe('joined-unloaded')
    expect(tripById(TRIP)).toBeUndefined()
  })
})

describe('R2 regression controls — these must keep holding', () => {
  it('an empty membership read for a non-owner caller refuses as failed', async () => {
    state.memberRowForCaller = null
    state.joinTripId = TRIP
    state.tripRow = tripRow()
    // The owner is BOB, and the members read does not carry ALICE. Owner
    // authority so cannot rescue this read, which is the fixture the
    // previous draft got wrong by naming the caller as owner.
    state.members = [{ trip_id: TRIP, user_id: BOB, role: 'owner', joined_at: 1 }]

    const outcome = await joinViaInvite(TRIP, ALICE, CODE)

    // B8 — a membership loss is its own outcome, not a generic failure.
    expect(outcome).toBe('not-member')
    expect(tripById(TRIP)).toBeUndefined()
    expect(insertsOf('notifications'), 'no owner notice for a refused join').toHaveLength(0)
  })

  it('a usable row from a member is admitted and reported as joined', async () => {
    state.memberRowForCaller = null
    state.joinTripId = TRIP
    state.tripRow = tripRow()
    state.members = [{ trip_id: TRIP, user_id: ALICE, role: 'editor', joined_at: 1 }]

    const outcome = await joinViaInvite(TRIP, ALICE, CODE)

    expect(outcome).toBe('joined')
    expect(tripById(TRIP)?.id).toBe(TRIP)
    expect(tripById(TRIP)?.writeVersion).toBe(1)
  })
})
