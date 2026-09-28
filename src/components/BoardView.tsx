// ============ Board — spatial group coordination (Calm Travel Intelligence §6.4) ============
// A supplementary planning mode: the route stays visible on a pinned map while
// day columns float above it for kanban-style cross-day rearrangement. Every
// change routes through the same applyChange → impact-preview flow as the
// Timeline, so nothing persists without its consequence visible first.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, ChevronDown, ChevronUp, CircleCheck, CircleHelp, Loader2, LocateFixed, Map as MapIcon,
  MoveHorizontal, Plus, RefreshCw, Trash2, TriangleAlert,
} from 'lucide-react'
import { prefersReducedMotion } from '../lib/motion'
import {
  activeStopsInOrder, moveActiveStopWithinDay, moveStopToDay, nextOrderInDay,
  pendingStopId,
} from '../lib/stopOrder'
import { InlineIcon, KindIcon } from './icons'
import type { Trip, ItineraryStop } from '../data/types'
import { computeTotals, computeHealth, collectWarnings, minutesToHM, formatInr, buildJourney, dayRoadPolyline, isRoadMeasuredMode } from '../lib/engine'
import type { ScheduleWarning, LegEstimate } from '../lib/engine'
import { mapReturnGeometryFromLegs, mapRoadViewFromLegs, type TripRoadView } from '../lib/tripRoad'
import type { ImpactResult } from '../lib/impact'
import { useTimeFormat, formatHM } from '../lib/timefmt'
import { stopKindOf, STOP_KIND_LABELS } from '../lib/stopKind'
import { stopInitialValues, stopLegContext, stopEditorKey, stopDayIndex, type StopEditorTarget } from '../lib/stopForm'
import { setStopStatus, useDb } from '../store/store'
import { useReorder, Modal, toast } from './ui'
import { refuseWhileStaged, removeStopWithUndo } from '../lib/mutationLifecycle'
import { healthBandClass } from '../lib/healthBand'
import { warningDigest, warningLines, worstSeverity } from '../lib/warningDigest'
import { isAlreadyAdded, placeIdentity } from '../lib/placeIdentity'
import { kmFromStartForHit } from '../lib/providers/hits'
import { glideOffsetPx, insertionIndexFor, rowLayoutBoxes, cancelRowSettle, cancelListSettles, settleRow } from '../lib/touchDnd'
import { TripMap } from './TripMap'
import { StopEditor, type StopFormValues } from './StopEditor'
import { useStopConflict } from './useStopConflict'
import { RemoteEditBanner } from './RemoteEditBanner'

/** One shared empty list: `?? []` in a prop position mints a NEW array every
 *  render and would defeat the column memo (#372). */
const NO_WARNINGS: ScheduleWarning[] = []
/** The map is the heaviest child of the board and reads only trip + focus —
 *  memoized so a drag, the editor opening or the map-focus toggle cannot
 *  re-render it (#372). */
const MemoTripMap = React.memo(TripMap)

