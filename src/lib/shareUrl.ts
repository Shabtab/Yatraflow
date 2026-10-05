import { Capacitor } from '@capacitor/core'

const PUBLIC_ORIGIN = 'https://yatraflow-blond.vercel.app'

/** A link minted for one publication, optionally stamped with its route out
 *  (F7 · #228 — the WhatsApp send stamps its own channel, `wa`). Absent means
 *  the address is untouched — every existing caller keeps its exact output.
 *  The ref is vocabulary-checked by withShareRef, so a non-vocabulary value
 *  is dropped rather than smuggled through. */
export function publicShareUrl(pubId: string, origin: string, native = false, ref?: ShareSource | null): string {
  return withShareRef(
    `${native ? PUBLIC_ORIGIN : origin.replace(/\/+$/, '')}/i/${encodeURIComponent(pubId)}`,
    ref,
  )
}

/** The creator page's SHARE address (#362): `/c/<creatorId>`, the server path
 *  that carries the creator's own card to a link-preview crawler. The app's
 *  in-app navigation stays on `#/creator/<id>` — a fragment never reaches a
 *  crawler, which is exactly why sharing cannot keep using it. */
export function creatorShareUrl(creatorId: string, origin: string, native = false): string {
  return `${native ? PUBLIC_ORIGIN : origin.replace(/\/+$/, '')}/c/${encodeURIComponent(creatorId)}`
}

/**
 * Retired (#426 slice 2): the address-bar promotion existed because the app's
 * route lived in the hash while the crawler-readable address lived in the
 * path, and the two had to be kept in step by hand. The router reads the
 * pathname itself now, so a publication page IS `/pub/<id>` — the address a
 * visitor copies is already the address the app renders — and the promotion
 * has nothing left to reconcile. `/i/<id>` keeps its single job (the crawler
 * card that hands browsers into the app through the legacy-hash bridge), and
 * the `?buyer=` fail-closed semantics live entirely on that card address.
 * Removed with it: the sync function, its pure path decision and the
 * pathname id helper — `tests/share-preview.test.ts` now pins the boot
 * bridge in `src/lib/router.ts` instead of the sync.
 */

export function currentPublicShareUrl(pubId: string, ref?: ShareSource | null): string {
  return publicShareUrl(pubId, location.origin, Capacitor.isNativePlatform(), ref)
}

export function currentCreatorShareUrl(creatorId: string): string {
  return creatorShareUrl(creatorId, location.origin, Capacitor.isNativePlatform())
}

/**
 * The buyer's own card address (ROADMAP I-21): the publication, plus the
 * entitlement that proves the purchase.
 *
 * The parameter is a REQUEST to be verified, never a claim the client gets to
 * make: `api/i.js` renders the "I bought …" framing only when the database
 * confirms that this entitlement is for this publication, and otherwise serves
 * the creator's card. So an unverified address is still safe to hand a crawler —
 * that is the whole reason the framing can be trusted when it does appear.
 */
export function buyerShareUrl(pubId: string, entitlementId: string, origin: string, native = false): string {
  return `${publicShareUrl(pubId, origin, native)}?buyer=${encodeURIComponent(entitlementId)}`
}

export function currentBuyerShareUrl(pubId: string, entitlementId: string): string {
  return buyerShareUrl(pubId, entitlementId, location.origin, Capacitor.isNativePlatform())
}

/**
 * What a buyer posts alongside it. Deliberately one sentence: the card
 * underneath carries the plan's own facts, and the buyer's own words sit above
 * it — so this adds the claim they are making and nothing they did not say,
 * which is why it carries no price and no numbers.
 */
export function purchaseShareMessage(title: string, url: string): string {
  return `I bought the "${title}" plan on YatraFlow — you can see it here: ${url}`
}

/**
 * Share-attribution vocabulary (#230, widened for F7 · #228). One `ref` value
 * per way a link can leave the building — or, for in-app forks with no link
 * at all, per surface the fork happened on. `null` is the honest answer for a
 * visitor who arrived some other way (typed/copied address, old link, shared
 * by hand) and is rendered as "direct", never guessed.
 *
 * F7's addition is two values, deliberately an allowlist and not free text:
 * `wa` (the WhatsApp send stamps its own channel) and `community` (a
 * distribution post outside the app — a subreddit, a group that is not
 * WhatsApp — named as a category, never as somebody's sentence). A free-form
 * slug would put a stranger's sentence into every share URL and, later, into
 * an analytics read; the allowlist keeps a channel a category, not a message.
 *
 * The list is pinned to the `pub_events.source` / `trips.ref` CHECK constraints
 * in the NEWEST migration defining them (currently
 * supabase/migrations/20260930_pub_events_share_source_allowlist.sql — the
 * 20260929 file carries the original five) — a test asserts the lists agree,
 * so a new value is added in all places or not at all.
 */
