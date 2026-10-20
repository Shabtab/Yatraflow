// ============ #804 — the invite preview, the join gate, and the full-row load ============
//
// The invite-code RPC (migrations/20260926_paywall_invite_code_leak.sql:224)
// returns 31 of the 34 trips columns. An earlier design cached that row and
// marked it; two Gates showed the marker leaking through every consumer of the
// cache. The design now keeps the preview OUT of the cache entirely, so no
// whole-row write can be built from it.
//
// These tests EXECUTE the real decisions rather than reading source text:
//   - inviteJoinOutcome (src/lib/inviteGateStates.ts) is the exact function
//     App.tsx calls to choose navigate / stay-unloaded / stay-failed;
//   - tripToRow / rowToTrip are the real serializers.
// The store itself opens a Supabase client at module scope, so the loader's
// guard ORDER is pinned structurally and its decisions are pinned behaviourally
// through the same predicates the loader uses (isStaleServerRow, validWriteVersion).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { tripToRow, rowToTrip } from '../src/lib/tripRow'
import { inviteJoinOutcome, inviteAttempt } from '../src/lib/inviteGateStates'
import { isStaleServerRow } from '../src/lib/realtimeCore'
import { seedData } from '../src/data/seed'
import type { Trip } from '../src/data/types'

const STORE = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const APP = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const TYPES = readFileSync(new URL('../src/data/types.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** The body of one store function, by brace matching. */
function fnBody(source: string, signature: string): string {
  const start = source.indexOf(signature)
  expect(start, `${signature} must exist`).toBeGreaterThan(-1)
  let depth = 0
  let i = source.indexOf('{', start)
  const from = i
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(from, i + 1)
    }
  }
  throw new Error(`unbalanced braces after ${signature}`)
}

const ALL_COLUMNS = {
  economy: true, price: true, roundTrip: true, cover: true,
  inviteCode: true, deleted: true, stayStyle: true,
  driverCount: true, hasVulnerable: true, driveAfterDinner: true, vehicleProfile: true,
  tankL: true, rentPerDayInr: true, localTrain: true, flights: true, ref: true,
} as const

function fullTrip(tank = 55): Trip {
  return {
    ...structuredClone(seedData.trips[0]) as Trip,
    tankL: tank, rentPerDayInr: 2400, localTrain: true, ref: 'copy',
    flights: [{ id: 'f1', dayIndex: 0, fromAirport: 'DEL', toAirport: 'SXR' }] as Trip['flights'],
  }
}

// ============ B1 — the gate must not navigate on a failed or unloaded join ====

describe('B1 — inviteJoinOutcome decides the three join states', () => {
  it('joined AND loaded navigates, and offers no retry', () => {
    expect(inviteJoinOutcome('joined')).toEqual({ outcome: 'navigate', retry: 'none' })
  })

  it('joined but unloaded stays, and its retry is a READ, never a re-join', () => {
    // A re-join would write a second membership row and notify the owner twice.
    expect(inviteJoinOutcome('joined-unloaded')).toEqual({ outcome: 'unloaded', retry: 'reload' })
  })

  it('a failed join stays, and its retry re-attempts the join', () => {
    expect(inviteJoinOutcome('failed')).toEqual({ outcome: 'failed', retry: 'rejoin' })
  })

  it('the three outcomes are distinct: no state is shown as another', () => {
    const all = (['joined', 'joined-unloaded', 'failed'] as const).map(r => inviteJoinOutcome(r).outcome)
    expect(new Set(all).size).toBe(3)
    // 'joined-unloaded' must never map to navigate — that was the B1 defect.
    expect(inviteJoinOutcome('joined-unloaded').outcome).not.toBe('navigate')
    expect(inviteJoinOutcome('failed').outcome).not.toBe('navigate')
  })

  it('App runs that exact function, and navigates only on navigate', () => {
    const gate = APP.slice(APP.indexOf('const result = await joinViaInvite'), APP.indexOf('})()', APP.indexOf('const result = await joinViaInvite')))
    expect(gate).toContain('inviteJoinOutcome(result)')
    // navigateRef appears exactly once, inside the navigate branch.
    const navCount = (gate.match(/navigateRef\.current/g) ?? []).length
    expect(navCount, 'exactly one navigation, in the navigate branch').toBe(1)
    const navAt = gate.indexOf('navigateRef.current')
    const navBranch = gate.indexOf("outcome === 'navigate'")
    expect(navBranch).toBeGreaterThan(-1)
    expect(navAt, 'navigation sits inside the navigate branch').toBeGreaterThan(navBranch)
  })

  it('the unloaded retry calls reloadJoinedTrip, not joinViaInvite', () => {
    // The retry for a joined-but-unloaded trip must re-read only.
    const unloaded = APP.slice(APP.indexOf("status === 'joined-unloaded'"), APP.indexOf("status === 'join-failed'"))
    expect(unloaded).toContain('reloadJoinedTrip(')
    expect(unloaded).not.toContain('joinViaInvite(')
  })

  it('the failed retry re-attempts the join', () => {
    const start = APP.indexOf("status === 'join-failed'")
    expect(start).toBeGreaterThan(-1)
    const failed = APP.slice(start, start + 1200)
    expect(failed).toMatch(/setStatus\('loading'\)/)
    expect(failed).toMatch(/setRetryTick/)
  })
})

