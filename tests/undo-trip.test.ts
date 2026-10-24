// ============ Undo after trip delete (issue #43) ============
// Deleting a trip cascades six tables in Postgres. Undo re-inserted ONLY the
// trips row, so every vote, decision, activity entry, notification and the
// public Explore link were gone permanently — while the ConfirmDialog promised
// "a short window to undo". The trip row insert also passed `members[0].userId`
// as owner_id, which silently transferred ownership of a shared trip to whoever
// happened to be first in the members array.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Trip, StopSuggestion, TripDecision, ActivityEntry, Notification, PublishedItinerary } from '../src/data/types'

const { state } = vi.hoisted(() => ({
  state: {
    /** Every write the store attempts, in call order. */
    writes: [] as { table: string; method: string; payload: unknown }[],
    /** Every guarded call the store makes, in call order. */
    calls: [] as { fn: string; args: unknown; header: string | null }[],
    /** Writes and guarded calls in ONE order, so a test can compare them. */
    log: [] as string[],
    /** Tables whose write should come back failed, to exercise RLS rejection. */
    fail: new Set<string>(),
    /** Tables whose INSERT must come back failed while every other statement on
     *  them succeeds. The recovery's primary phase is an insert, and failing the
     *  whole table would also fail the delete that captured the payload. */
    failInsert: new Set<string>(),
    /** Columns a pre-migration database does not have. A `select` naming one
     *  answers with Postgres' unknown-column error, the same shape
     *  `isMissingColumnError` reads. */
    missingColumns: new Set<string>(),
    /** How `restore_trip_contributions` answers. The guarded archive function is
     *  the only seam that may put contribution rows back, so every recovery test
     *  drives it here rather than recording a permissive direct write. */
    archive: { status: 'applied' } as { status: string } | { error: string },
    /** Milliseconds the archive answer waits before it resolves. Lets a test
     *  hold a recovery in flight while something else happens. */
    archiveDelay: 0,
    /** Milliseconds the trips insert waits, so a test can switch accounts while
     *  the primary phase is still in the air. */
    tripsDelay: 0,
    /** Set when a primary-phase response waits for the test to RELEASE it. */
    tripsGate: null as null | Promise<void>,
    /** The session token `auth.getSession` answers with. */
    token: 'token-amelia',
    /** Toasts the store raised, so a test can press the action it offered. */
    toasts: [] as { msg: string; kind: string; action?: { label: string; run: () => void } }[],
  },
}))

// The store only imports `toast` from the UI, so a capture is enough — and it
// lets a test press the retry action a failure offers.
vi.mock('../src/components/ui', () => ({
  toast: (msg: string, kind = 'ok', action?: { label: string; run: () => void }) => {
    state.toasts.push({ msg, kind, action })
  },
}))

vi.mock('../src/lib/supabase', () => {
  const record = (table: string, method: string, payload: unknown) => {
    state.writes.push({ table, method, payload })
    state.log.push(`${method} ${table}`)
  }
  const builder = (table: string) => {
    const b: Record<string, unknown> = {
      select: (column?: string) => {
        if (column && state.missingColumns.has(column)) b.missingColumn = column
        return b
      },
      eq: () => b,
      in: () => b,
      limit: () => b,
      maybeSingle: () => b,
      setHeader: (name: string, value: string) => { b.authHeader = `${name}: ${value}`; return b },
      delete: () => (record(table, 'delete', null), b),
      insert: (p: unknown) => (record(table, 'insert', p), b, b.method = 'insert', b),
      upsert: (p: unknown) => (record(table, 'upsert', p), b, b.method = 'upsert', b),
      then: (res: (v: { data: unknown; error: unknown }) => unknown) => {
        const answer = () => Promise.resolve({
          data: [],
          error: state.fail.has(table) || (b.method === 'insert' && state.failInsert.has(table))
            ? { message: 'row-level security' }
            : b.missingColumn ? { code: '42703', message: `column ${b.missingColumn} does not exist` }
              : null,
        })
        // Hold the primary phase in the air until the test releases it, so a
        // test can switch accounts or delete again while the trip insert waits.
        if (table === 'trips' && b.method === 'insert' && state.tripsGate) {
          const gate = state.tripsGate
          return gate.then(answer).then(res)
        }
        if (table === 'trips' && b.method === 'insert' && state.tripsDelay > 0) {
          return new Promise(r => setTimeout(r, state.tripsDelay)).then(answer).then(res)
        }
        return answer().then(res)
      },
    }
    return b
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: (t: string) => builder(t),
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
            state.log.push(`call ${fn}`)
            const answer = fn === 'restore_trip_contributions' ? state.archive : { status: 'applied' }
            const isError = 'error' in answer
            const settle = () => Promise.resolve({
              data: isError ? null : answer,
              error: isError ? { message: answer.error } : null,
            })
            return (state.archiveDelay > 0 && fn === 'restore_trip_contributions'
              ? new Promise(resolve => setTimeout(resolve, state.archiveDelay)).then(settle)
              : settle()).then(res)
          },
        }
        return b
      },
    },
  }
})