export function BoardView({ trip, editable, applyChange, health, totals, onOpenOverview, legCorrections, previewOpen, road }: {
  trip: Trip
  editable: boolean
  /** The 4th argument is the follow-up a staged change runs once the user KEEPS
   *  it (delete → Undo) — the same shape the Timeline and the Map pass (#372). */
  applyChange: (mutator: (d: Trip) => void, kind: ImpactResult['kind'], dayIndex: number, onKept?: () => void) => void
  health: ReturnType<typeof computeHealth>
  totals: ReturnType<typeof computeTotals>
  onOpenOverview: () => void
  /** The workspace's road measurement — the move dialog inserts by ROAD order
   *  with it, the same chain the Timeline's dialog uses. */
  legCorrections?: Record<string, LegEstimate>
  /** True while an impact preview is open. Staged board edits CHAIN onto it
   *  (#334); the one direct writer on this surface — the stop status flip —
   *  refuses with the shared message, exactly like the Timeline's. */
  previewOpen?: boolean
  /** The workspace's ONE road measurement (#188/#370). The board's map draws
   *  the SAME line as the Map tab — start leg, every stop, the drive home and
   *  the destination tail — instead of self-measuring a shorter stops-only road
   *  while its own figures come from the full chain. */
  road?: TripRoadView
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
      one cannot keep a stale or duplicated number (#371). Stable identity so
      the column memo below bites on interactive re-renders (#372). */
  const reorderWithinDay = useCallback((dayIndex: number, fromIdx: number, toIdx: number) => {
    applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)
      if (day) moveActiveStopWithinDay(day, fromIdx, toIdx)
    }, 'reorder', dayIndex)
  }, [applyChange])

  // Warnings on the engine's OWN identity (#369): grouped by `dayIndex`, never
  // by parsing a title. The digest counts WARNINGS — not days — and reserves
  // “overloaded” for days the engine actually calls over-full; the old regex
  // dropped opening-hours, commitment and hotel warnings entirely.
  const warn = useMemo(() => {
    const warnings = collectWarnings(trip)
    return { ...warningDigest(warnings), lines: warningLines(warnings) }
  }, [trip])

  const openDecisions = db.decisions.filter(d => d.tripId === trip.id && d.status === 'open').length
  const optionalExpenses = trip.expenses.filter(e => e.optional).length
  /** Board adds run through the ONE “already added” predicate (#345/#372) —
   *  the identity the rail, the tray, the slots and the map pins already use. */
  const identity = useMemo(() => placeIdentity(trip), [trip])

  // #370: the Board draws the workspace's chain through the SAME two derivations
  // the Map tab uses — `mapRoadViewFromLegs` for the outbound line (plus a
  // one-way destination tail) and `mapReturnGeometryFromLegs` for the drive home
  // — so one trip cannot have two roads: the Board's line used to stop at its
  // stops while its own numbers described the full chain. Self-measurement stays
  // off: the workspace is the single measurement (#188/#323), and what the two
  // surfaces draw is graded identically (`routeDrawGrade` in TripMap).
  const roadView = useMemo(
    () => mapRoadViewFromLegs(road?.chain ?? null, road?.legs ?? null, trip.days.map(d => d.index)),
    [road, trip.days],
  )
  const mapReturnGeometry = useMemo(
    () => mapReturnGeometryFromLegs(road?.chain ?? null, road?.legs ?? null),
    [road],
  )
  /** The road did not resolve (or is being re-measured after a failed attempt)
   *  AND this trip is actually driven: the map's line is graded rough, and the
   *  board's budget/health figures are haversine estimates — said out loud here
   *  rather than left to be discovered (#370). Conducted modes (train/flight/
   *  bus) are excluded: no road was ever theirs. The retry note stays up while
   *  a manual retry is in flight: a gate keyed on `failed` alone would blink
   *  the honest note off the moment the retry flipped status to pending, and
   *  nothing else on this surface says the figures are estimates.
   *  (#road-retry: the measurement offers a retry — it existed on the road
   *  view since #188 but no surface consumed it.) */
  const roadUnmeasured = !!trip.transportMode && isRoadMeasuredMode(trip.transportMode)
    && (road?.status === 'failed' || road?.status === 'pending')
  const roadRetrying = road?.status === 'pending'

  /** Cross-day move — the shared stopOrder rule, and every Board mutation
      previews. The drag passes its own insertion slot; the move dialog passes
      none, so the stop lands by ROAD order instead of being appended — the
      same rule the Timeline's dialog follows. A day that has since vanished
      refuses with a message, never a silent drop. */
  const handleMoveStopInto = useCallback((stopId: string, _fromDayIndex: number, toDayIndex: number, position: number | null) => {
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
  }, [applyChange, trip.days, legCorrections])

  /** The same destructive-stop path as the Timeline's handleDelete (#424):
      `removeStopWithUndo` stages the removal so Keep/Remove is the confirmation
      step, and the Keep moment leaves an Undo that puts the captured stop back
      where it was — the stop is captured BEFORE staging, since the cache drops
      it the moment Keep writes (#337/#372). */
  const handleDelete = useCallback((stopId: string, dayIndex: number) => {
    removeStopWithUndo({ trip, stopId, dayIndex, applyChange })
  }, [applyChange, trip])

  /** Status flips are the same lightweight GROUP signal the Timeline offers —
   *  applied straight to the committed row (never staged into the preview), so
   *  #334 refuses them while a preview is open: the flip would land on the
   *  cache, and Keep would then write the proposal the preview was built from,
   *  silently reverting it. Documented here because it is deliberate. */
  const handleStatus = useCallback((stop: ItineraryStop, status: ItineraryStop['status']) => {
    if (refuseWhileStaged(previewOpen)) return
    setStopStatus(trip.id, status, stop.id)
    toast(`“${stop.title}” marked ${status === 'needs-booking' ? 'needs booking' : status}`)
  }, [trip.id, previewOpen])

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
  /** Stable per-column callbacks (#372): the column receives these by
   *  reference, so opening the editor or dragging one card does not re-render
   *  its siblings. */
  const handleAdd = useCallback((dayIndex: number) => openEditorTarget({ mode: 'add', dayIndex }), [openEditorTarget])
  const handleEdit = useCallback((stopId: string) => openEditorTarget({ mode: 'edit', stopId }), [openEditorTarget])
  const toggleDayFocus = useCallback((dayIndex: number) => {
    setFocusedDay(prev => prev === dayIndex ? 'all' : dayIndex)
  }, [])

  const handleSave = useCallback((v: StopFormValues) => {
    if (!editorTarget) return
    const { legFromSource: _drop, ...legFields } = v
    if (editorTarget.mode === 'add') {
      const dayIndex = editorTarget.dayIndex
      // #372 · dedupe through the shared predicate with the same words the map
      // uses, so an add cannot mint a second copy of a place already planned.
      // The editor stays OPEN on a refusal — the fix is to change the title,
      // and closing it would throw the typed stop away.
      if (isAlreadyAdded({ name: v.title, placeId: v.placeId }, identity)) {
        toast(`“${v.title}” is already in your trip.`)
        return
      }
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
  }, [editorTarget, applyChange, trip, identity])

  const fitToTrip = useCallback(() => setFocusedDay('all'), [])
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
            <button className="btn btn-primary btn-sm" onClick={() => handleAdd(focusedDay === 'all' ? 0 : focusedDay)}>
              <InlineIcon icon={Plus} size={13} gap={4} />Add a stop
            </button>
          </div>
        )}
      </div>

      <div className="board">
        {/* pinned route map — the existing component, no second map system (§8 guardrail) */}
        <div className="board-map">
          <MemoTripMap trip={trip} focusDay={focusedDay} showToolbar={false}
            mainRouteGeometry={roadView.geometry} returnRouteGeometry={mapReturnGeometry}
            allowSelfMeasurement={false} />
        </div>

        {/* floating info card (normal-flow top bar above the columns; the map still
            paints behind everything, so nothing can cover a column) */}
        <div className="board-topbar">
          <div className="glass board-info">
            <b>Plan by day, see the route</b>
            <span className="small muted" style={{ display: 'block', marginTop: 3 }}>
              Drag a stop to another day — its impact previews before saving. Click a column to focus its route.
            </span>
            {roadUnmeasured && (
              <span className="small" style={{ display: 'block', marginTop: 3 }}>
                <InlineIcon icon={TriangleAlert} size={12} gap={3} />
                {roadRetrying
                  ? 'Measuring the road… — until it resolves, the line and figures stay estimates.'
                  : 'Road not measured — the map\'s line and this board\'s figures are estimates.'}
              </span>
            )}
            {roadUnmeasured && !roadRetrying && road && (
              <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 4 }}
                onClick={road.retry}
                title="Ask the routing provider again — the first tries may have been rate-limited">
                <InlineIcon icon={RefreshCw} size={12} gap={4} />Retry road measurement
              </button>
            )}
            <button type="button" className="board-fit" onClick={fitToTrip}><InlineIcon icon={LocateFixed} size={13} gap={4} />Fit route</button>
          </div>

          {/* Trip Pulse — health, decisions, budget (doc §6.4) */}
          <div className="glass board-pulse">
            <span className="pulse-label">Trip pulse</span>
            <div className="board-pulse-row">
              {/* Colour from the BAND the engine stated, never from score cuts
                  re-invented here: the old `>=70 ok | >=40 mid` painted a
                  45-point “Unrealistic” trip in reassuring blue (#369). */}
              <b className={`health-num-big ${healthBandClass(health.band)}`}>
                {health.score}
              </b>
              <span className={`board-pulse-band ${healthBandClass(health.band)}`}>
                {health.band}{warn.total > 0 ? ' — needs attention' : ''}
              </span>
            </div>
            <div className="health-bar" aria-hidden="true">
              <i className={healthBandClass(health.band)} style={{ width: `${Math.max(4, health.score)}%` }} />
            </div>
            <div className="board-pulse-lines">
              {/* Every warning counts here — day-scoped and trip-wide — and
                  “overloaded” is said only for days the engine calls over-full
                  (density / fatigue / travel). */}
              {warn.total > 0 && <span title={warn.lines}><InlineIcon icon={TriangleAlert} size={12} gap={3} />{warn.summary}</span>}
              {/* Warnings that belong to no day (accommodation churn) need a
                  home of their own — they used to be dropped on the floor. */}
              {warn.tripWide.length > 0 && (
                <span title={warningLines(warn.tripWide)}>
                  <InlineIcon icon={TriangleAlert} size={12} gap={3} />{warn.tripWide[0].title}{warn.tripWide.length > 1 ? ` +${warn.tripWide.length - 1}` : ''}
                </span>
              )}
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
              warnings={warn.byDay.get(day.index) ?? NO_WARNINGS}
              focused={focusedDay === day.index}
              onToggleFocus={toggleDayFocus}
              onMoveStopIn={handleMoveStopInto}
              onReorder={reorderWithinDay}
              onDelete={handleDelete}
              onStatus={handleStatus}
              onAdd={handleAdd}
              onEdit={handleEdit} />
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
// React.memo (#372): the Board re-renders on every interaction (a drag's
// insertion slot, the editor opening, the focus toggle), and unmemoized columns
// meant all of them plus the embedded map re-rendered for each. The props are
// now stable between commits — one shared NO_WARNINGS array, useCallback'd
// handlers, booleans and the day object itself (immutable between writes) — so
// a column bails out unless ITS day, focus or warnings changed. The map is
// memoized separately above.
const BoardColumn = React.memo(function BoardColumn({ day, allDays, editable, warnings, focused, onToggleFocus, onMoveStopIn, onReorder, onDelete, onStatus, onAdd, onEdit }: {
  day: Trip['days'][number]
  allDays: Trip['days']
  editable: boolean
  warnings: ScheduleWarning[]
  focused: boolean
  onToggleFocus: (dayIndex: number) => void
  onMoveStopIn: (stopId: string, fromDay: number, toDay: number, position: number | null) => void
  onReorder: (dayIndex: number, fromIdx: number, toIdx: number) => void
  onDelete: (stopId: string, dayIndex: number) => void
  onStatus: (stop: ItineraryStop, status: ItineraryStop['status']) => void
  onAdd: (dayIndex: number) => void
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

  /** The pill's class comes from the warnings' OWN worst severity (#369) — and
   *  a low-only day gets `sev-low`, the quiet variant, instead of the base
   *  amber tint that made a route-backtracking note as loud as an over-packed
   *  day. The title carries every warning, so none is silently dropped. */
  const sev = worstSeverity(warnings)
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
      <button type="button" className="board-col-head" onClick={() => onToggleFocus(day.index)}
        aria-pressed={focused} title={focused ? `Show the whole route again` : `Focus the map on Day ${day.index + 1}`}>
        <span className="board-col-day">Day {day.index + 1}</span>
        <span className="board-col-count">{focused ? 'Focused · ' : ''}{totalStops} stop{totalStops === 1 ? '' : 's'}</span>
        <span className="board-col-subtitle">{day.title || `Day ${day.index + 1}`}</span>
        {sev && <span className={`day-warn-pill sev-${sev}`} title={warningLines(warnings)}><InlineIcon icon={TriangleAlert} size={12} gap={3} />{warnings[0].title.replace(/^Day \d+:\s*/, '')}{warnings.length > 1 ? ` · +${warnings.length - 1} more` : ''}</span>}
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
                  <span className="board-stop-kicker">{s.departTime ? `${formatHM(s.departTime, timeFormat)} · ` : ''}<KindIcon kind={kind} size={12} />{STOP_KIND_LABELS[kind]}</span>
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
                        <ChevronUp size={13} aria-hidden />
                      </button>
                      <button type="button" className="move-btn" disabled={i === ordered.length - 1}
                        onClick={() => onReorder(day.index, i, i + 1)} aria-label={`Move ${s.title} down`}>
                        <ChevronDown size={13} aria-hidden />
                      </button>
                    </div>
                    {allDays.length > 1 && (
                      <button type="button" className="move-btn" onClick={() => setMoveStop(s)}
                        title="Move to another day" aria-label={`Move ${s.title} to another day`}>
                        <MoveHorizontal size={13} aria-hidden />
                      </button>
                    )}
                    {/* Status rides the same lightweight group signal the
                        Timeline offers (confirmed ⇄ maybe) — previously the
                        only way to set it was to leave the Board (#372). */}
                    {s.status === 'confirmed'
                      ? <button type="button" className="move-btn" onClick={() => onStatus(s, 'maybe')}
                        title={`Mark ${s.title} maybe`} aria-label={`Mark ${s.title} maybe`}>
                        <CircleHelp size={13} aria-hidden />
                      </button>
                      : <button type="button" className="move-btn" onClick={() => onStatus(s, 'confirmed')}
                        title={`Mark ${s.title} confirmed`} aria-label={`Mark ${s.title} confirmed`}>
                        <CircleCheck size={13} aria-hidden />
                      </button>}
                    <button type="button" className="move-btn move-btn--danger"
                      onClick={() => onDelete(s.id, day.index)}
                      title={`Delete ${s.title} — you'll see the impact first; Undo is offered after Keep`}
                      aria-label={`Delete ${s.title}`}>
                      <Trash2 size={13} aria-hidden />
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
            onClick={() => onAdd(day.index)}
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
})