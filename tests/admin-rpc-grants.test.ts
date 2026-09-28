// ============ #366 — admin RPCs are not anonymous API surface ============
// Every admin RPC shipped `grant execute … to authenticated` with no explicit
// revoke, and Postgres' default function ACL is EXECUTE-to-PUBLIC — so anon
// stayed grant-level-reachable, held back only by the in-function is_admin().
// Same three-way pin as tests/prune-pub-events-lockdown.test.ts: the SQL that
// must be applied, the ordering that decides a fresh apply's outcome, and the
// assertion the contract suite makes against the real database.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
/** Code only: the header above the lockdown discusses the grants it removes. */
const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')

const LOCKDOWN = '20260929_admin_rpc_grant_lockdown.sql'
const ALL_EIGHT = [
  'admin_set_disabled', 'admin_set_creator', 'admin_set_trip_visibility',
  'admin_remove_member', 'admin_unpublish', 'admin_delete_trip',
  'admin_delete_user', 'admin_revenue',
] as const

/** Every `revoke all on function public.<sig> from <roles>;` in a file — one
 *  literal (Codacy's non-literal-RegExp rule), capturing the full signature so
 *  the per-RPC filter below also pins the ARGUMENT TYPES the lockdown names. */
const REVOKE = /revoke all on function public\.([a-z_]+)\(([^)]*)\) from ([a-z_,\s]+);/g
const revokesFor = (source: string, name: string) =>
  [...codeOf(source).matchAll(REVOKE)]
    .filter(m => m[1] === name)
    .map(m => m[3].split(',').map(r => r.trim().toLowerCase()))
/** Every `grant execute on function public.<sig> to <roles>;` — same shape. */
const GRANT = /grant execute on function public\.([a-z_]+)\(([^)]*)\) to ([a-z_,\s]+);/g
const grantsFor = (source: string, name: string) =>
  [...codeOf(source).matchAll(GRANT)]
    .filter(m => m[1] === name)
    .map(m => m[3].split(',').map(r => r.trim().toLowerCase()))

describe('#366 — the admin grant lockdown', () => {
  const lockdown = read(`../supabase/migrations/${LOCKDOWN}`)

  it('is grants-only: it moves no bytes of any function', () => {
    // A grants-only file cannot silently disturb what the function bodies pin
    // (the #356 rule) — that is what makes it safe to run standalone.
    const code = codeOf(lockdown)
    expect(code).not.toMatch(/create\s+or\s+replace\s+function/i)
    expect(code).not.toMatch(/\bdelete\s+from\b/i)
    expect(code).not.toMatch(/\bupdate\s+public\./i)
  })

  it.each(ALL_EIGHT)('%s: revoked from public+anon, granted to authenticated', (name) => {
    const rev = revokesFor(lockdown, name)
    expect(rev.length, `${name} has a revoke`).toBeGreaterThanOrEqual(1)
    // The twice-learned Supabase lesson: revoking from public does NOT revoke
    // from anon — but authenticated KEEPS the grant (the console calls it).
    expect(rev[0]).toEqual(expect.arrayContaining(['public', 'anon']))
    expect(rev[0]).not.toContain('authenticated')
    const grant = grantsFor(lockdown, name)
    expect(grant.length).toBeGreaterThanOrEqual(1)
    expect(grant[0]).toEqual(['authenticated'])
  })

  it('covers all eight admin RPCs in one file', () => {
    for (const name of ALL_EIGHT) {
      expect(codeOf(lockdown)).toContain(`function public.${name}(`)
    }
  })

  it('is the last word on these grants, or a fresh apply hands the door back', () => {
    // Name order decides which grant a fresh in-order apply leaves behind
    // (#351's redefinition lesson, applied to grants).
    const dir = new URL('../supabase/migrations/', import.meta.url)
    const granters = readdirSync(dir).filter(f => f.endsWith('.sql') && f !== LOCKDOWN)
      .filter(f => ALL_EIGHT.some(name => grantsFor(read(`../supabase/migrations/${f}`), name).length > 0))
    expect(granters.length).toBeGreaterThan(0)
    for (const f of granters) {
      expect(LOCKDOWN > f, `${LOCKDOWN} must sort after ${f}`).toBe(true)
    }
  })

  it('leaves the intentional anon grants alone (is_admin/is_disabled)', () => {
    // These answer false for anon by design and client code calls them. The
    // lockdown must not "harden" them into breakage.
    const code = codeOf(lockdown)
    expect(code).not.toMatch(/revoke all on function public\.is_admin/)
    expect(code).not.toMatch(/revoke all on function public\.is_disabled/)
  })

  it('the real database gets asked the same question', () => {
    // The grant is only true if the LIVE role list says so — what the contract
    // suite checks with aclexplode against all eight RPCs.
    const contract = codeOf(read('../supabase/tests/rls_contract.test.sql'))
    const adminBlock = contract.slice(contract.indexOf("'admin_set_disabled', 'admin_set_creator'"))
    expect(adminBlock).toMatch(/aclexplode\(coalesce\(p\.proacl, acldefault\('f', p\.proowner\)\)\)/)
    expect(adminBlock).toMatch(/rolname = 'anon'/)
    // …and the append-only audit policy assertion rides the same suite.
    expect(adminBlock).toMatch(/admin_audit/)
  })
})
