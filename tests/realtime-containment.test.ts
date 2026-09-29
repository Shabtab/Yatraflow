// ============ Realtime event containment (issue #44) ============
// Every postgres_changes callback used to call applyRealtimeEvent directly. A
// payload that threw took the throw out of the realtime client's own dispatch
// loop, and nothing on screen changed - a user could keep editing a trip whose
// live subscription had stopped, with no error surfaced. connectRealtime does
// have a try/catch, but it only wraps setting the subscription up; it cannot
// catch anything a callback throws minutes later.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { state } = vi.hoisted(() => ({
  state: {
    /** The callback the store registered for each table. */
    handlers: {} as Record<string, (payload: unknown) => void>,
    subscribed: 0,
  },
}))

vi.mock('../src/lib/supabase', () => {
  const noopBuilder: Record<string, unknown> = {
    select: () => noopBuilder, eq: () => noopBuilder, in: () => noopBuilder,
    limit: () => noopBuilder, maybeSingle: () => noopBuilder,
    insert: () => noopBuilder, upsert: () => noopBuilder, update: () => noopBuilder,
    delete: () => noopBuilder,
    then: (res: (v: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(res),
  }
  const chain: Record<string, unknown> = {
    on: (_kind: string, filter: { table: string }, cb: (p: unknown) => void) => {
      state.handlers[filter.table] = cb
      return chain
    },
    subscribe: () => (state.subscribed++, {}),
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: () => noopBuilder,
      channel: () => chain,
      removeChannel: () => Promise.resolve(),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: {} } }),
      },
    },
  }
})

// #367: admin_audit joined the channel (live audit log for admins) — its
// handler ignores every event type but INSERT and is admin-gated, same
// containment contract as the rest.
const TABLES = ['trips', 'trip_members', 'suggestions', 'decisions', 'activity', 'notifications', 'profiles', 'published_itineraries', 'admin_audit']

const validSuggestionInsert = {
  eventType: 'INSERT',
  new: {
    id: 'sg-9', trip_id: 'trip-1', day_index: 0, proposed_by: 'user-a', title: 'Chinese Fish',
    category: 'food', location_name: 'Kerala Diner', lat: 9.93, lng: 76.26, visit_minutes: 45,
    estimated_entry_fee_inr: 0, estimated_transport_inr: 0, votes: [], comments: [], status: 'open', created_at: 1,
  },
  old: {},
}

async function connected() {
  vi.resetModules()
  const store = await import('../src/store/store')
  store.connectRealtime('user-a')
  return store
}

beforeEach(() => {
  state.handlers = {}
  state.subscribed = 0
})

describe('realtime payload containment (#44)', () => {
  it('subscribes every live table', async () => {
    await connected()
    expect(state.subscribed).toBe(1)
    expect(Object.keys(state.handlers).sort()).toEqual([...TABLES].sort())
  })

  it('contains a payload with no body at all instead of throwing out of the callback', async () => {
    await connected()
    // applyRealtimeEvent reads payload.eventType on its first line, so this is
    // the shallowest possible malformed payload - and it used to escape.
    expect(() => state.handlers.suggestions(null)).not.toThrow()
  })

  it('contains a throw from deeper inside a mapper, not just at the front door', async () => {
    await connected()
    // UPDATE with an id but no new row: the trips branch builds a Trip from a
    // row that is not there, so rowToTrip dereferences undefined.
    expect(() => state.handlers.trips({ eventType: 'UPDATE', new: undefined, old: { id: 'trip-1' } })).not.toThrow()
  })

  it('keeps applying later events after a bad one', async () => {
    const store = await connected()
    // The user-visible guarantee: a bad event costs one event, not the session.
    state.handlers.suggestions({ eventType: 'INSERT', new: null, old: {} })
    state.handlers.suggestions(validSuggestionInsert)

    expect(store.getSnapshot().suggestions.map(s => s.id)).toContain('sg-9')
  })

  it('still ignores events with no identifiable row', async () => {
    const store = await connected()
    state.handlers.suggestions({ eventType: 'INSERT', new: {}, old: {} })
    expect(store.getSnapshot().suggestions).toHaveLength(0)
  })
})
