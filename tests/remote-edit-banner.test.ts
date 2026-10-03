// ============ M6 B3 · remote-edit banner reach + reconnect resync ============
// Two defects behind "no amber banner" from the owner's two-browser pass
// (docs/PLAN-TOGETHER-M6.md follow-up 2):
// 1. BoardView's stop editor (the SAME StopEditor modal the Timeline banners)
//    took no banner prop at all — a crew member editing from the Board edited
//    stale data with no conflict surface. The fix extracts the conflict logic
//    into a shared hook (src/components/useStopConflict.ts) both surfaces use;
//    these tests pin that BOTH call sites stay wired (source invariants — the
//    node env cannot render components) and that the hook's contract holds.
// 2. The realtime channel subscribed bare, so a socket gap (sleep, network
//    switch) silently dropped every row changed while away: the channel
//    rejoined and nothing replayed, leaving the cache — and any open stop
//    editor — stale until a reload. The fix re-subscribes with a status
//    callback that, on every SUBSCRIBED that is a RE-join, refetches the
//    cached trip rows and dispatches them through the SAME applyRealtimeEvent
//    path a live UPDATE takes.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { seedData } from '../src/data/seed'
import { stopWasRemotelyEdited, canonicalKey } from '../src/lib/realtimeCore'

const REPO = resolve(__dirname, '..')
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8')

// ---- source invariants: both editor surfaces must ride the shared hook ----
describe('source invariants — the banner is wired on BOTH editor surfaces', () => {
  const timeline = read('src/pages/trip/TimelineTab.tsx')
  const board = read('src/components/BoardView.tsx')

  it('TimelineTab uses the shared conflict hook (no inline copy to drift)', () => {
    expect(timeline).toContain('useStopConflict(trip, editorState)')
    // the old inline implementation must be gone
    expect(timeline).not.toContain('setConflictSnapshot')
  })

  it('BoardView uses the shared conflict hook and passes the banner', () => {
    expect(board).toContain('useStopConflict(trip, editorTarget)')
    expect(board).toContain('banner={conflictState.conflict')
    expect(board).toContain('onTakeTheirs={conflictState.takeTheirs}')
  })

  it('BoardView routes editor opens through the snapshot-taking opener', () => {
    // every open path must go through openEditorTarget (which snapshots);
    // a raw setEditorTarget({mode:'edit'...}) would skip the snapshot
    expect(board).not.toMatch(/setEditorTarget\(\{\s*mode: 'edit'/)
    // A stable useCallback (#372's memo pass), still routed through the opener.
    expect(board).toMatch(/const handleEdit = useCallback\(\(stopId: string\) => openEditorTarget\(\{ mode: 'edit', stopId \}\), \[openEditorTarget\]\)/)
    expect(board).toMatch(/onEdit=\{handleEdit\}/)
  })

  it('StopEditor still renders the banner above the form', () => {
    expect(read('src/components/StopEditor.tsx')).toContain('{banner}')
  })
})

// ---- hook contract (pure logic, extracted from the component) ----
describe('useStopConflict contract — detection via stopWasRemotelyEdited', () => {
  const opened = { id: 's1', title: 'Old title', visitMinutes: 30 }
  const remote = { id: 's1', visitMinutes: 30, title: 'New title' }

  it('a remote field change flags the conflict', () => {
    expect(stopWasRemotelyEdited(opened, remote)).toBe(true)
  })

  it('a key-reordered row (jsonb on the wire) does NOT phantom-flag', () => {
    expect(canonicalKey(opened)).toBe(canonicalKey({ visitMinutes: 30, id: 's1', title: 'Old title' }))
    expect(stopWasRemotelyEdited(opened, { visitMinutes: 30, id: 's1', title: 'Old title' })).toBe(false)
  })

  it('take-theirs re-arms the snapshot so a FURTHER edit re-flags', () => {
    // the hook's takeTheirs re-snapshots from the live stop; the equivalent
    // state transition: comparing the NEW live row against ITSELF is quiet
    expect(stopWasRemotelyEdited(remote, remote)).toBe(false)
    // ...and a later remote change against the new snapshot flags again
    expect(stopWasRemotelyEdited(remote, { ...remote, title: 'Newer' })).toBe(true)
  })
})

// ---- reconnect resync: store-level, through the mocked client ----
const { calls, state } = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; method: string }>,
  state: {
    handlers: {} as Record<string, (payload: unknown) => void>,
    statusCb: undefined as undefined | ((status: string) => void),
    /** the rows the mock's select returns for the resync refetch */
    resyncRows: [] as Record<string, unknown>[],
  },
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const builder: Record<string, unknown> = {}
    const chain = () => builder
    builder.update = () => chain()
    builder.insert = () => chain()
    builder.upsert = () => chain()
    builder.delete = () => chain()
    builder.select = () => { calls.push({ table, method: 'select' }); return builder }
    builder.eq = () => builder
    builder.in = (_col: string, ids: string[]) => {
      calls.push({ table, method: `in(${ids.length})` })
      return builder
    }
    builder.order = () => builder
    builder.limit = () => builder
    builder.maybeSingle = () => builder
    builder.single = () => builder
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data: table === 'trips' ? state.resyncRows : [], error: null }).then(res)
    return builder
  }
  const chainObj: Record<string, unknown> = {
    on: (_k: string, filter: { table: string }, cb: (p: unknown) => void) => {
      state.handlers[filter.table] = cb
      return chainObj
    },
    subscribe: (cb?: (status: string) => void) => {
      state.statusCb = cb
      return chainObj
    },
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: (t: string) => makeBuilder(t),
      channel: () => chainObj,
      removeChannel: () => Promise.resolve(),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: {} } }),
      },
    },
  }
})