// ============ B2 — a delayed full read must not undo a newer state ============

describe('B2 — the loader refuses stale, unverifiable and pending rows', () => {
  const body = fnBody(STORE, 'async function loadFullTripIntoCache(')

  it('refuses a row older than the server-timestamp ledger', () => {
    // The same guard the realtime path uses, so the ledger never moves backwards.
    expect(body).toContain('isStaleServerRow(serverTripTimestamps.get(tripId)')
    // Behavioural half: the predicate itself.
    expect(isStaleServerRow(2_000, 1_000)).toBe(true)
    expect(isStaleServerRow(1_000, 2_000)).toBe(false)
    expect(isStaleServerRow(undefined, 1_000)).toBe(false)
  })

  it('refuses an unverifiable revision rather than trusting it', () => {
    expect(body).toMatch(/if \(!validWriteVersion\(incoming\)\) return 'stale'/)
  })

  it('refuses a revision older than the cached one', () => {
    expect(body).toMatch(/incoming < cached\) return 'stale'/)
  })

  it('keeps the local row when a queued write owns the trip', () => {
    expect(body).toMatch(/queuedLocalTrips\.has\(tripId\)\) return 'stale'/)
  })

  it('never records the ledger before the guards have passed', () => {
    const recordAt = body.indexOf('recordServerTripTimestamp')
    const staleAt = body.indexOf("return 'stale'")
    expect(staleAt).toBeGreaterThan(-1)
    expect(recordAt, 'the ledger write must come after the last refusal').toBeGreaterThan(staleAt)
  })

  it('a refusal leaves the cached row untouched', () => {
    // Every 'stale' return must precede the only cache.trips assignment.
    const assignAt = body.indexOf('cache.trips =')
    for (const m of body.matchAll(/return 'stale'/g)) {
      expect(m.index!).toBeLessThan(assignAt)
    }
  })
})

describe('S2 — an empty membership read is not proof of access', () => {
  const body = fnBody(STORE, 'async function loadFullTripIntoCache(')

  it('requires the caller own membership, or admin, before caching', () => {
    expect(body).toContain('members.some(m => m.userId === scope.userId) && !isAdminCached()')
    expect(body).toMatch(/return 'not-member'/)
  })

  it('a not-member refusal is distinct from a read error', () => {
    expect(body).toMatch(/return 'failed'/)
    expect(body).toMatch(/return 'not-member'/)
    const notMember = body.indexOf("return 'not-member'")
    const assignAt = body.indexOf('cache.trips =')
    expect(notMember).toBeLessThan(assignAt)
  })
})

// ============ B1/B2b — the join reducer, executed ============
// The Gate's S1: string checks passed while the retry was broken. These run the
// real reducer that App.tsx calls, so a broken transition fails here.

