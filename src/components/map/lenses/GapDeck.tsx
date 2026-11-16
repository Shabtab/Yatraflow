// Presentational gap deck. It draws lens data and calls callbacks.
// Phase texts follow the stay deck. They name this day, not the stay.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { GapPick, GapPicks } from '../../../pages/trip/map/gapLens'
import type { JourneyRow } from '../../../lib/journeyProjection'
import type { LensPhase } from '../../../lib/mapLensContracts'
import type { PlaceHit } from '../../../lib/geocode'
import { addSlotLabel } from './DriveTabs'
import { STAY_PHASE_TEXT } from './StayDeck'
import { LensDeckHeader } from './LensDeckHeader'
import { LensPhaseNote } from './LensPhaseNote'
import { LensPlaceCard, selectedCardIndex, type LensCostCell } from './LensPlaceCard'
import { useTimeFormat } from '../../../lib/timefmt'
import { pickFactChips } from '../placeCardFacts'

export const GAP_PHASE_TEXT: Record<LensPhase, string> = {
  unscanned: 'Gaps · Choose a day',
  scanning: 'Gaps · Searching…',
  failed: 'Gap search · Failed',
  quota: STAY_PHASE_TEXT.quota,
  empty: 'Gap · No open places',
  ready: '',
}

/** A deck with no cards still shows its title, so every phase keeps one header. */
export const GAP_NOTE_TITLE = 'Open parts of this day'

/** The kicker of a deck with no cards, for example "Gap · Day 1". */
export function gapNoteKicker(dayNumber: number): string {
  return Number.isFinite(dayNumber) ? `Gap · Day ${dayNumber}` : 'Gap'
}

export const GAP_EMPTY_TEXT = 'Gaps · No stops needed'

/** The kicker of the deck header, for example "Gap · 11:30–14:30". */
export function gapDeckKicker(title: string | null, windowText: string | null): string {
  const context = windowText ?? title
  return context == null || context.trim() === ''
    ? 'Gap'
    : `Gap · ${context.trim()}`
}

/** The deck title, for example "2 open windows on this day". */
export function gapDeckTitle(count: number): string {
  return `${count} open window${count === 1 ? '' : 's'} on this day`
}

/** The primary action label of one pick. */
export function gapAddLabel(dayNumber: number, title: string | null): string {
  return addSlotLabel(dayNumber, title == null ? '' : title.trim().toLowerCase())
}

/** The three strip cells of one candidate, in board order. */
export function gapCells(row: JourneyRow, clock: (min: number) => string): LensCostCell[] {
  const arrive = row.arriveLabel ?? (typeof row.arriveMin === 'number' ? clock(row.arriveMin) : null)
  const detour = row.detourMin == null ? null : `+${Math.round(row.detourMin)} min`
  const budget = row.budgetSharePct == null ? null : `${Math.round(row.budgetSharePct)}%`
  return [
    { key: 'arrive', label: 'Arrive', value: arrive },
    { key: 'detour', label: 'Detour', value: detour },
    { key: 'budget', label: 'Budget', value: budget },
  ]
}

export interface GapDeckProps {
  /** The day number for the Add label. One-based. */
  dayNumber: number
  phase: LensPhase
  gaps: Array<{ title: string; windowText: string | null; picks: GapPicks }>
  onOpenPick: (pick: GapPick) => void
  onAddPick: (pick: GapPick) => void
  /** The Keep action. Absent hides the heart. */
  onShortlist?: (hit: PlaceHit) => void
  /** True draws the kept heart. */
  shortlistedOf?: (hit: PlaceHit) => boolean
  clock: (min: number) => string
  /** The swap action of a pick. Null means the pick has no planned stop to replace. */
  swapOf?: (hit: PlaceHit) => (() => void) | null
  /** The fold handler. Absent uses the Map tab fold button. */
  onClose?: () => void
  /** The search retry. Absent draws a failed note with no Retry button. */
  onRetry?: () => void
  /** Day actions in the header, such as Fill the day and Day plan. */
  aside?: ReactNode
  /** The part the user opened from the day list. Null heads the deck with the first part. */
  activeIndex?: number | null
}

