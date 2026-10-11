// ============ Explore — hero ============
// The page title, one line of context, the jump-to-itineraries button, four
// catalog counts and a trio of papercut postcards with a handwritten note. The
// search field lives in the filter bar, under the title of the catalog.
import { useId } from 'react'
import { ArrowDown } from 'lucide-react'
import type { TripRegion } from '../../lib/tripsPage'
import { TripArt } from '../trips/TripArt'

export interface HeroStat { label: string; value: number }

const POSTCARDS: { region: TripRegion; place: string; className: string }[] = [
  { region: 'kashmir', place: 'Srinagar', className: 'ex-pc-1' },
  { region: 'kerala', place: 'Alappuzha', className: 'ex-pc-2' },
  { region: 'rajasthan', place: 'Udaipur', className: 'ex-pc-3' },
]

export function ExploreHero({ stats, onExplore }: {
  stats: HeroStat[]
  onExplore: () => void
}) {
  const titleId = useId()
  return (
    <section className="ex-hero" aria-labelledby={titleId}>
      <div className="ex-hero-copy">
        <h1 id={titleId}>Find your next <em>great journey.</em></h1>
        <p className="ex-hero-lede">Discover routes shared by the community. Make one your own.</p>
        <div className="ex-hero-actions">
          <button type="button" className="btn btn-primary ex-cta" onClick={onExplore}>
            Explore itineraries<ArrowDown size={18} aria-hidden />
          </button>
          <dl className="ex-stats" aria-label="Catalog at a glance">
            {stats.map(stat => (
              <div className="ex-stat" key={stat.label}>
                <dt>{stat.label}</dt>
                <dd>{stat.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <div className="ex-hero-visual" aria-hidden="true">
        <div className="ex-postcards">
          <svg className="ex-route-line" viewBox="0 0 480 272" preserveAspectRatio="none" focusable="false">
            <path d="M46 150C80 110 130 76 190 82S330 30 372 70 340 170 300 172" />
            <circle cx="46" cy="150" r="4" />
          </svg>
          {POSTCARDS.map(card => (
            <figure className={`ex-postcard ${card.className}`} key={card.place}>
              <div className="ex-postcard-art"><TripArt region={card.region} /></div>
              <figcaption>{card.place}<span className="ex-stamp" /></figcaption>
            </figure>
          ))}
        </div>
        <p className="ex-note">
          <span>
            <span>Find a plan,</span>
            <span>fork it,</span>
            <span className="ex-note-hl">make it yours.</span>
          </span>
          <svg viewBox="0 0 54 62" focusable="false">
            <path d="M8 4c14 4 30 16 30 34 0 6-2 11-6 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M24 50l8 6 6-10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </p>
      </div>
    </section>
  )
}
