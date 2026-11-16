// ============ Trip workspace — Map tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { InlineIcon, CatIcon } from '../../components/icons'
import { BedDouble, ChevronDown, ChevronLeft, ChevronRight, Coffee, Fuel, Lightbulb, Pause, Plus, RefreshCw, RotateCcw, Sparkles, Utensils, Route, PanelLeftOpen, PanelRightOpen, Clock } from 'lucide-react'
import type { Trip } from '../../data/types'
import { removeStopWithUndo, type ApplyChange } from '../../lib/mutationLifecycle'
import { mapRoadViewFromLegs, mapReturnGeometryFromLegs, outboundLegs, type TripRoadView } from '../../lib/tripRoad'
import type { WriterRoadBinding } from './map/writerRoadBinding'
import { buildJourney, type JourneyPoint, minutesToHM, hmToMinutes, fmtDur, computeCategoryBias, MODE_SPEED, isRoundTrip, isAirMode, tripJourneyGeometry, legBetween, getAssumptions, originOf, type LegEstimate } from '../../lib/engine'
import { useTimeFormat, formatClocksInText, formatHM, formatHMRange, validHM } from '../../lib/timefmt'
import type { MapTarget } from '../../lib/mapTarget'
import { loadFlag, saveFlag, loadPref, savePref, loadHaltPinsForTrip, saveHaltPin, clearHaltPin, clearHaltPinsForTrip } from '../../lib/uiPrefs'
import { DEBOUNCE_MS } from '../../lib/geocode'
import { Modal, Field, toast, undoToast, useMedia } from '../../components/ui'
import { usePresence } from '../../hooks/usePresence'
import { Select } from '../../components/Select'
import { DetourWhisk } from '../../components/DetourWhisk'
import { useSuggestionCache } from '../../hooks/useSuggestionCache'
import { openExternal } from '../../lib/native'
import { corridorAnchors, asymmetricDetourKm, asymmetricDetourMinutes, googleEnabled, reasonForSegmentHit, searchPlacesText, kmFromStartForHit, deriveDrivingPlan, effectiveDrivingDays, anchorsForCrew, rainFactorFor, directionalKm, alongRouteKmOf, DEFER_START, type NearbyOpts, type PlaceHit } from '../../lib/geocode'
import { useResolvePick } from '../../components/ResolvePickDialog'
import { clockHM, deriveClockMilestones } from '../../lib/clockOverlay'
import { sheetHiddenClass } from '../../lib/mapSheet'
import { mapScopeNote } from '../../lib/railA11y'
import { plannerDrives } from '../../lib/transportPolicy'
import { fillLabel, pickDayCaveat, voteStatusId } from '../../lib/railA11y'
import { MapOmnibar } from './MapOmnibar'
import { useOmnibarPlacement } from './map/useOmnibarPlacement'
import { useMapSearch } from './map/useMapSearch'
import { useAddModal } from './map/useAddModal'
import { ShortlistTray } from './map/ShortlistTray'
import { useShortlist } from './map/useShortlist'
import { useMapWriters } from './map/useMapWriters'
import { dayStayBase, useCorridorCache } from './map/useCorridorCache'
import { useRailView } from './map/useRailView'
import { useMapEdit } from './map/useMapEdit'
import { MapEditAddPanel, MapEditStopPanel, MapEditLive } from './map/MapEditPanel'
import { travelDayAdviceFor, applyTravelDays } from '../../components/map/lenses/TravelDayAdvice'
import { MapLensPanel } from './map/MapLensPanel'
import { driveLettersByRoad, useMapLenses, type MapLensId } from './map/useMapLenses'
import { driveCardStrip, driveDeckIntro, filledStopClock, scopeBandOf, budgetHeldAlternativeIds, distinctPlaceBands, type DayBudgetWalk, type DriveTab } from './map/driveLens'
import { STAY_RINGS, ringPolygon, ringRadiusKm, resolveStayBase } from './map/stayLens'
import { applyFixChangeSet, verifyFixSet } from './map/fixLens'
import { fixIsOffered, type FixChangeSet } from '../../lib/mapLensContracts'
import type { RingId } from '../../components/map/lenses/StayDeck'
import { hiddenDrivePicks } from '../../components/map/lenses/DriveTabs'
import { MapScopeBand, bandCounts, phoneLensAriaLabel, type ScopeBandCounts } from './map/MapScopeBand'
import { LensRailExtras, fixRailLine, fixTargetStopId, driveBudgetBarText, plannedDriveBudget, driveBudgetStep, windowDurationText } from './map/LensRailExtras'
import { baseTagText, fixMarkFactsLabel } from '../../lib/mapStyles/lensMarks'
import {
  readScopeMinutes, scopeStorageKey, scopeKmForMinutes, nextScopeMinutes, dayPurposesFor, type ScopeMinutes,
} from './map/minuteScope'
import { useRailContent } from './map/useRailContent'
import { journeyCostLabels } from './map/railLabels'
import { useSlotSearch } from './map/useSlotSearch'
import {
  googleMapsUrl, newStopId, poiVisitMinutes,
} from './map/pageHelpers'
import { activeReadinessLabel, activeDayLabel } from './map/railRows'
import { LensDeckSource } from '../../components/map/lenses/LensDeckSource'
import { deckHits, FIX_SOURCE_LINE } from './map/deckSource'
import { passClockMin, pickArrivalMin, type PassAnchor } from './map/passClock'
import { addFixOffer, detailAddPreview, detailPreviewView } from './map/detailPreview'
import { kindWordOf } from '../../components/map/placeCardFacts'
import { MapPickCard } from '../../components/map/MapPickCard'
import { MapItinerary, MapJourneyRibbon, MapPhoneDay, MapSheetHandle, type ItineraryStayView, type ItineraryWindowRow, type SheetSnap, type SheetSnapSource } from '../../components/map/MapWorkspaceChrome'
import { clockTicks, pickBandTag, tickText, windowLabel, type RouteMark, type TickAnchor } from '../../lib/map/routeMarks'
import { pointAtKm } from '../../lib/geo'
import { aroundKmText, dayEndTown, daysCaptionText, picksText, stayRailSub, stayRailTitle, windowAroundKm, windowAtMin } from '../../components/map/railModel'
import { ROUTE_PAINT } from '../../lib/mapStyles/routeTreatment'
import { driveRowForHit, mapAllJourneyRowsForDays, mapCardActions, mapRailRowForHit, mapRowForHit, mapRowsForHit, type MapRowBinding } from './map/mapJourneyRows'
import { hoursCardText, hoursDisplayFor, intendedVisitMinutes, visitDateForDay } from '../../lib/hoursContext'
import { LedgerRow } from './map/RailRowViews'
import { filingOptionsFor } from './map/slotFiling'
import { arcCompletionEffects, arcPickPlan, arcStageLine, arcUndoLine, retryArcAdd, stageArcAdd, type ArcStageOutcome } from './map/arcAdd'
import { guardedUndo, type WriterActionDeps, type WriterCompletion } from './map/mapWriterActions'
import { mapWriterOperationGate } from './map/writerOperationGate'
import { createSlotSearchGuard, searchContextForSlot } from './map/manualSlotContexts'
import { isRoadRetryUnderway, nextRoadLatch, type RoadLatch } from './map/roadRetryLatch'
import { isSlotSearchCurrent, slotSearchResetKey, visibleSlotSearch } from './map/slotSearchView'
import {
  measuredRoadFacts, openSlotAnnouncement, runSlotSearchFlow, SLOT_SEARCH_FAILED_COPY, slotRowsOf, slotSearchScopeKey, slotVoteReady, stableDayIdFor,
} from './map/mapTabPipeline'
import { batchSelection, planCounts } from '../../lib/dayPlan'
import { admitTripPreview, tripById } from '../../store/store'
import {
  dayWeatherJoin, drizzleDayIndex, journeyKmFrom, routePolylineFrom, weatherAnchorFrom, weatherFetchRefusal,
} from './map/weatherGeometry'

/** How many search hits the rail shows before "Show all" (#333 A1). The listbox
 *  grammar needs the same page size the rows are rendered with, so it lives here
 *  once instead of as a bare literal in the label, the slice and the key handler. */
import { isSightCategory, roadProfileFromLegs } from '../../lib/ridePlan'
import { QuotaExhaustedError } from '../../lib/providers/google'
import { isElectric } from '../../lib/vehicleProfile'
import { dayShape, tripDayAttribution, SLOT_URGENCY_MIN, type DaySlot, type DaySlotKind } from '../../lib/daySlots'
import { corridorSnapshotKey, corridorStatusFor, dayAttributionKeyFor, type CorridorSnapshot } from './map/corridorSnapshot'
import { discardedStagedIds, isAlreadyAdded, normalizePlaceName, type PlaceIdentity } from '../../lib/placeIdentity'

import { dayDetourBudgetMin } from '../../lib/detourBudget'
import type { WorkspaceJourneyDays } from './journey/journeyDays'
import { anyQuotaExhausted } from '../../lib/providers/quota'
import { recordDnaEvent, dnaNoteForHit, crewSeedsToPlannedStops, crewNoteForHit, type CrewSeed, type DnaVector } from '../../lib/tripDna'
import { visitMinutesForCategory } from '../../lib/slackPrompts'
import { scrollBehavior } from '../../lib/motion'
import type { SegmentHit } from '../../lib/geocode'
import { projectOntoPolyline } from '../../lib/providers/hits'
import { fetchDailyWeather, forecastAvailable, isoAddDays, todayISO } from '../../lib/weather'
import { useWeatherRefreshTick } from '../../hooks/useWeatherRefresh'
// MapLibre is heavy (~1MB) — load it only when the Map tab is actually opened.
const TripMap = React.lazy(() => import('../../components/TripMap').then(m => ({ default: m.TripMap })))

// #420 slice 3: the page's module-level constants and pure helpers live in
// ./map/pageHelpers now, where they have direct tests. `clockHM` is NOT among them
// — the page carried a byte-identical copy of lib/clockOverlay's (which is tested),
// so the copy is gone and the lib one is imported below.

// ---- Engine guide: a subtle rotating roll-out of what the suggestion engine ----
// ---- does, so its intelligence is discoverable without a docs trip.          ----
// ================= Map tab =================

// MapTabSkeleton moved to ./MapTabSkeleton (#332 R4) — it is this module's
// Suspense fallback, so importing it from here re-created the static edge the
// lazy boundary exists to cut. Import it from that module instead.

/** Per-slot glyphs (plan P2.1/P6.2): the kind's icon, with the breakfast
 *  special-case on the label — kinds can't tell meals apart, and an unknown
 *  label simply renders no glyph (graceful, never wrong). */
