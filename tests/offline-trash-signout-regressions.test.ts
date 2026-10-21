import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueuedWrite, WriteQueueStore } from '../src/lib/writeQueue'
import type { TripRow } from '../src/lib/tripRow'

// Release v0.78.0 blockers: a failed trash must keep the saved edit, and a
// same-account sign-in must not replay a signed-out copy while its cleanup runs.
// Fixture style matches offline-replay-protocol.test.ts: fake Supabase transport
// and queue storage, with the real store and queue code.

type Row = Record<string, unknown>
type Operation = { table: string; method: string; actor: string | null; filters: Record<string, unknown>; payload?: Row }

const { state } = vi.hoisted(() => ({ state: {
  actor: 'A' as string | null,
  rows: new Map<string, Row>(),
  members: [] as Row[],
  disk: new Map<string, QueuedWrite>(),
  operations: [] as Operation[],
  writes: [] as Operation[],
  failures: 0,
  removeFailures: 0,
  offlineReads: false,
  queueGate: null as Promise<void> | null,
  readGate: null as Promise<void> | null,
  memberGate: null as Promise<void> | null,
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
      if (state.removeFailures > 0) {
        state.removeFailures -= 1
        throw new Error('Offline storage transaction failed')
      }
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
    for (const name of ['limit', 'order']) builder[name] = () => builder
    builder.maybeSingle = builder.single = () => { one = true; return builder }
    builder.then = (resolve: (result: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
      // Requests start when awaited, like PostgREST. RLS uses that request's actor.
      if (!promise) {
        promise = (async () => {
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
            if (selection === '*') return { data: [structuredClone(state.rows.get(String(row.id)))], error: null, count: 1 }
            return { data: [{ id: row.id, write_version: version, updated_at: Date.now() }], error: null, count: 1 }
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
  state.failures = 0
  state.removeFailures = 0
  state.offlineReads = false
  state.queueGate = state.readGate = state.memberGate = state.optionalGate = state.updateGate = state.tokenGate = null
  state.beforeUpdate = null
  state.authHandler = null
  vi.stubGlobal('navigator', { onLine: false })
  vi.clearAllMocks()
})

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('v0.78.0 release blockers', () => {
  it('keeps a saved offline edit until the trash tombstone is confirmed', async () => {
    const store = await fresh()
    await capture(store, 'Only saved local edits')
    state.failures = 1
    store.trashTrip(store.tripById('shared')!)
    await flush()
    // The tombstone failed. The trip returns, and the saved edit is still queued.
    expect(store.tripById('shared')?.name).toBe('Only saved local edits')
    expect(await pending()).toEqual([expect.objectContaining({ tripId: 'shared', trip: expect.objectContaining({ name: 'Only saved local edits' }) })])
    expect(state.rows.get('shared')?.name).toBe('Original plan')
    await store.resumeSync()
    expect(store.tripById('shared')?.name).toBe('Only saved local edits')
    expect(await pending()).toHaveLength(1)

    // A successful trash removes the saved edit. A send already in flight cannot bring the trip back.
    vi.stubGlobal('navigator', { onLine: true })
    const hold = gate()
    state.updateGate = hold.promise
    const replay = store.replayQueuedWrites()
    await flush()
    expect(state.writes.filter(op => op.table === 'trips' && op.method === 'update')).toHaveLength(2)
    store.trashTrip(store.tripById('shared')!)
    hold.release()
    expect(await replay).toBe(0)
    await flush()
    expect(store.tripById('shared')).toBeUndefined()
    expect(state.rows.get('shared')?.deleted_at).toBeTruthy()
    expect(await pending()).toEqual([])
    expect(await store.replayQueuedWrites()).toBe(0)
  })

  it('never replays a signed-out edit when the same account signs back in during its cleanup', async () => {
    const store = await fresh(true)
    await capture(store, 'Signed out unsynced copy')
    const hold = gate()
    state.queueGate = hold.promise // holds the departing account's list read
    await store.logout()
    state.queueGate = null
    state.actor = 'A'
    vi.stubGlobal('navigator', { onLine: true })
    state.authHandler?.('SIGNED_IN', { user: { id: 'A' } })
    await flush()
    await flush()
    // Hydration and replay wait for the departing cleanup, so nothing is sent yet.
    expect(state.writes).toEqual([])
    hold.release()
    await flush()
    await flush()
    expect(state.writes).toEqual([])
    expect(state.rows.get('shared')?.name).toBe('Original plan')
    expect(await pending()).toEqual([])
    store.updateTrip('shared', { name: 'Signed in edit' })
    expect(await store.tripWriteVerdict('shared')).toBe(true)
    expect(state.writes.map(op => (op.payload as Row | undefined)?.name)).toEqual(['Signed in edit'])
    expect(state.rows.get('shared')?.name).toBe('Signed in edit')
  })

  it('keeps a signed-out edit paused when its cleanup cannot remove it', async () => {
    const store = await fresh(true)
    await capture(store, 'Signed out unsynced copy')
    state.removeFailures = 1
    await store.logout()
    expect(await pending()).toEqual([expect.objectContaining({ state: 'failed', storageFailed: true })])
    state.actor = 'A'
    vi.stubGlobal('navigator', { onLine: true })
    state.authHandler?.('SIGNED_IN', { user: { id: 'A' } })
    await flush()
    await flush()
    expect(await store.replayQueuedWrites()).toBe(0)
    expect(state.writes).toEqual([])
    expect(state.rows.get('shared')?.name).toBe('Original plan')
  })
})
