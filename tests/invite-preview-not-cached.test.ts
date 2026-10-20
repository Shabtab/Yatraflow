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
import { readFileSync, readdirSync } from 'node:fs'
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
    const begin = drive([{ type: 'begin', userId: A, gen: GEN, member: false }])
    expect(begin.action).toEqual({ type: 'join', tryId: 1 })
    const settled = joinMachine(begin.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'failed' })
    expect(settled.state.phase).toBe('failed')
    const retry = joinMachine(settled.state, { type: 'retry', userId: A, gen: GEN, member: false })
    expect(retry.state.phase).toBe('joining')
    expect(retry.action).toEqual({ type: 'join', tryId: 2 })
  })

  it('the retry action is what runs the join: it carries a NEW try id', () => {
    const begin = drive([{ type: 'begin', userId: A, gen: GEN, member: false }])
    const settled = joinMachine(begin.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'failed' })
    const retry = joinMachine(settled.state, { type: 'retry', userId: A, gen: GEN, member: false })
    const issued = retry.action.type === 'join' ? retry.action.tryId : -1
    expect(issued).toBe(2)
    // The superseded try's late answer is ignored.
    const stale = joinMachine(retry.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'joined' })
    expect(stale.state.phase).toBe('joining')
    expect(joinAllowsNavigation(stale.state)).toBe(false)
  })

  it('joined-unloaded -> retry returns a RELOAD action and never joins', () => {
    const begin = drive([{ type: 'begin', userId: A, gen: GEN, member: false }])
    const settled = joinMachine(begin.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'joined-unloaded' })
    expect(settled.state.phase).toBe('joined-unloaded')
    const retry = joinMachine(settled.state, { type: 'retry', userId: A, gen: GEN, member: false })
    expect(retry.action.type).toBe('reload')
    expect(retry.state.phase).toBe('loading')
  })

  it('a failed retry that fails again can retry again', () => {
    let plan = drive([{ type: 'begin', userId: A, gen: GEN, member: false }])
    for (let i = 1; i <= 3; i += 1) {
      plan = joinMachine(plan.state, { type: 'join-settled', userId: A, gen: GEN, tryId: i, result: 'failed' })
      expect(plan.state.phase).toBe('failed')
      plan = joinMachine(plan.state, { type: 'retry', userId: A, gen: GEN, member: false })
      expect(plan.action).toEqual({ type: 'join', tryId: i + 1 })
    }
  })
})

describe('B1 — StrictMode fires the effect twice and only one join runs', () => {
  it('a second begin while joining does nothing', () => {
    const first = drive([{ type: 'begin', userId: A, gen: GEN, member: false }])
    const second = joinMachine(first.state, { type: 'begin', userId: A, gen: GEN, member: false })
    expect(second.action).toEqual({ type: 'none' })
    expect(second.state.tryId).toBe(1)
  })

  it('a begin while loading does nothing, and while joined does nothing', () => {
    const begin = drive([{ type: 'begin', userId: A, gen: GEN, member: false }])
    const loading = joinMachine(begin.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'joined-unloaded' })
    const retry = joinMachine(loading.state, { type: 'retry', userId: A, gen: GEN, member: false })
    expect(joinMachine(retry.state, { type: 'begin', userId: A, gen: GEN, member: false }).action).toEqual({ type: 'none' })
    const joined = joinMachine(retry.state, { type: 'reload-settled', userId: A, gen: GEN, tryId: 2, result: 'joined' })
    expect(joinMachine(joined.state, { type: 'begin', userId: A, gen: GEN, member: false }).action).toEqual({ type: 'none' })
  })
})

