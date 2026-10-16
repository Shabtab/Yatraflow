// P7 storefront: one day card. Free and yours show places. Locked shows counts.
import type { DaySummary, StorefrontKind } from '../../lib/publicStorefront'
import { KindChip, KIND_CATEGORY } from './KindChip'
import { CatIcon } from '../icons'

export type DayCardProps =
  | { state: 'free' | 'yours'; summary: DaySummary; places: { title: string; kind: StorefrontKind }[] }
  | { state: 'locked'; summary: DaySummary }

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
  return (
    <article className={'sf-day sf-day--' + p.state}>
      <span className="sf-day-strip" aria-hidden="true">
        {s.kinds.map((k) => <span key={k.kind} className={'sf-day-strip-seg sf-kind--' + k.kind} />)}
      </span>
      <div className="sf-day-head">
        <span className="sf-day-num">Day {s.index + 1}</span>
        <span className="sf-day-tag">{TAG[p.state]}</span>
      </div>
      <h3 className="sf-day-title">{s.title}</h3>
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
            <li key={i} className="sf-day-place">
              <CatIcon category={KIND_CATEGORY[pl.kind]} />
              <span>{pl.title}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}

