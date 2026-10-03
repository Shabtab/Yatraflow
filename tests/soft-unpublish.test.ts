// ============ #350 — soft-unpublish keeps the row, and the buyers ============
//
// Unpublishing a paid itinerary used to DELETE its `published_itineraries` row,
// and `entitlements`, `purchase_orders` and `pub_events` all cascade off
// `pub_id`. One click on the creator's own Share tab therefore took away what
// people had already paid for — with no refund anywhere in that statement — and
// destroyed the creator's sales ledger and funnel history with it.
//
// The tests below are written so that the OLD behaviour fails them, not merely
// so that the new one passes: every assertion here is about the row surviving
// and about the CALL the store actually made (an update, never a delete), so a
// regression that quietly goes back to deleting cannot pass by re-rendering.
//
// They run against the real store with a mocked wire, plus two source
// invariants — the store's unpublish paths and the migration — because the
// cascade is a property of the client and the schema together, and neither half
// can prove it alone. Node env, no DOM: nothing here renders a page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { seedData } from '../src/data/seed'
import type { PublishedItinerary, Trip } from '../src/data/types'
// The catalog's own predicate, imported rather than re-implemented: a test that
// asserts its own copy of a filter proves only that the copy agrees with itself.
import { livePubs } from '../src/lib/livePubs'

const { calls, rpcCalls, probe, toast } = vi.hoisted(() => ({
  /** Every chained query the store built, in order. */
  calls: [] as Array<{ table: string; method: string; payload?: unknown; eq?: [unknown, unknown] }>,
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
  /** `unpublishedAt: false` simulates a database without the migration — the
   *  state production is in until the user applies it by hand. */
  probe: { unpublishedAt: true },
  toast: vi.fn(),
}))

vi.mock('../src/lib/supabase', () => {
  function builder(table: string) {
    let method: string | undefined
    let payload: unknown
    let eq: [unknown, unknown] | undefined
    const qb: Record<string, unknown> = {}
    const chain = (m: string, p?: unknown) => { method = m; payload = p; return qb }
    qb.update = (p?: unknown) => chain('update', p)
    qb.insert = (p?: unknown) => chain('insert', p)
    qb.upsert = (p?: unknown) => chain('upsert', p)
    qb.delete = () => chain('delete')
    qb.select = (cols?: unknown) => { method = 'select'; payload = cols; return qb }
    qb.eq = (col: unknown, val: unknown) => { eq = [col, val]; return qb }
    qb.in = () => qb
    qb.order = () => qb
    qb.limit = () => qb
    qb.maybeSingle = () => qb
    qb.single = () => qb
    // BOTH handlers, always: a thenable that resolves `then(res)` alone leaves
    // the rejection path unsettled and an awaiting caller hangs to the timeout.
    qb.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      // The capability probe is `select('unpublished_at').limit(1)`: a real
      // pre-migration database answers it with the column-does-not-exist error.
      const error = table === 'published_itineraries' && method === 'select'
        && payload === 'unpublished_at' && !probe.unpublishedAt
        ? { code: '42703', message: 'column published_itineraries.unpublished_at does not exist' }
        : null
      if (method) calls.push({ table, method, payload, eq })
      return Promise.resolve({ data: null, error }).then(res, rej)
    }
    return qb
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: (t: string) => builder(t),
      rpc: (fn: string, args: unknown) => {
        rpcCalls.push({ fn, args })
        return Promise.resolve({ data: null, error: null })
      },
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      channel: () => ({ on() { return this }, subscribe() { return this } }),
      removeChannel: () => {},
    },
  }
})

// The console gate is a session fact, not the question under test here.
vi.mock('../src/lib/adminSession', () => ({
  isAdminCached: () => true,
  adminFromSession: () => true,
  clearAdminCache: () => {},
}))

// The REAL `components/ui`, with only its toast replaced: Explore imports
// several components from it and a partial mock would fail on the first one it
// reaches for.
vi.mock('../src/components/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast,
}))