/** The deck's part sections, keyed by the part index. */
type SectionNodes = Map<number, HTMLDivElement>

export function GapDeck(props: GapDeckProps) {
  const { dayNumber, phase, gaps, onOpenPick, onAddPick, clock, onShortlist, shortlistedOf, swapOf, onClose, onRetry, aside, activeIndex } = props
  const timeFormat = useTimeFormat()
  const [chosen, setChosen] = useState<string | null>(null)
  const focusAt = activeIndex != null && activeIndex >= 0 && activeIndex < gaps.length ? activeIndex : null
  const first = gaps[focusAt ?? 0]
  const sectionsRef = useRef<SectionNodes>(new Map())
  // The part opened from the day list comes into view, so Dinner opens on Dinner.
  useEffect(() => {
    if (focusAt == null) return
    sectionsRef.current.get(focusAt)?.scrollIntoView({ block: 'nearest' })
  }, [focusAt])
  const kicker = first == null ? 'Gap' : gapDeckKicker(first.title, first.windowText)
  if (phase !== 'ready' && phase !== 'empty') {
    return <section className="mv2-lens-deck" aria-label="Gaps in this day">
      <LensDeckHeader kicker={gapNoteKicker(dayNumber)} title={GAP_NOTE_TITLE} onClose={onClose} aside={aside} />
      <LensPhaseNote phase={phase} {...(onRetry == null ? {} : { onRetry })}>{GAP_PHASE_TEXT[phase]}</LensPhaseNote>
    </section>
  }
  if (phase === 'empty' || gaps.length === 0) {
    return <section className="mv2-lens-deck" aria-label="Gaps in this day">
      <LensDeckHeader kicker={gapNoteKicker(dayNumber)} title={GAP_NOTE_TITLE} onClose={onClose} aside={aside} />
      <LensPhaseNote phase="empty">{GAP_EMPTY_TEXT}</LensPhaseNote>
    </section>
  }
  return <section className="mv2-lens-deck" aria-label="Gaps in this day">
    <LensDeckHeader kicker={kicker} title={gapDeckTitle(gaps.length)} onClose={onClose} aside={aside} />
    {gaps.map((gap, index) => {
      const picks = gap.picks.picks.slice(0, 3)
      const selectedAt = selectedCardIndex(picks.map(pick => String(pick.candidate.hit.id)), chosen)
      return <div className={`mv2-lens-section${index === focusAt ? ' is-focus' : ''}`} key={`${gap.title}-${index}`} ref={node => { if (node) sectionsRef.current.set(index, node); else sectionsRef.current.delete(index) }}>
        <p className="mv2-section-label mv2-lens-gap-label">{gap.title}</p>
        {picks.length > 0 && <ul className="mv2-lens-cards">
          {picks.map((pick, at) => {
            const hit = pick.candidate.hit
            const reason = pick.candidate.reason
            const reasons = [
              ...pickFactChips({ reason, hit, format: timeFormat }),
              ...(pick.fitText == null ? [] : [pick.fitText]),
            ]
            return <li key={pick.letter} className="mv2-lens-card">
              <LensPlaceCard
                letter={pick.letter}
                hit={hit}
                category={hit.category}
                name={hit.name}
                reasons={reasons}
                cells={gapCells(pick.candidate, clock)}
                addLabel={gapAddLabel(dayNumber, gap.title)}
                onOpen={() => onOpenPick(pick)}
                onAdd={() => onAddPick(pick)}
                {...(onShortlist == null ? {} : {
                  onShortlist: () => onShortlist(hit),
                  shortlisted: shortlistedOf?.(hit) ?? false,
                })}
                {...(swapOf?.(hit) == null ? {} : { onSwap: swapOf(hit) as () => void })}
                selected={at === selectedAt}
                onSelect={() => setChosen(String(hit.id))}
              />
            </li>
          })}
        </ul>}
        {picks.length === 0 && gap.picks.noFitText != null &&
          <LensPhaseNote phase="empty">{gap.picks.noFitText}</LensPhaseNote>}
        {gap.picks.moreCount > 0 &&
          <p className="mv2-section-label mv2-lens-more">More: {gap.picks.moreCount}</p>}
      </div>
    })}
  </section>
}
