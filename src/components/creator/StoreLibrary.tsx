// ============ Creator storefront — route library ============
// The section head, the "Starting from" filter and the card grid, with every
// read state drawn through StateBlock. Props only: the page owns the read, the
// rows and the fork or save behaviour; this component owns the filter choice.
import { useState } from 'react'
import { Compass, MapPin } from 'lucide-react'
import type { CachedUser, PublishedItinerary } from '../../data/types'
import { filterByStart, startPlaces } from '../../lib/creatorStorefront'
import { emptyCopyFor } from '../../lib/readState'
import type { ReadState, RowsView } from '../../lib/readState'
import { PubCard } from '../PubCard'
import { StateBlock } from '../page/StateBlock'
import { FilterChip } from '../filters/FilterChip'
import { CrSectionHead } from './CrSectionHead'

export function StoreLibrary({ name, pubs, view, read, retry, creator, savedIds, needsLogin, onFork, onToggleSave, onNavigate, emptyIsNotCreator }: {
  name: string
  pubs: PublishedItinerary[]
  /** The rowsView verdict for the publications slice, decided by the page. */
  view: RowsView
  read: ReadState
  retry: () => void
  creator: CachedUser
  savedIds: (id: string) => boolean
  needsLogin: boolean
  onFork: (pub: PublishedItinerary) => void
  onToggleSave: (id: string) => void
  onNavigate: (route: string) => void
  /** Zero live routes after a ready read: a non-creator gets the invite copy. */
  emptyIsNotCreator: boolean
}) {
  const [start, setStart] = useState<string | null>(null)
  const places = startPlaces(pubs)
  const rows = filterByStart(pubs, start)
  const anyPrice = pubs.some(pub => !!pub.premiumPriceInr)
  if (view === 'reading') {
    return (
      <section className="container cr-store-library" id="creator-library" tabIndex={-1}>
        <StateBlock kind="loading" title={`Loading ${name}’s routes…`} body="One moment." />
      </section>
    )
  }
  if (view === 'failed') {
    const copy = emptyCopyFor(read, 'publications', retry)
    return (
      <section className="container cr-store-library" id="creator-library" tabIndex={-1}>
        <StateBlock kind="failed" icon={<MapPin size={38} aria-hidden />} title={copy.title} body={copy.body}
          actions={<button className="btn btn-primary" onClick={retry}>Try again</button>} />
      </section>
    )
  }
  if (view === 'empty') {
    return (
      <section className="container cr-store-library" id="creator-library" tabIndex={-1}>
        {emptyIsNotCreator ? (
          <StateBlock kind="empty" icon={<Compass size={38} aria-hidden />} title="No creator page here yet"
            body={`${name} hasn’t enabled creator mode or published an itinerary.`}
            actions={<button className="btn btn-primary" onClick={() => onNavigate('/explore')}>Explore itineraries</button>} />
        ) : (
          <StateBlock kind="empty" icon={<MapPin size={38} aria-hidden />} title="No itineraries published yet"
            body="When they publish a trip to Explore, it will appear here." />
        )}
      </section>
    )
  }
  return (
    <section className="container cr-store-library" id="creator-library" tabIndex={-1}
      aria-labelledby="creator-library-title">
      <CrSectionHead
        kicker="Route library"
        title={`All ${pubs.length} routes by ${name}`}
        id="creator-library-title"
        note={anyPrice ? `Plan is what the plan costs. Trip is ${name}’s estimate of what the trip costs you.` : undefined}
      />
      {view === 'kept' && (
        <StateBlock kind="kept" size="compact" title="Couldn’t refresh these publications."
          body="Showing the ones that loaded."
          actions={<button className="btn btn-outline btn-sm" onClick={retry}>Try again</button>} />
      )}
      {places.length >= 2 && (
        <div className="cr-store-filter" role="group" aria-label="Filter routes by start place">
          <span className="cr-store-filter-label">Starting from</span>
          {places.map(place => (
            <FilterChip key={place.place} pressed={start === place.place} count={place.count}
              onClick={() => setStart(start === place.place ? null : place.place)}>
              {place.place}
            </FilterChip>
          ))}
        </div>
      )}
      <div className="cr-store-grid">
        {rows.map((pub, index) => (
          <PubCard key={pub.id} pub={pub} creator={creator} saved={savedIds(pub.id)} enterIndex={index}
            onFork={() => onFork(pub)} onToggleSave={() => onToggleSave(pub.id)} needsLogin={needsLogin} />
        ))}
      </div>
    </section>
  )
}
