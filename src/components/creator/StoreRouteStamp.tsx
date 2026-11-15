import type { PublishedItinerary } from '../../data/types'
import { dayStamp } from './StoreHero'

export function StoreRouteStamp({ pub }: { pub: PublishedItinerary }) {
  return <p className="cr-store-route-stamp">
    {pub.reviewedAt !== undefined ? `Reviewed ${dayStamp(pub.reviewedAt)}` : `Updated ${dayStamp(pub.refreshedAt ?? pub.publishedAt)}`}
  </p>
}
