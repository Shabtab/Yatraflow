import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
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
  putGate: null as Promise<void> | null,
  queueGate: null as Promise<void> | null,
  memberGate: null as Promise<void> | null,
  readGate: null as Promise<void> | null,
  optionalGate: null as Promise<void> | null,
  updateGate: null as Promise<void> | null,
  tokenGate: null as Promise<void> | null,
  beforeUpdate: null as (() => void) | null,
  authHandler: null as ((event: string, session: unknown) => void) | null,
  putCalls: 0,
  removeFails: false,
  missingBranch: 0,
  hiddenTrips: new Set<string>(),
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
      if (state.removeFails) throw new Error('durable removal failed');
      const entry = state.disk.get(key)
      if (!matches(entry, at, revision) || (owner !== undefined && entry?.ownerId !== owner)) return false
      state.disk.delete(key)
      return true
    },
    putIf: async (entry, at, revision) => {
      // The counter rises BEFORE the gate, so a test can wait until the
      // retention is genuinely in flight rather than guessing at a tick count.
      state.putCalls += 1;
      await state.putGate;
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
          let rows: Row[] = table === 'trips' ? [...state.rows.values()].filter(r => allowedIds.includes(r.id) && !state.hiddenTrips.has(r.id))
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
  state.putCalls = 0
  state.removeFails = false
  state.missingBranch = 0
  state.hiddenTrips = new Set()
  vi.stubGlobal('navigator', { onLine: false })
  vi.clearAllMocks()
})

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })


describe('independent exact-SHA recovery probes', () => {
  it('realtime demotion must show the server plan to the viewer', async () => {
    const store = await fresh(true);
    await capture(store, 'PRIVATE LOCAL OVERLAY');
    const member = { trip_id: 'shared', user_id: 'A', role: 'viewer', joined_at: 1 };
    state.members = state.members.map(m => m.user_id === 'A' ? member : m);
    store._applyRealtimeEventForTest('trip_members', { eventType: 'UPDATE', new: member, old: {} });
    await flush();
    expect((await pending())[0]).toMatchObject({ reason: 'access-revoked' });
    expect(store.getSnapshot().trips[0].members.find(m => m.userId === 'A').role).toBe('viewer');
    expect(store.getSnapshot().trips[0].name).toBe('Original plan');
  });
  it('a later grant and hydrate must not overlay a revoked copy', async () => {
    const store = await fresh(true);
    await capture(store, 'REVOKED LOCAL OVERLAY');
    state.members = state.members.map(m => m.user_id === 'A' ? { ...m, role: 'viewer' } : m);
    vi.stubGlobal('navigator', { onLine: true });
    await store.replayQueuedWrites();
    await flush();
    expect((await pending())[0]).toMatchObject({ reason: 'access-revoked' });
    state.members = state.members.map(m => m.user_id === 'A' ? { ...m, role: 'owner' } : m);
    await store.resumeSync();
    await flush();
    expect(state.writes).toEqual([]);
    expect(store.getSnapshot().trips[0].name).toBe('Original plan');
  });
  it('a tombstone during discard read must not resurrect the trip', async () => {
    const store = await fresh(true);
    await capture(store);
    vi.stubGlobal('navigator', { onLine: true });
    const hold = gate();
    state.readGate = hold.promise;
    const discard = store.resolveQueuedTripWrite('shared', 'discard');
    await flush();
    store._applyRealtimeEventForTest('trips', { eventType: 'DELETE', new: {}, old: { id: 'shared' } });
    await flush();
    expect(store.getSnapshot().trips).toEqual([]);
    hold.release();
    await discard;
    await flush();
    expect(store.getSnapshot().trips).toEqual([]);
  });
  it('discard must not restore A data after the final queue read switches to B', async () => {
    const store = await fresh(true);
    const leaks: unknown[] = [];
    store.subscribe(() => {
      const current = store.getSnapshot();
      if (current.sessionUserId === 'B' && current.trips.length) leaks.push(structuredClone(current.trips));
    });
    await capture(store, 'A LOCAL COPY');
    vi.stubGlobal('navigator', { onLine: true });
    const hold = gate();
    state.readGate = hold.promise;
    const discard = store.resolveQueuedTripWrite('shared', 'discard');
    await flush();
    const queue = gate();
    state.queueGate = queue.promise;
    hold.release();
    await flush();
    state.actor = 'B';
    state.authHandler('SIGNED_IN', { user: { id: 'B' }, access_token: 'token-B' });
    await flush();
    expect(store.getSnapshot().sessionUserId).toBe('B');
    queue.release();
    await discard;
    await flush();
    expect(store.getSnapshot().sessionUserId).toBe('B');
    expect(store.getSnapshot().trips).toEqual([]);
    expect(leaks).toEqual([]);
  });
  it('revocation storage completion must not remove B shared trip after switching identity', async () => {
    const store = await fresh(true);
    await capture(store);
    state.members = state.members.filter(m => m.user_id !== 'A');
    state.members.push({ trip_id: 'shared', user_id: 'B', role: 'editor', joined_at: 1 });
    const hold = gate();
    state.putGate = hold.promise;
    vi.stubGlobal('navigator', { onLine: true });
    const replay = store.replayQueuedWrites();
    await flush();
    state.actor = 'B';
    state.authHandler('SIGNED_IN', { user: { id: 'B' }, access_token: 'token-B' });
    await flush();
    expect(store.getSnapshot().sessionUserId).toBe('B');
    expect(store.getSnapshot().trips.map(t => t.id)).toEqual(['shared']);
    hold.release();
    await replay;
    await flush();
    expect(store.getSnapshot().sessionUserId).toBe('B');
    expect(store.getSnapshot().trips.map(t => t.id)).toEqual(['shared']);
  });
});

