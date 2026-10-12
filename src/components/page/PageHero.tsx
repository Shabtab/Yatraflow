// ============ Page hero ============
// The editorial hero of the catalog-style pages: an optional kicker, a serif
// headline with an italic accent, one line of context, the actions, a row of
// real counts, and a visual slot. The caller owns the visual (postcards, a
// note). The section and class names are the ex-hero set in styles.css.
import { useId, type ReactNode } from 'react'

export interface PageHeroProps {
  /** A small label above the headline. */
  kicker?: string
  /** The headline. The accent is set in italic. */
  headline: { lead: string; accent: string }
  lede: string
  /** The main button. */
  primary?: ReactNode
  /** Quiet buttons beside the main button. Any value, even null, keeps the wrapper. */
  secondary?: ReactNode
  /** Real counts only. */
  stats?: { label: string; value: number }[]
  /** 'inline' sits the counts in the actions row. 'below' sits them under it. */
  statsPlacement?: 'inline' | 'below'
  /** The aria-label of the counts list. */
  statsLabel?: string
  /** Goes inside the visual area. */
  visual?: ReactNode
  /** Extra classes on the section, such as mt-hero. */
  className?: string
  /** Extra classes on the counts list, such as mt-hero-stats. */
  statsClassName?: string
}

export function PageHero({
  kicker,
  headline,
  lede,
  primary,
  secondary,
  stats,
  statsPlacement = 'below',
  statsLabel,
  visual,
  className,
  statsClassName,
}: PageHeroProps) {
  const titleId = useId()
  const sectionClassName = className ? `ex-hero ${className}` : 'ex-hero'
  const statsListClassName = statsClassName ? `ex-stats ${statsClassName}` : 'ex-stats'
  const isStatsInline = statsPlacement === 'inline'
  // An inline list always renders when given, so the actions row keeps its gap.
  // A list below the actions is hidden when it is empty.
  const isStatsBelowWithRows = !isStatsInline && stats !== undefined && stats.length > 0
  const statsList = stats !== undefined ? (
    <dl className={statsListClassName} aria-label={statsLabel}>
      {stats.map(stat => (
        <div className="ex-stat" key={stat.label}>
          <dt>{stat.label}</dt>
          <dd>{stat.value}</dd>
        </div>
      ))}
    </dl>
  ) : null

  return (
    <section className={sectionClassName} aria-labelledby={titleId}>
      <div className="ex-hero-copy">
        {kicker ? <p className="ex-kicker">{kicker}</p> : null}
        <h1 id={titleId}>{headline.lead} <em>{headline.accent}</em></h1>
        <p className="ex-hero-lede">{lede}</p>
        <div className="ex-hero-actions">
          {primary}
          {secondary !== undefined ? <div className="mt-hero-secondary">{secondary}</div> : null}
          {isStatsInline ? statsList : null}
        </div>
        {isStatsBelowWithRows ? statsList : null}
      </div>
      <div className="ex-hero-visual" aria-hidden="true">
        {visual}
      </div>
    </section>
  )
}
