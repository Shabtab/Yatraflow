// The Map tab's edit surfaces (#905, #906, #907). They only lay out the cards in
// ./editing/EditCards and the state of `useMapEdit`. No writer call is made here.
import type { Trip } from '../../../data/types'
import { useTimeFormat } from '../../../lib/timefmt'
import { AddPreviewCard, FixedTimeConfirm, StopEditorCard } from './editing/EditCards'
import { fixedGuardFor } from './editing/stopEdit'
import { plannedArrivalLabel, swapOptionsFor } from './pickPreview'
import type { MapEdit } from './useMapEdit'

/** The add preview, the unknown-position card, and the Undo countdown. */
export function MapEditAddPanel({ edit, onChooseDay }: { edit: MapEdit; onChooseDay: () => void }) {
  const { session, unknown, visible } = edit
  if (!visible) return null
  if (session.phase === 'idle' && unknown) {
    return (
      <div className="map-edit-wrap">
        <AddPreviewCard preview={unknown} onKeep={onChooseDay} onReject={edit.reject} />
        <div className="map-edit-actions">
          <button type="button" className="map-edit-keep" onClick={onChooseDay}>Choose a day and add</button>
          <button type="button" className="map-edit-reject" onClick={edit.reject}>Not now</button>
        </div>
      </div>
    )
  }
  if (session.phase === 'idle') return null
  const busy = session.phase === 'saving' || session.phase === 'undoing'
  return (
    <div className="map-edit-wrap">
      <AddPreviewCard
        preview={session.preview}
        busy={busy}
        outcome={session.lastOutcome}
        canUndo={edit.canUndo}
        onKeep={edit.keep}
        onReject={edit.reject}
        onUndo={edit.undo}
      />
      {session.phase === 'done' && edit.canUndo && (
        <p className="map-edit-countdown" data-left={edit.undoLeft}>
          <progress className="map-edit-countdown-bar" max={8} value={edit.undoLeft} aria-hidden="true" />
          <span>{`Undo for ${edit.undoLeft} s`}</span>
        </p>
      )}
    </div>
  )
}

/** The editor for the selected planned stop, with the fixed-time confirm. */
export function MapEditStopPanel({ edit, trip, stopId, editable, onClose }: { edit: MapEdit; trip: Trip; stopId: string | null; editable: boolean; onClose: () => void }) {
  const fmt = useTimeFormat()
  if (!editable || stopId == null) return null
  const day = trip.days.find(d => d.stops.some(s => s.id === stopId))
  const stop = day?.stops.find(s => s.id === stopId)
  if (!day || !stop) return null
  const fixed = fixedGuardFor(trip, trip, [day.index]).fixedStopIds.includes(stopId)
  const visit = typeof stop.visitMinutes === 'number' && Number.isFinite(stop.visitMinutes) ? stop.visitMinutes : null
  const options = swapOptionsFor(day, stopId)
  const order = day.stops.findIndex(s => s.id === stopId) + 1
  return (
    <div className="map-edit-wrap">
      <StopEditorCard
        title={stop.title}
        clockLabel={plannedArrivalLabel(trip, day.index, stopId, fmt)}
        placeLabel={stop.locationName || null}
        order={order}
        dayIndex={day.index}
        visitMinutes={visit}
        days={trip.days.filter(d => d.index !== day.index).map(d => ({ index: d.index, label: `Day ${d.index + 1}` }))}
        swapOptions={options}
        fixed={fixed}
        onStep={direction => edit.stepStay(stopId, direction)}
        onMoveToDay={toDay => edit.moveToDay(stopId, toDay)}
        onSwap={target => edit.swapNeighbour(stopId, target)}
        onRemove={() => edit.removeSelected(stopId)}
        onClose={onClose}
        onReorderKey={event => edit.onReorderKey(event, stopId, day.index)}
      />
      {edit.confirm && <FixedTimeConfirm guard={edit.confirm.fixed} onConfirm={edit.confirmFixed} onCancel={edit.cancelFixed} />}
    </div>
  )
}

/** One polite live region for every edit message. It stays mounted so the first message is read. */
export function MapEditLive({ edit }: { edit: MapEdit }) {
  return <div className="map-edit-live" role="status" aria-live="polite" aria-atomic="true">{edit.announcement}</div>
}
