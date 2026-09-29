// ============ #365 — the six unpinned admin RPCs, pinned in source ============
// 20260909_masteradmin.sql carries eight audited RPCs; only admin_delete_user
// (tests/admin-delete-user.test.ts) and admin_revenue (tests/admin.test.ts)
// were pinned. The other six were prose in SQL: a future edit could drop a
// guard (self-disable refusal, last-admin check, audit-before-effect) and
// nothing would turn red. Each block below mirrors the admin_delete_user
// suite's shape: the migration keeps its guards, the audit row textually
// precedes the effect, and the store's optimistic patch + rollback is wired.
//
// Deliberate NON-guards are pinned too, with the reason in the assertion, so
// the next reader doesn't "fix" them: set_creator can demote self; delete_trip
// audits the row's identity, not its heavy JSONB.
//
// The audit-order assertions use indexOf on the CODE with comment lines
// stripped — a comment MENTIONING a guard is not the guard (the Math.random
// tripwire lesson). SQL files here are CRLF on disk; no multi-line \n pattern
// is load-bearing, and the guarded regexes use \s+ across clause boundaries.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const MASTER = '../supabase/migrations/20260909_masteradmin.sql'
const MASTER_NAME = '20260909_masteradmin.sql'
const SOFT_NAME = '20260925_publication_soft_unpublish.sql'
const SOFT = `../supabase/migrations/${SOFT_NAME}`
const STORE = '../src/store/store.ts'
const PAGE = '../src/pages/AdminPage.tsx'

const readRaw = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
/** Code only: these SQL files explain themselves at length, and a guard claim
 *  must be answered by the statement, never by a sentence describing it. */
const strip = (src: string) => src.replace(/\r\n/g, '\n').replace(/--[^\\n]*/g, '')
const read = (p: string) => strip(readRaw(p))

/** Index of the first match of `re` in `code`, or -1. */
const idx = (code: string, re: RegExp) => code.search(re)
/** The body of one RPC, from its create to the file's next create (or end). */
function fnBody(code: string, name: string): string {
  const start = code.indexOf(`create or replace function public.${name}(`)
  expect(start, `${name} exists`).toBeGreaterThan(-1)
  const next = code.indexOf('create or replace function public.', start + 10)
  return code.slice(start, next === -1 ? code.length : next)
}
/** True when the audit INSERT textually precedes the effect statement. */
const auditBefore = (body: string, effect: RegExp) => {
  const a = body.indexOf('insert into public.admin_audit')
  const e = body.search(effect)
  return a > -1 && e > a
}

describe('admin RPC house rule (all six, 20260909_masteradmin.sql)', () => {
  const sql = read(MASTER)

  // One literal (Codacy's non-literal-RegExp rule): captures the function
  // name so the it.each filter below stays exact — and the assertion now also
  // pins that a grant line exists for a real public.<name>(...) signature.
  const GRANT = /grant execute on function public\.([a-z_]+)\([^)]*\) to authenticated/g
  const grantsAuthenticated = (source: string, name: string) =>
    [...source.matchAll(GRANT)].some(m => m[1] === name)

  it.each([
    'admin_set_disabled', 'admin_set_creator', 'admin_set_trip_visibility',
    'admin_remove_member', 'admin_unpublish', 'admin_delete_trip',
  ])('%s: security definer, granted to authenticated, is_admin() inside', (name) => {
    const body = fnBody(sql, name)
    expect(body).toContain('security definer')
    expect(grantsAuthenticated(sql, name)).toBe(true)
    expect(body).toMatch(/if not public\.is_admin\(\) then\s+raise exception 'admin only';/)
  })

  it.each([
    'admin_set_disabled', 'admin_set_creator', 'admin_set_trip_visibility',
    'admin_remove_member', 'admin_unpublish', 'admin_delete_trip',
  ])('%s: audit row in the same transaction, BEFORE the effect', (name) => {
    const body = fnBody(sql, name)
    expect(auditBefore(body, /update public\.|delete from public\./)).toBe(true)
  })
})

