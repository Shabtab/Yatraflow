// ============ #230 — share attribution: how a reader ARRIVED ============
// The launch signal "shares → views" was unmeasurable: a shared link carried no
// reference, so every view and fork recorded a step with no route in. This file
// pins the whole attribution chain:
//
//   * ONE vocabulary across the THREE places that cannot import each other —
//     src/lib/shareUrl.ts (the app), api/i.js (plain JS outside src) and the
//     SQL CHECK constraints (the migration + schema.sql). A new ref value is
//     added in all of them or not at all, and this file is what says so.
//   * The URL helpers: a ref rides the QUERY (a fragment never reaches a
//     crawler, a redirect, or location.search), survives a hash, and is never
//     duplicated or invented.
//   * The migration's shape: the old two-argument bump_published_stats overload
//     drops BEFORE the three-argument one lands (or every cached client gets
//     "function is not unique"), the body carries its guards forward, and the
//     admin reader keeps its door (#366's rule applied at birth).
//   * Every surface that mints a link or forks stamps its own route in.
//
// The handler's real behaviour (redirect + metadata) runs for real in
// tests/share-preview.test.ts; the counter threading runs in
// tests/pub-counters.test.ts; the fork's trip stamp runs in
// tests/forkPersist.test.ts.
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { SHARE_SOURCES, SHARE_SOURCE_LABELS, shareRefFromSearch, withShareRef } from '../src/lib/shareUrl'
import { tripToRow, rowToTrip, type OptionalColumnsProbe, type TripRow } from '../src/lib/tripRow'
import type { Trip } from '../src/data/types'
import { seedData } from '../src/data/seed'

/** Normalised to \n on read: this repo checks out CRLF on Windows, and the
 *  assertions below match \n-anchored source patterns. */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** Code only — block comments, `//` and SQL `--` lines removed. Every file
 *  here explains itself at length, and a comment that QUOTES the vocabulary
 *  would otherwise read as the code declaring it. */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*(\/\/|--)/.test(line))
    .join('\n')
}

const shareUrlSrc = read('../src/lib/shareUrl.ts')
const handlerSrc = codeOf(read('../api/i.js'))
const migrationSrc = codeOf(read('../supabase/migrations/20260929_pub_events_share_source.sql'))
const schemaSrc = codeOf(read('../supabase/schema.sql'))

/** A captured `'a', 'b', 'c'` list → ['a','b','c']. */
function csv(capture: string): string[] {
  return capture.split(',').map(s => s.trim().replace(/^'/, '').replace(/'$/, '')).filter(Boolean)
}

describe('one vocabulary, three places that cannot import each other', () => {
  const expected = [...SHARE_SOURCES]

  it('shareUrl.ts declares the canonical list', () => {
    const m = /export const SHARE_SOURCES = \[([^\]]*)\] as const/.exec(shareUrlSrc)
    expect(m, 'SHARE_SOURCES export exists').not.toBeNull()
    expect(csv(m![1])).toEqual(expected)
  })

  it('api/i.js mirrors it (it is plain JS outside src — it cannot import the client)', () => {
    const m = /const SHARE_SOURCES = \[([^\]]*)\]/.exec(handlerSrc)
    expect(m, 'SHARE_SOURCES const exists in the handler').not.toBeNull()
    expect(csv(m![1])).toEqual(expected)
  })

  it('the migration pins BOTH columns to the same list', () => {
    const source = /check \(source is null or source in \(([^)]*)\)\)/.exec(migrationSrc)
    const ref = /check \(ref is null or ref in \(([^)]*)\)\)/.exec(migrationSrc)
    expect(source, 'pub_events.source CHECK exists').not.toBeNull()
    expect(ref, 'trips.ref CHECK exists').not.toBeNull()
    expect(csv(source![1])).toEqual(expected)
    expect(csv(ref![1])).toEqual(expected)
  })

  it('schema.sql — the second way to build the database — carries the same CHECKs', () => {
    const source = /check \(source is null or source in \(([^)]*)\)\)/.exec(schemaSrc)
    const ref = /check \(ref is null or ref in \(([^)]*)\)\)/.exec(schemaSrc)
    expect(source, 'pub_events.source CHECK exists in schema.sql').not.toBeNull()
    expect(ref, 'trips.ref CHECK exists in schema.sql').not.toBeNull()
    expect(csv(source![1])).toEqual(expected)
    expect(csv(ref![1])).toEqual(expected)
  })

  it('every vocabulary value — plus direct — has a label', () => {
    for (const s of [...SHARE_SOURCES, 'direct']) {
      expect(SHARE_SOURCE_LABELS[s], `${s} is labelled`).toBeTruthy()
    }
  })
})

