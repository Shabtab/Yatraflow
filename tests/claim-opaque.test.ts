// ============ #355 — the claim refusal must not be an oracle ============
//
// `claim_paid_order` used to refuse in three distinguishable ways, each handed
// back to an authenticated caller: "no such order" (with the id echoed), "order
// belongs to another user", and "order is not paid (status …)". That is a probe
// oracle over Razorpay order ids — a signed-in stranger could learn, per id,
// whether it exists, whose it is, and whether it was paid.
//
// The fix is a property of the SQL BODY, which is exactly the kind of thing no
// local gate can see and no presence probe can answer for (the function exists
// before and after, so `check:migrations` cannot tell the leaking body from the
// opaque one — hence its NO_PROBE_SURFACE declaration, pinned at the bottom
// here). So it is pinned at the source, against the NEWEST definition: the one a
// fresh, in-order apply leaves behind.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
/** Code only. This migration's own header QUOTES the three old exceptions it
 *  removes, so a claim about what the file DOES must never be satisfiable by
 *  prose describing it — the same trap `tests/public-trip-fail-closed.test.ts`
 *  records. */
const codeOf = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/(^|\n)[^\S\n]*\/\/[^\n]*/g, '$1')

const NEWEST = '20260929_claim_paid_order_opaque.sql'
const OLDEST = '20260918_payments_rail.sql'

/** The `$$`-delimited body of a named function, comments stripped. Located by
 *  index rather than by a built pattern, so no `RegExp` is ever constructed from
 *  a value. */
function bodyOf(source: string, name: string): string {
  const code = codeOf(source)
  const at = code.indexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const open = code.indexOf('$$', at)
  const close = code.indexOf('$$', open + 2)
  return open < 0 || close < 0 ? '' : code.slice(open + 2, close)
}

const newestFile = () => read(`../supabase/migrations/${NEWEST}`)
const body = () => bodyOf(newestFile(), 'claim_paid_order')
const oldBody = () => bodyOf(read(`../supabase/migrations/${OLDEST}`), 'claim_paid_order')

/** The one sentence the caller is allowed to see. */
function exceptionText(fn: string): string {
  const at = fn.indexOf('raise exception')
  if (at < 0) return ''
  const open = fn.indexOf("'", at)
  const close = fn.indexOf("'", open + 1)
  return open < 0 || close < 0 ? '' : fn.slice(open + 1, close)
}

describe('#355 — a refusal tells the caller nothing, and the log everything', () => {
  it('answers all three refusals with ONE exception, and it is the same sentence', () => {
    const fn = body()
    // Exactly one raise, so there is no second path a prober could read.
    expect((fn.match(/raise exception/g) ?? []).length).toBe(1)
    // And the sentence names no reason: not the order, not the owner, not the
    // status. Every distinguishable fact is in the LOG below, not here.
    expect(exceptionText(fn)).toBe('claim refused')
  })

  it('keeps the three diagnoses, server-side only', () => {
    const fn = body()
    expect(fn, 'the refusal log line is gone — the diagnosis would be lost too').toContain("raise log 'claim_paid_order refused")
    expect(fn).toContain("'no such order'")
    expect(fn).toContain("'order belongs to another user'")
    expect(fn).toContain("'order is not paid (status '")
  })

  it('never interpolates a reason into the message the caller receives', () => {
    const fn = body()
    const at = fn.indexOf('raise exception')
    const statement = fn.slice(at, fn.indexOf(';', at))
    // A `%` placeholder or a variable here would put the distinction straight
    // back into the response body, which is the whole defect.
    expect(statement).not.toContain('%')
    expect(statement).not.toContain('v_refused')
    expect(statement).not.toContain('v_order')
  })

  it('is a change, not a description of what was always true', () => {
    // Before/after in one place: the old body distinguished, the new one does
    // not. Without this the pin above would pass on a file that had never been
    // changed — the failure mode of every "assert the good thing is present"
    // test.
    const old = oldBody()
    expect((old.match(/raise exception/g) ?? []).length).toBe(3)
    expect(old).toContain('P0002')
    expect(old).toContain('P0003')
    expect(old).toContain('P0004')
    const fn = body()
    expect((fn.match(/raise exception/g) ?? []).length).toBe(1)
    for (const code of ['P0002', 'P0003', 'P0004']) {
      expect(fn, `${code} survived the rewrite`).not.toContain(code)
    }
  })
})

describe('#355 — the grant itself is untouched', () => {
  it('still requires the owner, a paid order, and takes the row lock', () => {
    const fn = body()
    expect(fn).toMatch(/if v_order\.user_id <> auth\.uid\(\) then/)
    expect(fn).toMatch(/elsif v_order\.status <> 'paid' then/)
    expect(fn).toMatch(/for update/)
  })

  it('still grants once, at the snapshot price, after the checks', () => {
    const fn = body()
    expect(fn).toMatch(/on conflict \(user_id, pub_id\) do nothing/)
    expect(fn).toMatch(/v_order\.price_snapshot_inr/)
    // The insert cannot precede the refusal: a guarded body must not grant first.
    expect(fn.indexOf('insert into public.entitlements')).toBeGreaterThan(fn.indexOf('raise exception'))
  })

  it('keeps its definer rights, its search_path, and an authenticated-only grant', () => {
    // These three live OUTSIDE the `$$` body, so they are asserted on the file.
    const file = newestFile()
    expect(file).toMatch(/security definer/)
    expect(file).toMatch(/set search_path = public/)
    expect(file).toMatch(/revoke all on function public\.claim_paid_order\(text\) from public, anon/)
    expect(file).toMatch(/grant execute on function public\.claim_paid_order\(text\) to authenticated/)
  })

  it('is the last word on this function', () => {
    const dir = new URL('../supabase/migrations/', import.meta.url)
    const definers = readdirSync(dir)
      .filter(f => f.endsWith('.sql'))
      .filter(f => codeOf(read(`../supabase/migrations/${f}`)).includes('create or replace function public.claim_paid_order('))
      .sort()
    // Two files define it; whichever sorts LAST is what a fresh in-order apply
    // leaves behind, and that is the one every assertion above read.
    expect(definers).toEqual([OLDEST, NEWEST])
  })
})

describe('#355 — the migration cannot ship undeclared', () => {
  it('is declared in NO_PROBE_SURFACE with a reason, and names what covers it', () => {
    // `check:migrations` probes tables, columns and buckets. This migration
    // redefines a function, so it has no probe surface — and the ratchet fails an
    // undeclared migration rather than quietly reporting nothing. The
    // directory-wide version of that rule lives in tests/migration-status.test.ts;
    // pinned here is that THIS entry carries a reason AND names the coverage
    // instead of merely asserting some exists.
    const plan = read('../scripts/checkMigrations.mjs')
    const at = plan.indexOf(`'${NEWEST}': {`)
    expect(at, `${NEWEST} is not declared in NO_PROBE_SURFACE`).toBeGreaterThan(-1)
    const entry = plan.slice(at, plan.indexOf('\n  },', at))
    expect(entry, 'declared without a reason — the check reads the reason').toMatch(/reason: 'redefines `claim_paid_order`/)
    expect(entry, 'the reason must name what covers it instead').toContain('tests/claim-opaque.test.ts')
  })
})