/** Owner deliberately NOT first: `members[0]` is an editor, so any code that
 *  reads members[0] as the owner reassigns the trip to Priya. */
function mkTrip(): Trip {
  return {
    id: 'trip-1', name: 'Kerala, 4 days', startLocation: 'Kochi', destinations: ['Munnar'],
    startDate: '2026-10-01', endDate: '2026-10-04', travellers: 2, transportMode: 'car',
    budgetPerPersonInr: 12000, travelStyle: 'balanced', fixedCommitments: [],
    days: [{ id: 'day-1', index: 0, title: 'Day 1', stops: [{ id: 'st-1', name: 'Fort Kochi', lat: 9.93, lng: 76.26, arrival: '10:00', departure: '12:00', notes: '', status: 'confirmed', category: 'sightseeing', costInr: 0, travelMinutes: 0, travelKm: 0 }] }],
    expenses: [{ id: 'ex-1', label: 'Houseboat', category: 'accommodation', amountInr: 4000 }],
    coverEmoji: '🌴', visibility: 'private', createdAt: 1, updatedAt: 2,
    members: [
      { userId: 'priya', role: 'editor', joinedAt: 1 },
      { userId: 'amelia', role: 'owner', joinedAt: 0 },
    ],
  }
}

const suggestion: StopSuggestion = {
  id: 'sg-1', tripId: 'trip-1', dayIndex: 0, proposedBy: 'priya', title: 'Chinese Fish',
  category: 'food', locationName: 'Kerala Diner', lat: 9.93, lng: 76.26, visitMinutes: 45,
  estimatedEntryFeeInr: 0, estimatedTransportInr: 200,
  votes: [{ userId: 'amelia', value: 1, createdAt: 10 }], comments: [], status: 'accepted', createdAt: 12,
}
const decision: TripDecision = {
  id: 'dc-1', tripId: 'trip-1', question: 'Houseboat or resort?',
  options: [{ id: 'op-1', label: 'Houseboat' }], votesByUserId: { amelia: 'op-1' }, comments: [],
  status: 'open', raisedBy: 'amelia', createdAt: 20,
}
const activity: ActivityEntry = { id: 'ac-1', tripId: 'trip-1', actorId: 'priya', verb: 'upvoted a suggestion', at: 30 }
const notification: Notification = { id: 'nt-1', userId: 'amelia', tripId: 'trip-1', text: 'Priya suggested a stop', read: false, at: 40 }
const published: PublishedItinerary = {
  id: 'kerala-4-days', tripId: 'trip-1', creatorId: 'amelia', title: 'Kerala, 4 days', tagline: 'Backwaters',
  routeSummary: ['Kochi'], durationDays: 4, estimatedBudgetPerPersonInr: 12000, travelStyle: 'balanced',
  travelTips: [], warningsAndAssumptions: [], freeDayIndexes: [], publishedAt: 50, views: 17, copies: 3,
}

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** The action on the most recent toast that offered one, if any. */
function lastAction(): { label: string; run: () => void } | undefined {
  return state.toasts.filter(t => t.action).pop()?.action
}

