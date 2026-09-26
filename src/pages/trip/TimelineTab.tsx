// ============ Trip workspace — Timeline tab (shell) ============
// restructure Phase 3: the day surfaces live in ./timeline/ — this file keeps
// the tab state (accordion open-day, Plan/Inspect mode, StopEditor, warnings
// grouping) and composes the extracted modules. Prop-identity discipline
// (M3.3) is why handlers here are useCallback-stable.
// ============ Trip workspace — Timeline tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
// Includes DaySection, DayWeatherChip, TravelPanel, HaltPlanRow, DaySpark,
// MoveStopModal and ClampedText — the whole timeline hot path.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { InlineIcon } from '../../components/icons'
import {
  
  Eye, 
  PenLine,   TriangleAlert, 
} from 'lucide-react'
import type { Trip, ItineraryStop } from '../../data/types'
import { updateTrip, setStopStatus, restoreStop, useDb, currentUser, userById } from '../../store/store'
import {
  computeTotals, minutesToHM, formatInr,
  collectWarnings, buildJourney, dayRoadPolyline, groupWarnings,
} from '../../lib/engine'
import type { LegEstimate, ScheduleWarning } from '../../lib/engine'
import type { ImpactResult } from '../../lib/impact'
import { loadOpenDay, saveOpenDay } from '../../lib/uiPrefs'
import { accordionNext } from '../../lib/daySummary'
import { scrollBehavior } from '../../lib/motion'
import { toast, undoToast } from '../../components/ui'
import { StopEditor, type StopFormValues } from '../../components/StopEditor'
import { RemoteEditBanner } from '../../components/RemoteEditBanner'
import { useStopConflict } from '../../components/useStopConflict'
import { stopInitialValues, stopLegContext, stopEditorKey, stopDayIndex, type StopEditorTarget } from '../../lib/stopForm'
import { useSuggestionCache } from '../../hooks/useSuggestionCache'
import { PREVIEW_BUSY } from '../../lib/previewChain'
import { kmFromStartForHit } from '../../lib/providers/hits'
import { moveStopToDay, moveStopWithinDay, nextOrderInDay, pendingStopId, removeStopFromDay, stopById } from '../../lib/stopOrder'
import { useTimelineMode, type TimelineMode } from './timeline/useTimelineMode'
import { PillNav } from '../../components/PillNav'
import { DaySection } from './timeline/DaySection'
import { MoveStopModal } from './timeline/MoveStopModal'

/** Shared empty array so the memoized DaySections' `warnings` prop keeps a
 *  stable reference for days without warnings (`?? []` would defeat the memo). */
const NO_WARNINGS: ScheduleWarning[] = []
// ================= Timeline =================

