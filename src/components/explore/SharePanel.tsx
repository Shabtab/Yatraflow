// ============ Explore — share a plan ============
// A teal call-out that points a reader at My trips, where a trip is published
// from its Share tab. Publishing makes a plan public or invites the crew to
// plan together, so the line says both. It must not offer a sale: paid unlocks
// exist but the creator payout rail does not, so "sell the full plan" claimed
// money a creator cannot yet receive (#234).
import { useId } from 'react'
import { PenLine } from 'lucide-react'
import { appLink } from '../../lib/appLink'

export function SharePanel() {
  const titleId = useId()
  return (
    <section className="ex-panel ex-share" aria-labelledby={titleId}>
      <p className="ex-share-kicker">Been somewhere good?</p>
      <h2 className="ex-share-title" id={titleId}>Share your trip publicly or invite your crew to plan together.</h2>
      <a className="btn ex-share-btn" {...appLink('/trips')}>
        <PenLine size={15} aria-hidden />Publish a trip
      </a>
    </section>
  )
}
