// ============ #383 (Budget's half) + #384 — the read is said, and the settle is gated ============
//
// #383: when the trips read fails, the Budget tab printed "No expense lines
// yet" — identical to a genuine empty ledger — because the component branched
// on the ARRAY, and a failed hydrate leaves the array empty. The store already
// knew (the hydrate's `partial` list); nothing published it per-slice. This
// pins the published verdict and the three-state branch that consumes it.
// There is no `expenses` slice: expenses ride inside the trips row, so the
// trips verdict IS the ledger's status.
//
// #384: the settle writers carried a comment claiming viewers get a silent
// no-op, with no check behind it. Settling is owner/editor only (decided
// 2026-09-25); both writers now enforce it with the house rule
// (`canEdit(roleOf(trip, by))` — the same verdict the trips UPDATE RLS policy
// enforces server-side via is_editor), and both UI paths require a session.
//
// The mock harness is the session-lifecycle one's shape, with per-table error
// injection and a call log — one hydrate serves both issues.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { sliceState } from '../src/lib/readState'
import type { Expense } from '../src/data/types'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const { state, calls } = vi.hoisted(() => ({
  state: {
    tables: {} as Record<string, unknown[]>,
    errors: {} as Record<string, unknown>,
    sessionUser: null as string | null,
    resolveSession: null as (() => void) | null,
  },
  calls: [] as Array<{ table: string; method: string; payload?: unknown }>,
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    let method: string | undefined
    let payload: unknown
    const builder: Record<string, unknown> = {}
    const chain = (m: string, p?: unknown) => { method = m; payload = p; return builder }
    builder.update = (p: unknown) => chain('update', p)
    builder.insert = (p: unknown) => chain('insert', p)
    builder.delete = () => chain('delete')
    builder.select = () => builder
    builder.eq = () => builder
    builder.in = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.maybeSingle = () => builder
    builder.single = () => builder
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      new Promise(resolve => {
        if (method) calls.push({ table, method, payload })
        resolve(state.errors[table]
          ? { data: null, error: state.errors[table] }
          : { data: state.tables[table] ?? [], error: null })
      }).then(res)
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
        onAuthStateChange: () => ({ data: { subscription: {} } }),
        signOut: () => Promise.resolve({ error: null }),
      },
    },
  }
})

function profileRow(id: string) {
  return { id, email: `${id}@example.com`, name: id, created_at: 1 }
}

function memberRow(tripId: string, userId: string, role: string) {
  return { trip_id: tripId, user_id: userId, role, joined_at: 1 }
}

function expense(id: string, label: string): Expense {
  return { id, label, category: 'food', amountInr: 100, perPerson: false, optional: false }
}

function tripRow(id: string, expenses: Expense[]) {
  return {
    id, owner_id: 'u-owner', name: `Trip ${id}`, start_location: 'Kochi',
    start_location_coords: null, destinations: ['Kochi'], destination_coords: null,
    start_date: '2026-10-01', end_date: '2026-10-03', travellers: 2, transport_mode: 'car',
    budget_per_person_inr: 5000, travel_style: 'balanced', fixed_commitments: [],
    days: [], expenses, cover_emoji: '🧭', visibility: 'private',
    created_at: 1, updated_at: 1,
  }
}

