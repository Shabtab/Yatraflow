import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueuedWrite, WriteQueueStore } from '../src/lib/writeQueue'
import type { TripRow } from '../src/lib/tripRow'

type Row = Record<string, unknown>
type Operation = { table: string; method: string; actor: string | null; filters: Record<string, unknown>; payload?: Row }

const { state } = vi.hoisted(() => ({ state: {
  actor: 'A' as string | null,
  failFullRead: false,
  fullReads:0, fullGate:null as Promise<void>|null, heldFullRead:0, failFullReadAt:0,
  sessionGate: null as Promise<void>|null, removeGate: null as Promise<void>|null, failMemberRead:false,
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
      state.removeCalls++; await state.removeGate; const entry = state.disk.get(key)
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
          if (table === 'trips' && selection === '*' && one && state.failFullRead) { const wait = state.readGate; await wait; return {data:null,error:{message:'delayed full-read failure'}} }
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
          if (table === 'trip_members' && state.failMemberRead) return { data: null, error: { message: 'membership read failure' } }
          const optional = table === 'trips' && selection !== '*' && !('id' in filters)
          const allowedIds = state.members.filter(m => m.user_id === actor).map(m => m.trip_id)
          let rows: Row[] = table === 'trips' ? [...state.rows.values()].filter(r => allowedIds.includes(r.id))
            : table === 'trip_members' ? state.members.filter(r => allowedIds.includes(r.trip_id)) : []
          rows = rows.filter(row => Object.entries(filters).every(([key, value]) =>
            Array.isArray(value) ? value.includes(row[key]) : row[key] === value))
          const copy = structuredClone(rows)
          // Count each full trip read once. The hold and the injected failure name that read.
          const fullRead = table === 'trips' && selection === '*' && one ? ++state.fullReads : 0
          if (fullRead === 2) { state.heldFullRead = fullRead; await state.fullGate }
          if (fullRead && fullRead === state.failFullReadAt) return { data: null, error: { message: 'second full read failure' } }
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
        getSession: async () => { state.sessionCalls++; const actor=state.actor; await state.sessionGate; return { data: { session: actor ? { user: { id: actor }, access_token: `token-${actor}` } : null } }; },
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
  state.fullReads=0;state.fullGate=null;state.heldFullRead=0;state.failFullReadAt=0;state.failMemberRead=false;
  state.failFullRead = false; state.actor = 'A'
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



describe('fresh round four interleavings',()=>{
  for(const transition of ['switch','regrant']) it(`replay failed full read preserves later ${transition} trip`,async()=>{
    const store=await fresh(true);await capture(store,'PRIVATE A');
    state.members=state.members.map(m=>m.user_id==='A'?{...m,role:'viewer'}:m);
    const hold=gate();state.failFullRead=true;state.readGate=hold.promise;
    vi.stubGlobal('navigator',{onLine:true});const replay=store.replayQueuedWrites();await flush();
    expect(state.operations.some(o=>o.table==='trips'&&o.method==='select')).toBe(true);
    state.failFullRead=false;state.readGate=null;
    if(transition==='switch') {
      state.members.push({trip_id:'shared',user_id:'B',role:'editor',joined_at:1});
      state.actor='B';state.authHandler('SIGNED_IN',{user:{id:'B'},access_token:'token-B'});await flush();
    } else {
      const editor={trip_id:'shared',user_id:'A',role:'editor',joined_at:1};
      state.members=state.members.map(m=>m.user_id==='A'?editor:m);
      store._applyRealtimeEventForTest('trip_members',{eventType:'UPDATE',new:editor,old:{}});await flush();
    }
    expect(store.getSnapshot().trips.some(t=>t.id==='shared')).toBe(true);
    hold.release();await replay;await flush();
    expect(store.getSnapshot().trips.some(t=>t.id==='shared')).toBe(true);
  });
  for(const transition of ['switch','regrant']) it(`realtime failed read preserves later ${transition} trip`,async()=>{
    const store=await fresh(true);await capture(store,'PRIVATE A');
    const viewer={trip_id:'shared',user_id:'A',role:'viewer',joined_at:1};
    state.members=state.members.map(m=>m.user_id==='A'?viewer:m);
    const hold=gate();state.failFullRead=true;state.readGate=hold.promise;
    store._applyRealtimeEventForTest('trip_members',{eventType:'UPDATE',new:viewer,old:{}});await flush();
    state.failFullRead=false;state.readGate=null;
    if(transition==='switch') {
      state.members.push({trip_id:'shared',user_id:'B',role:'editor',joined_at:1});state.actor='B';
      state.authHandler('SIGNED_IN',{user:{id:'B'},access_token:'token-B'});await flush();
    } else {
      const editor={...viewer,role:'editor'};state.members=state.members.map(m=>m.user_id==='A'?editor:m);
      store._applyRealtimeEventForTest('trip_members',{eventType:'UPDATE',new:editor,old:{}});await flush();
    }
    hold.release();await flush();expect(store.getSnapshot().trips.some(t=>t.id==='shared')).toBe(true);
  });
  it('discard durable deletion plus revocation plus signout must not restore signed-out copy',async()=>{
    const store=await fresh(true);await capture(store,'PRIVATE SIGNOUT');
    const hold=gate();state.removeGate=hold.promise;
    const discard=store.resolveQueuedTripWrite('shared','discard');await flush();expect(state.removeCalls).toBe(1);
    state.rows.delete('shared');store._applyRealtimeEventForTest('trips',{eventType:'DELETE',new:{},old:{id:'shared'}});await flush();
    state.actor=null;state.authHandler('SIGNED_OUT',null);await flush();
    hold.release();expect(await discard).toBe(false);await flush();
    expect(await pending()).toEqual([]);
  });
  it('hydrate delayed owner read must not restore private proposal after realtime demotion',async()=>{
    const store=await fresh(true);await capture(store,'PRIVATE HYDRATE');
    const hold=gate();state.readGate=hold.promise;const hydration=store.resumeSync();await flush();
    state.readGate=null;
    const viewer={trip_id:'shared',user_id:'A',role:'viewer',joined_at:1};
    state.members=state.members.map(m=>m.user_id==='A'?viewer:m);
    store._applyRealtimeEventForTest('trip_members',{eventType:'UPDATE',new:viewer,old:{}});await flush();
    hold.release();await hydration;await flush();
    expect(store.getSnapshot().trips[0]?.name).not.toBe('PRIVATE HYDRATE');
    expect(store.getSnapshot().trips[0]?.members.find(m=>m.userId==='A')?.role).toBe('viewer');
  });
  it('realtime membership persists shared refresh before pending delayed capture',async()=>{
    const store=await fresh(true);await capture(store,'PRIVATE MEMBERS');
    const viewer={trip_id:'shared',user_id:'C',role:'viewer',joined_at:1};
    vi.stubGlobal('navigator',{onLine:true});
    store._applyRealtimeEventForTest('trip_members',{eventType:'UPDATE',new:viewer,old:{}});await store.tripWriteVerdict('shared');await flush();
    console.log('membership-persist',JSON.stringify(state.writes));
    expect(state.writes.length).toBe(0);
  });
});

describe('second shared read boundary',()=>{
 for(const transition of ['switch','tombstone']) it(`discard second read rejects ${transition}`,async()=>{
  const store=await fresh(true);await capture(store,'PRIVATE REREAD');state.fullReads=0;
  const first=gate(),second=gate();state.readGate=first.promise;state.fullGate=second.promise;
  const request=store.resolveQueuedTripWrite('shared','discard');await flush();
  const newer={...state.rows.get('shared'),name:'CURRENT SHARED',write_version:1,updated_at:20};state.rows.set('shared',newer);
  store._applyRealtimeEventForTest('trips',{eventType:'UPDATE',new:newer,old:{}});
  state.readGate=null;first.release();await flush();expect(state.heldFullRead).toBe(2);
  if(transition==='switch') {state.members.push({trip_id:'shared',user_id:'B',role:'editor',joined_at:1});state.actor='B';state.authHandler('SIGNED_IN',{user:{id:'B'},access_token:'token-B'});await flush();}
  else {state.rows.delete('shared');store._applyRealtimeEventForTest('trips',{eventType:'DELETE',new:{},old:{id:'shared'}});await flush();}
  second.release();const result=await request;await flush();
  expect.soft(result).toBe(false);
  if(transition==='switch')expect(store.getSnapshot().trips[0]?.members.some(m=>m.userId==='B')).toBe(true);
  else expect(store.getSnapshot().trips).toEqual([]);
 });
});

describe('discard refresh failures',()=>{
  it('a failed membership read keeps the held copy and publishes no empty membership',async()=>{
    const store=await fresh(true);await capture(store,'PRIVATE MEMBERSHIP');
    state.failMemberRead=true;
    const result=await store.resolveQueuedTripWrite('shared','discard');
    state.failMemberRead=false;await flush();
    expect(result).toBe(false);
    expect((await pending()).map(w=>w.trip.name)).toEqual(['PRIVATE MEMBERSHIP']);
    const shown=store.getSnapshot().trips.find(t=>t.id==='shared');
    expect(shown?.name).toBe('PRIVATE MEMBERSHIP');
    expect(shown?.members.map(m=>m.userId).sort()).toEqual(['A','C']);
  });
  it('a failed re-read after a newer server row keeps the held copy',async()=>{
    const store=await fresh(true);await capture(store,'PRIVATE REREAD');
    const first=gate();state.readGate=first.promise;state.failFullReadAt=2;
    const request=store.resolveQueuedTripWrite('shared','discard');await flush();
    const newer={...state.rows.get('shared'),name:'CURRENT SHARED',write_version:1,updated_at:20};
    state.rows.set('shared',newer);
    store._applyRealtimeEventForTest('trips',{eventType:'UPDATE',new:newer,old:{}});
    state.readGate=null;first.release();
    const result=await request;await flush();
    expect(result).toBe(false);
    expect((await pending()).map(w=>w.trip.name)).toEqual(['PRIVATE REREAD']);
    expect(store.getSnapshot().trips.find(t=>t.id==='shared')?.name).toBe('PRIVATE REREAD');
  });
  it('a re-read still older than the server ledger keeps the held copy',async()=>{
    const store=await fresh(true);await capture(store,'PRIVATE STALE');state.fullReads=0;
    const first=gate(),second=gate();state.readGate=first.promise;state.fullGate=second.promise;
    const request=store.resolveQueuedTripWrite('shared','discard');await flush();
    const newer={...state.rows.get('shared'),name:'CURRENT SHARED',write_version:1,updated_at:20};
    store._applyRealtimeEventForTest('trips',{eventType:'UPDATE',new:newer,old:{}});
    state.readGate=null;first.release();await flush();expect(state.heldFullRead).toBe(2);
    // The re-read started before the server row changed, so it still returns the older row.
    state.rows.set('shared',newer);second.release();
    const result=await request;await flush();
    expect(result).toBe(false);
    expect((await pending()).map(w=>w.trip.name)).toEqual(['PRIVATE STALE']);
    expect(store.getSnapshot().trips.find(t=>t.id==='shared')?.name).toBe('PRIVATE STALE');
  });
  it('a local edit made during the discard refresh keeps its contents and refuses success',async()=>{
    const store=await fresh(true);await capture(store,'PRIVATE EDIT');
    const hold=gate();state.memberGate=hold.promise;
    const request=store.resolveQueuedTripWrite('shared','discard');await flush();
    store.updateTrip('shared',{name:'NEWER EDIT'});await flush();
    state.memberGate=null;hold.release();
    const result=await request;await flush();
    expect(result).toBe(false);
    expect(store.getSnapshot().trips.find(t=>t.id==='shared')?.name).toBe('NEWER EDIT');
    expect((await pending()).map(w=>w.trip.name)).toEqual(['NEWER EDIT']);
  });
  it('a successful discard publishes the server membership and removes the copy',async()=>{
    const store=await fresh(true);await capture(store,'PRIVATE HAPPY');
    state.members=state.members.map(m=>m.user_id==='C'?{...m,role:'viewer'}:m);
    const result=await store.resolveQueuedTripWrite('shared','discard');await flush();
    expect(result).toBe(true);
    expect(await pending()).toEqual([]);
    const shown=store.getSnapshot().trips.find(t=>t.id==='shared');
    expect(shown?.name).toBe('Original plan');
    expect(shown?.members.find(m=>m.userId==='C')?.role).toBe('viewer');
  });
  it('a failed membership read during demotion never publishes an empty membership',async()=>{
    const store=await fresh(true);await capture(store,'PRIVATE DEMOTED');
    const viewer={trip_id:'shared',user_id:'A',role:'viewer',joined_at:1};
    state.members=state.members.map(m=>m.user_id==='A'?viewer:m);
    state.failMemberRead=true;
    store._applyRealtimeEventForTest('trip_members',{eventType:'UPDATE',new:viewer,old:{}});await flush();
    state.failMemberRead=false;
    const shown=store.getSnapshot().trips.find(t=>t.id==='shared');
    expect(shown===undefined||shown.members.length>0).toBe(true);
  });
});
