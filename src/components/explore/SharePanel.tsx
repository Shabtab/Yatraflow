// ============ Explore — share a plan ============
// Points a reader at My trips, where a trip is published from its Share tab.
import { useId } from 'react'
import { Check, PenLine } from 'lucide-react'
import { appLink } from '../../lib/appLink'

export function SharePanel() {
  const titleId = useId()
  return (
    <section className="ex-panel ex-share" aria-labelledby={titleId}>
      <h2 className="ex-panel-title" id={titleId}>Share a plan</h2>
      <p className="ex-share-lede">Turn one of your trips into a route others can follow.</p>
      <ul className="ex-ticks">
        <li><Check size={16} aria-hidden /><span>Publish the route, stops and days from its Share tab</span></li>
        <li><Check size={16} aria-hidden /><span>Others fork it and make it their own</span></li>
        <li><Check size={16} aria-hidden /><span>See how many views and forks your route gets</span></li>
      </ul>
      <a className="btn btn-secondary ex-share-btn" {...appLink('/trips')}>
        <PenLine size={15} aria-hidden />Publish a trip
      </a>
    </section>
  )
}
