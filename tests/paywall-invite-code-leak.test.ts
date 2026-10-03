// ============ #351 — the paywall's invite-code bypass, pinned from both ends ==
//
// Confirmed LIVE on 2026-09-25 against the production project with three
// anonymous HTTP calls and no account:
//
//   1. `get_public_trip` (anon) stubbed the DAYS correctly for a non-buyer —
//      11 stops on a ₹199 publication — and then returned the rest of the trip
//      row anyway, `invite_code` included. Three of six publications handed
//      over a real 15-character code; two of them were priced.
//   2. `get_trip_by_invite_code` (anon) was `select t.* … where code = p_code`
//      with no premium gate, so that same caller traded the code for the full
//      plan: 4 days, ZERO stubbed stops, real descriptions and entry fees.
//
// A paywall with a second door is not a paywall. These tests hold both doors
// shut and are written so the OLD state fails them: the source invariants fail
// against a `select *`, and the behavioural ones fail against a store that
// passes the RPC row straight through to the cache.
//
// The migration half carries a trap worth its own test: BOTH
// 20260925_publication_soft_unpublish.sql (#350) and this fix replace
// `get_public_trip`, so whichever file sorts LAST is the definition a fresh
// database actually runs. A fix that dropped #350's gate on its way past would
// trade one live hole for another, so the ordering is asserted, not assumed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { seedData } from '../src/data/seed'
import { tripToRow } from '../src/lib/tripRow'
import type { Trip } from '../src/data/types'

const { rpcCalls, rpcData } = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
  /** What the mocked wire answers, per RPC name. */
  rpcData: {} as Record<string, unknown>,
}))

vi.mock('../src/lib/supabase', () => {
  const qb: Record<string, unknown> = {}
  qb.select = () => qb
  qb.eq = () => qb
  qb.in = () => qb
  qb.order = () => qb
  qb.limit = () => qb
  qb.update = () => qb
  qb.insert = () => qb
  qb.upsert = () => qb
  qb.delete = () => qb
  qb.maybeSingle = () => qb
  qb.single = () => qb
  // Both handlers, always — a thenable that resolves `then(res)` alone leaves
  // the rejection path unsettled and an awaiting caller hangs to the timeout.
  qb.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(res, rej)
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: () => qb,
      rpc: (fn: string, args: unknown) => {
        rpcCalls.push({ fn, args })
        return Promise.resolve({ data: rpcData[fn] ?? null, error: null })
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
  isAdminCached: () => false,
  adminFromSession: () => false,
  clearAdminCache: () => {},
}))

const TRIP_ID = 'trip-351'
const OWNER = 'owner-351'
/** The shape the RPC leaked: a real capability, in the payload, to anon. */
const LEAKED_CODE = 'KER-K7QF-351'

function trip(): Trip {
  return {
    ...structuredClone(seedData.trips[0]),
    id: TRIP_ID,
    visibility: 'public',
    inviteCode: LEAKED_CODE,
    members: [{ userId: OWNER, role: 'owner', joinedAt: 1 }],
  }
}

/** The payload `get_public_trip` actually sent before the fix: a valid trip row
 *  with the stubbed days AND the traveller's invite code still attached. */
function leakedPayload() {
  return [{ ...tripToRow(trip()), invite_code: LEAKED_CODE }]
}

async function freshStore() {
  vi.resetModules()
  return await import('../src/store/store')
}

beforeEach(() => {
  rpcCalls.length = 0
  for (const k of Object.keys(rpcData)) delete rpcData[k]
})

afterEach(() => { vi.restoreAllMocks() })

