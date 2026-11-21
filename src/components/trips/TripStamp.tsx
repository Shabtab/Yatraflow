// ============ My trips — glass date stamp ============
// A small frosted tile on a cover: weekday, day and month of the start day.
// A trip without a usable start day shows "No dates yet" instead of a stamp.
import type { DateStamp } from '../../lib/tripsPage'

export function TripStamp({ stamp }: { stamp: DateStamp | null }) {
  if (!stamp) {
    return <div className="mt-stamp mt-stamp--none"><b>No dates yet</b></div>
  }
  return (
    <div className="mt-stamp">
      <span>{stamp.weekday}</span>
      <b>{stamp.day}</b>
      <em>{stamp.month}</em>
    </div>
  )
}
