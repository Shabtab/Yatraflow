// ============ Board — spatial group coordination (Calm Travel Intelligence §6.4) ============
// A supplementary planning mode: the route stays visible on a pinned map while
// day columns float above it for kanban-style cross-day rearrangement. Every
// change routes through the same applyChange → impact-preview flow as the
// Timeline, so nothing persists without its consequence visible first.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Trip, ItineraryStop } from '../data/types'
import { computeTotals, computeHealth, collectWarnings, minutesToHM, formatInr } from '../lib/engine'
import type { ScheduleWarning } from '../lib/engine'
import type { ImpactResult } from '../lib/impact'
import { useTimeFormat, formatHM } from '../lib/timefmt'
import { stopKindOf, STOP_KIND_LABELS } from '../lib/stopKind'
import { useDb } from '../store/store'
import { useReorder } from './ui'
import { TripMap } from './TripMap'

export function BoardView({ trip, editable, applyChange, health, totals, onOpenOverview, onOpenTimeline }: {
  trip: Trip
  editable: boolean
  applyChange: (mutator: (d: Trip) => void, kind: ImpactResult['kind'], dayIndex: number) => void
  health: ReturnType<typeof computeHealth>
  totals: ReturnType<typeof computeTotals>
  onOpenOverview: () => void
  onOpenTimeline: () => void
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

  /** Same-day reorder from a board column — same mutation shape as the
      Timeline's handleMoveWithinDay, so both views stay byte-identical. */
  function reorderWithinDay(dayIndex: number, fromIdx: number, toIdx: number) {
    applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)
      if (!day) return
      const arr = [...day.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)
      const [moved] = arr.splice(fromIdx, 1)
      if (!moved) return
      arr.splice(toIdx, 0, moved)
      const orderMap = new Map(arr.map((s, i) => [s.id, i + 1]))
      for (const s of day.stops) { const n = orderMap.get(s.id); if (n) s.orderInDay = n }
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

  /** Same cross-day move helper as the Timeline — every Board mutation previews. */
  function handleMoveStopInto(stopId: string, fromDayIndex: number, toDayIndex: number, position: number) {
    applyChange(draft => {
      let moved: ItineraryStop | undefined
      for (const d of draft.days) {
        const idx = d.stops.findIndex(s => s.id === stopId)
        if (idx >= 0) {
          [moved] = d.stops.splice(idx, 1)
          d.stops.forEach((s, j) => { s.orderInDay = j + 1 })
          break
        }
      }
      const target = draft.days.find(d => d.index === toDayIndex)
      if (moved && target) {
        const pos = Math.max(0, Math.min(position, target.stops.length))
        moved.orderInDay = pos + 1
        target.stops.splice(pos, 0, moved)
        target.stops.forEach((s, j) => { s.orderInDay = j + 1 })
      }
    }, 'move-day', toDayIndex)
  }

  function fitToTrip() { setFocusedDay('all') }
  return (
    <div className={`board-tab${mapFocus ? ' board--mapfocus' : ''}`}>
      {/* ---- slim board header (above the map board, normal flow) ---- */}
      <div className="row-between board-head">
        <div>
          <h2>Trip Board</h2>
          <p className="muted small">Arrange flexible stops across days while keeping the real route in view.</p>
        </div>
        {editable && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className={`btn btn-sm ${mapFocus ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setMapFocus(f => !f)} aria-pressed={mapFocus}
              title={mapFocus ? 'Bring the day columns back' : 'Slide the columns aside and read the map full-bleed (Esc)'}>
              {mapFocus ? '⬅ Back to cards' : '🗺 View map'}
            </button>
            <button className="btn btn-primary btn-sm" onClick={onOpenTimeline}>＋ Add a stop</button>
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
            <button type="button" className="board-fit" onClick={fitToTrip}>🎯 Fit route</button>
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
              {warnDayCount > 0 && <span>⚠ {warnDayCount} route day{warnDayCount === 1 ? '' : 's'} overloaded</span>}
              {openDecisions > 0 && <span>{openDecisions} open decision{openDecisions === 1 ? '' : 's'}</span>}
              <span>{formatInr(totals.totalCostInr)} est. budget{optionalExpenses > 0 ? ` · ${optionalExpenses} optional item${optionalExpenses === 1 ? '' : 's'}` : ''}</span>
            </div>
            <button type="button" className="board-pulse-link" onClick={onOpenOverview}>Open health advice →</button>
          </div>
        </div>

        {/* floating day columns — near-opaque so cards stay readable (§3.1) */}
        <div className="board-cols" role="list" aria-label="Trip days">
          {days.map(day => (
            <BoardColumn key={day.id} day={day} editable={editable}
              warnings={dayWarnings[day.index] ?? []}
              focused={focusedDay === day.index}
              onToggleFocus={(focus) => setFocusedDay(focus ? day.index : focusedDay === day.index ? 'all' : day.index)}
              onMoveStopIn={handleMoveStopInto}
              onReorder={reorderWithinDay} />
          ))}
        </div>
      </div>
    </div>
  )
}
function BoardColumn({ day, editable, warnings, focused, onToggleFocus, onMoveStopIn, onReorder }: {
  day: Trip['days'][number]
  editable: boolean
  warnings: ScheduleWarning[]
  focused: boolean
  onToggleFocus: (focus: boolean) => void
  onMoveStopIn: (stopId: string, fromDay: number, toDay: number, position: number) => void
  onReorder: (dayIndex: number, fromIdx: number, toIdx: number) => void
}) {
  const timeFormat = useTimeFormat()
  const ordered = useMemo(
    () => [...day.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay),
    [day],
  )
  const stopsRef = useRef<HTMLDivElement>(null)
  // Premium kanban drag pattern: the DOM order NEVER changes mid-drag (no
  // churn, no jitter — native drag stays stable from the first pixel). A slim
  // teal marker glides to the insertion slot instead, and the final
  // arrangement settles ONCE via the FLIP pass on commit. The marker index is
  // the source of truth for same-day drops (card-level drops delegate to it).
  const [insert, setInsert] = useState<{ idx: number; y: number } | null>(null)
  const insertRef = useRef(insert)
  insertRef.current = insert

  const { dndHandlers, dayDropHandlers, dragging, foreignOver } = useReorder(
    ordered,
    // Same-list commits resolve through the marker, not the card the cursor
    // happened to be over: idx counts positions in the full list (dragged slot
    // included), so adjust for the removal shift.
    (fromIdx) => {
      const idx = insertRef.current?.idx ?? fromIdx
      const toIdx = idx > fromIdx ? idx - 1 : idx
      if (toIdx !== fromIdx) onReorder(day.index, fromIdx, toIdx)
      setInsert(null)
    },
    {
      dragPayload: (s) => JSON.stringify({ stopId: s.id, fromDay: day.index }),
      onForeignDrop: (payload, toIdx) => {
        try {
          const p = JSON.parse(payload) as { stopId?: string; fromDay?: number }
          if (p.stopId && typeof p.fromDay === 'number' && p.fromDay !== day.index) {
            onMoveStopIn(p.stopId, p.fromDay, day.index, toIdx)
          }
        } catch { /* malformed payload — ignore */ }
      },
    },
  )

  useEffect(() => { if (dragging === null) setInsert(null) }, [dragging])

  function onColDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (dragging === null) return
    e.preventDefault()
    const rootEl = stopsRef.current
    if (!rootEl) return
    const cards = Array.from(rootEl.querySelectorAll<HTMLElement>('[data-stop-id]'))
    let idx = cards.length
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect()
      if (e.clientY < r.top + r.height / 2) { idx = i; break }
    }
    const y = cards.length === 0 ? 8
      : idx < cards.length ? cards[idx].offsetTop - 6
      : cards[cards.length - 1].offsetTop + cards[cards.length - 1].offsetHeight + 4
    const cur = insertRef.current
    if (!cur || cur.idx !== idx || Math.abs(cur.y - y) > 2) setInsert({ idx, y })
  }
  function onColDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!stopsRef.current?.contains(e.relatedTarget as Node | null)) setInsert(null)
  }
  /** Drops landing in the gaps between cards (card handlers stopPropagation). */
  function onColDrop(e: React.DragEvent<HTMLDivElement>) {
    if (dragging === null) return
    e.preventDefault()
    const idx = insertRef.current?.idx ?? ordered.length
    const toIdx = idx > dragging ? idx - 1 : idx
    if (toIdx !== dragging) onReorder(day.index, dragging, toIdx)
    setInsert(null)
  }

  const draggingId = dragging !== null ? ordered[dragging]?.id : undefined
  const sev = warnings.some(w => w.severity === 'high') ? 'high'
    : warnings.some(w => w.severity === 'medium') ? 'medium' : undefined
  const topWarn = warnings[0]
  const totalStops = day.stops.filter(s => s.status !== 'rejected').length

  // FLIP slot-in: when this column's card arrangement changes (same-day drag
  // reorder, or a card slotting in from another day), every card animates from
  // its previous position to the new one — compositor-only, no ghosting.
  // Fires once per committed arrangement (same-day drop or cross-day insert),
  // never during the drag itself: the marker carries all the in-drag feedback.
  const prevRects = useRef<Map<string, { x: number; y: number }> | null>(null)
  useLayoutEffect(() => {
    const rootEl = stopsRef.current
    if (!rootEl) return
    const now = new Map<string, { x: number; y: number }>()
    for (const el of Array.from(rootEl.querySelectorAll<HTMLElement>('[data-stop-id]'))) {
      const r = el.getBoundingClientRect()
      now.set(el.dataset.stopId!, { x: r.left, y: r.top })
    }
    const prev = prevRects.current
    if (prev) {
      for (const [id, p] of now) {
        const q = prev.get(id)
        if (!q) continue
        const dx = q.x - p.x
        const dy = q.y - p.y
        if (dx || dy) {
          rootEl.querySelector<HTMLElement>(`[data-stop-id="${CSS.escape(id)}"]`)
            ?.animate(
              [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
              { duration: 240, easing: 'cubic-bezier(.22, .61, .36, 1)' },
            )
        }
      }
    }
    prevRects.current = now
  }, [ordered])

  return (
    <div className={`board-col${focused ? ' board-col--focused' : ''}`} role="listitem">
      <button type="button" className="board-col-head" onClick={() => onToggleFocus(!focused)}
        aria-pressed={focused} title={focused ? `Show the whole route again` : `Focus the map on Day ${day.index + 1}`}>
        <span className="board-col-day">Day {day.index + 1}</span>
        <span className="board-col-count">{focused ? 'Focused · ' : ''}{totalStops} stop{totalStops === 1 ? '' : 's'}</span>
        <span className="board-col-subtitle">{day.title || `Day ${day.index + 1}`}</span>
        {topWarn && <span className={`day-warn-pill ${sev === 'high' ? 'sev-high' : ''}`}>⚠ {topWarn.title.replace(/^Day \d+: /, '')}{warnings.length > 1 ? ` +${warnings.length - 1}` : ''}</span>}
      </button>

      <div className={`board-col-stops${dragging !== null ? ' is-dragging' : ''}`} ref={stopsRef}
        onDragOver={onColDragOver} onDragLeave={onColDragLeave} onDrop={onColDrop}>
        {dragging !== null && insert && (
          <div className="board-drop-marker" style={{ transform: `translateY(${insert.y}px)` }} />
        )}
        {ordered.map((s, i) => {
          const kind = stopKindOf(s)
          const isDragged = s.id === draggingId
          const meta = [
            s.locationName,
            minutesToHM(s.visitMinutes),
            s.entryFeeInrPerPerson > 0 ? `₹${s.entryFeeInrPerPerson}/person` : '',
          ].filter(Boolean).join(' · ')
          return (
            <div key={s.id}
              data-stop-id={s.id}
              title={meta ? `${s.title} — ${meta}` : s.title}
              className={`board-stop stop-card kind-${kind} status-${s.status} ${isDragged ? 'dragging' : ''} ${foreignOver === i && dragging === null ? 'foreign-over' : ''}`}
              {...(editable ? dndHandlers(i) : {})}>
              <div className="stop-main">
                <span className="board-stop-kicker">{s.departTime ? `${formatHM(s.departTime, timeFormat)} · ` : ''}{STOP_KIND_LABELS[kind]}</span>
                <span className="stop-title">{s.title}</span>
                {meta && <span className="board-stop-meta">{meta}</span>}
              </div>
            </div>
          )
        })}
        <div className={`board-col-zone${foreignOver === ordered.length && dragging === null && editable ? ' foreign-over' : ''}`}
          {...(editable ? dayDropHandlers(ordered.length) : {})}
          role="note">
          {editable ? (
            <>
              <b>＋ Add or drop a stop</b>
              <span className="small">Impact preview before saving</span>
            </>
          ) : (
            <span className="small">Day {day.index + 1}</span>
          )}
        </div>
      </div>
    </div>
  )
}