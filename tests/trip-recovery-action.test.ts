// ============ The recovery action on a failed undo (#839) ============
// A failure that says "try again" with no button is a promise the user cannot
// keep, and a retry that re-reads who is signed in is a recovery that can be
// inherited by the wrong account. These assertions drive the store the way the
// product does: the failure toast's own action, and the guards that must refuse
// it once the account, the trip's access generation, or the payload has moved.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Trip, StopSuggestion } from '../src/data/types'

const { state, toasts } = vi.hoisted(() => ({
  state: {
    /** Guarded calls, so a test can compare them. */
    calls: [] as { fn: string; args: unknown; header: string | null }[],
    archive: { status: 'applied' } as { status: string } | { error: string },
    archiveDelay: 0,
    token: 'token-amelia',
  },
  toasts: [] as { msg: string; kind: string; action?: { label: string; run: () => void } }[],
}))

vi.mock('../src/components/ui', () => ({
  toast: (msg: string, kind = 'ok', action?: { label: string; run: () => void }) => {
    toasts.push({ msg, kind, action })
  },
}))

vi.mock('../src/lib/supabase', () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      limit: () => b,
      maybeSingle: () => b,
      setHeader: (name: string, value: string) => { b.authHeader = `${name}: ${value}`; return b },
      delete: () => b,
      insert: () => b,
      upsert: () => b,
      then: (res: (v: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(res),
    }
    return b
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: builder,
      channel: () => { const c: Record<string, unknown> = { on: () => c, subscribe: () => ({}) }; return c },
      removeChannel: () => Promise.resolve(),
      auth: {
        getSession: () => Promise.resolve({
          data: { session: state.token ? { user: { id: 'amelia' }, access_token: state.token } : null },
        }),
        onAuthStateChange: () => ({ data: { subscription: {} } }),
      },
      rpc: (fn: string, args: unknown) => {
        const b: Record<string, unknown> = {
          setHeader: (name: string, value: string) => { b.authHeader = `${name}: ${value}`; return b },
          then: (res: (v: { data: unknown; error: unknown }) => unknown) => {
            state.calls.push({ fn, args, header: (b.authHeader as string | undefined) ?? null })
            const answer = fn === 'restore_trip_contributions' ? state.archive : { status: 'applied' }
            const isError = 'error' in answer
            const settle = () => Promise.resolve({
              data: isError ? null : answer,
              error: isError ? { message: answer.error } : null,
            })
            return (state.archiveDelay > 0 && fn === 'restore_trip_contributions'
              ? new Promise(r => setTimeout(r, state.archiveDelay)).then(settle)
              : settle()).then(res)
          },
        }
        return b
      },
    },
  }
})

const suggestion: StopSuggestion = {
  id: 'sg-1', tripId: 'trip-1', dayIndex: 0, proposedBy: 'amelia', title: 'Chinese Fish',
  category: 'food', locationName: 'Kerala Diner', lat: 9.93, lng: 76.26, visitMinutes: 45,
  estimatedEntryFeeInr: 0, estimatedTransportInr: 200,
  votes: [], comments: [], status: 'open', createdAt: 12,
}

function mkTrip(): Trip {
  return {
    id: 'trip-1', name: 'Kerala, 4 days', startLocation: 'Kochi', destinations: ['Munnar'],
    startDate: '2026-10-01', endDate: '2026-10-04', travellers: 2, transportMode: 'car',
    budgetPerPersonInr: 12000, travelStyle: 'balanced', fixedCommitments: [],
    days: [{ id: 'day-1', index: 0, title: 'Day 1', stops: [] }],
    expenses: [], coverEmoji: '🌴', visibility: 'private', createdAt: 1, updatedAt: 2,
    members: [{ userId: 'amelia', role: 'owner', joinedAt: 0 }],
  }
}

async function freshStore() {
  vi.resetModules()
  const store = await import('../src/store/store')
  store.getSnapshot().sessionUserId = 'amelia'
  const db = store.getSnapshot()
  db.trips.push(mkTrip())
  db.suggestions.push(suggestion)
  return store
}

const archiveCalls = () => state.calls.filter(c => c.fn === 'restore_trip_contributions')
const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  state.calls = []
  state.archive = { status: 'applied' }
  state.archiveDelay = 0
  state.token = 'token-amelia'
  toasts.length = 0
})

