import { useEffect } from 'react'
import { freeDaysRead, markRideDayRead, useRideProgress } from '../../../lib/rideProgress'

/** The count line in the side panel. The ribbon head shows the same count with its bar. */
export function RideProgress({ publicationId, freeIndexes }: {
  publicationId: string
  freeIndexes: readonly number[]
}) {
  const read = useRideProgress(publicationId)
  const count = freeDaysRead(read, freeIndexes)
  return <div className="pi-read-summary"><span>{count} of {freeIndexes.length} free days read</span></div>
}

/** The write boundary: a free day on screen in Ride along counts as read. Draws nothing. */
export function RideReadMark({ publicationId, freeIndexes, index }: {
  publicationId: string
  freeIndexes: readonly number[]
  index: number
}): null {
  useEffect(() => {
    markRideDayRead(publicationId, index, freeIndexes)
  }, [publicationId, index, freeIndexes])
  return null
}
