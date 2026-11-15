import type { PublishedItinerary } from '../../data/types'
import { appLink } from '../../lib/appLink'
import { countNoun } from '../../lib/creatorCopy'

/** One compact action for a failing readiness check. A single route names the
 *  route. Several routes show a count and open the first one, so the row stays
 *  one line high. Each link carries its own accessible name. */
export function ReadinessFix({ checkLabel, failing, pubs, className }: {
  checkLabel: string
  failing: readonly string[]
  pubs: readonly PublishedItinerary[]
  className?: string
}) {
  const routes = failing
    .map(id => pubs.find(pub => pub.id === id))
    .filter((pub): pub is PublishedItinerary => pub !== undefined)
  const first = routes[0]
  if (!first) return null
  const many = routes.length > 1
  return (
    <a
      className={className}
      {...appLink(`/trip/${first.tripId}/share`)}
      aria-label={many
        ? `Fix ${checkLabel} for ${countNoun(routes.length, 'route')}, starting with ${first.title}`
        : `Fix ${checkLabel} for ${first.title}`}
    >
      {many ? `Fix ${countNoun(routes.length, 'route')}` : `Fix · ${first.title}`}
    </a>
  )
}