describe('#351 — the anon paywalled RPC cannot hand out a capability', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url)
  const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  /** Code only — the files here explain themselves at length, so an assertion
   *  about what a file DOES must not be satisfied by a sentence describing it. */
  const sqlCode = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')

  /** One SQL function's own text, sliced by its `$$ … $$` body delimiters. */
  function sqlFunction(source: string, name: string): string {
    const marker = `create or replace function public.${name}`
    const start = source.indexOf(marker)
    expect(start, `${name} not found`).toBeGreaterThan(-1)
    const open = source.indexOf('$$', start)
    const close = source.indexOf('$$', open + 2)
    expect(open > -1 && close > -1, `${name} body is unterminated`).toBe(true)
    return source.slice(start, close + 2)
  }

  /** Every migration file that redefines `name`, in the order a fresh database
   *  applies them (name order), so the LAST one is the live definition.
   *
   *  One literal pattern captures the function name and the captured name is
   *  compared — `name` is never interpolated into a built pattern, which is
   *  both a lint finding in its own right and the thing that would let a
   *  function merely *mentioned* in prose read as a definition. */
  const DEFINES = /create\s+or\s+replace\s+function\s+public\.([a-z_][a-z0-9_]*)/gi
  const defining = (name: string) => readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .filter(f => [...sqlCode(src(`../supabase/migrations/${f}`)).matchAll(DEFINES)].some(m => m[1] === name))

  const MIGRATION = '20260926_paywall_invite_code_leak.sql'

  it('get_public_trip stops selecting the row, and nulls the code it used to ship', () => {
    const code = sqlCode(sqlFunction(src(`../supabase/migrations/${MIGRATION}`), 'get_public_trip'))

    // The trip lookup is the primitive that shipped the secret: `select * into
    // v_trip` is exactly what carried `invite_code` to anon. Asserted per
    // statement — `[^;]*` cannot cross a `;` — rather than as a blanket "no
    // star anywhere", because the publication lookup above it legitimately does
    // `select * into v_pub`: that table is world-readable by design (`published
    // read` is `using (true)`), so a star there discloses nothing.
    const tripSelects = code.match(/select[^;]*?from public\.trips[^;]*/gi) ?? []
    expect(tripSelects.length, 'the trip lookup must still exist').toBeGreaterThan(0)
    for (const stmt of tripSelects) expect(stmt, stmt).not.toMatch(/\*/)
    expect(code).not.toMatch(/select\s+t\.\*/i)

    // The secret itself: named only to be nulled, never read from the table.
    expect(code).toMatch(/null::text as invite_code/)
    expect(code).not.toMatch(/t\.invite_code/)
  })

  it('the definition a fresh database ends up with is the fixed one — and it keeps #350', () => {
    const files = defining('get_public_trip')

    // More than one file defines it (#350, this fix, then #352/#353, then
    // #566's trash gate), so name order decides — and it now decides in a
    // LATER file's favour. That is the point of this test rather than an
    // inconvenience: the fix has to survive every subsequent redefinition, so
    // the assertions below run against the newest one, and the loop at the end
    // of this block applies the same rule to anything added after it.
    const NEWEST = '20261002_trash_purge_publication_guard.sql'
    expect(files.length).toBeGreaterThan(1)
    expect(files[files.length - 1]).toBe(NEWEST)

    const code = sqlCode(sqlFunction(src(`../supabase/migrations/${NEWEST}`), 'get_public_trip'))
    // Trade one hole for another? The soft-unpublish gate has to survive the
    // rewrite that removes the `select *`.
    expect(code).toMatch(/if v_pub\.unpublished_at is not null then/)
    expect(code).toMatch(/from public\.entitlements e\s+where e\.pub_id = v_pub\.id and e\.user_id = auth\.uid\(\)/)
    // …and the stubbing the paywall itself depends on.
    expect(code).toMatch(/Locked — the full plan is on the original itinerary/)
  })

  it('get_trip_by_invite_code carries the guard its uuid sibling has had all along', () => {
    const files = defining('get_trip_by_invite_code')
    expect(files[files.length - 1]).toBe(MIGRATION)

    const code = sqlCode(sqlFunction(src(`../supabase/migrations/${MIGRATION}`), 'get_trip_by_invite_code'))
    // The gate: a priced publication locks the code path for everyone without a
    // claim on it — the same clause shape as get_invite_trip.
    expect(code).toMatch(/coalesce\(p\.premium_price_inr, 0\) > 0/)
    expect(code).toMatch(/public\.is_member\(t\.id\)/)
    expect(code).toMatch(/public\.is_admin\(\)/)
    expect(code).toMatch(/from public\.entitlements e\s+where e\.pub_id = p\.id and e\.user_id = auth\.uid\(\)/)
    // Trashed trips stop resolving through the code, as they already do through
    // the uuid.
    expect(code).toMatch(/t\.deleted_at is null/)
    // And no whole-row select on an anon-granted function.
    expect(code).not.toMatch(/select\s+t\.\*/i)
  })

  it('keeps every legitimate way in: private trips, free plans, and the anon grant', () => {
    const sql = src(`../supabase/migrations/${MIGRATION}`)
    const code = sqlCode(sqlFunction(sql, 'get_trip_by_invite_code'))
    // Private trip: the code IS the capability (logged-out invite links).
    expect(code).toMatch(/t\.visibility = 'private'/)
    // `revoke … from public` does not revoke from anon — both roles are named,
    // and anon keeps EXECUTE because the join gate previews before login.
    expect(sql).toMatch(/grant execute on function public\.get_trip_by_invite_code\(text\) to anon, authenticated/)
    expect(sql).toMatch(/grant execute on function public\.get_public_trip\(text\) to anon, authenticated/)
  })

  it('an un-migrated database cannot silently reopen it: the file is dated after #350', () => {
    // The leak returns if this fix is applied and then overwritten by a file
    // that sorts later and still selects the row.
    expect(MIGRATION > '20260925_publication_soft_unpublish.sql').toBe(true)
    const later = readdirSync(dir).filter(f => f.endsWith('.sql') && f > MIGRATION)
    for (const f of later) {
      const body = sqlCode(src(`../supabase/migrations/${f}`))
      expect(body, `${f} redefines get_public_trip and must keep the fix`).not.toMatch(/select\s+\*\s+into v_trip/i)
    }
  })
})

