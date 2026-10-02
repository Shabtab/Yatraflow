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
    /** Tables whose write should come back failed, to exercise RLS rejection. */
    fail: new Set<string>(),
  },
}))

vi.mock('../src/lib/supabase', () => {
  const record = (table: string, method: string, payload: unknown) => state.writes.push({ table, method, payload })
  const builder = (table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      limit: () => b,
      maybeSingle: () => b,
      delete: () => (record(table, 'delete', null), b),
      insert: (p: unknown) => (record(table, 'insert', p), b),
      upsert: (p: unknown) => (record(table, 'upsert', p), b),
      then: (res: (v: { data: unknown; error: unknown }) => unknown) =>
        Promise.resolve({ data: [], error: state.fail.has(table) ? { message: 'row-level security' } : null }).then(res),
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
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: {} } }),
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

async function freshStoreWith(seed = true, withPub = false) {
  vi.resetModules()
  const store = await import('../src/store/store')
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
  state.fail = new Set()
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

  it('restores votes, decisions, activity and notifications', async () => {
    const store = await freshStoreWith()
    const trip = store.getSnapshot().trips[0]

    store.deleteTrip('trip-1')
    store.restoreTrip(trip, 0)
    await flush()

    expect((writesTo('suggestions', 'insert')[0].payload as { id: string }[])[0]).toMatchObject({ id: 'sg-1', status: 'accepted' })
    expect((writesTo('decisions', 'insert')[0].payload as { id: string }[])[0].id).toBe('dc-1')
    expect((writesTo('activity', 'insert')[0].payload as { id: string }[])[0].id).toBe('ac-1')
    expect((writesTo('notifications', 'insert')[0].payload as { id: string }[])[0].id).toBe('nt-1')
    // The public-link upsert this test used to assert is now unreachable BY
    // DESIGN (#566): deleteTrip refuses a published trip before it snapshots,
    // because the undo can restore the publication row but NOT the buyers'
    // entitlements and orders that cascade off it — a delete+undo of a
    // published trip would be a confiscation with a restored logo on top. The
    // upsert stays in restoreTripData as belt and braces; the refusal below is
    // the behaviour that matters.
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

  it('writes the trip before its children, because RLS gates them on membership', async () => {
    const store = await freshStoreWith()
    const trip = store.getSnapshot().trips[0]

    store.deleteTrip('trip-1')
    store.restoreTrip(trip, 0)
    await flush()

    const order = state.writes.map(w => `${w.method} ${w.table}`)
    expect(order.indexOf('insert trips')).toBeLessThan(order.indexOf('insert suggestions'))
    expect(order.indexOf('insert trip_members')).toBeLessThan(order.indexOf('insert suggestions'))
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

  it('restores only the trip when there is no snapshot to restore from', async () => {
    // Unseeded: the cache is empty, so restoreTrip's duplicate guard does not
    // fire. With no preceding deleteTrip nothing was ever captured, so the old
    // behaviour (trip + members only) must still hold, and it must not throw.
    const store = await freshStoreWith(false)
    store.restoreTrip(mkTrip(), 0)
    await flush()

    expect(writesTo('trips', 'insert')).toHaveLength(1)
    expect(writesTo('trip_members', 'insert')).toHaveLength(1)
    expect(writesTo('suggestions', 'insert')).toHaveLength(0)
    expect(writesTo('published_itineraries', 'upsert')).toHaveLength(0)
  })
})
