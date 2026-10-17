import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueuedWrite, WriteQueueStore } from '../src/lib/writeQueue'
import type { TripRow } from '../src/lib/tripRow'

type Row = Record<string, unknown>
type Operation = { table: string; method: string; actor: string | null; filters: Record<string, unknown>; payload?: Row }

const { state } = vi.hoisted(() => ({ state: {
  actor: 'A' as string | null,
  rows: new Map<string, Row>(),
  members: [] as Row[],
  disk: new Map<string, QueuedWrite>(),
  operations: [] as Operation[],
  writes: [] as Operation[],
  committed: 0,
  failures: 0,
  offlineReads: false,
  response: 'normal' as 'normal' | 'missing' | 'wrong-id' | 'same-version',
  queueGate: null as Promise<void> | null,
  memberGate: null as Promise<void> | null,
  readGate: null as Promise<void> | null,
  optionalGate: null as Promise<void> | null,
  updateGate: null as Promise<void> | null,
  tokenGate: null as Promise<void> | null,
  beforeUpdate: null as (() => void) | null,
  authHandler: null as ((event: string, session: unknown) => void) | null,
} }))

vi.mock('../src/components/ui', () => ({ toast: vi.fn() }))
vi.mock('../src/lib/tripDna', () => ({ attachDnaAccount: vi.fn(), detachDnaAccount: vi.fn() }))
vi.mock('../src/lib/createEvents', () => ({ backfillCreateFunnelSession: vi.fn() }))
vi.mock('../src/lib/offlineCache', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/offlineCache')>(),
  loadSnapshot: vi.fn(async () => null),
  saveSnapshot: vi.fn(async () => true),
  clearSnapshot: vi.fn(async () => undefined),
}))

// Only storage is replaced. Queue generations, serialization, and retry rules run unchanged.
vi.mock('../src/lib/writeQueue', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/lib/writeQueue')>()
  const matches = (entry: QueuedWrite | undefined, at: number, revision?: string) => !!entry
    && (entry.revision !== undefined || revision !== undefined ? entry.revision === revision : entry.capturedAt === at)
  const memory: WriteQueueStore = {
    list: async () => {
      const rows = structuredClone([...state.disk.values()])
      await state.queueGate
      return rows
    },
    put: async entry => { state.disk.set(actual.writeQueueKey(entry.ownerId, entry.tripId), structuredClone(entry)) },
    remove: async key => { state.disk.delete(key) },
    removeIf: async (key, at, revision, owner) => {
      const entry = state.disk.get(key)
      if (!matches(entry, at, revision) || (owner !== undefined && entry?.ownerId !== owner)) return false
      state.disk.delete(key)
      return true
    },
    putIf: async (entry, at, revision) => {
      const key = actual.writeQueueKey(entry.ownerId, entry.tripId)
      if (!matches(state.disk.get(key), at, revision)) return false
      state.disk.set(key, structuredClone(entry))
      return true
    },
  }
  return {
    ...actual,
    queueWrite: (entry: QueuedWrite) => actual.queueWrite(entry, memory),
    pendingWrites: () => actual.pendingWrites(memory),
    pendingWriteCount: (owner?: string) => actual.pendingWriteCount(owner, memory),
    clearWritesFor: (owner: string) => actual.clearWritesFor(owner, memory),
    dropQueuedWrite: (entry: QueuedWrite) => actual.dropQueuedWrite(entry, memory),
    requeueIfCurrent: (entry: QueuedWrite) => actual.requeueIfCurrent(entry, memory),
  }
})

