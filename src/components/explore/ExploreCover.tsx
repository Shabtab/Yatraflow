// ============ Explore — card cover ============
// A publication with its own cover image shows that image. Every other one gets
// the papercut art for the region its route names, the same art My trips uses.
// No photo is fetched for a card.
import type { PublishedItinerary } from '../../data/types'
import { regionFor } from '../../lib/tripsPage'
import { sizedCoverUrl } from '../../lib/tripThumb'
import { TripArt } from '../trips/TripArt'

export function ExploreCover({ pub }: { pub: Pick<PublishedItinerary, 'coverImageUrl' | 'routeSummary'> }) {
  const coverUrl = pub.coverImageUrl ? sizedCoverUrl(pub.coverImageUrl) : ''
  if (coverUrl) {
    return <img className="ex-cover-img" src={coverUrl} alt="" loading="lazy" decoding="async" />
  }
  return <TripArt region={regionFor({ destinations: pub.routeSummary })} />
}
