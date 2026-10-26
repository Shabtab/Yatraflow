// ============ My trips — card cover ============
// A trip with its own cover image keeps the shared CoverThumb. Every other trip
// gets the papercut motif for its region, and where a generated scene exists for
// that region the scene paints over the motif. The motif stays underneath as the
// loading and error floor. The status tag sits on top of all three.
import { CoverThumb } from '../CoverThumb'
import { regionFor, type TripStatus } from '../../lib/tripsPage'
import { coverFor } from '../../lib/regionArt'
import type { Trip } from '../../data/types'
import { RegionArt } from '../RegionArt'
import { StatusTag } from './StatusTag'
import { TripArt } from './TripArt'

export function TripCover({ trip, status, sizes = GRID_SIZES }: {
  trip: Trip
  status: TripStatus
  /** The slot's real width. The list layout is a narrow fixed column, so it passes its own. */
  sizes?: string
}) {
  const hasOwnCover = Boolean(trip.coverImageUrl)
  const region = regionFor(trip)
  // The user's own cover is handled above by CoverThumb. The chain here is the
  // India place scene for the trip's own destinations, then the seven-region
  // scene, then the road or city family, then the motif. The raw destination
  // strings go in, not just the collapsed region: a trip to Bhubaneswar can only
  // reach Odisha's scene if this layer sees the name.
  const choice = hasOwnCover
    ? null
    : coverFor({
      region,
      seed: trip.id,
      placeCount: trip.destinations?.length ?? 0,
      destinations: trip.destinations,
    })
  return (
    <div className="mt-cover">
      {hasOwnCover ? (
        <CoverThumb variant="short" trip={trip} explicitUrl={trip.coverImageUrl} emoji={trip.coverEmoji} />
      ) : (
        <RegionArt
          id={choice?.kind === 'generated' ? choice.id : null}
          ratio="16:10"
          sizes={sizes}
          fallback={<TripArt region={region} />}
        />
      )}
      <StatusTag status={status} />
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
 * `.mt-feat` is two columns above a 640px catalog, the cover taking 1.05 of
 * 2.05 (8333-8335), on the card's content box, so 0.5122 of it. A 640px
 * catalog is a 695px viewport. Measured: 607 at 1280, 528 at 1100, 477 at 1000,
 * 426 at 900, 358 at 768, 334 at 721, 598 at 640 (one column), 348 at 390.
 */
export const FEATURED_SIZES = [
  '(min-width: 1255px) 608px',
  '(min-width: 695px) calc((100vw - 69px) * .5122)',
  // One column between 641 and 694: the catalog less its own 14px.
  '(min-width: 641px) calc(100vw - 69px)',
  'calc(100vw - 42px)',
].join(', ')
