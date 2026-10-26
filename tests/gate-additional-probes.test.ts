import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueuedWrite, WriteQueueStore } from '../src/lib/writeQueue'
import type { TripRow } from '../src/lib/tripRow'
import { profileSession } from './helpers/profileSession'

type Row = Record<string, unknown>
type Operation = { table: string; method: string; actor: string | null; filters: Record<string, unknown>; payload?: Row }

const { state } = vi.hoisted(() => ({ state: {
  actor: 'A' as string | null, sessionGate: null as Promise<void>|null, removeGate: null as Promise<void>|null,
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
          const actor = token?.startsWith('e30.') ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub : state.actor
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
        getSession: async () => { state.sessionCalls++; const actor=state.actor; await state.sessionGate; return { data: { session: actor ? profileSession({ user: { id: actor } }) : null } }; },
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


describe('round three additional real-store behavior', () => {
  it('a failed demotion refresh cannot leave an editable proposal after a regrant and removal', async () => {
    const store=await fresh(true); await capture(store,'PRIVATE DEMOTED COPY');
    const viewer={trip_id:'shared',user_id:'A',role:'viewer',joined_at:1};
    state.members=state.members.map(m=>m.user_id==='A'?viewer:m);
    state.offlineReads=true;
    store._applyRealtimeEventForTest('trip_members',{eventType:'UPDATE',new:viewer,old:{}}); await flush();
    expect((await pending())[0]).toMatchObject({reason:'access-revoked'});
    // The new discard rule assumes reasoned copies are absent from the cache.
    expect(await store.resolveQueuedTripWrite('shared','discard')).toBe(true);
    expect(await pending()).toEqual([]);
    const editor={...viewer,role:'editor'};
    state.members=state.members.map(m=>m.user_id==='A'?editor:m);
    store._applyRealtimeEventForTest('trip_members',{eventType:'UPDATE',new:editor,old:{}}); await flush();
    vi.stubGlobal('navigator',{onLine:false});
    store.updateTrip('shared',{travellers:3}); await store.tripWriteVerdict('shared'); await flush();
    expect((await pending())[0]?.trip.name).not.toBe('PRIVATE DEMOTED COPY');
  });
  it('replay must install the authoritative demotion role before permitting a later local edit', async () => {
    const store=await fresh(true); await capture(store,'FIRST PRIVATE COPY');
    state.members=state.members.map(m=>m.user_id==='A'?{...m,role:'viewer'}:m);
    vi.stubGlobal('navigator',{onLine:true}); await store.replayQueuedWrites(); await flush();
    const before=(await pending())[0];
    expect.soft(store.canEdit(store.roleOf(store.getSnapshot().trips[0],'A'))).toBe(false);
    // UI derives edit availability from this same cached role.
    expect.soft(store.getSnapshot().trips[0].members.find(m=>m.userId==='A')?.role).toBe('viewer');
    expect(before).toMatchObject({reason:'access-revoked',trip:{name:'FIRST PRIVATE COPY'}});
  });
  it('a deleted trip found by hydrate names trip-unavailable rather than membership removal', async () => {
    const store=await fresh(true); await capture(store,'DELETED COPY');
    state.rows.set('shared',{...state.rows.get('shared'),deleted_at:123});
    vi.stubGlobal('navigator',{onLine:true}); await store.resumeSync(); await flush();
    expect(store.getSnapshot().trips).toEqual([]);
    expect((await pending())[0]).toMatchObject({state:'failed',reason:'trip-unavailable'});
  });
  it('reasoned copies remove after a real failed read and keep the shared plan', async () => {
    const store=await fresh(true); await capture(store);
    state.members=state.members.map(m=>m.user_id==='A'?{...m,role:'viewer'}:m);
    vi.stubGlobal('navigator',{onLine:true}); await store.replayQueuedWrites(); await flush();
    state.offlineReads=true; vi.stubGlobal('navigator',{onLine:false});
    expect(await store.resolveQueuedTripWrite('shared','discard')).toBe(true);
    expect(await pending()).toEqual([]); expect(store.getSnapshot().trips[0].name).toBe('Original plan');
    expect(state.writes).toEqual([]);
  });
  it('held failed-read refusal preserves both queue and overlay, then a recovered read removes them', async () => {
    const store=await fresh(true); await capture(store,'HELD COPY');
    state.offlineReads=true;
    expect(await store.resolveQueuedTripWrite('shared','discard')).toBe(false);
    expect((await pending())[0].trip.name).toBe('HELD COPY'); expect(store.getSnapshot().trips[0].name).toBe('HELD COPY');
    state.offlineReads=false;
    expect(await store.resolveQueuedTripWrite('shared','discard')).toBe(true);
    expect(await pending()).toEqual([]); expect(store.getSnapshot().trips[0].name).toBe('Original plan');
  });
  it('an account cannot discard another queued owner', async () => {
    const store=await fresh(true); await capture(store,'A COPY');
    state.actor='B'; state.authHandler('SIGNED_IN',profileSession({user:{id:'B'}})); await flush();
    expect(await store.resolveQueuedTripWrite('shared','discard')).toBe(false);
    expect(state.writes).toEqual([]);
  });
  it('a tombstone during durable discard retains the unavailable copy when discard reports failure',async()=>{
    const store=await fresh(true);await capture(store,'COPY DURING DROP');
    const hold=gate();state.removeGate=hold.promise;state.removeCalls=0;
    const request=store.resolveQueuedTripWrite('shared','discard');await flush();
    expect(state.removeCalls).toBe(1);
    state.rows.delete('shared');store._applyRealtimeEventForTest('trips',{eventType:'DELETE',new:{},old:{id:'shared'}});await flush();
    hold.release();expect(await request).toBe(false);await flush();
    expect((await pending())[0]).toMatchObject({reason:'trip-unavailable',trip:{name:'COPY DURING DROP'}});
    expect(store.getSnapshot().trips).toEqual([]);
  });
  for(const phase of ['initial-list','inner-list','token','server-read','drop','final-list']) {
    for(const transition of ['switch','signout','same-user-new-generation']) {
      // The same-user reauthentication case was the BASE-PRE-EXISTING risk that
      // the independent Gate's own base control reproduced on the base store:
      // a same-user reauthentication during a delayed removal replayed the copy
      // that the sign-out asked to remove. The Gate recorded it as a
      // pre-existing risk rather than a new blocker, and it was the ONLY case
      // here that the base store already failed.
      //
      // The write came from the REPLAY: the Gate instrumented it, and
      // `replayQueuedWrites` calls `sendQueuedTripWrite` after the
      // reauthentication. It did NOT come from the plan persist that a
      // realtime membership change triggers.
      //
      // The v0.78.0 sign-out cleanup fixed that case. The cleanup owns the
      // departing account's records, and a queue read waits for it, so the
      // copy the sign-out asked to remove can no longer be replayed. The case
      // now runs as a plain test that must pass.
      it(`discard ${phase} rejects stale ${transition} without publishing old rows`, async () => {
        const store=await fresh(true); await capture(store,'A PRIVATE COPY');
        const hold=gate(); state.listCount=0; state.operations=[];
        if(phase==='initial-list'||phase==='inner-list'||phase==='final-list') {state.listHoldAt=phase==='initial-list'?1:phase==='inner-list'?2:3;state.listGate=hold.promise;}
        if(phase==='token') state.sessionGate=hold.promise;
        if(phase==='server-read') state.readGate=hold.promise;
        if(phase==='drop') state.removeGate=hold.promise;
        vi.stubGlobal('navigator',{onLine:true});
        const request=store.resolveQueuedTripWrite('shared','discard'); await flush();
        const observed=[];
        store.subscribe(()=>{const s=store.getSnapshot();if((s.sessionUserId==='B'||!s.sessionUserId)&&s.trips.some(t=>t.name==='A PRIVATE COPY'))observed.push(s.sessionUserId);});
        if(transition==='switch') {state.actor='B';state.authHandler('SIGNED_IN',profileSession({user:{id:'B'}}));}
        else {state.actor=null;state.authHandler('SIGNED_OUT',null);}
        await flush();
        if(transition==='same-user-new-generation') {state.actor='A';state.authHandler('SIGNED_IN',profileSession({user:{id:'A'}}));await flush();}
        hold.release(); expect(await request).toBe(false); await flush();
        expect(observed).toEqual([]); expect(state.writes).toEqual([]);
        expect(store.getSnapshot().trips.some(t=>t.name==='A PRIVATE COPY')).toBe(false);
      });
    }
  }
});