export function TimelineTab({ trip, editable, applyChange, previewOpen, legCorrections, suggestionCache, onOpenBoard, focusDay, onFocusConsumed }: {
  trip: Trip
  editable: boolean
  /** `onKept` runs only when the user keeps the staged change — the hook the
   *  Undo toasts hang off (the day plan's Fill uses the same one). */
  applyChange: (mutator: (d: Trip) => void, kind: ImpactResult['kind'], dayIndex: number, onKept?: () => void) => void
  /** true while the workspace has a staged change — day rename / ride start
   *  write the committed row directly, so they must not race a preview (#334). */
  previewOpen?: boolean
  legCorrections?: Record<string, LegEstimate>
  suggestionCache: ReturnType<typeof useSuggestionCache>
  /** M5: the doc's §6.3 "Open in Board" bridge — Board now exists. */
  onOpenBoard?: () => void
  /** Phase 3 (the living plan): the map's halt label handed us a day to open.
   *  Consumed once — the workspace clears it through onFocusConsumed, so a
   *  stale value can neither re-fire on a later mount (tab navigation) nor
   *  leak into another trip's timeline (the workspace outlives trips). */
  focusDay?: number | null
  /** clears the workspace's focusDay signal once the request is handled */
  onFocusConsumed?: () => void
}) {
  const [editorState, setEditorState] = useState<StopEditorTarget>(null)
  const [moveModalStop, setMoveModalStop] = useState<ItineraryStop | null>(null)

  // ---- M6 B3 · remote-edit conflict surfacing (shared hook — BoardView uses
  // the same one, so both surfaces of the SAME StopEditor modal banner alike) ----
  const conflictState = useStopConflict(trip, editorState)
  const openEditorState = useCallback((next: StopEditorTarget) => {
    conflictState.openEditor(next, setEditorState)
  }, [conflictState.openEditor])

  // Sorted once per trip change — a stable array of stable day references so
  // the memoized DaySections below only re-render when their own data changes.
  const days = useMemo(() => [...trip.days].sort((a, b) => a.index - b.index), [trip.days])

  // --- Collapsed-by-default accordion (docs/TIMELINE-PLAN.md Phase 1) ---
  // ONE open day per trip, persisted per trip id (uiPrefs `yatraflow_open_day`);
  // NO_OPEN_DAY = every day collapsed, which is the default. Collapse state is
  // LIFTED here so the summary rows + jump rail can drive it; the old per-day
  // collapsed map is retired (per-day booleans can't express accordion).
  const [openDayIndex, setOpenDayIndex] = useState(() => loadOpenDay(trip.id))
  // (TripWorkspace keys this component by trip id, so a trip switch remounts
  // it and this init re-reads the right trip — no reset effect needed.)
  // Persisted inside the updater: React may re-run updaters in dev StrictMode,
  // but saveOpenDay is idempotent so the write stays correct.
  const toggleDay = useCallback((dayIndex: number) => {
    setOpenDayIndex(prev => {
      const next = accordionNext(prev, dayIndex)
      saveOpenDay(trip.id, next)
      return next
    })
  }, [trip.id])
  /** Open without toggling (jump rail, + Add here) — no-op when already open. */
  const openDay = useCallback((dayIndex: number) => {
    setOpenDayIndex(prev => {
      if (prev === dayIndex) return prev
      saveOpenDay(trip.id, dayIndex)
      return dayIndex
    })
  }, [trip.id])

  // M3.3: every DaySection prop below must keep a stable identity between
  // commits that don't touch the trip, or the React.memo on DaySection never
  // bites (an unrelated store commit re-renders TimelineTab via the tab counts).
  const handleAdd = useCallback((dayIndex: number) => {
    openDay(dayIndex) // adding into a collapsed day would hide the result — expand it
    openEditorState({ mode: 'add', dayIndex })
  }, [openDay, openEditorState])
  const handleEdit = useCallback((stopId: string) => openEditorState({ mode: 'edit', stopId }), [openEditorState])

  function handleSave(v: StopFormValues) {
    if (!editorState) return
    // legFromSource is display-only - never persist it onto the stop
    const { legFromSource: _drop, ...legFields } = v
    if (editorState.mode === 'add') {
      const dayIndex = editorState.dayIndex
      applyChange(draft => {
        const day = draft.days.find(d => d.index === dayIndex)!
        day.stops.push({
          ...(legFields as unknown as ItineraryStop),
          id: pendingStopId(),
          orderInDay: nextOrderInDay(day),
        })
      }, 'add', dayIndex)
    } else {
      const stopId = editorState.stopId
      applyChange(draft => {
        for (const day of draft.days) {
          const s = day.stops.find(x => x.id === stopId)
          if (s) { Object.assign(s, legFields); break }
        }
      }, 'edit', stopDayIndex(trip, stopId))
    }
    setEditorState(null)
  }

  // Deletions go through the impact-preview flow (Keep / Remove confirm the
  // destructive step) AND leave a way back (#337): the stop, its day and its
  // old order are captured before staging, and the Undo toast restores it —
  // the same deal the map pin's delete offers. The shared helper renumbers the
  // survivors, so the next add cannot mint a duplicate order.
  const handleDelete = useCallback((stopId: string, dayIndex: number) => {
    const victim = stopById(trip, stopId)
    applyChange(draft => {
      removeStopFromDay(draft, stopId)
    }, 'remove', dayIndex, victim
      ? () => undoToast(`“${victim.title}” removed from Day ${dayIndex + 1}`, () => restoreStop(trip.id, victim, dayIndex))
      : undefined)
  }, [applyChange, trip])

  const handleMoveWithinDay = useCallback((fromIdx: number, toIdx: number, dayIndex: number) => {
    applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)
      // The shared helper carries the store sibling's guards — clamp (an OOB
      // splice inserts `undefined`), from===to no-op, missing stop (#337).
      if (day) moveStopWithinDay(day, fromIdx, toIdx)
    }, 'reorder', dayIndex)
  }, [applyChange])

  /** Optimise-day commit: replace a day's stop order wholesale (ids), keeping
   *  every stop — the reorder goes through the same impact-preview gate as a
   *  manual drag. It is a FULL-array rewrite that renumbers 1..n, so it has no
   *  from/to splice to make — the same invariant as lib/stopOrder's helpers. */
  const handleReorderDay = useCallback((dayIndex: number, orderedIds: string[]) => {
    applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)!
      const byId = new Map(day.stops.map(s => [s.id, s]))
      const reordered = orderedIds.map(id => byId.get(id)!).filter(Boolean)
      // any stop the optimizer left out (safety net) rides at the end
      const rest = day.stops.filter(s => !orderedIds.includes(s.id))
      day.stops = [...reordered, ...rest]
      day.stops.forEach((s, i) => { s.orderInDay = i + 1 })
    }, 'reorder', dayIndex)
  }, [applyChange])

  /** Cross-day drag: lift a stop out of its day and insert it at `position` of `toDayIndex`. */
  const handleMoveStopInto = useCallback((stopId: string, _fromDayIndex: number, toDayIndex: number, position: number) => {
    // Resolve the destination BEFORE staging (#339): the old handler spliced
    // the source first and, when the target day no longer existed, dropped the
    // stop on the floor — a silent delete with no recovery. Abort instead.
    if (!trip.days.some(d => d.index === toDayIndex)) {
      toast(`Day ${toDayIndex + 1} is no longer on this trip — the stop stayed on its day.`, 'err')
      return
    }
    applyChange(draft => {
      moveStopToDay(draft.days, stopId, toDayIndex, position)
    }, 'move-day', toDayIndex)
  }, [applyChange, trip])

  // Warnings grouped by the day they belong to — powers the per-day
  // progress-bar colour, the day pills and the trip-wide block. Identity comes
  // from the engine's `dayIndex`, never from parsing `title` (a display
  // string): the old regex misfiled every warning with no “Day N:” prefix
  // (opening hours lead with a stop title) and silently DROPPED the trip-wide
  // accommodation one (#402).
  const { dayWarnings, tripWideWarnings, warnDayCount } = useMemo(() => {
    const { byDay, tripWide } = groupWarnings(collectWarnings(trip))
    const map: Record<number, ScheduleWarning[]> = {}
    for (const [idx, list] of byDay) map[idx] = list
    return { dayWarnings: map, tripWideWarnings: tripWide, warnDayCount: byDay.size }
  }, [trip])
  // M4: sticky trip-total strip (doc §6.3) — same engine numbers as Overview.
  const totals = useMemo(() => computeTotals(trip, legCorrections), [trip, legCorrections])

  /** Day-jump rail: open the day (accordion) and scroll a long timeline
   *  straight to its card. */
  function jumpToDay(dayIndex: number) {
    openDay(dayIndex)
    const el = document.getElementById(`day-card-${dayIndex}`)
    if (!el) return
    const rect = el.getBoundingClientRect()
    const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight
    if (!isVisible) el.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
  }

  // Phase 3 (the living plan): a halt label on the map asked for this day's
  // plan — open its accordion and bring the card into view. Runs after mount
  // so the day cards exist (the workspace mounts this tab in the same commit
  // that sets the tab). focusDay is a one-shot REQUEST, not a controlled
  // value: it is validated against THIS trip's days, then consumed — the
  // workspace clears it so the same value cannot re-fire on a later mount
  // (tab navigation) or leak across trips, and re-tapping the same halt
  // re-arms it. Validation matters because the clock walk numbers its own
  // drive days (the return pass indexes past the itinerary), and a value no
  // DaySection matches would collapse the whole accordion and scroll nowhere.
  useEffect(() => {
    if (focusDay == null || !Number.isFinite(focusDay)) return
    if (!trip.days.some(d => d.index === focusDay)) {
      onFocusConsumed?.()
      return
    }
    jumpToDay(focusDay)
    onFocusConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jumpToDay reads openDay (stable) + the DOM; focusDay is the one-shot signal
  }, [focusDay])

  /** Inline day rename — a lightweight label change, applied directly (no impact preview). */
  const handleRenameDay = useCallback((dayIndex: number, title: string) => {
    // #334: this writes the committed row directly, so while a preview is open
    // it would race the staged change in either order and one edit would fall.
    if (previewOpen) { toast(PREVIEW_BUSY, 'err'); return }
    updateTrip(trip.id, { days: trip.days.map(d => d.index === dayIndex ? { ...d, title: title.trim() || undefined } : d) })
    toast('Day renamed')
  }, [trip, previewOpen])

  /** Duplicate this day's stops onto the next day (base-camp style planning). */
  const handleCopyDay = useCallback((dayIndex: number) => {
    applyChange(draft => {
      const src = draft.days.find(d => d.index === dayIndex)
      const dst = draft.days.find(d => d.index === dayIndex + 1)
      if (!src || !dst) return
      const sorted = [...src.stops].sort((a, b) => a.orderInDay - b.orderInDay)
      for (const s of sorted) {
        dst.stops.push({
          ...structuredClone(s),
          id: pendingStopId(),
          orderInDay: nextOrderInDay(dst),
        })
      }
    }, 'add', dayIndex + 1)
  }, [applyChange])

  /** One-click add from the empty-day suggestions (route continuation / nearby POI). */
  const handleAddQuickStop = useCallback((dayIndex: number, stop: Omit<ItineraryStop, 'id' | 'orderInDay'>) => {
    applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)!
      day.stops.push({ ...stop, id: pendingStopId(), orderInDay: nextOrderInDay(day) })
    }, 'add', dayIndex)
  }, [applyChange])

  /** Ride start time for a day — a lightweight plan field, applied directly (like rename). */
  const handleSetDayStart = useCallback((dayIndex: number, time: string) => {
    // #334: direct write, same race as the rename — blocked while previewing.
    if (previewOpen) { toast(PREVIEW_BUSY, 'err'); return }
    updateTrip(trip.id, { days: trip.days.map(d => d.index === dayIndex ? { ...d, startTime: time || undefined } : d) })
    toast(time ? `Day ${dayIndex + 1} now starts ${time}` : 'Ride start reset to the default')
  }, [trip, previewOpen])

  /** Insert a batch of long-ride break halts, each at a user-chosen km point, ordered by
      distance along the route so the arrival clock and map reflect true stop order. Impact
      preview applies the whole-day change. */
  const handleAddPlannedHalts = useCallback((dayIndex: number, halts: { km: number; stop: Omit<ItineraryStop, 'id' | 'orderInDay'> }[]) => {
    if (halts.length === 0) return
    applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)!
      const j = buildJourney(draft, day, legCorrections) // existing stop → km lookup
      // Position stops on the day's ROAD polyline when the routing layer has
      // resolved one — the halt planner's km are road km, so ordering against
      // the straight-line chord would slot the halt at the wrong place.
      const road = dayRoadPolyline(j.points, legCorrections)
      const posOf = (p: { lat: number; lng: number }) => kmFromStartForHit({ latitude: p.lat, longitude: p.lng }, road ?? j.points) ?? 0
      const merged = [
        ...day.stops.map(s => ({ km: posOf(s), s: structuredClone(s) })),
        ...halts.map(h => ({ km: h.km, s: { ...h.stop, id: pendingStopId(), orderInDay: 0 } })),
      ].sort((a, b) => a.km - b.km)
      day.stops = merged.map((m, i) => ({ ...m.s, orderInDay: i + 1 }))
    }, 'add', dayIndex)
  }, [applyChange, legCorrections])

  const handleStatus = useCallback((stop: ItineraryStop, status: ItineraryStop['status']) => {
    // Status flips are lightweight group signals — applied directly to the
    // committed row, so #334 refuses them while a preview is open: the flip
    // would land on the cache, and Keep would then write the proposal the
    // preview was built from, silently reverting it.
    if (previewOpen) { toast(PREVIEW_BUSY, 'err'); return }
    setStopStatus(trip.id, status, stop.id)
    toast(`“${stop.title}” marked ${status === 'needs-booking' ? 'needs booking' : status}`)
  }, [trip.id, previewOpen])

  // --- Plan / Inspect (docs/TIMELINE-PLAN.md Phase 3): Inspect is the study
  // view — same data, every editing affordance off (the existing `editable`
  // seam renders it: no drag, delete, add, rename or impact sheet). The mode
  // persists per user like the theme. ---
  const { mode, setMode } = useTimelineMode()
  const planEditable = editable && mode === 'plan'
  function changeMode(m: TimelineMode) {
    setMode(m)
    if (m === 'inspect') { openEditorState(null); setMoveModalStop(null) }
  }

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 16 }}>
        <div className="tl-head-copy">
          <h2>Day-by-day timeline</h2>
          {/* key={mode} crossfades the copy; min-height in CSS reserves the
              two-line block so switching modes never shifts the layout. */}
          <p key={mode} className="muted small tl-mode-copy">{mode === 'plan'
            ? 'Drag stops to reorder within a day — or drop them onto another day to move them there. On touch devices: press and hold a stop, then drag it. Every change shows its impact before saving.'
            : 'Read-only study view — clocks, costs and risks without the edit handles. Switch to Plan mode to make changes.'}</p>
        </div>
        {editable && (
          <div className="row tl-head-tools" style={{ gap: 8 }}>
            {onOpenBoard && (
              <button className="btn btn-outline btn-sm" onClick={onOpenBoard} title="Arrange stops across days with the route in view">Open in Board →</button>
            )}
            {/* Same mechanic and surface as the workspace tab rail: a glass
                capsule whose glider paints the active side (PillNav + tab-btn),
                so switching modes animates exactly like Board→Map→Timeline. */}
            <PillNav className="mode-pillbar" role="group" aria-label="Timeline mode" activeKey={mode}>
              <button type="button" data-pill-key="plan" className={`tab-btn${mode === 'plan' ? ' active' : ''}`}
                onClick={() => changeMode('plan')} aria-pressed={mode === 'plan'}>
                <PenLine size={14} aria-hidden />Plan
              </button>
              <button type="button" data-pill-key="inspect" className={`tab-btn${mode === 'inspect' ? ' active' : ''}`}
                onClick={() => changeMode('inspect')} aria-pressed={mode === 'inspect'}>
                <Eye size={14} aria-hidden />Inspect
              </button>
            </PillNav>
            {/* Stays rendered in both modes (disabled + dimmed in Inspect) so
                toggling never reflows the header — that reflow was the jerk. */}
            <button className="btn btn-primary btn-sm" disabled={mode !== 'plan'}
              title={mode !== 'plan' ? 'Switch to Plan mode to edit' : undefined}
              onClick={() => openEditorState({ mode: 'add', dayIndex: 0 })}>+ Add stop</button>
          </div>
        )}
      </div>

      <div className="tl-total-strip">
        <span className="tl-total-label">Trip total</span>
        <span>{Math.round(totals.totalDistanceKm).toLocaleString('en-IN')} km</span>
        <span className="tl-total-dot" aria-hidden="true">·</span>
        <span>{minutesToHM(totals.totalTravelMinutes)} driving</span>
        <span className="tl-total-dot" aria-hidden="true">·</span>
        <span>{formatInr(totals.totalCostInr)} estimated</span>
        {warnDayCount > 0 && (
          <span className="tl-total-warn"><InlineIcon icon={TriangleAlert} size={12} gap={3} />{warnDayCount} day{warnDayCount !== 1 ? 's' : ''} need{warnDayCount === 1 ? 's' : ''} attention</span>
        )}
        {tripWideWarnings.length > 0 && (
          <span className="tl-total-warn"><InlineIcon icon={TriangleAlert} size={12} gap={3} />{tripWideWarnings.length} trip-wide warning{tripWideWarnings.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Trip-wide warnings have no day card to live in, so they get their own
          block right after the totals — before it, the regex grouping dropped
          them from this tab entirely (#402). */}
      {tripWideWarnings.length > 0 && (
        <div className="warn-list" style={{ marginTop: 10 }} role="note" aria-label="Trip-wide warnings">
          {tripWideWarnings.map(w => (
            <div key={w.code + w.title} className={`warn-item ${w.severity === 'high' ? 'sev-high' : w.severity === 'low' ? 'sev-low' : ''}`}>
              <span className="warn-icon"><TriangleAlert size={13} aria-hidden /></span>
              <div>
                <div className="warn-title">{w.title}</div>
                <div className="warn-fix">{w.fix}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {days.length >= 4 && (
        <div className="day-rail" role="navigation" aria-label="Jump to day">
          <span className="day-rail-label">Jump to day</span>
          <div className="day-rail-chips">
            {days.map(d => {
              const hasWarn = (dayWarnings[d.index] ?? []).length > 0
              return (
                <button key={d.id} type="button" className={`day-rail-chip ${hasWarn ? 'warn' : ''}`} onClick={() => jumpToDay(d.index)}>
                  Day {d.index + 1}{hasWarn && <InlineIcon icon={TriangleAlert} size={11} gap={0} vAlign="-1px" style={{ marginLeft: 3 }} />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {days.map(day => (
        <DaySection key={day.id} day={day} trip={trip} editable={planEditable} open={openDayIndex === day.index} onToggleOpen={toggleDay} legCorrections={legCorrections} suggestionCache={suggestionCache} dayTotals={totals.byDay.find(b => b.dayIndex === day.index)}
          onAdd={handleAdd}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onMoveWithinDay={handleMoveWithinDay}
          onReorderDay={handleReorderDay}
          onMoveBetweenDays={setMoveModalStop}
          onMoveStopIn={handleMoveStopInto}
          onRenameDay={handleRenameDay}
          onCopyDay={handleCopyDay}
          onAddQuickStop={handleAddQuickStop}
          onSetDayStart={handleSetDayStart}
          onAddPlannedHalts={handleAddPlannedHalts}
          warnings={dayWarnings[day.index] ?? NO_WARNINGS}
          onStatus={handleStatus}
        />
      ))}

      <StopEditor
        open={!!editorState}
        onClose={() => { setEditorState(null); conflictState.clearConflict() }}
        initial={stopInitialValues(editorState, trip)}
        resetKey={stopEditorKey(editorState) + (conflictState.takeTheirsTick ? `:theirs-${conflictState.takeTheirsTick}` : '')}
        onSave={handleSave}
        dayLabel={editorState?.mode === 'add' ? `Day ${editorState.dayIndex + 1}` : undefined}
        legContext={stopLegContext(editorState, trip)}
        banner={conflictState.conflict && editorState?.mode === 'edit' ? (
          <RemoteEditBanner
            byName={conflictState.conflictByName?.profile.name ?? ''}
            onKeepMine={conflictState.keepMine}
            onTakeTheirs={conflictState.takeTheirs}
          />
        ) : undefined}
      />

      <MoveStopModal
        stop={moveModalStop}
        trip={trip}
        onClose={() => setMoveModalStop(null)}
        onMove={(toDay) => {
          if (!moveModalStop) return
          const stopId = moveModalStop.id
          // The modal's chips come from the live trip, but a day deleted in
          // another tab can still be clicked — abort rather than lose the stop.
          if (!trip.days.some(d => d.index === toDay)) {
            toast(`Day ${toDay + 1} is no longer on this trip — the stop stayed on its day.`, 'err')
            setMoveModalStop(null)
            return
          }
          applyChange(draft => {
            const target = draft.days.find(d => d.index === toDay)
            if (!target) return
            // Road order, not append (#339): the modal has no drop slot, so it
            // used to push the stop to the end while a drag inserts it
            // positionally — same gesture, two different plans. Splice it in
            // where the day's road says it belongs (the Map's add-to-day rule);
            // an unknown position appends rather than being dropped.
            const journey = buildJourney(draft, target, legCorrections)
            const road = dayRoadPolyline(journey.points, legCorrections) ?? journey.points
            const kmOf = (s: ItineraryStop) => kmFromStartForHit({ latitude: s.lat, longitude: s.lng }, road)
            moveStopToDay(draft.days, stopId, toDay, null, kmOf)
          }, 'move-day', toDay)
          setMoveModalStop(null)
        }}
      />
    </div>
  )
}
