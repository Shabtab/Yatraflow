// ============ Wave F2 — My Trips defects (#385 shared reset, #386 seed dedupe + failed-read gate) ============
// #385: the toolbar ghost reset four fields while the empty-state action reset
// three and left `sortKey`, so a sort-only empty was unfixable by its own
// button. One helper, both call sites, no inline resets left to drift.
// #386: manual "Load demo trips" appended a full set per click with no dedupe
// and stayed offered over failed reads. It now refuses when the library
// already holds the seed's names, while a seed is in flight, and while the
// trips slice reads failed — both wirings call the same guarded function.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { seedData } from '../src/data/seed'
import { tripToRow } from '../src/lib/tripRow'

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const page = () => src('../src/pages/TripsList.tsx')
const storeSrc = () => src('../src/store/store.ts')

describe('#385 — one reset for both Clear filters buttons', () => {
  it('defines a single helper that resets all four fields', () => {
    const p = page()
    const at = p.indexOf('function clearFilters()')
    expect(at).toBeGreaterThan(-1)
    const body = p.slice(at, p.indexOf('}', at) + 1)
    for (const setter of [`setQ('')`, `setStyle('all')`, `setWhen('all')`, `setSortKey('recent')`]) {
      expect(body, `the shared reset must ${setter}`).toContain(setter)
    }
  })

  it('both buttons call the helper and no inline triple-reset remains', () => {
    const p = page()
    expect(p.split('onClick={clearFilters}').length - 1).toBe(2)
    // The sort reset lives in exactly one place now: a second literal would be
    // a second reset waiting to drift again.
    expect(p.split(`setSortKey('recent')`).length - 1).toBe(1)
    expect(p.split(`setWhen('all')`).length - 1).toBe(1)
  })

  it('keeps the ghost mounting and the screen-reader match count', () => {
    const p = page()
    expect(p).toContain('visibility: hasFilters')
    expect(p).toContain('role="status"')
  })
})

describe('#386 — the manual seed refuses duplicates and broken reads (source)', () => {
  function bodyOf(name: string): string {
    const at = storeSrc().indexOf(`function ${name}(`)
    expect(at, `store never defines ${name}`).toBeGreaterThan(-1)
    const next = storeSrc().indexOf('export ', at + name.length + 10)
    return next >= 0 ? storeSrc().slice(at, next) : storeSrc().slice(at)
  }

  it('gates on the trips verdict, dedupes on the seed signature, guards re-entry', () => {
    const body = bodyOf('addDemoTrips')
    expect(body).toContain(`sliceReads['trips']`)
    expect(body).toContain('DEMO_SEED_NAMES')
    expect(body).toContain('demoSeedInFlight')
  })

  it('both wirings call the same guarded function', () => {
    expect(page().split('onClick={addDemoTrips}').length - 1).toBe(2)
  })

  it('keeps the load-bearing seed mechanics it did not change', () => {
    const s = storeSrc()
    // Silent-write failures must never re-trigger seeding; the post-seed
    // re-hydrate keeps seedIfEmpty:false (without it hydrate ↔ seed recursed).
    expect(s).toContain('!tripCountUnknown')
    expect(s).toContain('seedIfEmpty: false')
    // The member-insert path and its failure log stay intact.
    expect(s).toContain('seed trip member insert failed')
  })

  it('the header seed button stands down while the trips read is failed', () => {
    expect(page()).toContain(`disabled={tripsRead === 'failed'}`)
  })
})

// ---------------- Behavior, against a stateful in-memory Supabase double ----
// Tables persist across calls inside one module instance (like Postgres), so a
// second seed can actually find the first one's rows — the shape that caught
// the endless-duplicate bug. Each test gets a FRESH store (resetModules +
// dynamic import) with flags steering the double.
const { state } = vi.hoisted(() => ({
  state: {
    tables: {} as Record<string, Record<string, unknown>[]>,
    sessionUser: null as string | null,
    failTrips: false,
  },
}))

