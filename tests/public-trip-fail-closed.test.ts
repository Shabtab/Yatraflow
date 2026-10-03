// ============ #352 + #353 — the public wire's two fail-closed rules ==========
//
// One function, one promise, two holes. #353 is an availability bug (a scalar
// in `free_day_indexes` 500s the page for everyone); #352 is a disclosure bug
// (the money stayed in the payload while the days were stripped). Both are
// "an input this body did not ask the shape of", and both are pinned here
// against the NEWEST definition — the one a fresh database ends up with, which
// is the only one that matters and is no longer this session's file.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
/** Code only. This migration's own header QUOTES the vulnerable line it
 *  removes, and the client's comment quotes the branch condition it replaces,
 *  so a claim about what a file DOES must never be satisfiable by prose
 *  describing it. */
const codeOf = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--[^\n]*/g, ' ')
  .replace(/(^|\n)[^\S\n]*\/\/[^\n]*/g, '$1')

const NEWEST = '20261002_trash_purge_publication_guard.sql'

/** The `$$`-delimited body of a named function, comments stripped. Located by
 *  index rather than by a built pattern, so no `RegExp` is ever constructed
 *  from a value. */
function bodyOf(source: string, name: string): string {
  const code = codeOf(source)
  const at = code.indexOf(`create or replace function public.${name}(`)
  if (at < 0) return ''
  const open = code.indexOf('$$', at)
  const close = code.indexOf('$$', open + 2)
  return open < 0 || close < 0 ? '' : code.slice(open + 2, close)
}

const body = () => bodyOf(read(`../supabase/migrations/${NEWEST}`), 'get_public_trip')

describe('#353 — a poisoned free-day list must not take the page down', () => {
  it('type-checks the column before iterating it', () => {
    const fn = body()
    const guard = fn.indexOf("if jsonb_typeof(v_pub.free_day_indexes) = 'array' then")
    const iterate = fn.indexOf('jsonb_array_elements_text(v_pub.free_day_indexes)')
    expect(guard, 'the array guard is gone — a scalar in this column 500s the RPC').toBeGreaterThan(-1)
    expect(iterate).toBeGreaterThan(guard)
  })

  it('reads only numeric elements, so one bad element cannot 500 the cast', () => {
    // `array_agg(value::int)` over a hand-edited ["a"] raises exactly what a
    // scalar in the column raises one step earlier.
    expect(body()).toMatch(
      /from jsonb_array_elements_text\(v_pub\.free_day_indexes\) as value\s+where value ~ '\^\[0-9\]\+\$'/,
    )
  })

  it('resolves every unexpected shape to "no free days", never to "no lock"', () => {
    const fn = body()
    const init = fn.indexOf("v_free := '{}'")
    const guard = fn.indexOf("if jsonb_typeof(v_pub.free_day_indexes) = 'array' then")
    // The default is the locked answer, and it is replaced only inside the guard.
    expect(init).toBeGreaterThan(-1)
    expect(init).toBeLessThan(guard)
    // Exactly one read of the column, so there is no second unguarded path.
    expect(fn.split('jsonb_array_elements_text(v_pub.free_day_indexes)').length - 1).toBe(1)
  })
})

describe('#352 — the money follows the same decision as the days', () => {
  it('empties both money fields, not just the day-keyed one', () => {
    const fn = body()
    expect(fn).toMatch(/v_trip\.expenses := '\[\]'::jsonb/)
    expect(fn).toMatch(/v_trip\.fixed_commitments := '\[\]'::jsonb/)
  })

  it('runs after the buyer/unpriced exits and before any exit that could skip it', () => {
    const fn = body()
    const unpriced = fn.indexOf('v_pub.premium_price_inr is null')
    const strip = fn.indexOf("v_trip.expenses := '[]'::jsonb")
    const corruptDays = fn.indexOf("v_trip.days := '[]'::jsonb")
    expect(unpriced).toBeGreaterThan(-1)
    expect(strip).toBeGreaterThan(unpriced)   // entitlements/unpriced already returned
    expect(corruptDays).toBeGreaterThan(-1)
    expect(strip).toBeLessThan(corruptDays)   // the corrupt-days exit cannot bypass it
  })

  it('the money is live input on the page, and the page promises it is withheld', () => {
    // The note this fix replaced claimed the page "renders neither" field. It
    // does compute totals over the trip, and those read `trip.expenses`; the
    // figures it prints from them are distance, road time and stop count, and
    // the budget figure it shows comes from the publication row. So the defect
    // was the payload and the fork rather than a printed number — but the
    // page's own locked copy claims the breakdown is withheld, and that claim
    // is what the wire has to keep. Pin both halves so the premise cannot
    // quietly stop being true.
    const page = read('../src/pages/PublicItinerary.tsx')
    expect(page).toMatch(/computeTotals\(trip\)/)
    expect(page).toMatch(/budget breakdown are in the full plan/)
  })
})

