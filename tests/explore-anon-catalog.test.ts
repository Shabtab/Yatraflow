// ============ Logged-out Explore gets a catalog verdict ============
//
// A cold logged-out visit reads the public catalog through the anonymous
// hydrate alone. That patch never wrote `sliceReads`, so Explore's
// `sliceState(sliceReads, 'suggested itineraries')` stayed 'reading' and the
// gallery spun "Loading the catalog…" forever over rows that had loaded.
// Signed-in users never saw it: their hydrate writes the verdict, and logout
// keeps it.
//
// The mock harness is session-lifecycle's shape (same vi.mock of
// lib/supabase), plus per-table error and throw switches.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sliceState } from '../src/lib/readState'

const { state } = vi.hoisted(() => ({
  state: {
    tables: {} as Record<string, unknown[]>,
    errors: {} as Record<string, boolean>,
    throwOn: null as string | null,
    authHandler: null as ((event: string, session: unknown) => void) | null,
    resolveSession: null as (() => void) | null,
    sessionUser: null as string | null,
  },
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, in: () => builder,
      update: () => builder, insert: () => builder, delete: () => builder,
      limit: () => builder, order: () => builder, maybeSingle: () => builder,
      then: (res: (v: { data: unknown; error: unknown }) => unknown, rej?: (e: unknown) => unknown) => {
        if (state.throwOn === table) return Promise.reject(new Error('network down')).then(res, rej)
        const failed = state.errors[table]
        return Promise.resolve({ data: failed ? null : (state.tables[table] ?? []), error: failed ? { message: 'denied' } : null }).then(res, rej)
      },
    }
    return builder
  }
  const chain: Record<string, unknown> = { on: () => chain, subscribe: () => ({}) }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: () => Promise.resolve({ data: [], error: null }),
      channel: () => chain,
      removeChannel: () => Promise.resolve(),
      auth: {
        getSession: () => new Promise(resolve => {
          state.resolveSession = () =>
            resolve({ data: { session: state.sessionUser ? { user: { id: state.sessionUser } } : null } })
        }),
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          state.authHandler = cb
          return { data: { subscription: {} } }
        },
        signOut: () => Promise.resolve({ error: null }),
      },
    },
  }
})

const pubRow = {
  id: 'pub_1', trip_id: 'trip_1', creator_id: 'creator_1', title: 'Spiti Circuit',
  tagline: 'Seven days', route_summary: ['Shimla', 'Kaza'], duration_days: 7,
  estimated_budget_per_person_inr: 25000, travel_style: 'balanced', published_at: 1,
}
const profileRow = { id: 'creator_1', email: 'c@example.com', name: 'Creator', created_at: 1 }

/** Let the store's fire-and-forget async work drain. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

async function coldLoggedOutLoad() {
  vi.resetModules()
  const store = await import('../src/store/store')
  store.init()
  state.resolveSession!()
  await flush()
  await flush()
  return store
}

beforeEach(() => {
  state.tables = { profiles: [profileRow], published_itineraries: [pubRow] }
  state.errors = {}
  state.throwOn = null
  state.authHandler = null
  state.resolveSession = null
  state.sessionUser = null
})

describe('logged-out Explore gets a catalog verdict', () => {
  it('a cold logged-out load marks the catalog ready, so the gallery renders', async () => {
    const store = await coldLoggedOutLoad()
    const db = store.getSnapshot()
    expect(db.sessionUserId).toBeNull()
    expect(db.published.map(p => p.id)).toEqual(['pub_1'])
    // Old behaviour: undefined verdict, which sliceState renders as 'reading'.
    expect(sliceState(db.sliceReads, 'suggested itineraries')).toBe('ready')
    expect(sliceState(db.sliceReads, 'profiles')).toBe('ready')
  })

  it('a failed catalog read reports failed, so Explore offers Retry instead of spinning', async () => {
    state.errors = { published_itineraries: true }
    const store = await coldLoggedOutLoad()
    const { sliceReads } = store.getSnapshot()
    expect(sliceState(sliceReads, 'suggested itineraries')).toBe('failed')
    expect(sliceState(sliceReads, 'profiles')).toBe('ready')
  })

  it('a thrown read marks both public slices failed', async () => {
    state.throwOn = 'profiles'
    const store = await coldLoggedOutLoad()
    const { sliceReads } = store.getSnapshot()
    expect(sliceState(sliceReads, 'suggested itineraries')).toBe('failed')
    expect(sliceState(sliceReads, 'profiles')).toBe('failed')
  })

  it('the logged-out verdict never invents a trips verdict', async () => {
    const store = await coldLoggedOutLoad()
    expect(store.getSnapshot().sliceReads).not.toHaveProperty('trips')
  })
})
