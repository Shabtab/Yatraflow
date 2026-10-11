// ============ My trips — hero ============
// The same editorial hero as Explore: a small kicker, a serif headline with an
// italic accent, one line of context, the actions, a row of real counts, and up
// to three papercut postcards with a handwritten note. Everything in it comes
// from the viewer's own trips (see heroHeadline, heroStats, heroPostcards and
// heroNote in lib/tripsPage). The page passes the buttons in, so each button
// keeps its handler there.
import { useId, type ReactNode } from 'react'
import { Compass } from 'lucide-react'
import { sizedCoverUrl } from '../../lib/tripThumb'
import type { HeroHeadline, HeroPostcard, HeroStat } from '../../lib/tripsPage'
import { TripArt } from './TripArt'

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
  const titleId = useId()
  return (
    <section className="ex-hero mt-hero" aria-labelledby={titleId}>
      <div className="ex-hero-copy">
        <p className="ex-kicker">My trips</p>
        <h1 id={titleId}>{headline.lead} <em>{headline.accent}</em></h1>
        <p className="ex-hero-lede">{lede}</p>
        <div className="ex-hero-actions">
          {primary}
          <div className="mt-hero-secondary">{secondary}</div>
        </div>
        {stats.length > 0 && (
          <dl className="ex-stats mt-hero-stats" aria-label="Your trips at a glance">
            {stats.map(stat => (
              <div className="ex-stat" key={stat.label}>
                <dt>{stat.label}</dt>
                <dd>{stat.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div className="ex-hero-visual" aria-hidden="true">
        <div className="ex-postcards" data-count={postcards.length}>
          <svg className="ex-route-line" viewBox="0 0 480 272" preserveAspectRatio="none" focusable="false">
            <path d="M46 150C80 110 130 76 190 82S330 30 372 70 340 170 300 172" />
            <circle cx="46" cy="150" r="4" />
          </svg>
          {postcards.map((card, index) => (
            <figure className={`ex-postcard ex-pc-${index + 1}`} key={card.key}>
              <div className="ex-postcard-art">
                {card.blank ? (
                  <div className="mt-pc-blank"><Compass size={26} aria-hidden /></div>
                ) : card.coverImageUrl ? (
                  <img className="ex-cover-img" src={sizedCoverUrl(card.coverImageUrl)} alt="" loading="lazy" decoding="async" />
                ) : (
                  <TripArt region={card.region} />
                )}
              </div>
              <figcaption><span className="mt-pc-place">{card.place}</span><span className="ex-stamp" /></figcaption>
            </figure>
          ))}
        </div>
        {note && (
          <p className="ex-note mt-note">
            <span><span className="ex-note-hl">{note}</span></span>
            <svg viewBox="0 0 54 62" focusable="false">
              <path d="M8 4c14 4 30 16 30 34 0 6-2 11-6 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M24 50l8 6 6-10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </p>
        )}
      </div>
    </section>
  )
}