describe('shareRefFromSearch — the reader end', () => {
  it.each(SHARE_SOURCES)('recognises %s', (s) => {
    expect(shareRefFromSearch(`?ref=${s}`)).toBe(s)
    expect(shareRefFromSearch(`?buyer=ent-1&ref=${s}`)).toBe(s)
    expect(shareRefFromSearch(`?ref=${s}#/pub/x`)).toBe(s)
  })

  it.each([
    ['an unknown value', '?ref=bogus'],
    ['a case variant', '?ref=Copy'],
    ['an empty value', '?ref='],
    ['no query at all', ''],
    ['a hash-only URL', '#/pub/x'],
    ['a lookalike param', '?prefer=x'],
    ['free text', '?ref=whatsapp%20group'],
  ])('drops %s — the column holds a vocabulary, not somebody else’s URL', (_label, search) => {
    expect(shareRefFromSearch(search)).toBeNull()
  })
})

describe('withShareRef — the link end', () => {
  it('stamps a clean address', () => {
    expect(withShareRef('https://a.test/i/x', 'copy')).toBe('https://a.test/i/x?ref=copy')
  })

  it('joins an existing query instead of clobbering it', () => {
    expect(withShareRef('https://a.test/i/x?buyer=ent-1', 'buyer')).toBe('https://a.test/i/x?buyer=ent-1&ref=buyer')
  })

  it('keeps the hash last — the query belongs before it', () => {
    expect(withShareRef('https://a.test/i/x#/pub/x', 'copy')).toBe('https://a.test/i/x?ref=copy#/pub/x')
    expect(withShareRef('https://a.test/i/x?buyer=b#/pub/x', 'buyer')).toBe('https://a.test/i/x?buyer=b&ref=buyer#/pub/x')
  })

  it('is inert for a missing or unknown ref', () => {
    expect(withShareRef('https://a.test/i/x', null)).toBe('https://a.test/i/x')
    expect(withShareRef('https://a.test/i/x', undefined)).toBe('https://a.test/i/x')
    expect(withShareRef('https://a.test/i/x', 'bogus' as never)).toBe('https://a.test/i/x')
  })

  it('keeps exactly one ref per link — an existing one is the honest route in', () => {
    const once = withShareRef('https://a.test/i/x', 'copy')
    expect(withShareRef(once, 'buyer')).toBe(once)
  })

  it('round-trips: what a link stamps, the reader reads', () => {
    for (const s of SHARE_SOURCES) {
      const url = withShareRef('https://a.test/i/x?buyer=b#/pub/x', s)
      expect(shareRefFromSearch(url.slice(url.indexOf('?')))).toBe(s)
    }
  })
})

