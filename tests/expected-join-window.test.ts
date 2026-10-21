// ============ #804 round 10 B2 — the own-echo window is bound to one live join
//
// The realtime echo of this client's own membership row must not invalidate the
// join. The exemption used to be a bare set of trip ids, so a retired try, or
// another account, kept the window open and the echo published a cache row and
// a ledger entry for a join nobody was tracking.
//
// These tests drive the real store through the mocked client: `joinViaInvite`
// opens the window, a realtime INSERT arrives while the read is pending, and the
// read resolves afterwards.
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const ME = '33333333-3333-4333-8333-333333333333'
const OWNER = '22222222-2222-4222-8222-222222222222'
const TRIP = '11111111-1111-4111-8111-111111111111'

const { state } = vi.hoisted(() => ({
  state: {
    // A trip-read gate the test controls: `reads` counts the reads it held,
    // `gate` is the promise every held read awaits.
    pending: null as null | { gate: Promise<void>; open: () => void; reads: number },
    memberReads: 0,
    // The membership table answers with this client's own new row once the join
    // is written, which is what the real RPC leaves behind.
    memberRows: [] as Array<Record<string, unknown>>,
    // An optional gate on the SDK's session read, so a test can retire the try
    // while that read is in flight.
    sessionGate: null as Promise<void> | null,
    sessionCalls: 0,
  },
}))

vi.mock('../src/lib/supabase', () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {}
    b.select = () => b
    b.setHeader = () => b
    b.eq = () => b
    b.maybeSingle = () => {
      if (table === 'trip_members') {
        state.memberReads += 1
        return Promise.resolve({ data: state.memberRows[0] ?? null, error: null })
      }
      if (state.pending) {
        // Every trip read waits for the gate the test opens: first the held
        // read, then the echo's own read. A read that starts after the gate
        // opened answers at once.
        state.pending.reads += 1
        return state.pending.gate.then(() => ({ data: row(), error: null }))
      }
      return Promise.resolve({ data: row(), error: null })
    }
    b.limit = () => b
    b.then = (res: (v: { data: unknown; error: unknown }) => unknown) => {
      if (table === 'trips') {
        if (state.pending) {
          state.pending.reads += 1
          return state.pending.gate.then(() => res({ data: row(), error: null }))
        }
        return Promise.resolve({ data: row(), error: null }).then(res)
      }
      return Promise.resolve({ data: state.memberRows, error: null }).then(res)
    }
    return b
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: {
        getSession: async () => {
          state.sessionCalls += 1
          if (state.sessionGate && state.sessionCalls === 1) await state.sessionGate
          return { data: { session: { access_token: 'synthetic-token', user: { id: ME } } }, error: null }
        },
      },
      from: (t: string) => builder(t),
      rpc: (name: string) => ({
        setHeader: () => ({
          then: (r: (v: { data: unknown; error: null }) => unknown) =>
            Promise.resolve({ data: name === 'join_trip' ? TRIP : null, error: null }).then(r),
        }),
      }),
    },
  }
})

import { _applyRealtimeEventForTest, getSnapshot, joinViaInvite, tripById } from '../src/store/store'

function row() {
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
  }
}

/** Hold every trip read until the test opens the gate. */
function holdTheRead() {
  let open!: () => void
  const gate = new Promise<void>(r => { open = r })
  state.pending = { gate, open, reads: 0 }
}

/** Open the gate: every held read, including the echo's own, answers now. */
function releaseTheRead() {
  state.pending?.open()
}

/** Wait until the held trip read has actually been requested. */
async function readStarted() {
  for (let i = 0; i < 50 && !state.pending?.reads; i += 1) await Promise.resolve()
  expect(state.pending?.reads, 'the trip read started').toBeGreaterThan(0)
}

function ownInsertEcho() {
  _applyRealtimeEventForTest('trip_members', {
    eventType: 'INSERT',
    new: { trip_id: TRIP, user_id: ME, role: 'editor', joined_at: 2 },
    old: {},
  } as never)
}

function freshAccount() {
  const db = getSnapshot() as unknown as { sessionUserId: string | null; trips: unknown[] }
  db.sessionUserId = ME
  db.trips = []
  state.pending = null
  state.memberReads = 0
  state.sessionCalls = 0
  state.memberRows = [{ trip_id: TRIP, user_id: ME, role: 'editor', joined_at: 2 }, { trip_id: TRIP, user_id: OWNER, role: 'owner', joined_at: 1 }]
}