describe('#352 — the client cannot fork what the server withheld', () => {
  const fork = () => codeOf(read('../src/lib/forkPub.ts'))

  it('the re-stub empties the money when the publication is priced', () => {
    expect(fork()).toMatch(/stripMoney \? \{ expenses: \[\], fixedCommitments: \[\] \} : \{\}/)
  })

  it('keys both decisions on the price and the wire, not on the shape of src.days', () => {
    const fn = fork()
    expect(fn).toMatch(/restubLockedDays\(src, pub\.freeDayIndexes, \(pub\.premiumPriceInr \?\? 0\) > 0\)/)
    expect(fn).toMatch(
      /unlockedFork\s*\? await duplicateTripPersisted\(safe, meId, undefined, source\)\s*: await duplicateTripPublicPersisted\(safe, meId, pub\.freeDayIndexes, source\)/,
    )
    // The fragile check is gone: a wire-stubbed row whose days came back empty
    // (the RPC's own fail-closed branch) read as "nothing locked" and took the
    // unfiltered full-copy path with the money still attached.
    expect(fn).not.toMatch(/src\.days\.some\(d => !pub\.freeDayIndexes\.includes\(d\.index\)\)/)
  })

  it('the path it now defaults to still keeps what a viewer may have', () => {
    // The persist path is the default for every fork the server did not hand
    // over in full, so it must not eat trip-level expenses or a free day's
    // commitment — otherwise a free publication's fork would silently lose its
    // budget.
    const store = codeOf(read('../src/store/store.ts'))
    expect(store).toMatch(/filter\(e => e\.dayIndex === undefined \|\| free\.has\(e\.dayIndex\)\)/)
    expect(store).toMatch(/copy\.fixedCommitments\s*\n\s*\.filter\(f => free\.has\(f\.dayIndex\)\)/)
  })
})

describe('every redefinition keeps what the previous three fixes added', () => {
  it('the newest body still carries #350, #351, #352 and #353', () => {
    const fn = body()
    expect(fn, '#350 (soft unpublish) was dropped').toMatch(/if v_pub\.unpublished_at is not null then/)
    expect(fn, '#351 (invite_code) was dropped').toMatch(/null::text as invite_code/)
    expect(fn, '#351 (whole-row select) came back').not.toMatch(/select\s+\*\s+into v_trip/i)
    expect(fn, '#352 (money) was dropped').toMatch(/v_trip\.fixed_commitments := '\[\]'::jsonb/)
    expect(fn, '#353 (free-day guard) was dropped').toMatch(/jsonb_typeof\(v_pub\.free_day_indexes\) = 'array'/)
    // And the paywall the whole file exists for.
    expect(fn).toMatch(/Locked — the full plan is on the original itinerary/)
  })

  it('is the last word on this function, and keeps the anon grant', () => {
    const dir = new URL('../supabase/migrations/', import.meta.url)
    const definers = readdirSync(dir)
      .filter(f => f.endsWith('.sql'))
      .filter(f => codeOf(read(`../supabase/migrations/${f}`)).includes('create or replace function public.get_public_trip('))
      .sort()
    // Five files now define it; whichever sorts LAST is what a fresh in-order
    // apply leaves behind (§6k — and the last one must carry the previous
    // four's guards, which is what the tests above pin).
    expect(definers.length).toBeGreaterThan(1)
    expect(definers[definers.length - 1]).toBe(NEWEST)
    expect(read(`../supabase/migrations/${NEWEST}`)).toMatch(
      /grant execute on function public\.get_public_trip\(text\) to anon, authenticated/,
    )
  })
})

// ============ #566 — trash is a withdraw, never a revoke ============
// The trip fetch used to filter `t.deleted_at is null`, so the moment a creator
// hit Trash, every buyer's link went dark — the tombstone is about the trip's
// place in the owner's lists, not about what buyers paid for. The filter is
// replaced by a gate that serves the creator and every entitled buyer and
// turns away only the viewers who had no claim on the plan.
describe('#566 — a trashed trip keeps serving its creator and buyers', () => {
  it('drops the tombstone filter from the trip fetch', () => {
    // The change itself: this pattern is what darkened buyers' links.
    expect(body()).not.toMatch(/and t\.deleted_at is null/)
  })

  it('gates on the tombstone instead — creator and entitled buyers pass', () => {
    const fn = body()
    expect(fn, 'the trash gate is gone').toMatch(/if v_trip\.deleted_at is not null and not \(/)
    const gate = fn.slice(fn.indexOf('if v_trip.deleted_at is not null and not ('))
    const claimants = gate.slice(0, gate.indexOf('then'))
    expect(claimants).toContain('v_pub.creator_id = auth.uid()')
    expect(claimants).toContain('from public.entitlements e')
  })

  it('runs the gate before any path that could serve the trip', () => {
    const fn = body()
    const gate = fn.indexOf('if v_trip.deleted_at is not null and not (')
    expect(gate).toBeGreaterThan(-1)
    // Before the first `return next`, so no branch can skip it.
    expect(gate).toBeLessThan(fn.indexOf('return next v_trip'))
  })
})
