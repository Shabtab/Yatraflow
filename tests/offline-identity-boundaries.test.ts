import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TripRow } from '../src/lib/tripRow'

type Channel = {
  handlers: Record<string, (payload: unknown) => void>
  status: (status: string) => void
}

const { state } = vi.hoisted(() => ({
  state: {
    currentUser: null as string | null,
    initialUser: null as string | null,
    authHandler: null as ((event: string, session: unknown) => void) | null,
    tables: {} as Record<string, Record<string, unknown[]>>,
    gates: {} as Record<string, Promise<void>>,
    rejects: {} as Record<string, unknown>,
    reads: [] as Array<{ user: string | null; table: string }>,
    channels: [] as Channel[],
    snapshotLoads: [] as string[],
    snapshots: {} as Record<string, Array<Promise<unknown>>>,
  },
}))

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
  loadSnapshot: vi.fn((userId: string) => {
    state.snapshotLoads.push(userId)
    return state.snapshots[userId]?.shift() ?? Promise.resolve(null)
  }),
}))

vi.mock('../src/lib/supabase', () => {
  const builderFor = (table: string) => {
    const user = state.currentUser
    const key = `${user ?? 'anon'}:${table}`
    const rows = state.tables[user ?? 'anon']?.[table] ?? []
    const gate = state.gates[key] ?? Promise.resolve()
    const rejection = state.rejects[key]
    let single = false
    const builder: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'is', 'limit', 'order', 'insert', 'update', 'delete', 'upsert']) {
      builder[method] = () => builder
    }
    builder.maybeSingle = () => { single = true; return builder }
    builder.single = () => { single = true; return builder }
    builder.then = (resolve: (result: unknown) => unknown, reject?: (error: unknown) => unknown) => {
      state.reads.push({ user, table })
      return gate.then(() => {
        if (rejection) throw rejection
        return { data: single ? rows[0] ?? null : rows, error: null }
      }).then(resolve, reject)
    }
    return builder
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: builderFor,
      rpc: async () => ({ data: [], error: null }),
      channel: () => {
        const record: Channel = { handlers: {}, status: () => {} }
        state.channels.push(record)
        const channel = {
          on: (_event: string, filter: { table: string }, callback: (payload: unknown) => void) => {
            record.handlers[filter.table] = callback
            return channel
          },
          subscribe: (callback: (status: string) => void) => {
            record.status = callback
            return channel
          },
        }
        return channel
      },
      removeChannel: async () => undefined,
      auth: {
        getSession: () => Promise.resolve({ data: { session: state.initialUser ? { user: { id: state.initialUser } } : null } }),
        onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
          state.authHandler = callback
          return { data: { subscription: {} } }
        },
        signOut: async () => ({ error: null }),
      },
    },
  }
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function tripRow(id: string, owner: string): TripRow {
  return {
    id, owner_id: owner, name: `Plan ${id}`, start_location: 'Kochi',
    start_location_coords: null, destinations: ['Kochi'], destination_coords: null,
    start_date: '2026-10-01', end_date: '2026-10-03', travellers: 2, transport_mode: 'car',
    budget_per_person_inr: 5000, travel_style: 'balanced', fixed_commitments: [],
    days: [], expenses: [], cover_emoji: '🧭', visibility: 'private', created_at: 1, updated_at: 1,
  }
}

function rowsFor(user: string) {
  const trip = `trip-${user}`
  return {
    profiles: [], published_itineraries: [], trips: [tripRow(trip, user)],
    trip_members: [{ trip_id: trip, user_id: user, role: 'owner', joined_at: 1 }],
    suggestions: [{
      id: `suggestion-${user}`, trip_id: trip, day_index: 0, proposed_by: user,
      title: 'Fort', category: 'sightseeing', location_name: 'Fort', lat: 10, lng: 76,
      description: '', visit_minutes: 30, votes: [], comments: [], status: 'open', created_at: 1,
    }],
    decisions: [{
      id: `decision-${user}`, trip_id: trip, created_by: user, question: 'When?',
      options: [], votes: {}, comments: [], status: 'open', created_at: 1,
    }],
    activity: [{ id: `activity-${user}`, trip_id: trip, actor_id: user, verb: 'added a stop', target: null, at: 1 }],
    notifications: [{ id: `notification-${user}`, trip_id: trip, user_id: user, text: 'Changed', read: false, at: 1 }],
  }
}

async function flush() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

async function freshStore(user: string | null = 'A') {
  vi.resetModules()
  state.currentUser = user
  state.initialUser = user
  const store = await import('../src/store/store')
  store.init()
  await flush()
  return store
}

function signIn(user: string | null) {
  state.currentUser = user
  state.authHandler!(user ? 'SIGNED_IN' : 'SIGNED_OUT', user ? { user: { id: user } } : null)
}

function event(row: unknown, eventType = 'INSERT') {
  return { eventType, new: row, old: {} }
}

