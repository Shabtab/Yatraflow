// ============ Board — spatial group coordination (Calm Travel Intelligence §6.4) ============
// A supplementary planning mode: the route stays visible on a pinned map while
// day columns float above it for kanban-style cross-day rearrangement. Every
// change routes through the same applyChange → impact-preview flow as the
// Timeline, so nothing persists without its consequence visible first.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ChevronDown, ChevronUp, LocateFixed, Map as MapIcon, MoveHorizontal,
  Plus, Trash2, TriangleAlert,
} from 'lucide-react'
import { prefersReducedMotion } from '../lib/motion'
import { activeStopsInOrder, moveActiveStopWithinDay, moveStopToDay, nextOrderInDay, pendingStopId } from '../lib/stopOrder'
import { InlineIcon, KindIcon } from './icons'
import type { Trip, ItineraryStop } from '../data/types'
import { computeTotals, computeHealth, collectWarnings, minutesToHM, formatInr, buildJourney, dayRoadPolyline } from '../lib/engine'
import type { ScheduleWarning, LegEstimate } from '../lib/engine'
import type { ImpactResult } from '../lib/impact'
import { useTimeFormat, formatHM } from '../lib/timefmt'
import { stopKindOf, STOP_KIND_LABELS } from '../lib/stopKind'
import { stopInitialValues, stopLegContext, stopEditorKey, stopDayIndex, type StopEditorTarget } from '../lib/stopForm'
import { useDb } from '../store/store'
import { useReorder, Modal, toast } from './ui'
import { kmFromStartForHit } from '../lib/providers/hits'
import { glideOffsetPx, insertionIndexFor, rowLayoutBoxes, cancelRowSettle, cancelListSettles, settleRow } from '../lib/touchDnd'
import { TripMap } from './TripMap'
import { StopEditor, type StopFormValues } from './StopEditor'
import { useStopConflict } from './useStopConflict'
import { RemoteEditBanner } from './RemoteEditBanner'

