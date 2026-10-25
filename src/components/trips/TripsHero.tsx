// ============ My trips — hero ============
// The same editorial hero as Explore: a small kicker, a serif headline with an
// italic accent, one line of context, the actions, a row of real counts, and up
// to three papercut postcards with a handwritten note. Everything in it comes
// from the viewer's own trips (see heroHeadline, heroStats, heroPostcards and
// heroNote in lib/tripsPage). The page passes the buttons in, so each button
// keeps its handler there. The shell is PageHero; the postcards and the note
// stay here, in the visual slot.
//
// Postcard art follows the same rule as every cover: the trip's own cover photo
// wins, then the generated scene for its region, then the motif. The blank "your
// next trip" postcard keeps its compass.
import type { ReactNode } from 'react'
import { Compass } from 'lucide-react'
import { coverFor } from '../../lib/regionArt'
import { sizedCoverUrl } from '../../lib/tripThumb'
import type { HeroHeadline, HeroPostcard, HeroStat } from '../../lib/tripsPage'
import { RegionArt } from '../RegionArt'
import { TripArt } from './TripArt'
import { PageHero } from '../page/PageHero'
import { NoteArrow } from '../page/NoteArrow'

/**
 * Same box as the Explore postcards: `.ex-postcard` is 32% of `.ex-hero-visual`,
 * which caps at 480px, less its own 7px side padding (styles.css:8509,
 * 8514-8515, 8520), so 480 * .32 - 14 = 139.6. The one-card layout widens the
 * only postcard to 42% (8995), so that case is 480 * .42 - 14 = 187.6. The
 * postcards are `display: none` below 960px (8566).
 */
function postcardSizes(count: number): string {
  return count === 1 ? '188px' : '140px'
}

export function TripsHero({ headline, lede, stats, postcards, note, primary, secondary }: {
  headline: HeroHeadline
  lede: string
  /** Real counts only. Pass an empty list to hide the row. */
  stats: HeroStat[]
  postcards: HeroPostcard[]
  /** The handwritten note, or null when there is nothing true to say. */
  note: string | null
  /** The one main button. */
  primary: ReactNode
  /** Quiet buttons that sit beside it. */
  secondary: ReactNode
}) {
  return (
    <PageHero
      className="mt-hero"
      kicker="My trips"
      headline={headline}
      lede={lede}
      primary={primary}
      secondary={secondary}
      stats={stats}
      statsPlacement="below"
      statsLabel="Your trips at a glance"
      statsClassName="mt-hero-stats"
      visual={
        <>
          <div className="ex-postcards" data-count={postcards.length}>
            <svg className="ex-route-line" viewBox="0 0 480 272" preserveAspectRatio="none" focusable="false">
              <path d="M46 150C80 110 130 76 190 82S330 30 372 70 340 170 300 172" />
              <circle cx="46" cy="150" r="4" />
            </svg>
            {postcards.map((card, index) => {
              const choice = card.blank || card.coverImageUrl
                ? null
                : coverFor({ region: card.region, seed: card.key, placeCount: card.placeCount })
              return (
                <figure className={`ex-postcard ex-pc-${index + 1}`} key={card.key}>
                  <div className="ex-postcard-art">
                    {card.blank ? (
                      <div className="mt-pc-blank"><Compass size={26} aria-hidden /></div>
                    ) : card.coverImageUrl ? (
                      <img className="ex-cover-img" src={sizedCoverUrl(card.coverImageUrl)} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <RegionArt
                        id={choice?.kind === 'generated' ? choice.id : null}
                        ratio="4:3"
                        sizes={postcardSizes(postcards.length)}
                        fallback={<TripArt region={card.region} />}
                      />
                    )}
                  </div>
                  <figcaption><span className="mt-pc-place">{card.place}</span><span className="ex-stamp" /></figcaption>
                </figure>
              )
            })}
          </div>
          {note && (
            <p className="ex-note mt-note">
              <span><span className="ex-note-hl">{note}</span></span>
              <NoteArrow />
            </p>
          )}
        </>
      }
    />
  )
}
