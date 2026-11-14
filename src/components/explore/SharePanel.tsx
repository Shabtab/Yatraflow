// ============ Explore — share a plan ============
// A teal call-out that points a reader at My trips, where a trip is published
// from its Share tab. A creator can set a plan free or put a price on the full
// plan, so the line says both.
import { useId } from 'react'
import { PenLine } from 'lucide-react'
import { appLink } from '../../lib/appLink'

export function SharePanel() {
  const titleId = useId()
  return (
    <section className="ex-panel ex-share" aria-labelledby={titleId}>
      <p className="ex-share-kicker">Been somewhere good?</p>
      <h2 className="ex-share-title" id={titleId}>Share your trip. Set it free, or sell the full plan.</h2>
      <a className="btn ex-share-btn" {...appLink('/trips')}>
        <PenLine size={15} aria-hidden />Publish a trip
      </a>
    </section>
  )
}
