// ============ Explore — route trail ============
// The first and last stops, with evenly spaced stops between them (routeTrail).
// A route that ends where it starts is a loop, and its last dot is hollow.
import { Repeat, Route } from 'lucide-react'
import { routeTrail } from '../../lib/explorePage'

export function RouteTrail({ routeSummary }: { routeSummary: string[] }) {
  const { stops, hidden } = routeTrail(routeSummary)
  if (stops.length === 0) return null
  const isLoop = routeSummary.length > 1 && routeSummary[0] === routeSummary[routeSummary.length - 1]
  return (
    <div className="ex-route">
      {/* The heading names the kind only. The trail below lists the stops, so
          the first and last stop are never printed twice. */}
      <p className="ex-route-kind">
        {isLoop ? <Repeat size={14} aria-hidden /> : <Route size={14} aria-hidden />}
        {isLoop ? 'Loop' : 'Route'}
      </p>
      <ol className={`ex-trail${isLoop ? ' is-loop' : ''}`} aria-label="Places on the route">
        {stops.map((stop, index) => (
          <li key={`${index}-${stop}`}>{stop}</li>
        ))}
      </ol>
      {hidden > 0 && <p className="ex-route-more">{hidden} more {hidden === 1 ? 'stop' : 'stops'} not shown</p>}
    </div>
  )
}
