// ============ My trips — card cover ============
// One renderer, one image: the traveller's upload, else the generated scene for
// the trip's own places, else their emoji. The raw destination strings go in,
// not just the collapsed region, so a trip to Bhubaneswar can reach Odisha's
// scene. The status tag sits on top.
import type { ReactNode } from 'react'
import { CoverMedia } from '../CoverMedia'
import { regionFor, type TripStatus } from '../../lib/tripsPage'
import { coverPlanFor } from '../../lib/regionArt'
import { sizedCoverUrl } from '../../lib/tripThumb'
import type { Trip } from '../../data/types'
import { StatusTag } from './StatusTag'

export function TripCover({ trip, status, sizes = GRID_SIZES, showTag = true, children }: {
  trip: Trip
  status: TripStatus
  /** The slot's real width. The list layout is a narrow fixed column, so it passes its own. */
  sizes?: string
  /** False when the card draws its own status line instead of the dot tag. */
  showTag?: boolean
  /** Overlays on the cover: the date stamp, the status pill, the title. */
  children?: ReactNode
}) {
  const plan = coverPlanFor({
    // Sized on the way in, exactly as the shared card does. A Wikimedia cover
    // stored before sizing existed is a 1.3 MB original; every other cover
    // surface requests it at 1200px, so this one must too.
    userCover: trip.coverImageUrl ? sizedCoverUrl(trip.coverImageUrl) : '',
    fallbackEmoji: trip.coverEmoji,
    region: regionFor(trip),
    seed: trip.id,
    placeCount: trip.destinations?.length ?? 0,
    destinations: trip.destinations,
    startLocation: trip.startLocation,
  })
  return (
    <div className="mt-cover">
      <CoverMedia
        plan={plan}
        ratio="16:10"
        sizes={sizes}
        className="mt-cover-img"
        emojiClassName="itin-cover-fallback"
      />
      {showTag && <StatusTag status={status} />}
      {children}
    </div>
  )
}

/**
 * Honest container widths, derived from the CSS and then checked against
 * browser measurements at 13 viewport widths.
 *
 * `.mt-grid` is a *container* query on `.mt-catalog` (styles.css:8208,
 * 8228-8232), not a viewport query, so these breakpoints are the viewport
 * widths at which the catalog crosses 560px and 880px. Two further facts move
 * the arithmetic, and both were measured, not assumed:
 *
 *  - The catalog is `100vw` less its own padding and the scrollbar: 55px above
 *    640px, and 28px at 640 and below (the phone container padding).
 *  - `.mt-card` adds 6px padding and a 1px border each side (8236-8238), so a
 *    cover is its column less 14. Grid gaps are 18px at two columns and 20px at
 *    three (8228-8232).
 *
 * Measured covers: 373 at 1280, 321 at 1100, 288 at 1000, 400 at 900, 334 at
 * 768, 310 at 721, 283 at 640, 518 at 560, 348 at 390, 318 at 360.
 */
export const GRID_SIZES = [
  // Catalog is capped at 1200, so three columns are 373 wide.
  '(min-width: 1255px) 373px',
  // Three columns: (100vw - 55 - 40 - 42) / 3.
  '(min-width: 935px) calc((100vw - 137px) / 3)',
  // Two columns with the 20px page padding: (100vw - 55 - 18 - 28) / 2.
  '(min-width: 641px) calc((100vw - 101px) / 2)',
  // Two columns with the 14px phone padding: (100vw - 28 - 18 - 28) / 2.
  '(min-width: 615px) calc((100vw - 74px) / 2)',
  // One column: the catalog less the card's 14px, with the phone padding.
  'calc(100vw - 42px)',
].join(', ')

/** The `.mt-grid.is-list` cover column: 168px (8356), 112px base (8342), 76px (8385), 64px (8399). */
export const LIST_SIZES = '(min-width: 760px) 168px, (min-width: 641px) 112px, (min-width: 361px) 76px, 64px'

/**
 * `.mt-feat` is two columns above a 640px catalog, the cover taking 1.25 of
 * 2.25 (see 09-trips-list.css), on the card's content box, so 0.5556 of it. A
 * 640px catalog is a 695px viewport. The catalog caps at 1200px, so the card's
 * content box is 1186px and the cover is 659px wide there.
 */
export const FEATURED_SIZES = [
  '(min-width: 1255px) 659px',
  '(min-width: 695px) calc((100vw - 69px) * .5556)',
  // One column between 641 and 694: the catalog less its own 14px.
  '(min-width: 641px) calc(100vw - 69px)',
  'calc(100vw - 42px)',
].join(', ')