describe('recovery identity regressions', () => {
  it('a reasoned copy is never held as the local copy', async () => {
    const store = await fresh(true);
    await capture(store, 'REASONED OVERLAY');
    state.members = state.members.map(m => m.user_id === 'A' ? { ...m, role: 'viewer' } : m);
    vi.stubGlobal('navigator', { onLine: true });
    await store.replayQueuedWrites();
    await flush();
    // The copy keeps its reason.
    expect((await pending())[0]).toMatchObject({ reason: 'access-revoked' });
    // A later grant must not make the stale proposal the visible plan, and the
    // held copy must not carry the stale baseline.
    state.members = state.members.map(m => m.user_id === 'A' ? { ...m, role: 'owner' } : m);
    await store.resumeSync();
    await flush();
    expect(store.getSnapshot().trips[0].name).toBe('Original plan');
    expect(state.writes).toEqual([]);
  });

  it('a replay demotion shows the shared plan, not the local proposal', async () => {
    const store = await fresh(true);
    await capture(store, 'LOCAL PROPOSAL');
    // The server still holds the original plan.
    Object.assign(state.rows.get('shared')!, { name: 'Shared plan' });
    state.members = state.members.map(m => m.user_id === 'A' ? { ...m, role: 'viewer' } : m);
    vi.stubGlobal('navigator', { onLine: true });
    expect(await store.replayQueuedWrites()).toBe(0);
    await flush();
    // The copy is kept with its reason.
    expect((await pending())[0]).toMatchObject({ reason: 'access-revoked' });
    // The DISPLAYED plan is the shared one. The trip id alone does not prove
    // this: the local overlay also carries the trip id.
    expect(store.getSnapshot().trips[0].name).toBe('Shared plan');
  });

  it('a discard that cannot read the server refuses, and keeps the overlay', async () => {
    const store = await fresh(true);
    await capture(store, 'DISCARDED OVERLAY');
    vi.stubGlobal('navigator', { onLine: true });
    // The server read fails, so the shared plan cannot be fetched.
    state.offlineReads = true;
    // The removal is refused. The cached plan may be showing the local
    // overlay, and dropping the copy alone would leave the discarded content
    // on screen for the user to edit and queue again.
    expect(await store.resolveQueuedTripWrite('shared', 'discard')).toBe(false);
    await flush();
    // The local copy stays, so the visible overlay and the queue agree.
    expect(await pending()).toHaveLength(1);
    expect(store.getSnapshot().trips[0]?.name).toBe('DISCARDED OVERLAY');
    // With the server readable again, the removal replaces the overlay with
    // the shared plan.
    state.offlineReads = false;
    Object.assign(state.rows.get('shared')!, { name: 'Shared plan' });
    expect(await store.resolveQueuedTripWrite('shared', 'discard')).toBe(true);
    await flush();
    expect(await pending()).toEqual([]);
    expect(store.getSnapshot().trips[0]?.name).toBe('Shared plan');
  });

  it('a reasoned copy is never held, even when its removal fails', async () => {
    const store = await fresh(true);
    // The server plan is at revision 5, so a baseline of 5 is the current one
    // and any other value is an inherited stale baseline.
    Object.assign(state.rows.get('shared')!, { write_version: 5 });
    await capture(store, 'KEPT COPY');
    state.members = state.members.map(m => m.user_id === 'A' ? { ...m, role: 'viewer' } : m);
    vi.stubGlobal('navigator', { onLine: true });
    await store.replayQueuedWrites();
    await flush();
    expect((await pending())[0]).toMatchObject({ reason: 'access-revoked' });
    // The durable removal fails, so the reasoned copy stays queued.
    state.removeFails = true;
    expect(await store.resolveQueuedTripWrite('shared', 'discard')).toBe(false);
    await flush();
    // The copy is still queued, and it still carries its reason.
    const kept = await pending();
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ reason: 'access-revoked' });
    // A reasoned copy must not be held as the local copy. A later edit must
    // not inherit its baseline, or the new edit would be written against a
    // revision the account no longer holds.
    state.members = state.members.map(m => m.user_id === 'A' ? { ...m, role: 'owner' } : m);
    await store.resumeSync();
    await flush();
    expect(store.getSnapshot().trips[0].name).toBe('Original plan');
    // The server moves on to revision 6. A held reasoned copy would carry the
    // revision 5 baseline, so the later edit would be written against a
    // revision the server has already left.
    Object.assign(state.rows.get('shared')!, { write_version: 6 });
    await store.resumeSync();
    await flush();
    const accepted = store.updateTrip('shared', { name: 'A later edit' });
    expect(accepted).toBe(true);
    await store.tripWriteVerdict('shared');
    await flush();
    const entries = await pending();
    const later = entries.find(w => (w.trip as { name?: string }).name === 'A later edit');
    expect(later).toBeDefined();
    // The later edit carries no reason and no inherited failure state.
    expect(later!.reason).toBeUndefined();
    expect(later!.state).toBeUndefined();
    // The later edit is written against the current server revision, not the
    // baseline the reasoned copy carried.
    expect(later!.baseVersion).toBe(6);
  });

  it('the discard path never holds a reasoned copy', () => {
    // The overlay path already drops a reasoned copy from the held copy, so
    // the behavioural outcome is the same with or without this guard. The
    // guard is a second line of defence, and it is pinned on the source so a
    // future edit cannot remove it unnoticed.
    const source = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8')
    expect(source).toContain('if (isHeldCopy(latest)) queuedLocalTrips.set(tripId, latest)')
    expect(source).toContain('else queuedLocalTrips.delete(tripId)')
  });

  it('a removal names the removal, not a demotion', async () => {
    const store = await fresh(true);
    await capture(store);
    state.members = state.members.filter(m => m.user_id !== 'A');
    vi.stubGlobal('navigator', { onLine: true });
    await store.replayQueuedWrites();
    await flush();
    expect((await pending())[0]).toMatchObject({ reason: 'access-removed' });
    expect(store.getSnapshot().trips).toEqual([]);
  });

  it('a demotion names the demotion', async () => {
    const store = await fresh(true);
    await capture(store);
    state.members = state.members.map(m => m.user_id === 'A' ? { ...m, role: 'viewer' } : m);
    vi.stubGlobal('navigator', { onLine: true });
    await store.replayQueuedWrites();
    await flush();
    expect((await pending())[0]).toMatchObject({ reason: 'access-revoked' });
    // A demoted reader keeps the trip.
    expect(store.getSnapshot().trips.map(t => t.id)).toEqual(['shared']);
  });

  it('a reasoned copy is downloadable and removable, and it never syncs', async () => {
    const store = await fresh(true);
    await capture(store, 'KEPT COPY');
    state.members = state.members.map(m => m.user_id === 'A' ? { ...m, role: 'viewer' } : m);
    vi.stubGlobal('navigator', { onLine: true });
    await store.replayQueuedWrites();
    await flush();
    // The copy is still on the device.
    expect(await pending()).toHaveLength(1);
    // A retry is refused, so a revocation is never papered over.
    expect(await store.resolveQueuedTripWrite('shared', 'retry')).toBe(false);
    await flush();
    expect(state.writes).toEqual([]);
    // An explicit discard removes it.
    expect(await store.resolveQueuedTripWrite('shared', 'discard')).toBe(true);
    await flush();
    expect(await pending()).toEqual([]);
  });

  it('a reasoned copy is removed without a connection', async () => {
    const store = await fresh(true);
    await capture(store, 'OFFLINE COPY');
    state.members = state.members.map(m => m.user_id === 'A' ? { ...m, role: 'viewer' } : m);
    vi.stubGlobal('navigator', { onLine: true });
    await store.replayQueuedWrites();
    await flush();
    expect((await pending())[0]).toMatchObject({ reason: 'access-revoked' });
    // The device is offline and the server cannot be read. The reasoned copy
    // is the account's own work and it is never an overlay, so the removal
    // still completes.
    state.offlineReads = true;
    vi.stubGlobal('navigator', { onLine: false });
    expect(await store.resolveQueuedTripWrite('shared', 'discard')).toBe(true);
    await flush();
    expect(await pending()).toEqual([]);
    // No server write happened either way.
    expect(state.writes).toEqual([]);
  });

  it('a held overlay is refused without a connection, and removed after it', async () => {
    const store = await fresh(true);
    // A normal edit, so the copy is a HELD overlay with no reason.
    await capture(store, 'HELD OVERLAY');
    expect((await pending())[0]?.reason).toBeUndefined();
    // The device is offline and the server cannot be read. The overlay is on
    // screen, so the removal is refused and the overlay stays with its copy.
    state.offlineReads = true;
    vi.stubGlobal('navigator', { onLine: false });
    expect(await store.resolveQueuedTripWrite('shared', 'discard')).toBe(false);
    await flush();
    // The queue and the visible plan still agree.
    expect(await pending()).toHaveLength(1);
    expect(store.getSnapshot().trips[0]?.name).toBe('HELD OVERLAY');
    // With the server readable again, the removal replaces the overlay with
    // the shared plan.
    state.offlineReads = false;
    Object.assign(state.rows.get('shared')!, { name: 'Shared plan' });
    vi.stubGlobal('navigator', { onLine: true });
    expect(await store.resolveQueuedTripWrite('shared', 'discard')).toBe(true);
    await flush();
    expect(await pending()).toEqual([]);
    expect(store.getSnapshot().trips[0]?.name).toBe('Shared plan');
  });

  it('a trip the server no longer has keeps the copy and names the reason', async () => {
    const store = await fresh(true);
    await capture(store, 'GONE COPY');
    // The trip is gone from the server, but the account is still a member.
    state.rows.delete('shared');
    vi.stubGlobal('navigator', { onLine: true });
    await store.replayQueuedWrites();
    await flush();
    // The copy stays for its owner, with the reason attached.
    expect((await pending())[0]).toMatchObject({ reason: 'trip-unavailable' });
    // The trip is gone from the list.
    expect(store.getSnapshot().trips).toEqual([]);
    expect(state.writes).toEqual([]);
  });

  it('a missing trip must not remove B shared trip after switching identity', async () => {
    const store = await fresh(true);
    await capture(store, 'GONE COPY');
    // A is still a member, so the send passes the membership check. The trip
    // is hidden from the read, so the read finds nothing and the missing-trip
    // branch runs. B is a member of the SAME trip id, so the delayed
    // invalidation would remove B's trip if it were not guarded.
    state.members.push({ trip_id: 'shared', user_id: 'B', role: 'owner', joined_at: 1 });
    state.hiddenTrips.add('shared');
    const hold = gate();
    state.putGate = hold.promise;
    vi.stubGlobal('navigator', { onLine: true });
    const replay = store.replayQueuedWrites();
    // Wait until the retention is genuinely in flight, so the account change
    // lands during the storage write and not before it.
    while (state.putCalls < 1) await flush();
    // The trip is readable again for B.
    state.hiddenTrips.delete('shared');
    state.actor = 'B';
    state.authHandler('SIGNED_IN', { user: { id: 'B' }, access_token: 'token-B' });
    await flush();
    expect(store.getSnapshot().sessionUserId).toBe('B');
    hold.release();
    await replay;
    await flush();
    // The delayed invalidation must not have removed B's trip.
    expect(store.getSnapshot().sessionUserId).toBe('B');
    expect(store.getSnapshot().trips.map(t => t.id)).toEqual(['shared']);
  });
});
