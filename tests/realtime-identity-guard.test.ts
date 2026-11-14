import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ handlers: [] as Array<(payload: unknown) => void> }))

vi.mock('../src/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    channel: () => {
      const channel = {
        on: (_kind: string, filter: { table: string }, callback: (payload: unknown) => void) => {
          if (filter.table === 'suggestions') state.handlers.push(callback)
          return channel
        },
        subscribe: vi.fn(),
      }
      return channel
    },
    removeChannel: () => new Promise(() => {}),
  },
}))

const event = {
  eventType: 'INSERT', old: {},
  new: {
    id: 'suggestion-a', trip_id: 'trip-a', proposed_by: 'user-a', title: 'Visit museum',
    category: 'activity', votes: [], comments: [], status: 'open', created_at: 1,
  },
}

beforeEach(() => {
  vi.resetModules()
  state.handlers = []
})

it.each(['epoch', 'user', 'disconnect', 'reconnect'])(
  'drops repeated events from the old channel after %s changes', async boundary => {
    const store = await import('../src/store/store')
    store.getSnapshot().sessionUserId = 'user-a'
    store.connectRealtime('user-a')
    const deliver = state.handlers[0]
    deliver(event)
    expect(store.getSnapshot().suggestions.map(row => row.id)).toEqual(['suggestion-a'])
    store.getSnapshot().suggestions = []

    if (boundary === 'epoch') store._bumpIdentityEpochForTest()
    if (boundary === 'user') store.getSnapshot().sessionUserId = 'user-b'
    if (boundary === 'disconnect' || boundary === 'reconnect') store.disconnectRealtime()
    if (boundary === 'reconnect') store.connectRealtime('user-a')
    const before = structuredClone(store.getSnapshot())
    deliver(event)
    deliver({ ...event, new: { ...event.new, id: 'suggestion-b' } })
    expect(store.getSnapshot()).toEqual(before)

    if (boundary === 'reconnect') {
      state.handlers[1](event)
      expect(store.getSnapshot().suggestions.map(row => row.id)).toEqual(['suggestion-a'])
    }
    store.disconnectRealtime()
  },
)
