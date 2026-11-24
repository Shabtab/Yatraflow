// ============ Impact Preview panel ============
import { AlarmClock, ArrowUpRight, ClipboardList, Clock, Repeat, TriangleAlert, Zap } from 'lucide-react'
import { InlineIcon } from './icons'
import type { ImpactResult } from '../lib/impact'
import { minutesToHM, formatInr } from '../lib/engine'
import type { KeepOutcome } from '../lib/previewChain'

export function ImpactPreviewPanel({ result, busy = false, uncertain = false, onKeep, onMoveDay, onRemove, onScrollToDay }: {
  result: ImpactResult
  /** A Keep is in flight: the write is not acknowledged yet. */
  busy?: boolean
  /** The last Keep was not confirmed and the change may already be saved on
   *  this device. The sheet points to Saved edits and does not offer a retry. */
  uncertain?: boolean
  onKeep: () => void | Promise<KeepOutcome>
  onMoveDay: () => void
  onRemove: () => void | boolean | Promise<boolean>
  onScrollToDay?: (dayIndex: number) => void
}) {
  const rounded = (before: number, after: number, raw: number, minimum = -Infinity) => {
    const from = Math.max(minimum, Math.round(before))
    const to = Math.max(minimum, Math.round(after))
    const delta = to - from
    return { from, to, delta, sign: (delta || raw) > 0 ? '+' : (delta || raw) < 0 ? '−' : '' }
  }
  const time = rounded(result.beforeTotals.timeMin, result.afterTotals.timeMin, result.timeDeltaMin, 0)
  const distance = rounded(result.beforeTotals.distanceKm, result.afterTotals.distanceKm, result.distanceDeltaKm)
  const cost = rounded(result.beforeTotals.costInr, result.afterTotals.costInr, result.costDeltaInr)
  const cls = (v: number) => (v > 0 ? 'delta-pos' : v < 0 ? 'delta-neg' : 'delta-zero')

  // Scroll only once the save is acknowledged, never on a refused Keep.
  const handleKeep = () => {
    if (busy) return
    void Promise.resolve(onKeep()).then(outcome => {
      if (outcome && outcome.kind === 'acknowledged' && onScrollToDay && result.dayIndex != null) onScrollToDay(result.dayIndex)
    })
  }

  return (
    <div className="impact-sheet" role="status" aria-busy={busy}>
      <div className="impact-panel" tabIndex={0} aria-label="Impact preview">
        <div className="impact-head">
          <span><Zap size={14} aria-hidden /></span>
          <span>Impact preview: estimates only</span>
          <span style={{ marginLeft: 'auto' }} className={`chip ${result.newWarnings.length ? 'chip-danger' : 'chip-ok'}`}>
            {result.newWarnings.length ? `+${result.newWarnings.length} warning${result.newWarnings.length > 1 ? 's' : ''}` : 'No new warnings'}
          </span>
        </div>
        <div className="impact-body">
          <div className="impact-grid">
            {Number.isFinite(result.beforeTotals.timeMin) && Number.isFinite(result.afterTotals.timeMin) && (
              <div className="impact-cell">
                <div className="k">Trip time <span className="muted">Driving + stops</span></div>
                <div className="v">{minutesToHM(time.from)} → {minutesToHM(time.to)}</div>
                <div className={cls(time.delta)}>{time.sign}{minutesToHM(Math.abs(time.delta))}</div>
              </div>
            )}
            {Number.isFinite(result.beforeTotals.distanceKm) && Number.isFinite(result.afterTotals.distanceKm) && (
              <div className="impact-cell">
                <div className="k">Trip distance</div>
                <div className="v">{distance.from} km → {distance.to} km</div>
                <div className={cls(distance.delta)}>{distance.sign}{Math.abs(distance.delta)} km}</div>
              </div>
            )}
            {Number.isFinite(result.beforeTotals.costInr) && Number.isFinite(result.afterTotals.costInr) && (
              <div className="impact-cell">
                <div className="k">Trip est. cost</div>
                <div className="v">{formatInr(cost.from)} → {formatInr(cost.to)}</div>
                <div className={cls(cost.delta)}>{cost.sign}{formatInr(Math.abs(cost.delta))}</div>
              </div>
            )}
            <div className="impact-cell">
              <div className="k">Too busy?</div>
              <div className={`v ${result.tooBusy ? 'impact-busy' : 'impact-ok'}`}>
                {result.tooBusy ? 'Yes: over-packed day' : 'No'}
              </div>
            </div>
          </div>

          {result.arrivalChanges.length > 0 && (
            <>
              <div className="label" style={{ marginBottom: 6 }}>Arrival time changes</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                {result.arrivalChanges.slice(0, 6).map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className="muted small" style={{ minWidth: 150 }}>{a.stopTitle}</span>
                    <span className="muted">{a.from}</span>
                    <span>→</span>
                    <b>{a.to}</b>
                  </div>
                ))}
                {result.arrivalChanges.length > 6 && <span className="hint-text">+{result.arrivalChanges.length - 6} more…</span>}
              </div>
            </>
          )}

          {(result.openingHoursIssues.length > 0 || result.commitmentConflicts.length > 0) && (
            <div className="warn-list section-gap" style={{ marginTop: 12 }}>
              <div className="label">Conflicts in proposed plan</div>
              {result.commitmentConflicts.map(c => (
                <div key={c} className="warn-item sev-high">
                  <span className="warn-icon"><AlarmClock size={13} aria-hidden /></span>
                  <div><div className="warn-title">{result.existingCommitmentConflicts.includes(c) ? 'Existing fixed commitment at risk' : 'Fixed commitment at risk'}: {c}</div>
                    <div className="warn-fix">Cut an earlier stop or start sooner.</div></div>
                </div>
              ))}
              {result.openingHoursIssues.map(h => (
                <div key={h} className="warn-item">
                  <span className="warn-icon"><Clock size={13} aria-hidden /></span>
                  <div><div className="warn-title">{result.existingOpeningHoursIssues.includes(h) ? 'Existing opening hours conflict' : 'Opening hours conflict'}</div>
                    <div className="warn-fix">{h}</div></div>
                </div>
              ))}
            </div>
          )}

          {result.backtracking && (
            <div className="warn-item sev-low" style={{ marginTop: 12 }}>
              <span className="warn-icon"><Repeat size={13} aria-hidden /></span>
              <div><div className="warn-title">{result.existingBacktracking ? 'Existing route backtracking' : 'Route backtracking detected'}</div>
                <div className="warn-fix">Reorder stops to run one direction.</div></div>
            </div>
          )}
          {result.crossDayNote && (
            <p className="small muted" style={{ marginTop: 10 }}><InlineIcon icon={ArrowUpRight} size={12} gap={3} />{result.crossDayNote}</p>
          )}

          {result.newWarnings.length > 0 && (
            <div className="warn-list section-gap" style={{ marginTop: 12 }}>
              <div className="label">New warnings</div>
              {result.newWarnings.map((warning, i) => (
                <div className="warn-item" key={`${warning.code}-${i}`}>
                  <div><div className="warn-title">{warning.title}</div><div className="warn-fix">{warning.detail}</div></div>
                </div>
              ))}
            </div>
          )}
          {result.clearedWarnings.length > 0 && (
            <div className="warn-list section-gap" style={{ marginTop: 12 }}>
              <div className="label">Cleared warnings</div>
              {result.clearedWarnings.map((warning, i) => (
                <div className="warn-item impact-cleared" key={`${warning.code}-${i}`}>
                  <div><div className="warn-title">{warning.title}</div><div className="warn-fix">{warning.detail}</div></div>
                </div>
              ))}
            </div>
          )}

          {uncertain && (
            <div className="warn-item sev-high" style={{ marginTop: 12 }} role="alert">
              <span className="warn-icon"><TriangleAlert size={13} aria-hidden /></span>
              <div><div className="warn-title">Save not confirmed</div>
                <div className="warn-fix">This change may already be saved on this device. Open Saved edits to retry or discard it.</div></div>
            </div>
          )}

          <div className="assumptions" style={{ marginTop: 12 }}><InlineIcon icon={ClipboardList} size={12} gap={3} />{result.assumptions}</div>

          <div className="impact-actions">
            <button className="btn btn-primary btn-sm" onClick={handleKeep} disabled={busy}>{busy ? 'Saving…' : 'Keep change'}</button>
            <button className="btn btn-outline btn-sm" onClick={() => { onRemove() }} disabled={busy}>Remove change</button>
            <button className="btn btn-ghost btn-sm impact-move" onClick={onMoveDay} disabled={busy}>Move to another day</button>
          </div>
        </div>
      </div>
    </div>
  )
}