beforeEach(() => {
  state.currentUser = null
  state.initialUser = null
  state.authHandler = null
  state.tables = { A: rowsFor('A'), B: rowsFor('B'), anon: {} }
  state.gates = {}
  state.rejects = {}
  state.reads = []
  state.channels = []
  state.snapshotLoads = []
  state.snapshots = {}
})

describe('offline work respects account boundaries', () => {
  it('clears every private slice before the next account read settles', async () => {
    const store = await freshStore()
    const gate = deferred<void>()
    state.gates['B:profiles'] = gate.promise
    signIn('B')
    try {
      const current = store.getSnapshot()
      for (const key of ['trips', 'suggestions', 'decisions', 'activity', 'notifications'] as const) {
        expect(current[key], `${key} must leave with account A`).toEqual([])
      }
      expect(current.sessionUserId).not.toBe('A')
    } finally {
      gate.resolve()
      await flush()
    }
  })

  it.each(['resolve', 'reject'] as const)('ignores an obsolete anonymous hydrate that will %s', async result => {
    const gate = deferred<void>()
    state.gates['anon:profiles'] = gate.promise
    if (result === 'reject') state.rejects['anon:profiles'] = new Error('old anonymous read failed')
    const store = await freshStore(null)
    signIn('B')
    await flush()
    expect(store.getSnapshot().sessionUserId).toBe('B')
    gate.resolve()
    await flush()
    expect(store.getSnapshot().sessionUserId).toBe('B')
    expect(store.getSnapshot().trips.map(row => row.id)).toEqual(['trip-B'])
  })

  it('shares a cold snapshot read between initial events for the same account', async () => {
    const snapshot = deferred<unknown>()
    state.snapshots.A = [snapshot.promise]
    const store = await freshStore()
    signIn('A')
    try {
      expect(state.snapshotLoads).toEqual(['A'])
    } finally {
      snapshot.resolve(null)
      await flush()
    }
    expect(store.getSnapshot().sessionUserId).toBe('A')
  })

  it('starts a fresh A run after A to B to A during a cold snapshot read', async () => {
    const oldA = deferred<void>()
    const snapshotB = deferred<unknown>()
    state.gates['A:profiles'] = oldA.promise
    const store = await freshStore()
    state.snapshots.B = [snapshotB.promise]
    signIn('B')
    delete state.gates['A:profiles']
    signIn('A')
    await flush()
    oldA.resolve()
    await flush()
    snapshotB.resolve(null)
    await flush()
    expect(store.getSnapshot().sessionUserId).toBe('A')
    expect(store.getSnapshot().trips.map(row => row.id)).toEqual(['trip-A'])
  })

  it.each(['switch', 'logout'] as const)('rejects old channel deliveries after %s', async transition => {
    const store = await freshStore()
    const oldChannel = state.channels[0]
    expect(oldChannel).toBeDefined()
    if (transition === 'logout') await store.logout()
    else { signIn('B'); await flush() }
    oldChannel.handlers.trips(event(tripRow('late-A', 'A')))
    oldChannel.handlers.suggestions(event(rowsFor('A').suggestions[0]))
    oldChannel.handlers.notifications(event(rowsFor('A').notifications[0]))
    const current = store.getSnapshot()
    expect(current.trips.map(row => row.id)).not.toContain('late-A')
    expect(current.suggestions.map(row => row.id)).not.toContain('suggestion-A')
    expect(current.notifications.map(row => row.id)).not.toContain('notification-A')
  })

  it('rejects a reconnect result from an account that has left', async () => {
    const store = await freshStore()
    const oldChannel = state.channels[0]
    const gate = deferred<void>()
    state.gates['A:trips'] = gate.promise
    state.tables.A.trips = [tripRow('late-reconnect-A', 'A')]
    oldChannel.status('SUBSCRIBED')
    oldChannel.status('SUBSCRIBED')
    await flush()
    signIn('B')
    await flush()
    gate.resolve()
    await flush()
    expect(store.getSnapshot().sessionUserId).toBe('B')
    expect(store.getSnapshot().trips.map(row => row.id)).toEqual(['trip-B'])
  })

  it('rejects a membership-triggered fetch after its account leaves', async () => {
    const store = await freshStore()
    const oldChannel = state.channels[0]
    const gate = deferred<void>()
    state.gates['A:trips'] = gate.promise
    state.tables.A.trips = [tripRow('late-membership-A', 'A')]
    oldChannel.handlers.trip_members(event({
      trip_id: 'late-membership-A', user_id: 'A', role: 'editor', joined_at: 1,
    }))
    await flush()
    signIn('B')
    await flush()
    gate.resolve()
    await flush()
    expect(store.getSnapshot().sessionUserId).toBe('B')
    expect(store.getSnapshot().trips.map(row => row.id)).toEqual(['trip-B'])
  })
})