import {
  connectRealtime, disconnectRealtime, tripById, duplicateTrip, _applyRealtimeEventForTest,
  _clearRecentLocalWrites, _setTripWriteDebounceMs,
} from '../src/store/store'

const keralaTrip = seedData.trips[0]

beforeEach(() => {
  calls.length = 0
  state.resyncRows = []
  _clearRecentLocalWrites()
  _setTripWriteDebounceMs(0)
})

function resyncPayloadOf(tripId: string): Record<string, unknown> {
  const t = tripById(tripId)!
  return {
    id: t.id, owner_id: 'owner-test', name: t.name,
    start_location: t.startLocation, destinations: t.destinations,
    start_date: t.startDate, end_date: t.endDate,
    travellers: t.travellers, transport_mode: t.transportMode,
    budget_per_person_inr: t.budgetPerPersonInr, travel_style: t.travelStyle,
    fixed_commitments: t.fixedCommitments, expenses: t.expenses,
    visibility: t.visibility,
    days: JSON.parse(JSON.stringify(t.days)),
    updated_at: new Date().toISOString(),
  }
}

describe('reconnect resync — re-SUBSCRIBED replays cached trips through the live path', () => {
  it('first SUBSCRIBED does NOT resync (hydration just fetched these rows)', async () => {
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    await new Promise(r => setTimeout(r, 0))
    _clearRecentLocalWrites()
    connectRealtime('owner-test')
    state.statusCb?.('SUBSCRIBED')
    await vi.waitFor(() => { expect(calls.filter(c => c.method.startsWith('in('))).toHaveLength(0) })
    disconnectRealtime()
  })

  it('a RE-subscribe refetches cached trip rows and dispatches them as UPDATEs', async () => {
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    await new Promise(r => setTimeout(r, 0))
    _clearRecentLocalWrites()
    connectRealtime('owner-test')
    state.statusCb?.('SUBSCRIBED') // first join — skipped
    state.resyncRows = [resyncPayloadOf(trip.id)]
    // mutate a field the resync will overwrite, to prove the row re-lands
    state.resyncRows[0].name = 'Resynced name'
    state.statusCb?.('SUBSCRIBED') // re-join after a socket gap
    await vi.waitFor(() => {
      expect(calls.some(c => c.table === 'trips' && c.method.startsWith('in('))).toBe(true)
    })
    // the dispatch ran the SAME handler a live UPDATE takes: the cache shows it
    await vi.waitFor(() => {
      expect(tripById(trip.id)?.name).toBe('Resynced name')
    })
    disconnectRealtime()
  })

  it('non-SUBSCRIBED statuses never trigger a resync', async () => {
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    await new Promise(r => setTimeout(r, 0))
    _clearRecentLocalWrites()
    connectRealtime('owner-test')
    state.statusCb?.('CHANNEL_ERROR')
    state.statusCb?.('TIMED_OUT')
    state.statusCb?.('CLOSED')
    await new Promise(r => setTimeout(r, 10))
    expect(calls.filter(c => c.method.startsWith('in('))).toHaveLength(0)
    disconnectRealtime()
  })

  it('the resync path is guarded by the same echo window + B2 ledger as a live event', () => {
    // structural pin: the synthetic dispatch goes through applyRealtimeEvent
    // (the live-event handler), not a bespoke cache write that would bypass
    // echo suppression and the stale guard. #568 — the resync now speaks the
    // feedSynthetic grammar for every slice, and feedSynthetic wraps the same
    // applyRealtimeEvent.
    const store = read('src/store/store.ts')
    expect(store).toContain('void resyncTripsAfterReconnect()')
    expect(store).toMatch(/resyncTripsAfterReconnect[\s\S]*?feedSynthetic\('trips'/)
    const fnStart = store.indexOf('function feedSynthetic')
    expect(store.slice(fnStart, fnStart + 500)).toContain('applyRealtimeEvent(table,')
  })
})

// ---- the live dispatch path itself keeps working (regression guard) ----
describe('live dispatch still lands a remote stop edit (banner precondition)', () => {
  it('a trips UPDATE swaps the cached days so the open-editor compare sees it', async () => {
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    await new Promise(r => setTimeout(r, 0))
    _clearRecentLocalWrites()
    const before = tripById(trip.id)!
    const row = resyncPayloadOf(trip.id)
    const days = JSON.parse(JSON.stringify(before.days)) as Array<{ stops: Array<{ id: string; title?: string }> }>
    days[0].stops[0].title = 'Remotely renamed'
    row.days = days
    row.updated_at = new Date().toISOString()
    _applyRealtimeEventForTest('trips', {
      eventType: 'UPDATE', schema: 'public', table: 'trips',
      commit_timestamp: new Date().toISOString(),
      old: {}, new: row,
    } as never)
    expect(tripById(trip.id)!.days[0].stops[0].title).toBe('Remotely renamed')
  })
})