describe('admin_set_disabled guards', () => {
  const sql = read(MASTER)
  const body = fnBody(sql, 'admin_set_disabled')

  it('refuses self-disable only when disabling (enabling self is fine)', () => {
    expect(body).toMatch(/if p_user_id = auth\.uid\(\) and p_disabled then\s+raise exception 'cannot disable your own admin account';/)
  })

  it('refuses disabling the last admin, counting ADMINS OTHER THAN the target', () => {
    expect(body).toContain("raise exception 'cannot disable the last admin account'")
    // The count excludes the target: counting everyone and subtracting nothing
    // would let the sole admin disable themselves anyway.
    expect(body).toMatch(/and id <> p_user_id/)
    // The check runs only on the disable path.
    expect(body.indexOf('if p_disabled then')).toBeGreaterThan(-1)
  })

  it('records enable vs disable on the audit row', () => {
    expect(body).toContain("case when p_disabled then 'user.disable' else 'user.enable' end")
    expect(body).toContain("'disabled', p_disabled")
  })
})

describe('admin_set_creator — the deliberate non-guard', () => {
  const sql = read(MASTER)
  const body = fnBody(sql, 'admin_set_creator')

  it('CAN demote self: no self-refusal, by design (a low-risk badge)', () => {
    // Pinned so the next reader doesn't "fix" it: unlike set_disabled, an
    // admin toggling their own creator badge is harmless and reversible. The
    // BODY never reads auth.uid() for a refusal — set_disabled's self-guard
    // is the contrast. (The audit VALUES line still uses auth.uid() as actor,
    // which is in every RPC and is not a refusal.)
    expect(body).not.toMatch(/if .*auth\.uid\(\)/)
    // Exactly ONE refusal in the body — the is_admin gate. set_disabled has
    // three; this one has only the house-rule check.
    expect(body.match(/raise exception/g)?.length).toBe(1)
  })
})

describe('admin_set_trip_visibility guards', () => {
  const sql = read(MASTER)
  const body = fnBody(sql, 'admin_set_trip_visibility')

  it('refuses a visibility outside the private/public whitelist', () => {
    expect(body).toMatch(/if p_visibility not in \('private', 'public'\) then/)
  })

  it('stamps updated_at with the flip (M6 stale-guard clock)', () => {
    expect(body).toMatch(/updated_at = \(extract\(epoch from now\(\)\) \* 1000\)::bigint/)
  })
})

