import { Capacitor } from '@capacitor/core'
import { routeParts } from './pageTitle'

const PUBLIC_ORIGIN = 'https://yatraflow-blond.vercel.app'

export function publicShareUrl(pubId: string, origin: string, native = false): string {
  return `${native ? PUBLIC_ORIGIN : origin.replace(/\/+$/, '')}/i/${encodeURIComponent(pubId)}`
}

/** The creator page's SHARE address (#362): `/c/<creatorId>`, the server path
 *  that carries the creator's own card to a link-preview crawler. The app's
 *  in-app navigation stays on `#/creator/<id>` — a fragment never reaches a
 *  crawler, which is exactly why sharing cannot keep using it. */
export function creatorShareUrl(creatorId: string, origin: string, native = false): string {
  return `${native ? PUBLIC_ORIGIN : origin.replace(/\/+$/, '')}/c/${encodeURIComponent(creatorId)}`
}

/** Use the router's segments (including ignored trailing segments), then the API's id allowlist. */
export function publicAddressPath(hash: string, pathname: string): string {
  const [head, id] = routeParts(hash.replace(/^#/, ''))
  if (head === 'pub' && id && /^[A-Za-z0-9_-]{1,64}$/.test(id)) return `/i/${id}`
  return /^\/i\/[^/]+$/.test(pathname) ? '/' : pathname
}

/** The publication id a browser pathname already names, if any. */
function pubIdFromPathname(pathname: string): string | null {
  const match = /^\/i\/([A-Za-z0-9_-]{1,64})$/.exec(pathname)
  return match ? match[1] : null
}

/**
 * Keep the browser's path in step with the hash route, so whatever a visitor
 * copies out of the address bar is readable by a link-preview crawler. A
 * fragment never leaves the browser, so `/#/pub/<id>` reaches a preview as the
 * bare site; the same page addressed as `/i/<id>#/pub/<id>` reaches the
 * `/i/<id>` function and carries that itinerary's own Open Graph tags.
 *
 * `replaceState`, never `pushState`: this is one page under a second name, so it
 * must not add a history entry or Back doubles up. Native and `file://` builds
 * are left alone — only the web has a crawler to serve.
 *
 * #362: a `?buyer=` parameter is minted for ONE publication's entitlement. The
 * sync used to preserve the query while the pathname switched underneath it, so
 * navigating publication A → B left A's capability in the address bar — the
 * handler fail-closes and renders B's creator card, but the address still lies
 * about what it carries. The query is dropped when the promoted id CHANGES and
 * kept when the id is the same (a buyer refreshing their own link keeps it).
 */
export function syncPublicAddress(): void {
  if (Capacitor.isNativePlatform() || !/^https?:$/.test(location.protocol)) return
  const pathname = publicAddressPath(location.hash, location.pathname)
  if (pathname !== location.pathname) {
    const promoted = pubIdFromPathname(pathname)
    const current = pubIdFromPathname(location.pathname)
    const search = promoted && current && promoted !== current ? '' : location.search
    history.replaceState(history.state, '', `${pathname}${search}${location.hash}`)
  }
}

export function currentPublicShareUrl(pubId: string): string {
  return publicShareUrl(pubId, location.origin, Capacitor.isNativePlatform())
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
 * Share-attribution vocabulary (#230). One `ref` value per way a link can
 * leave the building — or, for in-app forks with no link at all, per surface
 * the fork happened on. `null` is the honest answer for a visitor who arrived
 * some other way (typed/copied address, old link, shared by hand) and is
 * rendered as "direct", never guessed.
 *
 * The list is pinned to the `pub_events.source` / `trips.ref` CHECK constraints
 * in supabase/migrations/20260929_pub_events_share_source.sql — a test asserts
 * the two lists agree, so a new value is added in both places or not at all.
 */
export const SHARE_SOURCES = ['copy', 'buyer', 'explore', 'creator', 'purchases'] as const
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
