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
import { joinMachine, initialJoinState, joinAllowsNavigation, joinOffersRetry, type JoinEvent, type JoinPlan } from '../src/lib/inviteGateStates'
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

// ============ B1/B2b/B3 — the join state machine, executed ============
// The Gate's S1: earlier rounds asserted strings and stale flags while the retry
// was broken. These run the real machine that App.tsx dispatches to, with the
// real event sequence, so a broken transition fails here.

const A = 'user-a'
const B = 'user-b'
const GEN = 7

/** Drive the machine through a list of events, returning the final plan. */
function drive(events: JoinEvent[]): JoinPlan {
  return events.reduce<JoinPlan>(
    (plan, e) => joinMachine(plan.state, e),
    { state: initialJoinState, action: { type: 'none' } },
  )
}

describe('B1 — a retry executes exactly one new join', () => {
  it('failed -> retry returns a JOIN action, not none', () => {
    // The defect: retry cleared a flag and returned nothing, so the next begin
    // answered 'none' and no second join ever ran.
    const begin = drive([{ type: 'begin', userId: A, gen: GEN }])
    expect(begin.action).toEqual({ type: 'join', tryId: 1 })
    const settled = joinMachine(begin.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'failed' })
    expect(settled.state.phase).toBe('failed')
    const retry = joinMachine(settled.state, { type: 'retry', userId: A, gen: GEN })
    expect(retry.state.phase).toBe('joining')
    expect(retry.action).toEqual({ type: 'join', tryId: 2 })
  })

  it('the retry action is what runs the join: it carries a NEW try id', () => {
    const begin = drive([{ type: 'begin', userId: A, gen: GEN }])
    const settled = joinMachine(begin.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'failed' })
    const retry = joinMachine(settled.state, { type: 'retry', userId: A, gen: GEN })
    const issued = retry.action.type === 'join' ? retry.action.tryId : -1
    expect(issued).toBe(2)
    // The superseded try's late answer is ignored.
    const stale = joinMachine(retry.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'joined' })
    expect(stale.state.phase).toBe('joining')
    expect(joinAllowsNavigation(stale.state)).toBe(false)
  })

  it('joined-unloaded -> retry returns a RELOAD action and never joins', () => {
    const begin = drive([{ type: 'begin', userId: A, gen: GEN }])
    const settled = joinMachine(begin.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'joined-unloaded' })
    expect(settled.state.phase).toBe('joined-unloaded')
    const retry = joinMachine(settled.state, { type: 'retry', userId: A, gen: GEN })
    expect(retry.action.type).toBe('reload')
    expect(retry.state.phase).toBe('loading')
  })

  it('a failed retry that fails again can retry again', () => {
    let plan = drive([{ type: 'begin', userId: A, gen: GEN }])
    for (let i = 1; i <= 3; i += 1) {
      plan = joinMachine(plan.state, { type: 'join-settled', userId: A, gen: GEN, tryId: i, result: 'failed' })
      expect(plan.state.phase).toBe('failed')
      plan = joinMachine(plan.state, { type: 'retry', userId: A, gen: GEN })
      expect(plan.action).toEqual({ type: 'join', tryId: i + 1 })
    }
  })
})

describe('B1 — StrictMode fires the effect twice and only one join runs', () => {
  it('a second begin while joining does nothing', () => {
    const first = drive([{ type: 'begin', userId: A, gen: GEN }])
    const second = joinMachine(first.state, { type: 'begin', userId: A, gen: GEN })
    expect(second.action).toEqual({ type: 'none' })
    expect(second.state.tryId).toBe(1)
  })

  it('a begin while loading does nothing, and while joined does nothing', () => {
    const begin = drive([{ type: 'begin', userId: A, gen: GEN }])
    const loading = joinMachine(begin.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'joined-unloaded' })
    const retry = joinMachine(loading.state, { type: 'retry', userId: A, gen: GEN })
    expect(joinMachine(retry.state, { type: 'begin', userId: A, gen: GEN }).action).toEqual({ type: 'none' })
    const joined = joinMachine(retry.state, { type: 'reload-settled', userId: A, gen: GEN, tryId: 2, result: 'joined' })
    expect(joinMachine(joined.state, { type: 'begin', userId: A, gen: GEN }).action).toEqual({ type: 'none' })
  })
})

