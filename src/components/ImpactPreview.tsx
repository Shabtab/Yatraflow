// ============ Impact Preview panel ============
import type { Trip } from '../data/types'
import type { ImpactResult } from '../lib/impact'
import { minutesToHM, formatInr } from '../lib/engine'

export function ImpactPreviewPanel({ result, trip, onKeep, onMoveDay, onRemove, onScrollToDay }: {
  result: ImpactResult
  trip?: Trip
  onKeep: () => void
  onMoveDay: () => void
  onRemove: () => void
  onScrollToDay?: (dayIndex: number) => void
}) {
  const signMin = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${minutesToHM(Math.abs(v))}`
  const signKm = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)} km`
  const cls = (v: number) => (v > 0 ? 'delta-pos' : v < 0 ? 'delta-neg' : 'delta-zero')

  const handleKeep = () => {
    onKeep()
    if (onScrollToDay && result.dayIndex != null) onScrollToDay(result.dayIndex)
  }

  return (
    <div className="impact-sheet" role="status">
      <div className="impact-panel">
        <div className="impact-head">
          <span>⚡</span>
          <span>Impact preview — estimates only</span>
          <span style={{ marginLeft: 'auto' }} className={`chip ${result.newWarnings.length ? 'chip-danger' : 'chip-ok'}`}>
            {result.newWarnings.length ? `+${result.newWarnings.length} warning${result.newWarnings.length > 1 ? 's' : ''}` : 'no new warnings'}
          </span>
        </div>
        <div className="impact-body">
          <div className="impact-grid">
            <div className="impact-cell">
              <div className="k">Travel time</div>
              <div className={`v ${cls(result.timeDeltaMin)}`}>{signMin(result.timeDeltaMin)}</div>
            </div>
            <div className="impact-cell">
              <div className="k">Distance</div>
              <div className={`v ${cls(result.distanceDeltaKm)}`}>{signKm(result.distanceDeltaKm)}</div>
            </div>
            <div className="impact-cell">
              <div className="k">Est. cost</div>
              <div className={`v ${cls(result.costDeltaInr)}`}>{result.costDeltaInr > 0 ? '+' : ''}{formatInr(result.costDeltaInr)}</div>
            </div>
            <div className="impact-cell">
              <div className="k">Too busy?</div>
              <div className={`v ${result.tooBusy ? '' : ''}`} style={{ color: result.tooBusy ? 'var(--danger)' : 'var(--ok)' }}>
                {result.tooBusy ? 'Yes — over-packed day' : 'No'}
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
              {result.commitmentConflicts.map(c => (
                <div key={c} className="warn-item sev-high">
                  <span className="warn-icon">⏰</span>
                  <div><div className="warn-title">Fixed commitment at risk: {c}</div>
                    <div className="warn-fix">Cut an earlier stop or start sooner.</div></div>
                </div>
              ))}
              {result.openingHoursIssues.map(h => (
                <div key={h} className="warn-item">
                  <span className="warn-icon">🕒</span>
                  <div><div className="warn-title">Opening hours conflict</div>
                    <div className="warn-fix">{h}</div></div>
                </div>
              ))}
            </div>
          )}

          {result.backtracking && (
            <div className="warn-item sev-low" style={{ marginTop: 12 }}>
              <span className="warn-icon">🔁</span>
              <div><div className="warn-title">Route backtracking detected</div>
                <div className="warn-fix">Reorder stops to run one direction.</div></div>
            </div>
          )}
          {result.crossDayNote && (
            <p className="small muted" style={{ marginTop: 10 }}>↗ {result.crossDayNote}</p>
          )}

          {(result.clearedWarnings.length > 0 && !result.newWarnings.length) && (
            <p className="small chip chip-ok" style={{ marginTop: 10 }}>This change actually clears an earlier warning. Nice.</p>
          )}

          <div className="assumptions" style={{ marginTop: 12 }}>📋 {result.assumptions}</div>

          <div className="impact-actions">
            <button className="btn btn-primary btn-sm" onClick={handleKeep}>Keep change</button>
            <button className="btn btn-outline btn-sm" onClick={onMoveDay}>Move to another day</button>
            <button className="btn btn-danger btn-sm" onClick={onRemove}>Remove change</button>
          </div>
        </div>
      </div>
    </div>
  )
}
