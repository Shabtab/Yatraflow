// ============ Remote-edit conflict banner (M6 · B3) ============
// Non-blocking banner inside the stop editor: someone else changed this stop
// while it sat open. keep-mine / take-theirs — no data loss either direction.
// Detection is pure (lib/realtimeCore.ts stopWasRemotelyEdited); this component
// is presentation + the two actions.
import React from 'react'
import { AlertTriangle, Check, Undo2 } from 'lucide-react'

export interface RemoteEditBannerProps {
  /** Display name of the crew member who edited remotely ('' = unknown). */
  byName: string
  /** What was edited — "stop" in the stop editor, "trip settings" on the
   *  settings form (#414). Same component, same verbs, honest noun. */
  noun?: string
  onKeepMine: () => void
  onTakeTheirs: () => void
}

/**
 * Rendered ABOVE the form inside the stop editor modal. Announced politely
 * (role=status) — it appears mid-editing, so it must not steal focus or
 * interrupt; the user reads it and picks. Motion rides the tokens (slide-up
 * entrance, reduced-motion honored).
 */
export function RemoteEditBanner({ byName, noun = 'stop', onKeepMine, onTakeTheirs }: RemoteEditBannerProps): React.JSX.Element {
  const who = byName || 'A crew member'
  return (
    <div className="remote-edit-banner" role="status" aria-live="polite">
      <span className="remote-edit-icon" aria-hidden="true"><AlertTriangle size={15} /></span>
      <div className="remote-edit-copy">
        <b>{who} edited this {noun} while you had it open.</b>
        <span className="remote-edit-sub">Saving keeps your version; taking theirs replaces the form with what they saved.</span>
      </div>
      <div className="remote-edit-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={onKeepMine}>
          <Check size={13} aria-hidden /> Keep mine
        </button>
        <button type="button" className="btn btn-saffron btn-sm" onClick={onTakeTheirs}>
          <Undo2 size={13} aria-hidden /> Take theirs
        </button>
      </div>
    </div>
  )
}