describe('admin_remove_member guards', () => {
  const sql = read(MASTER)
  const body = fnBody(sql, 'admin_remove_member')

  it('refuses a user who is not a member', () => {
    expect(body).toMatch(/if v_role is null then\s+raise exception 'user is not a member of this trip';/)
  })

  it('refuses removing the last owner, counting owners OTHER THAN the target', () => {
    expect(body).toMatch(/raise exception 'cannot remove the last owner/)
    expect(body).toMatch(/and role = 'owner' and user_id <> p_user_id/)
  })

  it("audits with the removed user's role, before the delete", () => {
    expect(body).toContain("'removed_user_id', p_user_id, 'role', v_role")
    expect(auditBefore(body, /delete from public\.trip_members/)).toBe(true)
  })

  it('the UI copy mirrors the last-owner refusal (AdminPage)', () => {
    const page = readRaw(PAGE).replace(/\r\n/g, '\n')
    expect(page).toMatch(/transfer ownership first/)
  })
})

describe('admin_unpublish — the SOFT policy (#350, redefined by 20260925)', () => {
  it('name order decides the body: the soft redefinition sorts LAST and wins', () => {
    // Two files define this function; a fresh in-order apply leaves 20260925's
    // body. That is load-bearing, not cosmetic (#351's carried-guard lesson).
    const dir = new URL('../supabase/migrations/', import.meta.url)
    const granters = readdirSync(dir).filter(f => f.endsWith('.sql'))
      .filter(f => read(`../supabase/migrations/${f}`).includes('create or replace function public.admin_unpublish('))
    expect(granters.length).toBeGreaterThan(1)
    expect(granters.sort()[granters.length - 1]).toBe(SOFT_NAME)
  })

  it('the surviving body keeps admin + refusal + audit, and stays SOFT', () => {
    const soft = read(SOFT)
    const body = fnBody(soft, 'admin_unpublish')
    expect(body).toMatch(/if not public\.is_admin\(\) then\s+raise exception 'admin only';/)
    expect(body).toMatch(/raise exception 'trip has no publication';/)
    expect(auditBefore(body, /update public\.published_itineraries/)).toBe(true)
    // SOFT: the row is stamped, never deleted; the trip is never made private.
    expect(body).toMatch(/set unpublished_at = /)
    expect(body).not.toMatch(/delete from public\.published_itineraries/)
    expect(body).not.toMatch(/set visibility = 'private'/)
    // The stamp is idempotent: unpublishing twice keeps the FIRST timestamp.
    expect(body).toContain('and unpublished_at is null')
  })

  it("the store's admin unpublish mirrors the soft policy (stamp, not delete)", () => {
    const store = read(STORE)
    const start = store.indexOf('export async function adminUnpublish')
    const body = store.slice(start, store.indexOf('/** Delete any trip.', start))
    expect(body).toContain("supabase.rpc('admin_unpublish'")
    expect(body).toMatch(/unpublishedAt: stamp/)
    expect(body).toMatch(/patch\(\{ published: prevPubs \}\)/)
  })
})

describe('admin_delete_trip — the deliberate audit-shape', () => {
  const sql = read(MASTER)
  const body = fnBody(sql, 'admin_delete_trip')

  it('refuses a trip that is not found', () => {
    expect(body).toMatch(/if not found then\s+raise exception 'trip not found';/)
  })

  it("audits the row's IDENTITY (name, owner, dates) — NOT the heavy JSONB", () => {
    // Pinned so the next reader doesn't "complete" it: days/expenses are the
    // heavy JSONB columns; the audit row is a tombstone, not a backup.
    expect(body).toContain("'name', v_row.name")
    expect(body).toContain("'owner_id', v_owner")
    expect(body).toContain("'start_date', v_row.start_date")
    expect(body).not.toMatch(/'days'|'expenses'/)
    expect(auditBefore(body, /delete from public\.trips/)).toBe(true)
  })
})

describe('store wiring: optimistic patch + rollback + audit refresh, all six', () => {
  const store = read(STORE)

  it.each([
    ['adminSetDisabled', 'admin_set_disabled'],
    ['adminSetCreator', 'admin_set_creator'],
    ['adminSetTripVisibility', 'admin_set_trip_visibility'],
    ['adminRemoveMember', 'admin_remove_member'],
    ['adminUnpublish', 'admin_unpublish'],
    ['adminDeleteTrip', 'admin_delete_trip'],
  ])('%s calls %s and restores its slices on error', (fn, rpc) => {
    expect(store).toContain(`supabase.rpc('${rpc}'`)
    const start = store.indexOf(`export async function ${fn}(`)
    expect(start, `${fn} exists`).toBeGreaterThan(-1)
    // The next export ends the function's slice.
    const next = store.indexOf('export async function', start + 10)
    const body = store.slice(start, next === -1 ? store.length : next)
    // requireAdmin gate first, rollback on error, audit refresh on success.
    expect(body).toContain('requireAdmin()')
    // The optimistic-rollback shape is TWO patches: the optimistic one and the
    // error-path restore from the captured prev slices (publishItinerary
    // precedent). One patch alone would mean a write with no way back.
    expect(body.match(/patch\(\{/g)?.length).toBeGreaterThanOrEqual(2)
    expect(body).toContain('if (error)')
    expect(body).toContain('toast(rpcErrorMessage(error)')
    expect(body).toContain('void refreshAdminAudit()')
  })
})
