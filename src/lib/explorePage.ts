// ============ Explore page — pure logic ============
// Featured pick, route trail, place and creator tallies, card facts and the
// empty-state choice for the Explore gallery. No React, no clock reads, no
// store reads. Every figure comes from the publication rows passed in.
import type { PublishedItinerary, User } from '../data/types'
import { formatInrShort } from './engine'
import { livePubs } from './livePubs'

/** Views a plan needs to be featured when it has no fork yet. */
export const FEATURED_MIN_VIEWS = 25

export interface PlaceTile { name: string; count: number }
export interface CreatorTile { id: string; name: string; plans: number; forks: number; isCreator: boolean }
export type SavedEmptyKind = 'none' | 'no-saved' | 'no-match' | 'no-catalog-signed-in' | 'no-catalog-signed-out'

/** Plain code-unit order, so two runs always sort the same way. */
function compareText(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * The plan Explore leads with. Only live rows with at least one fork, or with
 * FEATURED_MIN_VIEWS views, qualify. The most forks wins, then the most views,
 * then the newest publication. Returns undefined when no row qualifies.
 */
export function pickFeatured(pubs: PublishedItinerary[]): PublishedItinerary | undefined {
  const pool = livePubs(pubs).filter(pub => pub.copies >= 1 || pub.views >= FEATURED_MIN_VIEWS)
  return [...pool].sort((a, b) => b.copies - a.copies || b.views - a.views || b.publishedAt - a.publishedAt)[0]
}

/**
 * The route shown on a card: the first stop, the last stop, and evenly spaced
 * middle stops, up to `max` stops in total. `hidden` counts the stops left
 * out. An empty route gives no stops. `max` is at least 1; a NaN `max` means 5.
 */
export function routeTrail(routeSummary: string[], max = 5): { stops: string[]; hidden: number } {
  const total = routeSummary.length
  if (total === 0) return { stops: [], hidden: 0 }
  const cap = Math.max(1, Math.floor(Number.isNaN(max) ? 5 : max))
  if (total <= cap) return { stops: [...routeSummary], hidden: 0 }
  if (cap === 1) return { stops: [routeSummary[0]], hidden: total - 1 }
  const middleSlots = cap - 2
  const middleCount = total - 2
  const middle: string[] = []
  for (let slot = 0; slot < middleSlots; slot++) {
    const offset = middleSlots === 1
      ? Math.floor((middleCount - 1) / 2)
      : Math.round((slot * (middleCount - 1)) / (middleSlots - 1))
    middle.push(routeSummary[1 + offset])
  }
  const stops = [routeSummary[0], ...middle, routeSummary[total - 1]]
  return { stops, hidden: total - stops.length }
}

/**
 * Whether a live plan matches a search. The needle is trimmed and compared
 * ignoring case. It matches the title, the route stops (joined by a space) or
 * the creator's name. A blank needle matches every plan. Explore's search box
 * and the place tiles both use this, so a tile's count is the list it opens.
 */
export function matchesQuery(
  pub: Pick<PublishedItinerary, 'title' | 'routeSummary'>,
  query: string,
  creatorName?: string,
): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return pub.title.toLowerCase().includes(needle)
    || pub.routeSummary.join(' ').toLowerCase().includes(needle)
    || (creatorName?.toLowerCase().includes(needle) ?? false)
}

interface PlaceTally { count: number; spellings: Map<string, number> }

/** The spelling used most often. A tie goes to the smaller spelling. */
function mostCommonSpelling(spellings: Map<string, number>): string {
  let best = ''
  let bestVotes = 0
  for (const [spelling, votes] of spellings) {
    const isBetter = votes > bestVotes || (votes === bestVotes && compareText(spelling, best) < 0)
    if (isBetter) {
      best = spelling
      bestVotes = votes
    }
  }
  return best
}

/**
 * Place tiles. The tiles are chosen by how many live plans route through each
 * place: names match ignoring case and outer spaces, and a plan counts a place
 * once. The tile shows the spelling used most often. Each tile's count is then
 * the number of live plans that matchesQuery() finds under that name, which is
 * the list a click opens. Sorted by that count, then name. Returns the top
 * `limit` tiles.
 */
