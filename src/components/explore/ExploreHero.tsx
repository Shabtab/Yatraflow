// ============ Explore — hero ============
// The page label, the headline, one line of context, the search field, two
// quick picks, four catalog counts and a trio of papercut postcards with the
// catalog's own fork count on a note.
//
// The search field is the page's only one. It reads and writes the page's query
// (the same state the URL carries), and the filter bar has none, so there is no
// second source of truth. Search jumps to the results. A quick pick is a toggle
// on a filter the bar already has (length, budget), so it needs no state of its
// own. The count note is real data — the sum of `copies` over
// the live catalog — and it prints only when that sum is above zero, because a
// zero here would be a claim over a read that may not have happened.
//
// The handwritten note this slot used to carry is gone: the headline says the
// same words, and the note now carries a figure the reader cannot get anywhere
// else on the page at a glance.
//
// Each postcard shows the scene its own place resolves to. The place layer is
// asked first with the postcard's place name, so "Srinagar" reaches the J&K
// scene and "Alappuzha" reaches the Kerala scene rather than the state default.
// The seven-region scene stays as the answer when the place layer has nothing
// specific to say. The motif remains the loading and error floor. The postcard
// set is static, so the seed is the place name: a postcard keeps its scene.
import { ART_MANIFEST, artIdFor } from '../../lib/regionArt'
import { placeArtFor, placeFallbacksFrom } from '../../lib/placeArt'
import type { TripRegion } from '../../lib/tripsPage'
import { RegionArt } from '../RegionArt'
import { TripArt } from '../trips/TripArt'
import { SearchField } from '../filters/SearchField'
import { FilterChip } from '../filters/FilterChip'
import { PageHero } from '../page/PageHero'

export interface HeroStat { label: string; value: number }

const POSTCARDS: { region: TripRegion; place: string; className: string }[] = [
  { region: 'kerala', place: 'Alleppey', className: 'ex-pc-1' },
  { region: 'kashmir', place: 'Leh', className: 'ex-pc-2' },
  { region: 'generic', place: 'Puducherry', className: 'ex-pc-3' },
]

/**
 * The widest `.ex-postcard` is 42.3% of `.ex-hero-visual`, which caps at 520px,
 * less its own 8px side padding (the PR914 Explore block in styles.css):
 * 520 * .423 - 16 = 204. The postcards are `display: none` below 960px, so no
 * smaller case exists.
 */
const POSTCARD_SIZES = '204px'

export interface QuickPick { key: string; label: string; pressed: boolean; onToggle: () => void }

export function ExploreHero({ stats, forks, query, onQueryChange, onSearch, quickPicks }: {
  stats: HeroStat[]
  /** The live catalog's total forks. The note prints only above zero. */
  forks: number
  query: string
  onQueryChange: (next: string) => void
  /** Search (button or Enter): bring the results to the top. */
  onSearch: () => void
  quickPicks: QuickPick[]
}) {
  return (
    <PageHero
      kicker="Explore · plans from the community"
      headline={{ lead: 'Find a plan, fork it,', accent: 'make it yours.' }}
      lede="Real trips from real travellers, with every drive and stop timed. Fork one into your trips and change anything."
      primary={
        <form className="ex-hero-search" role="search" aria-label="Search itineraries"
          onSubmit={event => { event.preventDefault(); onSearch() }}>
          <SearchField value={query} onChange={onQueryChange} label="Search by route, place or creator"
            placeholder="Search a route, place or creator" shortPlaceholder="Search routes" />
          <button type="submit" className="btn btn-primary ex-hero-search-go">Search</button>
        </form>
      }
      secondary={
        <div className="ex-quick" role="group" aria-label="Quick picks">
          {quickPicks.map(pick => (
            <FilterChip key={pick.key} className="ex-quick-chip" pressed={pick.pressed} onClick={pick.onToggle}>
              {pick.label}
            </FilterChip>
          ))}
        </div>
      }
      stats={stats}
      statsPlacement="below"
      statsLabel="Catalog at a glance"
      visual={
        <>
          <div className="ex-postcards">
            <svg className="ex-route-line" viewBox="0 0 520 400" preserveAspectRatio="none" focusable="false">
              <path d="M60 300 C110 230 160 190 240 200 S380 120 440 170 S430 300 360 320" />
              <circle cx="60" cy="300" r="7" />
              <circle className="ex-route-end" cx="360" cy="320" r="8" />
            </svg>
            {POSTCARDS.map(card => {
              const place = placeArtFor([card.place], card.place, placeFallbacksFrom(ART_MANIFEST))
              const id = place && place.kind !== 'generic' ? place.id : artIdFor(card.region, card.place)
              return (
                <figure className={`ex-postcard ${card.className}`} key={card.place}>
                  <div className="ex-postcard-art">
                    <RegionArt
                      id={id}
                      ratio="4:3"
                      sizes={POSTCARD_SIZES}
                      fallback={<TripArt region={card.region} />}
                    />
                  </div>
                  <figcaption>{card.place}<span className="ex-stamp" /></figcaption>
                </figure>
              )
            })}
          </div>
          {forks > 0 && <p className="ex-forks-note"><b>{forks}</b> forks and counting</p>}
        </>
      }
    />
  )
}