export function BoardView({ trip, editable, applyChange, health, totals, onOpenOverview, legCorrections }: {
  trip: Trip
  editable: boolean
  applyChange: (mutator: (d: Trip) => void, kind: ImpactResult['kind'], dayIndex: number) => void
  health: ReturnType<typeof computeHealth>
  totals: ReturnType<typeof computeTotals>
  onOpenOverview: () => void
  /** The workspace's road measurement — the move dialog inserts by ROAD order
   *  with it, the same chain the Timeline's dialog uses. */
  legCorrections?: Record<string, LegEstimate>
  /** Kept for API compatibility: the board no longer navigates away to add a
      stop — StopEditor opens in place. TripWorkspace still passes it; a future
      pass can drop it from both ends. */
  onOpenTimeline?: () => void
}) {
  const db = useDb()
  const days = useMemo(() => [...trip.days].sort((a, b) => a.index - b.index), [trip])
  // Column focus → the map shows just that day's route ('all' = whole trip).
  const [focusedDay, setFocusedDay] = useState<number | 'all'>('all')
  // Map-focus ("peek") mode: columns slide ~90% off the bottom edge so the map
  // owns the board; a 48px sliver of each column stays visible (and Escape or
  // the same button brings everything back with a staggered settle). Transient.
  const [mapFocus, setMapFocus] = useState(false)
  useEffect(() => {
    if (!mapFocus) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMapFocus(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mapFocus])

  /** Same-day reorder from a board column — the shared stopOrder rule the
      Timeline's drag uses, in its ACTIVE-list form: the Board hides rejected
      cards, and the helper still renumbers every stop on the day, so a hidden
      one cannot keep a stale or duplicated number (#371). */
  function reorderWithinDay(dayIndex: number, fromIdx: number, toIdx: number) {
    applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)
      if (day) moveActiveStopWithinDay(day, fromIdx, toIdx)
    }, 'reorder', dayIndex)
  }

  // warnings grouped by day — same parse used by the Timeline (§6.3 in-day state)
  const dayWarnings = useMemo(() => {
    const map: Record<number, ScheduleWarning[]> = {}
    for (const w of collectWarnings(trip)) {
      const m = /^Day (\d+):/.exec(w.title)
      if (m) { const di = Number(m[1]) - 1; (map[di] ??= []).push(w) }
    }
    return map
  }, [trip])
  const warnDayCount = Object.keys(dayWarnings).length

  const openDecisions = db.decisions.filter(d => d.tripId === trip.id && d.status === 'open').length
  const optionalExpenses = trip.expenses.filter(e => e.optional).length

  /** Cross-day move — the shared stopOrder rule, and every Board mutation
      previews. The drag passes its own insertion slot; the move dialog passes
      none, so the stop lands by ROAD order instead of being appended — the
      same rule the Timeline's dialog follows. A day that has since vanished
      refuses with a message, never a silent drop. */
  function handleMoveStopInto(stopId: string, _fromDayIndex: number, toDayIndex: number, position: number | null) {
    if (!trip.days.some(d => d.index === toDayIndex)) {
      toast(`Day ${toDayIndex + 1} is no longer on this trip — the stop stayed on its day.`, 'err')
      return
    }
    applyChange(draft => {
      let kmOf: ((s: ItineraryStop) => number | null) | undefined
      if (position == null) {
        const target = draft.days.find(d => d.index === toDayIndex)
        if (!target) return
        const journey = buildJourney(draft, target, legCorrections)
        const road = dayRoadPolyline(journey.points, legCorrections) ?? journey.points
        kmOf = (s) => kmFromStartForHit({ latitude: s.lat, longitude: s.lng }, road)
      }
      moveStopToDay(draft.days, stopId, toDayIndex, position, kmOf)
    }, 'move-day', toDayIndex)
  }

  /** Same delete shape as the Timeline's handleDelete — routes through the
      impact preview, so Keep/Remove acts as the confirmation step. */
  function handleDelete(stopId: string, dayIndex: number) {
    applyChange(draft => {
      for (const day of draft.days) day.stops = day.stops.filter(s => s.id !== stopId)
    }, 'remove', dayIndex)
  }

  /** Add/edit stop editor, opened from the header button or a day column's
      add-zone. Same form, same save path as the Timeline's. */
  const [editorTarget, setEditorTarget] = useState<StopEditorTarget>(null)
  // ---- M6 B3 · remote-edit conflict surfacing — the Board opens the SAME
  // StopEditor modal as the Timeline, so a crew member editing from here gets
  // the same amber keep-mine/take-theirs banner when a remote save lands
  // mid-edit (previously this surface edited stale data with no banner at all).
  const conflictState = useStopConflict(trip, editorTarget)
  const openEditorTarget = useCallback((next: StopEditorTarget) => {
    conflictState.openEditor(next, setEditorTarget)
  }, [conflictState.openEditor])
  function handleSave(v: StopFormValues) {
    if (!editorTarget) return
    const { legFromSource: _drop, ...legFields } = v
    if (editorTarget.mode === 'add') {
      const dayIndex = editorTarget.dayIndex
      applyChange(draft => {
        const day = draft.days.find(d => d.index === dayIndex)
        if (!day) return
        day.stops.push({
          ...(legFields as unknown as ItineraryStop),
          id: pendingStopId(),
          orderInDay: nextOrderInDay(day),
        })
      }, 'add', dayIndex)
    } else {
      const stopId = editorTarget.stopId
      applyChange(draft => {
        for (const day of draft.days) {
          const s = day.stops.find(x => x.id === stopId)
          if (s) { Object.assign(s, legFields); break }
        }
      }, 'edit', stopDayIndex(trip, stopId))
    }
    setEditorTarget(null)
  }

  function fitToTrip() { setFocusedDay('all') }
  return (
    <div className={`board-tab${mapFocus ? ' board--mapfocus' : ''}`}>
      {/* ---- slim board header (above the map board, normal flow) ---- */}
      <div className="row-between board-head">
        <div>
          <h2>Trip board</h2>
          <p className="muted small">Arrange flexible stops across days while keeping the real route in view.</p>
        </div>
        {editable && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className={`btn btn-sm ${mapFocus ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setMapFocus(f => !f)} aria-pressed={mapFocus}
              title={mapFocus ? 'Bring the day columns back' : 'Slide the columns aside and read the map full-bleed (Esc)'}>
              {mapFocus
                ? <><InlineIcon icon={ArrowLeft} size={13} gap={4} />Back to cards</>
                : <><InlineIcon icon={MapIcon} size={13} gap={4} />View map</>}
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => openEditorTarget({ mode: 'add', dayIndex: focusedDay === 'all' ? 0 : focusedDay })}>
              <InlineIcon icon={Plus} size={13} gap={4} />Add a stop
            </button>
          </div>
        )}
      </div>

      <div className="board">
        {/* pinned route map — the existing component, no second map system (§8 guardrail) */}
        <div className="board-map">
          <TripMap trip={trip} focusDay={focusedDay} showToolbar={false} />
        </div>

        {/* floating info card (normal-flow top bar above the columns; the map still
            paints behind everything, so nothing can cover a column) */}
        <div className="board-topbar">
          <div className="glass board-info">
            <b>Plan by day, see the route</b>
            <span className="small muted" style={{ display: 'block', marginTop: 3 }}>
              Drag a stop to another day — its impact previews before saving. Click a column to focus its route.
            </span>
            <button type="button" className="board-fit" onClick={fitToTrip}><InlineIcon icon={LocateFixed} size={13} gap={4} />Fit route</button>
          </div>

          {/* Trip Pulse — health, decisions, budget (doc §6.4) */}
          <div className="glass board-pulse">
            <span className="pulse-label">Trip pulse</span>
            <div className="board-pulse-row">
              <b className={`health-num-big ${health.score >= 70 ? 'ok' : health.score >= 40 ? 'mid' : 'bad'}`}>
                {health.score}
              </b>
              <span className={`board-pulse-band ${health.score >= 70 ? 'ok' : health.score >= 40 ? 'mid' : 'bad'}`}>
                {health.band}{warnDayCount > 0 ? ' — needs attention' : ''}
              </span>
            </div>
            <div className="health-bar" aria-hidden="true">
              <i className={health.score >= 70 ? 'ok' : health.score >= 40 ? 'mid' : 'bad'} style={{ width: `${Math.max(4, health.score)}%` }} />
            </div>
            <div className="board-pulse-lines">
              {warnDayCount > 0 && <span><InlineIcon icon={TriangleAlert} size={12} gap={3} />{warnDayCount} route day{warnDayCount === 1 ? '' : 's'} overloaded</span>}
              {openDecisions > 0 && <span>{openDecisions} open decision{openDecisions === 1 ? '' : 's'}</span>}
              <span>{formatInr(totals.totalCostInr)} est. budget{optionalExpenses > 0 ? ` · ${optionalExpenses} optional item${optionalExpenses === 1 ? '' : 's'}` : ''}</span>
            </div>
            <button type="button" className="board-pulse-link" onClick={onOpenOverview}>Open health advice →</button>
          </div>
        </div>

        {/* floating day columns — near-opaque so cards stay readable (§3.1) */}
        <div className="board-cols" role="list" aria-label="Trip days">
          {days.map(day => (
            <BoardColumn key={day.id} day={day} allDays={days} editable={editable}
              warnings={dayWarnings[day.index] ?? []}
              focused={focusedDay === day.index}
              onToggleFocus={(focus) => setFocusedDay(focus ? day.index : focusedDay === day.index ? 'all' : day.index)}
              onMoveStopIn={handleMoveStopInto}
              onReorder={reorderWithinDay}
              onDelete={handleDelete}
              onAdd={() => openEditorTarget({ mode: 'add', dayIndex: day.index })}
              onEdit={(stopId) => openEditorTarget({ mode: 'edit', stopId })} />
          ))}
        </div>
      </div>

      {/* Add/edit stop, without leaving the board. Same form as the Timeline's —
          StopEditor owns its own modal chrome; the shared stopForm helpers give
          it the same prefill and leg context. */}
      <StopEditor
        open={!!editorTarget}
        onClose={() => { setEditorTarget(null); conflictState.clearConflict() }}
        initial={stopInitialValues(editorTarget, trip)}
        resetKey={stopEditorKey(editorTarget) + (conflictState.takeTheirsTick ? `:theirs-${conflictState.takeTheirsTick}` : '')}
        onSave={handleSave}
        dayLabel={editorTarget?.mode === 'add' ? `Day ${editorTarget.dayIndex + 1}` : undefined}
        legContext={stopLegContext(editorTarget, trip)}
        banner={conflictState.conflict && editorTarget?.mode === 'edit' ? (
          <RemoteEditBanner
            byName={conflictState.conflictByName?.profile.name ?? ''}
            onKeepMine={conflictState.keepMine}
            onTakeTheirs={conflictState.takeTheirs}
          />
        ) : undefined}
      />
    </div>
  )
}
function BoardColumn({ day, allDays, editable, warnings, focused, onToggleFocus, onMoveStopIn, onReorder, onDelete, onAdd, onEdit }: {
  day: Trip['days'][number]
  allDays: Trip['days']
  editable: boolean
  warnings: ScheduleWarning[]
  focused: boolean
  onToggleFocus: (focus: boolean) => void
  onMoveStopIn: (stopId: string, fromDay: number, toDay: number, position: number | null) => void
  onReorder: (dayIndex: number, fromIdx: number, toIdx: number) => void
  onDelete: (stopId: string, dayIndex: number) => void
  onAdd: () => void
  onEdit: (stopId: string) => void
}) {
  const timeFormat = useTimeFormat()
  // Keyboard/touch alternative to dragging: ▲▼ reorders within the day, the
  // ↔ button opens a move-to-day modal (UI audit: Board was drag-only).
  const [moveStop, setMoveStop] = useState<ItineraryStop | null>(null)
  const ordered = useMemo(() => activeStopsInOrder(day), [day])
  const stopsRef = useRef<HTMLDivElement>(null)
  // Liquid drag pattern (bencho-style, Timeline parity): the DOM order NEVER
  // changes mid-drag. The carried card is pinned to the pointer by the engine
  // (lib/touchDnd.ts) and its skin warps with the throw; cards between the
  // carried slot and the cursor target glide out of the way in real time
  // (transform transition), and the final arrangement settles ONCE via the
  // FLIP pass on commit. The insertion index is the source of truth for
  // same-day drops.
  const [insertIdx, setInsertIdx] = useState<number | null>(null)
  const insertRef = useRef(insertIdx)
  insertRef.current = insertIdx
  /** viewport rect of the card as it was carried at release — the FLIP pass
      below springs it from there into its new slot */
  const dropRect = useRef<{ id: string; x: number; y: number } | null>(null)

  const { dndHandlers, dayDropHandlers, dragging, foreignOver, takeCarryRect, listId } = useReorder(
    ordered,
    // Same-list commits resolve through the insertion index, not the card the
    // cursor happened to be over: idx counts positions in the full list
    // (dragged slot included), so adjust for the removal shift.
    (fromIdx) => {
      const idx = insertRef.current ?? fromIdx
      const toIdx = idx > fromIdx ? idx - 1 : idx
      // consume the carry rect on EVERY self-drop: a no-op slot (released at
      // rest) must not leak the engine's rect into a later FLIP pass
      const rect = takeCarryRect()
      if (toIdx !== fromIdx) {
        if (rect && ordered[fromIdx]) dropRect.current = { id: ordered[fromIdx].id, x: rect.x, y: rect.y }
        onReorder(day.index, fromIdx, toIdx)
      }
      setInsertIdx(null)
    },
    {
      dragPayload: (s) => JSON.stringify({ stopId: s.id, fromDay: day.index }),
      onForeignDrop: (payload, toIdx) => {
        try {
          const p = JSON.parse(payload) as { stopId?: string; fromDay?: number }
          if (p.stopId && typeof p.fromDay === 'number' && p.fromDay !== day.index) {
            const rect = takeCarryRect()
            if (rect) dropRect.current = { id: p.stopId, x: rect.x, y: rect.y }
            onMoveStopIn(p.stopId, p.fromDay, day.index, toIdx)
          }
        } catch { /* malformed payload — ignore */ }
      },
      /** engine hover → insertion slot from STABLE layout geometry: the
          carried card's centre against each card's own midpoint (pure
          insertionIndexFor, lib/touchDnd.ts). Transform-immune — the gliding
          cards cannot chase the zones — and defined everywhere, so the flex
          gaps and whitespace keep the reading alive instead of freezing it.
          The engine re-fires while the centre moves; the ref guard keeps
          this from re-rendering until the slot actually flips. */
      onOwnHover: (_idx, _x, centreY, dragIdx) => {
        const root = stopsRef.current
        if (!root || dragIdx < 0) return
        const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-stop-id]'))
        if (cards.length === 0) return
        const next = insertionIndexFor(rowLayoutBoxes(root, cards), centreY, dragIdx)
        if (insertRef.current !== next) setInsertIdx(next)
      },
    },
  )

  useEffect(() => { if (dragging === null) setInsertIdx(null) }, [dragging])

  /** Live glide offset for card i while a drag is open: rows between the
   *  carried slot and the insertion index slide toward the carried row's
   *  origin, so the gap reopens under the cursor. The sign math lives in the
   *  pure glideOffsetPx (lib/touchDnd.ts) so tests can pin it. */
  function glideOffset(i: number): number | null {
    if (dragging === null || insertIdx === null) return null
    const card = stopsRef.current?.querySelectorAll<HTMLElement>('[data-stop-id]')[dragging]
    const h = card ? card.offsetHeight + 8 : 0
    return glideOffsetPx(dragging, insertIdx, i, h)
  }

  const sev = warnings.some(w => w.severity === 'high') ? 'high'
    : warnings.some(w => w.severity === 'medium') ? 'medium' : undefined
  const topWarn = warnings[0]
  const totalStops = ordered.length

  // FLIP slot-in: when this column's card arrangement changes (same-day drag
  // reorder, or a card slotting in from another day), every card animates from
  // its previous position to the new one — compositor-only, no ghosting. The
  // carried card springs from where the finger released it (the engine's
  // carry rect) rather than from its old slot. Fires once per committed
  // arrangement, never during the drag itself.
  const prevRects = useRef<Map<string, { x: number; y: number }> | null>(null)
  useLayoutEffect(() => {
    const rootEl = stopsRef.current
    if (!rootEl) return
    const interrupted = new Map<string, DOMRect>()
    const now = new Map<string, { x: number; y: number }>()
    for (const el of Array.from(rootEl.querySelectorAll<HTMLElement>('[data-stop-id]'))) {
      const visual = cancelRowSettle(el)
      if (visual) interrupted.set(el.dataset.stopId!, visual)
      const r = el.getBoundingClientRect()
      now.set(el.dataset.stopId!, { x: r.left, y: r.top })
    }
    const prev = prevRects.current
    const dropped = dropRect.current
    dropRect.current = null
    if (prev && !prefersReducedMotion()) {
      for (const [id, p] of now) {
        const q = dropped && dropped.id === id ? dropped : prev.get(id)
        if (!q) continue
        const visual = interrupted.get(id)
        const dx = q.x - p.x + (visual && q !== dropped ? visual.left - p.x : 0)
        const dy = q.y - p.y + (visual && q !== dropped ? visual.top - p.y : 0)
        if (dx || dy) {
          const el = rootEl.querySelector<HTMLElement>(`[data-stop-id="${CSS.escape(id)}"]`)
          if (el && !el.classList.contains('is-carried')) settleRow(el, dx, dy, listId)
        }
      }
    }
    prevRects.current = now
  }, [ordered, listId])
  useLayoutEffect(() => () => cancelListSettles(listId), [listId])

  return (
    <div className={`board-col${focused ? ' board-col--focused' : ''}${dragging !== null ? ' drag-live' : ''}`} role="listitem">
      <button type="button" className="board-col-head" onClick={() => onToggleFocus(!focused)}
        aria-pressed={focused} title={focused ? `Show the whole route again` : `Focus the map on Day ${day.index + 1}`}>
        <span className="board-col-day">Day {day.index + 1}</span>
        <span className="board-col-count">{focused ? 'Focused · ' : ''}{totalStops} stop{totalStops === 1 ? '' : 's'}</span>
        <span className="board-col-subtitle">{day.title || `Day ${day.index + 1}`}</span>
        {topWarn && <span className={`day-warn-pill ${sev === 'high' ? 'sev-high' : ''}`}><InlineIcon icon={TriangleAlert} size={12} gap={3} />{topWarn.title.replace(/^Day \d+: /, '')}{warnings.length > 1 ? ` +${warnings.length - 1}` : ''}</span>}
      </button>

      <div className={`board-col-stops${dragging !== null ? ' is-dragging' : ''}`} ref={stopsRef} data-yf-list={listId}>
        {ordered.map((s, i) => {
          const kind = stopKindOf(s)
          const meta = [
            s.locationName,
            minutesToHM(s.visitMinutes),
            s.entryFeeInrPerPerson > 0 ? `₹${s.entryFeeInrPerPerson}/person` : '',
          ].filter(Boolean).join(' · ')
          return (
            // Position layer (.board-row) / skin (.board-stop): the engine
            // pins the row to the pointer while the skin inside warps with
            // the throw — position and deformation cannot share a transform.
            <div key={s.id} className="board-row"
              data-stop-id={s.id}
              title={meta ? `${s.title} — ${meta}` : s.title}
              style={{ transform: glideOffset(i) != null ? `translateY(${glideOffset(i)}px)` : undefined }}
              {...(editable ? dndHandlers(i) : {})}>
              <div className={`board-stop stop-card kind-${kind} status-${s.status} ${foreignOver === i && dragging === null ? 'foreign-over' : ''}`}>
                <div className="stop-main">
                  <span className="board-stop-kicker">{s.departTime ? `${formatHM(s.departTime, timeFormat)} · ` : ''}<KindIcon kind={kind} size={11} />{STOP_KIND_LABELS[kind]}</span>
                  {editable ? (
                    <button type="button" className="board-stop-title-btn" onClick={() => onEdit(s.id)}
                      title={`Edit ${s.title}`} aria-label={`Edit ${s.title}`}>
                      <span className="stop-title">{s.title}</span>
                    </button>
                  ) : (
                    <span className="stop-title">{s.title}</span>
                  )}
                  {meta && <span className="board-stop-meta">{meta}</span>}
                </div>
                {editable && (
                  <div className="stop-actions board-stop-actions">
                    <div className="move-btns">
                      <button type="button" className="move-btn" disabled={i === 0}
                        onClick={() => onReorder(day.index, i, i - 1)} aria-label={`Move ${s.title} up`}>
                        <ChevronUp size={12} aria-hidden />
                      </button>
                      <button type="button" className="move-btn" disabled={i === ordered.length - 1}
                        onClick={() => onReorder(day.index, i, i + 1)} aria-label={`Move ${s.title} down`}>
                        <ChevronDown size={12} aria-hidden />
                      </button>
                    </div>
                    {allDays.length > 1 && (
                      <button type="button" className="move-btn" onClick={() => setMoveStop(s)}
                        title="Move to another day" aria-label={`Move ${s.title} to another day`}>
                        <MoveHorizontal size={12} aria-hidden />
                      </button>
                    )}
                    <button type="button" className="move-btn move-btn--danger"
                      onClick={() => onDelete(s.id, day.index)}
                      title={`Delete ${s.title} — you'll see the impact first`}
                      aria-label={`Delete ${s.title}`}>
                      <Trash2 size={12} aria-hidden />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {editable ? (
          <button type="button" className={`board-col-zone board-col-zone--add${foreignOver === ordered.length && dragging === null ? ' foreign-over' : ''}`}
            {...dayDropHandlers(ordered.length)}
            onClick={onAdd}
            title={`Add a stop to Day ${day.index + 1}`}
            aria-label={`Add a stop to Day ${day.index + 1}`}>
            <b><InlineIcon icon={Plus} size={13} gap={3} />Add or drop a stop</b>
            <span className="small">Impact preview before saving</span>
          </button>
        ) : (
          <div className="board-col-zone" role="note">
            <span className="small">Day {day.index + 1}</span>
          </div>
        )}
      </div>

      {moveStop && (
        <Modal open title={`Move “${moveStop.title}” to…`} onClose={() => setMoveStop(null)}>
          <p className="small muted" style={{ margin: '0 0 12px' }}>It lands where the day's route says it belongs, not at the end.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {allDays.filter(d => d.index !== day.index).map(d => {
              // Count what the column header counts: rejected stops are hidden
              // on the Board and must not inflate the day's size here (#371).
              const count = activeStopsInOrder(d).length
              return (
                <button key={d.id} type="button" className="btn btn-outline" style={{ width: '100%', justifyContent: 'flex-start' }}
                  onClick={() => { onMoveStopIn(moveStop.id, day.index, d.index, null); setMoveStop(null) }}>
                  Day {d.index + 1}{d.title ? ` — ${d.title}` : ''} · {count} stop{count === 1 ? '' : 's'}
                </button>
              )
            })}
          </div>
        </Modal>
      )}
    </div>
  )
}