const CREATOR = 'creator-350'
const TRIP = 'trip-350'
const PUB = 'pub-350'

function pub(over: Partial<PublishedItinerary> = {}): PublishedItinerary {
  return {
    id: PUB, tripId: TRIP, creatorId: CREATOR, title: 'Kerala, softly',
    tagline: 'A backwater week', routeSummary: ['Kochi', 'Alleppey'],
    durationDays: 5, estimatedBudgetPerPersonInr: 24000, travelStyle: 'balanced',
    travelTips: [], warningsAndAssumptions: [], freeDayIndexes: [0],
    premiumPriceInr: 199, publishedAt: 1_700_000_000_000, views: 40, copies: 3,
    ...over,
  }
}

function trip(): Trip {
  return {
    ...structuredClone(seedData.trips[0]),
    id: TRIP,
    visibility: 'public',
    members: [{ userId: CREATOR, role: 'owner', joinedAt: 1 }],
  }
}

/** The publish payload a creator's Share tab sends — no marker of its own. */
const publishPayload = {
  tripId: TRIP, creatorId: CREATOR, title: 'Kerala, softly', tagline: 'A backwater week',
  // #354 — the writer enforces the publish rules now, so this payload has to be
  // a VALID publication for these tests to reach the behaviour they are about
  // (the soft-unpublish marker). It is priced at ₹199, so it needs all three:
  // a cover, at least one free day, and — because a premium day exists — a
  // call-to-action. Every one of those is a real rule, not a test convenience.
  coverImageUrl: 'https://images.example.test/kerala.jpg',
  routeSummary: ['Kochi', 'Alleppey'], durationDays: 5, estimatedBudgetPerPersonInr: 24000,
  travelStyle: 'balanced' as const, bestSeason: 'winter', travelTips: [],
  warningsAndAssumptions: [], freeDayIndexes: [0], premiumPriceInr: 199,
  subscriberCta: 'The full backwater checklist, with stay contacts.',
}

/** A fresh module per case: the capability probe memoizes its promise (the
 *  production behaviour), which would otherwise pin one answer for the file. */
