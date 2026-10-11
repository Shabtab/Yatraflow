// ============ Page header ============
// The compact header of a tool page: an optional back link, an optional
// kicker, the page's one h1 in the serif, an optional lede, optional actions,
// optional free content (meta) and an optional row of real counts. It has no
// band and no postcards, so the page keeps its vertical space. The class names
// are the yf-header set in styles.css.
import { useId, type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { InlineIcon } from '../icons'

export interface PageHeaderProps {
  /** A quiet link above the kicker, such as a way back to the parent page. */
  back?: { label: string; onClick: () => void }
  /** A small label above the title. */
  kicker?: string
  /** The title. The accent, when given, is set in italic. */
  headline: { lead: string; accent?: string }
  /** One block of context under the title. Any text or markup. */
  lede?: ReactNode
  /** Buttons on the title row. They stack under the title on a phone. */
  actions?: ReactNode
  /** Free content under the lede, such as a summary line. */
  meta?: ReactNode
  /** One short handwritten aside beside the title. It is decorative and hidden
   *  from assistive technology, so the same meaning must also be in the lede.
   *  Use it once per page. */
  note?: ReactNode
  /** Real counts only. The row is hidden when the list is empty. */
  stats?: { label: string; value: number }[]
  /** The aria-label of the counts list. */
  statsLabel?: string
  /** Extra classes on the section. */
  className?: string
}

export function PageHeader({
  back,
  kicker,
  headline,
  lede,
  actions,
  meta,
  note,
  stats,
  statsLabel,
  className,
}: PageHeaderProps) {
  const titleId = useId()
  const sectionClassName = className ? `yf-header ${className}` : 'yf-header'
  const hasStats = stats !== undefined && stats.length > 0
  const hasLede = lede !== undefined && lede !== null && lede !== false
  return (
    <section className={sectionClassName} aria-labelledby={titleId}>
      {back ? (
        <button type="button" className="btn btn-ghost yf-header-back" onClick={back.onClick}>
          <InlineIcon icon={ArrowLeft} size={14} gap={4} />{back.label}
        </button>
      ) : null}
      {kicker ? <p className="ex-kicker yf-header-kicker">{kicker}</p> : null}
      <div className="yf-header-row">
        <h1 id={titleId} className="yf-header-title">
          {headline.lead}
          {headline.accent ? <> <em>{headline.accent}</em></> : null}
        </h1>
        {note ? (
          // A decorative aside in handwriting. The meaning must also sit in the
          // lede, so it is hidden from assistive technology.
          <p className="yf-header-note" aria-hidden="true">
            <span className="yf-header-note-hl">{note}</span>
            <svg viewBox="0 0 54 62" focusable="false">
              <path d="M8 4c14 4 30 16 30 34 0 6-2 11-6 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M24 50l8 6 6-10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </p>
        ) : null}
        {actions ? <div className="yf-header-actions">{actions}</div> : null}
      </div>
      {hasLede ? <p className="yf-header-lede">{lede}</p> : null}
      {meta ? <div className="yf-header-meta">{meta}</div> : null}
      {hasStats ? (
        <dl className="ex-stats yf-header-stats" aria-label={statsLabel}>
          {stats.map(stat => (
            <div className="ex-stat" key={stat.label}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  )
}