describe('the migration shape', () => {
  it('drops the two-argument overload BEFORE the three-argument one lands', () => {
    // With a defaulted third parameter, a two-argument call matches both
    // overloads and Postgres answers "function is not unique" — the drop is
    // what keeps cached (older) clients working. Name order in the file is
    // load-bearing, so the pin is an ORDER assertion, not a presence one.
    const dropAt = migrationSrc.indexOf('drop function if exists public.bump_published_stats(text, text);')
    const createAt = migrationSrc.indexOf('create or replace function public.bump_published_stats(p_id text, p_kind text, p_source text default null)')
    expect(dropAt, 'the old overload is dropped').toBeGreaterThanOrEqual(0)
    expect(createAt, 'the new overload is created').toBeGreaterThanOrEqual(0)
    expect(dropAt).toBeLessThan(createAt)
  })

  it('carries the body guards forward verbatim (the redefinition-inherits-its-holes rule)', () => {
    expect(migrationSrc).toMatch(/v_kind := 'view';/)
    expect(migrationSrc).toMatch(/v_kind := 'fork';/)
    expect(migrationSrc).toMatch(/unknown kind: no counter, no event/)
    expect(migrationSrc).toMatch(/if not found then/)
    expect(migrationSrc).toMatch(/insert into public\.pub_events \(pub_id, kind, source\) values \(p_id, v_kind, p_source\);/)
  })

  it('keeps the counter audience — attribution does not widen or narrow it', () => {
    expect(migrationSrc).toMatch(/grant execute on function public\.bump_published_stats\(text, text, text\) to anon, authenticated;/)
  })

  it('schema.sql mirrors the body and the grant (the second build path)', () => {
    const dropAt = schemaSrc.indexOf('drop function if exists public.bump_published_stats(text, text);')
    const createAt = schemaSrc.indexOf('create or replace function public.bump_published_stats(p_id text, p_kind text, p_source text default null)')
    expect(dropAt).toBeGreaterThanOrEqual(0)
    expect(createAt).toBeGreaterThanOrEqual(0)
    expect(dropAt).toBeLessThan(createAt)
    expect(schemaSrc).toMatch(/insert into public\.pub_events \(pub_id, kind, source\) values \(p_id, v_kind, p_source\);/)
    expect(schemaSrc).toMatch(/grant execute on function public\.bump_published_stats\(text, text, text\) to anon, authenticated;/)
  })

  it('the admin reader keeps its door — is_admin gate, named roles, bounded window', () => {
    expect(migrationSrc).toMatch(/create or replace function public\.admin_share_attribution\(p_days integer default 90\)/)
    expect(migrationSrc).toMatch(/if not public\.is_admin\(\) then/)
    expect(migrationSrc).toMatch(/raise exception 'admin only';/)
    // #366's rule applied at birth: revoking from public does not revoke from
    // anon on Supabase, so both roles are named — and the console's own
    // audience keeps the grant (a no-grants function would pass a
    // denial-only check while the tab is quietly broken).
    expect(migrationSrc).toMatch(/revoke all on function public\.admin_share_attribution\(integer\) from public, anon;/)
    expect(migrationSrc).toMatch(/grant execute on function public\.admin_share_attribution\(integer\) to authenticated;/)
    // The 730-day horizon is the log's own (get_creator_funnel / prune_pub_events).
    expect(migrationSrc).toMatch(/least\(coalesce\(p_days, 90\), 730\)/)
  })

  it('the live contract suite asks the database the same question', () => {
    const contract = codeOf(read('../supabase/tests/rls_contract.test.sql'))
    const at = contract.indexOf("p.proname = 'admin_share_attribution'")
    expect(at, 'the contract suite names the new RPC').toBeGreaterThanOrEqual(0)
    const block = contract.slice(at, at + 2200)
    expect(block).toMatch(/aclexplode\(coalesce\(p\.proacl, acldefault\('f', p\.pronowner\)\)\)/)
    expect(block).toMatch(/rolname = 'authenticated'/)
    expect(block).toMatch(/must stay granted to authenticated/)
  })
})

describe('trips.ref — the fork’s own stamp', () => {
  const base = seedData.trips[0] as Trip

  it('is written only when the column probe says the database has it', () => {
    const trip: Trip = { ...structuredClone(base), ref: 'explore' }
    const withCol = tripToRow(trip, 'owner-1', { ref: true } as OptionalColumnsProbe)
    expect(withCol.ref).toBe('explore')
    // The probe-gate rule (the cover-image lesson): a write naming a column
    // the database does not have fails the WHOLE insert, so a missing column
    // must mean the field is absent, not null.
    const withoutCol = tripToRow(trip, 'owner-1')
    expect('ref' in withoutCol).toBe(false)
  })

  it('round-trips through the row, and null reads back as undefined', () => {
    const row = { ...tripToRow({ ...structuredClone(base), ref: 'buyer' }, 'owner-1', { ref: true } as OptionalColumnsProbe), created_at: 1, updated_at: 2 } as TripRow
    expect(rowToTrip(row, []).ref).toBe('buyer')
    const bare = { ...tripToRow(structuredClone(base), 'owner-1', { ref: true } as OptionalColumnsProbe), created_at: 1, updated_at: 2 } as TripRow
    expect(rowToTrip(bare, []).ref).toBeUndefined()
  })
})

