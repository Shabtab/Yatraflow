// ============ Explore discovery derivations (MR10) ============
// The discovery blocks on Explore — featured creators and trending
// itineraries — are claims about the public catalog, so the rules
// live here, in one pure module, rather than inline in the page.
// The test suite runs in node env and pins the rules without a DOM.
//
// The evidence bar is the featured card's own (#395): a plan is
// only worth featuring when it carries real evidence, because
// leading with "Why featured: 0 forks · 13 views" advertises
// emptiness rather than credibility (§6.10).
import type { PublishedItinerary, CachedUser } from '../data/types'
import { livePubs } from './livePubs'

/** A publication is only worth featuring when it carries real
 *  evidence — at least one fork, or a meaningful view count. */
export const FEATURED_MIN_VIEWS = 25

/** The catalog's one popularity score: views plus forks weighted
 *  five-to-one (a fork is a stronger signal than a view). Every
 *  surface that ranks publications uses this copy, so "trending"
 *  and "most popular" cannot disagree. */
export function popularity(p: { views: number; copies: number }): number {
  return p.views + p.copies * 5
}

/** The one order for "most popular" surfaces: the popularity score, then
 *  forks, then views, then recency, then id. The trending shelf and the
 *  grid's default sort both use it, so a tie resolves the same way on
 *  both, and no arrival order can swap two equal plans. */
export function comparePopularity(
  a: { id: string; views: number; copies: number; publishedAt: number },
  b: { id: string; views: number; copies: number; publishedAt: number },
): number {
  return popularity(b) - popularity(a) ||
    b.copies - a.copies ||
    b.views - a.views ||
    b.publishedAt - a.publishedAt ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** One creator's rank in the discovery rail: who they are, and the
 *  evidence in their live catalog. */
export interface CreatorRank {
  user: CachedUser
  /** Live publications by this creator. */
  pubCount: number
  forks: number
  views: number
  /** Sum of popularity() across the creator's live publications. */
  score: number
}

/** Rank the creators a visitor can discover: creators with at least
 *  one live publication, ordered by the evidence in their catalog.
 *  The order is deterministic — a tie must not depend on the order
 *  rows arrived in — so two renders of the same catalog show the
 *  same rail. */
export function featuredCreators(
  users: CachedUser[],
  pubs: PublishedItinerary[],
  limit = 4,
): CreatorRank[] {
  const byCreator = new Map<string, PublishedItinerary[]>()
  for (const p of livePubs(pubs)) {
    const list = byCreator.get(p.creatorId) ?? []
    list.push(p)
    byCreator.set(p.creatorId, list)
  }
  const ranks: CreatorRank[] = []
  for (const user of users) {
    // Visitors must not follow a disabled creator account, and a non-creator has
    // no public page to open. #800: `creatorAvailable` is the server-derived
    // signal (`not is_disabled`), so the suppression is enforced without the
    // administrative flag ever reaching the client.
    if (!user.profile.isCreator || !user.profile.creatorAvailable) continue
    const list = byCreator.get(user.id)
    if (!list || list.length === 0) continue
    const forks = list.reduce((n, p) => n + p.copies, 0)
    const views = list.reduce((n, p) => n + p.views, 0)
    ranks.push({
      user,
      pubCount: list.length,
      forks,
      views,
      score: list.reduce((n, p) => n + popularity(p), 0),
    })
  }
  return ranks
    .sort((a, b) =>
      b.score - a.score ||
      b.pubCount - a.pubCount ||
      b.forks - a.forks ||
      a.user.profile.name.localeCompare(b.user.profile.name),
    )
    .slice(0, limit)
}

/** The catalog's most-evidenced plans, minus the picks a surface
 *  already leads with (the featured card). The same evidence bar
 *  as the featured card, and the same deterministic order. */
export function trendingPubs(
  pubs: PublishedItinerary[],
  limit = 4,
  excludeIds: string[] = [],
): PublishedItinerary[] {
  const excluded = new Set(excludeIds)
  const pool = livePubs(pubs).filter(
    p => !excluded.has(p.id) && (p.copies >= 1 || p.views >= FEATURED_MIN_VIEWS),
  )
  return [...pool].sort(comparePopularity).slice(0, limit)
}

/** The community counts the share-stories card states: live
 *  publications, and the distinct creators behind them. Both are
 *  read from the same slice the blocks above read, so the card
 *  can never claim a larger community than the blocks show. */
export function communityCounts(pubs: PublishedItinerary[]): {
  pubCount: number
  creatorCount: number
} {
  const live = livePubs(pubs)
  return {
    pubCount: live.length,
    creatorCount: new Set(live.map(p => p.creatorId)).size,
  }
}
