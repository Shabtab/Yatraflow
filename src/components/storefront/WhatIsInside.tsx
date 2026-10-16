// P7 storefront: the "What is inside" section. Words first, then chips, then day cards.
import type { KindCount, WeekGroup } from '../../lib/publicStorefront'
import { KindChip } from './KindChip'
import { DayCard, DayCardProps } from './DayCard'

/** The entrance delay stops growing here, so card 30 never starts late. */
const STAGGER_CAP = 8

export function WhatIsInside(p: {
  lede: string
  kinds: KindCount[]
  lockedLine?: string
  days: DayCardProps[]
  weeks?: WeekGroup[] | null
}): JSX.Element {
  const body = (
    <div className="sf-daygrid">
      {p.days.map((d, n) => <DayCard key={d.summary.index} {...d} stagger={Math.min(n, STAGGER_CAP)} />)}
    </div>
  )
  return (
    <div className="sf-inside">
      <p className="sf-inside-lede">{p.lede}</p>
      <div className="sf-inside-kinds">
        {p.kinds.map((k) => <KindChip key={k.kind} kind={k.kind} count={k.count} />)}
      </div>
      {p.lockedLine ? <p className="sf-inside-lock">{p.lockedLine}</p> : null}
      {p.weeks ? p.weeks.map((w, wi) => (
        <details key={w.label} className="sf-week" open={wi === 0}>
          <summary className="sf-week-summary">
            <h3 className="sf-week-title">{w.label}</h3>
          </summary>
          <div className="sf-daygrid">
            {w.days.map((i, j) => {
              const d = p.days[i]
              return d ? <DayCard key={d.summary.index} {...d} stagger={Math.min(j, STAGGER_CAP)} headingLevel={4} /> : null
            })}
          </div>
        </details>
      )) : body}
    </div>
  )
}