describe('B2 — the own-echo exemption ends with the try that opened it', () => {
  it('a LIVE try keeps its own echo from invalidating the join', async () => {
    freshAccount()
    holdTheRead()
    let live = true
    const join = joinViaInvite(TRIP, ME, 'CODE', () => live)
    await Promise.resolve()
    ownInsertEcho()
    releaseTheRead()
    expect(await join).toBe('joined')
    expect(tripById(TRIP)?.members.some(m => m.userId === ME)).toBe(true)
  })

  it('a RETIRED try does not open the window, so the echo cannot publish a row', async () => {
    freshAccount()
    holdTheRead()
    const join = joinViaInvite(TRIP, ME, 'CODE', () => false)
    await Promise.resolve()
    state.memberReads = 0
    ownInsertEcho()
    releaseTheRead()
    expect(await join).toBe('abandoned')
    expect(tripById(TRIP)).toBeUndefined()
  })

  it('a try retired AFTER the echo started cannot publish the echo result', async () => {
    freshAccount()
    holdTheRead()
    let live = true
    const join = joinViaInvite(TRIP, ME, 'CODE', () => live)
    await Promise.resolve()
    ownInsertEcho()
    live = false
    releaseTheRead()
    expect(await join).toBe('abandoned')
    expect(tripById(TRIP), 'a retired try publishes no cache row').toBeUndefined()
  })

  it('an echo that arrives AFTER retirement starts no trip read', async () => {
    freshAccount()
    holdTheRead()
    let live = true
    const join = joinViaInvite(TRIP, ME, 'CODE', () => live)
    await readStarted()
    const readsBefore = state.pending?.reads ?? 0
    // The try is retired before its own row's echo lands.
    live = false
    ownInsertEcho()
    await Promise.resolve()
    expect(state.pending?.reads, 'the echo starts no trip read').toBe(readsBefore)
    releaseTheRead()
    expect(await join).toBe('abandoned')
    // The echo issued no read of its own, so there is no second answer to wait
    // for. The blocked-and-then-admitted case is the next one.
  })

  it('a retirement in the middle of the echo read publishes nothing', async () => {
    freshAccount()
    holdTheRead()
    let live = true
    const join = joinViaInvite(TRIP, ME, 'CODE', () => live)
    await readStarted()
    const readsBefore = state.pending?.reads ?? 0
    // The echo arrives while the try is still live, so its read starts; then the
    // try retires before that read admits anything.
    ownInsertEcho()
    for (let i = 0; i < 50 && (state.pending?.reads ?? 0) === readsBefore; i += 1) await Promise.resolve()
    expect(state.pending?.reads, 'the echo begins its own read while the window is open').toBe(readsBefore + 1)
    live = false
    releaseTheRead()
    expect(await join).toBe('abandoned')
    await new Promise(r => setTimeout(r, 0))
    expect(tripById(TRIP), 'the held echo read admits nothing after the retirement').toBeUndefined()
  })

  it('the echo window is recorded against the joining user and this generation', () => {
    // The four bindings are structural: the record names the trip, the user,
    // the identity generation and the live try, and both are read on each echo.
    const STORE = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(STORE).toContain('expectedJoins.set(tripId, expectation)')
    expect(STORE).toMatch(/const expectation: JoinExpectation = \{ tripId, userId, identityEpoch, guard:/)
    expect(STORE).toContain("const expectation = event === 'INSERT' ? expectedJoin(tripId, true) : undefined")
    expect(STORE).toContain('const ownJoinEcho = !!expectation && userId === expectation.userId && canEdit(row?.role)')
    const join = STORE.slice(STORE.indexOf('export async function joinViaInvite('), STORE.indexOf('async function joinAfterScope('))
    expect(join).toContain('if (expectedJoins.get(tripId) === expectation) expectedJoins.delete(tripId)')
  })

  it('a retirement DURING the session read dispatches no membership request', async () => {
    freshAccount()
    let open!: () => void
    state.sessionGate = new Promise<void>(r => { open = r })
    let live = true
    const join = joinViaInvite(TRIP, ME, 'CODE', () => live)
    await Promise.resolve()
    // The try retires while the SDK is still answering getSession.
    live = false
    open()
    expect(await join).toBe('abandoned')
    expect(state.memberReads, 'no membership read is issued after the retirement').toBe(0)
    state.sessionGate = null
  })

  it('an older retired try cannot close a newer try window for the same trip', async () => {
    freshAccount()
    holdTheRead()
    let openSession!: () => void
    state.sessionGate = new Promise<void>(r => { openSession = r })
    let olderLive = true
    const older = joinViaInvite(TRIP, ME, 'CODE', () => olderLive)

    // The second try passes session lookup and waits on its own full-row read.
    let newerLive = true
    const newer = joinViaInvite(TRIP, ME, 'CODE', () => newerLive)
    await readStarted()

    // Retiring the older attempt must not erase the newer attempt's expectation.
    olderLive = false
    openSession()
    expect(await older).toBe('abandoned')
    const readsBeforeEcho = state.pending?.reads
    ownInsertEcho()
    expect(state.pending?.reads, 'the newer live expectation owns the echo').toBe(readsBeforeEcho)
    releaseTheRead()

    expect(await newer).toBe('joined')
    expect(tripById(TRIP)?.members.some(m => m.userId === ME)).toBe(true)
    state.sessionGate = null
    expect(newerLive).toBe(true)
  })
})
