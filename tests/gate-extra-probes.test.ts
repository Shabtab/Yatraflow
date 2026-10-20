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
  listCount: 0, listHoldAt: 0, listGate: null as Promise<void> | null, sessionCalls: 0, removeCalls: 0,
  putGate: null as Promise<void> | null,
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
      state.listCount++; const delayed=state.listCount===state.listHoldAt;
      const rows = structuredClone([...state.disk.values()])
      await state.queueGate; if(delayed) await state.listGate
      return rows
    },
    put: async entry => { state.disk.set(actual.writeQueueKey(entry.ownerId, entry.tripId), structuredClone(entry)) },
    remove: async key => { state.disk.delete(key) },
    removeIf: async (key, at, revision, owner) => {
      state.removeCalls++; const entry = state.disk.get(key)
      if (!matches(entry, at, revision) || (owner !== undefined && entry?.ownerId !== owner)) return false
      state.disk.delete(key)
      return true
    },
    putIf: async (entry, at, revision) => { await state.putGate;
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
        getSession: async () => (state.sessionCalls++, { data: { session: state.actor ? { user: { id: state.actor }, access_token: `token-${state.actor}` } : null } }),
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
  state.putGate = null; state.listCount = 0; state.listHoldAt = 0; state.listGate = null; state.sessionCalls = 0; state.removeCalls = 0;
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


describe('round two behavioral coverage', () => {
  it('replay demotion applies shared content and viewer permission without realtime', async () => {
    const store = await fresh(true);
    await capture(store, 'PRIVATE REPLAY PROPOSAL');
    state.members = state.members.map(m => m.user_id === 'A' ? {...m,role:'viewer'} : m);
    vi.stubGlobal('navigator',{onLine:true});
    await store.replayQueuedWrites(); await flush();
    console.log('replay-demotion',JSON.stringify({cacheName:store.getSnapshot().trips[0]?.name,cacheRole:store.getSnapshot().trips[0]?.members.find(m=>m.userId==='A')?.role,queue:(await pending()).map(w=>({reason:w.reason,state:w.state})),writes:state.writes}));
    expect.soft(store.getSnapshot().trips[0].name).toBe('Original plan');
    expect.soft(store.getSnapshot().trips[0].members.find(m=>m.userId==='A')?.role).toBe('viewer');
    expect((await pending())[0]).toMatchObject({reason:'access-revoked'});
  });
  it('failed demotion read must not expose the local proposal as the viewer shared plan', async () => {
    const store = await fresh(true); await capture(store,'PRIVATE VIEWER PROPOSAL');
    const member={trip_id:'shared',user_id:'A',role:'viewer',joined_at:1};
    state.members=state.members.map(m=>m.user_id==='A'?member:m);
    state.offlineReads=true;
    store._applyRealtimeEventForTest('trip_members',{eventType:'UPDATE',new:member,old:{}});
    await flush();
    expect((await pending())[0]).toMatchObject({reason:'access-revoked'});
    expect(store.getSnapshot().trips.find(t=>t.id==='shared'&&t.members.some(m=>m.userId==='A'&&m.role==='viewer'))?.name).not.toBe('PRIVATE VIEWER PROPOSAL');
  });
  it('Use shared plan on a failed read keeps a downloadable copy and reports failure', async () => {
    const store=await fresh(true); const copy=await capture(store,'UNSYNCED RECOVERY');
    const queue=await import('../src/lib/writeQueue');
    await queue.requeueIfCurrent({...copy,state:'conflict'});
    state.offlineReads=true; vi.stubGlobal('navigator',{onLine:true});
    const result=await store.resolveQueuedTripWrite('shared','discard'); await flush();
    console.log('discard-read-failed',JSON.stringify({result,queue:await pending(),cachedName:store.getSnapshot().trips[0]?.name,writes:state.writes}));
    expect.soft(result).toBe(false);
    expect.soft((await pending())[0]).toMatchObject({ownerId:'A',tripId:'shared',trip:{name:'UNSYNCED RECOVERY'}});
    expect(state.writes).toEqual([]);
  });
  it('discard with a row refreshes the shared plan and leaves the server unchanged', async () => {
    const store=await fresh(true); await capture(store,'LOCAL DISCARD');
    const before=structuredClone(state.rows.get('shared'));
    vi.stubGlobal('navigator',{onLine:true});
    expect(await store.resolveQueuedTripWrite('shared','discard')).toBe(true);
    expect(await pending()).toEqual([]);
    expect(store.getSnapshot().trips[0].name).toBe('Original plan');
    expect(state.rows.get('shared')).toEqual(before); expect(state.writes).toEqual([]);
  });
  it('discard without a row removes the visible trip without a server write', async () => {
    const store=await fresh(true); await capture(store); state.rows.delete('shared');
    vi.stubGlobal('navigator',{onLine:true});
    expect(await store.resolveQueuedTripWrite('shared','discard')).toBe(true);
    expect(await pending()).toEqual([]); expect(store.getSnapshot().trips).toEqual([]); expect(state.writes).toEqual([]);
  });
  it('discard preserves newer local work captured during the server read', async () => {
    const store=await fresh(true); await capture(store);
    const hold=gate(); state.readGate=hold.promise; vi.stubGlobal('navigator',{onLine:true});
    const discard=store.resolveQueuedTripWrite('shared','discard'); await flush();
    vi.stubGlobal('navigator',{onLine:false}); store.updateTrip('shared',{name:'NEWER LOCAL'}); await flush();
    const newer=(await pending())[0];
    hold.release(); expect(await discard).toBe(false); await store.tripWriteVerdict('shared'); await flush();
    expect((await pending())[0]).toMatchObject({revision:newer.revision,trip:{name:'NEWER LOCAL'}});
    expect(store.getSnapshot().trips[0].name).toBe('NEWER LOCAL'); expect(state.writes).toEqual([]);
  });
  it('discard does not replace a newer observed server revision with a delayed row', async () => {
    const store=await fresh(true); await capture(store);
    const hold=gate(); state.readGate=hold.promise; vi.stubGlobal('navigator',{onLine:true});
    const discard=store.resolveQueuedTripWrite('shared','discard'); await flush();
    const newer={...state.rows.get('shared'),name:'NEW SHARED SERVER PLAN',write_version:1,updated_at:20}; state.rows.set('shared',newer);
    store._applyRealtimeEventForTest('trips',{eventType:'UPDATE',new:newer,old:{}});
    hold.release(); await discard; await flush();
    expect(store.getSnapshot().trips[0].name).toBe('NEW SHARED SERVER PLAN');
  });
  it('discard started before an initial queue await ignores a later tombstone generation', async () => {
    const store=await fresh(true); await capture(store,'COPY BEFORE DELETE');
    const hold=gate(); state.listCount=0; state.listHoldAt=1; state.listGate=hold.promise;
    vi.stubGlobal('navigator',{onLine:true}); const discard=store.resolveQueuedTripWrite('shared','discard'); await flush();
    state.rows.delete('shared');
    store._applyRealtimeEventForTest('trips',{eventType:'DELETE',new:{},old:{id:'shared'}}); await flush();
    hold.release(); const result=await discard; await flush();
    console.log('initial-queue-generation',JSON.stringify({result,queue:await pending(),trips:store.getSnapshot().trips}));
    expect.soft(result).toBe(false);
    expect.soft((await pending())[0]).toMatchObject({reason:'trip-unavailable',trip:{name:'COPY BEFORE DELETE'}});
    expect(store.getSnapshot().trips).toEqual([]);
  });
  it('inner queue await guard stops token work and preserves a later generation', async () => {
    const store=await fresh(true); await capture(store);
    const hold=gate(); state.listCount=0; state.listHoldAt=2; state.listGate=hold.promise;
    vi.stubGlobal('navigator',{onLine:true}); const discard=store.resolveQueuedTripWrite('shared','discard'); await flush();
    store._applyRealtimeEventForTest('trips',{eventType:'DELETE',new:{},old:{id:'shared'}}); await flush();
    const tokenBefore=state.sessionCalls; hold.release();
    expect(await discard).toBe(false); await flush();
    expect(state.sessionCalls).toBe(tokenBefore);
    expect((await pending())[0]).toMatchObject({reason:'trip-unavailable'});
  });
  it('post-server-read guard preserves the copy after a tombstone before any drop', async () => {
    const store=await fresh(true); await capture(store);
    const hold=gate(); state.readGate=hold.promise; vi.stubGlobal('navigator',{onLine:true});
    const discard=store.resolveQueuedTripWrite('shared','discard'); await flush();
    store._applyRealtimeEventForTest('trips',{eventType:'DELETE',new:{},old:{id:'shared'}}); await flush();
    hold.release(); expect(await discard).toBe(false); await flush();
    expect((await pending())[0]).toMatchObject({reason:'trip-unavailable'});
    expect(state.removeCalls).toBe(0); expect(store.getSnapshot().trips).toEqual([]);
  });
  it('reasoned copy cannot retry or replace after regrant and does not contaminate a later edit', async () => {
    const store=await fresh(true); await capture(store,'REVOKED PLAN');
    const member={trip_id:'shared',user_id:'A',role:'viewer',joined_at:1};
    state.members=state.members.map(m=>m.user_id==='A'?member:m);
    store._applyRealtimeEventForTest('trip_members',{eventType:'UPDATE',new:member,old:{}}); await flush();
    const grant={...member,role:'editor'}; state.members=state.members.map(m=>m.user_id==='A'?grant:m);
    store._applyRealtimeEventForTest('trip_members',{eventType:'UPDATE',new:grant,old:{}}); await flush();
    vi.stubGlobal('navigator',{onLine:true});
    expect(await store.resolveQueuedTripWrite('shared','retry')).toBe(false);
    expect(await store.resolveQueuedTripWrite('shared','replace')).toBe(false);
    await store.replayQueuedWrites(); expect(state.writes).toEqual([]);
    vi.stubGlobal('navigator',{onLine:false}); store.updateTrip('shared',{travellers:3}); await store.tripWriteVerdict('shared'); await flush();
    expect((await pending())[0].trip).toMatchObject({name:'Original plan',travellers:3});
  });
  it('same-user signout signin rejects an older discard generation', async () => {
    const store=await fresh(true); await capture(store);
    const hold=gate(); state.readGate=hold.promise; vi.stubGlobal('navigator',{onLine:true});
    const discard=store.resolveQueuedTripWrite('shared','discard'); await flush();
    state.actor=null; state.authHandler('SIGNED_OUT',null); await flush();
    state.actor='A'; state.authHandler('SIGNED_IN',{user:{id:'A'},access_token:'token-A'}); await flush();
    hold.release(); expect(await discard).toBe(false); await flush();
    expect(store.getSnapshot().sessionUserId).toBe('A'); expect(store.getSnapshot().trips[0]?.name).toBe('Original plan');
  });
});