vi.mock('../src/lib/supabase', () => {
  const query = (table: string) => {
    let method = 'select'
    let selection = '*'
    let payload: Row | undefined
    const headers: Record<string, string> = {}
    let one = false
    let promise: Promise<{ data: unknown; error: unknown; count?: number }> | undefined
    const filters: Record<string, unknown> = {}
    const builder: Record<string, unknown> = {}
    builder.select = (columns = '*') => { selection = columns; return builder }
    builder.update = (row: Row) => { method = 'update'; payload = structuredClone(row); return builder }
    builder.insert = () => { method = 'insert'; return builder }
    builder.delete = () => { method = 'delete'; return builder }
    builder.eq = (key: string, value: unknown) => { filters[key] = value; return builder }
    builder.setHeader = (key: string, value: string) => { headers[key.toLowerCase()] = value; return builder }
    builder.in = (key: string, value: unknown) => { filters[key] = value; return builder }
    builder.is = (key: string, value: unknown) => { filters[key] = value; return builder }
    for (const method of ['limit', 'order']) builder[method] = () => builder
    builder.maybeSingle = builder.single = () => { one = true; return builder }
    builder.then = (resolve: (result: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      // Requests start when awaited, like PostgREST. RLS uses that request's actor.
      if (!promise) {
        promise = (async () => {
          // The real SDK can wait for an auth lock before starting fetch.
          // A request-bound token must survive a later account switch.
          if (method === 'update') await state.tokenGate
          const token = headers.authorization?.replace(/^Bearer /, '')
          const actor = token?.startsWith('token-') ? token.slice('token-'.length) : state.actor
          const operation = { table, method, actor, filters: { ...filters }, payload }
          state.operations.push(operation)
          if (method === 'select' && state.offlineReads) return { data: null, error: { message: 'Offline fixture' } }
          if (table === 'trips' && method === 'update') {
            state.writes.push(operation)
            await state.updateGate
            state.beforeUpdate?.()
            state.beforeUpdate = null
            if (state.failures > 0) {
              state.failures -= 1
              return { data: null, error: { message: 'transient connection failure' } }
            }
            const row = state.rows.get(String(filters.id))
            const member = state.members.find(m => m.trip_id === filters.id && m.user_id === actor)
            if (!member || !['owner', 'editor'].includes(String(member.role))) {
              return { data: null, error: { code: '42501', message: 'permission denied' } }
            }
            if (!row || (filters.write_version !== undefined && row.write_version !== filters.write_version)) return { data: [], error: null, count: 0 }
            const version = Number(row.write_version) + 1
            state.rows.set(String(row.id), { ...row, ...payload, write_version: version, updated_at: Date.now() })
            state.committed += 1
            if (state.response === 'missing') return { data: null, error: null, count: 1 }
            if (selection === '*') return { data: [structuredClone(state.rows.get(String(row.id)))], error: null, count: 1 }
            return { data: [{ id: state.response === 'wrong-id' ? 'another-trip' : row.id,
              write_version: state.response === 'same-version' ? filters.write_version : version, updated_at: Date.now() }],
              error: null, count: 1 }
          }
          if (method !== 'select') return { data: null, error: null }
          const optional = table === 'trips' && selection !== '*' && !('id' in filters)
          const allowedIds = state.members.filter(m => m.user_id === actor).map(m => m.trip_id)
          let rows: Row[] = table === 'trips' ? [...state.rows.values()].filter(r => allowedIds.includes(r.id))
            : table === 'trip_members' ? state.members.filter(r => allowedIds.includes(r.trip_id)) : []
          rows = rows.filter(row => Object.entries(filters).every(([key, value]) =>
            Array.isArray(value) ? value.includes(row[key]) : row[key] === value))
          const copy = structuredClone(rows)
          // Hold the response, not the query snapshot. Delayed reads can be stale.
          if (optional) await state.optionalGate
          else if (table === 'trips') await state.readGate
          else if (table === 'trip_members') await state.memberGate
          return { data: one ? copy[0] ?? null : copy, error: null }
        })()
      }
      return promise.then(resolve, reject)
    }
    return builder
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: query,
      rpc: async () => ({ data: [], error: null }),
      channel: () => {
        const channel = { on: () => channel, subscribe: () => channel }
        return channel
      },
      removeChannel: async () => undefined,
      auth: {
        getSession: async () => ({ data: { session: state.actor ? { user: { id: state.actor }, access_token: `token-${state.actor}` } : null } }),
        onAuthStateChange: (handler: typeof state.authHandler) => {
          state.authHandler = handler
          return { data: { subscription: {} } }
        },
        signOut: async () => ({ error: null }),
      },
    },
  }
})

