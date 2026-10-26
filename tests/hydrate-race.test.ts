// ============ Hydration race / account isolation (issue #45) ============
// Regression for the cross-account leak: `hydrate(null)` on logout cleared the
// cache and nulled `activeHydrate` WITHOUT awaiting a hydrate that was still in
// flight. That hydrate then resolved and `patch()`ed the previous user's trips —
// and their `sessionUserId` — back into the emptied cache, so whoever used the
// browser next could see, and be treated as, the account that had just signed out.
//
// The fix stamps every auth event with a generation and drops the patch of any
// run whose generation has been superseded. These tests force the dangerous
// ordering deliberately: the mocked queries are gated, so a hydrate can be made
// to resolve *after* a logout or *after* a newer account's hydrate has finished.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { profileSession } from './helpers/profileSession'
import type { TripRow } from '../src/lib/tripRow'

const { state } = vi.hoisted(() => ({
  state: {
    /** Table rows served by the next query. Reassigned between auth events so
     *  each hydrate captures the data belonging to the account it runs for. */
    tables: {} as Record<string, unknown[]>,
    errors: {} as Record<string, unknown>,
    rejects: {} as Record<string, unknown>,
    adminUser: null as string | null,
    queriedTables: [] as string[],
    channelNames: [] as string[],
    /** Gate per user id; a builder captures the gate of whoever is active when
     *  the query is issued, letting a specific account's hydrate be released late. */
    gates: {} as Record<string, Promise<void>>,
    queryGates: {} as Record<string, Promise<void>[]>,
    rpcGates: {} as Record<string, Promise<void>>,
    rpcResponses: {} as Record<string, { data: unknown; error: unknown; rejection?: unknown }>,
    savedSnapshots: [] as Array<{ userId: string; trashedTripIds: string[] }>,
    activeUser: null as string | null,
    authHandler: null as ((event: string, session: unknown) => void) | null,
    resolveSession: null as (() => void) | null,
    sessionUser: null as string | null,
    holdSignOut: false,
    resolveSignOut: null as (() => void) | null,
  },
}))

vi.mock('../src/lib/offlineCache', () => ({
  clearSnapshot: vi.fn(async () => undefined),
  loadSnapshot: vi.fn(async () => null),
  saveSnapshot: vi.fn(async (userId: string, snapshot: { trashedTrips: Array<{ id: string }> }) => {
    state.savedSnapshots.push({
      userId,
      trashedTripIds: snapshot.trashedTrips.map(trip => trip.id),
    })
  }),
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    state.queriedTables.push(table)
    const rows = state.tables[table] ?? []
    const queryKey = `${state.activeUser ?? ''}:${table}`
    const queryGate = state.queryGates[queryKey]?.shift()
    const gate = queryGate ?? state.gates[state.activeUser ?? ''] ?? Promise.resolve()
    const error = state.errors[table] ?? null
    const rejection = state.rejects[table]
    const builder: Record<string, unknown> = {
      select: () => builder,
      setHeader: () => builder,
      eq: () => builder,
      is: () => builder,
      in: () => builder,
      update: () => builder,
      insert: () => builder,
      delete: () => builder,
      limit: () => builder,
      maybeSingle: () => { builder.singleUsed = true; return builder },
      single: () => { builder.singleUsed = true; return builder },
      // Chainable + thenable, but the response is withheld until this account's
      // gate is released — that is what makes the race reproducible.
      then: (
        res: (v: { data: unknown; error: unknown }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => gate.then(() => {
        if (rejection !== undefined) throw rejection
        // A `.maybeSingle()` / `.single()` read asks for ONE row, and the code it
        // feeds maps that row directly. Answering with the whole array made
        // `rowToPrivateUser` read `id` off an array and produce `undefined`, so
        // the account was never found and every private verdict read as ok.
        const single = builder.singleUsed === true ? (rows[0] ?? null) : rows
        return { data: error ? null : single, error }
      }).then(res, reject),
    }
    return builder
  }
  const chain: Record<string, unknown> = { on: () => chain, subscribe: () => ({}) }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: (t: string) => makeBuilder(t),
      channel: (name: string) => { state.channelNames.push(name); return chain },
      removeChannel: () => Promise.resolve(),
      auth: {
        getSession: () =>
          new Promise(resolve => {
            state.resolveSession = () =>
              resolve({
                data: {
                  session: state.sessionUser
                    ? profileSession({ user: {
                        id: state.sessionUser,
                        app_metadata: state.adminUser === state.sessionUser ? { role: 'masteradmin' } : {},
                      } })
                    : null,
                },
              })
          }),
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          state.authHandler = (event, session) => cb(event, session && typeof session === 'object' && 'user' in session ? profileSession(session as { user: { id: string } }) : session)
          return { data: { subscription: {} } }
        },
        signOut: () => state.holdSignOut
          ? new Promise(resolve => {
            state.resolveSignOut = () => resolve({ error: null })
          })
          : Promise.resolve({ error: null }),
      },
      rpc: (name: string) => {
        const key = `${state.activeUser ?? ''}:${name}`
        const gate = state.rpcGates[key] ?? Promise.resolve()
        const response = state.rpcResponses[key] ?? { data: [], error: null }
        const result = gate.then(() => {
          if (response.rejection !== undefined) throw response.rejection
          return { data: response.error ? null : response.data, error: response.error }
        })
        return { setHeader() { return this }, then: result.then.bind(result) }
      },
    },
  }
})

/** A row shaped enough for `rowToTrip` to map without throwing. */
function tripRow(id: string, ownerId: string): TripRow {
  return {
    id, owner_id: ownerId, name: `Trip ${id}`, start_location: 'Kochi',
    start_location_coords: null, destinations: ['Kochi'], destination_coords: null,
    start_date: '2026-10-01', end_date: '2026-10-03', travellers: 2, transport_mode: 'car',
    budget_per_person_inr: 5000, travel_style: 'balanced', fixed_commitments: [],
    days: [], expenses: [], cover_emoji: '🧭', visibility: 'private',
    created_at: 1, updated_at: 1,
  }
}

function memberRow(tripId: string, userId: string) {
  return { trip_id: tripId, user_id: userId, role: 'owner', joined_at: 1 }
}

