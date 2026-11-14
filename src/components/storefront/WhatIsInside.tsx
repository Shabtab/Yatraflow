// P7 storefront: the "What is inside" section. Words first, then chips, then day cards.
// P11: every part before the grid is optional, so the page can use this for the
// ten-days grid alone and draw the intro as its own tiles.
import type { KindCount, WeekGroup } from '../../lib/publicStorefront'
import { staggerStep } from '../../lib/motion'
import { KindChip } from './KindChip'
import { DayCard, DayCardProps } from './DayCard'

export function WhatIsInside(p: {
  /** The one-sentence plan summary. Absent when the plan has no days, so the
   *  section shows no lede instead of "A 0-day plan". */
  lede?: string | null
  kinds: KindCount[]
  lockedLine?: string
  days: DayCardProps[]
  weeks?: WeekGroup[] | null
}): JSX.Element {
  // A week holds day indexes, not the days themselves, so one list stays the
  // source of truth. Resolve them through a Map. A static analyser reads a
  // variable-keyed object access as an injection sink. `get` also types as
  // possibly missing, so the guard below stays honest.
  const dayByIndex = new Map(p.days.map((d, i) => [i, d] as const))
  const body = (
    <div className="sf-daygrid">
      {p.days.map((d, n) => <DayCard key={d.summary.index} {...d} stagger={staggerStep(n)} />)}
    </div>
  )
  return (
    <div className="sf-inside">
      {p.lede ? <p className="sf-inside-lede">{p.lede}</p> : null}
      {p.kinds.length > 0 ? (
        <div className="sf-inside-kinds">
          {p.kinds.map((k) => <KindChip key={k.kind} kind={k.kind} count={k.count} />)}
        </div>
      ) : null}
      {p.lockedLine ? <p className="sf-inside-lock">{p.lockedLine}</p> : null}
      {/* Every week starts open: a folded week hid free days the reader may read. */}
      {p.weeks ? p.weeks.map((w) => (
        <details key={w.label} className="sf-week" open>
          <summary className="sf-week-summary">
            <h3 className="sf-week-title">{w.label}</h3>
          </summary>
          <div className="sf-daygrid">
            {w.days.map((i, j) => {
              const d = dayByIndex.get(i)
              return d ? <DayCard key={d.summary.index} {...d} stagger={staggerStep(j)} headingLevel={4} /> : null
            })}
          </div>
        </details>
      )) : body}
    </div>
  )
}
