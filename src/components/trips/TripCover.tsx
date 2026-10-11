// ============ My trips — card cover ============
// A trip with its own cover image keeps the shared CoverThumb. Every other trip
// gets the papercut motif for its region. The status tag sits on top of both.
import { CoverThumb } from '../CoverThumb'
import { regionFor, type TripStatus } from '../../lib/tripsPage'
import type { Trip } from '../../data/types'
import { StatusTag } from './StatusTag'
import { TripArt } from './TripArt'

export function TripCover({ trip, status }: { trip: Trip; status: TripStatus }) {
  const hasOwnCover = Boolean(trip.coverImageUrl)
  return (
    <div className="mt-cover">
      {hasOwnCover ? (
        <CoverThumb variant="short" trip={trip} explicitUrl={trip.coverImageUrl} emoji={trip.coverEmoji} />
      ) : (
        <TripArt region={regionFor(trip)} />
      )}
      <StatusTag status={status} />
    </div>
  )
}