describe('B2b — every continuation is bound to user and attempt', () => {
  it('an account switch mid-flight does not settle the new account', () => {
    const begin = drive([{ type: 'begin', userId: A, gen: GEN, member: false }])
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

  it('abandoned stays abandoned through the reload phase, and offers a retry', () => {
    const begin = drive([{ type: 'begin', userId: A, gen: GEN, member: false }])
    const reload = joinMachine(begin.state, { type: 'reload-settled', userId: A, gen: GEN, tryId: 1, result: 'abandoned' })
    expect(reload.state.phase).toBe('abandoned')
    expect(joinAllowsNavigation(reload.state)).toBe(false)
    // B-3 — abandoned is a dead end without a retry, so it must offer one.
    expect(joinOffersRetry(reload.state)).toBe(true)
  })

  it('a reload that fails reports unloaded, never joined', () => {
    const begin = drive([{ type: 'begin', userId: A, gen: GEN, member: false }])
    const failed = joinMachine(begin.state, { type: 'reload-settled', userId: A, gen: GEN, tryId: 1, result: 'failed' })
    expect(failed.state.phase).toBe('joined-unloaded')
    expect(joinAllowsNavigation(failed.state)).toBe(false)
  })
})

describe('B3 — an identity generation change resets the machine', () => {
  it('sign-out then same-account sign-in starts a fresh join, not a stall', () => {
    const begin = drive([{ type: 'begin', userId: A, gen: GEN, member: false }])
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
    const begin = drive([{ type: 'begin', userId: A, gen: GEN, member: false }])
    const failed = joinMachine(begin.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'failed' })
    const afterGap = joinMachine(failed.state, { type: 'begin', userId: A, gen: GEN + 1 })
    expect(afterGap.state.phase).toBe('joining')
    expect(afterGap.action.type).toBe('join')
  })

  it('a continuation from the old generation is ignored', () => {
    const begin = drive([{ type: 'begin', userId: A, gen: GEN, member: false }])
    const stale = joinMachine(begin.state, { type: 'join-settled', userId: A, gen: GEN - 1, tryId: 1, result: 'joined' })
    expect(stale.state.phase).toBe('joining')
  })

  it('begin alone resets on a generation change, without any other event', () => {
    // This pins the begin branch ITSELF. A previous version of this suite let a
    // mutation of that branch pass, because retry carried an identical reset and
    // the tests only ever reached the machine through one of them.
    const begin = drive([{ type: 'begin', userId: A, gen: GEN, member: false }])
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
    const begin = drive([{ type: 'begin', userId: A, gen: GEN, member: false }])
    const failed = joinMachine(begin.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'failed' })
    const afterGap = joinMachine(failed.state, { type: 'retry', userId: A, gen: GEN + 1 })
    expect(afterGap.action).toEqual({ type: 'join', tryId: 2 })
    expect(afterGap.state.gen).toBe(GEN + 1)
  })
})

describe('B-1 — a member who re-clicks the link loads instead of hanging', () => {
  it('begin with member=true returns a RELOAD action from the same event', () => {
    // The defect: begin moved the machine to 'joining', App then dispatched a
    // second event to correct it, and that event answered 'none' because the
    // machine was already joining. A member sat on "Joining…" forever.
    const plan = joinMachine(initialJoinState, { type: 'begin', userId: A, gen: GEN, member: true })
    expect(plan.action).toEqual({ type: 'reload', tryId: 1 })
    expect(plan.state.phase).toBe('loading')
  })

  it('CHAINS begin -> reload-settled -> joined, which is what navigation needs', () => {
    // The Gate asked for a chain, not machine events in isolation: this is the
    // whole member path end to end.
    const began = joinMachine(initialJoinState, { type: 'begin', userId: A, gen: GEN, member: true })
    const tryId = began.action.type === 'reload' ? began.action.tryId : -1
    const settled = joinMachine(began.state, { type: 'reload-settled', userId: A, gen: GEN, tryId, result: 'joined' })
    expect(settled.state.phase).toBe('joined')
    expect(joinAllowsNavigation(settled.state), 'a member must reach navigation').toBe(true)
  })

  it('a member NEVER issues a join RPC on begin', () => {
    const plan = joinMachine(initialJoinState, { type: 'begin', userId: A, gen: GEN, member: true })
    expect(plan.action.type).not.toBe('join')
  })

  it('a non-member begin still issues a join', () => {
    const plan = joinMachine(initialJoinState, { type: 'begin', userId: A, gen: GEN, member: false })
    expect(plan.action).toEqual({ type: 'join', tryId: 1 })
  })

  it('the App effect passes membership into begin, and does not dispatch twice', () => {
    const effect = APP.slice(APP.indexOf("if (isTripIdLink) return"), APP.indexOf('}, [me, trip, identityGen'))
    expect(effect).toContain("type: 'begin'")
    expect(effect).toContain('member')
    // No second correction event: that is what hung the member.
    const dispatches = (effect.match(/dispatchJoin\(/g) ?? []).length
    expect(dispatches, 'one dispatch per effect run').toBe(1)
  })
})

describe('B-2 — a legacy trip-id link never joins', () => {
  it('the effect returns before any join when the link is a trip id', () => {
    const start = APP.indexOf('if (isTripIdLink) return')
    const effect = APP.slice(start, APP.indexOf('const retryJoin'))
    const guardAt = effect.indexOf('if (isTripIdLink) return')
    const joinAt = effect.indexOf('runJoinAction')
    expect(guardAt, 'the trip-id guard must exist').toBeGreaterThan(-1)
    expect(joinAt).toBeGreaterThan(-1)
    expect(guardAt, 'the guard must come BEFORE the join runs').toBeLessThan(joinAt)
  })

  it('the trip-id branch is handled by its own membership check', () => {
    // viewerIsMemberOf is the separate effect that opens or refuses a UUID link.
    expect(APP).toContain('viewerIsMemberOf(trip.id, me.id)')
    expect(APP).toContain('This link no longer adds people')
  })
})

describe('item 5 — failed and abandoned wait for the user, not an effect re-run', () => {
  it('begin does NOT restart a failed join', () => {
    const began = joinMachine(initialJoinState, { type: 'begin', userId: A, gen: GEN, member: false })
    const failed = joinMachine(began.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'failed' })
    expect(failed.state.phase).toBe('failed')
    // A hydrate changes me/trip identity, the effect re-runs, begin fires again.
    const rerun = joinMachine(failed.state, { type: 'begin', userId: A, gen: GEN, member: false })
    expect(rerun.action).toEqual({ type: 'none' })
    expect(rerun.state.phase).toBe('failed')
  })

  it('begin does NOT restart an abandoned join', () => {
    const began = joinMachine(initialJoinState, { type: 'begin', userId: A, gen: GEN, member: false })
    const abandoned = joinMachine(began.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'abandoned' })
    const rerun = joinMachine(abandoned.state, { type: 'begin', userId: A, gen: GEN, member: false })
    expect(rerun.action).toEqual({ type: 'none' })
    expect(rerun.state.phase).toBe('abandoned')
  })

  it('but retry DOES restart them', () => {
    const began = joinMachine(initialJoinState, { type: 'begin', userId: A, gen: GEN, member: false })
    for (const result of ['failed', 'abandoned'] as const) {
      const settled = joinMachine(began.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result })
      const retried = joinMachine(settled.state, { type: 'retry', userId: A, gen: GEN, member: false })
      expect(retried.action, `retry must act on ${result}`).toEqual({ type: 'join', tryId: 2 })
    }
  })
})