function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

async function flush() {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

function row(id = 'shared', owner = 'A'): TripRow {
  return {
    id, owner_id: owner, name: 'Original plan', start_location: 'Kochi', start_location_coords: null,
    destinations: ['Kochi'], destination_coords: null, start_date: '2026-10-01', end_date: '2026-10-01',
    travellers: 2, transport_mode: 'car', budget_per_person_inr: 5000, travel_style: 'balanced',
    fixed_commitments: [], days: [{ index: 0, stops: [
      { id: 'keep', title: 'Fort', category: 'sightseeing', locationName: 'Fort', lat: 10, lng: 76,
        visitMinutes: 30, entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'must-do', status: 'confirmed', orderInDay: 0 },
      { id: 'delete', title: 'Museum', category: 'sightseeing', locationName: 'Museum', lat: 10, lng: 76,
        visitMinutes: 30, entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'must-do', status: 'confirmed', orderInDay: 1 },
    ] }], expenses: [], cover_emoji: '🧭', visibility: 'private', invite_code: null, created_at: 1, updated_at: 1, write_version: 0,
  }
}

async function fresh(bootstrap = false) {
  vi.resetModules()
  const store = await import('../src/store/store')
  store._setTripWriteDebounceMs(0)
  if (bootstrap) {
    store.init()
    await flush()
  } else {
    const { rowToTrip } = await import('../src/lib/tripRow')
    store.getSnapshot().sessionUserId = state.actor
    store.getSnapshot().trips = [...state.rows.values()].map(r => rowToTrip(r as unknown as TripRow,
      state.members.filter(m => m.trip_id === r.id).map(m => ({ userId: String(m.user_id), role: m.role as 'owner', joinedAt: 1 }))))
  }
  return store
}

async function pending() { return (await import('../src/lib/writeQueue')).pendingWrites() }
async function capture(store: Awaited<ReturnType<typeof fresh>>, name = 'My offline plan') {
  store.updateTrip('shared', { name })
  await store.tripWriteVerdict('shared')
  await flush()
  return (await pending())[0]
}

beforeEach(() => {
  state.actor = 'A'
  state.rows = new Map([['shared', row() as unknown as Row]])
  state.members = [{ trip_id: 'shared', user_id: 'A', role: 'owner', joined_at: 1 },
    { trip_id: 'shared', user_id: 'C', role: 'editor', joined_at: 1 }]
  state.disk = new Map()
  state.operations = []
  state.writes = []
  state.committed = 0
  state.failures = 0
  state.offlineReads = false
  state.response = 'normal'
  state.queueGate = state.memberGate = state.readGate = state.optionalGate = state.updateGate = state.tokenGate = null
  state.beforeUpdate = null
  state.authHandler = null
  vi.stubGlobal('navigator', { onLine: false })
  vi.clearAllMocks()
})

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('#783 offline replay protocol', () => {
  it('survives restart with the latest offline snapshot and never resurrects a deleted stop', async () => {
    const first = await fresh()
    first.updateStop('shared', 'keep', { visitMinutes: 90 })
    first.deleteStop('shared', 'delete')
    await capture(first, 'Latest local plan')
    expect(await pending()).toHaveLength(1)
    expect(state.writes).toEqual([])

    const restarted = await fresh(true)
    const restored = restarted.getSnapshot().trips[0]
    expect(restored.name).toBe('Latest local plan')
    expect(restored.days[0].stops.map(stop => stop.id)).toEqual(['keep'])
    expect(restored.days[0].stops[0].visitMinutes).toBe(90)
    vi.stubGlobal('navigator', { onLine: true })
    expect(await restarted.replayQueuedWrites()).toBe(1)
    expect(state.committed).toBe(1)
    expect(state.rows.get('shared')?.name).toBe('Latest local plan')
    expect((state.rows.get('shared')?.days as Array<{ stops: Array<{ id: string }> }>)[0].stops.map(stop => stop.id)).toEqual(['keep'])
    expect(await pending()).toEqual([])
  })

  it('pauses before UPDATE when a collaborator changed the captured server revision', async () => {
    const store = await fresh()
    const edit = await capture(store)
    Object.assign(state.rows.get('shared')!, { name: 'Collaborator plan', write_version: 1 })
    vi.stubGlobal('navigator', { onLine: true })
    expect(await store.replayQueuedWrites()).toBe(0)
    expect(state.writes).toEqual([])
    expect(state.rows.get('shared')?.name).toBe('Collaborator plan')
    expect(await pending()).toEqual([expect.objectContaining({ revision: edit.revision, state: 'conflict', attempts: 0 })])
    expect(store.getSnapshot().trips[0].name).toBe('My offline plan')
  })

  it('keeps later local edits paused until the traveler resolves the original conflict', async () => {
    const store = await fresh()
    await capture(store)
    Object.assign(state.rows.get('shared')!, { name: 'Collaborator plan', write_version: 1 })
    vi.stubGlobal('navigator', { onLine: true })
    await store.replayQueuedWrites()
    await capture(store, 'Newer local proposal')
    expect((await pending())[0]).toMatchObject({ state: 'conflict', trip: expect.objectContaining({ name: 'Newer local proposal' }) })
    expect(state.writes).toEqual([])
    expect(await store.resolveQueuedTripWrite('shared', 'replace')).toBe(true)
    expect(state.rows.get('shared')?.name).toBe('Newer local proposal')
  })

  it('shares overlapping reconnect replays without duplicate writes', async () => {
    const store = await fresh()
    await capture(store)
    const hold = gate()
    state.updateGate = hold.promise
    vi.stubGlobal('navigator', { onLine: true })
    const first = store.replayQueuedWrites()
    const second = store.replayQueuedWrites()
    await flush()
    expect(state.writes).toHaveLength(1)
    hold.release()
    expect(await first).toBe(1)
    expect(await second).toBe(1)
    expect(state.committed).toBe(1)
    expect(await pending()).toEqual([])
  })

  it('preserves the server owner when an editor replays their own queue slot', async () => {
    Object.assign(state.rows.get('shared')!, { owner_id: 'C' })
    state.members = state.members.map(member => ({ ...member, role: member.user_id === 'A' ? 'editor' : 'owner' }))
    const store = await fresh()
    expect((await capture(store)).ownerId).toBe('A')
    vi.stubGlobal('navigator', { onLine: true })
    expect(await store.replayQueuedWrites()).toBe(1)
    expect(state.writes[0].payload?.owner_id).toBe('C')
    expect(state.rows.get('shared')?.owner_id).toBe('C')
  })

  it('closes the read-to-update race with a write_version predicate', async () => {
    const store = await fresh()
    await capture(store)
    state.beforeUpdate = () => Object.assign(state.rows.get('shared')!, { name: 'Concurrent winner', write_version: 1 })
    vi.stubGlobal('navigator', { onLine: true })
    expect(await store.replayQueuedWrites()).toBe(0)
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0].filters).toEqual({ id: 'shared', write_version: 0 })
    expect(state.committed).toBe(0)
    expect(state.rows.get('shared')?.name).toBe('Concurrent winner')
    expect((await pending())[0].state).toBe('conflict')
  })

  it('replaces only after an explicit choice and takes the current server revision', async () => {
    const store = await fresh()
    await capture(store)
    Object.assign(state.rows.get('shared')!, { name: 'Shared revision', write_version: 4 })
    vi.stubGlobal('navigator', { onLine: true })
    await store.replayQueuedWrites()
    expect(await store.resolveQueuedTripWrite('shared', 'retry')).toBe(false)
    expect(state.writes).toHaveLength(0)
    expect(await store.resolveQueuedTripWrite('shared', 'replace')).toBe(true)
    expect(state.writes[0].filters.write_version).toBe(4)
    expect(state.rows.get('shared')?.write_version).toBe(5)
    expect(state.rows.get('shared')?.name).toBe('My offline plan')
    expect(await pending()).toEqual([])
  })

  it('discards only the local payload and reloads the shared row without UPDATE', async () => {
    const store = await fresh()
    await capture(store)
    Object.assign(state.rows.get('shared')!, { name: 'Keep shared plan', write_version: 2 })
    expect(await store.resolveQueuedTripWrite('shared', 'discard')).toBe(true)
    expect(store.getSnapshot().trips[0].name).toBe('Keep shared plan')
    expect(store.getSnapshot().trips[0].writeVersion).toBe(2)
    expect(await pending()).toEqual([])
    expect(state.writes).toEqual([])
  })

  it.each(['discard', 'replace'] as const)('does not %s a newer local edit captured while the shared copy is loading', async choice => {
    const store = await fresh()
    await capture(store, 'Earlier pending edit')
    const hold = gate()
    state.readGate = hold.promise
    const recovery = store.resolveQueuedTripWrite('shared', choice)
    await flush()
    store.updateTrip('shared', { name: 'Keep this newer edit' })
    const newerVerdict = store.tripWriteVerdict('shared')
    await flush()
    const newer = (await pending())[0]
    hold.release()
    expect(await recovery).toBe(false)
    await newerVerdict
    expect(store.getSnapshot().trips[0].name).toBe('Keep this newer edit')
    expect(await pending()).toEqual([expect.objectContaining({ revision: newer.revision, trip: newer.trip })])
    expect(state.writes).toEqual([])
  })

  it('does not apply a stale hydrate after a newer write receives a server acknowledgement', async () => {
    const store = await fresh(true)
    await capture(store, 'Earlier pending edit')
    const hold = gate()
    state.queueGate = hold.promise
    const reload = store.rereadTrips()
    await flush()
    vi.stubGlobal('navigator', { onLine: true })
    store.updateTrip('shared', { name: 'Acknowledged newest edit' })
    expect(await store.tripWriteVerdict('shared')).toBe(true)
    expect(state.rows.get('shared')?.write_version).toBe(1)
    hold.release()
    await reload
    await flush()
    expect(store.getSnapshot().trips[0].name).toBe('Acknowledged newest edit')
    expect(store.getSnapshot().trips[0].writeVersion).toBe(1)
    expect(await pending()).toEqual([])
  })

  it('retains and pauses after three failures, then permits an explicit successful retry', async () => {
    const store = await fresh()
    const edit = await capture(store)
    state.failures = 3
    vi.stubGlobal('navigator', { onLine: true })
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(await store.replayQueuedWrites()).toBe(0)
      expect((await pending())[0]).toMatchObject({ attempts: attempt, revision: edit.revision, trip: edit.trip })
    }
    expect((await pending())[0].state).toBe('failed')
    await store.replayQueuedWrites()
    expect(state.writes).toHaveLength(3)
    expect(await store.resolveQueuedTripWrite('shared', 'retry')).toBe(true)
    expect(state.writes).toHaveLength(4)
    expect(await pending()).toEqual([])
  })

  it('pauses a legacy edit with no known base version', async () => {
    const store = await fresh()
    const edit = await capture(store)
    const queue = await import('../src/lib/writeQueue')
    await queue.queueWrite({ ...edit, baseVersion: undefined })
    vi.stubGlobal('navigator', { onLine: true })
    expect(await store.replayQueuedWrites()).toBe(0)
    expect((await pending())[0].state).toBe('conflict')
    expect(state.writes).toEqual([])
  })

  it('purges inaccessible edits when the current account loses its editable role', async () => {
    const store = await fresh()
    await capture(store)
    state.members = state.members.map(member => member.user_id === 'A' ? { ...member, role: 'viewer' } : member)
    vi.stubGlobal('navigator', { onLine: true })
    expect(await store.replayQueuedWrites()).toBe(0)
    await flush()
    expect(await pending()).toEqual([])
    expect(store.getSnapshot().trips).toEqual([])
    expect(state.writes).toEqual([])
  })

  it.each(['DELETE', 'tombstone'] as const)('a realtime %s defeats held edits and the local echo guard', async removal => {
    const store = await fresh(true)
    await capture(store)
    store._applyRealtimeEventForTest('trips', removal === 'DELETE'
      ? { eventType: 'DELETE', new: {}, old: { id: 'shared' } }
      : { eventType: 'UPDATE', new: { ...state.rows.get('shared'), deleted_at: '2026-10-17T00:00:00Z' }, old: {} })
    await flush()
    expect(store.getSnapshot().trips).toEqual([])
    expect(await pending()).toEqual([])
    vi.stubGlobal('navigator', { onLine: true })
    expect(await store.replayQueuedWrites()).toBe(0)
    expect(state.writes).toEqual([])
  })

  it('starts a fresh trip fetch after revoke and grant without reviving the stale response', async () => {
    const store = await fresh(true)
    const own = { trip_id: 'shared', user_id: 'A', role: 'owner', joined_at: 1 }
    store._applyRealtimeEventForTest('trip_members', { eventType: 'DELETE', new: {}, old: own })
    const hold = gate()
    state.readGate = hold.promise
    store._applyRealtimeEventForTest('trip_members', { eventType: 'INSERT', new: own, old: {} })
    await flush()
    store._applyRealtimeEventForTest('trip_members', { eventType: 'DELETE', new: {}, old: own })
    Object.assign(state.rows.get('shared')!, { name: 'Fresh grant copy', write_version: 2 })
    state.readGate = null
    store._applyRealtimeEventForTest('trip_members', { eventType: 'INSERT', new: own, old: {} })
    await flush()
    try {
      expect(store.getSnapshot().trips[0]?.name).toBe('Fresh grant copy')
    } finally {
      hold.release()
      await flush()
    }
    expect(store.getSnapshot().trips[0]?.name).toBe('Fresh grant copy')
    expect(store.getSnapshot().trips[0]?.writeVersion).toBe(2)
  })

  it('does not let an old revocation purge edits captured after a fresh grant', async () => {
    const store = await fresh(true)
    await capture(store, 'Old access edit')
    const own = { trip_id: 'shared', user_id: 'A', role: 'owner', joined_at: 1 }
    const hold = gate()
    state.queueGate = hold.promise
    store._applyRealtimeEventForTest('trip_members', { eventType: 'DELETE', new: {}, old: own })
    await flush()
    store._applyRealtimeEventForTest('trip_members', { eventType: 'INSERT', new: own, old: {} })
    await flush()
    store.updateTrip('shared', { name: 'New access edit' })
    await store.tripWriteVerdict('shared')
    hold.release()
    await flush()
    expect(store.getSnapshot().trips[0]?.name).toBe('New access edit')
    expect(await pending()).toEqual([expect.objectContaining({ trip: expect.objectContaining({ name: 'New access edit' }) })])
  })

  it.each(['missing', 'wrong-id', 'same-version'] as const)('requires confirmed matching row/version: %s acknowledgement remains paused', async response => {
    const store = await fresh()
    await capture(store)
    state.response = response
    vi.stubGlobal('navigator', { onLine: true })
    expect(await store.replayQueuedWrites()).toBe(0)
    expect(state.committed).toBe(1)
    expect((await pending())[0].state).toBe('conflict')
  })

  it('keeps same-millisecond edits distinct while one confirmed write is in flight', async () => {
    const store = await fresh()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(42)
    vi.stubGlobal('navigator', { onLine: true })
    const hold = gate()
    state.updateGate = hold.promise
    store.updateTrip('shared', { name: 'First' })
    const firstVerdict = store.tripWriteVerdict('shared')!
    await flush()
    const first = (await pending())[0]
    store.updateTrip('shared', { name: 'Second' })
    const secondVerdict = store.tripWriteVerdict('shared')!
    await flush()
    const second = (await pending())[0]
    expect(second.revision).not.toBe(first.revision)
    expect(state.writes).toHaveLength(1)
    hold.release()
    expect(await firstVerdict).toBe(true)
    expect(await secondVerdict).toBe(true)
    expect(state.writes).toHaveLength(2)
    expect(state.writes[1].filters.write_version).toBe(1)
    expect(state.rows.get('shared')?.name).toBe('Second')
    expect(await pending()).toEqual([])
    clock.mockRestore()
  })

  it.each(['queueGate', 'memberGate', 'readGate', 'optionalGate'] as const)('abandons the departed account after an awaited %s', async boundary => {
    const store = await fresh()
    await capture(store)
    const hold = gate()
    state[boundary] = hold.promise
    vi.stubGlobal('navigator', { onLine: true })
    const replay = store.replayQueuedWrites()
    await flush()
    await store.logout()
    state.actor = 'B'
    store.getSnapshot().sessionUserId = 'B'
    const { toast } = await import('../src/components/ui')
    vi.mocked(toast).mockClear()
    hold.release()
    expect(await replay).toBe(0)
    await flush()
    expect(state.writes).toEqual([])
    expect(state.operations.filter(op => op.actor === 'B')).toEqual([])
    expect(toast).not.toHaveBeenCalled()
    expect(store.getSnapshot().trips).toEqual([])
  })

  it('does not send a later old-account edit waiting on a per-trip write tail', async () => {
    const store = await fresh()
    vi.stubGlobal('navigator', { onLine: true })
    const hold = gate()
    state.updateGate = hold.promise
    store.updateTrip('shared', { name: 'First request' })
    const first = store.tripWriteVerdict('shared')!
    await flush()
    store.updateTrip('shared', { name: 'Must never send' })
    const second = store.tripWriteVerdict('shared')!
    await flush()
    expect(state.writes).toHaveLength(1)
    await store.logout()
    state.actor = 'B'
    store.getSnapshot().sessionUserId = 'B'
    const { toast } = await import('../src/components/ui')
    vi.mocked(toast).mockClear()
    hold.release()
    expect(await first).toBe(false)
    expect(await second).toBe(false)
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0].actor).toBe('A')
    expect(state.operations.filter(op => op.actor === 'B')).toEqual([])
    expect(toast).not.toHaveBeenCalled()
    expect(store.getSnapshot().trips).toEqual([])
  })

  it('binds the write token before a delayed SDK auth step can switch to another editor', async () => {
    const store = await fresh()
    state.members.push({ trip_id: 'shared', user_id: 'B', role: 'editor', joined_at: 1 })
    const hold = gate()
    state.tokenGate = hold.promise
    vi.stubGlobal('navigator', { onLine: true })
    store.updateTrip('shared', { name: 'Account A private pending edit' })
    const verdict = store.tripWriteVerdict('shared')!
    await flush()
    await store.logout()
    state.actor = 'B'
    store.getSnapshot().sessionUserId = 'B'
    const { toast } = await import('../src/components/ui')
    vi.mocked(toast).mockClear()
    hold.release()
    expect(await verdict).toBe(false)
    expect(state.writes).toHaveLength(1)
    expect(state.writes[0].actor).toBe('A')
    expect(state.operations.filter(operation => operation.actor === 'B')).toEqual([])
    expect(toast).not.toHaveBeenCalled()
    expect(store.getSnapshot().trips).toEqual([])
  })
})


