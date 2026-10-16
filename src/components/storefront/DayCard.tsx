// P7 storefront: one day card. Free and yours show places. Locked shows counts.
import type { CSSProperties } from 'react'
import type { DaySummary, StorefrontKind } from '../../lib/publicStorefront'
import { KindChip, KIND_CATEGORY } from './KindChip'
import { CatIcon } from '../icons'

// `stagger` is the card's place in the grid. It feeds the entrance delay.
export type DayCardProps = (
  | { state: 'free' | 'yours'; summary: DaySummary; places: { title: string; kind: StorefrontKind }[] }
  | { state: 'locked'; summary: DaySummary }
) & {
  stagger?: number
  /** 3 under a section heading. 4 when the card sits inside a week. */
  headingLevel?: 3 | 4
}

const TAG: Record<DayCardProps['state'], string> = {
  free: 'Free',
  yours: 'Yours',
  locked: 'Locked',
}

function travelLine(min: number): string {
  if (min < 5) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  const t = h === 0 ? `${m} m` : m === 0 ? `${h} h` : `${h} h ${m} m`
  return t + ' on the road'
}

export function DayCard(p: DayCardProps): JSX.Element {
  const s = p.summary
  const meta = travelLine(s.travelMinutes)
  const Title = p.headingLevel === 4 ? 'h4' : 'h3'
  return (
    <article className={'sf-day sf-day--' + p.state} style={{ '--i': p.stagger ?? 0 } as CSSProperties}>
      <span className="sf-day-strip" aria-hidden="true">
        {s.kinds.map((k) => <span key={k.kind} className={'sf-day-strip-seg sf-kind--' + k.kind} />)}
      </span>
      <div className="sf-day-head">
        <span className="sf-day-num">Day {s.index + 1}</span>
        <span className="sf-day-tag">{TAG[p.state]}</span>
      </div>
      <Title className="sf-day-title">{s.title}</Title>
      <div className="sf-day-meta">
        <span className={'sf-pace sf-pace--' + s.pace.key}>{s.pace.label}</span>
        {meta ? <span>{meta}</span> : null}
      </div>
      {p.state === 'locked' ? (
        <div className="sf-day-chips">
          {s.kinds.map((k) => <KindChip key={k.kind} kind={k.kind} count={k.count} />)}
        </div>
      ) : (
        <ul className="sf-day-places">
          {p.places.map((pl, i) => (
            <li key={i} className={'sf-day-place sf-kind--' + pl.kind}>
              <CatIcon category={KIND_CATEGORY[pl.kind]} />
              <span>{pl.title}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