/** Let the store's fire-and-forget async work drain. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

async function freshStore() {
  vi.resetModules()
  return await import('../src/store/store')
}

beforeEach(() => {
  state.tables = {}
  state.errors = {}
  state.sessionUser = null
  state.resolveSession = null
  calls.length = 0
})

// ================= #383 — the verdict the hydrate publishes =================

describe('#383 — the hydrate publishes a per-slice verdict, never an invented one', () => {
  it('a failed trips read reads as failed, not as an empty ledger', async () => {
    const store = await freshStore()
    state.sessionUser = 'u-owner'
    state.errors = { trips: { message: 'dropped connection' } }
    state.tables = {
      profiles: [profileRow('u-owner')],
      published_itineraries: [],
      trip_members: [memberRow('tripA', 'u-owner', 'owner')],
      trips: [],
    }
    store.init()
    state.resolveSession!()
    await flush()
    await flush()

    // The global picture can be fine while this slice broke — the per-slice
    // verdict is the only thing a page may branch on.
    expect(store.getSnapshot().sliceReads.trips).toBe('failed')
    expect(store.getSnapshot().sliceReads.profiles).toBe('ok')
    expect(sliceState(store.getSnapshot().sliceReads, 'trips')).toBe('failed')
  })

  it('a slice the run never asked for stays unreported — unread is not ok', async () => {
    const store = await freshStore()
    state.sessionUser = 'u-owner'
    // No memberships: the run reads no trip-scoped slice at all. Reporting
    // those 'ok' anyway would be inventing a success — the mirror mistake.
    state.tables = {
      profiles: [profileRow('u-owner')],
      published_itineraries: [],
      trip_members: [],
      trips: [],
    }
    store.init()
    state.resolveSession!()
    await flush()
    await flush()

    const reads = store.getSnapshot().sliceReads
    expect('trips' in reads).toBe(false)
    expect(sliceState(reads, 'trips')).toBe('reading')
  })

  it('the report covers the asked set and nothing else', async () => {
    const { sliceReadReport, READ_SLICES } = await import('../src/store/store')
    const asked = ['profiles', 'memberships', 'trips', 'members', 'suggested itineraries']
    const report = sliceReadReport(['trips'], asked)
    expect(report.trips).toBe('failed')
    expect(report.profiles).toBe('ok')
    // The logged-out re-read's default set is unchanged — two slices, both named.
    const pub = sliceReadReport([])
    expect(Object.keys(pub).sort()).toEqual([...READ_SLICES].sort())
  })
})

// ================= #383 — the tab branches on the read =================

describe('#383 — the Budget tab branches on the read, not on the array', () => {
  const src = read('../src/pages/trip/BudgetTab.tsx')

  it('fails first, then loads, and only then allows the empty copy', () => {
    // The bug was an ordering bug: the empty copy was reachable while the
    // failure branch did not exist. Same shape as the pages #364 pinned.
    const failed = src.indexOf("emptyCopyFor('failed', 'expenses', retryExpenses)")
    const loading = src.indexOf('Loading expenses…')
    const empty = src.indexOf('No expense lines yet')
    expect(failed).toBeGreaterThan(-1)
    expect(loading).toBeGreaterThan(-1)
    expect(empty).toBeGreaterThan(-1)
    expect(failed, 'the failure branch precedes the loading state').toBeLessThan(loading)
    expect(loading, 'the loading state precedes the empty copy').toBeLessThan(empty)
  })

  it('reads the trips slice — expenses have no slice of their own', () => {
    expect(src).toMatch(/sliceState\(db\.sliceReads, 'trips'\)/)
    // The hunt-saving comment ships with the code.
    expect(src).toMatch(/no `expenses` slice/)
  })

  it('retry re-issues the read instead of re-rendering the cached rows', () => {
    expect(src).toMatch(/void resumeSync\(\)/)
  })

  it('the balances card shares the ledger’s one status', () => {
    // One list, two consumers: the card must not print a settled-up crew or
    // an empty split over a failed read.
    const card = src.indexOf('Who paid · who owes')
    const cardGate = src.indexOf("emptyCopyFor('failed', 'expense lines', retryExpenses)")
    expect(card).toBeGreaterThan(-1)
    expect(cardGate).toBeGreaterThan(card)
  })
})

// ================= #384 — the settle gate =================

describe('#384 — settling is owner/editor only, on both paths', () => {
  const expenses = [expense('e1', 'Fuel'), expense('e2', 'Tolls'), expense('e3', 'Snacks'), expense('e4', 'Parking')]

  async function hydratedCrewStore() {
    const store = await freshStore()
    state.sessionUser = 'u-owner'
    state.tables = {
      profiles: [profileRow('u-owner'), profileRow('u-editor'), profileRow('u-viewer'), profileRow('u-commenter')],
      published_itineraries: [],
      trip_members: [
        memberRow('tripA', 'u-owner', 'owner'),
        memberRow('tripA', 'u-editor', 'editor'),
        memberRow('tripA', 'u-viewer', 'viewer'),
        memberRow('tripA', 'u-commenter', 'commenter'),
      ],
      trips: [tripRow('tripA', expenses)],
    }
    store._setTripWriteDebounceMs(0)
    store.init()
    state.resolveSession!()
    await flush()
    await flush()
    return store
  }

  function expenseOf(store: Awaited<ReturnType<typeof hydratedCrewStore>>, id: string) {
    return store.getSnapshot().trips.find(t => t.id === 'tripA')!.expenses.find(e => e.id === id)!
  }

  it('the owner and an editor can settle and reopen', async () => {
    const store = await hydratedCrewStore()
    store.markExpenseSettled('tripA', 'e1', 'u-owner')
    store.markExpenseSettled('tripA', 'e2', 'u-editor')
    await flush()
    expect(expenseOf(store, 'e1').settled?.by).toBe('u-owner')
    expect(expenseOf(store, 'e2').settled?.by).toBe('u-editor')

    store.markExpenseUnsettled('tripA', 'e1', 'u-owner')
    await flush()
    expect(expenseOf(store, 'e1').settled).toBeUndefined()
  })

  it('a viewer or a commenter is refused, and the line is unchanged', async () => {
    const store = await hydratedCrewStore()
    calls.length = 0
    store.markExpenseSettled('tripA', 'e3', 'u-viewer')
    store.markExpenseSettled('tripA', 'e4', 'u-commenter')
    await flush()
    expect(expenseOf(store, 'e3').settled).toBeUndefined()
    expect(expenseOf(store, 'e4').settled).toBeUndefined()
    // Refused before any write — the cache never moved, so nothing persisted.
    expect(calls.filter(c => c.table === 'trips' && c.method === 'update')).toHaveLength(0)
  })

  it('a reopen needs the session and the role — both holes closed', async () => {
    const store = await hydratedCrewStore()
    store.markExpenseSettled('tripA', 'e1', 'u-owner')
    await flush()
    calls.length = 0
    store.markExpenseUnsettled('tripA', 'e1', null)
    store.markExpenseUnsettled('tripA', 'e1', 'u-viewer')
    await flush()
    // Still settled: a session-less caller and a viewer both get the no-op the
    // store comment always claimed.
    expect(expenseOf(store, 'e1').settled?.by).toBe('u-owner')
    expect(calls.filter(c => c.table === 'trips' && c.method === 'update')).toHaveLength(0)
  })
})

// ================= #384 — the code says what it does =================

describe('#384 — the gate exists in the code, not only in a comment', () => {
  it('both settle writers check the house rule', () => {
    const src = read('../src/store/store.ts')
    // One gate per writer — the settle and the reopen it undoes.
    expect(src.match(/if \(!canEdit\(roleOf\(t, by\)\)\) return/g)?.length ?? 0).toBe(2)
  })

  it('the tab gates the affordance and requires the session on both paths', () => {
    const src = read('../src/pages/trip/BudgetTab.tsx')
    expect(src).toMatch(/canEdit\(roleOf\(trip, me\.id\)\)/)
    // Settle and reopen each check the session before calling the store.
    expect(src.match(/if \(!me\?\.id\) return/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    // The reopen call carries the session id — the old two-arg call is gone.
    expect(src).toMatch(/markExpenseUnsettled\(trip\.id, e\.id, me\.id\)/)
  })

  it('the vestigial busy guard is gone — the handler stays synchronous', () => {
    const src = read('../src/pages/trip/BudgetTab.tsx')
    expect(src).not.toMatch(/busySettleId/)
  })
})
