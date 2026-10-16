// P7 storefront: the cover plate. A photo when there is one, a ticket otherwise.
// The ticket sits on a pattern of round kind icons built from the trip's own mix.
import { useState } from 'react'
import type { CSSProperties } from 'react'
import type { CoverPlan } from '../../lib/publicStorefront'
import { KindChip, KIND_CATEGORY } from './KindChip'
import { CatIcon } from '../icons'

/** How many round tiles the pattern draws. The grid hides the ones that do not fit. */
const PATTERN_TILES = 40
/** The entrance delay stops growing here, so the last tile never starts late. */
const STAGGER_CAP = 8

type TicketPlan = Extract<CoverPlan, { kind: 'ticket' }>

export function CoverPlate(p: {
  plan: CoverPlan
  alt: string
  /** The ticket to show when the photo fails to load. */
  fallback?: TicketPlan
}): JSX.Element | null {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  let plan: CoverPlan | undefined = p.plan
  if (plan.kind === 'photo' && brokenSrc === plan.src) plan = p.fallback
  if (!plan) return null
  if (plan.kind === 'photo') {
    const src = plan.src
    return (
      <div className="sf-cover sf-cover-photo">
        <img src={src} alt={p.alt} loading="lazy" onError={() => setBrokenSrc(src)} />
      </div>
    )
  }
  const ticket = plan
  return (
    <div className="sf-cover" role="group" aria-label={p.alt}>
      <div className="sf-cover-pattern" aria-hidden="true">
        {ticket.kinds.length > 0 && Array.from({ length: PATTERN_TILES }, (_, i) => {
          const k = ticket.kinds[i % ticket.kinds.length]
          return (
            <span key={i} className={'sf-cover-dot sf-kind--' + k.kind} style={{ '--i': Math.min(i, STAGGER_CAP) } as CSSProperties}>
              <CatIcon category={KIND_CATEGORY[k.kind]} />
            </span>
          )
        })}
      </div>
      <div className="sf-cover-ticket">
        <p className="sf-cover-ticket-route">{ticket.routeLine}</p>
        <div className="sf-cover-ticket-meta">
          <span>{ticket.days} days · {ticket.mode}</span>
          {ticket.kinds.map((k) => <KindChip key={k.kind} kind={k.kind} count={k.count} />)}
        </div>
      </div>
    </div>
  )
}