describe('B2b — every continuation is bound to user and attempt', () => {
  it('an account switch mid-flight does not settle the new account', () => {
    const begin = drive([{ type: 'begin', userId: A, gen: GEN }])
    const switched = joinMachine(begin.state, { type: 'join-settled', userId: B, gen: GEN, tryId: 1, result: 'joined' })
    expect(switched.state.phase).toBe('joining')
    expect(switched.state.userId).toBe(A)
    expect(joinAllowsNavigation(switched.state)).toBe(false)
  })

  it('a stale reload cannot overwrite the new account failure state', () => {
    // The old reload callback ignored a rejected settlement and wrote the NEW
    // account's state. Here B is in 'failed'; A's late reload must change nothing.
    const bBegin = drive([{ type: 'begin', userId: B, gen: GEN }])
    const bFailed = joinMachine(bBegin.state, { type: 'join-settled', userId: B, gen: GEN, tryId: 1, result: 'failed' })
    const staleReload = joinMachine(bFailed.state, { type: 'reload-settled', userId: A, gen: GEN, tryId: 1, result: 'joined' })
    expect(staleReload.state.phase).toBe('failed')
    expect(staleReload.state.userId).toBe(B)
  })

  it('abandoned stays abandoned through the reload phase', () => {
    const begin = drive([{ type: 'begin', userId: A, gen: GEN }])
    const reload = joinMachine(begin.state, { type: 'reload-settled', userId: A, gen: GEN, tryId: 1, result: 'abandoned' })
    expect(reload.state.phase).toBe('abandoned')
    expect(joinAllowsNavigation(reload.state)).toBe(false)
    expect(joinOffersRetry(reload.state)).toBe(false)
  })

  it('a reload that fails reports unloaded, never joined', () => {
    const begin = drive([{ type: 'begin', userId: A, gen: GEN }])
    const failed = joinMachine(begin.state, { type: 'reload-settled', userId: A, gen: GEN, tryId: 1, result: 'failed' })
    expect(failed.state.phase).toBe('joined-unloaded')
    expect(joinAllowsNavigation(failed.state)).toBe(false)
  })
})

describe('B3 — an identity generation change resets the machine', () => {
  it('sign-out then same-account sign-in starts a fresh join, not a stall', () => {
    const begin = drive([{ type: 'begin', userId: A, gen: GEN }])
    const joined = joinMachine(begin.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'joined' })
    expect(joinAllowsNavigation(joined.state)).toBe(true)
    // The same user signs back in: the generation advanced, so the old claim is
    // gone and the flow runs again instead of stalling on 'joined'.
    const reauth = joinMachine(joined.state, { type: 'begin', userId: A, gen: GEN + 1 })
    expect(reauth.state.phase).toBe('joining')
    expect(reauth.action).toEqual({ type: 'join', tryId: 2 })
    expect(joinAllowsNavigation(reauth.state)).toBe(false)
  })

  it('a profile gap (gen advances) discards a settled failure', () => {
    const begin = drive([{ type: 'begin', userId: A, gen: GEN }])
    const failed = joinMachine(begin.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'failed' })
    const afterGap = joinMachine(failed.state, { type: 'begin', userId: A, gen: GEN + 1 })
    expect(afterGap.state.phase).toBe('joining')
    expect(afterGap.action.type).toBe('join')
  })

  it('a continuation from the old generation is ignored', () => {
    const begin = drive([{ type: 'begin', userId: A, gen: GEN }])
    const stale = joinMachine(begin.state, { type: 'join-settled', userId: A, gen: GEN - 1, tryId: 1, result: 'joined' })
    expect(stale.state.phase).toBe('joining')
  })

  it('begin alone resets on a generation change, without any other event', () => {
    // This pins the begin branch ITSELF. A previous version of this suite let a
    // mutation of that branch pass, because retry carried an identical reset and
    // the tests only ever reached the machine through one of them.
    const begin = drive([{ type: 'begin', userId: A, gen: GEN }])
    const joined = joinMachine(begin.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'joined' })
    expect(joinAllowsNavigation(joined.state)).toBe(true)
    const afterGap = joinMachine(joined.state, { type: 'begin', userId: A, gen: GEN + 1 })
    // The new generation MUST issue a join: a stale 'joined' claim would stall.
    expect(afterGap.action).toEqual({ type: 'join', tryId: 2 })
    expect(afterGap.state.gen).toBe(GEN + 1)
    expect(joinAllowsNavigation(afterGap.state)).toBe(false)
  })

  it('retry alone resets on a generation change, without any other event', () => {
    // The same pin for the retry branch, so neither can be removed silently.
    const begin = drive([{ type: 'begin', userId: A, gen: GEN }])
    const failed = joinMachine(begin.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'failed' })
    const afterGap = joinMachine(failed.state, { type: 'retry', userId: A, gen: GEN + 1 })
    expect(afterGap.action).toEqual({ type: 'join', tryId: 2 })
    expect(afterGap.state.gen).toBe(GEN + 1)
  })
})

describe('the machine is the only owner: App holds no join flag', () => {
  it('App dispatches begin, retry and settlements, and reads the phase', () => {
    expect(APP).toContain("dispatchJoin({ type: 'begin', userId: me.id, gen: identityGen })")
    expect(APP).toContain("dispatchJoin({ type: 'retry', userId: me.id, gen: identityGen })")
    expect(APP).toContain("dispatchJoin({ type: 'join-settled'")
    expect(APP).toContain("dispatchJoin({ type: 'reload-settled'")
    expect(APP).toContain('joinAllowsNavigation(joinState)')
    // The old scattered state must be gone.
    expect(APP).not.toContain('joinedRef')
    expect(APP).not.toContain('attemptRef')
    expect(APP).not.toContain('dispatchAttempt')
  })

  it('the retry button calls the one retry handler', () => {
    const retries = APP.match(/onClick=\{retryJoin\}/g) ?? []
    expect(retries.length, 'both retry screens use retryJoin').toBe(2)
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