describe('B-3 — abandoned has a screen with a way out', () => {
  it('the machine marks abandoned as neither navigable nor retryable by itself', () => {
    const began = joinMachine(initialJoinState, { type: 'begin', userId: A, gen: GEN, member: false })
    const abandoned = joinMachine(began.state, { type: 'join-settled', userId: A, gen: GEN, tryId: 1, result: 'abandoned' })
    expect(joinAllowsNavigation(abandoned.state)).toBe(false)
    expect(joinOffersRetry(abandoned.state)).toBe(true)
  })

  it('App renders an abandoned branch with honest copy and a retry', () => {
    const start = APP.indexOf("if (phase === 'abandoned')")
    const block = APP.slice(start, start + 1400)
    expect(block).toContain('couldn’t confirm the join')
    expect(block).toContain('onClick={retryJoin}')
    expect(block).toContain('Go to My trips')
  })
})

describe('the machine is the only owner: App holds no join flag', () => {
  it('App dispatches begin, retry and settlements, and reads the phase', () => {
    expect(APP).toContain("type: 'begin'")
    expect(APP).toContain("type: 'retry'")
    expect(APP).toContain("type: 'join-settled'")
    expect(APP).toContain("type: 'reload-settled'")
    expect(APP).toContain('joinAllowsNavigation(joinState)')
    expect(APP).not.toContain('joinedRef')
    expect(APP).not.toContain('attemptRef')
    expect(APP).not.toContain('dispatchAttempt')
  })

  it('every retry screen uses the one retry handler', () => {
    const retries = APP.match(/onClick=\{retryJoin\}/g) ?? []
    expect(retries.length, 'unloaded, failed and abandoned all use retryJoin').toBe(3)
  })
})
// ============ item 6 — the refusals and the notification bound ============

describe('loadFullTripIntoCache refuses what it cannot trust', () => {
  const body = fnBody(STORE, 'async function loadFullTripIntoCache(')

  it('refuses a stale ledger timestamp', () => {
    expect(body).toContain('isStaleServerRow(serverTripTimestamps.get(tripId)')
    expect(isStaleServerRow(2_000, 1_000)).toBe(true)
  })

  it('refuses an unverifiable revision that would replace a known one', () => {
    expect(body).toMatch(/if \(!validWriteVersion\(incoming\)\) return 'stale'/)
  })

  it('refuses an older revision', () => {
    expect(body).toMatch(/incoming < cached\) return 'stale'/)
  })

  it('refuses a caller with no membership', () => {
    expect(body).toContain('members.some(m => m.userId === scope.userId) && !isAdminCached()')
    expect(body).toMatch(/return 'not-member'/)
  })

  it('refuses a row for a trip with a queued write', () => {
    expect(body).toMatch(/queuedLocalTrips\.has\(tripId\)\) return 'stale'/)
  })

  it('records the ledger only after every refusal has passed', () => {
    const recordAt = body.indexOf('recordServerTripTimestamp')
    const lastStale = body.lastIndexOf("return 'stale'")
    expect(recordAt).toBeGreaterThan(lastStale)
  })

  it('carries abandoned through finishJoin instead of claiming membership', () => {
    const finish = fnBody(STORE, 'async function finishJoin(')
    expect(finish).toMatch(/if \(loaded === 'abandoned'\) return 'abandoned'/)
    expect(finish.indexOf("return 'abandoned'")).toBeLessThan(finish.indexOf("return 'joined-unloaded'"))
  })
})

