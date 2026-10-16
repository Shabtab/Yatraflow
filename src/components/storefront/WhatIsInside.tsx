// P7 storefront: the "What is inside" section. Words first, then chips, then day cards.
import type { KindCount, WeekGroup } from '../../lib/publicStorefront'
import { KindChip } from './KindChip'
import { DayCard, DayCardProps } from './DayCard'

export function WhatIsInside(p: {
  lede: string
  kinds: KindCount[]
  lockedLine?: string
  days: DayCardProps[]
  weeks?: WeekGroup[] | null
}): JSX.Element {
  const body = (
    <div className="sf-daygrid">
      {p.days.map((d, n) => <DayCard key={d.summary.index} {...d} stagger={n} />)}
    </div>
  )
  return (
    <div className="sf-inside">
      <p className="sf-inside-lede">{p.lede}</p>
      <div className="sf-inside-kinds">
        {p.kinds.map((k) => <KindChip key={k.kind} kind={k.kind} count={k.count} />)}
      </div>
      {p.lockedLine ? <p className="sf-inside-lock">{p.lockedLine}</p> : null}
      {p.weeks ? p.weeks.map((w) => (
        <div key={w.label} className="sf-week">
          <h3 className="sf-week-title">{w.label}</h3>
          <div className="sf-daygrid">
            {w.days.map((i) => {
              const d = p.days[i]
              return d ? <DayCard key={d.summary.index} {...d} stagger={i} /> : null
            })}
          </div>
        </div>
      )) : body}
    </div>
  )
}
