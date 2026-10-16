// P7 storefront: the cover plate. A photo when there is one, a ticket otherwise.
// The ticket sits on a pattern of round kind icons built from the trip's own mix.
import type { CSSProperties } from 'react'
import type { CoverPlan } from '../../lib/publicStorefront'
import { KindChip, KIND_CATEGORY } from './KindChip'
import { CatIcon } from '../icons'

/** How many round tiles the pattern draws. The grid clips the extra ones. */
const PATTERN_TILES = 30

export function CoverPlate(p: { plan: CoverPlan; alt: string }): JSX.Element {
  if (p.plan.kind === 'photo') {
    return (
      <div className="sf-cover sf-cover-photo">
        <img src={p.plan.src} alt={p.alt} loading="lazy" />
      </div>
    )
  }
  const plan = p.plan
  return (
    <div className="sf-cover" role="group" aria-label={p.alt}>
      <div className="sf-cover-pattern" aria-hidden="true">
        {plan.kinds.length > 0 && Array.from({ length: PATTERN_TILES }, (_, i) => {
          const k = plan.kinds[i % plan.kinds.length]
          return (
            <span key={i} className={'sf-cover-dot sf-kind--' + k.kind} style={{ '--i': i } as CSSProperties}>
              <CatIcon category={KIND_CATEGORY[k.kind]} />
            </span>
          )
        })}
      </div>
      <div className="sf-cover-ticket">
        <p className="sf-cover-ticket-route">{plan.routeLine}</p>
        <div className="sf-cover-ticket-meta">
          <span>{plan.days} days · {plan.mode}</span>
          {plan.kinds.map((k) => <KindChip key={k.kind} kind={k.kind} count={k.count} />)}
        </div>
      </div>
    </div>
  )
}