describe('the recovery action a failed undo displays', () => {
  it('offers a button, and the button really retries', async () => {
    const store = await freshStore()
    const trip = store.getSnapshot().trips[0]
    state.archive = { status: 'unavailable' }

    store.deleteTrip('trip-1')
    store.restoreTrip(trip, 0)
    await flush()
    await flush()

    // The failure is announced with one action, in plain product copy.
    const failure = toasts.filter(t => t.action).pop()
    expect(failure).toBeDefined()
    expect(failure!.kind).toBe('err')
    expect(failure!.action!.label).toBe('Try again')
    expect(failure!.msg).not.toMatch(/#\d{3}/)          // no issue numbers
    expect(failure!.msg.toLowerCase()).not.toContain('migration')

    // Pressing it re-runs the recovery against the same captured payload.
    expect(archiveCalls()).toHaveLength(1)
    state.archive = { status: 'applied' }
    failure!.action!.run()
    await flush()
    await flush()
    expect(archiveCalls()).toHaveLength(2)

    // It landed, so the payload is spent and the seam closes.
    failure!.action!.run()
    await flush()
    await flush()
    expect(archiveCalls()).toHaveLength(2)
    expect(toasts.filter(t => t.action)).toHaveLength(1)
  })

  it('says nothing and writes nothing after an account switch', async () => {
    const store = await freshStore()
    const trip = store.getSnapshot().trips[0]
    state.archive = { status: 'unavailable' }

    store.deleteTrip('trip-1')
    store.restoreTrip(trip, 0)
    await flush()
    await flush()
    const action = toasts.filter(t => t.action).pop()!.action!

    // Another account signs in. The recovery belongs to the one that deleted.
    store.getSnapshot().sessionUserId = 'priya'
    const before = archiveCalls().length
    action.run()
    await flush()
    await flush()

    expect(archiveCalls()).toHaveLength(before)
    // And the new account is not told about the old one's failure.
    expect(toasts.filter(t => t.action)).toHaveLength(1)
  })

  it('refuses when the trip was deleted again, and says the recovery is gone', async () => {
    const store = await freshStore()
    const trip = store.getSnapshot().trips[0]
    state.archive = { status: 'unavailable' }

    store.deleteTrip('trip-1')
    store.restoreTrip(trip, 0)
    await flush()
    await flush()
    const action = toasts.filter(t => t.action).pop()!.action!

    // The trip comes back and is deleted a second time: a NEWER payload takes
    // the slot, so this one is spent.
    store.restoreTrip(trip, 0)
    await flush()
    await flush()
    store.deleteTrip('trip-1')
    const before = archiveCalls().length

    action.run()
    await flush()
    await flush()

    expect(archiveCalls()).toHaveLength(before)
    expect(toasts.some(t => t.msg === 'That recovery is no longer available.')).toBe(true)
  })

  it('refuses when the account switched during the awaited phases', async () => {
    const store = await freshStore()
    const trip = store.getSnapshot().trips[0]
    state.archiveDelay = 5

    store.deleteTrip('trip-1')
    store.restoreTrip(trip, 0)
    await flush()
    expect(archiveCalls()).toHaveLength(1)

    // Another account signs in while the archive answer is still pending.
    store.getSnapshot().sessionUserId = 'priya'
    await flush()
    await flush()
    await flush()

    // The waiting recovery refuses: no second call, and no toast attributing
    // the first account's failure to the one now looking at the screen.
    expect(archiveCalls()).toHaveLength(1)
    expect(toasts).toHaveLength(0)
  })

  it('honours an applied answer without writing anything twice', async () => {
    const store = await freshStore()
    const trip = store.getSnapshot().trips[0]
    state.archive = { status: 'alreadyApplied' }

    store.deleteTrip('trip-1')
    store.restoreTrip(trip, 0)
    await flush()
    await flush()

    expect(archiveCalls()).toHaveLength(1)
    // alreadyApplied is success: no failure toast, no retry offered.
    expect(toasts.filter(t => t.action)).toHaveLength(0)
    // And the payload is spent, so a further run does nothing.
    store.restoreTrip(trip, 0)
    await flush()
    await flush()
    expect(archiveCalls()).toHaveLength(1)
  })

  it('pins the bearer to the account that asked for the recovery', async () => {
    const store = await freshStore()
    const trip = store.getSnapshot().trips[0]

    store.deleteTrip('trip-1')
    store.restoreTrip(trip, 0)
    await flush()
    await flush()

    expect(archiveCalls()[0].header).toBe('Authorization: Bearer token-amelia')
    expect((archiveCalls()[0].args as { p_trip_id: string }).p_trip_id).toBe('trip-1')
  })

  it('leaves no unguarded await inside primary persistence', () => {
    // The every-await contract: no phase inside persistTripRows may continue
    // after a retired recovery. The queue re-base was the one await without a
    // guard behind it. Source review did not prove that branch reachable during a
    // recovery, so this is a contract pin, not a reproduced exploit — and it is
    // pinned so the omission cannot come back unnoticed.
    const src = readFileSync('src/store/store.ts', 'utf8')
    const from = src.indexOf('async function persistTripRows')
    const to = src.indexOf('function buildTripCopy(')
    expect(from).toBeGreaterThan(0)
    expect(to).toBeGreaterThan(from)
    const body = src.slice(from, to)

    const awaits = (body.match(/await /g) ?? []).length
    const guards = (body.match(/if \(!guard\(\)\) return false/g) ?? []).length
    expect(awaits).toBeGreaterThan(0)
    expect(guards).toBeGreaterThanOrEqual(awaits)

    const marker = 'await requeueIfCurrent(rebased)'
    expect(body).toContain(marker)
    const after = body.slice(body.indexOf(marker) + marker.length)
    // The next statement after the re-base await is the guard, with comments allowed between.
    expect(after.replace(/^\s*(?:\/\/[^\n]*\n\s*)*/, '').startsWith('if (!guard()) return false')).toBe(true)
  })
})