async function freshStoreWith(seed = true, withPub = false) {
  vi.resetModules()
  const store = await import('../src/store/store')
  store.getSnapshot().sessionUserId = 'amelia'
  if (seed) {
    const db = store.getSnapshot()
    db.trips.push(mkTrip())
    db.suggestions.push(suggestion)
    db.decisions.push(decision)
    db.activity.push(activity)
    db.notifications.push(notification)
    // #566 — the publication is seeded only where the test is ABOUT it: a
    // published trip is now refused outright by deleteTrip (the refusal test
    // below), so seeding it everywhere would have turned every mechanics test
    // into a no-op.
    if (withPub) db.published.push(published)
  }
  return store
}

const writesTo = (table: string, method?: string) =>
  state.writes.filter(w => w.table === table && (!method || w.method === method))

beforeEach(() => {
  state.writes = []
  state.calls = []
  state.log = []
  state.fail = new Set()
  state.failInsert = new Set()
  state.missingColumns = new Set()
  state.archive = { status: 'applied' }
  state.archiveDelay = 0
  state.tripsDelay = 0
  state.tripsGate = null
  state.token = 'token-amelia'
  state.toasts = []
})

describe('undo after trip delete (#43)', () => {
  it('re-inserts the trip under its real owner, not members[0]', async () => {
    const store = await freshStoreWith()
    const trip = store.getSnapshot().trips[0]

    store.deleteTrip('trip-1')
    store.restoreTrip(trip, 0)
    await flush()

    const row = writesTo('trips', 'insert')[0].payload as { owner_id: string }
    expect(row.owner_id).toBe('amelia')
    expect(row.owner_id).not.toBe('priya')
  })

  it('routes contribution recovery through the guarded archive function', async () => {
    // Stage A removed the direct insert policies on suggestions, decisions,
    // activity and notifications, so a client-side re-insert is refused by the
    // database and proves nothing. The guarded archive function is the seam that
    // can put them back, and it is bound to the captured account's token.
    const store = await freshStoreWith()
    const trip = store.getSnapshot().trips[0]

    store.deleteTrip('trip-1')
    store.restoreTrip(trip, 0)
    await flush()
    await flush()

    const call = state.calls.find(c => c.fn === 'restore_trip_contributions')
    expect(call).toBeDefined()
    expect((call!.args as { p_trip_id: string }).p_trip_id).toBe('trip-1')
    expect(call!.header).toBe('Authorization: Bearer token-amelia')
    // Nothing may try to write those tables directly.
    for (const table of ['suggestions', 'decisions', 'activity', 'notifications']) {
      expect(writesTo(table)).toHaveLength(0)
    }
  })

  it('refuses to delete a published trip — undo cannot restore buyers\' grants', async () => {
    // #566: the trip row cascades `published_itineraries`, and the pub row
    // cascades `entitlements`/`purchase_orders`/`pub_events`. Nothing that
    // hard-deletes a trip may carry that chain — the same rule the purge RPCs
    // now enforce server-side, so no client path is the back door around it.
    const store = await freshStoreWith(true, true)

    store.deleteTrip('trip-1')
    await flush()

    expect(store.getSnapshot().trips).toHaveLength(1)
    expect(store.getSnapshot().published).toHaveLength(1)
    expect(writesTo('trips', 'delete')).toHaveLength(0)
    expect(writesTo('published_itineraries')).toHaveLength(0)
  })

  it('writes the trip before it asks the archive for the children', async () => {
    // The archive function reads the trip row (it refuses when the row is gone),
    // and every child policy gates on membership, so the trip and its members
    // must already be in place when it runs.
    const store = await freshStoreWith()
    const trip = store.getSnapshot().trips[0]

    store.deleteTrip('trip-1')
    store.restoreTrip(trip, 0)
    await flush()
    await flush()

    const archiveAt = state.log.indexOf('call restore_trip_contributions')
    expect(archiveAt).toBeGreaterThanOrEqual(0)
    expect(state.log.indexOf('insert trips')).toBeGreaterThanOrEqual(0)
    expect(state.log.indexOf('insert trips')).toBeLessThan(archiveAt)
    expect(state.log.indexOf('insert trip_members')).toBeLessThan(archiveAt)
  })

  it('leaves the itinerary intact and does not duplicate cache rows', async () => {
    const store = await freshStoreWith()
    const trip = store.getSnapshot().trips[0]

    store.deleteTrip('trip-1')
    expect(store.getSnapshot().trips).toHaveLength(0)

    store.restoreTrip(trip, 0)
    await flush()

    const restored = store.getSnapshot().trips.find(t => t.id === 'trip-1')
    expect(restored?.days[0].stops).toHaveLength(1)   // JSONB survived all along
    expect(restored?.expenses).toHaveLength(1)
    expect(store.getSnapshot().suggestions.filter(s => s.tripId === 'trip-1')).toHaveLength(1)
    expect(writesTo('trip_members', 'insert')[0].payload).toHaveLength(2)
  })

  it('restores nothing when there is no captured payload to recover', async () => {
    // Unseeded: nothing was ever captured, so there is no payload, no captured
    // identity and no access generation to bind a recovery to. Refusing is the
    // only honest answer — an unbound write is exactly what this repair removes.
    const store = await freshStoreWith(false)
    store.restoreTrip(mkTrip(), 0)
    await flush()

    expect(state.writes).toHaveLength(0)
    expect(state.calls).toHaveLength(0)
  })


  it('keeps the payload and offers a retry when the archive refuses', async () => {
    // `forbidden` is the honest answer for a missing or expired archive, or a
    // caller who is not the archived owner. Nothing is stripped and nothing is
    // written directly: the payload stays and the toast offers the action.
    const store = await freshStoreWith()
    const trip = store.getSnapshot().trips[0]
    state.archive = { status: 'forbidden' }

    store.deleteTrip('trip-1')
    store.restoreTrip(trip, 0)
    await flush()
    await flush()

    expect(state.calls.filter(c => c.fn === 'restore_trip_contributions')).toHaveLength(1)
    for (const table of ['suggestions', 'decisions', 'activity', 'notifications']) {
      expect(writesTo(table)).toHaveLength(0)
    }
    // The trip is back and the cache copy of the suggestion is untouched.
    expect(store.getSnapshot().trips.filter(t => t.id === 'trip-1')).toHaveLength(1)
    expect(store.getSnapshot().suggestions.find(s => s.id === 'sg-1')?.status).toBe('accepted')
  })

  it('a retry after the server gains support recovers without a reload', async () => {
    // The archive function is missing on the first try (a database that has not
    // been migrated yet) and present on the second. The repeat is the user saying
    // "try again now", so the recovery re-asks the server instead of answering
    // from a cached refusal.
    const store = await freshStoreWith()
    const trip = store.getSnapshot().trips[0]
    state.archive = { error: 'Could not find the function public.restore_trip_contributions' }

    store.deleteTrip('trip-1')
    store.restoreTrip(trip, 0)
    await flush()
    await flush()
    expect(state.calls.filter(c => c.fn === 'restore_trip_contributions')).toHaveLength(1)

    state.archive = { status: 'applied' }
    store.restoreTrip(trip, 0)
    await flush()
    await flush()

    expect(state.calls.filter(c => c.fn === 'restore_trip_contributions')).toHaveLength(2)
    // The payload is spent, so a third run has nothing left to do.
    store.restoreTrip(trip, 0)
    await flush()
    await flush()
    expect(state.calls.filter(c => c.fn === 'restore_trip_contributions')).toHaveLength(2)
  })

  it('does not let a newer deletion\'s recovery write children', async () => {
    const store = await freshStoreWith()
    const trip = store.getSnapshot().trips[0]

    store.deleteTrip('trip-1')
    // Hold the first recovery's archive answer open, and let it get that far:
    // the trip row is written and the guarded call is in flight.
    state.archiveDelay = 5
    store.restoreTrip(trip, 0)
    await flush()
    expect(state.calls.filter(c => c.fn === 'restore_trip_contributions')).toHaveLength(1)

    // The user deletes the trip again while that answer is still pending.
    store.deleteTrip('trip-1')
    await flush()
    await flush()
    await flush()

    // The second delete moved the trip's access generation, so the waiting
    // recovery refuses the moment its answer lands: it writes nothing further,
    // says nothing, and leaves the newer payload on the slot.
    expect(state.calls.filter(c => c.fn === 'restore_trip_contributions')).toHaveLength(1)
    for (const table of ['suggestions', 'decisions', 'activity', 'notifications']) {
      expect(writesTo(table)).toHaveLength(0)
    }

    // The newer payload's own recovery still works.
    store.restoreTrip(trip, 0)
    await flush()
    await flush()
    expect(state.calls.filter(c => c.fn === 'restore_trip_contributions')).toHaveLength(2)
  })

  it('stops the primary phase when the account switches mid-insert', async () => {
    // The outer guard cannot see inside persistTripRows: the trip insert awaits,
    // and while it waits the account can change. The guard and the captured
    // bearer travel into those phases now, so the membership write that used to
    // follow never happens.
    const store = await freshStoreWith()
    const trip = store.getSnapshot().trips[0]
    let release = () => {}
    state.tripsGate = new Promise<void>(r => { release = r })

    store.deleteTrip('trip-1')
    store.restoreTrip(trip, 0)
    await flush()
    expect(writesTo('trips', 'insert')).toHaveLength(1)

    // The account switches while the trip insert is still in the air.
    store.getSnapshot().sessionUserId = 'priya'
    release()
    await flush()
    await flush()
    await flush()

    // No membership write, no archive call, and nothing toasted to the new
    // account: the retired try performs no later write or cache mutation.
    expect(writesTo('trip_members', 'insert')).toHaveLength(0)
    expect(state.calls.filter(c => c.fn === 'restore_trip_contributions')).toHaveLength(0)
  })

  it('keeps the payload and offers the retry when the trip row cannot be written', async () => {
    const store = await freshStoreWith()
    const trip = store.getSnapshot().trips[0]
    state.failInsert = new Set(['trips'])

    store.deleteTrip('trip-1')
    store.restoreTrip(trip, 0)
    await flush()
    await flush()

    // The primary phase failed, so nothing downstream ran and the payload is
    // still on the slot: the archive was never consulted and no member row was
    // written.
    expect(writesTo('trip_members', 'insert')).toHaveLength(0)
    expect(state.calls.filter(c => c.fn === 'restore_trip_contributions')).toHaveLength(0)

    // Fix the database and press the button the failure offered.
    state.failInsert = new Set()
    const action = lastAction()
    expect(action?.label).toBe('Try again')
    action?.run()
    await flush()
    await flush()

    // The whole recovery runs this time, and the payload is released.
    expect(state.calls.filter(c => c.fn === 'restore_trip_contributions')).toHaveLength(1)
    expect(writesTo('trip_members', 'insert')).toHaveLength(1)
    store.restoreTrip(trip, 0)
    await flush()
    await flush()
    expect(state.calls.filter(c => c.fn === 'restore_trip_contributions')).toHaveLength(1)
  })

  it('consults the archive even when the local contribution cache is empty', async () => {
    // The device may have no suggestion, decision, activity or notification row
    // while the server holds some this device never saw. Local emptiness is not
    // proof of an empty archive, so the guarded call is made on every recovery.
    const store = await freshStoreWith()
    const trip = store.getSnapshot().trips[0]
    store.getSnapshot().suggestions = []
    store.getSnapshot().decisions = []
    store.getSnapshot().activity = []
    store.getSnapshot().notifications = []

    store.deleteTrip('trip-1')
    store.restoreTrip(trip, 0)
    await flush()
    await flush()

    const call = state.calls.find(c => c.fn === 'restore_trip_contributions')
    expect(call).toBeDefined()
    expect((call!.args as { p_trip_id: string }).p_trip_id).toBe('trip-1')
  })
})
