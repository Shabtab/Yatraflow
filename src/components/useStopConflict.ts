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
import type { ActivityEntry, ID, Trip } from '../data/types'
import { stopWasRemotelyEdited } from '../lib/realtimeCore'
import { currentUser, userById, useDb } from '../store/store'
import type { StopEditorTarget } from '../lib/stopForm'

export interface StopConflict {
  mine: Record<string, unknown>
  theirs: Record<string, unknown>
}

/** The re-arm decision both banner choices share (#553): the version the
 *  choice just settled on becomes the new baseline, so only a FURTHER remote
 *  edit re-flags. The baseline is a fresh copy, never a reference — the store
 *  swaps trip objects on every write, and a shared reference would drift with
 *  them. Nulling outright (keep-mine's old move) disarmed detection for the
 *  rest of the editor session: the next save then overwrote a newer remote
 *  edit silently, the exact loss the banner exists to prevent. */
export function reArmFromLive(
  liveStop: Record<string, unknown> | undefined,
  previousStopId: string | undefined,
): { stopId: string; mine: Record<string, unknown> } | null {
  if (!liveStop) return null
  return { stopId: previousStopId ?? (liveStop as { id?: string }).id ?? '', mine: { ...liveStop } }
}

/** Who to name in the banner (#553): only an activity entry that NAMES this
 *  stop can prove authorship — the stop-write logs carry the stop's title
 *  (and its day), never an id. The most recent non-local entry whose verb
 *  names one of the stop's titles (the title at open, or the live title — a
 *  rename logs the new one) on the stop's own day wins. Anything else returns
 *  undefined, and the banner falls back to "A crew member" instead of a wrong
 *  name: a teammate's edit elsewhere on the trip is not this stop's editor. */
export function actorForStopConflict(
  entries: ActivityEntry[],
  tripId: ID,
  meId: ID | undefined,
  dayLabel: string,
  titles: string[],
): ActivityEntry | undefined {
  const names = titles.filter(t => t !== '')
  return [...entries].reverse().find(a =>
    a.tripId === tripId && a.actorId !== meId &&
    (a.verb.includes('updated') || a.verb.includes('added') || a.verb.includes('removed')) &&
    a.target === dayLabel &&
    names.some(t => a.verb.includes(t)))
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

  // Who edited: the extracted filter above — an entry must NAME this stop
  // (title at open, or live title) on the stop's own day, or nobody is named.
  const dbAll = useDb()
  const meId = currentUser(dbAll)?.id
  const liveDayIndex = editorState?.mode === 'edit'
    ? trip.days.find(d => d.stops.some(x => x.id === editorState.stopId))?.index
    : undefined
  const conflictBy = conflict
    ? actorForStopConflict(
        dbAll.activity,
        trip.id,
        meId,
        liveDayIndex !== undefined ? `Day ${liveDayIndex + 1}` : '',
        [liveStop?.title ?? '', typeof conflictSnapshot?.mine.title === 'string' ? conflictSnapshot.mine.title : ''],
      )
    : undefined
  const conflictByName = conflictBy ? userById(conflictBy.actorId) : undefined

  /** The re-arm both choices share: settle on the live version as the new
   *  baseline (see reArmFromLive). */
  const reArm = useCallback((live: Record<string, unknown> | undefined) => {
    const next = reArmFromLive(live, conflictSnapshot?.stopId)
    if (next) setConflictSnapshot(next)
  }, [conflictSnapshot?.stopId])

  /** Keep-mine: the banner goes and the draft stands — with the detector
   *  still armed on the version just rejected (#553), so a further remote
   *  edit re-flags instead of passing silently. */
  const keepMine = useCallback(() => {
    reArm(liveStop as unknown as Record<string, unknown> | undefined)
  }, [reArm, liveStop])

  /** Take-theirs: re-seed the editor draft from the live (remote) stop — the
   *  caller bumps its reset key with the tick so the form re-normalizes from
   *  `initial`, which now reads the remote version. The re-arm below makes a
   *  FURTHER remote edit re-flag. */
  const takeTheirs = useCallback(() => {
    setTakeTheirsTick(t => t + 1)
    reArm(liveStop as unknown as Record<string, unknown> | undefined)
  }, [reArm, liveStop])

  /** Clear everything on editor close. */
  const clearConflict = useCallback(() => setConflictSnapshot(null), [])

  return { conflict, conflictByName, takeTheirsTick, openEditor, keepMine, takeTheirs, clearConflict }
}
