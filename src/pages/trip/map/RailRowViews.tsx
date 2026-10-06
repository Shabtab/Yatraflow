// #420 slice 16: the see-&-do rail's rows as components — the ledger row and
// the gap row, with no component state in reach.
//
// The page computes each row's data and hands it in as props; this module
// only renders. Widening the scope stays a page callback, so the corridor's
// re-plan still flows through the same state it always did. The JSX rows
// stay out of the page for the rails slice; the rail panels stay with the
// page until a later slice moves them.
import { ChevronDown, CircleCheck, Star } from 'lucide-react'
import { InlineIcon } from '../../../components/icons'
import type { PlaceHit, SegmentHit } from '../../../lib/geocode'
import type { RailChip } from '../../../lib/railReasons'
import { alternativesFor, chipsFor, type ChipFacts } from './railRows'
import type { AltPool } from './sightRows'

/** A corridor halt the engine found no place for. The action raises the
 *  corridor's detour scope - the honest lever the engine actually has. */
export function GapRow({
  sh,
  dismissed,
  onWiden,
}: {
  sh: SegmentHit
  dismissed: boolean
  onWiden: () => void
}) {
  const hit = sh.hit
  // dismissed stays hidden for the session (logged as a DNA decline)
  if (hit && dismissed) return null
  if (!hit) {
    return (
      <div key={`gap-${sh.segment.index}`} className="poi-plan-row poi-plan-gap">
        <span className={`ride-purpose ride-purpose-${sh.segment.purpose} ride-purpose-muted`}>{sh.segment.label}</span>
        <span className="muted small">No good match near ~{sh.segment.targetKm.toFixed(0)} km yet.</span>
        {/* A gap has no place to add, so the action raises the corridor's
            detour scope - the honest lever the engine actually has. */}
        <button
          type="button"
          className="poi-gap-add"
          title="Raises the detour scope so more stops qualify. You can also add a stop on the Timeline and it will pin itself here."
          onClick={onWiden}
        >
          Widen search
        </button>
      </div>
    )
  }
  return null
}

/**
 * P2 ledger row for the see-&-do rail: the corridor pick as a flat two-line
 * row on the spine - name + one meta line (detour, day, window reasons) -
 * expanding in place to a shelf with the card's actions. Replaces the old
 * boxed cards in the ledger, keeping every behaviour reachable.
 */
export function LedgerRow({
  sh,
  dismissed,
  added,
  detourMin,
  hitDay,
  chipFacts,
  altPool,
  chipFilter,
  editable,
  shortlisted,
  onSelectChip,
  onAdd,
  onDismiss,
  onToggleShortlist,
  onOpenAlt,
  onWiden,
}: {
  sh: SegmentHit
  dismissed: boolean
  added: boolean
  detourMin: number | null | undefined
  hitDay: number | null
  chipFacts: ChipFacts
  altPool: AltPool
  chipFilter: string | null
  editable: boolean
  shortlisted: boolean
  onSelectChip: (key: string) => void
  onAdd: () => void
  onDismiss: () => void
  onToggleShortlist: () => void
  onOpenAlt: (h: PlaceHit) => void
  onWiden: () => void
}) {
  const hit = sh.hit
  if (dismissed) return null
  if (!hit) return <GapRow sh={sh} dismissed={false} onWiden={onWiden} /> // gaps keep their honest row
  const chips: RailChip[] = chipsFor(sh, hit, chipFacts)
  const alts = alternativesFor(sh, hit, altPool).filter(e => e.h.id !== hit.id)
  const shelf = (
    <div className="ledger-shelf">
      {chips.length > 0 && chips.map(c => (
        <button
          key={c.key}
          type="button"
          className={(c.tone === 'warn' ? 'poi-rchip poi-rchip--warn' : 'poi-rchip') + (chipFilter === c.key ? ' is-on' : '')}
          aria-pressed={chipFilter === c.key}
          onClick={(e) => { e.stopPropagation(); onSelectChip(c.key) }}
        >
          {c.icon === 'star' && <Star size={11} aria-hidden />}
          {c.label}
        </button>
      ))}
      {editable && (
        added
          ? <span className="chip chip-teal"><InlineIcon icon={CircleCheck} size={11} gap={3} />Added</span>
          : <button className="day-slot-fill" onClick={onAdd}>+ Add to a day</button>
      )}
      {!added && editable && (
        <button
          className="chip chip-sm"
          title="Not interested - hide this and teach the engine"
          onClick={onDismiss}
        >Dismiss</button>
      )}
      {!added && editable && (
        <button
          className="chip chip-sm"
          aria-pressed={shortlisted}
          title="Collect for the shortlist tray - the rail collects, the tray decides"
          onClick={onToggleShortlist}
        >
          {shortlisted ? 'Shortlisted' : 'Shortlist'}
        </button>
      )}
      {alts.length > 0 && alts.map(({ h, dKm }) => (
        <button
          key={h.id as string}
          className="shelf-alt"
          title={h.name}
          onClick={() => onOpenAlt(h)}
        >
          <span className="shelf-alt-nm">{h.name}</span>
          <span className="shelf-alt-km">{dKm != null ? `${dKm.toFixed(1)} km off` : 'on route'}</span>
        </button>
      ))}
    </div>
  )
  const meta = [
    detourMin == null ? 'position unknown' : detourMin > 0 ? `+${Math.round(detourMin)} min detour` : 'on route',
    hitDay != null ? `Day ${hitDay + 1}` : null,
  ].filter(Boolean).join(' \u00b7 ')
  return (
    <details key={hit.id as string} className="lrow-new" onToggle={undefined}>
      <summary className="lrow-sum" title={hit.name}>
        <span className="xdot" aria-hidden />
        <span className="lr-name">{hit.name}</span>
        <span className="lr-meta">{meta}</span>
        <ChevronDown className="lr-go" size={12} aria-hidden />
      </summary>
      {shelf}
    </details>
  )
}
