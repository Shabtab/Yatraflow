// ============ The purchase claim, and where it may be made (I-21) ============
// The buyer's card says "I bought this", which is a claim — so the server
// renders it only after `owns_publication` confirms the entitlement is real and
// is for that publication. Two halves are pinned here:
//
//   * the gate the migration creates (it must answer a boolean and nothing
//     else, and reach no further than the roles the public surfaces hold), and
//   * the agreement between the three files that have to name the same things —
//     the migration, the handler, and the surfaces that offer it.
//
// The card's own behaviour is exercised in tests/share-preview.test.ts, where
// the handler runs for real.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/** Normalised to `\n` on read: this repo checks out CRLF on Windows
 *  (`core.autocrlf=true`), and the assertions below match `\n`-anchored SQL
 *  (`expect(sqlCode).toMatch(/\n\s*stable\n/)`), so a raw read passes in CI's
 *  Linux checkout and fails on a Windows one — a local-only red that has
 *  nothing to do with the code. */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** Code only — whole-line `//`, block comments and SQL `--` removed.
 *
 *  Every file here explains itself at length, so a comment that mentions
 *  `user_id` or "I bought" would otherwise read as the code doing it. An
 *  assertion about what a file DOES has to look at what it does. */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*(\/\/|--)/.test(line))
    .join('\n')
}

const sql = read('../supabase/migrations/20260921_purchase_share_card.sql')
const sqlCode = codeOf(sql)
const handler = read('../api/i.js')
const action = read('../src/lib/purchaseShare.ts')
const shelf = read('../src/pages/Purchases.tsx')
const reveal = read('../src/components/UnlockReveal.tsx')
const publicPage = read('../src/pages/PublicItinerary.tsx')

describe('I-21 — the gate answers a purchase question and nothing else', () => {
  it('matches the entitlement to the publication on both halves', () => {
    expect(sqlCode).toMatch(/where e\.id = p_entitlement/)
    expect(sqlCode).toMatch(/and e\.pub_id = p_pub_id/)
  })

  it('returns a boolean — no buyer, no amount, no row to leak', () => {
    expect(sqlCode).toMatch(/returns boolean/)
    expect(sqlCode).not.toMatch(/user_id/)
    expect(sqlCode).not.toMatch(/amount_paid_inr/)
    expect(sqlCode).not.toMatch(/returns setof/)
  })

  it('is a definer with a pinned search_path, so anon needs no grant on the table', () => {
    expect(sqlCode).toMatch(/security definer/)
    expect(sqlCode).toMatch(/set search_path = public/)
    expect(sqlCode).toMatch(/\n\s*stable\n/)
  })

  it('reaches exactly the two roles the public surfaces hold', () => {
    expect(sqlCode).toMatch(/revoke all on function public\.owns_publication\(uuid, text\) from public;/)
    expect(sqlCode).toMatch(/grant execute on function public\.owns_publication\(uuid, text\) to anon, authenticated;/)
  })

  it('agrees with the handler on the parameter names', () => {
    // A rename on either side is a silent 404 that would degrade every buyer's
    // card back to the creator's, with nothing in the logs to say why.
    expect(sqlCode).toMatch(/owns_publication\(p_entitlement uuid, p_pub_id text\)/)
    expect(handler).toMatch(/JSON\.stringify\(\{ p_entitlement: entitlement, p_pub_id: id \}\)/)
  })
})

describe('I-21 — the claim is the server’s to make', () => {
  it('renders it from the gate’s verdict, never from the query string', () => {
    expect(handler).toMatch(/if \(publication && buyer && url && key && \(await ownsPublication/)
    expect(handler).toMatch(/verifiedBuyer = buyer/)
    // #230 added the ref as a fourth argument — the gate's verdict still rides
    // the same call, and the pin follows the call site.
    expect(handler).toMatch(/renderPublication\(publication, id, verifiedBuyer, ref\)/)
  })

  it('fails closed and silently when the gate cannot answer', () => {
    expect(handler).toMatch(/if \(!response\.ok\) return false/)
    // Strictly literal true: an error object or a string must not read as yes.
    expect(handler).toMatch(/return \(await response\.json\(\)\) === true/)
    // `\r?\n`: api/i.js is CRLF, and a bare `\n` pattern silently never
    // matches it (AGENTS §3).
    expect(handler).toMatch(/\} catch \{\r?\n    return false\r?\n  \}/)
  })

  it('is never spelled by a page — they hand out a link and let the crawler read the card', () => {
    expect(handler).toContain('I bought ')
    expect(codeOf(shelf)).not.toContain('I bought ')
    expect(codeOf(reveal)).not.toContain('I bought ')
    expect(codeOf(action)).not.toContain('I bought ')
    // The message the buyer posts IS theirs to make, and it is composed in one
    // place so the pages cannot drift into claiming it themselves.
    expect(codeOf(action)).toMatch(/purchaseShareMessage\(purchase\.title, url\)/)
  })
})

describe('I-21 — where the surfaces offer it', () => {
  it('offers it on the shelf only for a plan that still resolves', () => {
    expect(shelf).toMatch(/\{purchaseShareable\(row\) && \(/)
  })

  it('offers it in the reveal against the grant the purchase produced', () => {
    expect(reveal).toMatch(/sharePurchase\(\{ pubId: pub\.id, entitlementId, title: pub\.title \}\)/)
    expect(publicPage).toMatch(/entitlementId=\{entitlements\.find\(e => e\.pubId === pub\.id\)\?\.id\}/)
  })

  it('falls back to the clipboard where no share sheet exists', () => {
    expect(action).toMatch(/nativeShareText/)
    expect(action).toMatch(/=== 'shared'/)
    expect(action).toMatch(/nativeCopyText/)
  })
})
