// ============ Explore — places in the community ============
// One papercut tile per place that live plans route through. A tile searches
// that place. The panel is not drawn when no place has a plan yet.
//
// A tile shows the scene of the place its own name resolves to. That is either
// the place's own scene, or the representative scene of the one state the name
// names, or the neutral generic scene. It must never borrow a named region's
// scene: a Himalaya scene on a tile called "Rishikesh" would be a false claim
// about the place, which is worse than no scene at all. The inline motif stays
// as the loading and error floor.
//
// A tile names exactly one place, so a cross-state result is impossible here by
// construction: one name resolves to one state at most.
import { useId } from 'react'
import type { PlaceTile } from '../../lib/explorePage'
import { ART_MANIFEST, artIdFor } from '../../lib/regionArt'
import { placeArtFor, placeFallbacksFrom } from '../../lib/placeArt'
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
          // The tile's own name is the only input, so the scene can only ever be
          // this place's scene, this place's state scene, or the neutral one.
          const place = placeArtFor([tile.name], tile.name, placeFallbacksFrom(ART_MANIFEST))
          const region = regionFor({ destinations: [tile.name] })
          // Only a place or state result names this tile's geography. A generic
          // result falls through to the region chain, which is where the seven
          // older regions (Kerala, Goa, ...) are still recognised.
          const id = place && place.kind !== 'generic'
            ? place.id
            : artIdFor(region, tile.name)
          return (
            <li key={tile.name}>
              <button type="button" className="ex-place" onClick={() => onPick(tile.name)}>
                <span className="ex-place-art">
                  <RegionArt
                    id={id}
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