describe('B-4 — the owner notification is owed by an actual join and settled once', () => {
  it('records the debt where the membership is written', () => {
    const join = fnBody(STORE, 'export async function joinViaInvite(')
    expect(join).toContain('markJoinOwed(tripId, userId)')
    // The debt is recorded BEFORE the load call, so a failed load still owes it.
    const owedAt = join.indexOf('markJoinOwed(tripId, userId)')
    const loadAt = join.lastIndexOf('return await finishJoin')
    expect(owedAt).toBeGreaterThan(-1)
    expect(loadAt).toBeGreaterThan(-1)
    expect(owedAt, 'the debt is recorded before the load runs').toBeLessThan(loadAt)
  })

  it('a reload does NOT record a debt, so a member announces nobody', () => {
    const reload = fnBody(STORE, 'export async function reloadJoinedTrip(')
    expect(reload).not.toContain('markJoinOwed')
  })

  it('finishJoin settles the debt and sends at most once', () => {
    const finish = fnBody(STORE, 'async function finishJoin(')
    expect(finish).toContain('owedJoins.has(key)')
    expect(finish).toContain('notifiedJoins.has(key)')
    expect(finish).toContain('notifiedJoins.add(key)')
  })

  it('the dedupe set is bounded', () => {
    const finish = fnBody(STORE, 'async function finishJoin(')
    expect(finish).toMatch(/notifiedJoins\.size > 500/)
    expect(finish).toContain('notifiedJoins.clear()')
  })
})

describe('B-3 — our own membership echo must not invalidate our own join', () => {
  it('the realtime epoch bump skips a trip this client is joining', () => {
    const at = STORE.indexOf("case 'trip_members': {")
    expect(at).toBeGreaterThan(-1)
    const block = STORE.slice(at, at + 1600)
    expect(block).toContain('ownJoinEcho')
    expect(block).toContain('joiningTrips.has(tripId)')
    // The echo exemption must guard the epoch bump itself.
    const echoAt = block.indexOf('ownJoinEcho')
    const bumpAt = block.indexOf('tripAccessEpochs.set(tripId')
    expect(bumpAt).toBeGreaterThan(echoAt)
  })

  it('joinViaInvite marks the window before any further await', () => {
    const join = fnBody(STORE, 'export async function joinViaInvite(')
    const markAt = join.indexOf('joiningTrips.add(tripId)')
    expect(markAt).toBeGreaterThan(-1)
    expect(join).toContain('joiningTrips.delete(tripId)')
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
// ============ B-2 — what a non-member can reach, and what they cannot ============
// The Gate asked whether a shared-trip fetch can expose the invite code to a
// non-member. The answer is in the two RPCs, and it is NOT the same for both.

describe('B-2 — the invite code is not reachable from a shared-trip fetch', () => {
  it('get_invite_trip (the UUID path) never returns a code', () => {
    // The trip-id path is what the legacy /invite/<uuid> link uses. This is the
    // function that matters for a non-member holding a UUID: it nulls the code
    // before it answers, so a caller with only the trip id learns nothing.
    const src = readFileSync(new URL('../supabase/migrations/20261012b_member_insert_owner_only.sql', import.meta.url), 'utf8')
    const body = src.slice(src.indexOf('function public.get_invite_trip'))
    expect(body).toContain('v_trip.invite_code := null;')
  })

  it('fetchSharedTrip reads through the UUID RPC, never the code RPC', () => {
    // The full-row path for a shared trip. If it ever called the code RPC, a
    // non-member holding a UUID could resolve a code from it.
    const shared = fnBody(STORE, 'export async function fetchSharedTrip(')
    expect(shared).toContain("rpc('get_invite_trip'")
    expect(shared).not.toContain("rpc('get_trip_by_invite_code'")
  })

  it('the code RPC is gated on membership, price and visibility', () => {
    // get_trip_by_invite_code DOES return invite_code (it must: the caller
    // presented the code). Its guard is the row filter, which is why the code is
    // a capability rather than a secret: without the code there is no row.
    const files = readdirSync(new URL('../supabase/migrations', import.meta.url), 'utf8').filter(f => f.endsWith('.sql'))
    let src = ''
    for (const f of files) {
      const text = readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8')
      if (text.includes('function public.get_trip_by_invite_code')) src = text
    }
    expect(src, 'the newest definition must be found').not.toBe('')
    const body = src.slice(src.indexOf('function public.get_trip_by_invite_code'))
    expect(body).toMatch(/owner_id = auth\.uid\(\)/)
    expect(body).toContain('public.is_member(t.id)')
    expect(body).toContain("t.visibility = 'private'")
  })
})