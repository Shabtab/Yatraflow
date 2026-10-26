// ============ Explore — card cover ============
// A publication with its own cover image shows that image. Every other one gets
// the papercut art for the region its route names, the same art My trips uses,
// with the generated scene for that region over it where one exists. The motif
// stays underneath as the loading and error floor. No photo is fetched for a card.
//
// The seed is the publication id, so a card keeps the same scene across renders
// and pages. Every call site already passes a whole publication, so the id costs
// them nothing.
import type { PublishedItinerary } from '../../data/types'
import { regionFor } from '../../lib/tripsPage'
import { coverFor } from '../../lib/regionArt'
import { sizedCoverUrl } from '../../lib/tripThumb'
import { RegionArt } from '../RegionArt'
import { TripArt } from '../trips/TripArt'

/**
 * The `.ex-grid` cover box, measured in the browser.
 *
 * `.ex-grid` is a *container* query on `.ex-main` (styles.css:8552, 8664-8669),
 * not a viewport one. Above 1099px the layout is `1fr 288px` with a 24px gap
 * (8550), so the main column is 100vw - 40 - 15 - 312. Below that the main
 * column is the whole catalog. `.ex-card` carries 6px padding and a 1px border
 * (8673-8675), so a cover is its column less 14.
 *
 * Measured covers: 269 at 1280, 345 at 1100 (2 cols), 288 at 1000, 401 at 900,
 * 335 at 768, 311 at 720, 284 at 640 (2 cols), 246 at 560, 438 at 480,
 * 348 at 390.
 */
export const EX_GRID_SIZES = [
  '(min-width: 1280px) 269px',
  '(min-width: 1100px) calc((100vw - 367px) / 2)',
  '(min-width: 940px) calc((100vw - 69px) / 3)',
  '(min-width: 616px) calc((100vw - 69px) / 2)',
  'calc(100vw - 42px)',
].join(', ')

/**
 * The trending shelf. A phone gets a snapping row of `min(72%, 260px)` items
 * inside a list with 2px side padding (styles.css:9864-9868); from 560px of
 * main it is the same 2/3-column grid as `.ex-grid` (9869-9875), so the grid
 * ladder applies from there up. Measured: 269 at 1280, 345 at 1100, 288 at 1000,
 * 401 at 900, 335 at 768, 311 at 720, 284 at 640, 246 at 560, 244 at 390.
 */
export const EX_TREND_SIZES = [
  '(min-width: 1280px) 269px',
  '(min-width: 1100px) calc((100vw - 367px) / 2)',
  '(min-width: 940px) calc((100vw - 69px) / 3)',
  '(min-width: 616px) calc((100vw - 69px) / 2)',
  'calc(min((100vw - 30px) * .72, 260px) - 14px)',
].join(', ')

/**
 * The `.ex-feature` cover: the 1.08fr share of a 2.08fr row above a 640px main
 * column (8749-8751), on the card's content box, so 0.519 of main - 14.
 * Measured: 454 at 1280, 373 at 1100, 483 at 1000 (single column), 431 at 900,
 * 363 at 768, 339 at 720, 598 at 640 (single column), 348 at 390.
 */
export const EX_FEATURE_SIZES = [
  '(min-width: 1280px) 454px',
  '(min-width: 1100px) calc((100vw - 381px) * 0.519)',
  '(min-width: 700px) calc((100vw - 54px) * 0.519)',
  'calc(100vw - 42px)',
].join(', ')

export function ExploreCover({ pub, sizes = EX_GRID_SIZES }: {
  pub: Pick<PublishedItinerary, 'id' | 'coverImageUrl' | 'routeSummary'>
  /** The slot's real container width. The featured card is wider than a grid card. */
  sizes?: string
}) {
  const coverUrl = pub.coverImageUrl ? sizedCoverUrl(pub.coverImageUrl) : ''
  if (coverUrl) {
    return <img className="ex-cover-img" src={coverUrl} alt="" loading="lazy" decoding="async" />
  }
  const region = regionFor({ destinations: pub.routeSummary })
  // The publication's route stops go in as they are, so a stop the India place
  // layer knows (a jurisdiction or a named destination) can win over the
  // seven-region collapse.
  const choice = coverFor({
    region,
    seed: pub.id,
    placeCount: pub.routeSummary?.length ?? 0,
    destinations: pub.routeSummary,
  })
  return (
    <RegionArt
      id={choice?.kind === 'generated' ? choice.id : null}
      ratio="16:10"
      sizes={sizes}
      fallback={<TripArt region={region} />}
    />
  )
}
