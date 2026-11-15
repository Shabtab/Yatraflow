// ============ Creator ranking read model (P2, pure) ============
//
// The Explore creators strip, extended with the fields the ranking UI needs:
// the row's rank, its total views and the style it is known for. The ordering
// and the disabled-account rule are `creatorList`'s, reused verbatim — a second
// copy of the sort would drift from the strip the visitor already sees.
//
// Disabled creators never rank: `creatorList` drops accounts whose server-
// derived `creatorAvailable` flag is false, and rows here inherit that.
import type { CachedUser, PublishedItinerary, TravelStyle } from '../data/types'
import { TRAVEL_STYLES } from '../data/types'
import { creatorList, type CreatorTile } from './explorePage'
import { livePubs } from './livePubs'

export interface CreatorRankRow extends CreatorTile {
  /** 1-based position in `creatorList`'s order (forks, plans, name, id). */
  rank: number
  views: number
  /** The most common `travelStyle` across the creator's live routes; ties go
   *  to the style earlier in `TRAVEL_STYLES`. Always defined: a row exists
   *  only for a creator with at least one live route. */
  knownFor: TravelStyle
}

/** Every rankable creator, in `creatorList`'s order, with rank, views and
 *  `knownFor`. `style` narrows the pool to live routes of that style before
 *  anything is counted. */
export function rankCreators(
  pubs: PublishedItinerary[],
  users: CachedUser[],
  options: { style?: TravelStyle } = {},
): CreatorRankRow[] {
  const pool = options.style === undefined ? pubs : livePubs(pubs).filter(pub => pub.travelStyle === options.style)
  const tiles = creatorList(pool, users, Infinity)
  const ownOf = new Map(tiles.map(tile => [tile.id, livePubs(pool).filter(pub => pub.creatorId === tile.id)] as const))
  return tiles.map((tile, index) => {
    const own = ownOf.get(tile.id) ?? []
    return {
      ...tile,
      rank: index + 1,
      views: own.reduce((total, pub) => total + pub.views, 0),
      knownFor: mostCommonStyle(own.map(pub => pub.travelStyle)),
    }
  })
}

/** The most common style, ties to the earlier name in `TRAVEL_STYLES`. */
function mostCommonStyle(styles: TravelStyle[]): TravelStyle {
  const counts = new Map<TravelStyle, number>()
  for (const style of styles) counts.set(style, (counts.get(style) ?? 0) + 1)
  let best = styles[0]
  for (const style of TRAVEL_STYLES) {
    if ((counts.get(style) ?? 0) > (counts.get(best) ?? 0)) best = style
  }
  return best
}

export interface RankPosition {
  rank: number
  total: number
  /** Forks between this row and the row one place better; 0 for rank 1. */
  forksToNext: number
}

/** Where one creator sits in the ranking, or `undefined` when they hold no
 *  live route and so never entered the list. */
export function rankOf(rows: CreatorRankRow[], id: string): RankPosition | undefined {
  const row = rows.find(candidate => candidate.id === id)
  if (!row) return undefined
  const ahead = rows.find(candidate => candidate.rank === row.rank - 1)
  return {
    rank: row.rank,
    total: rows.length,
    forksToNext: row.rank === 1 || !ahead ? 0 : ahead.forks - row.forks,
  }
}