function rowsFor(tripId: string, userId: string) {
  return {
    profiles: [],
    published_itineraries: [],
    trip_members: [memberRow(tripId, userId)],
    trips: [tripRow(tripId, userId)],
  }
}

function profileRow(id: string) {
  return {
    id, email: `${id}@example.test`, created_at: 1, name: id,
    languages: ['en'], travel_styles: ['balanced'], is_creator: false,
  }
}

function suggestionRow(id: string, tripId: string, userId: string) {
  return {
    id, trip_id: tripId, day_index: 0, proposed_by: userId, title: `Idea ${id}`,
    category: 'sightseeing', location_name: 'Fort', lat: 10, lng: 76,
    description: '', visit_minutes: 30, votes: [], comments: [], status: 'open', created_at: 1,
  }
}

function notificationRow(id: string, tripId: string, userId: string) {
  return { id, trip_id: tripId, user_id: userId, text: `Notice ${id}`, read: false, at: 1 }
}

function decisionRow(id: string, tripId: string, userId: string) {
  return {
    id, trip_id: tripId, question: `Question ${id}`, context: '', options: [],
    votes_by_user_id: {}, status: 'open', comments: [], raised_by: userId,
    created_at: 1, resolved_at: null, resolved_option_id: null,
  }
}

function activityRow(id: string, tripId: string, userId: string) {
  return { id, trip_id: tripId, actor_id: userId, verb: `Action ${id}`, target: null, at: 1 }
}

function auditRow(id: string, userId: string) {
  return {
    id, actor_id: userId, action: `Action ${id}`, target_type: null,
    target_id: null, detail: {}, at: 1,
  }
}

