// P7 storefront: one day card. Free and yours show places. Locked shows counts.
// P11 adds three optional parts: a photo band, a time budget and an open
// button. A locked card takes no photo prop at all, so the type itself keeps a
// locked day's picture and names off the card.
// #914: the card follows the Look inside mockup. The tag answers to the band, the
// day badge to the body, and a locked card still knows no town or place name.
import type { CSSProperties, ReactNode } from 'react'
import type { DaySummary, PaceKey, StorefrontKind } from '../../lib/publicStorefront'
import { KindChip, KIND_CATEGORY } from './KindChip'
import { DayBudgetBar, type DayBudget } from './DayBudgetBar'
import { CatIcon } from '../icons'
import { Car, Lock, Plane, Sun } from 'lucide-react'

// `stagger` is the card's place in the grid. It feeds the entrance delay.
export type DayCardProps = (
  | {
    state: 'free' | 'yours'; summary: DaySummary
    places: { title: string; kind: StorefrontKind }[]
    photo?: string
    /** The day's town. Readable cards only: a locked card never receives one. */
    town?: string
  }
  | {
    state: 'locked'; summary: DaySummary
    /** The tag on a locked card: "Paid plan" when the plan is for sale. */
    lockedWord?: string
    /** One line on what opens later. Absent means no line. */
    lockedNote?: string
  }
) & {
  stagger?: number
  /** 3 under a section heading. 4 when the card sits inside a week. */
  headingLevel?: 3 | 4
  budget?: DayBudget
  /** Opens this day in the ride-along view. Set on readable days only. */
  onOpen?: () => void
  /** The generated scene for the band when there is no photo. A locked card shows it washed, under a lock. */
  art?: ReactNode
}

const TAG: Record<'free' | 'yours', string> = {
  free: 'Free to read',
  yours: 'Yours',
}

/** "1h 29m", "40m", "2h". A drive under five minutes is not worth a line. */
function driveLine(min: number): string {
  if (min < 5) return ''
  const h = Math.floor(min / 60)
  const m = min % 60
  const t = h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`
  return t + ' driving'
}

/** The pace glyph: a sun for an easy or a full day, a car for a long drive. */
function PaceGlyph(p: { pace: PaceKey }): JSX.Element | null {
  if (p.pace === 'empty') return null
  if (p.pace === 'drive') return <Car size={15} strokeWidth={1.9} aria-hidden />
  if (p.pace === 'flight') return <Plane size={15} strokeWidth={1.9} aria-hidden />
  return <Sun size={15} strokeWidth={1.9} aria-hidden />
}

export function DayCard(p: DayCardProps): JSX.Element {
  const s = p.summary
  const drive = p.state === 'locked' ? '' : driveLine(s.travelMinutes)
  const pace = p.state === 'locked' ? null : s.pace
  const Title = p.headingLevel === 4 ? 'h4' : 'h3'
  const photo = p.state === 'locked' ? undefined : p.photo
  const town = p.state === 'locked' ? undefined : p.town
  const tag = p.state === 'locked' ? (p.lockedWord ?? 'Locked') : TAG[p.state]
  const band = photo || p.art
  return (
    <article className={'sf-day sf-day--' + p.state + (band ? ' sf-day--photo' : '')} style={{ '--i': p.stagger ?? 0 } as CSSProperties}>
      {photo ? (
        <span className="sf-day-photo" aria-hidden="true">
          <img src={photo} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.hidden = true }} />
          <span className="sf-day-veil" />
        </span>
      ) : p.art ? (
        <span className="sf-day-photo sf-day-art" aria-hidden="true">
          {p.art}
          <span className="sf-day-veil" />
          {p.state === 'locked' ? <span className="sf-day-lockcircle"><Lock size={18} aria-hidden /></span> : null}
        </span>
      ) : (
        <span className="sf-day-strip" aria-hidden="true">
          {s.kinds.map((k) => <span key={k.kind} className={'sf-day-strip-seg sf-kind--' + k.kind} />)}
          {p.state === 'locked' ? <span className="sf-day-lock-mark"><Lock size={20} /></span> : null}
        </span>
      )}
      <span className={'sf-day-tag sf-day-tag--' + p.state}>
        {p.state === 'locked' ? <Lock size={11} aria-hidden /> : null}{tag}
      </span>
      <div className="sf-day-body">
        <div className="sf-day-head">
          <span className="sf-day-num"><small>Day</small><b>{s.index + 1}</b></span>
          {town ? <span className="sf-day-town">{town}</span> : null}
        </div>
        <Title className="sf-day-title">{p.state === 'locked' ? `Day ${s.index + 1}` : s.title}</Title>
        {(pace !== null || drive !== '') && (
          <p className="sf-day-meta">
            {pace !== null ? <span className="sf-day-meta-icon"><PaceGlyph pace={pace.key} /></span> : null}
            {pace !== null ? <b>{pace.label}</b> : null}
            {drive !== '' ? <span className="sf-day-meta-drive">{pace !== null ? '· ' : ''}{drive}</span> : null}
          </p>
        )}
        {p.state !== 'locked' && p.budget ? <DayBudgetBar budget={p.budget} label={`Day ${s.index + 1}`} stagger={p.stagger} /> : null}
        {p.state === 'locked' ? (
          <>
            <div className="sf-day-chips">
              {s.kinds.map((k) => <KindChip key={k.kind} kind={k.kind} count={k.count} />)}
            </div>
            {p.lockedNote ? <p className="sf-day-locknote"><Lock size={13} aria-hidden />{p.lockedNote}</p> : null}
          </>
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
        {p.onOpen ? (
          <button type="button" className="sf-day-open" onClick={p.onOpen}>Read day {s.index + 1} →</button>
        ) : null}
      </div>
    </article>
  )
}
