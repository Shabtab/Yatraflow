// ============ #566 — the purge refuses a trip buyers' money hangs off ============
//
// `published_itineraries.trip_id` cascades from the trip, and `entitlements`,
// `purchase_orders` and `pub_events` all cascade from `pub_id` — so "delete
// forever" on a trashed trip that ever carried a publication was a
// CONFISCATION and an erasure, not a cleanup: buyers lost what they paid for
// and the creator's sales ledger and funnel vanished with it. Both purge paths
// now refuse such a trip (the user-triggered one with a sentence naming the
// counts; the nightly sweep by skipping), and the trip stays safe in the trash
// — `get_public_trip` keeps serving its creator and buyers (#566's other half,
// pinned in tests/public-trip-fail-closed.test.ts).
//
// Pinned at the source against the NEWEST definition — the one a fresh in-order
// apply leaves behind — for the same reason as tests/claim-opaque.test.ts: a
// redefined function exists before and after, so presence answers nothing.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
/** Code only — this migration's header DESCRIBES the refusal it adds, so a
 *  claim about what the file does must never be satisfiable by prose. */
const codeOf = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/(^|\n)[^\S\n]*\/\/[^\n]*/g, '$1')

const NEWEST = '20261002_trash_purge_publication_guard.sql'
const OLDER_TRIP = '20260910_trip_trash_rpc.sql'
const OLDER_AUDIT = '20260929_trash_purge_audit.sql'
const OLDER_SWEEP = '20260910_trip_trash.sql'

/** The `$$`-delimited body of a named function, comments stripped. */
function bodyOf(source: string, name: string): string {
  const code = codeOf(source)
  const at = code.indexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const open = code.indexOf('$$', at)
  const close = code.indexOf('$$', open + 2)
  return open < 0 || close < 0 ? '' : code.slice(open + 2, close)
}

const newestFile = () => read(`../supabase/migrations/${NEWEST}`)
const purgeBody = () => bodyOf(newestFile(), 'purge_trashed_trip')
const sweepBody = () => bodyOf(newestFile(), 'purge_trashed_trips')
const definersOf = (name: string) =>
  readdirSync(new URL('../supabase/migrations/', import.meta.url))
    .filter(f => f.endsWith('.sql'))
    .filter(f => codeOf(read(`../supabase/migrations/${f}`)).includes(`create or replace function public.${name}(`))
    .sort()

describe('#566 — purge_trashed_trip refuses a publication-carrying trip', () => {
  it('is the last word on this function (§6k — name order decides)', () => {
    expect(definersOf('purge_trashed_trip')).toEqual([OLDER_TRIP, OLDER_AUDIT, NEWEST])
  })

  it('counts the publication and its money rows BEFORE anything else', () => {
    const fn = purgeBody()
    expect(fn).toMatch(/select count\(\*\) into v_pubs from public\.published_itineraries/)
    expect(fn).toMatch(/select count\(\*\) into v_entitlements from public\.entitlements/)
    expect(fn).toMatch(/select count\(\*\) into v_orders from public\.purchase_orders/)
    // The refusal is total — any of the three refuses, marker or no marker:
    // even a withdrawn row is the creator's sales ledger and a buyer's grant.
    expect(fn).toMatch(/if v_pubs > 0 or v_entitlements > 0 or v_orders > 0 then/)
  })

  it('refuses BEFORE the delete, naming the counts (the admin_delete_user pattern)', () => {
    const fn = purgeBody()
    const refuse = fn.indexOf('raise exception')
    expect(refuse).toBeGreaterThan(-1)
    expect(fn).toContain('publication row(s) carrying')
    expect(fn).toContain('is never purged')
    // Ordering is the invariant: a guard that runs after the DELETE guards
    // nothing, and `raise exception` rolls the transaction back — which is why
    // the refusal writes no audit row of its own (nothing was destroyed).
    expect(refuse).toBeLessThan(fn.indexOf('delete from public.trips'))
  })

  it('carries the owner/tombstone guards and the audit row forward verbatim', () => {
    const fn = purgeBody()
    // Owner-only + tombstoned-only, exactly as the two previous bodies.
    expect(fn).toContain('owner_id = auth.uid() and deleted_at is not null')
    expect(fn).toContain("values (auth.uid(), 'trip.purge'")
    for (const table of ['trip_members', 'suggestions', 'decisions', 'activity']) {
      expect(fn, `the audit must count ${table}`).toContain(table)
    }
    // …and the audit names the money counts as the zeroes the guard guarantees.
    expect(fn).toContain("'publications', v_pubs")
    expect(fn).toContain("'entitlements', v_entitlements")
    expect(fn).toContain("'purchase_orders', v_orders")
  })

  it('keeps the owner-only grant, restated', () => {
    const file = newestFile()
    expect(file).toMatch(/revoke all on function public\.purge_trashed_trip\(uuid\) from public, anon/)
    expect(file).toMatch(/grant execute on function public\.purge_trashed_trip\(uuid\) to authenticated/)
  })

  it('is a change, not a description of what was always true', () => {
    // The previous bodies hard-deleted unconditionally — before/after, so the
    // pins above cannot pass on a file that never changed this behaviour.
    const older = bodyOf(read(`../supabase/migrations/${OLDER_AUDIT}`), 'purge_trashed_trip')
    expect(older).not.toContain('v_pubs')
    expect(older).not.toContain('is never purged')
    expect(purgeBody()).toContain('is never purged')
  })
})

describe('#566 — the 30-day sweep skips what the purge refuses', () => {
  it('is the last word on the sweep (§6k)', () => {
    expect(definersOf('purge_trashed_trips')).toEqual([OLDER_SWEEP, NEWEST])
  })

  it('skips any expired trip that ever carried a publication', () => {
    const fn = sweepBody()
    expect(fn).toMatch(/not exists \(\s*select 1 from public\.published_itineraries p where p\.trip_id = t\.id\s*\)/)
    // And it still sweeps only what it always swept: 30-day-old tombstones.
    expect(fn).toMatch(/deleted_at < now\(\) - interval '30 days'/)
  })

  it('returns the count of trips actually removed, and keeps the service_role-only grant', () => {
    const fn = sweepBody()
    expect(fn).toMatch(/select count\(\*\) into removed from deleted/)
    const file = newestFile()
    expect(file).toMatch(/revoke all on function public\.purge_trashed_trips\(\) from public, anon, authenticated/)
    expect(file).toMatch(/grant execute on function public\.purge_trashed_trips\(\) to service_role/)
  })
})
