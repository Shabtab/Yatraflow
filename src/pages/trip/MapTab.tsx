// ============ Trip workspace — Map tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { InlineIcon } from '../../components/icons'
import { BedDouble, ChevronDown, CircleCheck, Coffee, ExternalLink, Fuel, Lightbulb, MapPin, Pause, Plus, RefreshCw, RotateCcw, Sparkles, Star, Utensils } from 'lucide-react'
import { uid } from '../../data/seed'
import type { Trip, ItineraryStop, TripDecision } from '../../data/types'
import type { ImpactResult } from '../../lib/impact'
import { removeStopWithUndo } from '../../lib/mutationLifecycle'
import { mapRoadViewFromLegs, mapReturnGeometryFromLegs, outboundLegs, type TripRoadView } from '../../lib/tripRoad'
import { buildJourney, minutesToHM, fmtDur, computeCategoryBias, MODE_SPEED, isRoundTrip, type LegEstimate } from '../../lib/engine'
import { useTimeFormat, formatHM, formatHMRange } from '../../lib/timefmt'
import { loadPref, savePref, loadHaltPinsForTrip, saveHaltPin, clearHaltPin, clearHaltPinsForTrip } from '../../lib/uiPrefs'
import { DEBOUNCE_MS } from '../../lib/geocode'
import { Modal, Field, toast, undoToast, useInView, useMedia, usePageVisible } from '../../components/ui'
import { Select } from '../../components/Select'
import { DetourWhisk } from '../../components/DetourWhisk'
import { useSuggestionCache } from '../../hooks/useSuggestionCache'
import { openExternal } from '../../lib/native'
import { corridorAnchors, asymmetricDetourKm, asymmetricDetourMinutes, googleEnabled, reasonForSegmentHit, searchPlacesText, kmFromStartForHit, planDriveDays, planTravelClock, rainFactorFor, directionalKm, alongRouteKmOf, DEFER_START, type NearbyOpts, type PlaceHit, type TravelClockVerdict } from '../../lib/geocode'
import { useResolvePick } from '../../components/ResolvePickDialog'
import { clockHM, deriveClockMilestones } from '../../lib/clockOverlay'
import { SHEET_TABS, sheetHiddenClass, sheetTabMove } from '../../lib/mapSheet'
import { mapScopeNote } from '../../lib/railA11y'
import { railKeyAction } from '../../lib/railKeys'
import { candidatesAnnouncement, fillLabel, pickDayCaveat, scopeValueText, searchAnnouncement, voteStatusId } from '../../lib/railA11y'
import { MapOmnibar } from './MapOmnibar'
import { useOmnibarPlacement } from './map/useOmnibarPlacement'
import { useMapSearch } from './map/useMapSearch'
import { useAddModal } from './map/useAddModal'
import { ShortlistTray } from './map/ShortlistTray'
import { useShortlist } from './map/useShortlist'
import { useMapWriters } from './map/useMapWriters'
import { useCorridorCache } from './map/useCorridorCache'
import { useRailView } from './map/useRailView'
import { useRailContent } from './map/useRailContent'
import { useDaySlots } from './map/useDaySlots'
import {
  SEE_VISIBLE, SCOPE_KM_STEPS, SCOPE_STORAGE_KEY,
  googleMapsUrl, newStopId, poiVisitMinutes, smallThumb,
} from './map/pageHelpers'
import { alternativesFor, chipsFor, activeReadinessLabel, activeDayLabel } from './map/railRows'
import { filingOptionsFor, manualCandidateFor, mergeSlotCandidates, slotFileRefusal } from './map/slotFiling'
import {
  dayWeatherJoin, drizzleDayIndex, journeyKmFrom, routePolylineFrom, weatherAnchorFrom, weatherFetchRefusal,
} from './map/weatherGeometry'

/** How many search hits the rail shows before "Show all" (#333 A1). The listbox
 *  grammar needs the same page size the rows are rendered with, so it lives here
 *  once instead of as a bare literal in the label, the slice and the key handler. */
const SEARCH_PAGE = 5
import { isSightCategory, roadProfileFromLegs, loopProfile } from '../../lib/ridePlan'
import { QuotaExhaustedError } from '../../lib/providers/google'
import { isElectric } from '../../lib/vehicleProfile'
import { dayShape, tripDayAttribution, SLOT_URGENCY_MIN, type DaySlot, type DaySlotKind } from '../../lib/daySlots'
import { discardedStagedIds, isAlreadyAdded, normalizePlaceName, tripPresence, type PlaceIdentity } from '../../lib/placeIdentity'

import { dayDetourBudgetMin, budgetSharePct, splitByDetourBudget } from '../../lib/detourBudget'
import { anyQuotaExhausted } from '../../lib/providers/quota'
import { buildDnaVectorAcrossTrips, loadDnaLog, recordDnaEvent, dnaNoteForHit, crewSeedsFromSuggestions, crewSeedsToPlannedStops, crewSeedEvents, crewNoteForHit } from '../../lib/tripDna'
import { visitMinutesForCategory } from '../../lib/slackPrompts'
import { scrollBehavior } from '../../lib/motion'
import type { SegmentHit } from '../../lib/geocode'
import { projectOntoPolyline } from '../../lib/providers/hits'
import { fetchDailyWeather, forecastAvailable, isoAddDays, todayISO } from '../../lib/weather'
// MapLibre is heavy (~1MB) — load it only when the Map tab is actually opened.
const TripMap = React.lazy(() => import('../../components/TripMap').then(m => ({ default: m.TripMap })))

// #420 slice 3: the page's module-level constants and pure helpers live in
// ./map/pageHelpers now, where they have direct tests. `clockHM` is NOT among them
// — the page carried a byte-identical copy of lib/clockOverlay's (which is tested),
// so the copy is gone and the lib one is imported below.

// ---- Engine guide: a subtle rotating roll-out of what the suggestion engine ----
// ---- does, so its intelligence is discoverable without a docs trip.          ----
const ENGINE_TIPS = [
  'Breaks are spaced for fatigue - stretch rides your wheel time, lunch holds the 11:30–14:30 window, tuned to your crew size and travel style.',
  'Lunch slides itself into the 11:30–14:30 window based on when each driving day starts.',
  'Self-drive trips get fuel halts on your tank’s rhythm - no “next pump in 300 km” surprises.',
  'Cross-day drives end at a real city - the overnight lands where your honest wheel cap says the day ends.',
  'Every idea is checked against your detour budget - packed days see fewer, closer options.',
  'The engine learns: accepting or declining an idea nudges what future trips suggest (Trip DNA).',
  'Rainy day ahead? Exposed sights step aside for museums, cafes and other sheltered picks.',
  'Ghat sections and slow city crawls are detected from the real road shape - and warned about.',
  'Story arcs bundle nearby sights into one-tap themed detours - temples, waterfalls, viewpoints.',
  'Hover a card to spot it on the map; hover a pin to find its card. Adds always insert in road order.',
]