describe('every surface stamps its own route in', () => {
  const publicPage = read('../src/pages/PublicItinerary.tsx')
  const shareTab = read('../src/pages/trip/ShareTab.tsx')
  const action = read('../src/lib/purchaseShare.ts')
  const fork = read('../src/lib/forkPub.ts')
  const explore = read('../src/pages/Explore.tsx')
  const creator = read('../src/pages/CreatorPage.tsx')
  const purchases = read('../src/pages/Purchases.tsx')

  it('the public page attributes its views and forks to the link’s ref', () => {
    expect(publicPage).toContain('registerPubView(pub.id, shareRefFromSearch(window.location.search))')
    expect(publicPage).toContain('unlocked, shareRefFromSearch(window.location.search)')
  })

  it('the two Copy-link buttons mint a copy link (display and copy are one string)', () => {
    expect(publicPage).toContain("withShareRef(currentPublicShareUrl(pub.id), 'copy')")
    expect(shareTab).toContain("withShareRef(currentPublicShareUrl(pub.id), 'copy')")
  })

  it("the buyer’s card says ref=buyer on every transport", () => {
    expect(action).toContain("withShareRef(currentBuyerShareUrl(purchase.pubId, purchase.entitlementId), 'buyer')")
  })

  it('in-app forks name their surface', () => {
    expect(explore).toContain("forkPublication(pub, me, onNavigate, undefined, 'explore')")
    expect(creator).toContain("forkPublication(p, me, onNavigate, undefined, 'creator')")
    expect(purchases).toContain("forkPublication(pub, meId, onNavigate, undefined, 'purchases')")
  })

  it('forkPublication carries one source to all three sinks', () => {
    // The funnel event (through the counter), the forked trip's stamp, and the
    // public-persist path — a source dropped on any one of them makes the log
    // and the trip disagree about where the owner came from.
    expect(fork).toContain('source?: ShareSource | null')
    expect(fork).toContain('registerPubCopy(pub.id, source)')
    expect(fork).toContain('duplicateTripPersisted(safe, meId, undefined, source)')
    expect(fork).toContain('duplicateTripPublicPersisted(safe, meId, pub.freeDayIndexes, source)')
  })
})

describe('the admin read is honest about failure', () => {
  it('fetchAdminShareAttribution rejects on a failed read — never a friendly zero', async () => {
    vi.resetModules()
    const rpc = vi.fn()
    vi.doMock('../src/lib/supabase', () => ({ supabase: { rpc }, isSupabaseConfigured: () => true }))
    const { fetchAdminShareAttribution } = await import('../src/lib/unlock')

    rpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } })
    await expect(fetchAdminShareAttribution()).rejects.toThrow()

    rpc.mockResolvedValueOnce({
      data: [{ source: 'copy', views: 4, forks: 1, last_at: '2026-09-29T00:00:00Z' }, { source: 'direct', views: 2, forks: 0, last_at: null }],
      error: null,
    })
    const rows = await fetchAdminShareAttribution(30)
    expect(rpc).toHaveBeenCalledWith('admin_share_attribution', { p_days: 30 })
    expect(rows).toEqual([
      { source: 'copy', views: 4, forks: 1, lastAt: Date.parse('2026-09-29T00:00:00Z') },
      { source: 'direct', views: 2, forks: 0, lastAt: null },
    ])
    vi.doUnmock('../src/lib/supabase')
    vi.resetModules()
  })

  it('the console renders the breakdown with its labels and a Retry state', () => {
    const page = codeOf(read('../src/pages/AdminPage.tsx'))
    expect(page).toContain('fetchAdminShareAttribution')
    expect(page).toContain('SHARE_SOURCE_LABELS')
    expect(page).toContain('Share attribution — how readers arrived')
    // The empty-vs-error rule (the §6 lesson): a failed read renders Retry,
    // never a friendly zero that reads as "no shares".
    expect(page).toContain('setAttrAttempt(a => a + 1)')
  })
})
