// ============ Creator storefront read model (P2, pure) ============
//
// The figures the public creator page prints, and the section decisions it
// makes, as one pure module: no React, no store, no network. Every function
// takes the public types and answers with plain data, so the page has ONE
// decision point instead of scattering null-checks through its markup.
//
// The read-state rule is the one from `readState.ts`: a figure that could not
// be read is `null` ("Unavailable"), never 0 — a 0 states something about the
// creator that nobody verified. A successful read with nothing to count IS 0.
// Unpublished routes are in no figure here: they answer "what can a visitor
// see", which is `livePubs`' question, never "what exists".
import type { PublicUser, PublishedItinerary } from '../data/types'
import { figureOrUnavailable, rowsView, type ReadState, type RowsView } from './readState'
import { livePubs } from './livePubs'

/** The five storefront figures, one decision point for the whole stats row. */
export interface StorefrontFigures {
  liveRoutes: number | null
  views: number | null
  forks: number | null
  /** Live routes the visitor can open without paying. */
  free: number | null
  /** Live routes behind the paywall. */
  paid: number | null
}

/** The five figures at once. `read !== 'ready'` makes every figure null. */
export function storefrontFigures(pubs: PublishedItinerary[], read: ReadState): StorefrontFigures {
  const live = livePubs(pubs)
  const sum = (pick: (pub: PublishedItinerary) => number) => live.reduce((total, pub) => total + pick(pub), 0)
  return {
    liveRoutes: figureOrUnavailable(live.length, read),
    views: figureOrUnavailable(sum(pub => pub.views), read),
    forks: figureOrUnavailable(sum(pub => pub.copies), read),
    free: figureOrUnavailable(live.filter(pub => !pub.premiumPriceInr).length, read),
    paid: figureOrUnavailable(live.filter(pub => !!pub.premiumPriceInr).length, read),
  }
}

/** The date "publishing since" can honestly claim: the earliest `publishedAt`
 *  among LIVE routes, or `undefined` when there is none. */
export function publishingSince(pubs: PublishedItinerary[]): number | undefined {
  const live = livePubs(pubs)
  if (live.length === 0) return undefined
  return Math.min(...live.map(pub => pub.publishedAt))
}

export interface StartPlace {
  place: string
  count: number
}

/** The start-place chips, from each live route's `routeSummary[0]`, grouped
 *  case-insensitively and shown under the most common spelling. Sorted by
 *  count, then name — a stable order the filter can round-trip. Empty while
 *  fewer than two distinct starts exist: one chip filtering one route is not
 *  a filter. A route with an empty `routeSummary` is counted under no place
 *  and stays reachable through "Anywhere". */
export function startPlaces(pubs: PublishedItinerary[]): StartPlace[] {
  const tallies = new Map<string, { place: string; count: number }>()
  for (const pub of livePubs(pubs)) {
    const raw = pub.routeSummary[0]?.trim() ?? ''
    if (raw === '') continue
    const key = raw.toLowerCase()
    const tally = tallies.get(key)
    if (tally) tally.count += 1
    else tallies.set(key, { place: raw, count: 1 })
  }
  const rows = [...tallies.values()].sort((a, b) => b.count - a.count || (a.place < b.place ? -1 : 1))
  return rows.length >= 2 ? rows : []
}

/** The live routes whose first stop is `place` (case-insensitive), or all
 *  live routes for `null` ("Anywhere"). Same objects, stable order. */
export function filterByStart(pubs: PublishedItinerary[], place: string | null): PublishedItinerary[] {
  const live = livePubs(pubs)
  if (place === null) return live
  const key = place.toLowerCase()
  return live.filter(pub => (pub.routeSummary[0]?.trim() ?? '').toLowerCase() === key)
}

/** The route the storefront leads with: the most forked live route, ties
 *  broken by views, then by newest publication. `undefined` while the best
 *  candidate is below `min` forks — a lead with less proof than that is not
 *  a lead. Never an unpublished route. */
export function leadRoute(pubs: PublishedItinerary[], min = 3): PublishedItinerary | undefined {
  const live = livePubs(pubs)
  const best = [...live].sort(
    (a, b) => b.copies - a.copies || b.views - a.views || b.publishedAt - a.publishedAt,
  )[0]
  return best && best.copies >= min ? best : undefined
}

export interface StorefrontInput {
  /** Public identity only. A private field on this page is a compile error. */
  user: PublicUser
  pubs: PublishedItinerary[]
  read: ReadState
}

export interface StorefrontSections {
  /** Whether the publications panel shows rows, the kept-note, the retry, the
   *  spinner or the empty copy — the `rowsView` verdict, reused, not re-derived. */
  pubsView: RowsView
  /** Cover tabs earn their tab strip at three or more live routes. */
  coverTabs: boolean
  /** Start chips earn their filter at two or more distinct starts. */
  startChips: boolean
}

/** Which sections the storefront renders, decided once. */
export function storefrontSections(input: StorefrontInput): StorefrontSections {
  return {
    pubsView: rowsView(input.read, input.pubs.length),
    coverTabs: livePubs(input.pubs).length >= 3,
    startChips: startPlaces(input.pubs).length >= 2,
  }
}