const KIND_GLYPH = { meal: Utensils, fuel: Fuel, overnight: BedDouble, stretch: Pause } as const
function SlotGlyph({ kind, label }: { kind: DaySlotKind; label: string }) {
  const G = label === 'Breakfast' ? Coffee : KIND_GLYPH[kind]
  return G ? <InlineIcon icon={G} size={12} /> : null
}
export function MapTab({ trip, editable, applyChange, suggestionCache, onInputsHash, onCorridorState, journeyDays, presence, crewSeeds, dnaVector, dnaTick, setDnaTick, setAddedIds, dismissedIds, setDismissedIds, setStagedSnapshot, stagedIdsRef, slotManual, setSlotManual, road, roadBinding, currentRoad, onOpenTimeline, onOpenBoard, onOpenDay, onOpenGroupInput, previewOpen, dayFocus, onDayFocusChange, mapTarget, onMapTargetConsumed, legCorrections, onBackToTrip }: {
  trip: Trip
  editable: boolean
  /** #841: the workspace's shared write type. The first four arguments keep
   *  their old meaning; the kept callback may receive the acknowledged receipt
   *  and the fifth argument names the operation (id plus discard callback). */
  applyChange: ApplyChange
  suggestionCache: ReturnType<typeof useSuggestionCache>
  /** #404: the Map publishes the freshness it scanned under, so the Overview's
   *  slot matrix can qualify stale numbers instead of printing them as current.
   *  The hash cannot be recomputed outside this component — it reads the OSRM
   *  geometry and the weather join, both of which are this tab's state. */
  onInputsHash?: (inputsHash: string, scopeKm: number) => void
  /** S2: publish the corridor facts the workspace producer reads. The callback
   *  identity alone never republishes; only a changed snapshot key does. */
  onCorridorState?: (snapshot: CorridorSnapshot | null) => void
  /** S3: the one shared per-day model, built above the tabs. */
  journeyDays: WorkspaceJourneyDays
  /** S3: the shared presence identity (committed plan + session sets). */
  presence: PlaceIdentity
  /** S3: crew seeds, lifted so the producer and the scan use the same list. */
  crewSeeds: CrewSeed[]
  /** S3: the shared DNA vector; the Map no longer re-reads the log itself. */
  dnaVector?: DnaVector
  /** S3: lifted DNA freshness token. */
  dnaTick: number
  setDnaTick: React.Dispatch<React.SetStateAction<number>>
  /** S3: lifted session identity. */
  setAddedIds: React.Dispatch<React.SetStateAction<Set<string>>>
  dismissedIds: ReadonlySet<string>
  setDismissedIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setStagedSnapshot: React.Dispatch<React.SetStateAction<ReadonlyMap<string, string>>>
  stagedIdsRef: React.MutableRefObject<Map<string, string>>
  slotManual: Record<string, PlaceHit[]>
  setSlotManual: React.Dispatch<React.SetStateAction<Record<string, PlaceHit[]>>>
  /** #188: the workspace's ONE road measurement — the Map tab no longer measures. */
  road: TripRoadView
  /** Strict measured-road bytes from the Workspace's one road measurement. */
  roadBinding?: WriterRoadBinding | null
  /** Live measured-road bytes for strict post-await revalidation. */
  currentRoad?: () => WriterRoadBinding | null
  onOpenTimeline?: (stopId: string) => void
  onOpenBoard?: () => void
  /** Phase 3: tapping a halt label asks the workspace to open that day's plan
   *  in the Timeline. Undefined = halt labels stay decorative labels. */
  onOpenDay?: (dayIndex: number) => void
  /** W10: the phone map's back control returns to the trip's default tab. */
  onBackToTrip?: () => void
  /** The part's live vote opens the crew's Group input to resolve it (P4). */
  onOpenGroupInput?: () => void
  /** true while the workspace holds a staged change — a direct cache write
   *  (the popup's stop delete) would make Keep refuse as stale, so it refuses
   *  instead (#334, same policy as the timeline and Group input). */
  previewOpen?: boolean

  /** #425 PR 2: the shared day-focus axis (same value the Board's columns
   *  read). The map's day-filter chips and the slots rail's day strip report
   *  their choice through it, so the Board and this tab agree whichever was
   *  touched. Optional — the tab keeps working when a host has not adopted it. */
  dayFocus?: number | 'all'
  /** reports the tab's day-axis choice back up to the workspace. */
  onDayFocusChange?: (day: number | 'all') => void
  /** A one-shot request from the Overview route card. */
  mapTarget?: MapTarget | null
  /** Clears the request after TripMap selects or frames the target. */
  onMapTargetConsumed?: () => void
  /** The workspace's measured road data — pin clocks read it (#611). */
  legCorrections?: Record<string, LegEstimate>
}) {
  const [pois, setPois] = useState<SegmentHit[]>([])
  const timeFormat = useTimeFormat()

  // bump to force a corridor re-search — the only refetch path besides a
  // detour-scope change or a first-ever load (empty cache)
  const [refreshTick, setRefreshTick] = useState(0)
  // #143: overnight segment ids the user told to "stay at the pin" — the
  // drift proposal hides for the session (the pin holds; it re-asks next open)
  const [driftDismissed, setDriftDismissed] = useState<Set<number>>(new Set())
  // P1 ("search lands in its slot"): the open part's own search. Keyed to the
  // slot it was typed in, so a query resolved after switching slots can never
  // render its rows into the wrong slot (seq guard + key check), and the
  // manual picks live per slot, re-validated at render like the tray (#179).
  // #841: the cell is scoped to the trip + stable day it was typed on. The view
  // below returns null for any other day, so a lunch query never shows on
  // another day's lunch slot, even for one render.
  const [slotSearchCell, setSlotSearch] = useState<{ key: string; q: string; busy: boolean; hits: PlaceHit[]; err: string | null } | null>(null)
  const [slotSearchScope, setSlotSearchScope] = useState<string | null>(null)

  const addingIdsRef = useRef(new Set<string>())
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set())
  const [addingAny, setAddingAny] = useState(false)
  const slotGuard = useRef(createSlotSearchGuard())
  // #898: the scope is minutes of EXTRA driving (15 / 30 / 45 / 60, default 30),
  // saved per trip. The engine still searches by distance, so `scopeKm` is the
  // one-way radius those minutes allow. #181: loadPref never throws in private mode.
  const [scopeMinutes, setScopeMinutes] = useState<ScopeMinutes>(() => readScopeMinutes(loadPref(scopeStorageKey(trip.id), '')))
  // The control shows the chosen step at once. The re-plan waits for the debounce.
  const [scopeChoice, setScopeChoice] = useState<ScopeMinutes>(scopeMinutes)
  const scopeTripRef = useRef(trip.id)
  useEffect(() => {
    if (scopeTripRef.current === trip.id) return
    scopeTripRef.current = trip.id
    const saved = readScopeMinutes(loadPref(scopeStorageKey(trip.id), ''))
    setScopeMinutes(saved)
    setScopeChoice(saved)
  }, [trip.id])
  const scopeKm = scopeKmForMinutes(scopeMinutes)
  const scopeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function changeScope(next: ScopeMinutes) {
    if (scopeTimer.current) clearTimeout(scopeTimer.current)
    setScopeChoice(next)
    scopeTimer.current = setTimeout(() => {
      setScopeMinutes(next)
      savePref(scopeStorageKey(trip.id), String(next))
    }, DEBOUNCE_MS)
  }
  useEffect(() => () => { if (scopeTimer.current) clearTimeout(scopeTimer.current) }, [])
  // #420 slice 16: widening stays a page callback — the gap row calls it,
  // and the corridor re-plans through the same state it always did.
  const widenScope = () => {
    const next = nextScopeMinutes(scopeMinutes)
    setScopeMinutes(next)
    setScopeChoice(next)
    savePref(scopeStorageKey(trip.id), String(next))
    toast('Search widened. The corridor re-plans.')
  }
  // #420 slice 9: the add draft moved with the opener into
  // ./map/useAddModal (called after dayForKm below) — the modal JSX stays.
  // cross-highlighting: the suggestion currently hovered/selected in EITHER the
  // side panels or the map. Panel hover/click sets it (map flies to the pin);
  // map hover/click sets it (panel row highlights and scrolls into view).
  const [activeHitId, setActiveHitId] = useState<string | number | null>(null)
  // Keyboard/touch parity for the cross-highlight (the critique's P1: it was
  // mouse-only): a click or Enter pins the row — the map holds that place —
  // hover and focus still peek, and leaving falls back to the pin.
  const [pinnedHitId, setPinnedHitId] = useState<string | number | null>(null)
  // Shortlist: the rail collects picks before anything lands in the plan, so the
  // group can vote on them. The tray under the grid owns the actions. The whole
  // feature (collection, filter, both writers) lives in map/useShortlist.ts since
  // #420 slice 2; the hook is called below, after the helpers it needs.
  // #420 slice 12: the rail view (filter, fold, day, sheet, return) lives in
  // ./map/useRailView. States return with their setters; the page calls those
  // from event handlers only, never during render.
  const { chipFilter, setChipFilter, folded, setFolded, mapFilter, setMapFilter,
    setLocalDay, activeDayIndex, sheetTab, setSheetTab, sheetApplies,
    showReturn, setShowReturn } = useRailView({ dayFocus, dayIndexes: trip.days.map(d => d.index) })
  // #841: the persisted id of the day the rail is planning, found by the day's
  // own index (indexes can skip after a deletion). Undefined = no stable day,
  // and the writers then refuse instead of guessing one.
  const activeDayId = stableDayIdFor(trip, activeDayIndex)
  const searchScopeNow = slotSearchScopeKey(trip.id, activeDayId)
  const slotSearch = visibleSlotSearch(slotSearchCell, slotSearchScope, searchScopeNow)

  // #420 slice 8: the search state moved with the runner into
  // ./map/useMapSearch (called after routeKmOf below) — the list refs and the
  // slot abort stay here with the slot search that owns them.
  const listRef = useRef<HTMLDivElement | null>(null)
  const searchListRef = useRef<HTMLDivElement | null>(null)
  const slotAbort = useRef<AbortController | null>(null)
  // Shared resolve-or-prompt guard (product decision 2026-09-25, #424): every
  // unknown-position pick below resolves through resolvePick — retry / manual
  // coordinates / explicit skip — before anything is written. Lives with the
  // other hooks, above every path out of this component (AGENTS §6e).
  const { resolvePick, dialog: resolvePickDialog } = useResolvePick()
  useEffect(() => {
    const guard = slotGuard.current
    return () => {
      slotAbort.current?.abort()
      guard.reset()
    }
  }, [])
  // S3: one shared identity owner. The workspace builds it; the Map reads it.
  const identity = presence

  // OSRM road geometry of the whole route — feeds Google Search-Along-Route
  // (the report's killer feature); the free stack ignores it. #188: the
  // WORKSPACE owns this measurement now (one routePath chain per trip, one
  // retry) and hands the result down — the Map tab used to measure the same
  // chain a second time, doubling the load on the shared OSRM demo server and
  // letting the drawn line disagree with the detour math.
  const roadView = useMemo(
    () => mapRoadViewFromLegs(road?.chain ?? null, road?.legs ?? null, trip.days.map(d => d.index)),
    [road, trip.days],
  )
  // A flight trip draws its JOURNEY, not the road chain: the ground legs either
  // side of the sector take the measured road shape where one exists, and the
  // sector takes a great-circle arc. The road chain is never even measured for
  // this mode (see useTripRoad), so without this the map would draw nothing at
  // all — and before that gate it drew the driving directions OSRM answered.
  // The derivation lives in the engine (`tripJourneyGeometry`), not here.
  const airPlan = useMemo(
    () => (isAirMode(trip.transportMode) ? tripJourneyGeometry(trip, legCorrections) : null),
    [trip, legCorrections],
  )
  const routeGeometry = airPlan?.geometry ?? roadView.geometry
  const returnRouteGeometry = useMemo(
    () => mapReturnGeometryFromLegs(road?.chain ?? null, road?.legs ?? null),
    [road],
  )
  const routeTotalKm = airPlan ? airPlan.km : roadView.totalKm
  const routeTotalMin = airPlan ? airPlan.min : roadView.totalMin
  const dayRoadKm = roadView.dayRoadKm
  // The measurement's outcome, handed down from the workspace: when the road
  // can't be measured (rate limits, very long routes — exactly where the banner
  // matters most), the Day Planner still speaks, from the haversine estimate,
  // flagged as rough.
  const routeFailed = road?.status === 'failed'
  // #road-retry: this banner is the one surface that says the road failed, so it
  // also owns the retry. A latch holds the failure while the re-measure is in
  // flight - status flips to 'pending' the moment Retry is clicked, and a gate
  // keyed on `failed` alone would drop the banner mid-retry. The latch lives in
  // state and steps while the page renders (map/roadRetryLatch), so a same-tick
  // flip never reads stale and no ref is touched during render. A resolved
  // measurement clears it. The latch is keyed to the trip that failed: this
  // workspace outlives trips, and a carried failure must not read as "measuring
  // the road again" on a trip that never failed.
  const [roadLatch, setRoadLatch] = useState<RoadLatch>({ tripId: trip.id, failedEver: false })
  const roadLatched = nextRoadLatch(roadLatch, trip.id, road?.status)
  if (roadLatched !== roadLatch) setRoadLatch(roadLatched)
  const roadRetryUnderway = isRoadRetryUnderway(roadLatched.failedEver, road?.status)
  const roadNeedsRetry = routeFailed || roadRetryUnderway
  // The terrain profile (#124): the clock and the split convert time↔km
  // through the REAL mix of the road just measured, instead of one blended
  // rate that placed lunch and the night halt too far along a ghat day and
  // too short a highway day. Null until the road resolves — then everything
  // falls back to the blended rate exactly as before.
  const roadProfile = useMemo(
    () => roadProfileFromLegs(outboundLegs(road?.chain ?? null, road?.legs ?? null)),
    [road],
  )

  // Stop signature (#135): stable string key over what buildJourney actually
  // reads (stop ids, road order, coords) — the days ARRAY identity changes on
  // every store commit, so memoising the whole-trip budget on `trip` re-fired
  // this on unrelated keystrokes.
  // day start signature: the clock walk reads every day's startTime (rest days
  // stamped 08:30 by #133 shells), never the days array itself.
  const dayStartSig = trip.days.map(d => d.startTime ?? '').join(',')
  // whole-trip wheel distance & time (journey sums) — the plan budget for the
  // fatigue math. OSRM's road totals win when resolved (same legs the map
  // draws); the journey sums are the haversine estimate fallback.
  // #213 Phase 3: `trip` IS in deps — `mutateTrip` clones it on every save so
  // any settings change re-runs. Without this, transportMode / roundTrip /
  // driverCount / vulnerable tweaks kept the old plan totals and the
  // split/clock verdicts read stale numbers.
  const wholeTrip = useMemo(() => {
    let km = 0
    let min = 0
    for (const d of trip.days) {
      const j = buildJourney(trip, d)
      km += j.distanceKm
      min += j.driveMinutes
    }
    return { km: routeTotalKm ?? km, min: routeTotalMin ?? min }
  }, [trip, routeTotalKm, routeTotalMin])



  // search the WHOLE route corridor (start → stops → destination); the home
  // zone around the starting point is excluded inside the engine
  const anchors = useMemo(() => {
    const pts = trip.days
      .flatMap(d => d.stops)
      .filter(s => s.status !== 'rejected')
      .map(s => ({ lat: s.lat, lng: s.lng }))
    return corridorAnchors(pts, trip.startLocationCoords ?? null, scopeKm * 1000)
  }, [trip, scopeKm])

  // Per-day rain chance and WMO code (#141, which separates a drizzle chance
  // from a storm chance in the cap multiplier) - best-effort, null until loaded.
  // The fetched join is keyed to the forecast it was asked for, so a trip that
  // loses its forecast, or moves to another one, reads as not loaded with no
  // reset effect.
  const [fetchedWeather, setFetchedWeather] = useState<{ key: string; rainPct: (number | null)[] | null; codes: (number | null)[] | null } | null>(null)
  // Keep the rain join fresh: re-pull on the cadence and when the tab returns.
  const weatherTick = useWeatherRefreshTick()
  // #420 slice 6: which stops the forecast may be centred on, and whether it may
  // be fetched at all, are rules with their own tests now (map/weatherGeometry).
  const weatherStops = trip.days.flatMap(d => d.stops)
  const weatherAnchor = weatherAnchorFrom(weatherStops)
  const weatherBlocked = !weatherAnchor || !!weatherFetchRefusal({ stops: weatherStops, startDate: trip.startDate, forecastAvailable })
  const weatherKey = weatherAnchor ? `${weatherAnchor.lat},${weatherAnchor.lng}|${trip.startDate}|${trip.days.length}` : ''
  const shownWeather = !weatherBlocked && fetchedWeather?.key === weatherKey ? fetchedWeather : null
  const dayRainPct = shownWeather?.rainPct ?? null
  const dayWeatherCode = shownWeather?.codes ?? null
  useEffect(() => {
    const stops = trip.days.flatMap(d => d.stops)
    const anchor = weatherAnchorFrom(stops)
    if (!anchor || weatherFetchRefusal({ stops, startDate: trip.startDate, forecastAvailable })) return
    const key = `${anchor.lat},${anchor.lng}|${trip.startDate}|${trip.days.length}`
    let cancelled = false
    fetchDailyWeather(anchor.lat, anchor.lng, trip.startDate, trip.days.length || 1, { force: weatherTick > 0 })
      .then(w => {
        if (cancelled) return
        const join = dayWeatherJoin({ dayCount: trip.days.length, startDate: trip.startDate, byDate: w, isoAddDays })
        setFetchedWeather({ key, rainPct: join.rainPct, codes: join.codes })
      })
      .catch(() => { if (!cancelled) setFetchedWeather({ key, rainPct: null, codes: null }) })
    return () => { cancelled = true }
  }, [trip, weatherTick])
  // OSRM's road total (when resolved AND worth trusting) is the most accurate
  // journey budget for the fatigue math; otherwise the journey-summed estimate.
  const planKm = journeyKmFrom(routeTotalKm, wholeTrip.km)

  // Route polyline in {lat,lng} form (from the OSRM route geometry) — feeds the
  // asymmetric detour measure so on-the-way hits cost ~0 and spurs pay round trip.
  const routePolyline = useMemo(() => routePolylineFrom(routeGeometry), [routeGeometry])




  // The wheel decides whether a fuel or charge halt exists (2026-10-19). This
  // is the planner boundary, so it is asked HERE, once, and not by the form:
  // the stored vehicle profile stays on the row for a later driving trip.
  // Memoized because `nearbyOpts` reads it; a fresh object every render would
  // invalidate the corridor cache's input identity and re-arm the scan effect.
  const wheel = useMemo(
    () => plannerDrives({ transportMode: trip.transportMode, drivesPart: trip.drivesPart }),
    [trip.transportMode, trip.drivesPart],
  )

  const nearbyOpts: NearbyOpts = useMemo(() => ({
    // The wheel answer rides every planner call (2026-10-19); without it a
    // Mixed-No trip keeps getting a driving plan from this seam.
    drivesPart: trip.drivesPart,
    // #144B: an electric profile charges instead of fuelling — the segment
    // cadence and the hit queries both read this flag. A passenger trip asks
    // for neither: a bus with a stored EV profile does not charge.
    includeFuel: wheel && !isElectric(trip.vehicleProfile) && (trip.transportMode === 'car' || trip.transportMode === 'motorcycle'),
    includeCharge: wheel && isElectric(trip.vehicleProfile),
    // #189 + 20260915_trip_party_prefs.sql: the persisted vehicle profile is
    // the one owner of fuel-stop cadence. Without it here, geocode.ts falls
    // through to FUEL_INTERVAL_KM (450) and a 60 L / 20 km-L bike is planned
    // at car cadence. The profile is JSONB-validated on read, so a junk
    // value never reaches this planner.
    vehicleProfile: trip.vehicleProfile,
    // #143: accepted night-halt pins (night ordinal → route-km) — the planner
    // snaps those halts and surfaces drift as a proposal instead of moving.
    haltPins: loadHaltPinsForTrip(trip.id),
    homeCenter: trip.startLocationCoords ?? null,
    // fill what the itinerary lacks, demote what it already covers
    categoryBias: computeCategoryBias(trip),
    // Google mode: bias the search along the real road polyline; free mode ignores it
    routeCoords: routeGeometry,
    // NOTE (#335): this is the corridor CADENCE crew, not the vote quorum —
    // cadenceForCrew reads how many people are riding, so `travellers` stays.
    // The vote denominator lives in daySlots' `memberCount` below.
    travellers: trip.travellers,
    travelStyle: trip.travelStyle,
    speedKmph: MODE_SPEED[trip.transportMode] ?? 40,
    // Trip DNA: EVERY trip on the device leans corridor ties toward kinds the
    // user keeps picking (cross-trip learning) — scoped per-trip would forget a
    // waterfall hire on a past journey.
    // dnaTick re-reads the log after every accept/decline on this tab.
    ...(dnaVector ? { dnaVector } : {}),
    plannedStops: [
      ...trip.days.flatMap(d => d.stops)
        .filter(s => s.status !== 'rejected' && Number.isFinite(s.lat) && Number.isFinite(s.lng))
        .map(s => ({ lat: s.lat, lng: s.lng, name: s.title })),
      // crew-proposed ideas suppress duplicate corridor suggestions near them
      ...crewSeedsToPlannedStops(crewSeeds),
    ],
    dayStartTimes: trip.days.map(d => d.startTime ?? '08:30'),
    dayRainPct: dayRainPct ?? undefined,
    dayWeatherCode: dayWeatherCode ?? undefined,
    transportMode: trip.transportMode,
  }), [trip, routeGeometry, dayRainPct, dayWeatherCode, crewSeeds, dnaVector, wheel])

  // #143 — overnight ordinal by position: the planner keys accepted-halt pins
  // on WHICH night (in route order), not the segment's slot, so the map here
  // must save/clear the same key the engine reads.
  const overnightOrdinals = useMemo(() => {
    const map = new Map<number, number>()
    pois
      .filter(x => x.segment.purpose === 'overnight')
      .sort((a, b) => a.segment.targetKm - b.segment.targetKm)
      .forEach((x, i) => map.set(x.segment.index, i))
    return map
  }, [pois])
  // Pins are promises about a ROAD: their km-space lives between the trip's
  // endpoints — move A or B and every accepted halt is voided (with a toast,
  // never silently). A stop added along the way does NOT void pins: the
  // re-derived halt drifts, and hysteresis + the drift proposal handle that
  // honestly (#143's whole point — "it won't move unless the road does").
  const endpointHash = `${trip.startLocation}|${trip.startLocationCoords?.lat ?? ''},${trip.startLocationCoords?.lng ?? ''}|${trip.destinations.join('|')}`
  useEffect(() => {
    const key = `halt_shape_${trip.id}`
    const prev = loadPref(key, '')
    if (prev && prev !== endpointHash) {
      clearHaltPinsForTrip(trip.id)
      toast('Route re-shaped. Accepted halt pins cleared.')
      suggestionCache.clearMap()
      // The pins bag is now empty: the planner and the corridor must re-read it.
      // The request runs after this effect has finished, not from inside it.
      queueMicrotask(() => { setRefreshTick(t => t + 1); setDnaTick(t => t + 1) })
    }
    savePref(key, endpointHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpointHash, trip.id])

  // Day Planner verdicts (PLAN-DAY-PLANNER P1-B/C): the drive-day split the
  // ROUTE demands (duration cap, load-balanced) and the travel-clock verdict
  // for the trip's real start time (defer / hop / ok). Pure — recomputed from
  // route facts, never stored, so every stop mutation re-derives them (the
  // ripple re-plan) and the night-halt position stays honest.
  // #141: the scalar gets the same severity weighting as the per-day array —
  // drizzle-class codes damp it, storms weight it up (rainFactorFor).
  const rainFactor = dayRainPct?.[0] != null ? rainFactorFor(dayRainPct[0], dayWeatherCode?.[0] ?? undefined) : undefined
  const tripIsRoundTrip = isRoundTrip(trip)
  // #126 party + #142 inputs + #122 anchors, one bag both verdicts read. Timetable
  // modes (train/bus/flight/mixed) get NO fatigue cap → splitVerdict null → no
  // banner; there is no wheel to fatigue. Vulnerable party pulls dinner an hour
  // early; the drive-after-dinner allowance (#122) extends days past the meal.
  const partyOpts = {
    travelStyle: trip.travelStyle,
    transportMode: trip.transportMode,
    drivesPart: trip.drivesPart,
    driverCount: trip.driverCount,
    hasVulnerable: trip.hasVulnerable,
  }
  const tripAnchors = anchorsForCrew({
    hasVulnerable: trip.hasVulnerable,
    driveAfterDinnerMin: trip.driveAfterDinnerMin,
  })
  // A round trip's SPLIT demands days for the whole loop (2× the outbound
  // corridor — the return re-traces the same road). The CLOCK walk (#145) now
  // models it honestly instead: one outbound walk + a directed return walk
  // from the destination, whose day count feeds the banner.
  const loopFactor = tripIsRoundTrip ? 2 : 1
  // #126: conducted modes (train/bus/flight/taxi) have no driving fatigue —
  // the split verdict stays null and every banner/chip/arming consumer below
  // goes quiet through that single gate.
  const drivingPlan = useMemo(
    () => deriveDrivingPlan({
      totalKm: planKm, driveMinutes: wholeTrip.min, dayStart: trip.days[0]?.startTime,
      dayStartTimes: trip.days.map(d => d.startTime ?? '08:30'),
      rainFactor, dayRainPct: dayRainPct ?? undefined, dayWeatherCode: dayWeatherCode ?? undefined,
      roundTrip: tripIsRoundTrip, profile: roadProfile, ...partyOpts, anchors: tripAnchors,
    }),
    // #213 Phase 3: dayWeatherCode IS a dep (rainFactor reads it for severity
    // weighting, #141) — same omission the clockVerdict had. The two verdicts
    // now invalidate together on a forecast fetch.
    [planKm, wholeTrip.min, trip.travelStyle, trip.transportMode, trip.drivesPart, trip.driverCount, trip.hasVulnerable, trip.driveAfterDinnerMin, dayStartSig, dayRainPct, dayWeatherCode, tripIsRoundTrip, roadProfile],
  )
  const clockVerdict = drivingPlan.clock
  const splitVerdict = drivingPlan.split
  // The travel clock drawn ON the route as clean road LABELS: one text pair per
  // planned clock anchor (meal / overnight / destination) — its wall-clock time
  // + calendar date on the LEFT of the road, its road km on the RIGHT. No pins,
  // no dots. FIX-1: not a second walk — this projects MapTab's own `clockVerdict`
  // (the banner's walk) onto the road that just resolved, so the map and the
  // banner can never disagree. Phase 1: `todayISO` is the device calendar day,
  // so each label knows whether its day is driven history, the active day, or
  // still plan. Only renders once the geometry is in, because a label planted
  // on a straight chord would lie about where the stop lands. Return-leg labels
  // carry leg:'return'; the map shows them only while its Return home toggle
  // is on.
  const clockMilestones = useMemo(
    () => deriveClockMilestones({
      verdict: clockVerdict,
      polyline: routePolyline,
      tripStartDate: trip.startDate,
      // anchors the return pass's dates at the trip's tail and decides which
      // labels have an honest itinerary day behind them (tap targets)
      tripDaysCount: trip.days.length,
      todayISO: todayISO(),
      // Phase 2: the corridor's overnight hits name the halt labels. `pois` is
      // SegmentHit[] — the annotated hits carry haltPurpose + cumKm from
      // annotateSegmentHits, which is exactly the join key the label layer
      // asks for.
      haltCandidates: pois.map(s => s.hit).filter((h): h is PlaceHit => h != null),
    }),
    [clockVerdict, routePolyline, trip.startDate, trip.days.length, pois],
  )
  // One clock story (#123): the banner count comes from the clock walk that
  // knows the start time; planDriveDays stays the geometry-free estimator.
  // defer → 0 usable days today; hop → tonight's hop + full days from tomorrow.
  // #145: a round trip needs BOTH walks counted — out + back.
  const travelDayNeed = drivingPlan.dayCount
  // #141: drizzle-grade rain (a 40%+ chance whose WMO code says drizzle or
  // light rain) damps the cap gently — the note keeps it a "slow day", never
  // a verdict flip; storms damp fully and the split banner flips honestly.
  const drizzleDay = drizzleDayIndex(dayRainPct, dayWeatherCode)
  // The split wants more days than planned: propose applying it. Declining is
  // respected — with the honest red fatigue verdict stated, never hidden.
  // The decline is keyed to the single-source count (#123): apply -> recompute
  // -> same count -> the banner stays dismissed instead of re-firing on its own
  // mutation, and a new count reads as not declined with no reset effect.
  const [splitDeclinedAt, setSplitDeclinedAt] = useState<number | null>(null)
  const splitDeclined = splitDeclinedAt === travelDayNeed
  const setSplitDeclined = (declined: boolean) => setSplitDeclinedAt(declined ? travelDayNeed : null)
  const [ribbonOpen, setRibbonOpen] = useState(() => loadFlag('map_ribbon', false))
  const [fixPreview, setFixPreview] = useState<FixChangeSet | null>(null)
  function toggleRibbon() {
    const next = !ribbonOpen
    setRibbonOpen(next)
    saveFlag('map_ribbon', next)
  }
  const applySplitDays = () => {
    if (applyTravelDays(trip, drivingPlan, applyChange, undo => undoToast('Added travel days', undo))) setSplitDeclined(true)
  }

  // #420 slice 11: the corridor cache (hash, publish, both scans) lives in
  // ./map/useCorridorCache. It returns values only, never callbacks.
  const { fractionPois, corridorQuotaOut, loadingPois, poisFailed, scanFailed, scanQuotaOut, mapInputsHash, corridorSource, poisInputsHash, poisScopeKm, fetchedAt: scanFetchedAt, coverage: scanCoverage, discoveryDayIndex } = useCorridorCache({
    trip, anchors, routeGeometry, scopeKm, dayRainPct, dayWeatherCode, crewSeeds,
    dnaTick, onInputsHash, pois, setPois, nearbyOpts, planKm,
    wholeTripMin: wholeTrip.min, drivingPlan,
    refreshTick, suggestionCache,
    // One selected day scans on its own. Show-all keeps the trip-wide scan.
    discoveryDay: mapFilter === 'all' || dayFocus === 'all' ? undefined : {
      dayIndex: activeDayIndex, routeGeometry: null, stayBase: dayStayBase(trip, activeDayIndex),
      purposes: dayPurposesFor([...drivingPlan.outbound, ...(drivingPlan.return ?? [])].find(d => d.dayIndex === activeDayIndex)),
      categoryBias: nearbyOpts.categoryBias, scopeMinutes,
    },
  })
  // A stop with no corridor match is on the route only when the scan has answered.
  const corridorReady = corridorStatusFor({ quota: scanQuotaOut, scanFailed, loading: loadingPois }) === 'ready'

  // #832: attribution reads the EFFECTIVE plan projection (accepted pins and
  // drift included), not a second POI-derived guess. A halt the plan needs
  // beyond the created days stays unassigned until the user applies it.
  const effectiveDays = useMemo(
    () => effectiveDrivingDays(drivingPlan, pois),
    [drivingPlan, pois],
  )
  const dayAttribution = useMemo(
    () => tripDayAttribution(trip, dayRoadKm, effectiveDays),
    [trip, dayRoadKm, effectiveDays],
  )
  const dayForKm = dayAttribution.dayForKm
  /** The exact data the attribution closures close over. */
  const dayAttributionKey = useMemo(
    () => dayAttributionKeyFor(dayRoadKm, effectiveDays),
    [dayRoadKm, effectiveDays],
  )
  // #420 slice 9: the add draft reads the same attribution. A known km with no
  // derived plan day still discloses its pick-day guess.
  const {
    poiDraft, setPoiDraft, pickDay, setPickDay,
    pickDayGuessed, setPickDayGuessed, openAddModal,
  } = useAddModal({ identity, dayForKm, days: trip.days })

  // When the activation came from the map (pin hover/click), bring the matching
  // panel row into view so the two surfaces visibly point at the same place.
  // The search-results card is the other scroll container a pin can answer to.
  //
  // #333 A3: keyboard and focus only. This ran for EVERY activation, including
  // mouse hover, so reading one row yanked the list back to whatever row the
  // pointer had just crossed — the list fought the person reading it. Focus (Tab,
  // or the arrow keys in the row handler) raises the flag; `onMouseEnter` never
  // does, and a click needs no scroll because that row is already on screen.
  const keyboardScrollRef = useRef(false)
  useEffect(() => {
    if (activeHitId == null) return
    if (!keyboardScrollRef.current) return
    keyboardScrollRef.current = false
    const sel = `[data-hit-id="${activeHitId}"]`
    const row = listRef.current?.querySelector(sel) ?? searchListRef.current?.querySelector(sel)
    row?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
  }, [activeHitId])

  /** Along-route km for any point on the current route (null off-polyline). */
  function routeKmOf(lat: number, lng: number): number | null {
    if (!routePolyline) return null
    const snap = projectOntoPolyline({ latitude: lat, longitude: lng }, routePolyline)
    return snap?.km ?? null
  }
  /** Directional km label: honours the Return-home toggle (#polylines). With
   *  the return hidden, a place on the way back reads its distance from home
   *  instead of a misleading 90%+ of the loop. Null off-polyline. */
  function kmLabelFor(km: number | null | undefined): number | null {
    if (km == null || !Number.isFinite(km)) return null
    if (!routePolyline) return km
    const span = alongRouteKmOf(routePolyline[0].lat, routePolyline[0].lng, routePolyline) // total = span of the drawn road
    const total = span?.totalKm ?? km
    return directionalKm(km, total, showReturn)
  }

  // #420 slice 8: the shared route-aware search lives in ./map/useMapSearch
  // now — same inputs in, same outputs out, no behavior change. Called here
  // (not at the top) because it closes over the road and scope above; the two
  // memos below move with it since they render its rows on the map. Hook order
  // changes once, then stays fixed — every hook here runs each render.
  const {
    searchResults, searching, omniQ, setOmniQ, omniResults,
    setOmniResults, omniPicked, setOmniPicked, searchQuotaOut,
    onOmniSearch,
  } = useMapSearch({ routeGeometry, anchors, routePolyline, scopeKm, routeKmOf })
  // Search hits join the corridor ideas on the map so a hovered result row
  // eases the camera to its pin and draws its spur — the same cross-highlight
  // the suggestion rail already has. Deduped by id (a place can be BOTH a
  // corridor idea and a search hit) and empty until a search lands, so the map
  // is unchanged when nobody is searching.
  const mapPois = useMemo(() => {
    const corridor = pois.flatMap(p => (p.hit ? [p.hit] : []))
    const seen = new Set(corridor.map(h => h.id))
    return [
      ...corridor,
      ...searchResults.map(r => r.h).filter(h => !seen.has(h.id)),
      // #418: an omnibar hit is a discovery like any other — it draws the same
      // selectable marker, so the map never hides a place the user just found.
      ...omniResults.map(r => r.h).filter(h => !seen.has(h.id) && !searchResults.some(s => s.h.id === h.id)),
    ]
  }, [pois, searchResults, omniResults])

  // The subset of map pins that came from a search — the map draws them as
  // distinct selectable markers (solid teal, not the dashed gold ideas), and
  // they vanish with the results list when the search bar clears. Both searches
  // feed it: a row found in either box is a search result on the map.
  const searchHitIds = useMemo(
    () => new Set<string | number>([
      ...searchResults.map(r => r.h.id),
      ...omniResults.map(r => r.h.id),
    ]),
    [searchResults, omniResults],
  )

  /** #345: mark the ids a staged change will add — at the moment it is STAGED,
   *  not when Keep lands. All three add paths call this, so the window in which
   *  the same place can slip in twice stops existing; `stagedIdsRef` lets the
   *  preview-close effect release them again if the change is discarded. */
  const markStaged = useCallback((hits: Array<Pick<PlaceHit, 'id' | 'name'>>) => {
    if (hits.length === 0) return
    for (const h of hits) stagedIdsRef.current.set(String(h.id), normalizePlaceName(h.name))
    setStagedSnapshot(new Map(stagedIdsRef.current))
    setAddedIds(prev => {
      const next = new Set(prev)
      for (const h of hits) next.add(String(h.id))
      return next
    })
  }, [setAddedIds, setStagedSnapshot, stagedIdsRef])

  // A preview that is DISCARDED must not leave a ghost: when the preview slot
  // closes, release every id this tab staged whose place is not in the plan.
  // (After Keep the stop is in `trip`, so its name is in `identity` and the id
  // stays — which is the invariant: added ⟺ visible-in-preview-or-committed.)
  useEffect(() => {
    if (previewOpen || stagedIdsRef.current.size === 0) return
    const staged = stagedIdsRef.current
    stagedIdsRef.current = new Map()
    const release = new Set(discardedStagedIds(staged, identity.names))
    // EVERY close must publish a fresh staged map to the identity memo: a Keep
    // whose name is already in the plan releases nothing, so setAddedIds alone
    // would bail out on an unchanged Set and leave the memo attached to the old
    // Map - a staged namesake of a kept place stayed hidden forever after its
    // preview was discarded (#839 review P2).
    setStagedSnapshot(new Map())
    if (release.size === 0) return
    setAddedIds(prev => {
      const next = new Set(prev)
      for (const id of release) next.delete(id)
      return next
    })
  }, [previewOpen, identity, setAddedIds, setStagedSnapshot, stagedIdsRef])

  /** P2: fill one empty part of the day with a candidate. The stop id is
   *  minted here so Undo can delete exactly what was added (addPoiToDay's
   *  own undo hooks into toasts we do not own). Coord resolution stays. */
  /** P3.1: fill every empty part of the day with its top candidate in ONE
   *  batched write. Undo removes exactly the stops the fill added; `deleteStop`
   *  renumbers the day, so the stops that were already there land back in their
   *  original sequence without needing a separate snapshot. */
  /** P4: raise the crew's vote for this part - the candidates become the
   *  options (each carrying its place), and resolving it lands the winner. */
  /** P5.4: routing for a search result - a place whose own category can serve a
   *  part of the day can be filed straight into it, or added plainly as an
   *  extra. The kinds mirror the category claims `fillStopFor` already makes
   *  (food -> meals, transport-hub -> fuel, hotel -> stay), so the search box
   *  covers every category-claimable part rather than meals alone.
   *
   *  #420 slice 5: the mapping, the no-cap rule and the copy live in
   *  ./map/slotFiling now, with their tests; this only supplies the day's slots. */
  const filingOptionsForPicked = (h: PlaceHit) => filingOptionsFor(h, activeDaySlots)

  /** The mockup's headline interaction: find inside the open part. Mirrors
   *  onSearch's guards (2-char floor, scope rank, quota class) but answers into
   *  slot-local state, so the top search card keeps owning corridor-wide
   *  discovery. #841: the query captures its exact trip, stable day and slot.
   *  The flow (./map/mapTabPipeline) commits an answer only while that context
   *  is still current, so a late answer, error or busy reset from another day
   *  or part is dropped. The provider call and the quota mapping stay here. */
  async function runSlotSearch(slot: DaySlot) {
    const q = (slotSearch?.key === slot.key ? slotSearch.q : '').trim()
    if (q.length < 2 || slotSearch?.busy) return
    if (!searchContextForSlot(slot)) {
      toast('Day · Not ready · Reload trip', 'err')
      return
    }
    slotAbort.current?.abort()
    const controller = new AbortController()
    slotAbort.current = controller
    setSlotSearchScope(searchScopeNow)
    setSlotSearch({ key: slot.key, q, busy: true, hits: [], err: null })
    try {
      await runSlotSearchFlow({
        guard: slotGuard.current,
        slot,
        query: q,
        controller,
        search: (query, signal) => searchPlacesText(query, { routeCoords: routeGeometry, anchors, signal }),
        rank: hits => hits
          .map(h => ({ h, off: asymmetricDetourKm(h, anchors, routePolyline) }))
          .sort((a, b) => (a.off ?? 9999) - (b.off ?? 9999))
          .map(x => x.h),
        isQuotaError: err => err instanceof QuotaExhaustedError,
        commit: patch => setSlotSearch(s => (s && s.key === slot.key ? { ...s, ...patch } : s)),
        onEmpty: query => toast(`Search "${query}" · No places`),
      })
    } catch (err) {
      // The flow reports its own failures. A throw from the commit or toast
      // callbacks must not leave the box busy for the current context.
      console.error('[yatraflow] slot search flow threw', err)
      if (slotGuard.current.current()) {
        setSlotSearch(cell => (cell && cell.key === slot.key ? { ...cell, busy: false, err: SLOT_SEARCH_FAILED_COPY } : cell))
      }
    }
  }

  /** Delete straight from the map pin's popup. Since #424 this is THE
   *  destructive-stop path, shared with the Timeline's day row and the Board's
   *  card: the removal is staged as an impact preview (so Keep/Remove is the
   *  confirmation) and the Keep moment leaves an Undo that restores the stop on
   *  its day at its old order. It used to write the cache directly and refuse
   *  while a preview was open, which is precisely the divergence the shared path
   *  removes — the same delete now behaves the same way wherever it is clicked,
   *  and it chains onto an open preview instead of declining to act.
   *
   *  `meta.title` stays part of this popup's contract (it labels the pin), but
   *  the toast is built from the row's own title, because that is the object the
   *  Undo restores.
   *
   *  The stop's row still drops out through the local re-derivation once the
   *  write lands (#346: stopSig → slots, identity/altPool → pool cards). The
   *  corridor plan is still true — deleting one planned stop does not unplan the
   *  road — so no forced re-search fires and no spinner flashes. */
  function removeStopFromMap(stopId: string, meta: { title: string; dayIndex: number }) {
    removeStopWithUndo({ trip, stopId, dayIndex: meta.dayIndex, applyChange })
  }

  // #905-#907: the add preview, the stop editor and the keyboard reorder. Every
  // write still goes through `applyChange`; removal stays on `removeStopWithUndo`.
  // `edit.previewRoad` is the proposed road TripMap draws as a dashed ghost line.
  const keepWriterRef = useRef<((hit: PlaceHit, dayIndex: number) => Promise<void>) | null>(null)
  const edit = useMapEdit({
    trip, editable, applyChange, legCorrections, routeKmOf,
    removeStop: removeStopFromMap,
    onAddKept: hit => {
      recordDnaEvent({ tripId: trip.id, action: 'accept', haltKind: hit.haltPurpose, category: hit.category, detourMin: asymmetricDetourMinutes(hit, anchors, routePolyline ?? null, MODE_SPEED[trip.transportMode] ?? 40) ?? undefined, visitMin: visitMinutesForCategory(hit.category) })
      setDnaTick(t => t + 1)
    },
    keepWithWriter: (hit, dayIndex) => keepWriterRef.current ? keepWriterRef.current(hit, dayIndex) : Promise.reject(new Error('writer not ready')),
  })
  /** The facts of the open add preview. Null when no preview is open. */
  const openPreview = edit.session.phase === 'previewing' || edit.session.phase === 'saving' ? edit.session.preview : null
  // The chip finds its row by the day's stop id, never by a stop title.
  const previewChip = openPreview
    ? {
      index: openPreview.insertion.index,
      stopIds: (trip.days.find(day => day.index === openPreview.dayIndex)?.stops ?? []).map(stop => stop.id),
      label: openPreview.road.legIn?.toTitle ?? openPreview.road.legOut?.fromTitle ?? null,
    }
    : null

  /** #841: a route arc's "Add all" stages through the shared writer: one
   *  operation gate, the shared planner, a stable day target per place and a
   *  guarded Undo. Staging changes nothing the traveller sees as added. Only the
   *  places the acknowledged save verified become added ids, DNA events and
   *  Undo targets; the rest stay on the rail with their reason. */
  async function addArc(arc: { label: string; hitIds: readonly (string | number)[] }) {
    const label = arc.label.split(':')[0]
    const plan = arcPickPlan({
      hitIds: arc.hitIds,
      arcHits,
      isAdded: h => isAlreadyAdded(h, identity),
      dayForKm,
      dayIdForIndex: index => stableDayIdFor(trip, index),
    })
    const arcDeps = (): WriterActionDeps => ({
      trip,
      applyChange,
      resolvePick,
      mintStopId: newStopId,
      gate: mapWriterOperationGate,
      routeKmOf,
      road: roadGrade.measured ? { routeKey: roadGrade.routeKey } : null,
      currentTrip: () => tripById(trip.id),
      poiVisitMinutes,
      onCompletion: onArcCompletion,
      ...(roadBinding ? { roadBinding } : {}),
      ...(currentRoad ? { currentRoad } : {}),
    })
    const report = (staged: ArcStageOutcome) => {
      const line = arcStageLine(label, staged)
      toast(line.text, line.tone === 'err' ? 'err' : undefined)
    }
    function onArcCompletion(completion: WriterCompletion) {
      const done = arcCompletionEffects(label, completion)
      if (done.addedIds.length > 0) {
        setAddedIds(prev => new Set([...prev, ...done.addedIds]))
        for (const placed of done.dnaHits) {
          recordDnaEvent({ tripId: trip.id, action: 'accept', haltKind: placed.haltPurpose, category: placed.category, detourMin: asymmetricDetourMinutes(placed, anchors, routePolyline ?? null, MODE_SPEED[trip.transportMode] ?? 40) ?? undefined, visitMin: visitMinutesForCategory(placed.category) })
        }
        setDnaTick(t => t + 1)
      }
      if (done.line.tone === 'err') {
        // F2: an uncertain arc carries the gate's exact retry ticket. The
        // retry replays the captured operation and payload; it never rebuilds
        // the picks from the current rail.
        const ticket = completion.retry
        if (ticket) {
          toast(done.line.text, 'err', { label: 'Retry', run: () => { void retryArcAdd(arcDeps(), plan, ticket).then(report).catch(err => { console.error('[yatraflow] arc retry threw', err); toast('Retry · Unavailable · Check Saved edits', 'err') }) } })
          return
        }
        toast(done.line.text, 'err')
        return
      }
      undoToast(done.line.text, () => {
        void guardedUndo(
          { currentTrip: () => tripById(trip.id), admit: admitTripPreview },
          { tripId: trip.id, operationId: completion.operationId, stops: done.undoStops },
        ).then(result => {
          const undone = arcUndoLine(label, result)
          toast(undone.text, undone.tone === 'err' ? 'err' : undefined)
        })
      })
    }
    report(await stageArcAdd(arcDeps(), { tripId: trip.id, plan }))
  }

  const dayOptions = trip.days.map(d => ({ index: d.index }))

  // #420 slice 13: the rail content (split, pool, arcs)
  // lives in ./map/useRailContent. Values only, never callbacks — the
  // render-called helpers stay with the page for the rails slice.
  // #08 AC5: the upstream detour km. The rail reads this same function
  // through the hook, and so does the corridor snapshot. Defined before the hook.
  const detourKmFor = useCallback(
    (hit: PlaceHit): number | null => asymmetricDetourKm(hit, anchors, routePolyline),
    [anchors, routePolyline],
  )
  const { needs, seeAndDoLive, altPool, arcHits, arcs } = useRailContent({
    pois, identity, detourKmFor,
  })

  // #08 AC5: the ONE per-hit detour computation. It is upstream of the
  // corridor snapshot, so the drive rows and every covered surface read the
  // same number. It is no longer re-derived inside the rail hook.
  const hitEngine = useMemo(() => {
    const speedK = MODE_SPEED[trip.transportMode] ?? 40
    const m = new Map<string, { detourMin: number | null }>()
    for (const sh of pois) {
      if (!sh.hit) continue
      m.set(String(sh.hit.id), { detourMin: asymmetricDetourMinutes(sh.hit, anchors, routePolyline ?? null, speedK) })
    }
    return m
  }, [pois, anchors, routePolyline, trip.transportMode])

  // A hit outside the corridor (a search or omnibar hit) has no drive row, so
  // its detour is measured here once. This is the honest uncovered fallback,
  // not a parallel cost path for covered hits.
  const detourMinFor = useCallback((hit: PlaceHit): number | null =>
    hitEngine.get(String(hit.id))?.detourMin
      ?? asymmetricDetourMinutes(hit, anchors, routePolyline ?? null, MODE_SPEED[trip.transportMode] ?? 40),
  [hitEngine, anchors, routePolyline, trip.transportMode])
  // #841: the writers' measured-road grade, read from the workspace's finished
  // measurement. It starts no routing call. A pending, failed, estimate-only or
  // stale chain (a stop moved or was added since it was measured) grades as
  // unmeasured and every placement refuses with a reason, so a line that merely
  // exists on the map is never presented to the planner as a measured road.
  const roadGrade = measuredRoadFacts({
    trip,
    road,
    hasLine: !!routePolyline && routePolyline.length > 1,
  })

  // #420 slice 2: the shortlist feature lives in its own hook now — the collection,
  // the shared "already mine?" filter, and both batch writers. Called here rather
  // than at the top because it composes with `detourMinFor` (and `dayForKm`,
  // `identity`), and a hook below an early return is the crash AGENTS §6e names —
  // this component has none, so the position is safe and the order is stable.
  const {
    shortlist, trayShortlist, isShortlisted, toggleShortlist, addShortlisted, raiseShortlistVote, clearShortlist,
  } = useShortlist({
    tripId: trip.id,
    identity,
    resolvePick,
    applyChange,
    setAddedIds,
    newStopId,
    dayForKm,
    dayIdForIndex: index => stableDayIdFor(trip, index),
    poiVisitMinutes,
    routeKmOf,
    detourMinFor,
    roadBinding,
    currentRoad,
    busy: addingAny,
    setBusy: setAddingAny,
    // #841: the measured grade and the chain signature the planner binds to.
    // A line on the map alone never makes a write "measured".
    roadMeasured: roadGrade.measured,
    ...(roadGrade.measured ? { routeKey: roadGrade.routeKey } : {}),
  })
  const filterActive = chipFilter != null
  // Compare each sight with the budget left after known planned detours.
  const { budgetHeldIds, budgetHeldCount } = useMemo(() => {
    const byDay = new Map<number, SegmentHit[]>()
    for (const sh of seeAndDoLive) {
      if (!sh.hit) continue
      const d = dayForKm(sh.hit.cumKm) ?? 0
      const list = byDay.get(d) ?? []
      list.push(sh)
      byDay.set(d, list)
    }
    const walks: DayBudgetWalk[] = [...byDay].map(([d, rows]) => {
      const budget = dayDetourBudgetMin({
        travelStyle: trip.travelStyle,
        plannedStops: (trip.days.find(x => x.index === d)?.stops ?? []).filter(s => s.status !== 'rejected').length,
      })
      const day = journeyDays.byDay.get(d)
      return {
        budgetMin: budget,
        planned: plannedDriveBudget(day?.dayStops ?? [], day?.projection.rows ?? [], budget, corridorReady),
        rows: rows.flatMap(sh => sh.hit ? [{ id: String(sh.hit.id), detourMin: detourMinFor(sh.hit) ?? null }] : []),
      }
    })
    const heldIds = budgetHeldAlternativeIds(walks)
    return { budgetHeldIds: heldIds, budgetHeldCount: heldIds.size }
  }, [seeAndDoLive, dayForKm, detourMinFor, trip.travelStyle, trip.days, journeyDays, corridorReady])
  // S2: publish the corridor facts the future workspace producer reads. The
  // callback is read through a ref, so a parent re-render cannot republish.
  // Only a changed snapshot key reaches the workspace.
  const corridorStatus: CorridorSnapshot['status'] = corridorStatusFor({ quota: scanQuotaOut, scanFailed, loading: loadingPois })
  const onCorridorStateRef = useRef(onCorridorState)
  useEffect(() => { onCorridorStateRef.current = onCorridorState }, [onCorridorState])
  const publishedCorridorKeyRef = useRef<string | null>(null)
  const corridorSnapshot = useMemo<CorridorSnapshot | null>(() => {
    if (corridorSource === 'none') return null
    return {
      tripId: trip.id,
      inputsHash: poisInputsHash ?? mapInputsHash,
      scopeKm: poisScopeKm ?? scopeKm,
      status: corridorStatus,
      source: corridorSource,
      pois,
      anchors,
      routePolyline: routePolyline ?? null,
      drivingPlan,
      dayAttribution,
      dayAttributionKey,
      altPool: altPool.all.map(entry => entry.h),
      detourMinFor,
      detourKmFor,
      heldBackIds: budgetHeldIds,
      fetchedAt: scanFetchedAt,
      coverage: scanCoverage,
      discoveryDayIndex,
    }
  }, [scanFetchedAt, scanCoverage, discoveryDayIndex, corridorSource, trip.id, mapInputsHash, scopeKm, poisInputsHash, poisScopeKm, corridorStatus, pois, anchors, routePolyline, drivingPlan, dayAttribution, dayAttributionKey, altPool, detourMinFor, detourKmFor, budgetHeldIds])
  useEffect(() => {
    const next = corridorSnapshot
    // P2: an initial `none` while a route exists is "not initialized yet", not
    // a clear. Only a genuinely route-less Map clears the workspace snapshot.
    const clear = !next && corridorSource === 'none' && anchors.length === 0
    if (!next && !clear) return
    const key = next ? corridorSnapshotKey(next) : 'none'
    if (publishedCorridorKeyRef.current === key) return
    publishedCorridorKeyRef.current = key
    onCorridorStateRef.current?.(next)
  }, [corridorSnapshot, corridorSource, anchors.length])
  // S3: the rail reads the shared producer's one drive-row assembly. The page
  // no longer re-assembles the same rows.
  const driveRows = journeyDays.allDriveRows
  // #08 AC5: the marker's cost sentence formats the canonical drive-row facts,
  // never a second detour/arrival/budget computation of its own.
  // The cost line of a pin reads in the reader's 12 h or 24 h clock.
  const hitCosts = useMemo(() => Object.fromEntries(Object.entries(journeyCostLabels(driveRows)).map(([id, text]) => [id, formatClocksInText(text, timeFormat)])), [driveRows, timeFormat])
  const seeForRail = chipFilter
    ? seeAndDoLive.filter(sh => sh.hit && (driveRowForHit(driveRows, sh.hit)?.chips ?? []).some(c => c.key === chipFilter))
    : seeAndDoLive
  // Quota honesty (Google-only directive): when the textSearchPro soft cap is
  // hit, every Google-mode corridor scan returns [] — say why instead of
  // rendering an empty state that reads like "nothing around".
  const corridorQuotaBlocked = corridorQuotaOut || searchQuotaOut || anyQuotaExhausted('textSearchPro', 'nearbySearch', 'placeDetails')
  const quotaOut = googleEnabled() && corridorQuotaBlocked
  // #898: the scope counts read the rows already held. Loading, failed, paused and
  // retained stay apart, so a failed read never shows as "0 inside".

  /**
   * "Also nearby" candidates, pre-grouped once per render instead of per row.
   * Detour distance is the expensive part (it walks the anchor list), so it is
   * computed once per hit here; rows only rank the already-filtered pool.
   */

  // ---- P2: the day's plan (slots rail) ----
  // S3: the shared producer derives every day once. The Map reads its active
  // entry; it does not call `daySlots`, `tripReadiness` or `useDaySlots`.
  const journeyDay = journeyDays.byDay.get(activeDayIndex)
  const activeDayStops = journeyDay?.dayStops ?? []
  const activeDaySlots = journeyDay?.slots ?? []
  const activeDayReadiness = journeyDays.readinessByDay.get(activeDayIndex)
    ?? { dayIndex: activeDayIndex, filled: 0, total: 0, auto: 0, required: 0 }
  const tripReadinessRows = journeyDays.readinessRows
  const dnaSlotHints = journeyDays.dnaSlotHints
  const slotPins = (journeyDays.slotPinsByDay.get(activeDayIndex) ?? []).map(pin => ({ ...pin, meta: formatClocksInText(pin.meta, timeFormat) }))
  const daySlotDeps = journeyDays.daySlotDeps

  // #I-41: the day the stop editor opens on lives in ./map/useOmnibarPlacement
  // now (moved there by #420 slice 7) — one lookup feeds the placement label
  // and the click, so the label and the editor cannot name two different days.
  // An unknown road position falls back to the trip's first day — the same
  // fallback the editor applies.
  const { omniPlacement, placeOmnibarHit } = useOmnibarPlacement({
    picked: omniPicked,
    activeDayIndex,
    days: trip.days,
    dayForKm,
    activeDaySlots,
    shortlist,
    trayShortlist,
    identity,
    openAddModal,
    addManualCandidate: (slot, h) => addManualCandidate(slot, h),
    toggleShortlist,
    raiseShortlistVote,
  })
  const [openSlotKey, setOpenSlotKey] = useState<string | null>(null)
  // #420 slice 17: the slot filing writer lives in ./map/useSlotSearch —
  // the query state, the manual picks and the runner stay page cells (see
  // the hook's header for why the split falls here). Handler-only output,
  // called from event handlers and the placement hook below, never render.
  const { addManualCandidate } = useSlotSearch({
    slotManual, setSlotManual, setSlotSearch, identity,
    // #841: a filing is accepted only from the search typed on THIS trip and day.
    isSearchCurrent: slotKey => isSlotSearchCurrent(slotSearchCell, slotSearchScope, searchScopeNow, slotKey),
  })
  // P1: closing or switching parts, days or trips drops the in-flight search.
  // #841: the guard reset retires the captured context, so a query still in the
  // air cannot file rows, an error or a busy reset into the new context.
  const searchResetKey = slotSearchResetKey(searchScopeNow, openSlotKey)
  const [searchResetSeen, setSearchResetSeen] = useState(searchResetKey)
  if (searchResetSeen !== searchResetKey) {
    setSearchResetSeen(searchResetKey)
    setSlotSearch(null)
  }
  useEffect(() => {
    slotGuard.current.reset()
    slotAbort.current?.abort()
  }, [openSlotKey, activeDayId, trip.id])
  /** m5: `DaySlotKind` is exactly the four keys the hints are built for, so an
   *  unknown kind yields nothing. The old ternary's last branch fell through to
   *  the stretch hint, which would quietly mislabel any future kind. */
  const slotPattern = (kind: DaySlotKind): string | null => dnaSlotHints[kind] ?? null
  const [fillingDay, setFillingDay] = useState(false)
  // #841: the writers get the stable day, the shared presence identity, the
  // measured-road grade and the detour measures. `dayPlan` is the day's ONE
  // effective plan: the rows, the counts, the vote button and the batch all read
  // it, so a pair on screen is the pair the vote and the fill select from.
  const { addPoiToDay, fillSlot, fillTheDay, raiseSlotVote, dayPlan } = useMapWriters({
    resolvePick, applyChange, trip, pois, routeKmOf, anchors, routePolyline,
    roadBinding, currentRoad,
    activeDayIndex, activeDaySlots, markStaged, addingAny, addingIdsRef,
    setAddingIds, setAddingAny, fillingDay, setFillingDay, setDnaTick,
    setOpenSlotKey, onOpenGroupInput,
    dayId: journeyDay?.dayId ?? activeDayId ?? null,
    presence: identity,
    roadMeasured: roadGrade.measured,
    ...(roadGrade.measured ? { routeKey: roadGrade.routeKey } : {}),
    detourMinFor,
    detourKmFor,
    displayDayPlan: journeyDay?.dayPlan,
    slotManual,
  })
  // The Keep button reads this ref on a click, after the commit.
  useEffect(() => { keepWriterRef.current = addPoiToDay })
  const dayCounts = planCounts(dayPlan)
  // The open part's live-region line reads the same effective rows the cards show.
  const openAnnouncement = openSlotAnnouncement(dayPlan, openSlotKey)
  /** The day's detour budget, read by the itinerary. */
  const mapBudget = journeyDay?.budgetMin ?? dayDetourBudgetMin({ travelStyle: trip.travelStyle, plannedStops: activeDayStops.filter(stop => stop.status !== 'rejected').length })
  // P1: the rail and card read the whole-trip producer, not only the active day.
  const mapRows = mapAllJourneyRowsForDays(journeyDays.byDay.values(), journeyDays.allDriveRows)
  // #420 slice 16: thin JSX factory — one rail row's data lives here, its
  // rendering lives in map/RailRowViews. Every fact below comes from the shared
  // projection row; chips and rail state are the only presentation extras.
  const ledgerRow = (sh: SegmentHit) => {
    const hit = sh.hit
    const row = hit ? mapRailRowForHit(mapRows, hit, dayForKm(hit.cumKm)) : undefined
    // Unknown/out-of-range rows keep the existing unprojected search facts and
    // are never guessed onto a day. The whole-trip adapter covers other days.
    const drive = hit ? driveRowForHit(journeyDays.allDriveRows, hit) : undefined
    const detourMin = row ? row.detourMin : drive?.detourMin ?? (hit ? detourMinFor(hit) : undefined)
    const dismissHit = () => {
      if (!hit) return
      recordDnaEvent({ tripId: trip.id, action: 'decline', haltKind: sh.segment.purpose, category: hit.category, detourMin: detourMin ?? undefined })
      // Dismiss is a local rail decision: keep the current plan visible
      // and do not invalidate/rebill the corridor. DNA is persisted and
      // will be read by the next explicit replan.
      setDismissedIds(prev => new Set(prev).add(hit.id as string))
    }
    return (
      <LedgerRow
        key={hit ? String(hit.id) : `gap-${sh.segment.index}`}
        sh={sh}
        dismissed={row ? row.state === 'dismissed' : drive ? drive.state === 'dismissed' : !!hit && dismissedIds.has(hit.id as string)}
        added={row ? row.state === 'added' : hit ? isAlreadyAdded(hit, identity) : false}
        detourMin={detourMin}
        hitDay={row ? row.dayIndex : hit ? dayForKm(hit.cumKm) : null}
        chips={row?.chips ?? drive?.chips ?? []}
        altPool={altPool}
        chipFilter={chipFilter}
        presentation="deck"
        editable={editable}
        shortlisted={hit ? isShortlisted(hit) : false}
        onSelectChip={key => setChipFilter(prev => (prev === key ? null : key))}
        onAdd={() => { if (hit) openAddModal(hit) }}
        onDismiss={dismissHit}
        onToggleShortlist={() => { if (hit) toggleShortlist(hit) }}
        onOpenAlt={h => openAddModal(h)}
        onWiden={widenScope}
        onInspect={() => { if (hit) inspectHit(hit, { slotKey: row?.slotKey ?? null, slotRef: row?.slotRef ?? null, stopId: row?.stopId ?? null }) }}
      />
    )
  }
  /** P6.1: the rail's second reading - the day as a shape on one clock. */
  const [shapeView, setShapeView] = useState(false)
  // Derived only while the Shape view is open, and handed the slots already
  // computed for the rail so the day is not derived a third time. The call is
  // plain (no manual memo) because a manual memo here made the render-compiler
  // lint treat the slot list as mutated later.
  const shapeBlocks = shapeView && daySlotDeps
    ? dayShape(activeDayIndex, { ...daySlotDeps, dayStops: activeDayStops }, activeDaySlots)
    : []
  const phoneSheet = useMedia('(max-width: 760px)')

  // W14: MapLibre starts its compact attribution open and can open it again on
  // a style load. The board shows the (i) button alone, on desktop and on a
  // phone, so the full credit line never runs across the marks. A bounded set of
  // late passes closes it after the lazy map mounts; a tap by the reader wins,
  // and no observer runs, so a re-open cannot loop.
  useEffect(() => {
    let openedByReader = false
    const onPointerDown = (event: Event) => {
      if ((event.target as Element | null)?.closest('.maplibregl-ctrl-attrib-button')) openedByReader = true
    }
    const collapse = () => {
      if (openedByReader) return
      const node = document.querySelector('.mv2-workspace .maplibregl-ctrl-attrib')
      if (!node) return
      node.classList.remove('maplibregl-compact-show')
      node.removeAttribute('open')
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    const timers = [0, 250, 750, 1500, 3000, 5000, 8000].map(ms => window.setTimeout(collapse, ms))
    return () => {
      timers.forEach(timer => window.clearTimeout(timer))
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [])
  const compactMap = useMedia('(max-width: 1180px)')
  const [itineraryOpen, setItineraryOpen] = useState(true)
  // One panel at a time on a wide screen: the day rail shows, and the suggestions
  // open from a lens. The phone sheet keeps its deck, because it peeks below the map.
  const [deckOpen, setDeckOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches)
  const [snap, setSnap] = useState<SheetSnap>('peek')
  // A closing panel stays mounted for its exit, so it slides out in place of a cut.
  const railPresence = usePresence(itineraryOpen)
  const deckPresence = usePresence(deckOpen)
  // The one lens pill owns the map marks and the rail deck (W3-W).
  const [lens, setLens] = useState<MapLensId>('drive')
  const [driveTab, setDriveTab] = useState<DriveTab | null>(null)
  const [stayWindow, setStayWindow] = useState<string | null>(null)
  const [stayRing, setStayRing] = useState<RingId>('walk-15')

  // W3-W: one lens model for the active day. A count stays null until its lens
  // is ready, so a failed read never shows zero.
  const lensClock = useCallback((min: number) => formatHM(clockHM(min), timeFormat), [timeFormat])
  const lensDayLabel = `Day ${activeDayIndex + 1} · ${activeDayLabel(trip.days, activeDayIndex)}`
  // The stay lens's free evening waits for the day's fixed booking. These are
  // the facts stayLens.stayWindows turns into the one window that the rail, the
  // deck header and each pick's start time read.
  const stayBaseForEvening = activeDayIndex == null ? null : resolveStayBase(trip, activeDayIndex)
  const stayBaseStopForEvening = stayBaseForEvening?.kind === 'stop'
    ? trip.days.flatMap(day => day.stops).find(stop => stop.id === stayBaseForEvening.stopId) ?? null
    : null
  const stayBaseAt = stayBaseStopForEvening == null || !journeyDay?.daySchedule
    ? -1
    : journeyDay.daySchedule.activeStops.findIndex(entry => entry.id === stayBaseStopForEvening.id)
  const stayBaseArriveMin = stayBaseAt >= 0 && journeyDay?.daySchedule
    ? hmToMinutes(journeyDay.daySchedule.arrivalTimes[stayBaseAt])
    : null
  const stayCommitment = stayBaseArriveMin == null ? null : trip.fixedCommitments
    .filter(entry => entry.dayIndex === activeDayIndex && entry.time != null && hmToMinutes(entry.time) > stayBaseArriveMin)
    .sort((a, b) => hmToMinutes(a.time) - hmToMinutes(b.time))[0] ?? null
  const commitmentStop = stayCommitment?.stopId == null
    ? null
    : trip.days.flatMap(day => day.stops).find(stop => stop.id === stayCommitment.stopId) ?? null
  const stayTravelMin = stayBaseStopForEvening == null || commitmentStop == null
    ? null
    : Math.round(legBetween(stayBaseStopForEvening, commitmentStop, getAssumptions(trip)).durationMinutes)
  const stayEveningBook = stayCommitment == null
    ? null
    : {
      startMin: hmToMinutes(stayCommitment.time),
      visitMin: commitmentStop != null && typeof commitmentStop.visitMinutes === 'number' ? commitmentStop.visitMinutes : null,
      backMin: stayTravelMin,
    }
  const lenses = useMapLenses({
    trip,
    dayIndex: activeDayIndex,
    status: journeyDays.status,
    rows: journeyDay?.projection.rows ?? [],
    slots: activeDaySlots,
    budgetMin: mapBudget,
    schedule: journeyDay?.daySchedule ?? null,
    clock: lensClock,
    dayLabel: lensDayLabel,
    legCorrections,
    eveningBook: stayEveningBook,
  })
  const activeStayWindowId = stayWindow != null && lenses.stay.windows.some(window => window.id === stayWindow)
    ? stayWindow
    : lenses.stay.windows[0]?.id ?? null
  const stayRingDef = STAY_RINGS.find(ring => ring.id === stayRing) ?? STAY_RINGS[0]
  // Both reach rings draw, each with its caption. The chosen ring comes first: the
  // camera frames it and only it wears the wash.
  const stayBaseForRings = lenses.stay.base
  const stayRings = lens === 'stay' && stayBaseForRings != null
    ? [stayRingDef, ...STAY_RINGS.filter(ring => ring.id !== stayRingDef.id)].map(ring => ({
      id: ring.id,
      label: `${ring.minutes} min ${ring.mode}`,
      ring: ringPolygon(stayBaseForRings, ringRadiusKm(ring.mode, ring.minutes)),
      active: ring.id === stayRingDef.id,
    }))
    : undefined
  // W10b: the phone sheet hides the bottom of the map. Its live height is the
  // bottom inset, measured again when a snap transition ends.
  const [phoneSheetHeight, setPhoneSheetHeight] = useState(0)
  useEffect(() => {
    if (!phoneSheet) return
    const sheet = [...document.querySelectorAll('.map-ideas-grid .poi-col, .map-ideas-grid .mv2-detail')]
      .find(el => !el.hasAttribute('hidden') && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none')
    if (!sheet) return
    const measure = () => setPhoneSheetHeight(Math.round(sheet.getBoundingClientRect().height))
    measure()
    sheet.addEventListener('transitionend', measure)
    return () => sheet.removeEventListener('transitionend', measure)
  }, [phoneSheet, snap, sheetTab, deckOpen])
  // The sheet leaves the Stay ring behind it. On a phone the ring is framed as
  // a bounds target, so the same insets that clear the sheet also fit the ring.
  const stayBaseLat = lenses.stay.base?.lat
  const stayBaseLng = lenses.stay.base?.lng
  const phoneStayTarget = useMemo<MapTarget | null>(() => {
    // The snap re-issues the frame so the new sheet height joins the padding.
    void snap
    if (!phoneSheet || lens !== 'stay' || stayBaseLat == null || stayBaseLng == null) return null
    const ring = ringPolygon({ lat: stayBaseLat, lng: stayBaseLng }, ringRadiusKm(stayRingDef.mode, stayRingDef.minutes))
    return { kind: 'bounds', points: ring.map(([lng, lat]) => ({ lat, lng })) }
  }, [phoneSheet, lens, stayBaseLat, stayBaseLng, stayRingDef.mode, stayRingDef.minutes, snap])
  const gapRings = lens === 'gap'    ? lenses.gap.view.rows.flatMap(row => {
      const hit = row.candidates[0]?.hit
      if (!hit || !Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) return []
      return [{
        key: row.slotKey,
        lat: hit.latitude,
        lng: hit.longitude,
        windowText: row.windowMin == null
          ? null
          : `${lensClock(row.windowMin[0])}–${lensClock(row.windowMin[1])}`,
      }]
    })
    : undefined
  const onGapRing = lens === 'gap'
    ? () => { setSheetTab('see'); setDetailId(null); setDeckOpen(true); setSnap('half') }
    : undefined
  const driveGroup = lenses.drive.tabs.tabs.find(group => group.tab === driveTab) ?? lenses.drive.tabs.tabs[0]
  const shownDriveIds = new Set(lens === 'drive' ? (driveGroup?.shown ?? []).map(row => String(row.row.hit.id)) : [])
  const hiddenRows = hiddenDrivePicks(seeForRail, shownDriveIds)
  const drivePickLetters: Record<string, 'A' | 'B' | 'C'> = lens === 'drive'
    ? driveLettersByRoad(lenses.drive.view.rows)
    : {}
  const stayPickLetters: Record<string, 'A' | 'B' | 'C'> = {}
  const activeStayPicks = activeStayWindowId == null ? undefined : lenses.stay.picks[activeStayWindowId]
  if (lens === 'stay' && activeStayPicks?.kind === 'ready') {
    for (const pick of activeStayPicks.picks) {
      if (pick.letter != null) stayPickLetters[String(pick.row.row.hit.id)] = pick.letter
    }
  }
  const gapPickLetters: Record<string, 'A' | 'B' | 'C'> = {}
  if (lens === 'gap') {
    for (const pick of lenses.gap.gaps[0]?.picks.picks ?? []) {
      gapPickLetters[String(pick.candidate.hit.id)] = pick.letter
    }
  }
  const pickLetters = lens === 'drive'
    ? drivePickLetters
    : lens === 'stay'
      ? stayPickLetters
      : lens === 'gap' ? gapPickLetters : undefined
  // The Stay board draws its picks on the map, each with its rank letter. A
  // pick's pin only exists when the hit is in the map's own list, so the active
  // window's picks join it once, by id.
  const stayMapHits = useMemo(() => (lens === 'stay' && activeStayPicks?.kind === 'ready'
    ? activeStayPicks.picks.flatMap(pick => (pick.row.row.hit ? [pick.row.row.hit] : []))
    : []), [lens, activeStayPicks])
  const mapPoisForMap = useMemo(() => {
    if (stayMapHits.length === 0) return mapPois
    // One pin per place: an id or the same name already on the map wins, so a
    // manual slot hit never draws a second pin over its own scan result.
    const seenIds = new Set(mapPois.map(hit => String(hit.id)))
    const seenNames = new Set(mapPois.map(hit => hit.name.trim().toLowerCase()))
    const extra = []
    for (const hit of stayMapHits) {
      const id = String(hit.id)
      const name = hit.name.trim().toLowerCase()
      if (seenIds.has(id) || seenNames.has(name)) continue
      seenIds.add(id)
      seenNames.add(name)
      extra.push(hit)
    }
    return extra.length === 0 ? mapPois : [...mapPois, ...extra]
  }, [mapPois, stayMapHits])
  const pickBands: Record<string, 'just-past' | 'over-budget'> = {}
  if (lens === 'drive') {
    for (const row of lenses.drive.view.rows) {
      const band = scopeBandOf(row, scopeMinutes, budgetHeldIds)
      if (band === 'just-past' || band === 'over-budget') pickBands[String(row.row.hit.id)] = band
    }
  }
  // W20: the words on a pick that lies past the scope, from the same rows and
  // the same band rule as the deck. A pick with no known detour gets no words.
  const pickTags: Record<string, string> = {}
  if (lens === 'drive') {
    for (const row of lenses.drive.view.rows) {
      const band = pickBands[String(row.row.hit.id)]
      if (band == null) continue
      const words = pickBandTag(band, row.detourMin, scopeMinutes)
      if (words != null) pickTags[String(row.row.hit.id)] = `${row.row.hit.name} · ${words}`
    }
  }
  // W4-B: the scope band reads the same rows and the same band rule as the deck.
  const driveCounts: ScopeBandCounts | null = lens === 'drive' && lenses.drive.phase === 'ready'
    ? bandCounts(distinctPlaceBands(lenses.drive.view.rows.map(row => ({ id: String(row.row.hit.id), band: scopeBandOf(row, scopeMinutes, budgetHeldIds) }))))
    : null
  // W14: the day's open windows in road order. Every lens reads the same gap
  // rows, so a window the Gap lens names is the window the rail and the strip
  // draw. A part with no proven window has no row.
  const firstMealGap = lenses.gap.view.rows.findIndex(row => activeDaySlots.find(entry => entry.key === row.slotKey)?.kind === 'meal')
  // A window that closes before the day starts is not on the road.
  const dayStartMin = hmToMinutes(trip.days.find(entry => entry.index === activeDayIndex)?.startTime ?? '')
  // A window names its km the way the pin chips do: from the day's own start,
  // not from the trip's first metre. The board's lunch sits at km 57 of Day 3.
  const dayOrigin = originOf(trip, activeDayIndex)
  const dayStartKm = dayOrigin == null ? null : routeKmOf(dayOrigin.lat, dayOrigin.lng)
  const dayKmBase = dayStartKm != null && Number.isFinite(dayStartKm) ? dayStartKm : 0
  const dayHasStay = trip.days.find(day => day.index === activeDayIndex)?.stops.some(stop => stop.category === 'hotel' && stop.status !== 'rejected') ?? false
  // A synthesized window has no target km. Its own picks carry the road
  // position, so the row names where the picks are, never "km 0".
  const gapWindowKm = (row: typeof lenses.gap.view.rows[number], index: number): number | null => {
    const slot = activeDaySlots.find(entry => entry.key === row.slotKey)
    const part = lenses.gap.gaps[index]
    return windowAroundKm(slot?.segment?.targetKm, (part?.picks.picks ?? []).map(pick => {
      const hit = pick.candidate.hit
      return hit.alongRouteKm ?? hit.cumKm ?? routeKmOf(hit.latitude, hit.longitude)
    }))
  }
  const gapRailWindows: ItineraryWindowRow[] = lenses.gap.view.rows.flatMap((row, index) => {
    if (row.windowMin == null || (dayStartMin > 0 && row.windowMin[1] <= dayStartMin)) return []
    const slot = activeDaySlots.find(entry => entry.key === row.slotKey)
    const part = lenses.gap.gaps[index]
    const km = gapWindowKm(row, index)
    // A dinner window with no road position is dinner at the day's stay.
    const aroundKm = aroundKmText(km == null ? null : km - dayKmBase)
    const aroundStay = row.slotKey === 'dinner' && aroundKm == null && dayHasStay ? 'Around the stay' : null
    const detail = [aroundKm ?? aroundStay, picksText(part?.picks.picks.length)].filter((piece): piece is string => piece != null).join(' · ')
    return [{
      label: part?.title ?? slot?.label ?? row.slotKey,
      startMin: row.windowMin[0],
      endMin: row.windowMin[1],
      atMin: windowAtMin(row.windowMin[0], row.windowMin[1], slot?.segment?.etaMinutes),
      detail: detail === '' ? null : detail,
      active: lens === 'gap' ? index === 0 : lens === 'drive' && driveGroup?.tab === 'meal' && index === firstMealGap,
      slotKey: row.slotKey,
    }]
  })
  const stayBaseId = lens === 'stay' && activeDayIndex != null ? (() => { const base = resolveStayBase(trip, activeDayIndex); return base.kind === 'stop' ? base.stopId : null })() : null
  const stayEvening = lenses.stay.windows.find(window => window.id === 'evening') ?? null
  const stayBaseStop = stayBaseId == null ? null : trip.days.flatMap(day => day.stops).find(stop => stop.id === stayBaseId) ?? null
  // The board names the place, not the stop's action label: a base titled
  // "Check in · Spice Village" in Thekkady reads "Thekkady · evening". The
  // trip's own destination for that day wins, then the day title's "to X"
  // (where the day ends), then the saved place with its action prefix gone.
  const stayPlace = stayBaseStop?.locationName?.replace(/^(?:check[ -]?in|arrive|stay|dinner|lunch|breakfast)\s*[·:]\s*/i, '').trim() ?? null
  const dayTitle = trip.days.find(day => day.index === activeDayIndex)?.title ?? ''
  const titleTo = /(?:\bto\b|→)\s*([^,·]+)$/i.exec(dayTitle)?.[1]?.trim() ?? null
  const stayTown = trip.destinations[activeDayIndex] ?? (titleTo === '' ? null : titleTo) ?? stayPlace
  // The day header reads town to town: where the day starts, and the night-halt
  // town it ends in, never the last stop's own name.
  const dayHotel = [...(trip.days.find(day => day.index === activeDayIndex)?.stops ?? [])].reverse().find(stop => stop.category === 'hotel' && stop.status !== 'rejected') ?? null
  const headerEndTown = dayEndTown({ dayTitle, hotelPlace: dayHotel?.locationName ?? null, hotelTitle: dayHotel?.title ?? null })
  const stayRailWindows: ItineraryWindowRow[] = lens === 'stay'
    ? [
      ...lenses.stay.windows.map(window => {
        const found = lenses.stay.picks[window.id]
        const total = found?.kind === 'ready' ? found.picks.length + found.alsoCount : null
        const text = picksText(total)
        return {
          label: window.label, startMin: window.startMin, endMin: window.endMin,
          active: window.id === activeStayWindowId,
          detail: text == null ? null : window.id === 'evening' ? `${text} nearby` : text,
          nextDayLabel: window.id === 'morning' ? `Day ${activeDayIndex + 2}` : null,
                    boxOnly: true,
        }
      }),
      ...gapRailWindows.filter(row => stayBaseArriveMin != null && row.startMin >= stayBaseArriveMin).filter(row => row.label !== 'Free evening').map(row => ({ ...row, active: false })),
    ]
    : []
  const railWindows = lens === 'stay' ? stayRailWindows : gapRailWindows
  const stayFree = stayEvening != null
    ? windowDurationText(stayEvening.startMin, stayEvening.endMin) != null
      ? { startMin: stayEvening.startMin, endMin: stayEvening.endMin }
      : null
    : null
  const stayTownSub = stayRailTitle(stayTown, false)
  // The stay header says "evening" when the stay has a free evening. The base row keeps "tonight".
  const stayHeadTitle = stayRailTitle(stayTown, stayEvening != null)
  const stayView: ItineraryStayView | null = stayBaseId == null ? null : {
    baseStopId: stayBaseId,
    title: stayHeadTitle,
    baseSub: stayTownSub,
    sub: stayRailSub({
      arriveText: stayBaseArriveMin == null ? null : lensClock(stayBaseArriveMin),
      commitmentTitle: stayCommitment?.title ?? null,
      commitmentText: stayCommitment == null ? null : lensClock(hmToMinutes(stayCommitment.time)),
      freeStartMin: stayFree?.startMin ?? null,
      freeEndMin: stayFree?.endMin ?? null,
      noFreeEvening: lenses.stay.noFreeTime === true,
    }),
  }
  const fixStopId = lens === 'fix'
    ? fixTargetStopId(lenses.fix.target, trip.fixedCommitments, activeDayIndex)
      ?? trip.fixedCommitments.find(entry => entry.dayIndex === activeDayIndex && entry.stopId != null)?.stopId
      ?? null
    : null
  const problemStop = fixStopId == null
    ? null
    : trip.days.flatMap(day => day.stops).find(stop => stop.id === fixStopId) ?? null
  const problemStopIndex = problemStop != null && journeyDay?.daySchedule
    ? journeyDay.daySchedule.activeStops.findIndex(entry => entry.id === fixStopId)
    : -1
  const problemTime = problemStopIndex >= 0
    ? journeyDay?.daySchedule?.arrivalTimes[problemStopIndex] ?? null
    : null
  const fixCommitment = fixStopId == null
    ? null
    : trip.fixedCommitments.find(entry => entry.dayIndex === activeDayIndex && entry.stopId != null && String(entry.stopId) === String(fixStopId))
      ?? trip.fixedCommitments.find(entry => entry.dayIndex === activeDayIndex)
      ?? null
  const problemClock = problemTime == null ? null : lensClock(hmToMinutes(problemTime))
  const commitmentClock = fixCommitment?.time == null ? null : lensClock(hmToMinutes(fixCommitment.time))
  const fixMarkText = fixMarkFactsLabel(problemStop?.title ?? null, commitmentClock, problemClock)
  // The rail row names the engine's own problem, not a made-up pair of times.
  const fixRowLine = fixRailLine(lenses.fix.problem?.title ?? null, hm => lensClock(hmToMinutes(hm)))
  const fixProblem = lenses.fix.problem
  const fixStopWarning = lens === 'fix' && problemStop != null && fixMarkText != null
    && Number.isFinite(problemStop.lat) && Number.isFinite(problemStop.lng)
    && problemStop.lat !== 0 && problemStop.lng !== 0
    ? {
      stopId: String(problemStop.id),
      label: fixMarkText,
      text: fixMarkText,
      severe: true,
    }
    : null
  const driveBudget = plannedDriveBudget(activeDayStops, journeyDay?.projection.rows ?? [], mapBudget, corridorReady)
  const budgetBarText = driveBudgetBarText(driveBudget)
  const budgetBar = budgetBarText == null ? null : {
    text: budgetBarText,
    step: driveBudgetStep(driveBudget.usedMin, driveBudget.budgetMin),
  }
  function addLensHit(hit: PlaceHit, dayIndex: number) {
    if (!editable || isAlreadyAdded(hit, identity)) return
    edit.startAdd(hit, dayIndex)
  }
  function addStayHit(hit: PlaceHit, dayIndex: number, startMin: number | null) {
    if (!editable || isAlreadyAdded(hit, identity)) return
    if (startMin == null) {
      toast('Pick · Outside free time · No change')
      return
    }
    const stamped: PlaceHit = { ...hit, plannedStartMin: startMin } as PlaceHit
    edit.startAdd(stamped, dayIndex)
  }
  function applyFixAgainst(baseTrip: Trip, set: FixChangeSet) {
    // Check the real plan first. A fix that does not pass its check never writes.
    const checked = verifyFixSet(baseTrip, set, legCorrections)
    if (!fixIsOffered(checked)) {
      toast('Fix · Check failed · No change')
      return
    }
    const next = applyFixChangeSet(baseTrip, checked)
    if (!next) {
      toast('Fix · Unavailable · No change')
      return
    }
    applyChange(draft => {
      for (const changed of next.days) {
        const target = draft.days.find(entry => entry.index === changed.index)
        if (!target) continue
        target.stops = changed.stops.map(stop => ({ ...stop }))
        target.startTime = changed.startTime
      }
      draft.fixedCommitments = next.fixedCommitments.map(entry => ({ ...entry }))
    }, 'edit', checked.dayIndex)
    toast('Fix · Applied')
  }
  function applyLensFix(set: FixChangeSet) {
    setFixPreview(null)
    applyFixAgainst(trip, set)
  }
  function previewLensFix(set: FixChangeSet) {
    setFixPreview(set)
    // Preview draws nothing new: it selects the day and shows the Fix lens.
    chooseDay(set.dayIndex)
    setLens('fix')
    setSheetTab('see')
    setDeckOpen(true)
  }
  const [detailSelection, setDetailSelection] = useState<{ tripId: string; id: string | number; binding: MapRowBinding | null } | null>(null)
  const detailId = detailSelection?.tripId === trip.id ? detailSelection.id : null
  const detailBinding = detailSelection?.tripId === trip.id ? detailSelection.binding : null
  const [targetRequest, setTargetRequest] = useState<{ contextKey: string; target: MapTarget; instant: boolean } | null>(null)
  const [scrubCursor, setScrubCursor] = useState<{ contextKey: string; coordinate: { lat: number; lng: number }; minute: number } | null>(null)
  function setDetailId(id: string | number | null, binding: MapRowBinding | null = null) { setDetailSelection(id == null ? null : { tripId: trip.id, id, binding }) }
  function setLocalTarget(target: MapTarget | null, instant = false) { setTargetRequest(target ? { contextKey: scrubContext, target, instant } : null) }
  const [selectedStop, setSelectedStop] = useState<string | null>(null)
  const detailOpener = useRef<HTMLElement | null>(null)
  const detailOpenerSnap = useRef<SheetSnap>('peek')
  const journey = useMemo(() => {
    const day = trip.days.find(item => item.index === activeDayIndex)
    return day ? buildJourney(trip, day, legCorrections) : null
  }, [trip, activeDayIndex, legCorrections])
  // W20: clock ticks along the drive and the lunch window at its km, read off the
  // engine's own schedule. A day with no drawn road, or a stop off the road, has
  // no marks: the map never invents a position.
  const routeMarks: RouteMark[] = (() => {
    if (lens !== 'drive' || routePolyline == null || journey == null) return []
    const marks: RouteMark[] = []
    const pts = journey.points.filter(point => !point.synthesized || point.legIn != null)
    let km = 0
    const anchors: TickAnchor[] = []
    for (const point of pts) {
      km += point.legIn?.distanceKm ?? 0
      const arriveMin = hmToMinutes(point.arrive)
      const departMin = hmToMinutes(point.depart)
      if (Number.isFinite(arriveMin) && Number.isFinite(departMin)) anchors.push({ km, arriveMin, departMin })
    }
    const first = pts[0]
    const last = pts[pts.length - 1]
    const startKm = first == null ? null : routeKmOf(first.lat, first.lng)
    const endKm = last == null ? null : routeKmOf(last.lat, last.lng)
    if (startKm != null && endKm != null && endKm > startKm && km > 0) {
      for (const tick of clockTicks(anchors)) {
        const at = pointAtKm(routePolyline, startKm + (tick.km / km) * (endKm - startKm))
        if (at == null) continue
        const text = tickText(tick, timeFormat)
        marks.push({ id: `tick:${tick.km}`, kind: 'tick', lat: at.lat, lng: at.lng, label: text.clock, sub: text.km })
      }
    }
    lenses.gap.view.rows.forEach((row, index) => {
      const slot = activeDaySlots.find(entry => entry.key === row.slotKey)
      if (slot?.kind !== 'meal' || row.windowMin == null || (dayStartMin > 0 && row.windowMin[1] <= dayStartMin)) return
      const windowKm = gapWindowKm(row, index)
      if (windowKm == null) return
      const at = pointAtKm(routePolyline, windowKm)
      if (at == null) return
      marks.push({ id: `window:${row.slotKey}`, kind: 'window', lat: at.lat, lng: at.lng, label: windowLabel(lenses.gap.gaps[index]?.title ?? slot.label, row.windowMin[0], row.windowMin[1], timeFormat) })
    })
    return marks
  })()
  // The active day's stops as clock anchors on the road, for a pick's arrival.
  const passAnchors: PassAnchor[] = (journey?.points ?? []).map(point => ({
    km: routeKmOf(point.lat, point.lng),
    arriveMin: validHM(point.arrive) ? hmToMinutes(point.arrive) : null,
    departMin: validHM(point.depart) ? hmToMinutes(point.depart) : null,
  }))
  const scrubContext = `${trip.id}:${activeDayIndex}:${journey?.points.map(point => `${point.stop.id}:${point.lat}:${point.lng}:${point.arrive}:${point.depart}`).join('|') ?? ''}`
  const localTarget = targetRequest?.contextKey === scrubContext ? targetRequest.target : null
  useEffect(() => {
    const canvas = listRef.current
    if (!canvas) return
    const update = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight
      const height = `${Math.max(320, Math.floor(viewportHeight - canvas.getBoundingClientRect().top - 16))}px`
      if (canvas.style.getPropertyValue('--mv2-canvas-height') !== height) canvas.style.setProperty('--mv2-canvas-height', height)
    }
    const observer = new ResizeObserver(update)
    if (canvas.parentElement) observer.observe(canvas.parentElement)
    const header = canvas.closest('.yf-workspace')?.querySelector('header')
    if (header) observer.observe(header)
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    const frame = requestAnimationFrame(update)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [])
  const selectedHit = mapPois.find(hit => hit.id === detailId) ?? null
  const selectedDriveRow = selectedHit ? driveRowForHit(driveRows, selectedHit) : undefined
  // The card's day wins over a km guess, so the detail shows the same day.
  const detailDay = selectedHit ? selectedDriveRow?.dayIndex ?? dayForKm(selectedHit.cumKm) : null
  // A projected row is the card's fact source. The rail selection names its
  // slot occurrence; a map pin names only the place, so repeated slot
  // occurrences stay ambiguous instead of borrowing another row's facts.
  const selectedMatches = selectedHit ? mapRowsForHit(mapRows, selectedHit, detailDay) : []
  const selectedProjected = selectedMatches.length > 0
  const selectedRow = selectedHit ? mapRowForHit(mapRows, selectedHit, detailDay, detailBinding) : undefined
  // The detail's "If you add it" panel: the add preview the Keep step reads, and
  // the first engine fix for a risk the add would bring. Only for an unadded pick.
  const detailPreviewData = (() => {
    if (!selectedHit || !editable || detailDay == null || isAlreadyAdded(selectedHit, identity)) return null
    const kmOf = (lat: number, lng: number): number | null => routePolyline
      ? projectOntoPolyline({ latitude: lat, longitude: lng }, routePolyline)?.km ?? null
      : null
    const raw = detailAddPreview({ trip, dayIndex: detailDay, hit: selectedHit, routeKmOf: kmOf, legCorrections })
    if (raw == null) return null
    return {
      view: detailPreviewView(raw, hm => formatHM(hm, timeFormat)),
      offer: addFixOffer(raw, trip),
      proposed: raw.kind === 'ready' ? raw.proposedTrip : null,
      visitMin: raw.kind === 'ready'
        ? raw.proposedTrip.days.find(day => day.index === raw.dayIndex)?.stops.find(stop => stop.id === raw.stopId)?.visitMinutes ?? null
        : null,
    }
  })()
  const detailDetourMin = selectedHit ? (selectedRow ? selectedRow.detourMin : selectedProjected ? null : detourMinFor(selectedHit) ?? null) : null
  // The detail's budget cell reads the day after the add: its current spend
  // plus this pick. Unknown parts keep the whole used-of line out.
  const detailBudgetUsed = detailDetourMin != null && Number.isFinite(detailDetourMin) && driveBudget?.usedMin != null
    ? Math.max(0, Math.round(driveBudget.usedMin + Math.max(0, detailDetourMin)))
    : null
  const detailArriveMin = selectedHit
    ? selectedRow?.arriveMin ?? pickArrivalMin(passClockMin(passAnchors, selectedHit.alongRouteKm ?? selectedHit.cumKm ?? routeKmOf(selectedHit.latitude, selectedHit.longitude)), detailDetourMin)
    : null
  const mapShowsAll = mapFilter === 'all' || dayFocus === 'all'
  // Only the all-days view draws other days thin.
  const thinDays = mapShowsAll ? { selectedDay: activeDayIndex } : {}
  // A thin line has no click handler. The short copy states only what is true.
  const daysCaption = daysCaptionText(mapShowsAll, ROUTE_PAINT.contextOpacity)
  function showAllMapDays() { setMapFilter('all'); onDayFocusChange?.('all') }
  function chooseDay(index: number) {
    setLocalDay(index)
    setMapFilter(index)
    onDayFocusChange?.(index)
    setDetailId(null)
    setSelectedStop(null)
  }
  function inspectHit(hit: PlaceHit, binding: MapRowBinding | null = null) {
    detailOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    detailOpenerSnap.current = snap
    setDetailId(hit.id, binding)
    setActiveHitId(hit.id)
    setDeckOpen(true)
    setSnap('half')
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>('.mv2-pick-card')?.focus({ preventScroll: true }))
  }
  function closeDetails() {
    setDetailId(null)
    setSnap(detailOpenerSnap.current)
    requestAnimationFrame(() => {
      const opener = detailOpener.current
      const target = opener?.isConnected && opener.getClientRects().length ? opener : listRef.current?.querySelector<HTMLButtonElement>('.mv2-lenses > button')
      target?.focus({ preventScroll: true })
    })
  }
  function foldDeck() {
    setDeckOpen(false)
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>('.mv2-lenses > button')?.focus({ preventScroll: true }))
  }
  /** A rail part row and the lens pill open the same Gap deck. */
  function openGapDeck() {
    setLens('gap'); setSheetTab('see'); setDetailId(null); setDeckOpen(true); setSnap('half')
  }
  /** The day plan detail: search, vote and the pinned rest for each part. */
  function openDayPlan() {
    setSheetTab('needs'); setDetailId(null); setDeckOpen(true); setSnap('half')
  }

  function toggleItinerary(open: boolean) {
    setItineraryOpen(open)
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(open ? '.mv2-fold-day' : '.mv2-reopen-day')?.focus({ preventScroll: true }))
  }
  /** Ticket 07: only a keyboard snap moves focus into the sheet region it just
   *  revealed. A pointer or touch snap keeps focus on the handle. The guard
   *  refuses a hidden panel, so focus never lands in content that is not shown. */
  function settleSheetSnap(source: SheetSnapSource, panelId: string) {
    if (source !== 'keyboard') return
    requestAnimationFrame(() => {
      const panel = document.getElementById(panelId)
      if (panel?.isConnected && !panel.hasAttribute('hidden') && panel.getClientRects().length) panel.focus({ preventScroll: true })
    })
  }
  function selectPoint(point: JourneyPoint) {
    setSelectedStop(point.stop.id)
    setLocalTarget({ kind: 'coordinate', coordinate: { lat: point.lat, lng: point.lng } })
  }
  /** P5.3: the selected day's empty parts as hollow amber pins - their top
   *  candidate's real position, with P5.2's cost line in the tooltip. */
  // The clock choice and real add/fix previews control the map ribbon.
  const activeFixPreview = fixPreview?.dayIndex === activeDayIndex ? fixPreview : null
  const fixPreviewTrip = activeFixPreview ? applyFixChangeSet(trip, activeFixPreview) : null
  const fixPreviewDay = fixPreviewTrip?.days.find(day => day.index === activeDayIndex)
  const ribbonJourney = fixPreviewTrip && fixPreviewDay ? buildJourney(fixPreviewTrip, fixPreviewDay, legCorrections) : journey
  const ribbonShown = ribbonOpen || openPreview != null || activeFixPreview != null
  const ribbonLockedIds = trip.fixedCommitments.filter(entry => entry.dayIndex === activeDayIndex && entry.stopId != null).map(entry => String(entry.stopId))
  const ribbonNote = lens === 'fix' && commitmentClock != null
    ? `Fixed ${commitmentClock}`
    : lens === 'stay' && stayEvening != null ? `Free ${lensClock(stayEvening.startMin)}–${lensClock(stayEvening.endMin)}` : null
  const phoneRibbon = ribbonShown && (
    <MapJourneyRibbon journey={ribbonJourney} corrections={legCorrections} windows={railWindows.filter(row => row.nextDayLabel == null)} lockedStopIds={ribbonLockedIds} lockedClockOf={stopId => trip.fixedCommitments?.find(entry => entry.dayIndex === activeDayIndex && entry.stopId != null && String(entry.stopId) === stopId)?.time ?? null} fixStopId={fixStopId} note={ribbonNote} {...(openPreview ? { preview: openPreview } : {})} inSheet={false} onScrub={(position, minute) => {
      if (position.grade === 'estimated') { setScrubCursor(null); return }
      setScrubCursor({ contextKey: scrubContext, coordinate: position.coordinate, minute })
      setLocalTarget({ kind: 'coordinate', coordinate: position.coordinate }, true)
    }} />
  )
  const scopeBand = lens === 'drive'
    ? <MapScopeBand minutes={scopeChoice} onMinutes={changeScope} counts={driveCounts} budgetKnown={driveBudget.kind !== 'unknown'} disabled={loadingPois || quotaOut} status={loadingPois ? 'Searching…' : poisFailed || scanFailed ? 'Search failed' : quotaOut ? 'Search paused' : null} />
    : null
  // W10: the peek names the active lens with its real count, and shows the
  // first pick from that lens. An unknown count stays null, never a guess.
  const peekHit = seeForRail[0]?.hit ?? null
  const peekLetter = peekHit ? drivePickLetters[String(peekHit.id)] ?? null : null
  const peekDrive = peekHit ? driveRowForHit(driveRows, peekHit) : undefined
  const peekTotal = lens === 'drive' ? lenses.counts.drive ?? (loadingPois ? null : seeForRail.length) : lenses.counts[lens]
  const peekEyebrow = lens === 'drive' ? 'Along the drive' : lens === 'stay' ? 'Around the stay' : lens === 'gap' ? 'Gaps in this day' : 'Fix this day'
  const peekTitle = peekTotal == null
    ? 'Picks for this day'
    : `${peekTotal} ${peekTotal === 1 ? 'pick' : 'picks'} ${lens === 'drive' ? 'along the drive' : lens === 'stay' ? 'around the stay' : lens === 'gap' ? 'in this day' : 'to fix this day'}`
  const peekSub = peekDrive?.detourMin == null
    ? null
    : `+${Math.round(peekDrive.detourMin)} min detour${peekDrive.budgetSharePct != null && peekDrive.budgetSharePct > 0 ? ` · ${Math.round(peekDrive.budgetSharePct)}% of budget` : ''}`

  // W10: on a phone the search settings leave the map's top flow and become
  // one row in the planning sheet. Desktop keeps them where they were.
  // The one scan retry. The Refresh button and the Retry button of a failed deck both call it.
  const retryScan = () => { suggestionCache.clearMap(); setRefreshTick(t => t + 1) }
  const routeAdvice = (clockVerdict.verdict !== 'ok' || travelDayNeed > trip.days.length) ? (<>
        {/* Day Planner proposals (P1-B/P1-C) — the split the route demands,
            the defer/hop verdict for the real start time. They sit above the
            strip because they change WHAT the strip plans. */}
        {clockVerdict.verdict === 'defer' && (
          <div className="dayplanner-banner" role="status">
            <b>Start · Too late today</b>
            <span className="small muted">{clockVerdict.reason}</span>
            {editable && (
              <button className="btn btn-primary btn-sm" onClick={() => applyChange(draft => { const d0 = draft.days[0]; if (d0) d0.startTime = DEFER_START }, 'edit', 0)}>
                Set a {DEFER_START} start
              </button>
            )}
          </div>
        )}
        {clockVerdict.verdict === 'hop' && (
          <div className="dayplanner-banner" role="status">
            <b>Late start · Short drive then rest</b>
            <span className="small muted">{clockVerdict.reason}</span>
          </div>
        )}
        {(routeTotalKm != null || roadNeedsRetry) && splitVerdict && clockVerdict.verdict === 'ok' && travelDayNeed > trip.days.length && (
          <div className="dayplanner-banner" role="status">
            <b>{travelDayNeed} travel days needed{tripIsRoundTrip ? ' · Round trip' : ''}</b>
            {/* Non-breaking spaces keep each fact on one line; the line breaks only at a separator. */}
            <span className="small muted">
              {routeFailed && 'Road · Estimated · '}Daily&nbsp;distance&nbsp;≈{Math.round(splitVerdict.perDay)}&nbsp;km · Wheel&nbsp;time&nbsp;≈{minutesToHM(splitVerdict.maxDailyWheelMin)} · Pace&nbsp;{(trip.travelStyle ?? 'balanced').replace(/^./, letter => letter.toUpperCase())}
            </span>
            {roadRetryUnderway && (
              <span className="small muted">
                <InlineIcon icon={RefreshCw} size={12} gap={3} />Road · Measuring again…
              </span>
            )}
            {!splitDeclined ? (
              travelDayAdviceFor(drivingPlan, trip.days.length, { onApply: applySplitDays, onKeep: () => setSplitDeclined(true) })
            ) : (
              <span className="small dayplanner-red">
                Keeping {trip.days.length} day{trip.days.length !== 1 ? 's' : ''}: ≈{minutesToHM(wholeTrip.min * loopFactor)} plan · Driving limit exceeded
              </span>
            )}
            {roadNeedsRetry && road && !roadRetryUnderway && (
              <button className="btn btn-outline btn-sm" onClick={road.retry}
                title="Ask the routing provider again. The first tries may have been rate-limited">
                <InlineIcon icon={RefreshCw} size={12} gap={3} />Retry road measurement
              </button>
            )}
            {drizzleDay >= 0 && dayRainPct && (
              <span className="small muted">☁ {Math.round(dayRainPct[drizzleDay]!)}% rain chance on day {drizzleDay + 1} - {travelDayNeed} day{travelDayNeed !== 1 ? 's' : ''} planned · Extra day buffer</span>
            )}
          </div>
        )}
  </>) : null
  // The live suggestion states sit on top of the deck, never behind a button:
  // the over-limit count, the rain note and the empty, failed or limit states.
  const deckStatus = <div className="mv2-suggestion-notes">
        {budgetHeldCount > 0 && <p>Over detour limit: {budgetHeldCount}</p>}
        {/* #141 standalone: drizzle-grade rain never flips the verdict, so it
            says itself when no split banner is up. */}
        {drizzleDay >= 0 && dayRainPct && !(splitVerdict && clockVerdict.verdict === 'ok' && travelDayNeed > trip.days.length) && clockVerdict.verdict === 'ok' && (
          <p className="hint-text" role="status">☁ {Math.round(dayRainPct[drizzleDay]!)}% rain chance on day {drizzleDay + 1} · Slower pace · Day split unchanged</p>
        )}
        {!loadingPois && pois.length === 0 && (
          fractionPois && fractionPois.length > 0 ? (
            <div>
              <p className="muted small" style={{ marginBottom: 6 }}>
                Route quarters · Nearby picks
              </p>
              {(() => {
                // One Set across all three rows (#128a): a place can't win two quarters.
                const usedFracIds = new Set<string>()
                return [0.25, 0.5, 0.75].map(frac => {
                const targetKm = planKm * frac
                // Purpose-fit first (#128a): sights and food serve a quarter
                // stop — fuel/rest are errands, not destinations. Each place
                // wins at most ONE quarter (usedFracIds), so ½ doesn't repeat ¼.
                const ranked = fractionPois
                  .filter(h => !usedFracIds.has(h.id as string))
                  .filter(h => isSightCategory(h.category) || (h.category ?? '') === 'food' || (h.category ?? '') === 'cafe')
                  .map(h => ({ h, km: h.cumKm ?? kmFromStartForHit(h, anchors, { routePolyline: routePolyline ?? undefined }) }))
                  .filter(e => e.km != null)
                  .sort((a, b) => Math.abs((a.km as number) - targetKm) - Math.abs((b.km as number) - targetKm))
                const near = ranked[0]
                if (near) usedFracIds.add(near.h.id as string)
                const label = frac === 0.25 ? '¼' : frac === 0.5 ? '½' : '¾'
                return (
                  <div key={frac} className="poi-plan-row poi-plan-gap">
                    <span className="ride-purpose ride-purpose-sight ride-purpose-muted">{label} of the drive</span>
                    {near ? (
                      <span className="small">
                        ~{Math.round(targetKm)} km - <b>{near.h.name}</b>
                        {editable && <button className="btn btn-ghost btn-sm" disabled={addingAny} style={{ marginLeft: 8 }} onClick={() => openAddModal(near.h)}>+ Add</button>}
                      </span>
                    ) : (
                      // #128c: a non-empty pool with no fit here is a scope/
                      // purpose miss, not an empty corridor — say the honest thing.
                      <span className="muted small">{fractionPois.length > 0
                        ? 'Picks · None nearby · Try wider scope'
                        : 'Route · No stops · Add in Timeline'}</span>
                    )}
                  </div>
                )
                })
              })()}
            </div>
          ) : quotaOut ? (
            // #176: under quota-out the empty strip must not blame the plan.
            <p className="muted small">Google search · Monthly limit reached</p>
          ) : poisFailed ? (
            // #704: a failed search is not an empty one, so the route is not blamed.
            <p className="muted small">Route stops · Unavailable</p>
          ) : (
            <p className="muted small">Short drive · Explore Around the stay</p>
          )
        )}
  </div>
  // The route warning is a dot on the Fix button, with its reason in the tooltip.
  // The Fix deck carries the full advice, so no strip takes map height.
  const routeAlert = clockVerdict.verdict !== 'ok' || (splitVerdict && travelDayNeed > trip.days.length)
  const routeAlertText = clockVerdict.verdict !== 'ok' ? clockVerdict.reason : `Travel days needed: ${travelDayNeed}`
  const dayClockRange = `${formatHM(journey?.startTime ?? '', timeFormat)}–${formatHM(journey?.points[(journey?.points.length ?? 0) - 1]?.depart ?? '', timeFormat)}`
  const deckFooter = <footer className="mv2-deck-footer">
    <LensDeckSource
      sources={deckHits(lens, lenses, { driveTab, stayWindow: activeStayWindowId }).map(hit => hit.source)}
      fetchedAt={scanFetchedAt} coverage={scanCoverage}
      fixed={lens === 'fix' ? (lenses.fix.phase === 'ready' && lenses.fix.problem != null ? FIX_SOURCE_LINE : '') : null} />
    <button type="button" className="btn btn-ghost btn-sm" onClick={retryScan} disabled={loadingPois} title="Refresh suggestions"><RotateCcw size={14} aria-hidden />Refresh</button>
  </footer>
  // Phone floors stay 0: TripMap measures the covers from the overlay rects,
  // and the mark margin joins once. The sheet height is the only floor the
  // DOM cannot re-derive, because the sheet is the map's sibling. Desktop
  // keeps its panel widths: the itinerary sits beside the canvas, so no
  // cover measurement sees it.
  return (
    <div className={`mv2-workspace${railPresence.mounted ? '' : ' is-day-folded'}${deckPresence.mounted ? '' : ' is-deck-folded'}`} data-snap={snap} data-role={editable ? 'editor' : 'viewer'}>
      {(poisFailed || quotaOut) && !deckOpen && <p className="mv2-provider-status" role="status">{quotaOut ? 'Google search · Limit reached' : 'Route picks · Unavailable · Refresh to retry'}</p>}
      {filterActive && (
        <div className="poi-filterbar" role="status">
          {/* #162: the bar reads the label, the filter keys on the stable key. */}
          <span>Showing only suggestions that are {{ 'over-budget': 'Over budget', 'lunch-window': 'Lunch window', stretch: 'Long drive since last stop', rating: 'Rating · 4.0+', 'budget-share': 'Budget · Large share', 'first-stop': 'First stop' }[chipFilter as string] ?? chipFilter}</span>
          <button type="button" onClick={() => setChipFilter(null)}>Clear filter</button>
        </div>
      )}
      <div className={'map-ideas-grid' + (folded.needs ? ' is-needs-folded' : '') + (folded.see ? ' is-see-folded' : '')} ref={listRef}>
        <MapPhoneDay trip={trip} journey={journey} activeDay={activeDayIndex} allDays={mapShowsAll} onShowAll={showAllMapDays} onDayChange={chooseDay} onBack={onBackToTrip} endTown={headerEndTown} ribbonOpen={ribbonShown} onToggleRibbon={toggleRibbon} />
        {railPresence.mounted && <div className={`map-edit-keys${railPresence.leaving ? ' is-leaving' : ''}`} aria-hidden={railPresence.leaving || undefined} onKeyDown={e => edit.onReorderKey(e, selectedStop, selectedStop == null ? null : trip.days.find(d => d.stops.some(st => st.id === selectedStop))?.index ?? null)}><MapItinerary trip={trip} journey={journey} corrections={legCorrections} activeDay={activeDayIndex} budgetMin={mapBudget} selectedStop={selectedStop} allDays={mapShowsAll} onShowAll={showAllMapDays} onDayChange={chooseDay} onSelect={selectPoint} onOpenDay={onOpenDay} onFold={() => toggleItinerary(false)} railExtras={<LensRailExtras lens={lens} ringId={stayRing} onRing={setStayRing} />} windowRows={railWindows} daysCaption={daysCaption} fixStopId={fixStopId} fixSubLine={lens === 'fix' ? fixRowLine : null} fixProblem={lens === 'fix' ? fixProblem : null} budgetBar={budgetBar} clock={lensClock} previewChip={previewChip} stayView={stayView} hotelSub={stayTownSub} hideBudget={lens === 'stay' || budgetBar == null || driveBudget?.kind === 'empty'} endTown={headerEndTown} onOpenWindow={openGapDeck} clockRange={phoneSheet || journey == null ? null : { text: dayClockRange, expanded: ribbonShown, onToggle: toggleRibbon }} /></div>}
        {!itineraryOpen && <button className="mv2-reopen-day mv2-icon-btn" type="button" aria-label="Show day itinerary" onClick={() => toggleItinerary(true)}><PanelLeftOpen size={19} /></button>}
        {/* Edge tabs: one handle at the middle of each panel's outer edge opens and closes it,
            as in most map apps. The corner buttons stay for the phone sheet only. */}
        <button type="button" className={`mv2-edge-tab mv2-edge-tab--day${itineraryOpen ? ' is-open' : ''}`} aria-expanded={itineraryOpen}
          aria-label={itineraryOpen ? 'Hide day itinerary' : 'Show day itinerary'} title={itineraryOpen ? 'Hide day itinerary' : 'Show day itinerary'}
          onClick={() => toggleItinerary(!itineraryOpen)}>{itineraryOpen ? <ChevronLeft size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}</button>
        <button type="button" className={`mv2-edge-tab mv2-edge-tab--deck${deckOpen ? ' is-open' : ''}`} aria-expanded={deckOpen}
          aria-label={deckOpen ? 'Hide suggestions' : 'Show suggestions panel'} title={deckOpen ? 'Hide suggestions' : 'Show suggestions'}
          onClick={() => (deckOpen ? foldDeck() : setDeckOpen(true))}>{deckOpen ? <ChevronRight size={16} aria-hidden /> : <ChevronLeft size={16} aria-hidden />}</button>
        <div className="mv2-lenses mv2-lens-pill" role="group" aria-label="Map planning panels">
          <button type="button" aria-label={phoneLensAriaLabel('Along the drive', lenses.counts.drive)} aria-controls="rail-see" aria-pressed={lens === 'drive' && sheetTab === 'see' && deckOpen && !selectedHit} onClick={() => { setLens('drive'); setSheetTab('see'); setDetailId(null); setDeckOpen(true); setSnap('half') }}><Route size={16} aria-hidden /><span>Drive</span></button>
          <button type="button" aria-label={phoneLensAriaLabel('Around the stay', lenses.counts.stay)} aria-controls="rail-see" aria-pressed={lens === 'stay' && sheetTab === 'see' && deckOpen && !selectedHit} onClick={() => { setLens('stay'); setSheetTab('see'); setDetailId(null); setDeckOpen(true); setSnap('half') }}><BedDouble size={16} aria-hidden /><span>Stay</span>{lenses.counts.stay != null && <b>{lenses.counts.stay}</b>}</button>
          <button type="button" aria-label={phoneLensAriaLabel('Gaps in this day', lenses.counts.gap)} aria-controls="rail-see" aria-pressed={lens === 'gap' && sheetTab === 'see' && deckOpen && !selectedHit} onClick={() => { setLens('gap'); setSheetTab('see'); setDetailId(null); setDeckOpen(true); setSnap('half') }}><Sparkles size={16} aria-hidden /><span>Gap</span>{lenses.counts.gap != null && <b>{lenses.counts.gap}</b>}</button>
          <button type="button" aria-label={phoneLensAriaLabel('Fix this day', lenses.counts.fix)} aria-controls="rail-see" aria-pressed={lens === 'fix' && sheetTab === 'see' && deckOpen && !selectedHit} onClick={() => { setLens('fix'); setSheetTab('see'); setDetailId(null); setDeckOpen(true); setSnap('half') }} data-alert={routeAlert ? 'true' : undefined} title={routeAlert ? routeAlertText : undefined} aria-description={routeAlert ? routeAlertText : undefined}><Lightbulb size={16} aria-hidden /><span>Fix</span>{lenses.counts.fix != null && <b>{lenses.counts.fix}</b>}{routeAlert && <i className="mv2-lens-alert" aria-hidden="true" />}</button>
          {!deckOpen && <button type="button" aria-label="Show suggestions" onClick={() => setDeckOpen(true)}><PanelRightOpen size={18} /></button>}
        </div>
        <div tabIndex={-1} className={'poi-col poi-col--needs' + sheetHiddenClass('needs', sheetTab, sheetApplies) + (deckPresence.leaving ? ' is-leaving' : '')} id="rail-needs" hidden={!deckPresence.mounted || sheetTab !== 'needs' || !!selectedHit}>
            <MapSheetHandle snap={snap} onChange={setSnap} onSnapSettled={(_next, source) => settleSheetSnap(source, 'rail-needs')} />


            <div className="poi-col-head">
              <div className="poi-col-head-txt">
                <b>Day {activeDayIndex + 1} plan</b>
                {/* The one home of the day's count. The rail and the Gap deck do not repeat it. */}
                <span className="small muted">{activeDaySlots.length === 0 ? 'Drive plan · In progress' : `${activeReadinessLabel(activeDayReadiness)}`}{dayRainPct?.[activeDayIndex] != null && dayRainPct[activeDayIndex]! >= 40 ? ` · Rain ${Math.round(dayRainPct[activeDayIndex]!)}%` : ''}</span>
              </div>
              <button type="button" className="chip chip-sm" onClick={openGapDeck} title="Back to the open parts and their picks">Gaps</button>
              <button
                type="button"
                className="chip chip-sm"
                aria-pressed={shapeView}
                title={shapeView ? 'Back to the list' : 'See the day as a shape: drives and parts on one clock'}
                onClick={() => setShapeView(v => !v)}
              >{shapeView ? 'List' : 'Shape'}</button>
              <button
                type="button"
                className="poi-fold"
                aria-expanded={!folded.needs}
                aria-controls="rail-needs"
                title={folded.needs ? 'Expand the needs rail' : 'Collapse the needs rail to give the map more space'}
                onClick={foldDeck}
              >
                <ChevronDown size={13} aria-hidden />
              </button>
            </div>
            {quotaOut && (
              <div className="slots-railmeta">
                <span className="chip chip-sm" title="Google search quota reached - suggestions pause until the counter rolls over">Suggestions paused</span>
              </div>
            )}
            {shapeView && shapeBlocks.length > 0 ? (
              <div className="dayshape">
                {shapeBlocks.map((b, i) => (
                  <div
                    key={`${b.kind}-${i}`}
                    className={`shape-block shape-${b.kind} shape-state-${b.state}`}
                    style={{ height: `${Math.max(18, Math.round(b.minutes * 0.45))}px` }}
                    title={b.startMin != null
                      ? `${b.label} - ${Math.round(b.minutes)} min from ${formatHM(clockHM(b.startMin), timeFormat)}`
                      : `${b.label} - ${Math.round(b.minutes)} min`}
                  >
                    <span className="shape-name">{b.label}</span>
                    <span className="shape-min">{Math.round(b.minutes)}m</span>
                  </div>
                ))}
              </div>
            ) : activeDaySlots.length === 0 ? (
              <div className="poi-plan-list is-emptyday">
                <p className="muted small">{quotaOut
                  ? 'Google Places · Safety pause · Resumes next UTC month'
                  : needs.length === 0
                    ? 'Driving plan · No days'
                    : `Day ${activeDayIndex + 1} · No stops`}</p>
              </div>
            ) : (
              <div className="slots-list" id="slots-list">
              {mapScopeNote(mapFilter, activeDayIndex) && (
                <span className="sr-only">{mapScopeNote(mapFilter, activeDayIndex)}</span>
              )}
              {/* #333 A5: the slot's candidates had no live region, so a screen-reader
                  user opening a part heard nothing about what was in reach. Mounted even
                  when a part opens: it starts empty by design, and a region that MOUNTS already carrying its text is never announced. */}
              <span className="sr-only" role="status" aria-live="polite">{openAnnouncement}</span>
                {activeDaySlots.map(slot => {
                  const isOpen = openSlotKey === slot.key
                  // `urgencyMin` is window-end minus ETA, so it goes NEGATIVE
                  // once the window has passed. Both cases were swept up by the
                  // old `<= SLOT_URGENCY_MIN` test, so a slot 40 minutes past
                  // its window said "closes 14:30" — telling the user to hurry
                  // for a door that had already shut.
                  const closing = slot.state === 'empty' && slot.urgencyMin != null && slot.urgencyMin >= 0 && slot.urgencyMin <= SLOT_URGENCY_MIN
                  const missed = slot.state === 'empty' && slot.urgencyMin != null && slot.urgencyMin < 0
                  // Read the window, don't slice the formatted label.
                  const windowEnd = slot.windowMin ? formatHM(clockHM(slot.windowMin[1]), timeFormat) : ''
                  return (
                    <div
                      key={slot.key}
                      className={'day-slot' + (slot.state === 'filled' ? ' is-filled' : slot.state === 'auto' ? ' is-auto' : ' is-empty') + (isOpen ? ' is-open' : '') + (closing ? ' is-urgent' : '') + (missed ? ' is-missed' : '')}
                    >
                      {slot.state === 'empty' ? (
                        <>
                          <button
                            type="button"
                            className="day-slot-top"
                            aria-expanded={slot.vote ? undefined : isOpen}
                            aria-describedby={slot.vote ? voteStatusId(slot.key) : undefined}
                            onClick={() => {
                              if (slot.vote) { onOpenGroupInput?.(); return }
                              setOpenSlotKey(prev => (prev === slot.key ? null : slot.key))
                            }}
                          >
                            <span className="day-slot-st" aria-hidden />
                            <span className="day-slot-lab"><SlotGlyph kind={slot.kind} label={slot.label} />{slot.label}</span>
                            {slot.windowLabel && <span className="day-slot-win">{slot.windowLabel}</span>}
                            {closing && <span className="day-slot-urgent">Closes {windowEnd}</span>}
                            {missed && <span className="day-slot-missed">Closed {windowEnd}</span>}
                          </button>
                          {slot.state === 'empty' && slotPattern(slot.kind) && (
                            <p className="day-slot-pattern">{slotPattern(slot.kind)}</p>
                          )}
                          {/* #143: the drift proposal's home that the P2 rewrite
                              orphaned - shown while the slot is open; Stay hides it
                              for the session (the pin holds, it re-asks next open),
                              Move here accepts the re-derived position. */}
                          {slot.drift && !driftDismissed.has(slot.segment?.index ?? -1) && (
                            <div className="day-slot-drift" role="group" aria-label="Pinned rest drifted">
                              <span className="day-slot-drift-t">
                                The plan now puts your pinned rest {Math.abs(Math.round(slot.drift.toKm - slot.drift.fromKm))} km from your pin
                              </span>
                              <span className="day-slot-drift-a">
                                <button
                                  type="button"
                                  className="day-slot-fill"
                                  title="Accept the new spot - it stops being pinned"
                                  onClick={() => {
                                    const drift = slot.drift
                                    const segIdx = slot.segment?.index ?? -1
                                    if (!drift || segIdx < 0) return
                                    const ords = pois
                                      .filter(x => x.segment.purpose === 'overnight')
                                      .sort((a, b) => a.segment.targetKm - b.segment.targetKm)
                                      .findIndex(x => x.segment.index === segIdx)
                                    if (ords < 0) { setDriftDismissed(prev => new Set(prev).add(segIdx)); return }
                                    clearHaltPin(trip.id, ords)
                                    // #346: haltPins is inside mapInputsHash, so the plan
                                    // re-derives through the hash — the extra forced re-search
                                    // (spinner flash) is gone.
                                    setDnaTick(t => t + 1)
                                    undoToast('Moved the pinned rest to its new spot', () => saveHaltPin(trip.id, ords, drift.fromKm))
                                  }}
                                >Move here</button>
                                <button
                                  type="button"
                                  className="chip chip-sm"
                                  title="The pin holds - this asks again next open"
                                  onClick={() => setDriftDismissed(prev => new Set(prev).add(slot.segment?.index ?? -1))}
                                >Stay</button>
                              </span>
                            </div>
                          )}
                          {slot.vote ? (
                            <div className="day-slot-vote" id={voteStatusId(slot.key)}>
                              <span className="chip chip-sm">{slot.vote.voters > 0
                                ? `Voting · ${slot.vote.votesCast} of ${slot.vote.voters}`
                                // #335: the denominator is members now, and a trip with no
                                // member rows has none — say so instead of printing "2 of 0".
                                : `Voting · ${slot.vote.votesCast} vote${slot.vote.votesCast === 1 ? '' : 's'}`
                              }</span>
                              <span className="day-slot-vote-lead">
                                {slot.vote.leadingLabel ? `${slot.vote.leadingLabel} leads` : 'Votes · None'} · open Group input
                              </span>
                            </div>
                          ) : (
                            <div className="day-slot-hint">
                              Open
                              <span className="n">
                                {slotRowsOf(dayPlan, slot.key).length > 0
                                  ? ` · ${slotRowsOf(dayPlan, slot.key).length} pick${slotRowsOf(dayPlan, slot.key).length === 1 ? '' : 's'}`
                                  : ' · Search the map'}
                              </span>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="day-slot-top">
                          <span className="day-slot-st" aria-hidden>{slot.state === 'filled' ? '\u2713' : ''}</span>
                          <span className="day-slot-lab"><SlotGlyph kind={slot.kind} label={slot.label} />{slot.label}</span>
                          <span className="day-slot-win">{slot.state === 'filled' ? (filledStopClock(journeyDay?.daySchedule ?? null, slot.filledStop?.id ?? '') ? formatHM(filledStopClock(journeyDay?.daySchedule ?? null, slot.filledStop?.id ?? '') ?? '', timeFormat) : 'Time unavailable') : slot.windowLabel ?? ''}</span>
                          <span className="day-slot-val">
                            {slot.state === 'filled'
                              ? <b>{slot.filledStop?.title ?? slot.segment?.label ?? 'Planned'}</b>
                              : <small>Added by the app</small>}
                          </span>
                        </div>
                      )}
                      {slot.state === 'empty' && isOpen && (
                        <div className="day-slot-cands">
                          {/* P1: search lands in its slot - find inside the open
                              part; a picked result becomes ITS candidate (real
                              detour + budget share), never a direct plan write. */}
                          <div className="day-slot-search">
                            <input
                              className="input"
                              type="search"
                              placeholder="Find a place for this slot..."
                              aria-label={`Search to source the ${slot.label.toLowerCase()} slot`}
                              disabled={quotaOut}
                              value={slotSearch?.key === slot.key ? slotSearch.q : ''}
                              onChange={e => { setSlotSearchScope(searchScopeNow); setSlotSearch({ key: slot.key, q: e.target.value, busy: false, hits: [], err: null }) }}
                              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void runSlotSearch(slot) } }}
                            />
                            <button
                              type="button"
                              className="day-slot-fill"
                              disabled={quotaOut || !!slotSearch?.busy || slotSearch?.key !== slot.key || slotSearch.q.trim().length < 2}
                              onClick={() => void runSlotSearch(slot)}
                            >{slotSearch?.key === slot.key && slotSearch.busy ? 'Finding…' : 'Find'}</button>
                          </div>
                          {slotSearch?.key === slot.key && slotSearch.q.trim().length === 1 && !slotSearch.busy && (
                            <p className="muted small" style={{ margin: '0 0 6px' }}>Search · 2 characters minimum</p>
                          )}
                          {slotSearch?.key === slot.key && slotSearch.err && (
                            <p className="muted small" role="status" style={{ margin: '0 0 6px' }}>{slotSearch.err}</p>
                          )}
                          {slotSearch?.key === slot.key && !slotSearch.busy && slotSearch.hits.length > 0 && (
                            <div className="day-slot-search-hits">
                              {slotSearch.hits.slice(0, 6).map(h => (
                                <div key={String(h.id)} className="day-slot-search-hit">
                                  <span className="day-slot-search-hit-nm">{h.name}{h.nearestCity ? ` · ${h.nearestCity}` : ''}</span>
                                  <button type="button" className="day-slot-fill" onClick={() => addManualCandidate(slot, h)}>Use</button>
                                </div>
                              ))}
                              {slotSearch.hits.length > 6 && (
                                <p className="muted small" style={{ margin: '4px 2px 0' }}>More: {slotSearch.hits.length - 6} · Refine search</p>
                              )}
                            </div>
                          )}
                          {slotRowsOf(dayPlan, slot.key).map(c => (
                            <div key={String(c.hit.id)} className="day-slot-cand">
                              <span className="day-slot-cand-nm">
                                <b>{c.hit.name}</b>
                                <span>
                                  {c.detourMin == null ? 'Position · Unknown' : `+${Math.round(c.detourMin)} min`}
                                  {c.arriveLabel ? ` · Arrive ${formatHM(c.arriveLabel, timeFormat)}` : ''}
                                  {/* Runtime hours (repair of #887): the candidate's own day
                                      date and intended visit length decide the shown intervals
                                      and the closed note. Structured hours never fall back to
                                      the first legacy period; no structured hours keeps it. */}
                                  {(() => {
                                    if (c.hit.hours) {
                                      const shown = hoursDisplayFor(c.hit, {
                                        date: visitDateForDay(trip.startDate, activeDayIndex),
                                        arrivalMin: c.arriveMin,
                                        visitMin: intendedVisitMinutes(c.hit),
                                      })
                                      // The verdict note renders even when no interval is
                                      // provable: a known closure is a fact, not a blank.
                                      // Repair of the recheck P2: ranges no longer gate the note.
                                      const text = hoursCardText(shown, (a, b) => formatHMRange(a, b, timeFormat))
                                      return text ? ` · ${text}` : ''
                                    }
                                    return (c.hit.openTime || c.hit.closeTime) ? ` · ${formatHMRange(c.hit.openTime, c.hit.closeTime, timeFormat)}` : ''
                                  })()}
                                  {c.detourMin == null ? 'Position · Unknown' : c.budgetSharePct > 0 ? ` · ${c.budgetSharePct}% of day detours` : ' · On route'}
                                  {c.reason ? ` · ${c.reason}` : ''}
                                </span>
                                {c.budgetSharePct > 0 && (
                                  <span className="day-slot-cand-bar"><i className={c.budgetSharePct > 100 ? 'is-over' : ''} style={{ width: `${Math.min(100, c.budgetSharePct)}%` }} /></span>
                                )}
                              </span>
                              <button
                                type="button"
                                className="day-slot-fill"
                                disabled={addingAny}
                                onClick={() => { void fillSlot(slot, c.hit) }}
                              aria-label={fillLabel(c.hit.name, slot.label)}
                              >Fill</button>
                            </div>
                          ))}
                          {slotRowsOf(dayPlan, slot.key).length === 0 && (
                            <p className="muted small" style={{ margin: '4px 0 0' }}>
                              No candidates in reach{slot.windowLabel ? ` · Window ${slot.windowLabel}` : ''} · Add in Timeline or search the map
                            </p>
                          )}
                          {editable && !slot.vote && slotVoteReady(dayPlan, slot.key) && (
                            <button type="button" className="chip chip-sm" disabled={addingAny} onClick={() => void raiseSlotVote(slot)}>
                              Ask the crew to vote
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          <div className="map-ideas-map">
            {/* #418: the map's own search, above the canvas and outside both rails.
                Discovery here is route-aware (the shared runner), and filing is an
                explicit choice — this surface writes nothing on its own. */}
            <MapOmnibar
              editable={editable}
              {...(lens === 'stay' && lenses.stay.base?.name ? { placeholder: `Search near ${baseTagText(lenses.stay.base.name)}` } : {})}
              query={omniQ}
              onQueryChange={q => {
                setOmniQ(q)
                // Same discipline as the rail's box: stale rows from a previous
                // query must not sit under the new one while typing.
                if (omniResults.length > 0) setOmniResults([])
                if (omniPicked) setOmniPicked(null)
              }}
              onSubmit={onOmniSearch}
              busy={searching}
              quotaOut={quotaOut}
              results={omniResults}
              selectedId={omniPicked?.h.id ?? null}
              placement={omniPlacement}
              scopeKm={scopeKm}
              scopeMinutes={scopeMinutes}
              onSelect={id => {
                const row = omniResults.find(r => r.h.id === id) ?? null
                setOmniPicked(row)
                // …and the map agrees about which pin is being decided.
                setActiveHitId(id)
              }}
              onClear={() => { setOmniQ(''); setOmniResults([]); setOmniPicked(null) }}
              onPlace={placeOmnibarHit}
            />
            <TripMap
              trip={trip}
              dedicated
              onBlankMapClick={() => { if (detailId != null) setDetailId(null) }}
              nearbyPois={mapPoisForMap}
              onAddNearby={editable ? (hit) => openAddModal(hit) : undefined}
              activeHitId={activeHitId}
              onActivateHit={id => { setActiveHitId(id); const hit = mapPoisForMap.find(item => item.id === id); if (hit) inspectHit(hit) }}
              onOpenInTimeline={onOpenTimeline}
              onOpenInBoard={onOpenBoard ? () => onOpenBoard() : undefined}
              focusDay={mapShowsAll ? 'all' : activeDayIndex}
              {...thinDays}
              legCorrections={legCorrections}
              tripReadinessRows={tripReadinessRows}
              onDayFilterChange={day => {
      // #416: the map reports its own scope, including 'all' — the rail records it
      // so it can say when the two disagree (it cannot plan a whole trip itself).
      setMapFilter(day)
                // The rail always plans exactly one day, so the map's "All days"
                // leaves it where it is; a day chip moves the rail onto that day.
                // #425 PR 2: the same choice rides the shared day-focus axis, so
                // the Board's columns and this rail agree whichever was touched.
                // #610: 'all' publishes too — scope rides the axis, the rail
                // keeps its day and the map reads 'all' straight from dayFocus.
                onDayFocusChange?.(day)
                if (typeof day === 'number') setLocalDay(day)
              }}
              slotPins={slotPins}
              hitCosts={hitCosts}
              searchHitIds={searchHitIds}
              onOpenSlot={(key) => {
                // Tapping a pin on the map has to actually reveal the part.
                // With the rail folded the expansion was invisible, so the pin
                // appeared to do nothing at all.
                setFolded(f => (f.needs ? { ...f, needs: false } : f))
                setOpenSlotKey(key)
                setSheetTab('needs')
                setDetailId(null)
                setDeckOpen(true)
                setSnap('half')
                // After the unfold has painted.
                requestAnimationFrame(() => {
                  document.getElementById('rail-needs')?.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' })
                })
              }}
              onOpenHaltDay={onOpenDay}
              clockMilestones={clockMilestones}
              onDeleteStop={editable ? removeStopFromMap : undefined}
              mapTarget={localTarget ?? mapTarget ?? phoneStayTarget}
              onMapTargetConsumed={() => { if (localTarget) setLocalTarget(null); else if (mapTarget) onMapTargetConsumed?.() }}
              workspaceChrome
              instantTarget={!!localTarget && targetRequest?.instant === true}
              journeyCursor={scrubCursor?.contextKey === scrubContext ? { coordinate: scrubCursor.coordinate, label: formatHM(clockHM(scrubCursor.minute), timeFormat) } : null}
              overlayInsets={{ left: itineraryOpen && !phoneSheet ? (compactMap ? 298 : 404) : 0, right: deckOpen && !phoneSheet ? (compactMap ? 306 : 396) : 0, top: 0, bottom: phoneSheet ? phoneSheetHeight : 0 }}
              enableMapViewModes
              mainRouteGeometry={routeGeometry}
              returnRouteGeometry={returnRouteGeometry}
              allowSelfMeasurement={false}
              onShowReturnChange={setShowReturn}
              {...(stayRings ? { stayRings } : {})}
              frameStayRing={lens === 'stay' && lenses.stay.base != null && !phoneSheet}
              {...(gapRings ? { gapRings } : {})}
              {...(onGapRing ? { onGapRing } : {})}
              {...(Object.keys(pickBands).length > 0 ? { pickBands } : {})}
              {...(Object.keys(pickTags).length > 0 ? { pickTags } : {})}
              {...(routeMarks.length > 0 ? { routeMarks } : {})}
              {...(pickLetters && Object.keys(pickLetters).length > 0 ? { pickLetters } : {})}
              {...(fixStopWarning ? { stopWarning: fixStopWarning } : {})}
              {...(edit.previewRoad ? { previewRoad: edit.previewRoad } : {})}
              corridorDay={lens === 'drive' ? activeDayIndex : null}
            />

          </div>
          <div tabIndex={-1} className={'poi-col poi-col--see' + sheetHiddenClass('see', sheetTab, sheetApplies) + (deckPresence.leaving ? ' is-leaving' : '')} id="rail-see" data-lens={lens} hidden={!deckPresence.mounted || sheetTab !== 'see' || !!selectedHit}>
            <MapSheetHandle snap={snap} onChange={setSnap} onSnapSettled={(_next, source) => settleSheetSnap(source, 'rail-see')} />

            {deckStatus}

            {lens === 'drive' && <div className="mv2-peek">
              {peekHit ? <>
                <div className="mv2-peek-head">
                  <span className="mv2-peek-eyebrow">{peekEyebrow}</span>
                  {peekTotal != null && <span className="mv2-peek-count">1 of {peekTotal}</span>}
                  <strong className="mv2-peek-title">{peekTitle}</strong>
                </div>
                <div className="mv2-peek-row">
                  <span className="mv2-peek-mark"><CatIcon category={peekHit.category} size={20} /></span>
                  <button type="button" className="mv2-peek-place" onClick={() => inspectHit(peekHit)}>
                    {peekLetter != null && <span className="mv2-lens-place-letter" aria-hidden="true">{peekLetter}</span>}
                    <strong>{peekHit.name}</strong>{peekSub != null && <small>{peekSub}</small>}
                  </button>
                  {editable && <button type="button" className="btn btn-primary mv2-peek-add" disabled={addingAny || !!previewOpen} onClick={() => openAddModal(peekHit)}><Plus size={15} aria-hidden />Add</button>}
                </div>
              </> : <p className="mv2-peek-empty">{loadingPois ? 'Finding picks along the drive…' : poisFailed ? 'Picks · Unavailable · Refresh to retry' : quotaOut ? 'Search · Paused · Saved results available' : 'Picks · None · Search or open the day plan'}</p>}
            </div>}
            <MapLensPanel
              lens={lens}
              routeAdvice={routeAdvice}
              scopeSlot={scopeBand}
              onFold={foldDeck}
              onRetry={retryScan}
              lenses={lenses}
              dayLabel={lensDayLabel}
              dayNumber={activeDayIndex + 1}
              clock={lensClock}
              scopeMinutes={scopeMinutes}
              activeDriveTab={driveTab}
              onDriveTab={setDriveTab}
              driveLetters={drivePickLetters}
              stripOf={row => {
                const strip = driveCardStrip(row, lensClock)
                if (strip.arrive != null) return strip
                // The slot engine had no arrival. Read the day's road clock at the pick.
                const km = row.row.hit.alongRouteKm ?? row.row.hit.cumKm ?? routeKmOf(row.row.hit.latitude, row.row.hit.longitude)
                const arrive = pickArrivalMin(passClockMin(passAnchors, km), row.detourMin)
                return arrive == null ? strip : { ...strip, arrive: lensClock(arrive) }
              }}
              bandOf={row => scopeBandOf(row, scopeMinutes, budgetHeldIds)}
              introOf={row => driveDeckIntro(row, lensClock, routeKmOf(row.row.hit.latitude, row.row.hit.longitude))}
              onOpenDrive={row => inspectHit(row.row.hit)}
              onAddDrive={row => addLensHit(row.row.hit, activeDayIndex)}
              activeStayWindow={activeStayWindowId}
              onStayWindow={setStayWindow}
              stayRing={stayRing}
              onStayRing={setStayRing}
              onOpenStayPick={pick => inspectHit(pick.row.row.hit)}
              onAddStayPick={(pick, startMin) => addStayHit(pick.row.row.hit, activeDayIndex, startMin)}
              onSetStay={() => { setSheetTab('needs'); setDetailId(null); setDeckOpen(true); setSnap('half') }}
              onOpenGapPick={pick => inspectHit(pick.candidate.hit)}
              gapAside={<>
                {editable && dayCounts.fillable > 0 && batchSelection(dayPlan).items.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm mv2-gap-fill"
                    disabled={fillingDay}
                    onClick={() => { void fillTheDay() }}
                    title="Add the top pick for every open part of the day"
                  >{fillingDay ? 'Planning…' : 'Fill the day'}</button>
                )}
                <button type="button" className="chip chip-sm mv2-gap-plan" aria-controls="rail-needs" onClick={openDayPlan}
                  title="Every part of the day, with search, votes and the pinned rest">Day plan</button>
              </>}
              onAddGapPick={pick => addLensHit(pick.candidate.hit, activeDayIndex)}
              onApplyFix={applyLensFix}
              onPreviewFix={previewLensFix}
              {...(editable ? { onShortlist: (hit: PlaceHit) => toggleShortlist(hit), shortlistedOf: (hit: PlaceHit) => isShortlisted(hit) } : {})}
              {...(editable ? {
                // Swap shows only when the pick is bound to a planned stop it can replace.
                swapOf: (hit: PlaceHit) => {
                  const bound = mapRowForHit(mapRows, hit, activeDayIndex)
                  const stopId = bound?.stopId ?? null
                  return stopId == null ? null : () => edit.swapPickIntoStop(stopId, hit)
                },
              } : {})}
            />
            {lens === 'drive' && <div className="poi-plan-list is-ledger">
              {editable && arcs.length > 0 && <details className="mv2-route-arcs">
                <summary>Route arcs</summary>
              {editable && !filterActive && arcs.slice(0, 2).length > 0 && (
                <div className="poi-grp mv2-deck-arc-group">
                  <span className="poi-grp-k">Route arcs</span>
                  <span className="poi-grp-n">{arcs.slice(0, 2).length}</span>
                  <span className="poi-grp-ln" />
                </div>
              )}
              {editable && arcs.slice(0, 2).map(arc => (
                <div key={arc.theme} className="poi-plan-row poi-plan-arc mv2-deck-arc">
                  <div className="ride-spot-title">
                    <span className="ride-purpose ride-purpose-sight">{arc.theme}</span>
                    <b>{arc.arcBody}</b>
                  </div>
                  <div>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => { void addArc(arc) }}
                    >Add all ({arc.hitIds.length})</button>
                  </div>
                </div>
              ))}
              </details>}
              {/* One state, one message: the deck note above says wait, failed, paused or empty. */}
              {seeForRail.length === 0
                ? (lenses.drive.phase === 'ready' && <p className="muted small" role="status">Picks · None · Search or open the day plan</p>)
                : hiddenRows.length > 0 && (
                    <details className="poi-more mv2-deck-more mv2-lens-more">
                      <summary>More like this · {hiddenRows.length}</summary>
                      <div className="poi-more-list">{hiddenRows.map(ledgerRow)}</div>
                    </details>
                  )}

            </div>}
            {deckFooter}
          </div>
          {selectedHit && deckPresence.mounted && <div className={`mv2-detail${deckPresence.leaving ? ' is-leaving' : ''}`} onKeyDown={e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); closeDetails() } }}>
            <MapSheetHandle snap={snap} onChange={setSnap} onSnapSettled={(_next, source) => settleSheetSnap(source, 'rail-detail')} />


            <MapPickCard hit={selectedHit} trip={trip} dayIndex={detailDay} detourMin={detailDetourMin} reason={selectedRow?.reason ?? null}
              arriveText={detailArriveMin == null ? null : lensClock(detailArriveMin)}
              {...(lens === 'stay' ? { kicker: `Around the stay · ${kindWordOf(selectedHit.category)}` } : {})}
              preview={detailPreviewData?.view ?? null}
              fixOffer={detailPreviewData?.offer ? { label: `Add and fix ${detailPreviewData.offer.stopTitle ?? 'the day'}` } : null}
              onAddAndFix={() => {
                if (!editable || detailDay == null) return
                const proposed = detailPreviewData?.proposed ?? null
                const offer = detailPreviewData?.offer ?? null
                edit.addNow(selectedHit, detailDay, () => {
                  // The fix was checked on the proposed plan. That plan is the
                  // one the add just wrote, so the same set is safe to apply.
                  if (proposed != null && offer != null) applyFixAgainst(proposed, offer.set)
                  chooseDay(detailDay)
                  setLens('fix')
                  setSheetTab('see')
                  setDeckOpen(true)
                })
              }}
              visitMin={selectedRow?.visitMin ?? detailPreviewData?.visitMin ?? (selectedProjected ? null : undefined)}
              budgetSharePct={selectedRow ? selectedRow.budgetSharePct : selectedProjected ? null : undefined}
              budgetText={detailBudgetUsed == null ? null : `${detailBudgetUsed} of ${mapBudget}`}
              source={selectedRow ? selectedRow.source : selectedProjected ? null : undefined}
              freshness={selectedRow ? selectedRow.freshness : selectedProjected ? 'unknown' : undefined}
              actions={mapCardActions(selectedRow, selectedProjected)}
              {...(editable && selectedRow?.stopId != null && selectedHit != null ? {
                onSwap: () => edit.swapPickIntoStop(selectedRow.stopId!, selectedHit),
              } : {})}
              arriveMin={selectedRow ? selectedRow.arriveMin : selectedProjected ? null : undefined}
              fetchedAt={selectedRow ? scanFetchedAt : undefined} coverage={selectedRow ? scanCoverage : undefined}
              added={isAlreadyAdded(selectedHit, identity)} editable={editable} busy={addingAny || !!previewOpen} shortlisted={isShortlisted(selectedHit)}
              onAdd={() => { if (editable && detailDay != null && !isAlreadyAdded(selectedHit, identity)) edit.addNow(selectedHit, detailDay); else openAddModal(selectedHit) }} onShortlist={() => toggleShortlist(selectedHit)} onClose={closeDetails} onDirections={() => openExternal(googleMapsUrl(selectedHit))} />
            <MapEditAddPanel edit={edit} onChooseDay={() => openAddModal(selectedHit)} />
          </div>}
          {deckOpen && !selectedHit && editable && selectedStop != null && <div className="mv2-detail"><MapEditStopPanel edit={edit} trip={trip} stopId={selectedStop} editable={editable} /></div>}
          <MapEditLive edit={edit} />
          {phoneRibbon}
          {/* The time range sits in the day header. The chip shows only while the day panel is folded. */}
          {!phoneSheet && !itineraryOpen && <button type="button" className="mv2-clock-chip" aria-expanded={ribbonShown} aria-label={ribbonShown ? 'Hide journey clock' : 'Show journey clock'} onClick={toggleRibbon}><Clock size={15} aria-hidden />{dayClockRange}</button>}
          {activeFixPreview && <div className="mv2-fix-preview-actions"><button type="button" className="btn btn-primary" onClick={() => applyLensFix(activeFixPreview)}>Keep fix</button><button type="button" className="btn btn-ghost" onClick={() => setFixPreview(null)}>Cancel fix preview</button></div>}
      </div>
      {/* Shortlist tray: the rail collects, the tray decides. Sticky so it stays
          reachable while the rails scroll. #420 slice 1 moved the markup into
          map/ShortlistTray.tsx; the actions below stay here until slice 2. */}
      {editable && <ShortlistTray
        count={trayShortlist.length}
        busy={addingAny}
        onAddAll={() => void addShortlisted()}
        onVote={() => void raiseShortlistVote()}
        onClear={clearShortlist}
      />}
      {/* pick-a-day modal for adding a suggested POI — explicit confirm */}
      <Modal open={!!poiDraft} onClose={() => setPoiDraft(null)} title={`Add “${poiDraft?.hit.name ?? ''}”`}>
        {poiDraft && (
          <div>
            {poiDraft.hit.description && <p className="small muted" style={{ marginTop: 0 }}>{poiDraft.hit.description}</p>}
            <Field label="Target day">
              <Select
                value={String(pickDay)}
                onChange={v => { setPickDay(Number(v)); setPickDayGuessed(false) }}
                options={dayOptions.map(d => ({ value: String(d.index), label: `Day ${d.index + 1}` }))}
              />
                {/* #333 A9: said out loud, beside the control it qualifies. The Select
                    component forwards no extra props, so this cannot ride on describedby. */}
                {pickDayCaveat(pickDay, !pickDayGuessed) && (
                  <p className="hint-text" role="status">{pickDayCaveat(pickDay, !pickDayGuessed)}</p>
                )}
            </Field>
            <p className="hint-text">Duration, fees and times · Edit in Timeline</p>
            <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn btn-outline" onClick={() => setPoiDraft(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => { recordDnaEvent({ tripId: trip.id, action: 'accept', haltKind: poiDraft.hit.haltPurpose, category: poiDraft.hit.category, detourMin: asymmetricDetourMinutes(poiDraft.hit, anchors, routePolyline ?? null, MODE_SPEED[trip.transportMode] ?? 40) ?? undefined, visitMin: visitMinutesForCategory(poiDraft.hit.category) }); setDnaTick(t => t + 1); addPoiToDay(poiDraft.hit, pickDay); setPoiDraft(null) }}>
                Add to timeline
              </button>
            </div>
          </div>
        )}
      </Modal>
      {/* resolve-or-prompt dialog — one instance serves every pick guard */}
      {resolvePickDialog}
    </div>
  )
}
