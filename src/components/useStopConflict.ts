// ============ M6 B3 · shared remote-edit conflict hook ============
// Extracted from TimelineTab so the Board's stop editor (BoardView) surfaces
// the same amber keep-mine/take-theirs banner the Timeline's does — the two
// views open the SAME StopEditor modal, and a crew member editing from either
// surface must not silently edit stale data.
//
// Detection is pure (lib/realtimeCore.ts stopWasRemotelyEdited): snapshot the
// stop the moment the editor opens; while the editor is open the draft writes
// through only on save, so ANY drift between the snapshot and the live trip is
// a remote (or another-surface) edit. The comparison is canonical (jsonb
// reorders object keys on the wire; a naive stringify compare would
// phantom-flag every hydration).
import { useCallback, useRef, useState } from 'react'
import type { Trip } from '../data/types'
import { stopWasRemotelyEdited } from '../lib/realtimeCore'
import { currentUser, userById, useDb } from '../store/store'
import type { StopEditorTarget } from '../lib/stopForm'

export interface StopConflict {
  mine: Record<string, unknown>
  theirs: Record<string, unknown>
}

/**
 * Track a remote edit of the stop currently open in an editor.
 *
 * `openEditor` replaces the raw `setEditorState` call for edit targets (add
 * targets pass straight through — there is nothing to snapshot). Returns the
 * conflict to render (null when none), a re-seed tick for take-theirs, and
 * the helpers the banner needs. `liveStop` is the stop from the CURRENT trip
 * snapshot; the caller passes it per render so the compare follows the store.
 */
export function useStopConflict(trip: Trip, editorState: StopEditorTarget) {
  const [conflictSnapshot, setConflictSnapshot] = useState<{ stopId: string; mine: Record<string, unknown> } | null>(null)
  /** Bump to force the editor form to re-seed from the live stop (take-theirs). */
  const [takeTheirsTick, setTakeTheirsTick] = useState(0)

  // The snapshot reads the LIVE trip, but through a latest-value ref rather than
  // a dependency: `trip.days` is a new array on every write, and the consumers
  // of `openEditor` (`openEditorState` → the Timeline's onAdd/onEdit) are props
  // on every day card — a changing identity there re-rendered the whole
  // Timeline on each edit (#347). Behaviour is identical: the ref always holds
  // the current trip when the editor opens.
  const tripRef = useRef(trip)
  tripRef.current = trip
  const openEditor = useCallback((next: StopEditorTarget, setState: (n: StopEditorTarget) => void) => {
    if (next?.mode === 'edit') {
      for (const d of tripRef.current.days) {
        const s = d.stops.find(x => x.id === next.stopId)
        if (s) { setConflictSnapshot({ stopId: s.id, mine: { ...s } }); break }
      }
    }
    setState(next)
  }, [])

  const liveStop = editorState?.mode === 'edit'
    ? trip.days.flatMap(d => d.stops).find(x => x.id === editorState.stopId)
    : undefined
  const conflict: StopConflict | null = conflictSnapshot && liveStop && stopWasRemotelyEdited(conflictSnapshot.mine, liveStop as unknown as Record<string, unknown>)
    ? { mine: conflictSnapshot.mine, theirs: liveStop as unknown as Record<string, unknown> }
    : null

  // Who edited: the most recent non-local activity entry touching this trip.
  const dbAll = useDb()
  const meId = currentUser(dbAll)?.id
  const conflictBy = conflict
    ? [...dbAll.activity].reverse().find(a =>
        a.tripId === trip.id && a.actorId !== meId &&
        (a.verb.includes('updated') || a.verb.includes('added') || a.verb.includes('removed')))
    : undefined
  const conflictByName = conflictBy ? userById(conflictBy.actorId) : undefined

  /** Keep-mine: clear the snapshot — the banner goes and the draft stands. */
  const keepMine = useCallback(() => setConflictSnapshot(null), [])

  /** Take-theirs: re-seed the editor draft from the live (remote) stop — the
   *  caller bumps its reset key with the tick so the form re-normalizes from
   *  `initial`, which now reads the remote version. The snapshot re-arms from
   *  the new live version so a FURTHER remote edit re-flags. */
  const takeTheirs = useCallback(() => {
    setTakeTheirsTick(t => t + 1)
    if (liveStop) setConflictSnapshot({ stopId: conflictSnapshot?.stopId ?? (liveStop as { id?: string }).id ?? '', mine: { ...liveStop as unknown as Record<string, unknown> } })
  }, [liveStop, conflictSnapshot?.stopId])

  /** Clear everything on editor close. */
  const clearConflict = useCallback(() => setConflictSnapshot(null), [])

  return { conflict, conflictByName, takeTheirsTick, openEditor, keepMine, takeTheirs, clearConflict }
}
