// ============ Explore — places in the community ============
// One papercut tile per place that live plans route through. A tile searches
// that place. The panel is not drawn when no place has a plan yet.
//
// A tile shows the scene of the region its place name maps to, and nothing else.
// A name no region matches keeps the generic motif: artIdFor returns null for
// "generic", so no fallback scene is substituted. A Himalaya scene on a tile
// called "Rishikesh" would be a false claim about the place, which is worse than
// no scene at all.
import { useId } from 'react'
import type { PlaceTile } from '../../lib/explorePage'
import { artIdFor } from '../../lib/regionArt'
import { regionFor } from '../../lib/tripsPage'
import { RegionArt } from '../RegionArt'
import { TripArt } from '../trips/TripArt'

/**
 * A tile is square (`.ex-place`, styles.css:8804). `.ex-places` is two columns
 * at every width (8802), which is later in the file than the three-column
 * container rule at 8559, so two is what actually renders; measured at 1099 it
 * is 496 wide, not the ~330 a three-column reading would suggest.
 *
 * Above 1099px the panel is the 288px aside, so a tile is 118. Below that the
 * panel spans the layout and its own padding applies: 20px sides above 720
 * (8795), 16px sides below (8915). Measured: 118 at 1100, 496 at 1099, 447 at
 * 1000, 397 at 900, 331 at 768, 307 at 720, 285 at 640, 245 at 560, 205 at 480,
 * 160 at 390.
 */
const TILE_SIZES = [
  '(min-width: 1100px) 118px',
  '(min-width: 721px) calc((100vw - 106px) / 2)',
  'calc((100vw - 70px) / 2)',
].join(', ')

export function PlacesPanel({ tiles, onPick }: { tiles: PlaceTile[]; onPick: (name: string) => void }) {
  const titleId = useId()
  if (tiles.length === 0) return null
  return (
    <section className="ex-panel ex-panel-places" aria-labelledby={titleId}>
      <h2 className="ex-panel-title" id={titleId}>Places in the community</h2>
      <ul className="ex-places">
        {tiles.map(tile => {
          const region = regionFor({ destinations: [tile.name] })
          return (
            <li key={tile.name}>
              <button type="button" className="ex-place" onClick={() => onPick(tile.name)}>
                <span className="ex-place-art">
                  <RegionArt
                    id={artIdFor(region, tile.name)}
                    ratio="1:1"
                    sizes={TILE_SIZES}
                    fallback={<TripArt region={region} />}
                  />
                </span>
                <span className="ex-place-label">
                  <span className="ex-place-name">{tile.name}</span>
                  <span className="ex-place-meta">{tile.count} {tile.count === 1 ? 'itinerary' : 'itineraries'}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