describe('#351 — the client is not the second half of the exploit', () => {
  it('drops a leaked invite_code before it can reach the cache', async () => {
    const store = await freshStore()
    rpcData.get_public_trip = leakedPayload()

    const fetched = await store.fetchPublicTrip('pub-351')

    expect(fetched, 'the trip itself still resolves — this is not a denial of service').not.toBeNull()
    expect(fetched!.inviteCode, 'the capability must not ride along').toBeUndefined()
    // The RPC was still the source: this replaced passing the row through.
    expect(rpcCalls.map(c => c.fn)).toContain('get_public_trip')
  })

  it('so a leaked code cannot be turned back into a trip through the cache', async () => {
    const store = await freshStore()
    rpcData.get_public_trip = leakedPayload()
    await store.fetchPublicTrip('pub-351')
    rpcCalls.length = 0

    // The exploit's second call. `fetchTripByInviteCode` short-circuits on a
    // cached trip whose `inviteCode` matches — if the public fetch had stored
    // the code, this would answer from the cache in one hop.
    rpcData.get_trip_by_invite_code = leakedPayload()
    await store.fetchTripByInviteCode(LEAKED_CODE)

    const cached = store.getSnapshot().trips.filter(t => t.inviteCode === LEAKED_CODE)
    expect(cached, 'no cached trip may carry the leaked code').toEqual([])
  })

  it('does not strip the code from the owner\'s own trip', async () => {
    // The guard is scoped to the PUBLIC path. Sharing still works: a creator's
    // own trip keeps its code, which is what the Share tab renders and copies.
    const store = await freshStore()
    const snap = store.getSnapshot() as unknown as { trips: Trip[] }
    snap.trips = [trip()]
    expect(store.getSnapshot().trips[0].inviteCode).toBe(LEAKED_CODE)
  })
})
