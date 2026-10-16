// P7 storefront: the cover plate. A photo when there is one, a ticket otherwise.
import type { CoverPlan } from '../../lib/publicStorefront'
import { KindChip } from './KindChip'

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
    <div className="sf-cover sf-cover-ticket" aria-label={p.alt}>
      <div className="sf-cover-pattern" aria-hidden="true">
        {plan.kinds.flatMap((k) => [0, 1, 2, 3].map((i) => (
          <span key={k.kind + '-' + i} className={'sf-cover-dot sf-kind--' + k.kind} />
        )))}
      </div>
      <p className="sf-cover-ticket-route">{plan.routeLine}</p>
      <div className="sf-cover-ticket-meta">
        <span>{plan.days} days · {plan.mode}</span>
        {plan.kinds.map((k) => <KindChip key={k.kind} kind={k.kind} count={k.count} />)}
      </div>
    </div>
  )
}