function EngineTips() {
  const [tip, setTip] = useState(0)
  const tipsRef = useRef<HTMLDivElement>(null)
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const inView = useInView(tipsRef)
  const visible = usePageVisible()
  const running = inView && visible && !reduced
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setTip(i => (i + 1) % ENGINE_TIPS.length), 7000)
    return () => clearInterval(t)
  }, [running])
  return (
    <div className="engine-tips" ref={tipsRef}>
      <span className="engine-tips-ico"><Sparkles size={12} aria-hidden /></span>
      {/* #168: role="status" on rotating text re-announces every 7s — a live
          region that never shuts up. The rotation is decorative; SR users get
          one static summary instead. */}
      <span key={tip} className="engine-tips-text" aria-hidden="true">{ENGINE_TIPS[tip]}</span>
      <span className="sr-only" role="status">Suggestions are spaced for fatigue and checked against your detour budget.</span>
      {/* #333 A4: these were buttons with onClick and a -1 tabIndex INSIDE an
          aria-hidden container — clickable, unreachable by keyboard, and 8px wide.
          (Spelled without the JSX braces on purpose: the suite greps this file for
          that literal, and a comment carrying it would trip its own guard.)
          The strip is ambient decoration: it rotates on its own every 7s, it is
          display:none below 720px, and screen readers already get the static
          summary above instead (#168). So the dots are indicators now, not
          controls: nothing focusable sits inside aria-hidden (that pairing is the
          violation the issue named), and no target below the repo's 40px floor
          remains. If picking a tip is ever wanted back, the shape is ONE
          "next tip" button on the strip — not six 8px dots. */}
      <span className="engine-tips-dots" aria-hidden="true">
        {ENGINE_TIPS.map((_, i) => (
          <span key={i} className={`engine-tips-dot${i === tip ? ' on' : ''}`} />
        ))}
      </span>
    </div>
  )
}

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
export function MapTab({ trip, editable, applyChange, suggestionCache, onInputsHash, crewSuggestions, decisions, road, onOpenTimeline, onOpenBoard, onOpenDay, onOpenGroupInput, previewOpen, dayFocus, onDayFocusChange, legCorrections }: {
  trip: Trip
  editable: boolean
  applyChange: (mutator: (d: Trip) => void, kind: ImpactResult['kind'], dayIndex: number, onKept?: () => void) => void
  suggestionCache: ReturnType<typeof useSuggestionCache>
  /** #404: the Map publishes the freshness it scanned under, so the Overview's
   *  slot matrix can qualify stale numbers instead of printing them as current.
   *  The hash cannot be recomputed outside this component — it reads the OSRM
   *  geometry and the weather join, both of which are this tab's state. */
  onInputsHash?: (inputsHash: string, scopeKm: number) => void
  crewSuggestions?: { status: string; title: string; category?: string; lat: number; lng: number }[]
  /** #188: the workspace's ONE road measurement — the Map tab no longer measures. */
  road: TripRoadView
  onOpenTimeline?: (stopId: string) => void
  onOpenBoard?: () => void
  /** Phase 3: tapping a halt label asks the workspace to open that day's plan
   *  in the Timeline. Undefined = halt labels stay decorative labels. */
  onOpenDay?: (dayIndex: number) => void
  /** The part's live vote opens the crew's Group input to resolve it (P4). */
  onOpenGroupInput?: () => void
  /** true while the workspace holds a staged change — a direct cache write
   *  (the popup's stop delete) would make Keep refuse as stale, so it refuses
   *  instead (#334, same policy as the timeline and Group input). */
  previewOpen?: boolean
  /** This trip's decisions - an open one raised for a part shows as its vote. */
  decisions?: TripDecision[]
  /** #425 PR 2: the shared day-focus axis (same value the Board's columns
   *  read). The map's day-filter chips and the slots rail's day strip report
   *  their choice through it, so the Board and this tab agree whichever was
   *  touched. Optional — the tab keeps working when a host has not adopted it. */
  dayFocus?: number | 'all'
  /** reports the tab's day-axis choice back up to the workspace. */
  onDayFocusChange?: (day: number | 'all') => void
  /** The workspace's measured road data — pin clocks read it (#611). */
  legCorrections?: Record<string, LegEstimate>
}) {
  const [pois, setPois] = useState<SegmentHit[]>([])
  const timeFormat = useTimeFormat()
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  // dismissed suggestion ids — logged as DNA declines, hidden for the session
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  // #345: ids this tab staged into a preview, with the name they will land
  // under. The preview-close effect below reads this to release what a
  // DISCARDED preview staged — the ghost that used to hide a place until
  // reload. A committed stop keeps its id because its name is then in the plan.
  const stagedIdsRef = useRef(new Map<string, string>())
  // DNA freshness: bumped on every accept/decline so scoring + notes re-read
  // the log instead of serving the memoised vector
  const [dnaTick, setDnaTick] = useState(0)
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
  const [slotSearch, setSlotSearch] = useState<{ key: string; q: string; busy: boolean; hits: PlaceHit[]; err: string | null } | null>(null)
  const [slotManual, setSlotManual] = useState<Record<string, PlaceHit[]>>({})
  const addingIdsRef = useRef(new Set<string>())
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set())
  const [addingAny, setAddingAny] = useState(false)
  const slotSeq = useRef(0)
  // detour-scope control — how far off the route suggestions may sit.
  // #181: guarded through uiPrefs (private-mode throw crashes a useState
  // initializer); namespace follows the app's yatraflow_* convention.
  const [scopeIdx, setScopeIdx] = useState(() => {
    const saved = Number(loadPref(SCOPE_STORAGE_KEY, ''))
    const i = SCOPE_KM_STEPS.indexOf(saved)
    return i >= 0 ? i : 1 // default 20 km
  })
  const scopeKm = SCOPE_KM_STEPS[scopeIdx]
  const scopeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function changeScope(i: number) {
    if (scopeTimer.current) clearTimeout(scopeTimer.current)
    scopeTimer.current = setTimeout(() => {
      setScopeIdx(i)
      savePref(SCOPE_STORAGE_KEY, String(SCOPE_KM_STEPS[i]))
    }, DEBOUNCE_MS)
  }
  useEffect(() => () => { if (scopeTimer.current) clearTimeout(scopeTimer.current) }, [])
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
  useEffect(() => () => {
    slotAbort.current?.abort()
  }, [])
  // #345: ONE identity answers "is this already mine?" for every rail, slot,
  // arc, pin and search row. `tripPresence` is the stable half (the plan's own
  // stops, rejected ones excluded so a turned-down suggestion stays
  // re-addable, normalized so `" Hotel Taj "` matches); `identity` adds this
  // session's staged/dismissed ids. Split in two so the day-slot deps below
  // don't re-derive on every add — only the trip's own stops move those.
  const tripPresenceIds = useMemo(() => tripPresence(trip), [trip])
  const existingNames = tripPresenceIds.names
  const identity = useMemo<PlaceIdentity>(() => ({
    names: tripPresenceIds.names, keys: tripPresenceIds.keys,
    added: addedIds, dismissed: dismissedIds,
  }), [tripPresenceIds, addedIds, dismissedIds])

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
  const routeGeometry = roadView.geometry
  const returnRouteGeometry = useMemo(
    () => mapReturnGeometryFromLegs(road?.chain ?? null, road?.legs ?? null),
    [road],
  )
  const routeTotalKm = roadView.totalKm
  const routeTotalMin = roadView.totalMin
  const dayRoadKm = roadView.dayRoadKm
  // The measurement's outcome, handed down from the workspace: when the road
  // can't be measured (rate limits, very long routes — exactly where the banner
  // matters most), the Day Planner still speaks, from the haversine estimate,
  // flagged as rough.
  const routeFailed = road?.status === 'failed'
  // #road-retry: this banner is the one surface that says the road failed, so it
  // also owns the retry. A ref latches the failure while the re-measure is in
  // flight — status flips to 'pending' the moment Retry is clicked, and a gate
  // keyed on `failed` alone would drop the banner mid-retry: the honest state
  // would vanish exactly when the user asked for another attempt. Latched in
  // RENDER (not an effect) so a same-tick flip never reads stale. A resolved
  // measurement clears it; a chain rebuild clears it too — after a route edit
  // the old verdict is stale and the new chain measures on its own, so the
  // latched failure must not pin a dead banner up.
  const roadFailedEverRef = useRef(false)
  if (road?.status === 'failed') roadFailedEverRef.current = true
  if (road?.status === 'ok') roadFailedEverRef.current = false
  const roadRetryUnderway = roadFailedEverRef.current && road?.status === 'pending'
  const roadNeedsRetry = routeFailed || !!roadRetryUnderway
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
  const stopSig = trip.days.map(d => d.stops.map(s => `${s.id}@${s.lat},${s.lng}`).join('+')).join('|')
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
  }, [trip, stopSig, routeTotalKm, routeTotalMin])

  /** ONE day attribution for this tab, and the very same helper the Overview
   *  matrix reads (`tripDayAttribution`) — road-true per-day km from the
   *  routing legs when resolved, keyed by the day's own index (#161: indexes
   *  can skip when a day is deleted, and position ≠ index). A second definition
   *  here is how two surfaces start disagreeing about which day it is. */
  const dayAttribution = useMemo(() => tripDayAttribution(trip, dayRoadKm), [trip, dayRoadKm])
  /** Which day's cumulative drive covers a given along-route km (pick-a-day
   *  defaults, per-day budgets, day chips). #161: unknown km returns null and
   *  each consumer decides honestly — never a silent Day 1. */
  const dayForKm = dayAttribution.dayForKm

  // #420 slice 9: the add draft lives in ./map/useAddModal now — same inputs
  // in, same outputs out, no behavior change. Called here because the day
  // default reads the attribution above. Hook order changes once, then stays
  // fixed — every hook here runs each render.
  const {
    poiDraft, setPoiDraft, pickDay, setPickDay,
    pickDayGuessed, setPickDayGuessed, openAddModal,
  } = useAddModal({ identity, dayForKm, days: trip.days })

  // search the WHOLE route corridor (start → stops → destination); the home
  // zone around the starting point is excluded inside the engine
  const anchors = useMemo(() => {
    const pts = trip.days
      .flatMap(d => d.stops)
      .filter(s => s.status !== 'rejected')
      .map(s => ({ lat: s.lat, lng: s.lng }))
    return corridorAnchors(pts, trip.startLocationCoords ?? null, scopeKm * 1000)
  }, [trip, scopeKm])

  // Per-day rain chance for the weather join — best-effort, null until loaded.
  const [dayRainPct, setDayRainPct] = useState<(number | null)[] | null>(null)
  // WMO code per day (#141) — separates a drizzle chance from a storm chance
  // in the cap multiplier. Same loading lifecycle as the rain array.
  const [dayWeatherCode, setDayWeatherCode] = useState<(number | null)[] | null>(null)
  useEffect(() => {
    // #420 slice 6: which stops the forecast may be centred on, and whether it may
    // be fetched at all, are rules with their own tests now (map/weatherGeometry).
    const stops = trip.days.flatMap(d => d.stops)
    const anchor = weatherAnchorFrom(stops)
    if (!anchor || weatherFetchRefusal({ stops, startDate: trip.startDate, forecastAvailable })) {
      setDayRainPct(null); setDayWeatherCode(null); return
    }
    let cancelled = false
    fetchDailyWeather(anchor.lat, anchor.lng, trip.startDate, trip.days.length || 1)
      .then(w => {
        if (cancelled) return
        const join = dayWeatherJoin({ dayCount: trip.days.length, startDate: trip.startDate, byDate: w, isoAddDays })
        setDayRainPct(join.rainPct)
        setDayWeatherCode(join.codes)
      })
      .catch(() => { if (!cancelled) { setDayRainPct(null); setDayWeatherCode(null) } })
    return () => { cancelled = true }
  }, [trip])
  // OSRM's road total (when resolved AND worth trusting) is the most accurate
  // journey budget for the fatigue math; otherwise the journey-summed estimate.
  const planKm = journeyKmFrom(routeTotalKm, wholeTrip.km)

  // Route polyline in {lat,lng} form (from the OSRM route geometry) — feeds the
  // asymmetric detour measure so on-the-way hits cost ~0 and spurs pay round trip.
  const routePolyline = useMemo(() => routePolylineFrom(routeGeometry), [routeGeometry])


  // Crew seeds: open group-input ideas suppress near-duplicates and bias the
  // corridor toward crew-proposed kinds.
  const crewSeeds = useMemo(() => crewSeedsFromSuggestions(crewSuggestions ?? []), [crewSuggestions])

  const nearbyOpts: NearbyOpts = useMemo(() => ({
    // #144B: an electric profile charges instead of fuelling — the segment
    // cadence and the hit queries both read this flag.
    includeFuel: !isElectric(trip.vehicleProfile) && (trip.transportMode === 'car' || trip.transportMode === 'motorcycle'),
    includeCharge: isElectric(trip.vehicleProfile),
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
    dnaVector: buildDnaVectorAcrossTrips(loadDnaLog(), crewSeedEvents(trip.id, crewSeeds)),
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
  }), [trip, routeGeometry, dayRainPct, dayWeatherCode, crewSeeds, dnaTick])

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
      toast('Route re-shaped - accepted halt pins cleared')
      suggestionCache.clearMap()
      setRefreshTick(t => t + 1)
      setDnaTick(t => t + 1) // nearbyOpts re-reads: the pins bag is now empty
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
    driverCount: trip.driverCount,
    hasVulnerable: trip.hasVulnerable,
  }
  const tripAnchors = {
    dinnerStartMin: trip.hasVulnerable ? 19 * 60 : undefined,
    dinnerEndMin: trip.hasVulnerable ? 20 * 60 : undefined,
    allowPostDinnerDriveMin: trip.driveAfterDinnerMin,
  }
  // A round trip's SPLIT demands days for the whole loop (2× the outbound
  // corridor — the return re-traces the same road). The CLOCK walk (#145) now
  // models it honestly instead: one outbound walk + a directed return walk
  // from the destination, whose day count feeds the banner.
  const loopFactor = tripIsRoundTrip ? 2 : 1
  // #126: conducted modes (train/bus/flight/taxi) have no driving fatigue —
  // the split verdict stays null and every banner/chip/arming consumer below
  // goes quiet through that single gate.
  const splitVerdict = useMemo(
    () => planDriveDays({ totalKm: planKm * loopFactor, driveMinutes: wholeTrip.min * loopFactor, rainFactor, profile: tripIsRoundTrip ? loopProfile(roadProfile) : roadProfile, ...partyOpts }),
    // #213 Phase 3: dayWeatherCode IS a dep (rainFactor reads it for severity
    // weighting, #141) — same omission the clockVerdict had. The two verdicts
    // now invalidate together on a forecast fetch.
    [planKm, wholeTrip.min, trip.travelStyle, trip.transportMode, trip.driverCount, trip.hasVulnerable, loopFactor, dayRainPct, dayWeatherCode, roadProfile],
  )
  const clockVerdict = useMemo(
    // #127 per-day rain array; #142 party cap; #122 anchors; #145 a round trip
    // walks the OUTBOUND leg and returns a directed `returnDays` pass — the walk
    // no longer fakes the loop as a single 2× line.
    () => planTravelClock({ totalKm: planKm, driveMinutes: wholeTrip.min, dayStart: trip.days[0]?.startTime, rainFactor, dayRainPct: dayRainPct ?? undefined, roundTrip: tripIsRoundTrip, profile: roadProfile, ...partyOpts, anchors: tripAnchors }),
    // Stable keys only (#135): the walk reads startTimes + party/mode, never the
    // days array identity. #213 Phase 3: dayWeatherCode was missing — a storm
    // code change with unchanged rainChancePct left the banner stale.
    [planKm, wholeTrip.min, trip.travelStyle, trip.transportMode, trip.driverCount, trip.hasVulnerable, trip.driveAfterDinnerMin, dayStartSig, dayRainPct, dayWeatherCode, tripIsRoundTrip, roadProfile],
  )
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
  const travelDayNeed = clockVerdict.verdict === 'ok'
    ? clockVerdict.days.length + (clockVerdict.returnDays?.length ?? 0)
    : clockVerdict.verdict === 'hop'
      ? 1
      : splitVerdict?.driveDayCount ?? 1
  // #141: drizzle-grade rain (a 40%+ chance whose WMO code says drizzle or
  // light rain) damps the cap gently — the note keeps it a "slow day", never
  // a verdict flip; storms damp fully and the split banner flips honestly.
  const drizzleDay = drizzleDayIndex(dayRainPct, dayWeatherCode)
  // The split wants more days than planned: propose applying it. Declining is
  // respected — with the honest red fatigue verdict stated, never hidden.
  const [splitDeclined, setSplitDeclined] = useState(false)
  // Reset on the single-source count (#123): apply → recompute → same count →
  // the banner stays dismissed instead of re-firing on its own mutation.
  useEffect(() => { setSplitDeclined(false) }, [travelDayNeed])
  const applySplitDays = () => {
    if (clockVerdict.verdict !== 'ok') return // defer/hop: nothing honest to stamp
    const add = travelDayNeed - trip.days.length // #123 single source
    if (add <= 0) return
    applyChange(draft => {
      let next = Math.max(...draft.days.map(d => d.index)) + 1
      for (let i = 0; i < add; i++) {
        // #133 — stamp real shells: title + startTime so clockVerdict and
        // computeTotals never fall back to undefined. Dates are derived from
        // the day index (ItineraryDay carries no date), so extending endDate
        // is what keeps the new shells inside the trip.
        const dayNo = trip.days.length + i + 1
        draft.days.push({
          id: uid('day'),
          index: next,
          title: `Travel day ${dayNo}`,
          startTime: '08:30',
          stops: [],
        })
        next += 1
      }
      draft.days.sort((a, b) => a.index - b.index)
      if (trip.endDate) draft.endDate = isoAddDays(trip.endDate, add)
    }, 'add', -1)
    setSplitDeclined(true) // own mutation must not re-fire the banner
    toast(`Added ${add} travel day${add !== 1 ? 's' : ''} (08:30 starts) - accept a night halt to pin them`)
  }

  // #420 slice 11: the corridor cache (hash, publish, both scans) lives in
  // ./map/useCorridorCache. It returns values only, never callbacks.
  const { fractionPois, corridorQuotaOut, loadingPois } = useCorridorCache({
    trip, anchors, routeGeometry, scopeKm, dayRainPct, dayWeatherCode, crewSeeds,
    dnaTick, onInputsHash, pois, setPois, nearbyOpts, planKm,
    wholeTripMin: wholeTrip.min, travelDayNeed,
    clockVerdict: clockVerdict.verdict, splitDriveDayCount: splitVerdict?.driveDayCount,
    refreshTick, suggestionCache,
  })

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
    searchQ, setSearchQ, searchResults, setSearchResults, searching,
    showAllResults, setShowAllResults, omniQ, setOmniQ, omniResults,
    setOmniResults, omniPicked, setOmniPicked, searchQuotaOut,
    onSearch, onOmniSearch,
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
    setAddedIds(prev => {
      const next = new Set(prev)
      for (const h of hits) next.add(String(h.id))
      return next
    })
  }, [])

  // A preview that is DISCARDED must not leave a ghost: when the preview slot
  // closes, release every id this tab staged whose place is not in the plan.
  // (After Keep the stop is in `trip`, so its name is in `identity` and the id
  // stays — which is the invariant: added ⟺ visible-in-preview-or-committed.)
  useEffect(() => {
    if (previewOpen || stagedIdsRef.current.size === 0) return
    const staged = stagedIdsRef.current
    stagedIdsRef.current = new Map()
    const release = new Set(discardedStagedIds(staged, identity.names))
    if (release.size === 0) return
    setAddedIds(prev => {
      const next = new Set(prev)
      for (const id of release) next.delete(id)
      return next
    })
  }, [previewOpen, identity])

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

  /** A search pick filed into a slot: real detour math from the SAME helpers
   *  the engine uses (asymmetric against the drawn road + the day's real
   *  budget). #420 slice 5: the candidate SHAPE — unknown fields honestly null,
   *  no fabricated arrival time, provenance in the reason line — lives in
   *  ./map/slotFiling with its tests; this only supplies the math. */
  function makeManualCandidate(h: PlaceHit) {
    return manualCandidateFor({
      hit: h,
      detourMin: asymmetricDetourMinutes(h, anchors, routePolyline ?? null, MODE_SPEED[trip.transportMode] ?? 40),
      detourKm: asymmetricDetourKm(h, anchors, routePolyline),
      budgetMin: dayDetourBudgetMin({
        travelStyle: trip.travelStyle,
        plannedStops: (trip.days.find(d => d.index === activeDayIndex)?.stops ?? []).filter(x => x.status !== 'rejected').length,
      }),
      sharePct: budgetSharePct,
    })
  }

  /** Engine candidates plus this slot's own search picks — manual ones first
   *  (they are the user's explicit picks), re-validated at render per #179: a
   *  hit later added to the plan or dismissed drops out instead of doubling. */
  function slotCands(slot: DaySlot) {
    const manual = (slotManual[slot.key] ?? [])
      .filter(h => !isAlreadyAdded(h, identity))
      .map(makeManualCandidate)
    // #420 slice 5: manual picks first, then the engine's minus their ids — the
    // merge rule lives in ./map/slotFiling so it cannot drift from the refusal
    // that reads the same two lists.
    return mergeSlotCandidates(manual, slot.candidates)
  }

  /** The mockup's headline interaction: find inside the open part. Mirrors
   *  onSearch's guards (2-char floor, seq ownership, scope rank, quota class)
   *  but answers into slot-local state, so the top search card keeps owning
   *  corridor-wide discovery. */
  async function runSlotSearch(slot: DaySlot) {
    const q = (slotSearch?.key === slot.key ? slotSearch.q : '').trim()
    if (q.length < 2 || slotSearch?.busy) return
    const mySeq = ++slotSeq.current
    slotAbort.current?.abort()
    const controller = new AbortController()
    slotAbort.current = controller
    setSlotSearch({ key: slot.key, q, busy: true, hits: [], err: null })
    try {
      const hits = await searchPlacesText(q, { routeCoords: routeGeometry, anchors, signal: controller.signal })
      if (mySeq !== slotSeq.current) return
      const ranked = hits
        .map(h => ({ h, off: asymmetricDetourKm(h, anchors, routePolyline) }))
        .sort((a, b) => (a.off ?? 9999) - (b.off ?? 9999))
        .map(x => x.h)
      setSlotSearch(s => (s && mySeq === slotSeq.current ? { ...s, busy: false, hits: ranked } : s))
      if (hits.length === 0) toast(`No places found for "${q}".`)
    } catch (err) {
      if (mySeq !== slotSeq.current || controller.signal.aborted) return
      setSlotSearch(s => (s && mySeq === slotSeq.current
        ? { ...s, busy: false, err: err instanceof QuotaExhaustedError
            ? 'Google Places monthly cap reached - text search stays paused until the counter rolls over.'
            : 'Search failed - try again.' }
        : s))
    }
  }

  /** File a found place into THIS slot as a candidate (never straight into the
   *  plan — Fill stays the second, explicit act) under the #179 guards. */
  function addManualCandidate(slot: DaySlot, h: PlaceHit) {
    // #420 slice 5: the two refusals (and their copy) live in ./map/slotFiling,
    // checked in the order the user meets them.
    const refusal = slotFileRefusal({
      hit: h,
      slotLabel: slot.label,
      manual: slotManual[slot.key] ?? [],
      candidates: slot.candidates,
      isAdded: x => isAlreadyAdded(x, identity),
    })
    if (refusal) {
      toast(refusal.message)
      return
    }
    setSlotManual(prev => ({ ...prev, [slot.key]: [h, ...(prev[slot.key] ?? [])] }))
    setSlotSearch(s => (s && s.key === slot.key ? { ...s, q: '', hits: [], err: null } : s))
    toast(`"${h.name}" added as a candidate for the ${slot.label.toLowerCase()} slot.`)
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

  const dayOptions = trip.days.map(d => ({ index: d.index }))

  // #420 slice 13: the rail content (split, engine, costs, pool, arcs)
  // lives in ./map/useRailContent. Values only, never callbacks — the
  // render-called helpers stay with the page for the rails slice.
  const { needs, seeAndDoLive, hitEngine, hitCosts, altPool, arcHits, arcs } = useRailContent({
    pois, anchors, routePolyline, transportMode: trip.transportMode,
    travelStyle: trip.travelStyle, days: trip.days, dayForKm, identity,
  })

  const detourMinFor = (hit: PlaceHit): number | null =>
    hitEngine.get(String(hit.id))?.detourMin
      ?? asymmetricDetourMinutes(hit, anchors, routePolyline ?? null, MODE_SPEED[trip.transportMode] ?? 40)
  const chipFacts = { detourMinFor, days: trip.days, dayForKm, travelStyle: trip.travelStyle }

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
    poiVisitMinutes,
    routeKmOf,
    detourMinFor,
    busy: addingAny,
    setBusy: setAddingAny,
  })
  const seeForRail = chipFilter ? seeAndDoLive.filter(sh => sh.hit && chipsFor(sh, sh.hit, chipFacts).some(c => c.key === chipFilter)) : seeAndDoLive
  const filterActive = chipFilter != null
  // Detour-budget enforcement (Horizon 3.2's "finite, honest menu"): the
  // see-&-do list is the endless one — need halts are finite by construction,
  // so the budget gates only sights. Per day: walk the journey-ordered sight
  // hits, spend each one's detour minutes against that day's budget, and mark
  // whatever no longer fits as HELD BACK — counted and shown as a line, never
  // offered as an addable card.
  const budgetHeldIds = new Set<string>()
  let budgetHeldCount = 0
  {
    const byDay = new Map<number, SegmentHit[]>()
    for (const sh of seeAndDoLive) {
      if (!sh.hit) continue
      const d = dayForKm(sh.hit.cumKm) ?? 0
      const list = byDay.get(d) ?? []
      list.push(sh)
      byDay.set(d, list)
    }
    for (const [d, rows] of byDay) {
      const budget = dayDetourBudgetMin({
        travelStyle: trip.travelStyle,
        plannedStops: (trip.days.find(x => x.index === d)?.stops ?? []).filter(s => s.status !== 'rejected').length,
      })
      const { deferred } = splitByDetourBudget(
        rows.map(sh => ({ sh, detourMin: detourMinFor(sh.hit!) })),
        budget,
      )
      for (const { sh } of deferred) {
        budgetHeldIds.add(sh.hit!.id as string)
        budgetHeldCount += 1
      }
    }
  }
  // Quota honesty (Google-only directive): when the textSearchPro soft cap is
  // hit, every Google-mode corridor scan returns [] — say why instead of
  // rendering an empty state that reads like "nothing around".
  const corridorQuotaBlocked = corridorQuotaOut || searchQuotaOut || anyQuotaExhausted('textSearchPro', 'nearbySearch', 'placeDetails')
  const quotaOut = googleEnabled() && corridorQuotaBlocked

  /**
   * "Also nearby" candidates, pre-grouped once per render instead of per row.
   * Detour distance is the expensive part (it walks the anchor list), so it is
   * computed once per hit here; rows only rank the already-filtered pool.
   */

  /**
   * P2 ledger row for the see-&-do rail: the corridor pick as a flat two-line
   * row on the spine - name + one meta line (detour, day, window reasons) -
   * expanding in place to a shelf with the card's actions. Replaces the old
   * boxed cards in the ledger, keeping every behaviour reachable.
   */
  function renderLedgerRow(sh: SegmentHit) {
    const hit = sh.hit
    if (hit && dismissedIds.has(hit.id as string)) return null
    if (!hit) return renderGapRow(sh) // gaps keep their honest row
    const added = isAlreadyAdded(hit, identity)
    const detourMin = hitEngine.get(String(hit.id))?.detourMin
      ?? asymmetricDetourMinutes(hit, anchors, routePolyline ?? null, MODE_SPEED[trip.transportMode] ?? 40)
    const chips = chipsFor(sh, hit, chipFacts)
    const hitDay = dayForKm(hit.cumKm)
    const alts = alternativesFor(sh, hit, altPool).filter(e => e.h.id !== hit.id)
    const shelf = (
      <div className="ledger-shelf">
        {chips.length > 0 && chips.map(c => (
          <button
            key={c.key}
            type="button"
            className={(c.tone === 'warn' ? 'poi-rchip poi-rchip--warn' : 'poi-rchip') + (chipFilter === c.key ? ' is-on' : '')}
            aria-pressed={chipFilter === c.key}
            onClick={(e) => { e.stopPropagation(); setChipFilter(prev => (prev === c.key ? null : c.key)) }}
          >
            {c.icon === 'star' && <Star size={11} aria-hidden />}
            {c.label}
          </button>
        ))}
        {editable && (
          added
            ? <span className="chip chip-teal"><InlineIcon icon={CircleCheck} size={11} gap={3} />Added</span>
            : <button className="day-slot-fill" onClick={() => openAddModal(hit)}>+ Add to a day</button>
        )}
        {!added && editable && (
          <button
            className="chip chip-sm"
            title="Not interested - hide this and teach the engine"
            onClick={() => {
              recordDnaEvent({ tripId: trip.id, action: 'decline', haltKind: sh.segment.purpose, category: hit.category, detourMin: detourMin ?? undefined })
              // Dismiss is a local rail decision: keep the current plan visible
              // and do not invalidate/rebill the corridor. DNA is persisted and
              // will be read by the next explicit replan.
              setDismissedIds(prev => new Set(prev).add(hit.id as string))
            }}
          >Dismiss</button>
        )}
        {!added && editable && (
          <button
            className="chip chip-sm"
            aria-pressed={isShortlisted(hit)}
            title="Collect for the shortlist tray - the rail collects, the tray decides"
            onClick={() => toggleShortlist(hit)}
          >
            {isShortlisted(hit) ? 'Shortlisted' : 'Shortlist'}
          </button>
        )}
        {alts.length > 0 && alts.map(({ h, dKm }) => (
          <button
            key={h.id as string}
            className="shelf-alt"
            title={h.name}
            onClick={() => openAddModal(h)}
          >
            <span className="shelf-alt-nm">{h.name}</span>
            <span className="shelf-alt-km">{dKm != null ? `${dKm.toFixed(1)} km off` : 'on route'}</span>
          </button>
        ))}
      </div>
    )
    const meta = [
      detourMin == null ? 'position unknown' : detourMin > 0 ? `+${Math.round(detourMin)} min detour` : 'on route',
      hitDay != null ? `Day ${hitDay + 1}` : null,
    ].filter(Boolean).join(' \u00b7 ')
    return (
      <details key={hit.id as string} className="lrow-new" onToggle={undefined}>
        <summary className="lrow-sum" title={hit.name}>
          <span className="xdot" aria-hidden />
          <span className="lr-name">{hit.name}</span>
          <span className="lr-meta">{meta}</span>
          <ChevronDown className="lr-go" size={12} aria-hidden />
        </summary>
        {shelf}
      </details>
    )
  }


  // ---- P2: the day's plan (slots rail) ----
  // One derivation feeds the rail, the meter and the fill flow: slots derive
  // from engine output alone (src/lib/daySlots.ts), so the view can never
  // drift from the engine. stopSig/refreshTick keep the memo honest against
  // store writes; the deps memo carries the expensive shared inputs.
  const daySlotSig = `${stopSig}|${refreshTick}|${dismissedIds.size}|${addedIds.size}|${shortlist.length}`
  // #420 slice 14: the day's plan derivations (deps, stops, slots, readiness,
  // rows, hints, pins) live in ./map/useDaySlots. Values only, never callbacks.
  const { daySlotDeps, activeDayStops, activeDaySlots, activeDayReadiness, tripReadinessRows, dnaSlotHints, slotPins } = useDaySlots({
    pois, anchors, routePolyline, transportMode: trip.transportMode, travelStyle: trip.travelStyle,
    existingNames, identity, altPool, dayAttribution, decisions, members: trip.members,
    travellers: trip.travellers, startLocationCoords: trip.startLocationCoords, tripId: trip.id,
    crewSeeds, dnaTick, addedIds, dismissedIds, days: trip.days, activeDayIndex, daySlotSig,
  })

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
    addManualCandidate,
    toggleShortlist,
    raiseShortlistVote,
  })
  const [openSlotKey, setOpenSlotKey] = useState<string | null>(null)
  // P1: closing or switching parts drops the in-flight search (the seq bump
  // retires any query still in the air so its rows can never land elsewhere).
  useEffect(() => { slotSeq.current += 1; setSlotSearch(null) }, [openSlotKey])
  // Plan P2.5's mobile slots summary: collapsed to a count + open on phones,
  // desktop hides the summary so this state never touches it there.
  const [slotsPeek, setSlotsPeek] = useState(false)
  /** m5: `DaySlotKind` is exactly the four keys the hints are built for, so an
   *  unknown kind yields nothing. The old ternary's last branch fell through to
   *  the stretch hint, which would quietly mislabel any future kind. */
  const slotPattern = (kind: DaySlotKind): string | null => dnaSlotHints[kind] ?? null
  const [fillingDay, setFillingDay] = useState(false)
  const { addPoiToDay, fillSlot, fillTheDay, raiseSlotVote } = useMapWriters({
    resolvePick, applyChange, trip, pois, routeKmOf, anchors, routePolyline,
    activeDayIndex, activeDaySlots, markStaged, addingAny, addingIdsRef,
    setAddingIds, setAddingAny, fillingDay, setFillingDay, setDnaTick,
    setOpenSlotKey, onOpenGroupInput,
  })
  /** P6.1: the rail's second reading - the day as a shape on one clock. */
  const [shapeView, setShapeView] = useState(false)
  const shapeBlocks = useMemo(
    // Derived only while the Shape view is open (it ran on every render even
    // with the list showing), and handed the slots already computed for the
    // rail so the day is not derived a third time.
    () => (shapeView
      ? dayShape(activeDayIndex, { ...daySlotDeps, dayStops: activeDayStops }, activeDaySlots)
      : []),
    [shapeView, activeDayIndex, daySlotDeps, activeDayStops, activeDaySlots],
  )
  /** P5.3: the selected day's empty parts as hollow amber pins - their top
   *  candidate's real position, with P5.2's cost line in the tooltip. */
  /** A corridor halt the engine found no place for. The only row still rendered
   *  through here: every hit row is a flat ledger row (`renderLedgerRow`), so
   *  this is the honest gap — and its action is the lever the engine actually
   *  has, a wider detour scope. The live card renderer that used to follow this
   *  branch was unreachable once the ledger replaced the boxed cards, and has
   *  been removed. */
  function renderGapRow(sh: SegmentHit) {
    const hit = sh.hit
    // dismissed stays hidden for the session (logged as a DNA decline)
    if (hit && dismissedIds.has(hit.id as string)) return null
    if (!hit) {
      return (
        <div key={`gap-${sh.segment.index}`} className="poi-plan-row poi-plan-gap">
              <span className={`ride-purpose ride-purpose-${sh.segment.purpose} ride-purpose-muted`}>{sh.segment.label}</span>
              <span className="muted small">No good match near ~{sh.segment.targetKm.toFixed(0)} km yet.</span>
              {/* A gap has no place to add, so the action raises the corridor's
                  detour scope - the honest lever the engine actually has. */}
              <button
                type="button"
                className="poi-gap-add"
                title="Raises the detour scope so more stops qualify. You can also add a stop on the Timeline and it will pin itself here."
                onClick={() => {
                  setScopeIdx(i => Math.min(i + 1, SCOPE_KM_STEPS.length - 1))
                  toast('Widened the search - the corridor will re-plan')
                }}
              >
                Widen search
              </button>
            </div>
      )
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card" style={{ order: 1 }}>
        <div className="row-between">
          <h3 style={{ margin: 0 }}><InlineIcon icon={Lightbulb} size={16} gap={4} vAlign="-3px" />Nearby ideas</h3>
          <div className="row-between" style={{ gap: 10 }}>
            <span className="small muted" aria-live="polite">{loadingPois ? 'searching…' : `${pois.filter(p => p.hit).length} suggested stops - spaced for fatigue & anchored on cities`}</span>
            <button
              className="btn btn-outline btn-sm suggestion-refresh-btn"
              title="Refresh suggestions"
              onClick={() => { suggestionCache.clearMap(); setRefreshTick(t => t + 1) }}
              disabled={loadingPois}
            >
              <InlineIcon icon={RotateCcw} size={12} gap={3} />Refresh
            </button>
          </div>
        </div>
        <div className="hint-text" style={{ margin: '4px 0 6px' }}>
          Live data from {googleEnabled() ? 'Google Places' : 'OpenStreetMap, Wikipedia & Mappls'} — every idea is clock-anchored, budget-checked, and never around your starting point.{' '}
          <details className="hint-more">
            <summary>How suggestions work</summary>
            Lunch lands in the 11:30–14:30 window, stretch breaks follow wheel time, fuel rides your tank’s rhythm, and long drives end at a real city for the night. Every pick is checked against your detour budget.
          </details>
        </div>
        <form className="row-between" style={{ gap: 8, marginBottom: 8 }} onSubmit={onSearch}>
          <input className="input" value={searchQ} disabled={quotaOut} onChange={e => {
            setSearchQ(e.target.value)
            // #164: stale results from a PREVIOUS query must not sit visible
            // under the new one while typing — clear on edit. Emptying the box
            // also clears the map's search markers (searchHitIds → no rows).
            if (searchResults.length > 0) { setSearchResults([]); setShowAllResults(false) }
          }}
            placeholder="Search anything to add - a trek, a homestay, a petrol pump…"
            aria-label="Search places to add to the trip" style={{ flex: 1 }} />
          <button className="btn btn-outline btn-sm" type="submit" disabled={searching || quotaOut}
            title={quotaOut ? 'Google Places reached its 80% safety pause - resumes next UTC month' : undefined}
            style={{ flex: '0 0 auto' }}>
            {searching ? 'Searching…' : quotaOut ? 'Search paused' : 'Search'}
          </button>
        </form>
        {/* Quota honesty: say why the box is paused instead of a dead control. */}
        {quotaOut && (
          <p className="muted small" role="status" style={{ margin: '0 0 8px' }}>Google Places reached its 80% safety pause for this month - search resumes next UTC month. Remove the key in Settings and reload to use the free stack.</p>
        )}
        {/* #164: the short-query state was silent — say why nothing happens. */}
        {searchQ.trim().length > 0 && searchQ.trim().length < 2 && (
          <p className="muted small" role="status" style={{ margin: '0 0 8px' }}>Keep typing - search starts at 2 characters.</p>
        )}
        {searchResults.length > 0 && (
          <div className="map-search-results" ref={searchListRef} style={{ marginBottom: 10 }} role="listbox" aria-label={`Search results. ${Math.min(showAllResults ? searchResults.length : SEARCH_PAGE, searchResults.length)} of ${searchResults.length} shown. Use the arrow keys to move between them, Enter or Space to pin one.`}>
            {searchResults.slice(0, showAllResults ? searchResults.length : SEARCH_PAGE).map(({ h, km, off }, rowIndex) => {
              const inScope = off != null && off <= scopeKm
              // SB2: the same membership guard every other rail row uses
              // (renderLedgerRow, and the card before it). Without it this row
              // was the one place that would happily add the same place twice.
              const added = isAlreadyAdded(h, identity)
              // Selected twin: clicking the map's search marker highlights this
              // row (activeHitId) just as hovering the row glows its pin.
              const selected = activeHitId != null && activeHitId === h.id
              return (
                <div key={h.id as string} role="option" data-hit-id={h.id as string} className={`row-between${selected ? ' is-selected' : ''}`} aria-selected={selected} tabIndex={selected || (activeHitId == null && rowIndex === 0) ? 0 : -1}
                  onMouseEnter={() => setActiveHitId(h.id as string | number)}
                  onMouseLeave={() => setActiveHitId(cur => (cur === (h.id as string | number) ? pinnedHitId ?? null : cur))}
                  onFocus={() => { keyboardScrollRef.current = true; setActiveHitId(h.id as string | number) }}
                  onBlur={() => setActiveHitId(cur => (cur === (h.id as string | number) ? pinnedHitId ?? null : cur))}
                  onClick={() => { const id = h.id as string | number; const next = pinnedHitId === id ? null : id; setPinnedHitId(next); setActiveHitId(next) }}
                  onKeyDown={e => {
                    // #333 A1: the shared grammar (lib/railKeys), not a lone Enter
                    // branch. Space must be claimed or the page scrolls under the
                    // pin it just made; arrows move the roving tabIndex and focus.
                    const rows = searchResults.slice(0, showAllResults ? searchResults.length : SEARCH_PAGE)
                    const action = railKeyAction(e.key, { highlight: rows.findIndex(r => r.h.id === h.id), count: rows.length })
                    if (action.type === 'none') return
                    e.preventDefault()
                    if (action.type === 'move') {
                      const next = rows[action.highlight]
                      if (!next) return
                      keyboardScrollRef.current = true
                      setActiveHitId(next.h.id as string | number)
                      const el = searchListRef.current?.querySelector(`[data-hit-id="${next.h.id}"]`)
                      if (el instanceof HTMLElement) el.focus()
                    } else if (action.type === 'pin') {
                      const id = h.id as string | number
                      const next = pinnedHitId === id ? null : id
                      setPinnedHitId(next); setActiveHitId(next)
                    } else {
                      setPinnedHitId(null); setActiveHitId(null)
                    }
                  }}
                  >
                  <span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.name}{h.nearestCity ? ` · ${h.nearestCity}` : ''}
                    {/* Google hits carry a trusted rating + reported hours — surface them. */}
                    {h.rating != null && (h.ratingCount ?? 0) >= 10 ? `, ${h.rating.toFixed(1)}★` : ''}
                    {(h.openTime || h.closeTime) ? `, ${formatHMRange(h.openTime, h.closeTime, timeFormat)}` : ''}
                    <span className="muted">{', '}
                      {(() => {
                        const labelled = kmLabelFor(km)
                        return km != null ? `~${Math.round(labelled ?? km)} km into the trip${showReturn ? '' : ' (outbound)'}` : 'off the road'
                      })()}
                      {off != null ? `, ${off < 0.5 ? 'on route' : `${Math.round(off)} km off-route`}` : ''}
                    </span>
                    {/* #333 A7: out-of-scope rows used to be dimmed to opacity 0.6,
                        which washed out text that was already near the contrast
                        floor AND made the row's own action buttons read as
                        disabled while they were still pressable. The reason is
                        stated in words instead — the same phrasing the row
                        already carried, now visible rather than whispered. */}
                    {!inScope && <span className="chip chip-saffron" style={{ marginLeft: 6 }}>beyond your detour scope</span>}
                  </span>
                  {editable && (added ? (
                    <span style={{ flex: '0 0 auto', marginLeft: 8 }}>
                      <span className="chip chip-teal"><InlineIcon icon={CircleCheck} size={11} gap={3} />Added</span>
                    </span>
                  ) : (
                    <span style={{ display: 'flex', gap: 4, flex: '0 0 auto', alignItems: 'center', marginLeft: 8 }}>
                      {filingOptionsForPicked(h).map(o => (
                        <button
                          key={o.key}
                          type="button"
                          className="chip chip-sm"
                          title={`File this place as Day ${activeDayIndex + 1}'s ${o.noun}`}
                          onClick={() => {
                            const slot = activeDaySlots.find(x => x.key === o.key)
                            // SB3: say why rather than swallowing the tap when
                            // the part filled itself in the meantime.
                            if (!slot) { toast(`Day ${activeDayIndex + 1}'s ${o.noun} is already planned.`); return }
                            void fillSlot(slot, h)
                          }}
                        >{o.label}</button>
                      ))}
                      <button className="btn btn-primary btn-sm" type="button" disabled={addingAny} onClick={() => openAddModal(h, km)}>+ Add</button>
                    </span>
                  ))}
                </div>
              )
            })}
          </div>
        )}
        {/* #333 A5: the result count sat in a static aria-label; this says it aloud
            when it changes. Always mounted — a region that mounts with its text is silent. */}
        <span className="sr-only" role="status" aria-live="polite">{searchAnnouncement(searchQ, searchResults.length, showAllResults ? searchResults.length : SEARCH_PAGE)}</span>
        {searchResults.length > 5 && (
          <button type="button" className="btn btn-outline btn-sm" style={{ marginBottom: 10 }} onClick={() => setShowAllResults(v => !v)}>
            {showAllResults ? 'Show top 5' : `Show all ${searchResults.length}`}
          </button>
        )}
        <div className="row-between" style={{ gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
              <datalist id="scope-km-ticks">{SCOPE_KM_STEPS.map((km, i) => <option key={km} value={i} label={`${km} km`} />)}</datalist>
          <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 150 }}>
            <span className="muted" style={{ whiteSpace: 'nowrap' }}>Detour scope</span>
            <input
              type="range"
              min={0}
              max={SCOPE_KM_STEPS.length - 1}
              step={1}
              value={scopeIdx}
               disabled={loadingPois || quotaOut}
              onChange={e => changeScope(Number(e.target.value))}
              style={{ flex: 1 }}
              aria-label="How far from the route to search suggestions"
            aria-valuetext={scopeValueText(scopeKm)}
            list="scope-km-ticks"
            />
            <b style={{ whiteSpace: 'nowrap', minWidth: 46, textAlign: 'right' }}>{scopeKm} km</b>
          </label>
        </div>
        {/* Day Planner proposals (P1-B/P1-C) — the split the route demands,
            the defer/hop verdict for the real start time. They sit above the
            strip because they change WHAT the strip plans. */}
        {clockVerdict.verdict === 'defer' && (
          <div className="dayplanner-banner" role="status">
            <b>Too late to drive honestly today.</b>
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
            <b>Late start - a short hop, then rest.</b>
            <span className="small muted">{clockVerdict.reason}</span>
          </div>
        )}
        {(routeTotalKm != null || roadNeedsRetry) && splitVerdict && clockVerdict.verdict === 'ok' && travelDayNeed > trip.days.length && (
          <div className="dayplanner-banner" role="status">
            <b>This drive needs {travelDayNeed} travel days{tripIsRoundTrip ? ' - there and back' : ''}.</b>
            <span className="small muted">
              {routeFailed && 'Rough estimate - the road measurement did not resolve. '}≈{Math.round(splitVerdict.perDay)} km a day keeps wheel time ≈{minutesToHM(splitVerdict.maxDailyWheelMin)} - the honest cap for {(trip.travelStyle ?? 'balanced')} pace.
            </span>
            {roadRetryUnderway && (
              <span className="small muted">
                <InlineIcon icon={RefreshCw} size={12} gap={3} />Measuring the road again — the estimates hold until it resolves.
              </span>
            )}
            {!splitDeclined ? (
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={applySplitDays}>
                  Apply - add {travelDayNeed - trip.days.length} day{travelDayNeed - trip.days.length !== 1 ? 's' : ''}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSplitDeclined(true)}>Keep my {trip.days.length}-day plan</button>
              </div>
            ) : (
              <span className="small dayplanner-red">
                Keeping {trip.days.length} day{trip.days.length !== 1 ? 's' : ''}: ≈{minutesToHM(wholeTrip.min * loopFactor)} behind the wheel in a single stretch is past the honest cap - the fatigue verdict stays red.
              </span>
            )}
            {roadNeedsRetry && road && !roadRetryUnderway && (
              <button className="btn btn-outline btn-sm" onClick={road.retry}
                title="Ask the routing provider again — the first tries may have been rate-limited">
                <InlineIcon icon={RefreshCw} size={12} gap={3} />Retry road measurement
              </button>
            )}
            {drizzleDay >= 0 && dayRainPct && (
              <span className="small muted">☁ {Math.round(dayRainPct[drizzleDay]!)}% rain chance on day {drizzleDay + 1} - {travelDayNeed !== 1 ? travelDayNeed : 'one'} day{travelDayNeed !== 1 ? 's' : ''} planned stays, but pack a buffer for one more.</span>
            )}
          </div>
        )}
        {/* #141 standalone: drizzle-grade rain never flips the verdict, so it
            says itself when no split banner is up. */}
        {drizzleDay >= 0 && dayRainPct && !(splitVerdict && clockVerdict.verdict === 'ok' && travelDayNeed > trip.days.length) && clockVerdict.verdict === 'ok' && (
          <p className="hint-text" role="status">☁ {Math.round(dayRainPct[drizzleDay]!)}% rain chance on day {drizzleDay + 1} - a slow day, not a new plan. The split holds; carry the umbrella.</p>
        )}
        {!loadingPois && pois.length === 0 && (
          fractionPois && fractionPois.length > 0 ? (
            <div>
              <p className="muted small" style={{ marginBottom: 6 }}>
                Below the fatigue-plan floor, but the corridor has places - the closest to each quarter of the drive:
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
                        ? 'no sight or meal near this quarter - try widening the detour scope.'
                        : 'no corridor stop found - add a stop on the Timeline and suggestions will pin themselves here.'}</span>
                    )}
                  </div>
                )
                })
              })()}
            </div>
          ) : quotaOut ? (
            // #176: under quota-out the empty strip must not blame the plan.
            <p className="muted small">Google search quota reached - corridor fallback suggestions are paused until the counter rolls over (this is not about your route).</p>
          ) : (
            <p className="muted small">Not enough driving distance yet for a fatigue plan - add a longer route (90+ km) in the Timeline and segmented stop suggestions will appear here.</p>
          )
        )}
      </div>
      {filterActive && (
        <div className="poi-filterbar" role="status">
          {/* #162: the bar reads the label, the filter keys on the stable key. */}
          <span>Showing only suggestions that are {{ 'over-budget': 'over budget', 'lunch-window': 'in the lunch window', stretch: 'a long stretch from the last stop', rating: 'rated 4.0+', 'budget-share': 'using a big share of the day budget', 'first-stop': 'the day’s first stop' }[chipFilter as string] ?? chipFilter}</span>
          <button type="button" onClick={() => setChipFilter(null)}>Clear filter</button>
        </div>
      )}
      {/* #415: in the narrow band the two rails are one sheet at a time, so a thumb
          never scrolls past a rail it does not want. Hidden at desktop width, where
          both rails are columns again. */}
      {sheetApplies && (
        <div className="map-ideas-sheet-tabs" role="group" aria-label="Planning rail">
        {SHEET_TABS.map(t => (
          <button
            key={t.key}
            type="button"
            className={'chip' + (sheetTab === t.key ? ' chip-saffron' : '')}
            aria-pressed={sheetTab === t.key}
            aria-controls={t.panelId}
            onClick={() => setSheetTab(t.key)}
            onKeyDown={e => {
              const next = sheetTabMove(t.key, e.key)
              if (next) { e.preventDefault(); setSheetTab(next) }
            }}
          >{t.label}</button>
        ))}
        </div>
      )}
      <div className={'map-ideas-grid' + (folded.needs ? ' is-needs-folded' : '') + (folded.see ? ' is-see-folded' : '')} ref={listRef}>
        <EngineTips />
        <div className={'poi-col poi-col--needs' + sheetHiddenClass('needs', sheetTab, sheetApplies)} id="rail-needs">
            <div className="poi-col-head">
              <span className="poi-col-head-ico"><Fuel size={13} aria-hidden /></span>
              <div className="poi-col-head-txt">
                <b>Day {activeDayIndex + 1} · {activeDayLabel(trip.days, activeDayIndex)}</b>
                <span className="small muted">{activeDaySlots.length === 0 ? 'the day takes shape as you plan the drive' : `${activeReadinessLabel(activeDayReadiness)}`}</span>
              </div>
              <button
                type="button"
                className="chip chip-sm"
                aria-pressed={shapeView}
                title={shapeView ? 'Back to the list' : 'See the day as a shape - drives and parts on one clock'}
                onClick={() => setShapeView(v => !v)}
              >{shapeView ? 'List' : 'Shape'}</button>
              {editable && activeDaySlots.some(s => s.state === 'empty' && s.candidates.length > 0) && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={fillingDay}
                  onClick={() => { void fillTheDay() }}
                  title="Add the top candidate for every empty part of the day"
                >{fillingDay ? 'Planning.' : 'Fill the day'}</button>
              )}
              <span className="poi-col-count">{`${activeDayReadiness.filled}/${activeDayReadiness.required}`}</span>
              <button
                type="button"
                className="poi-fold"
                aria-expanded={!folded.needs}
                aria-controls="rail-needs"
                title={folded.needs ? 'Expand the needs rail' : 'Collapse the needs rail - the map gains the space'}
                onClick={() => setFolded(f => ({ ...f, needs: !f.needs }))}
              >
                <ChevronDown size={13} aria-hidden />
              </button>
            </div>
            {/* S9: this was `role="tablist"` / `role="tab"` with no tabpanel and
                no arrow-key roving focus — a screen reader was told these are
                tabs and told to use the arrow keys, and nothing happened. A
                group of pressed buttons says what is actually true. */}
            <div className="slots-daystrip" role="group" aria-label="Which day to plan">
              <span className="map-scope-lbl">Plan this day</span>
              {trip.days.map(d => {
                const r = tripReadinessRows.find(x => x.dayIndex === d.index)
                const filled = r?.filled ?? 0
                // `required` (total minus engine-managed) is the honest
                // denominator: a stretch break the user is told demands nothing
                // should not sit in the count they are measured against.
                const required = r?.required ?? 0
                const auto = r?.auto ?? 0
                return (
                  <button
                    key={d.index}
                    type="button"
                    aria-pressed={d.index === activeDayIndex}
                    aria-label={`Day ${d.index + 1}: ${filled} of ${required} planned${auto > 0 ? `, ${auto} engine-managed` : ''}`}
                    className={'slots-daychip' + (d.index === activeDayIndex ? ' is-on' : '')}
                    onClick={() => { setLocalDay(d.index); onDayFocusChange?.(d.index); setOpenSlotKey(null) }}
                  >
                    Day {d.index + 1} <span className="slots-daychip-rd">{filled}/{required}</span>
                    {dayRainPct?.[d.index] != null && dayRainPct[d.index]! >= 40 && (
                      <span className="slots-daychip-rain" title={`${Math.round(dayRainPct[d.index]!)}% rain chance`}>rain</span>
                    )}
                  </button>
                )
              })}
            </div>
            <div className="slots-railmeta">
              {quotaOut && (
                <span className="chip chip-sm" title="Google search quota reached - suggestions pause until the counter rolls over">Suggestions paused</span>
              )}
              <details className="slots-legend">
                <summary className="chip chip-sm">Legend</summary>
                <div className="slots-legend-body">
                  <p><b>✓</b> a planned part - one quiet line</p>
                  <p><b>○</b> an unplanned part - candidates inside</p>
                  <p><b>dashed ring</b> engine-managed (stretch breaks)</p>
                  <p><b>violet dot</b> an extra worth adding</p>
                </div>
              </details>
            </div>
            {activeDaySlots.length > 0 && (
              <div className="slots-meter" role="status" aria-label={`Day ${activeDayIndex + 1}: ${activeDayReadiness.filled} of ${activeDayReadiness.required} parts of the day planned${activeDayReadiness.auto > 0 ? `, ${activeDayReadiness.auto} engine-managed` : ''}`}>
                {activeDaySlots.map(s => (
                  <i key={s.key} className={s.state === 'filled' ? 'is-filled' : s.state === 'auto' ? 'is-auto' : 'is-empty'} />
                ))}
                <span className="slots-meter-lbl">{activeDayReadiness.filled} of {activeDayReadiness.required} planned{activeDayReadiness.auto > 0 ? ` · ${activeDayReadiness.auto} auto` : ''}</span>
              </div>
            )}
            {activeDaySlots.length > 0 && (
              <div className="slots-mobile-sum">
                <button
                  type="button"
                  className="chip chip-sm"
                  aria-expanded={slotsPeek}
                  aria-controls="slots-list"
                  onClick={() => setSlotsPeek(p => !p)}
                >
                  {slotsPeek ? 'Hide' : activeDaySlots.some(s => s.state === 'empty')
                    ? `${activeDaySlots.filter(s => s.state === 'empty').length} empty — open`
                    : 'Open'}
                </button>
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
                      ? `${b.label} - ${Math.round(b.minutes)} min from ${clockHM(b.startMin)}`
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
                  ? 'Google Places reached its 80% safety pause - corridor suggestions resume next UTC month.'
                  : needs.length === 0
                    ? 'No driving plan yet - the day takes shape as you add driving days.'
                    : `Nothing scheduled for Day ${activeDayIndex + 1} yet - its halts belong to other days.`}</p>
              </div>
            ) : (
              <div className={'slots-list' + (slotsPeek ? ' is-peek' : '')} id="slots-list">
              {mapScopeNote(mapFilter, activeDayIndex) && (
                <p className="hint-text" role="status">{mapScopeNote(mapFilter, activeDayIndex)}</p>
              )}
              {/* #333 A5: the slot's candidates had no live region, so a screen-reader
                  user opening a part heard nothing about what was in reach. Mounted even
                  when a part opens: it starts empty by design, and a region that MOUNTS already carrying its text is never announced. */}
              <span className="sr-only" role="status" aria-live="polite">{(() => {
                const open = activeDaySlots.find(s => s.key === openSlotKey)
                return open ? candidatesAnnouncement(open.label, slotCands(open).length) : ''
              })()}</span>
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
                  const windowEnd = slot.windowMin ? clockHM(slot.windowMin[1]) : ''
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
                                The plan now puts your pinned rest {Math.abs(Math.round(slot.drift.toKm - slot.drift.fromKm))} km from your pin.
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
                                {slot.vote.leadingLabel ? `${slot.vote.leadingLabel} leads` : 'no votes yet'} · open Group input
                              </span>
                            </div>
                          ) : (
                            <div className="day-slot-hint">
                              Nothing planned yet
                              <span className="n">
                                {slot.candidates.length > 0
                                  ? ` · ${slot.candidates.length} candidate${slot.candidates.length === 1 ? '' : 's'} inside, tap to compare`
                                  : ' · search the map to source one'}
                              </span>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="day-slot-top">
                          <span className="day-slot-st" aria-hidden>{slot.state === 'filled' ? '\u2713' : ''}</span>
                          <span className="day-slot-lab"><SlotGlyph kind={slot.kind} label={slot.label} />{slot.label}</span>
                          <span className="day-slot-win">{slot.windowLabel ?? ''}</span>
                          <span className="day-slot-val">
                            {slot.state === 'filled'
                              ? <b>{slot.filledStop?.title ?? slot.segment?.label ?? 'Planned'}</b>
                              : <small>{slot.reason ?? 'Engine-managed'}</small>}
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
                              onChange={e => setSlotSearch({ key: slot.key, q: e.target.value, busy: false, hits: [], err: null })}
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
                            <p className="muted small" style={{ margin: '0 0 6px' }}>Keep typing - search starts at 2 characters.</p>
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
                                <p className="muted small" style={{ margin: '4px 2px 0' }}>{slotSearch.hits.length - 6} more - refine the search to narrow it.</p>
                              )}
                            </div>
                          )}
                          {slotCands(slot).map(c => (
                            <div key={String(c.hit.id)} className="day-slot-cand">
                              <span className="day-slot-cand-nm">
                                <b>{c.hit.name}</b>
                                <span>
                                  {c.detourMin == null ? 'position unknown' : `+${Math.round(c.detourMin)} min`}
                                  {c.arriveLabel ? ` · arrive ${c.arriveLabel}` : ''}
                                  {(c.hit.openTime || c.hit.closeTime) ? ` · ${formatHMRange(c.hit.openTime, c.hit.closeTime, timeFormat)}` : ''}
                                  {c.detourMin == null ? 'position unknown' : c.budgetSharePct > 0 ? ` · ${c.budgetSharePct}% of day detours` : ' · on route'}
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
                          {slotCands(slot).length === 0 && (
                            <p className="muted small" style={{ margin: '4px 0 0' }}>
                              No candidates in reach{slot.windowLabel ? ` inside ${slot.windowLabel}` : ''} - add one on the Timeline, or search the map.
                            </p>
                          )}
                          {editable && !slot.vote && slotCands(slot).length >= 2 && (
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
              quotaOut={searchQuotaOut}
              results={omniResults}
              selectedId={omniPicked?.h.id ?? null}
              placement={omniPlacement}
              scopeKm={scopeKm}
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
              nearbyPois={mapPois}
              onAddNearby={editable ? (hit) => openAddModal(hit) : undefined}
              activeHitId={activeHitId}
              onActivateHit={setActiveHitId}
              onOpenInTimeline={onOpenTimeline}
              onOpenInBoard={onOpenBoard ? () => onOpenBoard() : undefined}
              focusDay={activeDayIndex}
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
                // After the unfold has painted.
                requestAnimationFrame(() => {
                  document.getElementById('rail-needs')?.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' })
                })
              }}
              onOpenHaltDay={onOpenDay}
              clockMilestones={clockMilestones}
              onDeleteStop={editable ? removeStopFromMap : undefined}
              enableMapViewModes
              mainRouteGeometry={routeGeometry}
              returnRouteGeometry={returnRouteGeometry}
              allowSelfMeasurement={false}
              onShowReturnChange={setShowReturn}
            />
          </div>
          <div className={'poi-col poi-col--see' + sheetHiddenClass('see', sheetTab, sheetApplies)} id="rail-see">
            <div className="poi-col-head">
              <span className="poi-col-head-ico"><MapPin size={13} aria-hidden /></span>
              <div className="poi-col-head-txt">
                <b>Optional extras</b>
                <span className="small muted">Sights · detours — never required</span>
              </div>
              <button
                type="button"
                className="poi-fold"
                aria-expanded={!folded.see}
                aria-controls="rail-see"
                title={folded.see ? 'Expand the see-&-do rail' : 'Collapse the see-&-do rail - the map gains the space'}
                onClick={() => setFolded(f => ({ ...f, see: !f.see }))}
              >
                <ChevronDown size={13} aria-hidden />
              </button>
            </div>
            <div className="poi-plan-list is-ledger">
              {!filterActive && arcs.slice(0, 2).length > 0 && (
                <div className="poi-grp">
                  <span className="poi-grp-k">Route arcs</span>
                  <span className="poi-grp-n">{arcs.slice(0, 2).length}</span>
                  <span className="poi-grp-ln" />
                </div>
              )}
              {arcs.slice(0, 2).map(arc => (
                <div key={arc.theme} className="poi-plan-row poi-plan-arc">
                  <div className="ride-spot-title">
                    <span className="ride-purpose ride-purpose-sight">{arc.theme}</span>
                    <b>{arc.arcBody}</b>
                  </div>
                  <div>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={async () => {
                        const toAdd: { hit: PlaceHit; dayIndex: number }[] = []
                        for (const id of arc.hitIds) {
                          const m = arcHits.find(h => (h.id as string) === (id as string))
                          if (!m || isAlreadyAdded(m, identity)) continue
                          const mDay = dayForKm(m.cumKm)
                          if (mDay == null) continue // no road position — cannot attribute to a day
                          toAdd.push({ hit: m, dayIndex: mDay })
                        }
                        // #346: rows hide locally (setAddedIds below) — no forced re-search.
                        // Resolve placeholder coords BEFORE writing — both
                        // providers emit (0,0) "resolve on pick" placeholders
                        // and a raw write pins the journey to Null Island
                        // (found live 2026-09-14). Unpinnable hits are skipped
                        // and stay available to retry.
                        const resolved: { hit: PlaceHit; dayIndex: number }[] = []
                        let unpinned = 0
                        for (const item of toAdd) {
                          const pinned = await resolvePick(item.hit)
                          if (!pinned) { unpinned += 1; continue }
                          recordDnaEvent({ tripId: trip.id, action: 'accept', haltKind: pinned.haltPurpose, category: pinned.category, detourMin: asymmetricDetourMinutes(pinned, anchors, routePolyline ?? null, MODE_SPEED[trip.transportMode] ?? 40) ?? undefined, visitMin: visitMinutesForCategory(pinned.category) })
                          resolved.push({ hit: pinned, dayIndex: item.dayIndex })
                        }
                        const n = resolved.length
                        // Batch apply all stops in a single change — each one
                        // inserted at its road position (same rule as single adds)
                        if (n > 0) {
                          applyChange(draft => {
                            const byDay = new Map<number, { hit: PlaceHit }[]>()
                            for (const item of resolved) {
                              const list = byDay.get(item.dayIndex) ?? []
                              list.push(item)
                              byDay.set(item.dayIndex, list)
                            }
                            for (const [dayIndex, items] of byDay) {
                              // #563 — a day that reconcile removed mid-scan is
                              // skipped, not crashed into: its items are dropped
                              // with the rest of the batch still landing.
                              const day = draft.days.find(d => d.index === dayIndex)
                              if (!day) continue
                              // new stops sorted by road position so sequential
                              // splices land in journey order
                              const sorted = [...items].sort((a, b) =>
                                (routeKmOf(a.hit.latitude, a.hit.longitude) ?? Infinity) -
                                (routeKmOf(b.hit.latitude, b.hit.longitude) ?? Infinity))
                              for (const { hit } of sorted) {
                                const stop = {
                                  id: newStopId(),
                                  title: hit.name,
                                  category: (hit.category as ItineraryStop['category']) ?? 'sightseeing',
                                  locationName: hit.description ?? hit.name,
                                  placeId: hit.placeId,
                                  lat: hit.latitude,
                                  lng: hit.longitude,
                                  description: hit.description ?? '',
                                  notes: hit.haltPurpose ? 'Added from the ride plan' : 'Added from nearby suggestions',
                                  visitMinutes: poiVisitMinutes(hit.category),
                                  openTime: hit.openTime ?? '', closeTime: hit.closeTime ?? '',
                                  entryFeeInrPerPerson: 0,
                                  transportCostInrTotal: 0,
                                  priority: 'nice-to-have',
                                  sourceUrl: '',
                                  status: 'suggested',
                                  orderInDay: day.stops.length + 1,
                                } as unknown as ItineraryStop
                                const km = routeKmOf(hit.latitude, hit.longitude)
                                let at = -1
                                if (km != null) {
                                  at = day.stops.findIndex(s => {
                                    const skm = routeKmOf(s.lat, s.lng)
                                    return skm != null && skm > km
                                  })
                                }
                                if (at === -1) day.stops.push(stop)
                                else day.stops.splice(at, 0, stop)
                              }
                              day.stops.forEach((s, i) => { s.orderInDay = i + 1 })
                            }
                          }, 'add', resolved[0].dayIndex)
                        }
                        setAddedIds(prev => {
                          const next = new Set(prev)
                          for (const { hit } of resolved) next.add(hit.id as string)
                          return next
                        })
                        toast(n > 0
                          ? `“${arc.label.split(':')[0]}” added (${n} stops)${unpinned > 0 ? ` - ${unpinned} could not be pinned on the map` : ''}`
                          : (unpinned > 0 ? 'Those places could not be pinned on the map - try again or pick others' : 'All of those are already added'))
                      }}
                    >Add all ({arc.hitIds.length})</button>
                  </div>
                </div>
              ))}
              {quotaOut && (
                <p className="hint-text" role="status">⚠ Google Places reached its 80% safety pause for this month - corridor suggestions resume next UTC month. Remove the key in Settings and reload to use the free stack.</p>
              )}
              {seeForRail.length === 0
                ? <p className="muted small">Sightseeing &amp; detour stops will appear here along your route.</p>
                : (
                    <>
                      <div className="poi-grp">
                        <span className="poi-grp-k">Along your route</span>
                        <span className="poi-grp-n">{seeForRail.length}</span>
                        <span className="poi-grp-ln" />
                      </div>
                      {seeForRail.slice(0, SEE_VISIBLE).map(renderLedgerRow)}
                      {seeForRail.length > SEE_VISIBLE && (
                        <details className="poi-more">
                          <summary><ChevronDown className="poi-chev" size={12} aria-hidden />{seeForRail.length - SEE_VISIBLE} more picks</summary>
                          <div className="poi-more-list">{seeForRail.slice(SEE_VISIBLE).map(renderLedgerRow)}</div>
                        </details>
                      )}
                    </>
                  )}
              {budgetHeldCount > 0 && (
                <p className="hint-text">{budgetHeldCount} idea{budgetHeldCount === 1 ? '' : 's'} held back - beyond the day&apos;s detour budget. Add fewer stops, or raise the scope, and the engine will offer them again.</p>
              )}
            </div>
          </div>
      </div>
      {/* Shortlist tray: the rail collects, the tray decides. Sticky so it stays
          reachable while the rails scroll. #420 slice 1 moved the markup into
          map/ShortlistTray.tsx; the actions below stay here until slice 2. */}
      <ShortlistTray
        count={trayShortlist.length}
        busy={addingAny}
        onAddAll={() => void addShortlisted()}
        onVote={() => void raiseShortlistVote()}
        onClear={clearShortlist}
      />
      {/* pick-a-day modal for adding a suggested POI — explicit confirm */}
      <Modal open={!!poiDraft} onClose={() => setPoiDraft(null)} title={`Add “${poiDraft?.hit.name ?? ''}”`}>
        {poiDraft && (
          <div>
            {poiDraft.hit.description && <p className="small muted" style={{ marginTop: 0 }}>{poiDraft.hit.description}</p>}
            <Field label="Add to which day?">
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
            <p className="hint-text">You can fine-tune duration, fees and timings in the Timeline afterwards.</p>
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