export function placeTiles(pubs: PublishedItinerary[], users: User[] = [], limit = 6): PlaceTile[] {
  const tallies = new Map<string, PlaceTally>()
  for (const pub of livePubs(pubs)) {
    const keysInPlan = new Set<string>()
    for (const raw of pub.routeSummary) {
      const spelling = raw.trim()
      if (spelling === '') continue
      const key = spelling.toLowerCase()
      const tally = tallies.get(key) ?? { count: 0, spellings: new Map<string, number>() }
      tallies.set(key, tally)
      tally.spellings.set(spelling, (tally.spellings.get(spelling) ?? 0) + 1)
      if (!keysInPlan.has(key)) {
        keysInPlan.add(key)
        tally.count += 1
      }
    }
  }
  const chosen = [...tallies.values()]
    .map(tally => ({ name: mostCommonSpelling(tally.spellings), tallied: tally.count }))
    .sort((a, b) => b.tallied - a.tallied || compareText(a.name, b.name))
    .slice(0, Math.max(0, limit))
  const usersById = new Map(users.map(user => [user.id, user] as const))
  const live = livePubs(pubs)
  return chosen
    .map(tile => ({
      name: tile.name,
      count: live.filter(pub => matchesQuery(pub, tile.name, usersById.get(pub.creatorId)?.profile.name)).length,
    }))
    .sort((a, b) => b.count - a.count || compareText(a.name, b.name))
}

/**
 * Creators strip: each creator with a live plan, the number of live plans, and
 * the total forks (copies) across them. A creator missing from `users` is
 * skipped. Sorted by forks, then plans, then name, then id. Returns the top
 * `limit` creators.
 */
export function creatorList(pubs: PublishedItinerary[], users: User[], limit = 5): CreatorTile[] {
  const usersById = new Map(users.map(user => [user.id, user] as const))
  const tallies = new Map<string, { plans: number; forks: number }>()
  for (const pub of livePubs(pubs)) {
    const tally = tallies.get(pub.creatorId) ?? { plans: 0, forks: 0 }
    tally.plans += 1
    tally.forks += pub.copies
    tallies.set(pub.creatorId, tally)
  }
  const rows: CreatorTile[] = []
  for (const [id, tally] of tallies) {
    const user = usersById.get(id)
    if (!user) continue
    rows.push({ id, name: user.profile.name, plans: tally.plans, forks: tally.forks, isCreator: user.profile.isCreator })
  }
  return rows
    .sort((a, b) => b.forks - a.forks || b.plans - a.plans || compareText(a.name, b.name) || compareText(a.id, b.id))
    .slice(0, Math.max(0, limit))
}

/** "3 days", "1 day". */
function dayCount(count: number): string {
  return `${count} ${count === 1 ? 'day' : 'days'}`
}

/**
 * The four facts a card prints, in order: Days, Budget, Places and Forks. The
 * budget is per person, in the compact form My trips cards use (for example ~₹25k/person).
 */
export function cardColumns(pub: PublishedItinerary): { label: string; value: string }[] {
  return [
    { label: 'Days', value: dayCount(pub.durationDays) },
    { label: 'Budget', value: `~${formatInrShort(pub.estimatedBudgetPerPersonInr)}/person` },
    { label: 'Places', value: String(pub.routeSummary.length) },
    { label: 'Forks', value: String(pub.copies) },
  ]
}

/**
 * Which empty state the saved-only gallery shows. `pubsCount` counts the rows
 * the page can show. `savedCount` counts the rows the viewer saved.
 *  - 'none': rows exist, so the gallery shows.
 *  - 'no-saved': the saved-only view has nothing saved.
 *  - 'no-match': filters hide every row.
 *  - 'no-catalog-signed-in' / 'no-catalog-signed-out': the catalog is empty.
 */
export function savedEmptyKind({ pubsCount, filtersActive, savedOnly, savedCount, signedIn }: {
  pubsCount: number
  filtersActive: boolean
  savedOnly: boolean
  savedCount: number
  signedIn: boolean
}): SavedEmptyKind {
  if (pubsCount > 0) return 'none'
  if (savedOnly && savedCount === 0) return 'no-saved'
  if (filtersActive) return 'no-match'
  return signedIn ? 'no-catalog-signed-in' : 'no-catalog-signed-out'
}