async function freshStore() {
  vi.resetModules()
  const store = await import('../src/store/store')
  const snap = store.getSnapshot() as unknown as {
    sessionUserId: string | null
    published: PublishedItinerary[]
    trips: Trip[]
  }
  snap.sessionUserId = CREATOR
  snap.trips = [trip()]
  snap.published = [pub()]
  return store
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const row = (store: Awaited<ReturnType<typeof freshStore>>) => store.getSnapshot().published.find(p => p.id === PUB)
const deletes = () => calls.filter(c => c.method === 'delete')
const writes = (table: string) => calls.filter(c => c.table === table && c.method !== 'select')
const toastLines = () => toast.mock.calls.map(c => String(c[0]))

beforeEach(() => {
  calls.length = 0
  rpcCalls.length = 0
  probe.unpublishedAt = true
  toast.mockClear()
})

afterEach(() => { vi.restoreAllMocks() })

describe('#350 — unpublishing is soft: the row stays, the call is an UPDATE', () => {
  it('keeps the publication in the cache, stamped, and never deletes it', async () => {
    const store = await freshStore()

    store.unpublishItinerary(TRIP)
    await flush()

    const after = row(store)
    // The row surviving IS the fix: entitlements/purchase_orders/pub_events all
    // cascade off this id, so removing it is what took a buyer's purchase away.
    expect(after, 'the publication row survives an unpublish').toBeDefined()
    expect(typeof after!.unpublishedAt).toBe('number')

    // Asserted on the recorded call, not just on the cache — a test that only
    // read the cache would still pass if the code deleted the row server-side.
    expect(deletes(), 'no DELETE may reach the wire from the unpublish path').toHaveLength(0)
    const update = calls.find(c => c.table === 'published_itineraries' && c.method === 'update')
    expect(update, 'the marker is persisted with an UPDATE').toBeDefined()
    expect(update!.payload).toEqual({ unpublished_at: after!.unpublishedAt })
    expect(update!.eq).toEqual(['id', PUB])
    // And it is the row's OWN publication that was stamped, not some other trip.
    expect(writes('published_itineraries')).toHaveLength(1)
  })

  it('never makes the trip private — that would silently revoke every buyer', async () => {
    const store = await freshStore()
    expect(store.getSnapshot().trips[0].visibility).toBe('public')

    store.unpublishItinerary(TRIP)
    await flush()

    // The old path flipped this to 'private', and `get_public_trip` requires
    // `visibility = 'public'` to serve an entitled buyer — so the flip revoked
    // the access the soft policy exists to preserve.
    expect(store.getSnapshot().trips[0].visibility).toBe('public')
    expect(writes('trips'), 'unpublish must not write to trips at all').toHaveLength(0)
  })

  it('keeps the owner gate, and its exact message', async () => {
    const store = await freshStore()
    ;(store.getSnapshot() as unknown as { sessionUserId: string | null }).sessionUserId = 'not-the-owner'

    store.unpublishItinerary(TRIP)
    await flush()

    expect(toastLines()).toContain('Only the trip owner can unpublish this itinerary.')
    expect(row(store)!.unpublishedAt).toBeUndefined()
    expect(writes('published_itineraries')).toHaveLength(0)
  })
})

describe('#350 — re-publishing clears the marker, in the cache and on the wire', () => {
  it('a re-published plan is live again, not hidden forever', async () => {
    const store = await freshStore()
    store.unpublishItinerary(TRIP)
    await flush()
    expect(typeof row(store)!.unpublishedAt).toBe('number')
    calls.length = 0

    const republished = await store.publishItinerary(publishPayload)

    // The optimistic row: a re-publish builds a fresh object, so the marker the
    // caller never asked for cannot ride along.
    expect(store.getSnapshot().published.find(p => p.id === republished.id)?.unpublishedAt).toBeUndefined()
    const upsert = calls.find(c => c.table === 'published_itineraries' && c.method === 'upsert')
    expect(upsert, 'the publication was persisted').toBeDefined()
    expect(upsert!.payload).toMatchObject({ unpublished_at: null })
  })

  it('a pre-migration database still publishes — the missing column is not named', async () => {
    // Naming a column that does not exist fails the WHOLE statement (PostgREST),
    // which would break publishing for every creator on an un-migrated project.
    probe.unpublishedAt = false
    const store = await freshStore()

    await store.publishItinerary(publishPayload)

    const upsert = calls.find(c => c.table === 'published_itineraries' && c.method === 'upsert')
    expect(upsert, 'the publication was persisted').toBeDefined()
    expect(upsert!.payload).not.toHaveProperty('unpublished_at')
  })
})

describe('#350 — pre-migration degradation: refuse, never fall back to deleting', () => {
  it('changes nothing, tells the user why, and warns with the migration file', async () => {
    probe.unpublishedAt = false
    const store = await freshStore()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    store.unpublishItinerary(TRIP)
    await flush()

    // Still live: no marker, no write of any kind (the probe's own SELECT is
    // the only call this path made).
    expect(row(store), 'the row is still there').toBeDefined()
    expect(row(store)!.unpublishedAt).toBeUndefined()
    expect(writes('published_itineraries'), 'refuse means change nothing').toHaveLength(0)
    expect(deletes()).toHaveLength(0)

    const said = [...toastLines(), ...warn.mock.calls.map(c => String(c[0]))].join(' | ')
    expect(said).toContain('20260925_publication_soft_unpublish.sql')
  })
})

describe('#350 — the admin console obeys the same policy', () => {
  it('adminUnpublish stamps the row, keeps it, and leaves visibility alone', async () => {
    const store = await freshStore()

    const ok = await store.adminUnpublish(TRIP)

    expect(ok).toBe(true)
    const after = row(store)
    expect(after, 'the admin path does not strip the publication').toBeDefined()
    expect(typeof after!.unpublishedAt).toBe('number')
    // The trip flip is the half of the old admin path that revoked buyers.
    expect(store.getSnapshot().trips[0].visibility).toBe('public')
    expect(writes('trips')).toHaveLength(0)
    expect(deletes()).toHaveLength(0)
    expect(rpcCalls.map(c => c.fn)).toContain('admin_unpublish')
    expect(rpcCalls.find(c => c.fn === 'admin_unpublish')!.args).toEqual({ p_trip_id: TRIP })
    // The toast must not claim the publication was removed — nothing was.
    expect(toastLines()).toContain('Publication unpublished.')
    expect(toastLines().join(' ')).not.toContain('Publication removed')
  })
})

describe('#350 — cascade audit: the sources cannot silently destroy a purchase', () => {
  const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  /** Code only — comments removed. Every file here explains itself at length,
   *  so an assertion about what a file DOES must not be satisfied by a sentence
   *  describing it (the trap `tests/purchase-share-card.test.ts` documents). */
  const codeOf = (source: string) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*(\/\/|--)/.test(line))
    .join('\n')

  const sqlCode = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')

  /** One function's own text: from its signature to the next top-level export. */
  function fnBody(source: string, signature: string): string {
    const start = source.indexOf(signature)
    expect(start, `${signature} not found`).toBeGreaterThan(-1)
    const next = source.indexOf('\nexport ', start + 1)
    return source.slice(start, next === -1 ? source.length : next)
  }

  /** One SQL function's own text, sliced by its `$$ … $$` body delimiters. */
  function sqlFunction(source: string, name: string): string {
    const marker = `create or replace function public.${name}`
    const start = source.indexOf(marker)
    expect(start, `${name} not found`).toBeGreaterThan(-1)
    const open = source.indexOf('$$', start)
    const close = source.indexOf('$$', open + 2)
    const end = source.indexOf(';', close + 2)
    expect(open > -1 && close > -1 && end > -1, `${name} body is unterminated`).toBe(true)
    return source.slice(start, end + 1)
  }

  it('the store\'s unpublish paths contain no delete at all', () => {
    const store = src('../src/store/store.ts')
    const owner = codeOf(fnBody(store, 'export function unpublishItinerary'))
    expect(owner).not.toMatch(/\.delete\s*\(/)
    expect(owner).toMatch(/\.update\(\{ unpublished_at: stamp \}\)/)
    expect(owner).not.toMatch(/visibility/)

    const admin = codeOf(fnBody(store, 'export async function adminUnpublish'))
    expect(admin).not.toMatch(/\.delete\s*\(/)
    expect(admin).not.toMatch(/visibility/)
    // It must not filter the row out of the cache either — that is the same
    // loss one layer up, in the creator's own ledger.
    expect(admin).not.toMatch(/prevPubs\.filter/)
    expect(admin).toMatch(/unpublishedAt: stamp/)
  })

  it('the migration keeps the row: a marker, no publication DELETE, no trip flip', () => {
    const MIGRATION = '20260925_publication_soft_unpublish.sql'
    const sql = src(`../supabase/migrations/${MIGRATION}`)
    const code = sqlCode(sql)

    // The column the client writes, in the unit its siblings use.
    expect(code).toMatch(/alter table public\.published_itineraries\s+add column if not exists unpublished_at bigint/)

    // The cascade this issue is about: the file that replaces the deleting
    // unpublish must never delete a publication row.
    expect(code).not.toMatch(/delete from public\.published_itineraries/i)

    // `get_public_trip` keeps serving buyers and turns away everyone else —
    // not a locked preview, and not the real days.
    expect(code).toMatch(/if v_pub\.unpublished_at is not null then/)
    expect(code).toMatch(/from public\.entitlements e\s+where e\.pub_id = v_pub\.id and e\.user_id = auth\.uid\(\)/)

    const adminFn = sqlFunction(code, 'admin_unpublish')
    expect(adminFn).toMatch(/set unpublished_at = \(extract\(epoch from now\(\)\) \* 1000\)::bigint/)
    expect(adminFn).not.toMatch(/delete from public\.published_itineraries/i)
    expect(adminFn).not.toMatch(/visibility\s*=\s*'private'/)
  })

  it('supersedes the deleting admin_unpublish, and leaves the real delete in place', () => {
    const dir = new URL('../supabase/migrations/', import.meta.url)
    const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    const defining = files.filter(f => /create or replace function public\.admin_unpublish/.test(src(`../supabase/migrations/${f}`)))

    // More than one definition exists on disk (20260909_masteradmin.sql's still
    // deletes), so the LAST one is what the database actually runs — this is
    // the assertion that the soft body wins, rather than a stale delete.
    expect(defining.length).toBeGreaterThan(1)
    expect(defining[defining.length - 1]).toBe('20260925_publication_soft_unpublish.sql')

    // The hard DELETE is reserved, not removed: `admin_delete_trip` is the
    // genuine permanent-delete path and this change must not have touched it.
    expect(sqlCode(src('../supabase/migrations/20260909_masteradmin.sql')))
      .toMatch(/create or replace function public\.admin_delete_trip/)
  })
})

describe('#350 — Explore shows only what is live', () => {
  it('drops a soft-unpublished publication and keeps the live ones in order', () => {
    const live = pub({ id: 'pub-live', title: 'Live' })
    const down = pub({ id: 'pub-down', title: 'Down', unpublishedAt: 1_700_000_000_000 })
    const alsoLive = pub({ id: 'pub-live-2', title: 'Also live' })

    expect(livePubs([live, down, alsoLive]).map(p => p.id)).toEqual(['pub-live', 'pub-live-2'])
    // A live row is untouched — the filter is not "hide everything".
    expect(livePubs([live, alsoLive])).toHaveLength(2)
  })

  it('is the filter the gallery, the featured card and the counts actually use', () => {
    const page = readFileSync(new URL('../src/pages/Explore.tsx', import.meta.url), 'utf8')
    // The helper existing proves nothing on its own — the surfaces must call it.
    expect(page).toMatch(/let list = \[\.\.\.livePubs\(published\)\]/)
    expect(page).toMatch(/const pool = livePubs\(published\)\.filter/)
    expect(page).toMatch(/for \(const p of livePubs\(published\)\)/)
  })
})

describe('#585 — the creator public page shows only what is live', () => {
  it('is the filter the public catalog and its stat tiles use', () => {
    const page = readFileSync(new URL('../src/pages/CreatorPage.tsx', import.meta.url), 'utf8')
    // One filtered memo feeds the cards AND the three stat tiles (Itineraries,
    // total views, total forks) — the tiles claim only what a visitor can see.
    expect(page).toMatch(/livePubs\(published\.filter\(p => p\.creatorId === creatorId\)\)/)
  })

  it('shares one predicate copy with Explore — no page keeps its own', () => {
    const lib = readFileSync(new URL('../src/lib/livePubs.ts', import.meta.url), 'utf8')
    expect(lib).toContain('export function livePubs(')
    const explore = readFileSync(new URL('../src/pages/Explore.tsx', import.meta.url), 'utf8')
    expect(explore).toMatch(/import \{ livePubs \} from '\.\.\/lib\/livePubs'/)
    const creator = readFileSync(new URL('../src/pages/CreatorPage.tsx', import.meta.url), 'utf8')
    expect(creator).toMatch(/import \{ livePubs \} from '\.\.\/lib\/livePubs'/)
  })
})