/** Let the store's fire-and-forget async work drain. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

async function freshStore() {
  vi.resetModules()
  return await import('../src/store/store')
}

async function refresh(store: Awaited<ReturnType<typeof freshStore>>): Promise<void> {
  const pending = store.resumeSync()
  state.resolveSession!()
  await pending
}

function gated(user: string) {
  let release!: () => void
  state.gates[user] = new Promise<void>(r => (release = r))
  return () => release()
}

function gatedQuery(user: string, table: string) {
  let release!: () => void
  const key = `${user}:${table}`
  state.queryGates[key] ??= []
  state.queryGates[key].push(new Promise<void>(r => (release = r)))
  return () => release()
}

function gatedRpc(user: string, name: string) {
  let release!: () => void
  state.rpcGates[`${user}:${name}`] = new Promise<void>(r => (release = r))
  return () => release()
}

async function signedInAdminStore() {
  const store = await freshStore()
  state.tables = {
    ...rowsFor('tripA', 'userA'),
    admin_audit: [auditRow('auditA', 'userA')],
  }
  state.adminUser = 'userA'
  state.activeUser = 'userA'
  state.sessionUser = 'userA'
  store.init()
  state.resolveSession!()
  await flush()
  return store
}

beforeEach(() => {
  state.tables = {}
  state.errors = {}
  state.rejects = {}
  state.adminUser = null
  state.queriedTables = []
  state.channelNames = []
  state.gates = {}
  state.queryGates = {}
  state.rpcGates = {}
  state.rpcResponses = {}
  state.savedSnapshots = []
  state.activeUser = null
  state.authHandler = null
  state.resolveSession = null
  state.sessionUser = null
  state.holdSignOut = false
  state.resolveSignOut = null
})

describe('decision and activity hydration', () => {
  it('keeps each failed slice and clears a successful empty slice', async () => {
    const store = await freshStore()
    state.tables = {
      ...rowsFor('tripA', 'userA'),
      decisions: [decisionRow('decisionA', 'tripA', 'userA')],
      activity: [activityRow('activityA', 'tripA', 'userA')],
    }
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    state.errors = { decisions: new Error('decisions unavailable') }
    await refresh(store)

    expect(store.getSnapshot().decisions.map(row => row.id)).toEqual(['decisionA'])
    expect(store.getSnapshot().activity.map(row => row.id)).toEqual(['activityA'])
    expect(store.getSnapshot().sliceReads.decisions).toBe('failed')
    expect(store.getSnapshot().sliceReads.activity).toBe('ok')

    state.errors = { activity: new Error('activity unavailable') }
    state.tables = { ...state.tables, decisions: [] }
    await refresh(store)

    expect(store.getSnapshot().decisions).toEqual([])
    expect(store.getSnapshot().activity.map(row => row.id)).toEqual(['activityA'])
    expect(store.getSnapshot().sliceReads.decisions).toBe('ok')
    expect(store.getSnapshot().sliceReads.activity).toBe('failed')

    state.errors = {}
    state.tables = { ...state.tables, activity: [] }
    await refresh(store)

    expect(store.getSnapshot().decisions).toEqual([])
    expect(store.getSnapshot().activity).toEqual([])
    expect(store.getSnapshot().sliceReads.decisions).toBe('ok')
    expect(store.getSnapshot().sliceReads.activity).toBe('ok')
  })

  it('starts with empty decision and activity rows when both reads fail', async () => {
    const store = await freshStore()
    state.tables = rowsFor('tripA', 'userA')
    state.errors = {
      decisions: new Error('decisions unavailable'),
      activity: new Error('activity unavailable'),
    }
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    expect(store.getSnapshot().decisions).toEqual([])
    expect(store.getSnapshot().activity).toEqual([])
    expect(store.getSnapshot().sliceReads.decisions).toBe('failed')
    expect(store.getSnapshot().sliceReads.activity).toBe('failed')
  })

  it('clears the old account slices when the new account scope fails', async () => {
    const store = await freshStore()
    state.tables = {
      ...rowsFor('tripA', 'userA'),
      decisions: [decisionRow('decisionA', 'tripA', 'userA')],
      activity: [activityRow('activityA', 'tripA', 'userA')],
    }
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    state.tables = rowsFor('tripB', 'userB')
    state.errors = { trip_members: new Error('membership scope unavailable') }
    state.activeUser = 'userB'
    state.sessionUser = 'userB'
    state.authHandler!('SIGNED_IN', { user: { id: 'userB' } })
    await flush()

    expect(store.getSnapshot().sessionUserId).toBe('userB')
    expect(store.getSnapshot().decisions).toEqual([])
    expect(store.getSnapshot().activity).toEqual([])
    expect(store.getSnapshot().sliceReads.decisions).toBe('failed')
    expect(store.getSnapshot().sliceReads.activity).toBe('failed')
  })

  it('keeps decision and activity rows when the same account membership read fails', async () => {
    const store = await freshStore()
    state.tables = {
      ...rowsFor('tripA', 'userA'),
      decisions: [decisionRow('decisionA', 'tripA', 'userA')],
      activity: [activityRow('activityA', 'tripA', 'userA')],
    }
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    state.errors = { trip_members: new Error('membership scope unavailable') }
    await refresh(store)

    expect(store.getSnapshot().decisions.map(row => row.id)).toEqual(['decisionA'])
    expect(store.getSnapshot().activity.map(row => row.id)).toEqual(['activityA'])
    expect(store.getSnapshot().sliceReads.decisions).toBe('failed')
    expect(store.getSnapshot().sliceReads.activity).toBe('failed')
  })

  it('clears old decision and activity rows when both reads fail for a new account', async () => {
    const store = await freshStore()
    state.tables = {
      ...rowsFor('tripA', 'userA'),
      decisions: [decisionRow('decisionA', 'tripA', 'userA')],
      activity: [activityRow('activityA', 'tripA', 'userA')],
    }
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    state.tables = rowsFor('tripB', 'userB')
    state.errors = {
      decisions: new Error('decisions unavailable'),
      activity: new Error('activity unavailable'),
    }
    state.activeUser = 'userB'
    state.sessionUser = 'userB'
    state.authHandler!('SIGNED_IN', { user: { id: 'userB' } })
    await flush()

    expect(store.getSnapshot().sessionUserId).toBe('userB')
    expect(store.getSnapshot().decisions).toEqual([])
    expect(store.getSnapshot().activity).toEqual([])
    expect(store.getSnapshot().sliceReads.decisions).toBe('failed')
    expect(store.getSnapshot().sliceReads.activity).toBe('failed')
  })

  it('keeps admin rows for the same account after resolved read errors', async () => {
    const store = await freshStore()
    state.tables = {
      ...rowsFor('tripA', 'userA'),
      decisions: [decisionRow('decisionA', 'tripA', 'userA')],
      activity: [activityRow('activityA', 'tripA', 'userA')],
    }
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    state.adminUser = 'adminB'
    state.tables = {
      ...rowsFor('tripB', 'adminB'),
      decisions: [decisionRow('decisionB', 'tripB', 'adminB')],
      activity: [activityRow('activityB', 'tripB', 'adminB')],
    }
    state.errors = {
      decisions: new Error('decisions unavailable'),
      activity: new Error('activity unavailable'),
    }
    state.activeUser = 'adminB'
    state.sessionUser = 'adminB'
    state.authHandler!('SIGNED_IN', {
      user: { id: 'adminB', app_metadata: { role: 'masteradmin' } },
    })
    await flush()

    expect(state.queriedTables).toContain('admin_audit')
    expect(store.getSnapshot().sessionUserId).toBe('adminB')
    expect(store.getSnapshot().decisions).toEqual([])
    expect(store.getSnapshot().activity).toEqual([])
    expect(store.getSnapshot().sliceReads.decisions).toBe('failed')
    expect(store.getSnapshot().sliceReads.activity).toBe('failed')

    state.errors = {}
    await refresh(store)
    state.errors = {
      decisions: new Error('decisions unavailable'),
      activity: new Error('activity unavailable'),
    }
    await refresh(store)

    expect(store.getSnapshot().decisions.map(row => row.id)).toEqual(['decisionB'])
    expect(store.getSnapshot().activity.map(row => row.id)).toEqual(['activityB'])
    expect(store.getSnapshot().sliceReads.decisions).toBe('failed')
    expect(store.getSnapshot().sliceReads.activity).toBe('failed')
  })

  it('keeps same-account rows when a query promise rejects', async () => {
    const store = await freshStore()
    state.tables = {
      ...rowsFor('tripA', 'userA'),
      decisions: [decisionRow('decisionA', 'tripA', 'userA')],
      activity: [activityRow('activityA', 'tripA', 'userA')],
    }
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    state.rejects = { decisions: new Error('decisions query rejected') }
    await refresh(store)

    expect(store.getSnapshot().decisions.map(row => row.id)).toEqual(['decisionA'])
    expect(store.getSnapshot().activity.map(row => row.id)).toEqual(['activityA'])
    expect(store.getSnapshot().sliceReads.decisions).toBe('failed')
    expect(store.getSnapshot().sliceReads.activity).toBe('failed')
  })

  it.each([
    { table: 'decisions', admin: false },
    { table: 'decisions', admin: true },
  ])('clears both slices when a new account query rejects at $table', async ({ table, admin }) => {
    const store = await freshStore()
    state.tables = {
      ...rowsFor('tripA', 'userA'),
      decisions: [decisionRow('decisionA', 'tripA', 'userA')],
      activity: [activityRow('activityA', 'tripA', 'userA')],
    }
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    state.tables = rowsFor('tripB', 'userB')
    state.rejects = { [table]: new Error(`${table} query rejected`) }
    state.activeUser = 'userB'
    state.sessionUser = 'userB'
    state.authHandler!('SIGNED_IN', admin
      ? { user: { id: 'userB', app_metadata: { role: 'masteradmin' } } }
      : { user: { id: 'userB' } })
    await flush()

    expect(store.getSnapshot().decisions).toEqual([])
    expect(store.getSnapshot().activity).toEqual([])
    expect(store.getSnapshot().sliceReads.decisions).toBe('failed')
    expect(store.getSnapshot().sliceReads.activity).toBe('failed')
  })

  it('clears the private rows when a new account query rejects at profiles', async () => {
    const store = await freshStore()
    state.tables = {
      ...rowsFor('tripA', 'userA'),
      profiles: [profileRow('userA')],
      suggestions: [suggestionRow('suggestionA', 'tripA', 'userA')],
      notifications: [notificationRow('notificationA', 'tripA', 'userA')],
    }
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()
    expect(store.currentUser(store.getSnapshot())?.id).toBe('userA')

    state.tables = rowsFor('tripB', 'userB')
    state.rejects = { profiles: new Error('profiles query rejected') }
    state.activeUser = 'userB'
    state.sessionUser = 'userB'
    state.authHandler!('SIGNED_IN', { user: { id: 'userB' } })
    await flush()

    // `profiles` is the PRIVATE table now, so its rejection is the self read's
    // own failure — it names its own slice and leaves the run standing, rather
    // than aborting every trip-scoped slice with it.
    expect(store.getSnapshot().sliceReads['self profile']).toBe('failed')
    // The previous account's private row does not survive the switch.
    expect(store.getSnapshot().users).toEqual([])
    expect(store.currentUser(store.getSnapshot())).toBeNull()
  })
})

describe('profile, suggestion, and notification hydration', () => {
  it('keeps same-user rows after failed reads and clears rows after successful empty reads', async () => {
    const store = await freshStore()
    state.tables = {
      ...rowsFor('tripA', 'userA'),
      profiles: [profileRow('userA')],
      suggestions: [suggestionRow('suggestionA', 'tripA', 'userA')],
      notifications: [notificationRow('notificationA', 'tripA', 'userA')],
    }
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    state.errors = {
      profiles: new Error('profiles unavailable'),
      suggestions: new Error('suggestions unavailable'),
      notifications: new Error('notifications unavailable'),
    }
    state.tables = { ...state.tables, profiles: [], suggestions: [], notifications: [] }
    await refresh(store)

    expect(store.getSnapshot().users.map(row => row.id)).toEqual(['userA'])
    expect(store.getSnapshot().suggestions.map(row => row.id)).toEqual(['suggestionA'])
    expect(store.getSnapshot().notifications.map(row => row.id)).toEqual(['notificationA'])
    expect(store.currentUser(store.getSnapshot())?.id).toBe('userA')
    // `profiles` is the PRIVATE table now, so its failure is the self read's own
    // verdict. The public catalogue comes from the RPC and succeeded.
    expect(store.getSnapshot().sliceReads['self profile']).toBe('failed')
    expect(store.getSnapshot().sliceReads.suggestions).toBe('failed')
    expect(store.getSnapshot().sliceReads.notifications).toBe('failed')

    state.errors = {}
    await refresh(store)

    expect(store.getSnapshot().users).toEqual([])
    expect(store.getSnapshot().suggestions).toEqual([])
    expect(store.getSnapshot().notifications).toEqual([])
    expect(store.getSnapshot().sliceReads.profiles).toBe('ok')
    expect(store.getSnapshot().sliceReads.suggestions).toBe('ok')
    expect(store.getSnapshot().sliceReads.notifications).toBe('ok')
  })

  it('does not keep prior-account rows when a new account read fails', async () => {
    const store = await freshStore()
    state.tables = {
      ...rowsFor('tripA', 'userA'),
      profiles: [profileRow('userA')],
      suggestions: [suggestionRow('suggestionA', 'tripA', 'userA')],
      notifications: [notificationRow('notificationA', 'tripA', 'userA')],
    }
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    state.tables = {
      ...rowsFor('tripB', 'userB'),
      profiles: [profileRow('userB')],
      suggestions: [],
      notifications: [],
    }
    state.errors = {
      profiles: new Error('profiles unavailable'),
      suggestions: new Error('suggestions unavailable'),
      notifications: new Error('notifications unavailable'),
    }
    state.activeUser = 'userB'
    state.sessionUser = 'userB'
    state.authHandler!('SIGNED_IN', { user: { id: 'userB' } })
    await flush()

    expect(store.getSnapshot().sessionUserId).toBe('userB')
    expect(store.currentUser(store.getSnapshot())).toBeNull()
    expect(store.getSnapshot().users).toEqual([])
    expect(store.getSnapshot().suggestions).toEqual([])
    expect(store.getSnapshot().notifications).toEqual([])
    // The `profiles` rejection is the new account's own private read failing.
    expect(store.getSnapshot().sliceReads['self profile']).toBe('failed')
    expect(store.getSnapshot().sliceReads.suggestions).toBe('failed')
    expect(store.getSnapshot().sliceReads.notifications).toBe('failed')
  })

  it('publishes the real cold-session id after a rejected first hydrate and retries successfully', async () => {
    const store = await freshStore()
    state.tables = { ...rowsFor('tripA', 'userA'), profiles: [] }
    state.rejects = { profiles: new Error('profiles query rejected') }
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    expect(store.getSnapshot().sessionUserId).toBe('userA')
    expect(store.getSnapshot().sliceReads['self profile']).toBe('failed')
    expect(store.currentUser(store.getSnapshot())).toBeNull()
    // A failed private read is a RECOVERABLE slice failure, not an aborted run —
    // that is the whole point of giving it its own verdict. The session is real,
    // so the channel connects and the authoritative disabled check still runs.
    expect(state.channelNames).toEqual(['yatraflow-live'])

    state.rejects = {}
    state.tables = { ...state.tables, profiles: [profileRow('userA')] }
    await refresh(store)

    expect(store.currentUser(store.getSnapshot())?.id).toBe('userA')
    expect(store.getSnapshot().sliceReads['self profile']).toBe('ok')
    expect(state.channelNames.length).toBeGreaterThan(0)
  })

  it('publishes the real session id after anonymous loading and retries a rejected profile read', async () => {
    const store = await freshStore()
    state.tables = { profiles: [], published_itineraries: [] }
    store.init()
    state.resolveSession!()
    await flush()

    state.rejects = { profiles: new Error('profiles query rejected') }
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    state.authHandler!('SIGNED_IN', { user: { id: 'userA' } })
    await flush()

    expect(store.getSnapshot().sessionUserId).toBe('userA')
    expect(store.getSnapshot().sliceReads['self profile']).toBe('failed')
    expect(store.currentUser(store.getSnapshot())).toBeNull()

    state.rejects = {}
    state.tables = { ...state.tables, profiles: [profileRow('userA')] }
    await refresh(store)

    expect(store.currentUser(store.getSnapshot())?.id).toBe('userA')
    expect(store.getSnapshot().sliceReads['self profile']).toBe('ok')
  })

  it('does not retag a prior owner when a switched-account hydrate rejects', async () => {
    const store = await freshStore()
    state.tables = {
      ...rowsFor('tripA', 'userA'),
      profiles: [profileRow('userA')],
      suggestions: [suggestionRow('suggestionA', 'tripA', 'userA')],
      notifications: [notificationRow('notificationA', 'tripA', 'userA')],
    }
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    // The new account has no trips of its own, and its private read is refused.
    state.tables = rowsFor('tripB', 'userB')
    state.errors = {
      suggestions: new Error('suggestions unavailable'),
      notifications: new Error('notifications unavailable'),
    }
    state.rejects = { profiles: new Error('profiles query rejected') }
    state.activeUser = 'userB'
    state.sessionUser = 'userB'
    state.authHandler!('SIGNED_IN', { user: { id: 'userB' } })
    await flush()

    // The prior owner's rows are gone, and none of them is retagged as userB's.
    expect(store.getSnapshot().sessionUserId).toBe('userB')
    expect(store.currentUser(store.getSnapshot())).toBeNull()
    expect(store.getSnapshot().users).toEqual([])
    expect(store.getSnapshot().suggestions).toEqual([])
    expect(store.getSnapshot().notifications).toEqual([])
    expect(store.getSnapshot().sliceReads['self profile']).toBe('failed')
    expect(store.getSnapshot().sliceReads.suggestions).toBe('failed')
    expect(store.getSnapshot().sliceReads.notifications).toBe('failed')
  })

  it('clears prior-account suggestions and notifications when the new scope fails', async () => {
    const store = await freshStore()
    state.tables = {
      ...rowsFor('tripA', 'userA'),
      profiles: [profileRow('userA')],
      suggestions: [suggestionRow('suggestionA', 'tripA', 'userA')],
      notifications: [notificationRow('notificationA', 'tripA', 'userA')],
    }
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    state.tables = { ...rowsFor('tripB', 'userB'), profiles: [profileRow('userB')] }
    state.errors = { trip_members: new Error('membership scope unavailable') }
    state.activeUser = 'userB'
    state.sessionUser = 'userB'
    state.authHandler!('SIGNED_IN', { user: { id: 'userB' } })
    await flush()

    expect(store.getSnapshot().sessionUserId).toBe('userB')
    expect(store.getSnapshot().suggestions).toEqual([])
    expect(store.getSnapshot().notifications).toEqual([])
    expect(store.getSnapshot().sliceReads.suggestions).toBe('failed')
    expect(store.getSnapshot().sliceReads.notifications).toBe('failed')
  })
})

describe('hydration isolation across sign-out and account switch (#45)', () => {
  it('does not resurrect the signed-out user when hydration resolves after logout', async () => {
    const store = await freshStore()

    state.tables = rowsFor('tripA', 'userA')
    state.activeUser = 'userA'
    const releaseA = gated('userA')

    state.sessionUser = 'userA'
    store.init()
    expect(state.authHandler).toBeTruthy()
    state.resolveSession!()
    await flush()

    // The account's queries are still in flight when it signs out.
    state.authHandler!('SIGNED_OUT', null)
    await flush()
    expect(store.getSnapshot().sessionUserId).toBeNull()

    // The late response must be discarded, not patched into the cleared cache.
    releaseA()
    await flush()

    const db = store.getSnapshot()
    expect(db.sessionUserId).toBeNull()
    expect(db.trips).toHaveLength(0)
    expect(store.tripsForUser('userA')).toHaveLength(0)
  })

  it('keeps the previous account out of the cache when it resolves after a switch', async () => {
    const store = await freshStore()

    state.tables = rowsFor('tripA', 'userA')
    state.activeUser = 'userA'
    const releaseA = gated('userA')

    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    // Switch accounts while userA's queries are still hanging.
    state.tables = rowsFor('tripB', 'userB')
    state.activeUser = 'userB'
    const releaseB = gated('userB')
    state.authHandler!('SIGNED_IN', { user: { id: 'userB' } })
    await flush()

    // The NEW account lands first...
    releaseB()
    await flush()
    expect(store.getSnapshot().sessionUserId).toBe('userB')

    // ...and the OLD account resolves last. Without the generation guard its
    // patch wins here and the cache ends up pointing at userA.
    releaseA()
    await flush()

    const db = store.getSnapshot()
    expect(db.sessionUserId).toBe('userB')
    expect(db.trips.map(t => t.id)).toEqual(['tripB'])
    expect(store.tripsForUser('userA')).toHaveLength(0)
  })

  it('does not restore rows after a late rejected hydrate and logout', async () => {
    const store = await freshStore()
    state.tables = {
      ...rowsFor('tripA', 'userA'),
      decisions: [decisionRow('decisionA', 'tripA', 'userA')],
      activity: [activityRow('activityA', 'tripA', 'userA')],
    }
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    state.rejects = { profiles: new Error('profile query rejected') }
    const releaseA = gated('userA')
    const pending = store.resumeSync()
    state.resolveSession!()
    await flush()

    state.activeUser = null
    state.sessionUser = null
    state.authHandler!('SIGNED_OUT', null)
    await flush()
    expect(store.getSnapshot().sessionUserId).toBeNull()
    expect(store.getSnapshot().decisions).toEqual([])
    expect(store.getSnapshot().activity).toEqual([])

    releaseA()
    await pending

    expect(store.getSnapshot().sessionUserId).toBeNull()
    expect(store.getSnapshot().decisions).toEqual([])
    expect(store.getSnapshot().activity).toEqual([])
  })

  it('keeps the new account rows after a late rejected hydrate', async () => {
    const store = await freshStore()
    state.tables = rowsFor('tripA', 'userA')
    state.rejects = { profiles: new Error('profile query rejected') }
    state.activeUser = 'userA'
    const releaseA = gated('userA')

    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    state.tables = {
      ...rowsFor('tripB', 'userB'),
      decisions: [decisionRow('decisionB', 'tripB', 'userB')],
      activity: [activityRow('activityB', 'tripB', 'userB')],
    }
    state.rejects = {}
    state.activeUser = 'userB'
    const releaseB = gated('userB')
    state.authHandler!('SIGNED_IN', { user: { id: 'userB' } })
    await flush()

    releaseB()
    await flush()
    expect(store.getSnapshot().sessionUserId).toBe('userB')

    releaseA()
    await flush()

    expect(store.getSnapshot().sessionUserId).toBe('userB')
    expect(store.getSnapshot().decisions.map(row => row.id)).toEqual(['decisionB'])
    expect(store.getSnapshot().activity.map(row => row.id)).toEqual(['activityB'])
  })

  it('still hydrates normally on a single uninterrupted sign-in', async () => {
    const store = await freshStore()

    state.tables = rowsFor('tripA', 'userA')
    state.activeUser = 'userA'
    const releaseA = gated('userA')

    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()
    releaseA()
    await flush()

    const db = store.getSnapshot()
    expect(db.sessionUserId).toBe('userA')
    expect(db.trips.map(t => t.id)).toEqual(['tripA'])
  })

  it('hydrates when getSession and onAuthStateChange double-fire for the SAME user', async () => {
    // The refresh-logout bug: on app load BOTH getSession() and
    // onAuthStateChange (INITIAL_SESSION) fire hydrate for the SAME user.
    // The second call used to bump hydrateGen before deduping onto the
    // first call's promise — the first hydrate's patch was then dropped as
    // "stale" (gen superseded) while the second call only awaited it and
    // never patched. Data fetched, nobody wrote it: the app rendered
    // logged-out on every refresh with a perfectly valid token.
    const store = await freshStore()

    state.tables = rowsFor('tripA', 'userA')
    state.activeUser = 'userA'
    const releaseA = gated('userA')

    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()            // getSession → hydrate('userA'), gen 1
    await flush()
    // The double-fire: INITIAL_SESSION for the same user, mid-hydration.
    state.authHandler!('INITIAL_SESSION', { user: { id: 'userA' } })
    await flush()

    releaseA()                          // queries resolve — someone must patch
    await flush()

    const db = store.getSnapshot()
    expect(db.sessionUserId).toBe('userA')
    expect(db.trips.map(t => t.id)).toEqual(['tripA'])
    expect(store.tripsForUser('userA')).toHaveLength(1)
  })
})

describe('deferred account-owned reads', () => {
  const staleReadCases = [
    { slice: 'trash', result: 'success' },
    { slice: 'trash', result: 'error' },
    { slice: 'trash', result: 'reject' },
    { slice: 'audit', result: 'success' },
    { slice: 'audit', result: 'error' },
    { slice: 'audit', result: 'reject' },
  ] as const

  for (const transition of ['switch', 'logout'] as const) {
    it.each(staleReadCases)(
      `drops late $slice $result results after ${transition}`,
      async ({ slice, result }) => {
        const store = await signedInAdminStore()
        const release = slice === 'trash'
          ? gatedRpc('userA', 'get_trashed_trips')
          : gatedQuery('userA', 'admin_audit')
        const failure = new Error(`${slice} read failed`)
        let pending: Promise<void>

        if (slice === 'trash') {
          const key = 'userA:get_trashed_trips'
          state.rpcResponses[key] = result === 'success'
            ? { data: [tripRow('trashA-late', 'userA')], error: null }
            : result === 'error'
              ? { data: [], error: failure }
              : { data: [], error: null, rejection: failure }
          pending = store.fetchTrashedTrips()
        } else {
          state.tables = { ...state.tables, admin_audit: [auditRow('auditA-late', 'userA')] }
          if (result === 'error') state.errors = { admin_audit: failure }
          if (result === 'reject') state.rejects = { admin_audit: failure }
          pending = store.refreshAdminAuditNow()
        }
        await flush()

        if (transition === 'switch') {
          state.tables = {
            ...rowsFor('tripB', 'userB'),
            admin_audit: [auditRow('auditB', 'userB')],
          }
          state.errors = {}
          state.rejects = {}
          state.activeUser = 'userB'
          state.sessionUser = 'userB'
          state.adminUser = 'userB'
          state.authHandler!('SIGNED_IN', {
            user: { id: 'userB', app_metadata: { role: 'masteradmin' } },
          })
        } else {
          state.activeUser = null
          state.sessionUser = null
          state.adminUser = null
          state.errors = {}
          state.rejects = {}
          state.authHandler!('SIGNED_OUT', null)
        }
        await flush()

        let notifications = 0
        const unsubscribe = store.subscribe(() => { notifications += 1 })
        const settledNotifications = notifications
        release()
        await pending
        await flush()

        expect(notifications).toBe(settledNotifications)
        expect(store.getSnapshot().trashedTrips).toEqual([])
        expect(store.getSnapshot().trashFailed).toBe(false)
        if (transition === 'switch') {
          expect(store.getSnapshot().sessionUserId).toBe('userB')
          expect(store.getSnapshot().adminAudit.map(row => row.id)).toEqual(['auditB'])
        } else {
          expect(store.getSnapshot().sessionUserId).toBeNull()
          expect(store.getSnapshot().adminAudit).toEqual([])
        }
        expect(store.getSnapshot().adminAuditFailed).toBe(false)
        unsubscribe()
      },
    )
  }

  it.each(['trash', 'audit'] as const)('applies a delayed same-user %s read', async slice => {
    const store = await signedInAdminStore()
    let release: () => void
    let pending: Promise<void>

    if (slice === 'trash') {
      const key = 'userA:get_trashed_trips'
      state.rpcResponses[key] = { data: [tripRow('trashA-late', 'userA')], error: null }
      release = gatedRpc('userA', 'get_trashed_trips')
      pending = store.fetchTrashedTrips()
    } else {
      state.tables = { ...state.tables, admin_audit: [auditRow('auditA-late', 'userA')] }
      release = gatedQuery('userA', 'admin_audit')
      pending = store.refreshAdminAuditNow()
    }

    await flush()
    release()
    await pending

    if (slice === 'trash') {
      expect(store.getSnapshot().trashedTrips.map(row => row.id)).toEqual(['trashA-late'])
      expect(store.getSnapshot().trashLoaded).toBe(true)
    } else {
      expect(store.getSnapshot().adminAudit.map(row => row.id)).toEqual(['auditA-late'])
      expect(store.getSnapshot().adminAuditFailed).toBe(false)
    }
  })

  it.each(['trash', 'audit'] as const)('lands same-user %s results after a newer hydrate', async slice => {
    const store = await signedInAdminStore()
    let release: () => void
    let pending: Promise<void>

    if (slice === 'trash') {
      const key = 'userA:get_trashed_trips'
      state.rpcResponses[key] = { data: [tripRow('trashA-late', 'userA')], error: null }
      release = gatedRpc('userA', 'get_trashed_trips')
      pending = store.fetchTrashedTrips()
    } else {
      state.tables = { ...state.tables, admin_audit: [auditRow('auditA-late', 'userA')] }
      release = gatedQuery('userA', 'admin_audit')
      pending = store.refreshAdminAuditNow()
    }
    await flush()
    if (slice === 'audit') {
      state.tables = { ...state.tables, admin_audit: [auditRow('auditA', 'userA')] }
    }
    await refresh(store)

    release()
    await pending

    if (slice === 'trash') {
      expect(store.getSnapshot().trashedTrips.map(row => row.id)).toEqual(['trashA-late'])
      expect(store.getSnapshot().trashLoaded).toBe(true)
    } else {
      expect(store.getSnapshot().adminAudit.map(row => row.id)).toEqual(['auditA-late'])
      expect(store.getSnapshot().adminAuditFailed).toBe(false)
    }
  })

  it('never lets late trash rows of the old account reach the new account state or snapshot', async () => {
    const store = await signedInAdminStore()
    state.rpcResponses['userA:get_trashed_trips'] = { data: [tripRow('trashA-late', 'userA')], error: null }
    const releaseTrashA = gatedRpc('userA', 'get_trashed_trips')
    const pendingTrashA = store.fetchTrashedTrips()
    await flush()

    // B hydrates behind a gate while A's trash read is still out.
    state.tables = { ...rowsFor('tripB', 'userB'), admin_audit: [auditRow('auditB', 'userB')] }
    state.activeUser = 'userB'
    state.sessionUser = 'userB'
    state.adminUser = 'userB'
    const releaseB = gated('userB')
    state.authHandler!('SIGNED_IN', {
      user: { id: 'userB', app_metadata: { role: 'masteradmin' } },
    })
    await flush()

    releaseTrashA()
    await pendingTrashA
    await flush()
    expect(store.getSnapshot().trashedTrips).toEqual([])
    expect(store.getSnapshot().trashLoaded).toBe(false)

    releaseB()
    await flush()

    expect(store.getSnapshot().sessionUserId).toBe('userB')
    expect(store.getSnapshot().trashedTrips.map(row => row.id)).not.toContain('trashA-late')
    const snapshotsForB = state.savedSnapshots.filter(snapshot => snapshot.userId === 'userB')
    expect(snapshotsForB.length).toBeGreaterThan(0)
    for (const snapshot of snapshotsForB) {
      expect(snapshot.trashedTripIds).not.toContain('trashA-late')
    }
  })

  it.each(['trash', 'audit'] as const)(
    'lands a same-user %s read that is still in flight when the same account signs in again',
    async slice => {
      const store = await signedInAdminStore()
      let release: () => void
      let pending: Promise<void>

      if (slice === 'trash') {
        state.rpcResponses['userA:get_trashed_trips'] = { data: [tripRow('trashA-late', 'userA')], error: null }
        release = gatedRpc('userA', 'get_trashed_trips')
        pending = store.fetchTrashedTrips()
      } else {
        state.tables = { ...state.tables, admin_audit: [auditRow('auditA-late', 'userA')] }
        release = gatedQuery('userA', 'admin_audit')
        pending = store.refreshAdminAuditNow()
      }
      await flush()

      // A refocus sends SIGNED_IN for the same account while the read is out.
      // Give the newer hydrate other audit rows, so the late read is visible when it lands.
      if (slice === 'audit') {
        state.tables = { ...state.tables, admin_audit: [auditRow('auditA', 'userA')] }
      }
      state.authHandler!('SIGNED_IN', {
        user: { id: 'userA', app_metadata: { role: 'masteradmin' } },
      })
      await flush()

      release()
      await pending
      await flush()

      expect(store.getSnapshot().sessionUserId).toBe('userA')
      if (slice === 'trash') {
        expect(store.getSnapshot().trashedTrips.map(row => row.id)).toEqual(['trashA-late'])
        expect(store.getSnapshot().trashLoaded).toBe(true)
      } else {
        expect(store.getSnapshot().adminAudit.map(row => row.id)).toEqual(['auditA-late'])
        expect(store.getSnapshot().adminAuditFailed).toBe(false)
      }
    },
  )

  it.each(['trash', 'audit'] as const)(
    'drops a %s read that began before logout() when the same account signs in again',
    async slice => {
      const store = await signedInAdminStore()
      let release: () => void
      let pending: Promise<void>

      if (slice === 'trash') {
        state.rpcResponses['userA:get_trashed_trips'] = { data: [tripRow('trashA-late', 'userA')], error: null }
        release = gatedRpc('userA', 'get_trashed_trips')
        pending = store.fetchTrashedTrips()
      } else {
        state.tables = { ...state.tables, admin_audit: [auditRow('auditA-late', 'userA')] }
        release = gatedQuery('userA', 'admin_audit')
        pending = store.refreshAdminAuditNow()
      }
      await flush()

      // logout() runs, then the same account signs in again. Here sessionUserId is
      // userA again, so only the identity epoch can tell the old read from a new one.
      await store.logout()
      state.activeUser = 'userA'
      state.sessionUser = 'userA'
      state.adminUser = 'userA'
      state.tables = { ...state.tables, admin_audit: [auditRow('auditA', 'userA')] }
      state.authHandler!('SIGNED_IN', {
        user: { id: 'userA', app_metadata: { role: 'masteradmin' } },
      })
      await flush()

      release()
      await pending
      await flush()

      expect(store.getSnapshot().trashedTrips.map(row => row.id)).not.toContain('trashA-late')
      expect(store.getSnapshot().adminAudit.map(row => row.id)).not.toContain('auditA-late')
    },
  )

  it('clears old account rows before B hydration and omits them from B snapshots', async () => {
    const store = await signedInAdminStore()
    state.rpcResponses['userA:get_trashed_trips'] = {
      data: [tripRow('trashA', 'userA')], error: null,
    }
    await store.fetchTrashedTrips()
    state.errors = { admin_audit: new Error('audit unavailable') }
    await store.refreshAdminAuditNow()
    expect(store.getSnapshot().adminAuditFailed).toBe(true)
    expect(store.getSnapshot().trashedTrips.map(row => row.id)).toEqual(['trashA'])

    state.errors = {}
    state.tables = {
      ...rowsFor('tripB', 'userB'),
      admin_audit: [auditRow('auditB', 'userB')],
    }
    state.activeUser = 'userB'
    state.sessionUser = 'userB'
    state.adminUser = 'userB'
    const releaseB = gated('userB')
    state.authHandler!('SIGNED_IN', {
      user: { id: 'userB', app_metadata: { role: 'masteradmin' } },
    })

    expect(store.getSnapshot().trashedTrips).toEqual([])
    expect(store.getSnapshot().trashLoaded).toBe(false)
    expect(store.getSnapshot().trashFailed).toBe(false)
    expect(store.getSnapshot().adminAudit).toEqual([])
    expect(store.getSnapshot().adminAuditFailed).toBe(false)

    releaseB()
    await flush()

    const snapshotsForB = state.savedSnapshots.filter(snapshot => snapshot.userId === 'userB')
    expect(snapshotsForB.length).toBeGreaterThan(0)
    expect(snapshotsForB[snapshotsForB.length - 1]?.trashedTripIds).not.toContain('trashA')
  })

  it('does not request admin audit while logout is waiting for sign-out', async () => {
    const store = await signedInAdminStore()
    const adminSession = await import('../src/lib/adminSession')
    state.holdSignOut = true
    const beforeReads = state.queriedTables.filter(table => table === 'admin_audit').length
    const pendingLogout = store.logout()
    expect(store.getSnapshot().sessionUserId).toBeNull()
    adminSession.setAdminForTest(true)

    let notifications = 0
    const unsubscribe = store.subscribe(() => { notifications += 1 })
    await store.refreshAdminAuditNow()

    expect(state.queriedTables.filter(table => table === 'admin_audit')).toHaveLength(beforeReads)
    expect(notifications).toBe(0)
    state.resolveSignOut!()
    await pendingLogout
    unsubscribe()
  })

  it('clears the old admin role at logout start and keeps a fresh role', async () => {
    const store = await signedInAdminStore()
    const adminSession = await import('../src/lib/adminSession')
    expect(adminSession.isAdminCached()).toBe(true)

    state.holdSignOut = true
    const pendingLogout = store.logout()
    expect(adminSession.isAdminCached()).toBe(false)

    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    state.adminUser = 'userA'
    state.authHandler!('SIGNED_IN', {
      user: { id: 'userA', app_metadata: { role: 'masteradmin' } },
    })
    await flush()

    expect(store.getSnapshot().sessionUserId).toBe('userA')
    expect(adminSession.isAdminCached()).toBe(true)
    state.resolveSignOut!()
    await pendingLogout

    expect(adminSession.isAdminCached()).toBe(true)
  })

  it.each(['success', 'failure'] as const)(
    'does not publish a late %s hydrate after logout starts without an auth event',
    async result => {
      const store = await signedInAdminStore()
      const release = gatedQuery('userA', 'profiles')
      if (result === 'failure') state.rejects = { profiles: new Error('profile query rejected') }
      const pendingHydrate = store.resumeSync()
      state.resolveSession!()
      await flush()

      state.holdSignOut = true
      const pendingLogout = store.logout()
      expect(store.getSnapshot().sessionUserId).toBeNull()

      let staleIdentityRestored = false
      const unsubscribe = store.subscribe(() => {
        const snapshot = store.getSnapshot()
        if (snapshot.sessionUserId === 'userA' || snapshot.trips.length > 0) staleIdentityRestored = true
      })
      release()
      await pendingHydrate
      await flush()

      expect(store.getSnapshot().sessionUserId).toBeNull()
      expect(store.getSnapshot().trips).toEqual([])
      expect(staleIdentityRestored).toBe(false)
      state.resolveSignOut!()
      await pendingLogout
      unsubscribe()
    },
  )

  it('starts a fresh same-user hydrate after logout invalidates the old run', async () => {
    const store = await freshStore()
    state.tables = rowsFor('tripA', 'userA')
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    const releaseOld = gatedQuery('userA', 'profiles')
    state.authHandler!('SIGNED_IN', { user: { id: 'userA' } })
    await flush()

    state.holdSignOut = true
    const pendingLogout = store.logout()

    state.tables = rowsFor('recoveredTrip', 'userA')
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    const profileReadsBeforeSignIn = state.queriedTables.filter(table => table === 'profiles').length
    state.authHandler!('SIGNED_IN', { user: { id: 'userA' } })
    await flush()
    const profileReadsAfterSignIn = state.queriedTables.filter(table => table === 'profiles').length
    const sessionBeforeOldResponse = store.getSnapshot().sessionUserId
    const tripsBeforeOldResponse = store.getSnapshot().trips.map(trip => trip.id)

    releaseOld()
    await flush()
    state.resolveSignOut!()
    await pendingLogout

    expect(profileReadsAfterSignIn).toBeGreaterThan(profileReadsBeforeSignIn)
    expect(sessionBeforeOldResponse).toBe('userA')
    expect(tripsBeforeOldResponse).toEqual(['recoveredTrip'])
    expect(store.getSnapshot().sessionUserId).toBe('userA')
    expect(store.getSnapshot().trips.map(trip => trip.id)).toEqual(['recoveredTrip'])
  })

  it('keeps the fresh same-user hydrate active when an obsolete run settles', async () => {
    const store = await freshStore()
    state.tables = rowsFor('tripA', 'userA')
    state.activeUser = 'userA'
    state.sessionUser = 'userA'
    store.init()
    state.resolveSession!()
    await flush()

    const releaseOld = gatedQuery('userA', 'profiles')
    state.authHandler!('SIGNED_IN', { user: { id: 'userA' } })
    await flush()

    state.holdSignOut = true
    const pendingLogout = store.logout()
    const releaseFresh = gatedQuery('userA', 'profiles')
    state.tables = rowsFor('freshTrip', 'userA')
    state.sessionUser = 'userA'
    state.activeUser = 'userA'
    state.authHandler!('SIGNED_IN', { user: { id: 'userA' } })
    await flush()

    releaseOld()
    await flush()

    const profileReadsBeforeDuplicate = state.queriedTables.filter(table => table === 'profiles').length
    state.authHandler!('INITIAL_SESSION', { user: { id: 'userA' } })
    await flush()
    const profileReadsAfterDuplicate = state.queriedTables.filter(table => table === 'profiles').length

    releaseFresh()
    await flush()
    state.resolveSignOut!()
    await pendingLogout

    expect(profileReadsAfterDuplicate).toBe(profileReadsBeforeDuplicate)
    expect(store.getSnapshot().sessionUserId).toBe('userA')
    expect(store.getSnapshot().trips.map(trip => trip.id)).toEqual(['freshTrip'])
  })
})