export const SHARE_SOURCES = ['copy', 'buyer', 'explore', 'creator', 'purchases', 'wa', 'community'] as const
export type ShareSource = typeof SHARE_SOURCES[number]

/** How each route reads on the admin console. `direct` is the read-side name
 *  for a NULL ref (the RPC's own coalesce), so it lives here and not in the
 *  vocabulary — nothing mints a `direct` link. */
export const SHARE_SOURCE_LABELS: Record<string, string> = {
  copy: 'Copy link',
  buyer: 'Buyer card',
  explore: 'Explore',
  creator: 'Creator page',
  purchases: 'My purchases',
  wa: 'WhatsApp',
  community: 'Community post',
  direct: 'Direct',
}

/** Is this `ref` one of ours? Hand-rolled params, no utm — an unknown value is
 *  DROPPED rather than stored: the column holds a vocabulary, not free text
 *  someone else's URL can fill. */
export function shareRefFromSearch(search: string): ShareSource | null {
  let raw: string | null = null
  try {
    // Tolerate a slice with the hash still attached: a caller handing over
    // `?ref=copy#/pub/x` must not silently lose the ref to the fragment (a
    // location.search never carries one, but a copied URL slice can).
    raw = new URLSearchParams(search.split('#')[0]).get('ref')
  } catch {
    return null
  }
  return raw !== null && (SHARE_SOURCES as readonly string[]).includes(raw) ? (raw as ShareSource) : null
}

/** Take a recognised `ref` back OUT of the address bar (#552). The query must
 *  not outlive the page it brought the reader to: with hash navigation nothing
 *  else ever clears it, so a sticky `ref` hands every later view and fork in
 *  the tab to whatever link the tab first touched. Only a ref the vocabulary
 *  knows is removed — a stranger's parameters (and `?buyer=`, an entitlement
 *  request the card re-reads on refresh) are not ours to drop. Idempotent: a
 *  second call finds nothing of ours and touches nothing. */
export function clearShareRefFromLocation(): void {
  if (typeof window === 'undefined' || typeof history === 'undefined') return
  const search = window.location.search
  if (shareRefFromSearch(search) === null) return
  const params = new URLSearchParams(search)
  params.delete('ref')
  const rest = params.toString()
  history.replaceState(history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`)
}

/** Stamp a share address with its `ref`, keeping any query it already carries
 *  (`?buyer=`) and any hash after it. A `ref` is metadata about the LINK, so
 *  it travels in the query — a fragment never reaches a crawler, a server
 *  redirect, or the app's own `location.search`. */
export function withShareRef(url: string, ref: ShareSource | null | undefined): string {
  if (!ref || !(SHARE_SOURCES as readonly string[]).includes(ref)) return url
  const hashAt = url.indexOf('#')
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url
  const tail = hashAt >= 0 ? url.slice(hashAt) : ''
  // Exactly one ref per link: one that is already there is the honest route in
  // and stays. (Checked, never rebuilt — the existing query keeps its own
  // bytes; re-encoding a `buyer` id through URLSearchParams would churn `%20`
  // into `+` for no gain.)
  const qAt = base.indexOf('?')
  if (qAt >= 0 && new URLSearchParams(base.slice(qAt + 1)).has('ref')) return url
  return `${base}${qAt >= 0 ? '&' : '?'}ref=${encodeURIComponent(ref)}${tail}`
}

/**
 * What anyone sends when they pass a published plan on (F3 · #227): the
 * WhatsApp message beside the link. One sentence in the same register as the
 * buyer's — the plan's name, where it lives, the link — and no claim the
 * sender has not made. The card at the other end does the selling; this
 * sentence only has to be honest.
 */
export function publicationShareMessage(title: string, url: string): string {
  return `The "${title}" trip plan on YatraFlow — see it here: ${url}`
}
