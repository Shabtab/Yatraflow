// ============ Explore — places in the community ============
// One papercut tile per place that live plans route through. A tile searches
// that place. The panel is not drawn when no place has a plan yet.
import { useId } from 'react'
import type { PlaceTile } from '../../lib/explorePage'
import { regionFor } from '../../lib/tripsPage'
import { TripArt } from '../trips/TripArt'

export function PlacesPanel({ tiles, onPick }: { tiles: PlaceTile[]; onPick: (name: string) => void }) {
  const titleId = useId()
  if (tiles.length === 0) return null
  return (
    <section className="ex-panel ex-panel-places" aria-labelledby={titleId}>
      <h2 className="ex-panel-title" id={titleId}>Places in the community</h2>
      <ul className="ex-places">
        {tiles.map(tile => (
          <li key={tile.name}>
            <button type="button" className="ex-place" onClick={() => onPick(tile.name)}>
              <span className="ex-place-art">
                <TripArt region={regionFor({ destinations: [tile.name] })} />
              </span>
              <span className="ex-place-label">
                <span className="ex-place-name">{tile.name}</span>
                <span className="ex-place-meta">{tile.count} {tile.count === 1 ? 'itinerary' : 'itineraries'}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
