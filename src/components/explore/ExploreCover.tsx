// ============ Explore — card cover ============
// One renderer, one image: the publication's own cover, else the generated
// scene for the places its route names, else the neutral emoji. The seed is the
// publication id, so a card keeps the same scene across renders and pages.
// Every call site already passes a whole publication, so the id costs them
// nothing. No photo is fetched for a card.
import type { PublishedItinerary } from '../../data/types'
import { regionFor } from '../../lib/tripsPage'
import { coverPlanFor } from '../../lib/regionArt'
import { sizedCoverUrl } from '../../lib/tripThumb'
import { CoverMedia } from '../CoverMedia'

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
 * The `.ex-feature` cover: a fixed 420px column above a 640px main column,
 * less its 10px inset. Below that the cover is the whole card width. The
 * breakpoint follows the main column, not the viewport, so a slightly large
 * size on a mid-width screen costs image bytes, never layout.
 */
export const EX_FEATURE_SIZES = [
  '(min-width: 700px) 410px',
  'calc(100vw - 50px)',
].join(', ')

/**
 * The creator storefront library grid (`cr-store-grid`), which the shared card
 * fills. The ladder matches the grid's own columns: three at 1440, two from
 * 700px (the container is 2 columns there through tablet), one below. The
 * container carries 20px of inline padding, and a 16px gap costs each column
 * about 11px. A wrong step costs image bytes, never layout.
 */
export const PUB_GRID_SIZES = [
  '(min-width: 1240px) calc((100vw - 40px) / 3 - 12px)',
  '(min-width: 700px) calc((100vw - 40px) / 2 - 12px)',
  'calc(100vw - 36px)',
].join(', ')

export function ExploreCover({ pub, sizes = EX_GRID_SIZES, eager = false, ratio = '16:10' }: {
  pub: Pick<PublishedItinerary, 'id' | 'coverImageUrl' | 'routeSummary'>
  /** The slot's real container width. The featured card is wider than a grid card. */
  sizes?: string
  /** Load the image at once. Cards near the top of the page set it, so a cover in
   *  the first screens never waits for a scroll to show. */
  eager?: boolean
  /** The crop ratio of this slot. The storefront hero band is far wider than a
   *  card, so it passes "21:9" to aim the focal point at the band's own shape. */
  ratio?: string
}) {
  const coverUrl = pub.coverImageUrl ? sizedCoverUrl(pub.coverImageUrl) : ''
  // The publication's route stops go in as they are, so a stop the India place
  // layer knows (a jurisdiction or a named destination) can win over the
  // seven-region collapse.
  const plan = coverPlanFor({
    userCover: coverUrl,
    region: regionFor({ destinations: pub.routeSummary }),
    seed: pub.id,
    placeCount: pub.routeSummary?.length ?? 0,
    destinations: pub.routeSummary,
  })
  return (
    <CoverMedia
      plan={plan}
      ratio={ratio}
      sizes={sizes}
      eager={eager}
      className="ex-cover-img"
      emojiClassName="itin-cover-fallback"
    />
  )
}