describe('B1/B2b — inviteAttempt binds every retry to one account', () => {
  const A = 'user-a'
  const B = 'user-b'

  it('a failed join retries into a SECOND join for the same account', () => {
    // This is the B1 defect: the old guard stayed set, so no second join issued.
    let plan = inviteAttempt(null, { type: 'begin', userId: A })
    expect(plan.action).toBe('join')
    expect(plan.state.issued).toBe(1)
    plan = inviteAttempt(plan.state, { type: 'settle', userId: A, result: 'failed' })
    expect(plan.state.settled).toBe('failed')
    // Retry: the settled result clears and the join is issued again.
    plan = inviteAttempt(plan.state, { type: 'retry-failed', userId: A })
    expect(plan.action).toBe('join')
    expect(plan.state.settled).toBeNull()
    expect(plan.state.issued).toBe(2)
    // And the effect's own begin now runs it, because settled is null.
    expect(inviteAttempt(plan.state, { type: 'begin', userId: A }).action).toBe('none')
  })

  it('an unloaded retry re-reads the row and never joins again', () => {
    let plan = inviteAttempt(null, { type: 'begin', userId: A })
    plan = inviteAttempt(plan.state, { type: 'settle', userId: A, result: 'joined-unloaded' })
    const retry = inviteAttempt(plan.state, { type: 'retry-unloaded', userId: A })
    expect(retry.action).toBe('reload')
    expect(retry.state.issued, 'a reload must not count as a join').toBe(1)
  })

  it('StrictMode double fire issues exactly one join', () => {
    const first = inviteAttempt(null, { type: 'begin', userId: A })
    const second = inviteAttempt(first.state, { type: 'begin', userId: A })
    expect(first.action).toBe('join')
    expect(second.action, 'the second fire does nothing').toBe('none')
    expect(second.state.issued).toBe(1)
  })

  it('an account switch resets the attempt instead of inheriting it', () => {
    // B2b: B must not adopt A's try, its claim, or its outcome.
    let plan = inviteAttempt(null, { type: 'begin', userId: A })
    plan = inviteAttempt(plan.state, { type: 'settle', userId: A, result: 'failed' })
    const switched = inviteAttempt(plan.state, { type: 'begin', userId: B })
    expect(switched.state.userId).toBe(B)
    expect(switched.state.settled).toBeNull()
    expect(switched.action, 'B gets its own join').toBe('join')
    expect(switched.state.issued).toBe(1)
  })

  it('a late continuation from the previous account settles nothing', () => {
    let plan = inviteAttempt(null, { type: 'begin', userId: B })
    const before = plan.state
    // A's join answers after B took over.
    const stale = inviteAttempt(before, { type: 'settle', userId: A, result: 'joined' })
    expect(stale.state).toEqual(before)
    expect(stale.action).toBe('none')
  })

  it('an abandoned result maps to no navigation and no retry', () => {
    expect(inviteJoinOutcome('abandoned')).toEqual({ outcome: 'abandoned', retry: 'none' })
  })

  it('App dispatches the reducer for both retries and for the initial begin', () => {
    // The branch the tests execute is the branch the app runs.
    expect(APP).toContain("dispatchAttempt({ type: 'retry-failed', userId: me.id })")
    expect(APP).toContain("dispatchAttempt({ type: 'retry-unloaded', userId: me.id })")
    expect(APP).toContain("dispatchAttempt({ type: 'begin', userId: me.id })")
    // The old bare guard must be gone.
    expect(APP).not.toContain('joinedRef')
  })
})

// ============ the preview never enters the writable cache ============

describe('the preview stays out of the cache', () => {
  const body = fnBody(STORE, 'export async function fetchTripByInviteCode(')

  it('does not assign to cache.trips, commit, queue or snapshot', () => {
    expect(body).not.toMatch(/cache\.trips\s*=/)
    for (const forbidden of ['commit(', 'queueWrite(', 'persistTripField', 'queuedLocalTrips.set']) {
      expect(body, `must not call ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('returns the row directly', () => {
    expect(body).toMatch(/return rowToTrip\(rows\[0\], \[\]\)/)
  })

  it('the marker machinery is gone', () => {
    for (const gone of ['partialPreview', 'partialEdited', 'PARTIAL_FIELDS', 'recordPartialEdits', 'refreshTripFromServer']) {
      expect(STORE).not.toContain(gone)
      expect(TYPES).not.toContain(gone)
    }
  })
})

describe('a full row carries all five columns through the real serializers', () => {
  it('tripToRow emits them and rowToTrip reads them back', () => {
    const full = fullTrip(55)
    const row = tripToRow(full, 'owner-1', ALL_COLUMNS) as unknown as Record<string, unknown>
    expect(row.tank_l).toBe(55)
    expect(row.rent_per_day_inr).toBe(2400)
    expect(row.local_train).toBe(true)
    expect(row.ref).toBe('copy')
    expect(row.flights).toEqual(full.flights)
    // Round trip: nothing is lost on the way back.
    const back = rowToTrip({ ...row, created_at: 1, updated_at: 1 } as never, [])
    expect(back.tankL).toBe(55)
    expect(back.rentPerDayInr).toBe(2400)
    expect(back.localTrain).toBe(true)
    expect(back.ref).toBe('copy')
  })
})
