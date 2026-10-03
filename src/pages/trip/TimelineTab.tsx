// ============ Trip workspace — Timeline tab (shell) ============
// restructure Phase 3: the day surfaces live in ./timeline/ — this file keeps
// the tab state (accordion open-day, Plan/Inspect mode, StopEditor, warnings
// grouping) and composes the extracted modules. Prop-identity discipline
// (M3.3) is why handlers here are useCallback-stable.
// ============ Trip workspace — Timeline tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
// Includes DaySection, DayWeatherChip, TravelPanel, HaltPlanRow, DaySpark,
// MoveStopModal and ClampedText — the whole timeline hot path.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { InlineIcon } from '../../components/icons'
import {
  
  Eye, 
  PenLine,   TriangleAlert, 
} from 'lucide-react'
import type { Trip, ItineraryStop } from '../../data/types'
import { updateTrip, setStopStatus, useDb, currentUser, userById } from '../../store/store'
import {
  computeTotals, minutesToHM, formatInr,
  collectWarnings, buildJourney, dayRoadPolyline, groupWarnings,
} from '../../lib/engine'
import type { LegEstimate, ScheduleWarning } from '../../lib/engine'
import type { ImpactResult } from '../../lib/impact'
import { loadOpenDay, loadReviewAll, saveOpenDay, saveReviewAll } from '../../lib/uiPrefs'
import { accordionNext } from '../../lib/daySummary'
import { scrollBehavior } from '../../lib/motion'
import { toast } from '../../components/ui'
import { StopEditor, type StopFormValues } from '../../components/StopEditor'
import { RemoteEditBanner } from '../../components/RemoteEditBanner'
import { useStopConflict } from '../../components/useStopConflict'
import { stopInitialValues, stopLegContext, stopEditorKey, stopDayIndex, type StopEditorTarget } from '../../lib/stopForm'
import { useSuggestionCache } from '../../hooks/useSuggestionCache'
import { refuseWhileStaged, removeStopWithUndo } from '../../lib/mutationLifecycle'
import { kmFromStartForHit } from '../../lib/providers/hits'
import { insertStopAt, moveStopToDay, moveStopWithinDay, nextOrderInDay, pendingStopId, stopsInOrder } from '../../lib/stopOrder'
import { useTimelineMode, type TimelineMode } from './timeline/useTimelineMode'
import { PillNav } from '../../components/PillNav'
import { DaySection } from './timeline/DaySection'
import { buildDayCards, reuseDayTotals, reuseWarningGroups, type DayCards, type DayTotals } from '../../lib/dayCards'
import { insertionWhere } from '../../lib/labels'
import { canFocusDay } from '../../lib/tripFocus'
import { QuickAddStop, type QuickAddTarget } from './timeline/QuickAddStop'
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
  // #422: the leg's insertion control (which day, which slot) and the draft
  // "More details…" carries into the full editor. The seed is keyed by the
  // editor target's own reset key, so a stale draft can never seed an unrelated
  // add (a plain "+ Add" has a different key and ignores it).
  const [quickAdd, setQuickAdd] = useState<QuickAddTarget | null>(null)
  const [editorSeed, setEditorSeed] = useState<{ key: string; values: Partial<StopFormValues> } | null>(null)

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
  // #421's other axis: WHICH days are rendered, per trip — the sibling of the
  // open day above (Plan/Inspect is the global axis: what you may do). Review
  // never reads nor writes the saved open day, so the accordion you left is the
  // accordion you return to when the switch goes back to One day.
  const [reviewAll, setReviewAll] = useState(() => loadReviewAll(trip.id))
  const setReview = useCallback((on: boolean) => {
    setReviewAll(on)
    saveReviewAll(trip.id, on)
  }, [trip.id, reviewAll])
  // (TripWorkspace keys this component by trip id, so a trip switch remounts
  // it and this init re-reads the right trip — no reset effect needed.)
  // Persisted inside the updater: React may re-run updaters in dev StrictMode,
  // but saveOpenDay is idempotent so the write stays correct.
  const toggleDay = useCallback((dayIndex: number) => {
    // Review mode owns openness — every day is already open, and a per-day
    // override there would be a third openness state with nothing to persist
    // (the header's chevron is not rendered either).
    if (reviewAll) return
    setOpenDayIndex(prev => {
      const next = accordionNext(prev, dayIndex)
      saveOpenDay(trip.id, next)
      return next
    })
  }, [trip.id, reviewAll])
  /** Open without toggling (jump rail, + Add here) — no-op when already open. */
  const openDay = useCallback((dayIndex: number) => {
    // No-op in review: the day is already on screen, and opening it would
    // write the accordion pref the mode promised not to touch.
    if (reviewAll) return
    setOpenDayIndex(prev => {
      if (prev === dayIndex) return prev
      saveOpenDay(trip.id, dayIndex)
      return dayIndex
    })
  }, [trip.id, reviewAll])

  // #347: the handlers below close over `applyChange` and `trip` — both
  // re-created on every trip change — so their identities flipped on every edit
  // and handed every day card a brand-new prop set. This latest-value ref keeps
  // the IDENTITIES stable while each body still runs against the current pair.
  const latest = useRef({ applyChange, trip })
  latest.current = { applyChange, trip }

  /** THE add commit (#422): ONE write path for a new stop, whether it came from
   *  the inspector editor or the leg's quick add. `position` is the slot the
   *  user picked (the row the stop goes before); absent means append, which is
   *  what the header's + and the day's own "+ Add stop" have always meant. The
   *  insert renumbers the day 1..n, so a later add cannot mint a duplicate
   *  order (#337) — and #424's lifecycle rewrite has one call site to move.
   *  `announce` runs only when the change is KEPT, so it can never claim a stop
   *  the user discarded at the impact sheet. */
  const commitNewStop = useCallback((dayIndex: number, position: number | undefined, values: StopFormValues, announce?: string) => {
    const { legFromSource: _drop, ...fields } = values
    latest.current.applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)
      if (!day) return
      insertStopAt(day, { ...(fields as unknown as ItineraryStop), id: pendingStopId(), orderInDay: 0 }, position ?? day.stops.length)
    }, 'add', dayIndex, announce ? () => toast(announce) : undefined)
  }, [])

  /** #422: the leg's insertion control — remember the slot it was opened on. */
  const handleInsertHere = useCallback((dayIndex: number, slot: number) => {
    setQuickAdd({ dayIndex, slot })
  }, [])

  /** The quick add's commit — the SAME add path the editor's add branch uses,
   *  with the slot the control was opened on, and an announcement that fires only
   *  once the stop is actually kept. */
  const handleQuickAdd = useCallback((dayIndex: number, slot: number, values: StopFormValues) => {
    setQuickAdd(null)
    const { trip } = latest.current
    const day = trip.days.find(d => d.index === dayIndex)
    const ordered = day ? stopsInOrder(day) : []
    const where = insertionWhere(ordered[slot - 1]?.title, ordered[slot]?.title)
    commitNewStop(dayIndex, slot, values, `“${values.title}” inserted ${where} on Day ${dayIndex + 1}`)
  }, [commitNewStop])

  /** "More details…": the same draft, the same slot, in the full editor. */
  const handleQuickAddMore = useCallback((dayIndex: number, slot: number, values: StopFormValues) => {
    setQuickAdd(null)
    setEditorSeed({ key: stopEditorKey({ mode: 'add', dayIndex, position: slot }), values })
    openEditorState({ mode: 'add', dayIndex, position: slot })
  }, [openEditorState])

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
      // The slot rides on the target (#422): the leg's control knew where the
      // stop belongs, and "More details…" carries the same slot here.
      commitNewStop(editorState.dayIndex, editorState.position, v)
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
    setEditorSeed(null)
  }

  // Deletions go through the impact-preview flow (Keep / Remove confirm the
  // destructive step) AND leave a way back (#337). Since #424 this is not the
  // Timeline's own sequence: `removeStopWithUndo` is THE destructive-stop path,
  // shared with the Board card and the map pin, so the same delete cannot offer
  // different recovery depending on where it was clicked.
  const handleDelete = useCallback((stopId: string, dayIndex: number) => {
    const { applyChange, trip } = latest.current
    removeStopWithUndo({ trip, stopId, dayIndex, applyChange })
  }, [])

  const handleMoveWithinDay = useCallback((fromIdx: number, toIdx: number, dayIndex: number) => {
    latest.current.applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)
      // The shared helper carries the store sibling's guards — clamp (an OOB
      // splice inserts `undefined`), from===to no-op, missing stop (#337).
      if (day) moveStopWithinDay(day, fromIdx, toIdx)
    }, 'reorder', dayIndex)
  }, [])

  /** Optimise-day commit: replace a day's stop order wholesale (ids), keeping
   *  every stop — the reorder goes through the same impact-preview gate as a
   *  manual drag. It is a FULL-array rewrite that renumbers 1..n, so it has no
   *  from/to splice to make — the same invariant as lib/stopOrder's helpers. */
  const handleReorderDay = useCallback((dayIndex: number, orderedIds: string[]) => {
    latest.current.applyChange(draft => {
      // #563 — a stale dayIndex (a drag payload snapshot, or a click on a
      // button rendered before reconcileDays shrank the days) must REFUSE, not
      // crash: the proposal then equals the base and the impact sheet reads
      // zero-delta.
      const day = draft.days.find(d => d.index === dayIndex)
      if (!day) { toast('That day is no longer on this trip.', 'err'); return }
      const byId = new Map(day.stops.map(s => [s.id, s]))
      const reordered = orderedIds.map(id => byId.get(id)!).filter(Boolean)
      // any stop the optimizer left out (safety net) rides at the end
      const rest = day.stops.filter(s => !orderedIds.includes(s.id))
      day.stops = [...reordered, ...rest]
      day.stops.forEach((s, i) => { s.orderInDay = i + 1 })
    }, 'reorder', dayIndex)
  }, [])

  /** Cross-day drag: lift a stop out of its day and insert it at `position` of `toDayIndex`. */
  const handleMoveStopInto = useCallback((stopId: string, _fromDayIndex: number, toDayIndex: number, position: number) => {
    const { applyChange, trip } = latest.current
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
  }, [])

  // Warnings grouped by the day they belong to — powers the per-day
  // progress-bar colour, the day pills and the trip-wide block. Identity comes
  // from the engine's `dayIndex`, never from parsing `title` (a display
  // string): the old regex misfiled every warning with no “Day N:” prefix
  // (opening hours lead with a stop title) and silently DROPPED the trip-wide
  // accommodation one (#402).
  const warningsCache = useRef<Map<number, ScheduleWarning[]> | null>(null)
  const { dayWarnings, tripWideWarnings, warnDayCount } = useMemo(() => {
    const { byDay, tripWide } = groupWarnings(collectWarnings(trip))
    // #347: `groupWarnings` mints a fresh array for every warned day on every
    // trip change — content-equal, ref-different, which re-rendered those days.
    // NO_WARNINGS above only ever saved the days with nothing to warn about.
    const stable = reuseWarningGroups(warningsCache.current, byDay)
    warningsCache.current = stable
    return { dayWarnings: stable, tripWideWarnings: tripWide, warnDayCount: byDay.size }
  }, [trip])
  // M4: sticky trip-total strip (doc §6.3) — same engine numbers as Overview.
  const totals = useMemo(() => computeTotals(trip, legCorrections), [trip, legCorrections])
  // computeTotals().byDay mints a fresh object per day on any change, and that
  // object is a day card's cost chip — its identity has to survive (#347).
  const totalsCache = useRef<Map<number, DayTotals> | null>(null)
  const totalsByDay = useMemo(() => {
    const stable = reuseDayTotals(totalsCache.current, totals.byDay ?? [])
    totalsCache.current = stable
    return stable
  }, [totals])

  // #347: every day's trip-wide slice, resolved ONCE per trip change and reused
  // per day while that day's own inputs are unchanged — so one stop edit
  // re-renders that card (plus, deliberately, the open one, whose travel panel
  // searches against the whole itinerary) instead of all of them.
  const cardsCache = useRef<DayCards | null>(null)
  const cards = useMemo(() => {
    const next = buildDayCards(trip, days, legCorrections, cardsCache.current)
    cardsCache.current = next
    return next
  }, [trip, days, legCorrections])

  // ---- Review mode's viewport gate (#421) ----
  // In review every day is open, so without a gate the first render would hand
  // every card a live trip (which is what mounts its travel panel) and fire one
  // weather fetch + one nearby search per day — exactly the pitfall #421 names:
  // provider data must not be fetched for days merely because they are visible.
  // ONE observer over the day cards, with a generous rootMargin so a day warms
  // just before it arrives. The flag decides provider-backed extras only — what
  // a day shows from its own resolved facts is never gated by it.
  const [visibleDays, setVisibleDays] = useState<ReadonlySet<number>>(() => new Set<number>())
  const dayIndexSig = days.map(d => d.index).join(',')
  useEffect(() => {
    if (!reviewAll || typeof IntersectionObserver === 'undefined') {
      setVisibleDays(prev => (prev.size ? new Set<number>() : prev))
      return
    }
    const nodes: Array<[HTMLElement, number]> = []
    for (const part of dayIndexSig.split(',')) {
      if (!part) continue
      const idx = Number(part)
      const el = document.getElementById(`day-card-${idx}`)
      if (el) nodes.push([el, idx])
    }
    if (nodes.length === 0) return
    const indexOf = new Map<HTMLElement, number>(nodes)
    const observer = new IntersectionObserver(entries => {
      setVisibleDays(prev => {
        let next: Set<number> | null = null
        for (const e of entries) {
          const idx = indexOf.get(e.target as HTMLElement)
          if (idx == null || e.isIntersecting === prev.has(idx)) continue
          if (!next) next = new Set(prev)
          if (e.isIntersecting) next.add(idx)
          else next.delete(idx)
        }
        return next ?? prev
      })
    }, { rootMargin: '600px 0px' })
    for (const [el] of nodes) observer.observe(el)
    return () => observer.disconnect()
  }, [reviewAll, dayIndexSig])

  // Which day the rail marks as you read (#421). The rail is the mode's own
  // orientation — the day whose card has scrolled past the sticky line — and it
  // exists so the DAY HEADER can stay in flow: measured, a header carrying the
  // day's clocks, chips, warnings and actions is 193–309px tall, which is a
  // control panel, not a label to stick to the viewport.
  const [currentDay, setCurrentDay] = useState<number | null>(null)
  useEffect(() => {
    if (!reviewAll) { setCurrentDay(null); return }
    const line = 12 + 62 + 10 // the rail's own sticky offset (nav + gap)
    let raf = 0
    const measure = () => {
      raf = 0
      let best: number | null = null
      for (const part of dayIndexSig.split(',')) {
        if (!part) continue
        const idx = Number(part)
        const el = document.getElementById(`day-card-${idx}`)
        if (!el) continue
        if (el.getBoundingClientRect().top - line <= 1) best = idx
      }
      setCurrentDay(best)
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure) }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [reviewAll, dayIndexSig])

  /** Where the header's generic "+ Add stop" lands: the day you are in (the
   *  accordion), or — in review, where no single day is "the" day — the first
   *  day actually on screen. Day 1 is the last resort, as it always was. */
  const addTargetDay = reviewAll
    ? (visibleDays.size ? Math.min(...visibleDays) : 0)
    : (openDayIndex >= 0 ? openDayIndex : 0)

  /** Day-jump rail: open the day (accordion) and scroll a long timeline
   *  straight to its card. */
  function jumpToDay(dayIndex: number) {
    // In review the day is already open: this is pure scroll navigation and
    // openDay is a no-op, so the rail stays meaningful without writing the
    // accordion pref the mode promised not to touch.
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
    // #425 PR 1: the consume gate is the shared contract's validator (same
    // rule the workspace applies when RAISING the request — a value no day
    // matches is refused, never clamped, and still consumed).
    if (!canFocusDay({ dayIndex: focusDay }, trip)) {
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
    if (refuseWhileStaged(previewOpen)) return
    const { trip } = latest.current
    updateTrip(trip.id, { days: trip.days.map(d => d.index === dayIndex ? { ...d, title: title.trim() || undefined } : d) })
    toast('Day renamed')
  }, [previewOpen])

  /** Duplicate this day's stops onto the next day (base-camp style planning). */
  const handleCopyDay = useCallback((dayIndex: number) => {
    latest.current.applyChange(draft => {
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
  }, [])

  /** One-click add from the empty-day suggestions (route continuation / nearby POI). */
  const handleAddQuickStop = useCallback((dayIndex: number, stop: Omit<ItineraryStop, 'id' | 'orderInDay'>) => {
    latest.current.applyChange(draft => {
      // #563 — refuse a stale dayIndex, never crash (same as the reorder guard).
      const day = draft.days.find(d => d.index === dayIndex)
      if (!day) { toast('That day is no longer on this trip.', 'err'); return }
      day.stops.push({ ...stop, id: pendingStopId(), orderInDay: nextOrderInDay(day) })
    }, 'add', dayIndex)
  }, [])

  /** Ride start time for a day — a lightweight plan field, applied directly (like rename). */
  const handleSetDayStart = useCallback((dayIndex: number, time: string) => {
    // #334: direct write, same race as the rename — blocked while previewing.
    if (refuseWhileStaged(previewOpen)) return
    const { trip } = latest.current
    updateTrip(trip.id, { days: trip.days.map(d => d.index === dayIndex ? { ...d, startTime: time || undefined } : d) })
    toast(time ? `Day ${dayIndex + 1} now starts ${time}` : 'Ride start reset to the default')
  }, [previewOpen])

  /** Insert a batch of long-ride break halts, each at a user-chosen km point, ordered by
      distance along the route so the arrival clock and map reflect true stop order. Impact
      preview applies the whole-day change. */
  const handleAddPlannedHalts = useCallback((dayIndex: number, halts: { km: number; stop: Omit<ItineraryStop, 'id' | 'orderInDay'> }[]) => {
    if (halts.length === 0) return
    latest.current.applyChange(draft => {
      // #563 — refuse a stale dayIndex, never crash (same as the reorder guard).
      const day = draft.days.find(d => d.index === dayIndex)
      if (!day) { toast('That day is no longer on this trip.', 'err'); return }
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
  }, [legCorrections])

  const handleStatus = useCallback((stop: ItineraryStop, status: ItineraryStop['status']) => {
    // Status flips are lightweight group signals — applied directly to the
    // committed row, so #334 refuses them while a preview is open: the flip
    // would land on the cache, and Keep would then write the proposal the
    // preview was built from, silently reverting it.
    if (refuseWhileStaged(previewOpen)) return
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
    <div className={reviewAll ? 'tl-root-review' : undefined}>
      <div className="row-between" style={{ marginBottom: 16 }}>
        <div className="tl-head-copy">
          <h2>Day-by-day timeline</h2>
          {/* key={mode} crossfades the copy; min-height in CSS reserves the
              two-line block so switching modes never shifts the layout. */}
          <p key={mode} className="muted small tl-mode-copy">{mode === 'plan'
            ? 'Drag stops to reorder within a day — or drop them onto another day to move them there. On touch devices: press and hold a stop, then drag it. Every change shows its impact before saving.'
            : 'Read-only study view — clocks, costs and risks without the edit handles. Switch to Plan mode to make changes.'}</p>
        </div>
        {/* The tools row renders for read-only viewers too (#421): the view
            switch is a reading aid, so gating it on being an editor would hide
            it exactly where reviewing matters most. */}
        <div className="row tl-head-tools" style={{ gap: 8 }}>
          {editable && (
          <>
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
          </>
          )}
          {/* Which days are rendered (#421) — per trip, saved beside the trip's
              own view prefs. Two pillbars on purpose: Plan/Inspect answers "what
              may I do" (a global capability), this answers "which days am I
              looking at", and folding the two together would take editing away
              from the reviewer who just spotted something to fix. */}
          <PillNav className="view-pillbar" role="group" aria-label="Days shown" activeKey={reviewAll ? 'all' : 'one'}>
            <button type="button" data-pill-key="one" className={`tab-btn${reviewAll ? '' : ' active'}`}
              onClick={() => setReview(false)} aria-pressed={!reviewAll}
              title="One day at a time — the accordion, and the day you were last in">One day</button>
            <button type="button" data-pill-key="all" className={`tab-btn${reviewAll ? ' active' : ''}`}
              onClick={() => setReview(true)} aria-pressed={reviewAll}
              title="Every day expanded in order, each day's header following you down">All days</button>

          </PillNav>
          {editable && (
          <>
          {/* Stays rendered in both modes (disabled + dimmed in Inspect) so
              toggling never reflows the header — that reflow was the jerk. */}
          <button className="btn btn-primary btn-sm" disabled={mode !== 'plan'}
            title={mode !== 'plan' ? 'Switch to Plan mode to edit' : undefined}
            onClick={() => openEditorState({ mode: 'add', dayIndex: addTargetDay })}>+ Add stop</button>
          </>
          )}
        </div>
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

      {/* #421: in review the rail is the mode's navigation, so it appears for
          any trip length — and it marks the day you are in as you scroll. */}
      {(days.length >= 4 || reviewAll) && (
        <div className="day-rail" role="navigation" aria-label="Jump to day">
          <span className="day-rail-label">Jump to day</span>
          <div className="day-rail-chips">
            {days.map(d => {
              const hasWarn = (dayWarnings.get(d.index)?.length ?? 0) > 0
              const current = reviewAll && currentDay === d.index
              return (
                <button key={d.id} type="button" className={`day-rail-chip ${hasWarn ? 'warn' : ''}`}
                  aria-current={current ? 'true' : undefined}
                  onClick={() => jumpToDay(d.index)}>
                  Day {d.index + 1}{hasWarn && <InlineIcon icon={TriangleAlert} size={11} gap={0} vAlign="-1px" style={{ marginLeft: 3 }} />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {days.map(day => (
        <DaySection key={day.id} day={day} trip={openDayIndex === day.index || (reviewAll && visibleDays.has(day.index)) ? trip : undefined} facts={cards.byDay.get(day.index)!} editable={planEditable} open={reviewAll || openDayIndex === day.index} reviewMode={reviewAll} inView={!reviewAll || visibleDays.has(day.index)} onToggleOpen={toggleDay} onInsertHere={handleInsertHere} legCorrections={legCorrections} suggestionCache={suggestionCache} dayTotals={totalsByDay.get(day.index)}
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
          warnings={dayWarnings.get(day.index) ?? NO_WARNINGS}
          onStatus={handleStatus}
        />
      ))}

      <StopEditor
        open={!!editorState}
        onClose={() => { setEditorState(null); setEditorSeed(null); conflictState.clearConflict() }}
        initial={editorSeed && editorSeed.key === stopEditorKey(editorState) ? editorSeed.values : stopInitialValues(editorState, trip)}
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

      {/* #422: the leg's insertion control opens this lightweight first step;
          "More details…" continues into the StopEditor above with the same day
          and slot. Both committers are the same add path. */}
      <QuickAddStop
        target={quickAdd}
        trip={trip}
        onClose={() => setQuickAdd(null)}
        onAdd={handleQuickAdd}
        onMore={handleQuickAddMore}
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