describe('#783 metadata and plan ordering', () => {
  it('boots offline from its last clean snapshot, overlays edits, then confirms server state on reconnect', async () => {
    const first = await fresh()
    const clean = structuredClone(first.getSnapshot().trips[0])
    first.deleteStop('shared', 'delete')
    first.updateStop('shared', 'keep', { visitMinutes: 95 })
    await capture(first, 'Latest offline plan')
    const offlineCache = await import('../src/lib/offlineCache')
    vi.mocked(offlineCache.loadSnapshot).mockResolvedValueOnce({
      savedAt: 1, trips: [clean], trashedTrips: [], users: [], published: [],
      suggestions: [], decisions: [], activity: [],
    } as never)
    state.offlineReads = true
    const restarted = await fresh(true)
    expect(restarted.tripById('shared')?.name).toBe('Latest offline plan')
    expect(restarted.tripById('shared')?.days[0].stops.map(stop => stop.id)).toEqual(['keep'])
    expect(state.committed).toBe(0)
    state.offlineReads = false
    vi.stubGlobal('navigator', { onLine: true })
    await restarted.resumeSync()
    await restarted.replayQueuedWrites()
    expect(state.committed).toBe(1)
    expect(state.rows.get('shared')?.name).toBe('Latest offline plan')
    const days = state.rows.get('shared')?.days as Array<{ stops: Array<{ id: string; visitMinutes: number }> }>
    expect(days[0].stops).toHaveLength(1)
    expect(days[0].stops[0]).toMatchObject({ id: 'keep', visitMinutes: 95 })
    expect(await pending()).toEqual([])
  })

  it('cleared local data cannot recreate a prior account edit after a fresh boot', async () => {
    const first = await fresh()
    await capture(first, 'Private unsynced A plan')
    expect(await pending()).toHaveLength(1)
    state.disk.clear()
    state.actor = 'B'
    const second = await fresh(true)
    expect(second.getSnapshot().sessionUserId).toBe('B')
    expect(second.getSnapshot().trips.some(t => t.name === 'Private unsynced A plan')).toBe(false)
    expect(await pending()).toEqual([])
    expect(await second.replayQueuedWrites()).toBe(0)
    state.actor = 'A'
    const again = await fresh(true)
    expect(again.tripById('shared')?.name).toBe('Original plan')
    expect(await pending()).toEqual([])
  })

  it('a membership fetch cannot bring a trashed trip into the live cache', async () => {
    const store = await fresh()
    store.getSnapshot().trips = []
    state.rows.get('shared')!.deleted_at = '2026-10-17T00:00:00Z'
    store._applyRealtimeEventForTest('trip_members', { eventType: 'INSERT',
      new: { trip_id: 'shared', user_id: 'A', role: 'owner', joined_at: 1 }, old: {} } as never)
    await flush()
    expect(store.tripById('shared')).toBeUndefined()
  })

  it('rebases a saved edit only after its own conditional invite-code write', async () => {
    const store = await fresh()
    await capture(store)
    vi.stubGlobal('navigator', { onLine: true })
    const code = await store.ensureInviteCode('shared')
    expect(code).toBeTruthy()
    expect((await pending())[0]).toMatchObject({ baseVersion: 1, trip: { inviteCode: code } })
    expect(await store.replayQueuedWrites()).toBe(1)
    expect(state.rows.get('shared')).toMatchObject({ name: 'My offline plan', invite_code: code, write_version: 2 })
  })

  it('does not rebase an unseen collaborator change when minting a code loses CAS', async () => {
    const store = await fresh()
    await capture(store)
    vi.stubGlobal('navigator', { onLine: true })
    state.beforeUpdate = () => Object.assign(state.rows.get('shared')!, { name: 'Collaborator winner', write_version: 4 })
    expect(await store.ensureInviteCode('shared')).toBeNull()
    expect((await pending())[0].baseVersion).toBe(0)
    expect(await store.replayQueuedWrites()).toBe(0)
    expect((await pending())[0].state).toBe('conflict')
    expect(state.rows.get('shared')?.name).toBe('Collaborator winner')
  })

  it('trash cancels pending replay and undo fetches the restored server revision', async () => {
    const store = await fresh()
    await capture(store)
    const local = store.tripById('shared')!
    vi.stubGlobal('navigator', { onLine: true })
    store.trashTrip(local)
    await flush()
    expect(await pending()).toEqual([])
    expect(store.tripById('shared')).toBeUndefined()
    expect(state.rows.get('shared')?.deleted_at).toBeTruthy()
    store.restoreTrashedTrip(local)
    await flush()
    expect(store.tripById('shared')?.writeVersion).toBe(2)
    expect(store.tripById('shared')?.name).toBe('Original plan')
    store.updateTrip('shared', { name: 'Restored and edited' })
    expect(await store.tripWriteVerdict('shared')).toBe(true)
    expect(state.rows.get('shared')).toMatchObject({ deleted_at: null, name: 'Restored and edited', write_version: 3 })
  })
})