vi.mock('../src/lib/supabase', () => {
  const err = (message: string) => ({ message })
  const makeBuilder = (table: string) => {
    const rows = (state.tables[table] ??= [])
    let method: string | undefined
    let payload: unknown
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      update: (p: unknown) => { method = 'update'; payload = p; return builder },
      insert: (p: unknown) => { method = 'insert'; payload = p; return builder },
      delete: () => { method = 'delete'; return builder },
      maybeSingle: () => builder,
      single: () => builder,
      then: (res: (v: { data: unknown; error: unknown }) => unknown) => {
        if (method === 'insert') {
          for (const row of Array.isArray(payload) ? payload : [payload]) {
            rows.push(row as Record<string, unknown>)
          }
          return Promise.resolve({ data: null, error: null }).then(res)
        }
        if (table === 'trips' && state.failTrips && method === undefined) {
          return Promise.resolve({ data: null, error: err('trips read failed') }).then(res)
        }
        return Promise.resolve({ data: [...rows], error: null }).then(res)
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
        getSession: () => Promise.resolve({ data: { session: state.sessionUser ? { user: { id: state.sessionUser } } : null } }),
        onAuthStateChange: () => ({ data: { subscription: {} } }),
        signOut: () => Promise.resolve(),
      },
      removeChannel: () => Promise.resolve(),
    },
  }
})

function seedRow(tripName: string, id: string, owner: string) {
  const trip = { ...structuredClone(seedData.trips[0]), id, name: tripName, members: [{ userId: owner, role: 'owner' as const, joinedAt: 1 }] }
  return {
    ...tripToRow(trip, owner),
    created_at: 1,
    updated_at: 1,
  }
}

async function freshStore() {
  vi.resetModules()
  return import('../src/store/store')
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  state.tables = {}
  state.sessionUser = 'userA'
  state.failTrips = false
})

describe('#386 — the seed writes once and refuses over broken reads', () => {
  it('refuses a re-seed when the library already holds the seed names', async () => {
    // A prior session seeded and the rows persisted: one demo name on disk.
    state.tables = {
      trips: [seedRow(seedData.trips[0].name, 'old-demo-1', 'userA')],
      trip_members: [{ trip_id: 'old-demo-1', user_id: 'userA', role: 'owner', joined_at: 1 }],
    }
    const store = await freshStore()
    store.init()
    await vi.waitFor(() => expect(store.getSnapshot().ready).toBe(true))
    store.addDemoTrips()
    await settle()
    expect(state.tables['trips']).toHaveLength(1)
    expect(state.tables['trip_members']).toHaveLength(1)
  })

  it('a second click while the first seed is still in flight mints nothing', async () => {
    // One ordinary trip on disk: no auto-seed on boot, no demo names cached.
    state.tables = {
      trips: [seedRow('My Custom Trip', 'mine-1', 'userA')],
      trip_members: [{ trip_id: 'mine-1', user_id: 'userA', role: 'owner', joined_at: 1 }],
    }
    const store = await freshStore()
    store.init()
    await vi.waitFor(() => expect(store.tripsForUser('userA')).toHaveLength(1))
    // Same tick, no flush between: the first call has not resolved, so the
    // second can only be stopped by the re-entrancy guard (the cache cannot
    // have changed yet).
    store.addDemoTrips()
    store.addDemoTrips()
    await vi.waitFor(() => expect(store.tripsForUser('userA')).toHaveLength(4))
    expect(state.tables['trips']).toHaveLength(4)
  })

  it('refuses the manual seed while the trips slice reads failed', async () => {
    state.tables = {
      trips: [seedRow('My Custom Trip', 'mine-1', 'userA')],
      trip_members: [{ trip_id: 'mine-1', user_id: 'userA', role: 'owner', joined_at: 1 }],
    }
    const store = await freshStore()
    store.init()
    await vi.waitFor(() => expect(store.tripsForUser('userA')).toHaveLength(1))
    // Break the trips read exactly like a dropped connection does, then retry
    // the slice: the verdict — the manual gate's only input — must be failed.
    state.failTrips = true
    await store.rereadTrips()
    expect(store.getSnapshot().sliceReads['trips']).toBe('failed')
    store.addDemoTrips()
    await settle()
    expect(state.tables['trips']).toHaveLength(1)
  })
})
