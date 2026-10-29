// ============ Create trip — the Trip Ticket ============
// Bento-compact rebuild (Sep 2026): bench-style blocks on the left, a live
// boarding-pass ticket on the right that assembles itself as the form fills.
// The rough bill stays hidden until the traveller presses "Print my bill" —
// a minimal printer slot unrolls a textured paper receipt (gentle wind sway,
// instant under prefers-reduced-motion). On create, the route seeds a rough
// timeline outline via buildOutlineSeedStops so the workspace opens with a
// starting plan instead of empty days.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Calendar, ChevronDown, ChevronUp, Pin, TriangleAlert, X, ArrowRight, Printer, Plus,
  Car, Bike, Bus, TrainFront, Plane, KeyRound, CarTaxiFront, Shuffle, Fuel, Wallet,
  PenLine, Users,
} from 'lucide-react'
import type { FixedCommitment, LatLngPoint, TransportMode, TravelStyle, Trip } from '../data/types'
import { TRAVEL_STYLES, TRANSPORT_MODES } from '../data/types'
import { useDb, currentUser, createTripPersisted, retryCreateTrip, useTrips, tripsForUser } from '../store/store'
import { FUEL_PRICE_INR_PER_L, DEFAULT_FUEL_ECONOMY_KML, isFuelEconomyMode, parseFuelEconomyKmL, parseFuelPricePerL, isImplausibleFuelEconomy, MODE_SPEED, minutesToHM } from '../lib/engine'
import { planDriveDays, isSelfDrivenMode } from '../lib/ridePlan'
import { CREW_CHIPS, CREW_MAX, CREW_MIN, clampCrew } from '../lib/crew'
import { InlineIcon, modeIcon, MODE_ICONS } from '../components/icons'
import { estimateTripStarter, buildOutlineSeedStops, vehicleProfileFor } from '../lib/tripStarter'
import { transportPolicy } from '../lib/transportPolicy'
import { sanitizeTankL, sanitizeRentPerDayInr } from '../lib/tripRow'
import { TRIP_TEMPLATES, applyTemplate, templateFromRange, fmtBand } from '../lib/tripTemplates'
import { regionFor, regionBand, nationalBand } from '../lib/budgetBenchmarks'
import { createFunnelOn } from '../lib/featureFlags'
import { createReadiness, readinessFromDraft, readinessLine } from '../lib/createReadiness'
import { saveDraft, loadDraft, clearDraft, draftIsWorthKeeping, draftAgeLabel, maskPhone, type StoredDraft } from '../lib/createDraft'
import { unpickedStopErrors } from '../lib/createSubmit'
import { validateCreate, stepOfError, stepNumber, firstErrorStep, type CreateStep, CREATE_ACTION_LABEL, CREATE_ACTION_BUSY_LABEL } from '../lib/createSteps'
import { stepFromQuery, stepHref } from '../lib/createStepUrl'
import { createSubmitIntent, guidedConstraintErrors } from '../lib/createGuidedGuards'
import { reviewLines, reviewOptional } from '../lib/createReview'
import { StepProgress, StepNav, useStepFocus } from '../components/CreateFlowShell'
import { CreateFlowCalendar } from '../components/CreateFlowCalendar'
import { CreateFlowTicket } from '../components/CreateFlowTicket'
import { currentQuery, navigate, onRouteChange } from '../lib/router'
import { budgetTargetMessage, suggestedBudgetTarget, fuelFallbackNotice, revalidateCommitments, commitmentMoveMessage, composerRowError, ticketFuelSegments } from '../lib/createHonesty'
import { addCrewFields, isMaskedLabel, normalizeIndianMobile, type CrewEntry } from '../lib/crewInvite'
import { recordCreateEvent } from '../lib/createEvents'
import { stashHandoff } from '../lib/createHandoff'
import { routeIq, routeIqLine, type RoutePoint } from '../lib/routeIq'
import { seasonNoteFor, monthOfIso } from '../lib/seasonality'
import { radarLines } from '../lib/createRadar'
import { fetchTripThumbUrl } from '../lib/tripThumb'
import { Field, Chip, toast, Odometer, useMedia, FormErrorSummary, Modal } from '../components/ui'
import { Select } from '../components/Select'
import { DateRangeCalendar, fmtDay, isoDay } from '../components/DateRangeCalendar'
import { isoAddDays } from '../lib/weather'
import { PillNav } from '../components/PillNav'
import { haptic, HAPTIC } from '../lib/haptics'
import { useTimeFormat, formatHM, validHM } from '../lib/timefmt'
import { cap } from '../lib/labels'
import { readBenchPrefill } from '../lib/planBench'
import { scrollBehavior } from '../lib/motion'
import { LocationInput } from '../components/LocationInput'
import { PageHeader } from '../components/page/PageHeader'
import { Surface } from '../components/page/Surface'
import { TripArt, TripArtSprite } from '../components/trips/TripArt'
import { regionFor as artRegionFor } from '../lib/tripsPage'

interface CommitDraft {
  title: string
  type: FixedCommitment['type']
  dayIndex: number
  time: string
  /** Destination this deadline is checked against — resolved to a stop id at creation. */
  destName?: string
}

/** A destination picked (or typed) for the route. */
interface DestDraft {
  name: string
  lat?: number
  lng?: number
}

/** Per-mode tile copy. The Record is EXHAUSTIVE over TransportMode, so adding a
 *  mode to TRANSPORT_MODES in src/data/types.ts is a compile error here until it
 *  gets a tile — the grid can't silently fall behind the vocabulary again.
 *  The GLYPH is no longer listed here: it comes from the one MODE_ICONS map in
 *  components/icons, so this file only owns the copy. */
const MODE_TILE_META: Record<TransportMode, { hint: string }> = {
  car: { hint: 'Your car and fuel' },
  rental: { hint: 'Fuel and daily rent' },
  motorcycle: { hint: 'Your bike and fuel' },
  train: { hint: 'Rail fare estimate' },
  bus: { hint: 'Bus fare estimate' },
  flight: { hint: 'Flights and transfers' },
  taxi: { hint: 'Taxi fare estimate' },
  mixed: { hint: 'Combine transport modes' },
}

/** Mode tiles for the transport grid — every mode a trip can BE (#213 Phase 5).
 *  This used to be a hand-rolled six, missing `taxi` and `mixed`, so a trip
 *  could be switched to a mode it was impossible to create. */
const MODE_TILES = TRANSPORT_MODES.map(mode => ({ mode, icon: MODE_ICONS[mode], ...MODE_TILE_META[mode] }))

/** Explainer copy — grounded in what the style really tunes later: halt cadence
 *  (cadenceForCrew), daily detour budget (STYLE_DELTA, relaxed +15 / packed −15
 *  around the 45-min base) and the suggestion category priors in
 *  computeCategoryBias. It does NOT price anything: the bed is the Budget
 *  preference dial's job, and the two dials are deliberately independent
 *  (see `stayKeyFor` in lib/engine.ts). Never claim more than the algorithm does. */
const STYLE_COPY: Record<TravelStyle, string> = {
  relaxed: 'More frequent driving breaks and more time for suggested detours.',
  packed: 'Longer stretches between driving breaks and less time for detours.',
  balanced: 'Regular driving breaks and time for suggested detours.',
  adventure: 'Suggestions favour treks, trails and outdoor stops.',
  luxury: 'Uses the standard driving pace. Choose accommodation separately above.',
  budget: 'Uses the standard driving pace. Choose accommodation separately above.',
  family: 'Groups of five or more get more frequent driving breaks with any style.',
  spiritual: 'Suggestions favour temples and sacred sites.',
  'food-focused': 'Suggestions favour local food stops.',
  creator: 'Suggestions favour landmarks and museums.',
}

const EMOJIS = ['🧭', '🏔️', '🏖️', '🛕', '🚗', '🚂', '🌴', '🎒']

/** Ticket cover scenery (shared with the mockup) — shown until a cover photo exists. */
function TicketScenery() {
  return (
    <svg className="tk-scenery" viewBox="0 0 340 96" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="tk-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7FC9BC" /><stop offset="1" stopColor="#2E6B5E" />
        </linearGradient>
      </defs>
      <rect width="340" height="96" fill="url(#tk-sky)" />
      <path d="M0 70 L60 28 L110 70 Z" fill="#1C4A44" opacity=".8" />
      <path d="M70 76 L150 18 L230 76 Z" fill="#163F3A" opacity=".9" />
      <path d="M180 74 L250 32 L330 74 Z" fill="#1C4A44" opacity=".75" />
      <ellipse cx="70" cy="92" rx="120" ry="24" fill="#123F49" />
      <ellipse cx="290" cy="94" rx="130" ry="22" fill="#0E3540" />
    </svg>
  )
}

/** One money figure in the rough bill, rolled like the Plan Bench odometer so
 *  the numbers move when the plan changes instead of swapping silently.
 *  Declared at module scope on purpose: an inline component would be a new
 *  type every render, so React would remount the odometer and the digit roll
 *  would never run. Shows a label when there is nothing to price. */
function Money({ v, animate }: { v: number | null | undefined; animate: boolean }) {
  if (v == null) return <>Not priced</>
  const text = `₹${v.toLocaleString('en-IN')}`
  return <Odometer value={text} animate={animate} label={text} />
}

export function CreateTripPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const timeFormat = useTimeFormat()

  const [f, setF] = useState({
    name: '', startLocation: '',
    startDate: '', endDate: '', travellers: 2,
    /** "" = the user has not answered, and every day keeps the engine default */
    dayStartTime: '',
    // #142 party inputs — undefined until the user touches the controls
    driverCount: undefined as number | undefined,
    hasVulnerable: undefined as boolean | undefined,
    driveAfterDinnerMin: undefined as number | undefined,
    transportMode: 'car' as TransportMode,
    // Mixed only (2026-10-19): undefined until the traveller answers the
    // driving question, which a new Mixed trip cannot skip.
    drivesPart: undefined as boolean | undefined,
    localTrain: false,
    fuelEconomy: '',
    fuelPrice: '',
    tankL: '',
    rentPerDay: '',
    roundTrip: true,
    budgetPerPersonInr: 15000,
    travelStyle: 'balanced' as TravelStyle,
    // The bed's tier, chosen on its own bar. Deliberately separate from travel
    // style, which tunes cadence and suggestions and never touches pricing.
    stayStyle: 'comfort' as 'budget' | 'comfort' | 'luxury',
    coverEmoji: '🧭',
    coverImageUrl: '',
  })
  const [dests, setDests] = useState<DestDraft[]>([])
  /** Trailing dests that belong to the custom return leg (0 = same route back). */
  const [returnCount, setReturnCount] = useState(0)
  const [destInput, setDestInput] = useState('')
  const [returnInput, setReturnInput] = useState('')
  const [startCoords, setStartCoords] = useState<LatLngPoint | null>(null)
  const [commitments, setCommitments] = useState<CommitDraft[]>([])
  const [c, setC] = useState<CommitDraft>({ title: '', type: 'hotel-checkin', dayIndex: 0, time: '14:00', destName: '' })
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [busyCover, setBusyCover] = useState(false)
  const [billPrinted, setBillPrinted] = useState(false)
  /** The create is in flight (#373): both submit buttons wait on it. */
  const [submitting, setSubmitting] = useState(false)
  /** A save that failed (#374) — surfaced on the form, never as a toast alone. */
  const [saveError, setSaveError] = useState<string | null>(null)
  /** The trip a FAILED save already built: a retry re-uses it (same id) rather
   *  than minting a twin, which is what makes the retry idempotent. */
  const pendingTrip = useRef<Trip | null>(null)
  /** Re-entrancy guard for the creating half only. State cannot cover the gap:
   *  two submits in one tick both read `submitting === false`, and the pair
   *  mints two trips (§6a). */
  const creatingRef = useRef(false)
  /** first-invalid focus targets (F-15) — plain inputs only register here */
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({})
  /** The printed bill — scrolled into view when the dock prints it (see below). */
  const billRef = useRef<HTMLDivElement>(null)

  const fuelMode = isFuelEconomyMode(f.transportMode)
  // One shared answer for every surface (2026-10-19). `showsDrivingControls`
  // decides what renders; `driving` decides what the planner does, and the two
  // differ only for a Mixed trip nobody has answered yet.
  const drivingPolicy = transportPolicy({ transportMode: f.transportMode, drivesPart: f.drivesPart })
  // A passenger mode prices a journey, not a drive. Same empty state, the noun
  // the traveller actually uses.
  const costNoun = drivingPolicy.driving ? 'drive' : 'journey'
  // The bill's figures roll like the bench odometer unless motion is reduced,
  // in which case they are plain text.
  const reduced = useMedia('(prefers-reduced-motion: reduce)')

  // Smart budget (user ask): the rough bill prefills the per-person field the
  // moment it can compute one, and keeps it live as the plan grows — until the
  // user edits the field themselves (or a bench hand-off set it explicitly).
  const [budgetTouched, setBudgetTouched] = useState(false)
  // Plan Bench hand-off (issue #37): when the homepage calculator stashed its
  // inputs into sessionStorage, pre-fill the matching fields. Read-once — the
  // stash clears itself on read, so a refresh returns to the plain form.
  useEffect(() => {
    const p = readBenchPrefill()
    if (!p) return
    setBudgetTouched(true)
    setF(prev => ({
      ...prev,
      travellers: p.travellers,
      transportMode: p.transportMode,
      budgetPerPersonInr: p.budgetPerPersonInr,
      travelStyle: p.travelStyle,
      // The bench's bed tier rides through as the trip's own dial — the style
      // above no longer prices anything, so without this a Luxury bench run
      // created a trip that billed comfort rooms (₹3,200 instead of ₹8,000).
      ...(p.stayStyle ? { stayStyle: p.stayStyle } : {}),
      roundTrip: p.roundTrip,
      ...(isFuelEconomyMode(p.transportMode) && p.kmPerL != null && p.inrPerL != null
        ? { fuelEconomy: String(p.kmPerL), fuelPrice: String(p.inrPerL) }
        : {}),
    }))
  }, [])

  // The dock's "Print bill" is pinned to the bottom of the screen while the bill
  // itself sits further down the page, so on a phone that tap used to look like
  // it did nothing. Bring the bill in once it prints. `block: 'nearest'` scrolls
  // the minimum needed, which makes this a no-op on desktop, where the sticky
  // rail already has the bill on screen.
  useEffect(() => {
    if (!billPrinted) return
    billRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' })
  }, [billPrinted])

  const orderedPoints = useMemo(
    () => [startCoords, ...dests.map(d => (d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : null))],
    [startCoords, dests],
  )
  const tankNum = Number(f.tankL)
  const rentNum = Number(f.rentPerDay)
  // #378: the bill prices self-drive fuel only when BOTH numbers parse — say
  // so, with the blended rate named, instead of silently billing it.
  const fuelNotice = fuelMode ? fuelFallbackNotice(f.transportMode, f.fuelEconomy, f.fuelPrice) : null
  const bill = useMemo(() => estimateTripStarter({
    startDate: f.startDate, endDate: f.endDate,
    travellers: f.travellers, mode: f.transportMode,
    orderedPoints, returnCount,
    // Mirror the workspace engine: only self-drive legs price the drive back.
    roundTrip: fuelMode && f.roundTrip !== false,
    kmPerL: f.fuelEconomy, inrPerL: f.fuelPrice,
    tankL: Number.isFinite(tankNum) && tankNum > 0 ? tankNum : undefined,
    rentPerDay: Number.isFinite(rentNum) && rentNum > 0 ? rentNum : undefined,
    localTrain: f.localTrain,
    // The bed is priced by the budget dial, not the travel style — otherwise
    // this bill and the settings page could disagree about the same room.
    stayStyle: f.stayStyle,
  }), [f.startDate, f.endDate, f.travellers, f.transportMode, f.localTrain, f.roundTrip, f.fuelEconomy, f.fuelPrice, f.tankL, f.rentPerDay, f.stayStyle, orderedPoints, returnCount, fuelMode, tankNum, rentNum])

  // The ONE day count (#376): the dock, the ticket's date label, the
  // commitments row and the outline seed all read the bill's value, so a bad
  // date range cannot split-brain two surfaces into different answers.
  // 0 means "Pick your dates" on every one of them.
  const dayCount = bill.days
  // #378: pinned plans were indexed against the day count at add time and
  // never re-checked — a shortened trip left rows pointing at days that no
  // longer exist. One revalidation, HERE on the day-count change, so the
  // calendar, a template and the day-out shapes all behave identically (the
  // issue's "centralize on the dayCount change, not the widget"). Clamp keeps
  // what was typed and the toast names the move; nothing is silent either way.
  const lastSeenDays = useRef<number | null>(null)
  useEffect(() => {
    const prev = lastSeenDays.current
    lastSeenDays.current = dayCount
    if (prev == null || prev === dayCount) return
    setCommitments(list => {
      const { kept, movedCount } = revalidateCommitments(list, dayCount)
      if (movedCount > 0) toast(commitmentMoveMessage(movedCount))
      return kept
    })
  }, [dayCount])

  // P3 - what is left, said plainly. Mirrors submit()'s own rules, so it can
  // never claim ready when submit would refuse (see createReadiness tests).
  const readiness = useMemo(() => createReadiness({
    name: f.name,
    startLocation: f.startLocation,
    stopCount: dests.length,
    roadKm: bill.roadKm,
    startDate: f.startDate,
    endDate: f.endDate,
    days: bill.days,
    travellers: f.travellers,
    budgetPerPersonInr: f.budgetPerPersonInr,
    hasCover: f.coverImageUrl.trim().length > 0,
    commitmentCount: commitments.filter(x => x.title.trim()).length,
  }), [f.name, f.startLocation, f.startDate, f.endDate, f.travellers, f.budgetPerPersonInr, f.coverImageUrl, dests.length, bill.roadKm, bill.days, commitments])

  // P8 - input intelligence. Both are silent when they have nothing honest to
  // say: no measurable hops, no note for this region, no date picked yet.
  const iq = useMemo(() => {
    const points: RoutePoint[] = [
      ...(startCoords ? [{ name: f.startLocation || 'Start', lat: startCoords.lat, lng: startCoords.lng }] : []),
      ...dests.map(d => ({ name: d.name, lat: d.lat, lng: d.lng })),
    ]
    return routeIq(points, f.transportMode)
  }, [startCoords, f.startLocation, dests, f.transportMode])

  const seasonLine = useMemo(() => {
    const month = monthOfIso(f.startDate)
    if (!month) return null
    return seasonNoteFor([f.startLocation, ...dests.map(d => d.name)], month)
  }, [f.startDate, f.startLocation, dests])

  // P8.3 - the calm radar: what the pinned plans and the drive will negotiate
  // about, said once, here, while changing the plan is still free.
  const radar = useMemo(() => radarLines({
    commitments: commitments.map(x => ({ title: x.title, type: x.type, dayIndex: x.dayIndex, time: x.time })),
    days: bill.days,
    roadKm: bill.roadKm,
    roundTrip: f.roundTrip,
    startName: f.startLocation.trim() || 'your start',
  }), [commitments, bill.days, bill.roadKm, f.roundTrip, f.startLocation])

  // P4 - the draft that waits. Loaded once on mount; the banner decides whether
  // it is resumed or thrown away. Autosave stays OFF until that decision, so a
  // pending draft can never be overwritten by the blank form it is offering.
  const [draft, setDraft] = useState<StoredDraft | null>(null)
  const [draftDecided, setDraftDecided] = useState(false)
  // Which of the six steps is open. The address is the source of truth (step 3
  // of the guided flow): `?step=when` survives a reload, and moving between steps
  // pushes a history entry so the browser's Back button steps backwards instead
  // of leaving the page. `goToStep` is the only writer.
  const [step, setStep] = useState<CreateStep>(() => stepFromQuery(currentQuery()))
  const [ticketOpen, setTicketOpen] = useState(false)
  const [flowStarted, setFlowStarted] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [returnToReview, setReturnToReview] = useState(false)
  /** Move to a step as a real navigation, so Back returns to the previous one. */
  function goToStep(next: CreateStep) {
    if (next === step) return
    if (createFunnelOn('guided') && stepNumber(next) > stepNumber(step)) {
      const errors = validationErrors()
      const blockers = Object.fromEntries(Object.entries(errors).filter(([key]) => stepOfError(key) === step))
      setErrs(blockers)
      if (Object.keys(blockers).length) { focusError(Object.keys(blockers)[0]); return }
    }
    setStep(next)
    navigate(stepHref(next, '/new', currentQuery()))
    if (next === 'review') setReturnToReview(false)
  }
  function changeFromReview(next: CreateStep) {
    setReturnToReview(true)
    setTicketOpen(false)
    goToStep(next)
  }
  // A real route change (Back, Forward, or a link into the flow) re-seeds the
  // step from the address. `navigate` notifies, so goToStep's own push lands
  // here too - setting the same value twice is a no-op for React.
  useEffect(() => onRouteChange(() => setStep(stepFromQuery(currentQuery()))), [])
  // P5 - the crew collector. Local state only: nothing is written to the trip
  // and nothing is sent from here. The invite is composed (and marked ready)
  // once the trip exists, so this page never promises a message it cannot send.
  const [crew, setCrew] = useState<CrewEntry[]>([])
  const [crewName, setCrewName] = useState('')
  const [crewMobile, setCrewMobile] = useState('')
  const [crewFeedback, setCrewFeedback] = useState<{ field?: 'name' | 'mobile'; message: string } | null>(null)
  /** The tucked drawer is a real controlled element so the party chip can open
   *  it and the native summary still closes it (P1's "advanced is tucked, not
   *  hidden" promise - the chip in the flow is the second way in). */
  const [drawerOpen, setDrawerOpen] = useState(false)
  useEffect(() => {
    if (!createFunnelOn('drafts')) { setDraftDecided(true); return }
    const found = loadDraft()
    if (draftIsWorthKeeping(found)) setDraft(found)
    else { setDraftDecided(true) }
  }, [])

  // The first step records once after the signed-in page mounts.
  // Metadata excludes private contents. Event failure must not block creation.
  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current || !me?.id) return
    startedRef.current = true
    recordCreateEvent('started', undefined, { userId: me.id })
  }, [me?.id])
  // #428 — readiness_complete: the FIRST time the checklist goes all-green in
  // this session. One latch, so editing after ready does not re-fire it.
  const readyRef = useRef(false)
  useEffect(() => {
    if (readyRef.current || !readiness.ready) return
    if (!me?.id) return
    readyRef.current = true
    recordCreateEvent('readiness_complete', undefined, { userId: me.id })
  }, [readiness.ready, me?.id])

  useEffect(() => {
    if (!createFunnelOn('drafts') || !draftDecided) return
    const t = setTimeout(() => {
      // `label` rides along so a resumed phone-only entry keeps its identity
      // through every later autosave. saveDraft writes the mask into `label` and
      // null into `phone`, so the stored copy never holds a number.
      saveDraft({ form: f as unknown as Record<string, unknown>, dests, returnCount, crew: crew.map(c => ({ name: c.name, phone: c.phone, label: c.label })), step })
    }, 800)
    return () => clearTimeout(t)
  }, [f, dests, returnCount, crew, step, draftDecided])

  /** P5: who can be invited - the party minus the planner, capped at four so the
   *  create flow never turns into an address book (more live on the Share tab). */
  const crewLimit = Math.min(4, Math.max(0, f.travellers - 1))

  /** The dashed "Add a stop" is a shortcut to the search field, not a second
   *  input: one control owns the value, the button just puts the cursor in it. */
  function focusAddStop() {
    const el = document.querySelector<HTMLInputElement>('.ct-add-stop input')
    if (el) { el.focus(); el.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() }) }
  }

  function addCrewMember() {
    const result = addCrewFields(crew, { name: crewName, mobile: crewMobile }, crewLimit)
    if (result.kind !== 'added') {
      setCrewFeedback({ message: result.message, field: result.kind === 'invalid' ? result.field : undefined })
      if (result.kind === 'invalid') document.getElementById(result.field === 'mobile' ? 'ct-crew-mobile' : 'ct-crew-name')?.focus()
      return
    }
    const next = result.crew
    haptic(HAPTIC.tick)
    setCrew(next)
    setCrewName('')
    setCrewMobile('')
    setCrewFeedback({ message: 'Crew member added. No invitation has been sent.' })
    // #428: a COUNT went in — never a name or number.
    recordCreateEvent('crew_added', { count: next.length }, { userId: me?.id })
  }

  /** P4: the percentage on the banner counts required things only, exactly like
   *  the checklist (optional rows never move it), so the pull back is honest. */
  const draftReadiness = useMemo(
    () => (draft ? readinessFromDraft(draft.form, draft.dests.length) : null),
    [draft],
  )

  function resumeDraft() {
    if (!draft) return
    haptic(HAPTIC.select)
    recordCreateEvent('draft_resumed', undefined, { userId: me?.id })
    setF(prev => ({ ...prev, ...(draft.form as Partial<typeof prev>) }))
    setDests(draft.dests)
    setReturnCount(draft.returnCount)
    // Crew numbers come back masked (only the last three digits were stored, see
    // saveDraft). A masked string is a LABEL, not a number: keeping it as
    // `phone` would build a wa.me link to "••• 234" and fail at the last step,
    // which is worse than asking for the number again. So the label is kept as
    // `label`, `phone` stays null, and the chip shows who the person is.
    if (draft.crew?.length) {
      setCrew(draft.crew.map(c => ({
        raw: c.name || c.label || '',
        name: c.name,
        // A number is kept only if it normalizes. A masked string ("••• 234")
        // does not, so it degrades to `null` without a string sniff — and a full
        // number written by another build is refused rather than re-admitted.
        phone: c.phone ? normalizeIndianMobile(c.phone) : null,
        label: isMaskedLabel(c.label) ? c.label : undefined,
      })))
    }
    // the restored budget is the user's own number - hand the field back to them
    setBudgetTouched(true)
    // Reopen on the step the draft was left on. An older draft has no step, and
    // readStep() has already discarded one this build does not know. This writes
    // the address too, so the resumed step is shareable and Back still works.
    if (draft.step) { setStep(draft.step as CreateStep); navigate(stepHref(draft.step as CreateStep, '/new', currentQuery())) }
    setDraft(null)
    setDraftDecided(true)
    toast('Picked up where you left off')
  }

  function discardDraft() {
    haptic(HAPTIC.toggle)
    recordCreateEvent('draft_discarded', undefined, { userId: me?.id })
    clearDraft()
    setDraft(null)
    setDraftDecided(true)
  }

  // P2 - the honest anchor: what a typical party spends on this region's own
  // run, computed by the same engine that prints the bill. Null when we honestly
  // have no baseline for the region - the UI then says nothing at all.
  const region = useMemo(
    () => regionFor([f.startLocation, ...dests.map(d => d.name)]),
    [f.startLocation, dests],
  )
  const band = useMemo(
    () => (region ? regionBand(region, bill.days || undefined) : (bill.days ? nationalBand(bill.days) : null)),
    [region, bill.days],
  )
  // Day Planner (P1, PR #105): the engine kicks in the moment a start and a
  // destination exist — the route demands its own days from the wheel-hour
  // cap, before any date juggling. Blended mode speed until the workspace's
  // OSRM road time exists; the verdict re-derives on every input change.
  const driveDaysVerdict = useMemo(() => {
    if (bill.roadKm == null || bill.roadKm < 90) return null
    // #126: conducted modes — train/bus/flight/taxi — have no driving fatigue
    // to split; the verdict stays silent for them.
    if (!isSelfDrivenMode(f.transportMode, f.drivesPart)) return null
    const speed = MODE_SPEED[f.transportMode] ?? 42
    // #126 mode gate + #142 party inputs: timetable modes get no verdict;
    // drivers/vulnerable party move the honest cap.
    return planDriveDays({ totalKm: bill.roadKm, driveMinutes: (bill.roadKm / speed) * 60, travelStyle: f.travelStyle, transportMode: f.transportMode, drivesPart: f.drivesPart, driverCount: f.driverCount, hasVulnerable: f.hasVulnerable })
  }, [bill.roadKm, f.transportMode, f.drivesPart, f.travelStyle, f.driverCount, f.hasVulnerable])

  function patchFields(next: Partial<typeof f>) {
    setF(x => ({ ...x, ...next }))
  }


  /** Warm start (P1): one tap pre-fills the form from a curated template.
   *  Never clobbers what the user already typed (applyTemplate merge rules),
   *  always lands on real coordinates so the bill computes immediately. */
  function pickTemplate(t: (typeof TRIP_TEMPLATES)[number]) {
    haptic(HAPTIC.select)
    // #428: the platform-authored slug and the pick source — the template's
    // own name/id, never what the user typed.
    recordCreateEvent('template_picked', { source: 'template', templateId: t.id }, { userId: me?.id })
    const { fields, dests: tDests } = applyTemplate(t, {
      name: f.name, startLocation: f.startLocation, budgetTouched,
    })
    patchFields(fields)
    setDests(tDests)
    setReturnCount(0)
    setStartCoords(null) // template coords live on the dests; start geocodes on submit path
    setTplId(t.id)
    // The template's day count lands as a date window (mirrors applyDayOutShape
    // semantics: keep any picked start date, extend by days-1).
    const start = f.startDate || isoDay(new Date())
    patchFields({ startDate: start, endDate: isoAddDays(start, t.prefill.days - 1) })
    toast(`${t.name} loaded - two taps from done`)
  }

  /** Same as last trip: recognition over recall - the second trip should
   *  take ten seconds. Copies party/mode/style/budget (+ #142 party inputs
   *  when set); never the route, never the dates, never the name. */
  function copyLastTrip() {
    if (!lastTrip) return
    haptic(HAPTIC.select)
    recordCreateEvent('template_picked', { source: 'last' }, { userId: me?.id })
    patchFields({
      travellers: lastTrip.travellers,
      transportMode: lastTrip.transportMode,
      travelStyle: lastTrip.travelStyle,
      stayStyle: lastTrip.stayStyle ?? 'comfort',
      budgetPerPersonInr: lastTrip.budgetPerPersonInr,
      ...(lastTrip.driverCount != null ? { driverCount: lastTrip.driverCount } : {}),
      ...(lastTrip.hasVulnerable != null ? { hasVulnerable: lastTrip.hasVulnerable } : {}),
    })
    setTplId(null)
    toast(`Copied the crew and the car from "${lastTrip.name}" - pick a new road`)
  }

  /** Start blank: clears any picked card, leaves the form exactly as it is. */
  function clearTemplate() {
    setFlowStarted(true)
    if (tplId == null) return
    setTplId(null)
    haptic(HAPTIC.tick)
  }

  // Day Planner P1-E shape presets: one round-trip day ("Day out") or two
  // ("Weekend dash"). They only preset the shape — dates and the return flag —
  // the bill stays honest on its own (no hotel stops → no stay line).
  function applyDayOutShape(days: number) {
    haptic(HAPTIC.select)
    const today = isoDay(new Date())
    const start = f.startDate || today
    patchFields({ startDate: start, endDate: isoAddDays(start, days - 1), roundTrip: true })
    toast(days === 1
      ? 'Day out: one round-trip day. The bill includes meals, with no overnight stay.'
      : 'Weekend dash: two days there and back. Check the accommodation estimate below.')
  }

  // Auto-fill: the rounded-up rough take lands in the budget field whenever it
  // changes and the user hasn't claimed the field by editing it.
  const suggestedBudget = suggestedBudgetTarget(bill.perHead)
  // The write is silent by nature — a value changing under a screen-reader user
  // with no announcement is a mutation they never hear about, and the hint only
  // explains it once the field has focus. This notice is read by a polite live
  // region below. It fires only on an actual write, and never while the field is
  // the user's current focus (they are editing it; the hint already covers them).
  const [budgetNotice, setBudgetNotice] = useState('')
  /** Warm start (P1): the most recent trip, for the "same as last trip" chip.
   *  Copies the choices that repeat (party, mode, style, budget) - the
   *  route stays blank: a new trip deserves a new road. */
  const allTrips = useTrips()
  const lastTrip = useMemo(
    () => {
      const mine = tripsForUser(me?.id ?? null)
      return mine.length ? mine[mine.length - 1] : null
    },
    [allTrips, me],
  )
  /** Warm start (P1): the picked template card, and whether the name
   *  suggestion chip is still relevant (hidden once the user types a name). */
  const [tplId, setTplId] = useState<string | null>(null)
  const [nameSugSeen, setNameSugSeen] = useState(false)
  useEffect(() => {
    if (budgetTouched || suggestedBudget == null) return
    if (f.budgetPerPersonInr === suggestedBudget) return
    setF(x => ({ ...x, budgetPerPersonInr: suggestedBudget }))
    if (document.activeElement !== fieldRefs.current.budgetPerPersonInr) {
      setBudgetNotice(`Budget updated to ₹${suggestedBudget.toLocaleString('en-IN')} per person, from the rough take.`)
    }
  }, [suggestedBudget, budgetTouched, f.budgetPerPersonInr])

  function setReturnOn(on: boolean) {
    haptic(HAPTIC.toggle)
    if (on) {
      // Prefill the return leg with the reversed outbound — fully editable.
      const reversed = [...dests].reverse()
      setDests(list => [...list, ...reversed])
      setReturnCount(reversed.length)
    } else {
      setDests(list => list.slice(0, list.length - returnCount))
      setReturnCount(0)
      toast('Return stops cleared. The final drive to start option is unchanged.')
    }
  }

  /** Add a destination. Outbound inserts before the return tail; return appends. */
  function addDest(d: DestDraft, isReturn: boolean) {
    const name = d.name.trim()
    if (!name) return
    if (dests.some(x => x.name.toLowerCase() === name.toLowerCase())) {
      toast('That destination is already on the route.', 'err'); return
    }
    if (isReturn) {
      setDests(list => [...list, d])
      setReturnCount(n => n + 1)
    } else {
      const cut = dests.length - returnCount
      setDests(list => [...list.slice(0, cut), d, ...list.slice(cut)])
    }
    setDestInput('')
    setReturnInput('')
  }
  function removeDest(i: number) {
    const isReturnStop = i >= dests.length - returnCount
    setDests(list => list.filter((_, j) => j !== i))
    if (isReturnStop) setReturnCount(n => Math.max(0, n - 1))
  }
  function moveDest(i: number, dir: -1 | 1) {
    const cut = dests.length - returnCount
    const lo = i < cut ? 0 : cut          // reorder within the same leg only
    const hi = i < cut ? Math.max(0, cut - 1) : dests.length - 1
    const j = i + dir
    if (j < lo || j > hi) return
    setDests(list => {
      const copy = [...list]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })
  }

  function printBill() {
    if (!bill.perHead) { toast('Add a date range and at least one geocoded stop to price the trip.', 'err'); return }
    haptic(HAPTIC.success)
    setBillPrinted(true)
    // #379: focus follows the reveal. Without this the bill appears below the fold
    // and a keyboard user is left standing where they were, with nothing to show for
    // the press. rAF because the region does not exist until this render lands.
    requestAnimationFrame(() => billRef.current?.focus())
  }

  function navigateWithTransition(route: string) {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }
    const go = () => onNavigate(route)
    if (doc.startViewTransition) doc.startViewTransition(go)
    else go()
  }

  /** One message for every way the save can fail: the form cannot tell a
   *  dropped connection from a refusal, so it says what it does know — the trip
   *  is not on the server, and nothing typed here is lost. */
  const SAVE_FAILED = 'Couldn’t save this trip to the server. Your inputs are still here. Try again.'

  /** The failure notice, rendered beside BOTH submit surfaces: the ticket rail's
   *  CTA and the form's own summary. Its Retry is just a submit — the guarded
   *  handler already knows whether it is a first attempt or a retry. */
  const saveFailure = saveError ? (
    <div className="ct-save-err">
      <span className="chip chip-danger" role="alert">{saveError}</span>
      <button type="submit" form="yf-create-form" className="btn btn-sm btn-ghost" disabled={submitting}>
        {submitting ? 'Creating…' : 'Try again'}
      </button>
    </div>
  ) : null

  /** The summary's field prefixes - which control resolves each error key. */
  const ERR_LABELS: Record<string, string> = {
    name: 'Trip name', startLocation: 'Starting location', destinations: 'Destinations',
    returnStops: 'Return stops',
    startDate: 'Start date', endDate: 'End date', travellers: 'Travellers', budgetPerPersonInr: 'Budget',
    composerRow: 'Pinned plan row',
    fuelEconomy: 'Mileage', fuelPrice: 'Fuel price', tankL: 'Tank', rentPerDay: 'Rent',
    dayStartTime: 'Departure time', composerTime: 'Plan time',
  }

  /** Error keys whose control is a LocationInput. It owns its own <input>, so
   *  F-15 focus reaches it by the id we hand it rather than a ref (#375). */
  const FIELD_DOM_IDS: Record<string, string> = {
    destinations: 'ct-dest-input',
    returnStops: 'ct-return-input',
    composerRow: 'ct-composer-input',
    fuelEconomy: 'gcf-mileage', fuelPrice: 'gcf-fuel-price', tankL: 'gcf-tank', rentPerDay: 'gcf-rent',
    dayStartTime: 'ct-day-start',
  }

  function currentErrors() {
    // Keep the shared submit rules and add native numeric limits for guided
    // controls, whose owner step must be visible before reporting an error.
    // The unpicked-stop and composer-row helpers stay their own modules: they are
    // about text left in a field, not about the shape of the trip.
    const errors = validateCreate({
      name: f.name,
      startLocation: f.startLocation,
      destInput,
      stopCount: dests.length,
      returnInput,
      returnOpen: returnCount > 0,
      composerTitle: c.title,
      startDate: f.startDate,
      endDate: f.endDate,
      travellers: f.travellers,
      budgetPerPersonInr: f.budgetPerPersonInr,
      mustAnswerDriving: drivingPolicy.mustAnswerDriving,
      unpicked: unpickedStopErrors({ dest: destInput, ret: returnInput, returnOpen: returnCount > 0 }),
      composerError: composerRowError(c.title),
    })
    return createFunnelOn('guided') ? { ...errors, ...guidedConstraintErrors({
      ...f, fuelControls: drivingPolicy.showsDrivingControls, rental: f.transportMode === 'rental',
    }) } : errors
  }

  function validationErrors() {
    const errors = currentErrors()
    if (!createFunnelOn('guided')) return errors
    // Native badInput (for example an unfinished exponent) has an empty value.
    // Read validity here, after input events, rather than during render.
    document.querySelectorAll<HTMLInputElement>('#yf-create-form input[data-create-field]').forEach(control => {
      const key = control.dataset.createField
      if (key && control.willValidate && !control.validity.valid) errors[key] ??= control.validationMessage
    })
    return errors
  }

  function guidedField(key: string) {
    return { id: FIELD_DOM_IDS[key], 'data-create-field': key,
      'aria-invalid': !!errs[key], 'aria-describedby': errs[key] ? `${FIELD_DOM_IDS[key]}-error` : undefined }
  }

  function focusError(key: string) {
    requestAnimationFrame(() => {
      const control = fieldRefs.current[key] ?? document.getElementById(FIELD_DOM_IDS[key] ?? '')
        ?? document.querySelector<HTMLElement>(`[data-create-field="${key}"]`)
        ?? document.querySelector<HTMLElement>(key === 'drivesPart' ? '.transport-answer-pair button' : '.ct-q:not([hidden]) input')
      control?.focus()
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const intent = createSubmitIntent(createFunnelOn('guided'), step)
    if (intent.kind === 'advance') { goToStep(intent.step); return }
    if (!me) return
    const next = validationErrors()
    setErrs(next)
    if (createFunnelOn('guided') && Object.keys(next).length) {
      const target = firstErrorStep(next)
      // Only a real move pushes an entry. When the blocking row already sits on
      // this step, pushing the same address again would make Back appear dead:
      // the address does not change, so Back has to be pressed twice.
      if (target && target !== step) { setStep(target); navigate(stepHref(target, '/new', currentQuery())) }
      if (next.composerRow || next.composerTime) setDetailsOpen(true)
      const first = Object.keys(next).find(key => stepOfError(key) === target)
      if (first) focusError(first)
      return
    }
    if (Object.keys(next).length) {
      // F-15: move focus to the first invalid field so keyboard / screen-reader
      // users don't have to hunt for what failed. LocationInput fields don't
      // register a ref — fall back to focusing that field's own error message.
      const first = Object.keys(next).find(k => fieldRefs.current[k] || FIELD_DOM_IDS[k])
      if (first && fieldRefs.current[first]) {
        fieldRefs.current[first]!.focus()
      } else if (first) {
        // A LocationInput owns its <input>: reach it by id (#375).
        document.getElementById(FIELD_DOM_IDS[first])?.focus()
      } else {
        const firstErr = document.querySelector<HTMLElement>('.err-text')
        if (firstErr) { firstErr.setAttribute('tabindex', '-1'); firstErr.focus() }
      }
      return
    }

    // The double-submit guard starts HERE — after validation, so a form with a
    // missing date never locks its own buttons, and before the network, which is
    // the window a second click actually races (#373).
    if (creatingRef.current) return
    creatingRef.current = true
    setSubmitting(true)
    setSaveError(null)

    const seed = buildOutlineSeedStops({ dests, returnCount, dayCount })
    try {
      // A retry re-uses the trip the failed attempt already built: same id, so a
      // first save that reached the server is not followed by a twin (#374).
      const retry = pendingTrip.current
      if (retry) {
        if (!await retryCreateTrip(retry, me.id)) { setSaveError(SAVE_FAILED); return }
        finishCreate(retry)
        return
      }
      const { trip, persisted } = await createTripPersisted(me.id, {
      name: f.name.trim(),
      startLocation: f.startLocation.trim(),
      startLocationCoords: startCoords ?? undefined,
      destinations: dests.map(d => d.name),
      destinationCoords: dests.map(d => (d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : null)),
      startDate: f.startDate, endDate: f.endDate,
      travellers: f.travellers,
      // #142 party inputs ride along only when the user set them
      driverCount: f.driverCount,
      hasVulnerable: f.hasVulnerable,
driveAfterDinnerMin: f.driveAfterDinnerMin,
    drivesPart: f.drivesPart,
    transportMode: f.transportMode,
      fuelEconomyKmL: fuelMode ? parseFuelEconomyKmL(f.fuelEconomy) : undefined,
      fuelPricePerL: fuelMode ? parseFuelPricePerL(f.fuelPrice) : undefined,
      // #377: the flag rides along for EVERY mode — non-fuel round trips used
      // to drop it here and Settings then described a different trip. The
      // engine keeps its own narrow isRoundTrip (fuel modes only) until its
      // consumers are audited deliberately.
      roundTrip: f.roundTrip,
      // #377 — the vehicle inputs the form was told, persisted at last (they
      // used to be bill-only and dropped on the floor here). Junk never
      // reaches the row: the same sanitizers the writer uses decide.
      vehicleProfile: vehicleProfileFor({ mode: f.transportMode, tankL: tankNum, economyKmL: parseFuelEconomyKmL(f.fuelEconomy) }),
      tankL: Number.isFinite(tankNum) && tankNum > 0 ? (sanitizeTankL(tankNum) ?? undefined) : undefined,
      rentPerDayInr: Number.isFinite(rentNum) && rentNum > 0 ? (sanitizeRentPerDayInr(rentNum) ?? undefined) : undefined,
      localTrain: f.transportMode === 'train' ? f.localTrain : undefined,
      budgetPerPersonInr: f.budgetPerPersonInr,
      travelStyle: f.travelStyle,
      stayStyle: f.stayStyle,
      fixedCommitments: commitments.filter(x => x.title.trim()),
      coverEmoji: f.coverEmoji,
      coverImageUrl: f.coverImageUrl.trim() || undefined,
      // One departure answer for the whole trip; empty keeps the engine default.
      dayStartTime: validHM(f.dayStartTime),
      }, seed)
      // Not saved: the store has already rolled the trip back out of the cache,
      // so there is nothing to route into. The form keeps every input and
      // offers the retry instead.
      if (!persisted) {
        pendingTrip.current = trip
        setSaveError(SAVE_FAILED)
        return
      }
      // #428: the submit step — counts and the mode enum only (the trip name,
      // the destinations and the budget figure never enter the log).
      finishCreate(trip)
    } catch (err) {
      console.error('[yatraflow] create failed', err)
      setSaveError(SAVE_FAILED)
    } finally {
      creatingRef.current = false
      setSubmitting(false)
    }
  }

  /** Everything that happens once the trip IS on the server: the haptic, the
   *  draft cleared, and the route in. Navigation never precedes the save — a
   *  workspace opened over a failed write is a trip that vanishes on reload. */
  function finishCreate(trip: Trip) {
    recordCreateEvent('submitted', { days: trip.days.length, travellers: trip.travellers, mode: trip.transportMode }, { tripId: trip.id, userId: me?.id })
    haptic(HAPTIC.success)
    clearDraft()
    if (createFunnelOn('moment')) {
      // P6 - hand the moment-after screen what it needs to speak truthfully:
      // the figures the ticket just printed, and the crew the planner collected.
      stashHandoff({
        tripId: trip.id,
        tripName: trip.name,
        plannerName: me?.profile.name ?? '',
        roadKm: bill.roadKm,
        rangeKm: bill.rangeKm,
        days: bill.days,
        travellers: f.travellers,
        crew: crew.map(c => ({ name: c.name, phone: c.phone, label: c.label })),
        bill,
      })
      navigateWithTransition(`/created/${trip.id}`)
      return
    }
    toast('Trip created - your rough outline is on the timeline')
    navigateWithTransition(`/trip/${trip.id}`)
  }

  function addCommitment() {
    if (!c.title.trim()) { toast('Name the commitment first (e.g. "Train 12626").', 'err'); return }
    if (!dayCount || c.dayIndex >= dayCount) { toast('Pick a day within the trip dates.', 'err'); return }
    setCommitments(list => [...list, { ...c, title: c.title.trim(), destName: c.destName?.trim() || undefined }])
    setC({ title: '', type: 'hotel-checkin', dayIndex: 0, time: '14:00', destName: '' })
  }

  // The mockup's step markers answer "is this question done?" - derived from
  // state, never stamped: the soft circle is the goal-gradient, the solid one
  // is still inviting an answer.
  const whereDone = dests.length > 0 && !!f.startLocation.trim()
  const whenDone = !!f.startDate && !!f.endDate
  const whoDone = f.travellers >= CREW_MIN && f.travellers <= CREW_MAX
  // How is answered when a mode is chosen and, for Mixed, the driving question
  // too. Transport always has a value (car by default), so this is really "has
  // the traveller looked at it" - the Mixed answer is the only hard gate, and it
  // is the one submit() also enforces.
  const howDone = !drivingPolicy.mustAnswerDriving
  // The guided shell is opt-in, so the long form is byte-for-byte the old
  // behaviour while the flag is off. `guided` gates every step-visibility rule.
  const guided = createFunnelOn('guided')
  useStepFocus(step, guided)

  const outbound = dests.slice(0, dests.length - returnCount)
  const returnStops = dests.slice(dests.length - returnCount)
  const showCustomCrew = !CREW_CHIPS.includes(f.travellers)
  /** Name-first suggestion: derived from what the route already says, or
   *  the picked template's name. One pattern, no rotating list - the chip
   *  exists to unstick, not to entertain. */
  function tplNameSuggestion(): string {
    const t = TRIP_TEMPLATES.find(x => x.id === tplId)
    if (t) return t.prefill.name
    const first = outbound[0]?.name.split(',')[0]
    const last = outbound.length > 1 ? outbound[outbound.length - 1].name.split(',')[0] : null
    if (first && last) return `${first} to ${last}`
    if (first) return `${first} trip`
    return 'Kerala with the crew'
  }

  const ticketTitle = f.name.trim() || 'Your next trip'
  const ticketRoute = `${f.startLocation.trim() || 'Start'} → ${outbound.length ? outbound.map(d => d.name.split(',')[0]).join(' → ') : '…'}`
  // Gate on the VALUE, not on the strings: garbage or inverted dates carry
  // strings but no span, and must say "Pick your dates" exactly like the dock.
  const dateLabel = bill.days > 0
    ? `${fmtDay(f.startDate)} – ${fmtDay(f.endDate)} · ${bill.days} day${bill.days !== 1 ? 's' : ''} · ${bill.nights} night${bill.nights !== 1 ? 's' : ''}`
    : 'Pick your dates'

  const guidedTicket = <CreateFlowTicket title={f.name.trim() || (outbound.length ? `${f.startLocation.split(',')[0]} to ${outbound[outbound.length - 1].name.split(',')[0]}` : ticketTitle)}
    route={ticketRoute.split(' → ').join(', ')} dates={dateLabel}
    departure={f.dayStartTime ? formatHM(f.dayStartTime, timeFormat) : ''}
    mode={f.transportMode} travel={`${cap(f.transportMode)}${f.driverCount ? `, ${f.driverCount} drivers` : ''}`}
    fuel={fuelMode ? ticketFuelSegments(f.fuelEconomy, f.fuelPrice, f.tankL).join(' · ') : ''}
    party={`${f.travellers} traveller${f.travellers === 1 ? '' : 's'}`}
    budget={`₹${f.budgetPerPersonInr.toLocaleString('en-IN')} per person`}
    total={bill.perHead != null ? bill.perHead * f.travellers : null} perHead={bill.perHead}
    failed={!!saveError} review={step === 'review'} onChange={changeFromReview} />

  const startField = <LocationInput id={guided ? 'gcf-start-location' : undefined}
    value={f.startLocation} onChange={v => patchFields({ startLocation: v })}
    onPick={p => setStartCoords({ lat: p.latitude, lng: p.longitude })}
    error={guided ? errs.startLocation : undefined} errorId={guided && errs.startLocation ? 'gcf-start-error' : undefined}
    placeholder="Search a city, e.g. Kochi" />

  // ---- Shared fragments ----------------------------------------------------

  return (
    <div className={`container form-page trip-starter page-enter${guided ? ' gcf' : ''}`} data-create-step={guided ? step : undefined}>
      {createFunnelOn('drafts') && draft && (
        <Surface className="draft-banner" role="status">
          <div className="draft-banner-copy">
            <b>Picking up where you left off</b>
            <span className="draft-banner-meta">
              {draftReadiness ? `${draftReadiness.pct}% ready` : 'saved'} - saved {draftAgeLabel(draft.savedAt)}
            </span>
          </div>
          <div className="draft-banner-acts">
            <button type="button" className="btn btn-primary btn-sm" onClick={resumeDraft}>Resume</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={discardDraft}>Discard</button>
          </div>
        </Surface>
      )}
      <PageHeader
        kicker="Start something"
        headline={{ lead: 'Plan a new', accent: 'trip' }}
        lede="Fill in the form. Your ticket updates as you go."
      />

      {/* ---- Warm start (P1): the front door, full width above the grid ---- */}
      {createFunnelOn('templates') && (!guided || (!flowStarted && step === 'where' && !f.startLocation && dests.length === 0)) && (
      <section className="tpl-warm" aria-label="Start from a real trip">
        <TripArtSprite />
        <div className="tpl-warm-head">
          <h2>Start from a real trip</h2>
          <button type="button" className="tpl-blank-link" onClick={clearTemplate}>Start blank</button>
          <span className="why">Or start with your own route</span>
        </div>
<div className="tpl-strip">
              {TRIP_TEMPLATES.map(t => (
                <button type="button" className={`tpl-card${tplId === t.id ? ' on' : ''}`} key={t.id}
                  onClick={() => pickTemplate(t)}
                  aria-pressed={tplId === t.id}>
                  <span className="tpl-cov">
                    <TripArt region={artRegionFor({ destinations: t.prefill.destinations })} />
                    <span className="days">{t.prefill.days} days</span>
                  </span>
                  <span className="tpl-bd">
                    <b>{t.name}</b>
                    <span className="r">{t.routeLine}</span>
                    <span className="p">{fmtBand(templateFromRange(t))}<small> / head, rough</small></span>
                  </span>
                  <span className="tpl-pick" aria-hidden>&#10003;</span>
                </button>
              ))}
              <button type="button" className="tpl-blank" key="blank" onClick={clearTemplate}>
                <span>
                  Start blank
                  <small>{guided ? 'Six short steps. Most take one tap.' : 'three questions and a live ticket'}</small>
                </span>
              </button>
            </div>
        <div className="tpl-helpers">
              {lastTrip && (
                <button type="button" className="tpl-helper" key="same-as-last" onClick={copyLastTrip}
                  title={`Party, mode, style and budget from "${lastTrip.name}"`}>
                  Same as {lastTrip.name.length > 18 ? lastTrip.name.slice(0, 18) + '\u2026' : lastTrip.name}
                </button>
              )}
              <button type="button" className="tpl-helper" key="demo" onClick={() => onNavigate('/trips')}>
                Not sure? Take a demo trip
              </button>
        </div>
      </section>
      )}

      <div className="ts-layout">
        {guided && <StepProgress step={step} errors={currentErrors()} onGo={goToStep} />}
        <form id="yf-create-form" className="ct-flow" onSubmit={submit} noValidate={guided} aria-busy={submitting}>
          {/* The ONE assertive announcement when submit fails - the field-tied
              messages below stay polite, so a multi-field failure interrupts
              once, not once per field (see FormErrorSummary). */}
          <FormErrorSummary errors={errs} labels={ERR_LABELS} />
          {saveFailure}

          {/* The form panel: everything from the name to the pinned plans sits
              on one quiet card (no shadow, per review) instead of the bare
              canvas - the mockup's .flow column sits on an .app background. */}
          <div className="ct-panel">

          {/* ---- Name first: the mockup's name box - a pill input with the pen
               inline, headed like every other section, suggestion chip beside.
               The error stays field-level (F-15): aria-invalid + describedby +
               the focus ref on the input itself. ---- */}
          {/* ---- Review: the trip in six lines, each with a way back. Not a
               second form - every row is a value and a Change link, so the
               traveller checks the trip instead of re-reading five screens. A
               row with no value names what is missing, and it is the row the
               Create press moves focus to. ---- */}
          {guided && step === 'review' && (
            <div className="ct-review">
              <h2>Check and create</h2>
              <p className="ct-hint">One last look. Everything below can still change.</p>
              <ul className="ct-review-list">
                {reviewLines({
                  name: f.name, startLocation: f.startLocation,
                  stopNames: dests.map(d => d.name),
                  startDate: f.startDate, endDate: f.endDate, days: bill.days,
                  travellers: f.travellers, transportLabel: cap(f.transportMode),
                  budgetPerPersonInr: f.budgetPerPersonInr,
                  hasCover: !!f.coverImageUrl.trim(), commitmentCount: commitments.length,
                }).map(line => (
                  <li key={line.step} className={`ct-review-row${line.value === null ? ' missing' : ''}`}>
                    <span className="ct-review-lab">{line.label}</span>
                    <span className="ct-review-val">{line.value ?? <em>{line.empty}</em>}</span>
                    <button type="button" className="ct-review-change" onClick={() => changeFromReview(line.step)}>
                      Change<span className="sr-only"> {line.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <ul className="ct-review-list ct-review-optional">
                {reviewOptional({
                  name: f.name, startLocation: f.startLocation, stopNames: [],
                  startDate: f.startDate, endDate: f.endDate, days: bill.days,
                  travellers: f.travellers, transportLabel: cap(f.transportMode),
                  budgetPerPersonInr: f.budgetPerPersonInr,
                  hasCover: !!f.coverImageUrl.trim(), commitmentCount: commitments.length,
                }).map(line => (
                  <li key={line.label} className="ct-review-row">
                    <span className="ct-review-lab">{line.label}</span>
                    <span className="ct-review-val">{line.value ?? <em>{line.empty}</em>}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="tpl-nameblock" hidden={guided && step !== 'review'}>
            <div className="tpl-warm-head">
              <h2 id="ct-name-h">Name your trip</h2>
              <span className="why">Choose a name you can find later</span>
            </div>
            <div className="tpl-name">
              <div className="namebox-in">
                <PenLine size={14} aria-hidden />
                <input className="namebox-input" autoComplete="off" ref={el => (fieldRefs.current.name = el)}
                  aria-invalid={!!errs.name} aria-labelledby="ct-name-h"
                  aria-describedby={errs.name ? 'ct-name-err' : undefined}
                  value={f.name} onChange={e => { patchFields({ name: e.target.value }); setNameSugSeen(true) }}
                  placeholder="e.g. Kerala with the crew" />
              </div>
              {!f.name.trim() && !nameSugSeen && (
                <button type="button" className="tpl-sug" onClick={() => { patchFields({ name: tplNameSuggestion() }); setNameSugSeen(true) }}>
                  Use &ldquo;{tplNameSuggestion()}&rdquo;
                </button>
              )}
            </div>
            {/* Field-tied, so POLITE — FormErrorSummary carries this form's one
                assertive beat (see ui.tsx Field for the pattern). */}
            {errs.name && <p className="err-text" id="ct-name-err" role="status" aria-live="polite">{errs.name}</p>}
          </div>

          {/* ---- 1 - Where ---- */}
          <div className={`ct-q${whereDone ? ' done' : ''}`} hidden={guided && step !== 'where'}>
            <span className="ct-n">1</span>
            <div className="ct-q-body">
              <h2>Where are you going?</h2>
              <p className="ct-hint">Start from where you leave, then add each stop in order.</p>
              <div className="ct-q-field">
                {guided ? <div className="field">
                  <label className="label" htmlFor="gcf-start-location">Starting location</label>
                  {startField}
                  {errs.startLocation && <p className="err-text" id="gcf-start-error" role="status">{errs.startLocation}</p>}
                </div> : <Field label="Starting location" error={errs.startLocation}>{startField}</Field>}
              </div>

              <div className="ct-chips" role="list" aria-label="Stops in order">
                {dests.map((d, i) => {
                  const first = i === 0
                  const lastStop = i === dests.length - 1
                  const isReturn = returnCount > 0 && i >= dests.length - returnCount
                  return (
                    <span className={`ct-dchip${isReturn ? ' ret' : ''}`} role="listitem" key={`${d.name}-${i}`}>
                      <span className="n" aria-hidden>{i + 1}</span>
                      <span title={d.name}>{d.name}</span>
                      <button type="button" className="mv" aria-label={`Move ${d.name} earlier`} disabled={first}
                        onClick={() => { haptic(HAPTIC.tick); moveDest(i, -1) }}>&lsaquo;</button>
                      <button type="button" className="mv" aria-label={`Move ${d.name} later`} disabled={lastStop}
                        onClick={() => { haptic(HAPTIC.tick); moveDest(i, 1) }}>&rsaquo;</button>
                      <button type="button" className="x" aria-label={`Remove ${d.name}`}
                        onClick={() => { haptic(HAPTIC.tick); removeDest(i) }}>&#10005;</button>
                    </span>
                  )
                })}
                <button type="button" className="ct-dadd" onClick={() => focusAddStop()}>
                  <Plus size={13} aria-hidden /> Add a stop
                </button>
              </div>
              {errs.destinations && <p className="err-text" id="ct-dest-err" role="status" aria-live="polite">{errs.destinations}</p>}

              <div className="ct-q-field ct-add-stop">
                <LocationInput
                  id="ct-dest-input"
                  ariaLabel="Add a stop to the trip"
                  value={destInput}
                  onChange={setDestInput}
                  errorId={errs.destinations ? 'ct-dest-err' : undefined}
                  error={errs.destinations}
                  onPick={p => addDest({ name: p.name + (p.admin1 ? `, ${p.admin1}` : ''), lat: p.latitude, lng: p.longitude }, false)}
                  placeholder={dests.length === 0 ? 'Type a place to add your first stop - e.g. Munnar' : 'Type a place to add the next stop'}
                />
                {/* #375: the escape hatch that keeps the new block honest. A place
                    the providers do not know can still become a real stop — chosen
                    on purpose, with no coordinates, which `DestDraft` already
                    allows. Without this the block would trap the text it refuses
                    to drop. */}
                {destInput.trim() !== '' && (
                  <button type="button" className="btn btn-sm btn-ghost"
                    onClick={() => { haptic(HAPTIC.tick); addDest({ name: destInput.trim() }, false) }}>
                    Add without a map pin
                  </button>
                )}
              </div>

              {createFunnelOn('iq') && iq && (
                <p className="route-iq" role="status">
                  <span className="iq-tile" aria-hidden>i</span>
                  <span>{routeIqLine(iq)}</span>
                </p>
              )}

              {/* The engine's verdict the moment start + end exist: when the
                  route demands more days than the date range gives, say so and
                  offer the honest fix - one tap, still fully editable. */}
              {driveDaysVerdict && driveDaysVerdict.driveDayCount > bill.days && (
                <div className="dayplanner-banner" style={{ marginBottom: 12 }} role="status">
                  <b>The drive wants {driveDaysVerdict.driveDayCount} travel days{fuelMode && f.roundTrip !== false ? ' - there and back' : ''}.</b>
                  <span className="small muted">
                    {'\u2248'}{Math.round(driveDaysVerdict.perDay)} km a day keeps wheel time {'\u2248'}{minutesToHM(driveDaysVerdict.maxDailyWheelMin)} - in {bill.days} day{bill.days !== 1 ? 's' : ''} it's {'\u2248'}{minutesToHM((bill.roadKm ?? 0) / (MODE_SPEED[f.transportMode] ?? 42) * 60)} in one stretch.
                  </span>
                  <button className="btn btn-primary btn-sm" onClick={() => {
                    const start = f.startDate || isoDay(new Date())
                    patchFields({ startDate: start, endDate: isoAddDays(start, driveDaysVerdict.driveDayCount - 1) })
                  }}>Make it {driveDaysVerdict.driveDayCount} days</button>
                </div>
              )}

              <div className="ct-presets" role="group" aria-label="Trip shape presets">
                <button type="button" className="ct-pre" onClick={() => applyDayOutShape(1)}>
                  A day out<small>One day, no overnight stay</small>
                </button>
                <button type="button" className="ct-pre" onClick={() => applyDayOutShape(2)}>
                  Weekend dash<small>Two days, one night</small>
                </button>
                <button type="button" className="ct-pre" onClick={() => focusAddStop()}>
                  The full route<small>Several days with overnight stays</small>
                </button>
              </div>

            </div>
          </div>

          {/* ---- 3 - When ---- */}
          <div className={`ct-q${whenDone ? ' done' : ''}`} hidden={guided && step !== 'when'}>
            <span className="ct-n">3</span>
            <div className="ct-q-body">
              <h2>{guided ? 'When do you leave?' : 'When?'}</h2>
              <p className="ct-hint">{guided ? 'Pick the first and last day. The bill follows your dates.' : 'The clock walk and every window on the trip starts here.'}</p>
              {guided && <div className="gcf-presets" role="group" aria-label="Trip shape presets">
                <button type="button" className="btn btn-outline" onClick={() => applyDayOutShape(1)}>A day out</button>
                <button type="button" className="btn btn-outline" onClick={() => applyDayOutShape(2)}>Weekend dash</button>
                <button type="button" className="btn btn-outline" onClick={() => fieldRefs.current.startDate?.focus()}>The full route</button>
              </div>}
              <div className="ct-q-field">
                {guided ? <CreateFlowCalendar key={f.startDate.slice(0, 7)} start={f.startDate} end={f.endDate} error={errs.startDate || errs.endDate}
                  registerRef={el => { fieldRefs.current.startDate = el; fieldRefs.current.endDate = el }}
                  onChange={({ startDate, endDate }) => patchFields({ startDate, endDate })} /> : <DateRangeCalendar
                  start={f.startDate} end={f.endDate}
                  error={errs.startDate || errs.endDate}
                  registerRef={el => { fieldRefs.current.startDate = el; fieldRefs.current.endDate = el }}
                  onChange={({ startDate, endDate }) => patchFields({ startDate, endDate })}
                />}
              </div>
              <div className="ct-q-field">
                <label className="ct-lbl" htmlFor="ct-day-start">Departure time</label>
                <div className="ct-day-start">
                  <input
                    id="ct-day-start"
                    data-create-field="dayStartTime"
                    type="time"
                    className="input input--compact"
                    value={f.dayStartTime}
                    aria-invalid={guided && !!errs.dayStartTime}
                    aria-describedby={guided && errs.dayStartTime ? 'ct-day-start-error ct-day-start-hint' : 'ct-day-start-hint'}
                    onChange={e => patchFields({ dayStartTime: e.target.value })}
                  />
                  {f.dayStartTime && (
                    <span className="time-preview">= {formatHM(f.dayStartTime, timeFormat)}</span>
                  )}
                </div>
                {guided && errs.dayStartTime && <p className="err-text" id="ct-day-start-error" role="status">{errs.dayStartTime}</p>}
                <p className="hint-text" id="ct-day-start-hint">
                  {f.dayStartTime
                    ? 'Every day starts at this time. Change any single day later on the timeline.'
                    : 'Leave blank to start each day at 08:30. You can change one day later on the timeline.'}
                </p>
              </div>
              {createFunnelOn('iq') && seasonLine && (
                <p className="hint-text season-note" role="status">{seasonLine}</p>
              )}
            </div>
          </div>

          {/* ---- 2 - How: transport, plus the Mixed driving question. The return
               leg moves here in step 5 of the build; until then it stays where
               it is, so this commit changes no behaviour. ---- */}
          <div className={`ct-q${howDone ? ' done' : ''}`} hidden={guided && step !== 'how'}>
            <span className="ct-n">2</span>
            <div className="ct-q-body">
              <h2>How are you travelling?</h2>
              <p className="ct-hint">This sets the speeds, the costs and the driving limits.</p>
              <div className="ct-q-field">
                <span className="ct-lbl">Transport</span>
                <div className="ct-modes" role="group" aria-label="Transport mode">
                  {MODE_TILES.map(t => {
                    // The local-train switch belongs to the train pill, so the
                    // pill and its switch stay siblings inside one tile.
                    const pill = (
                      <button key={t.mode} type="button" data-choice={t.mode} className={`ct-mode${f.transportMode === t.mode ? ' on' : ''}`}
                        aria-pressed={f.transportMode === t.mode}
                        title={t.hint}
                        onClick={() => {
                          haptic(HAPTIC.select)
                          patchFields(t.mode !== 'train' && f.localTrain ? { transportMode: t.mode, localTrain: false } : { transportMode: t.mode })
                        }}>
                        <t.icon size={13} aria-hidden />
                        <span>{t.mode === 'rental' ? 'Car rental' : cap(t.mode)}</span>
                        <small>{t.hint}</small>
                      </button>
                    )
                    if (t.mode !== 'train') return pill
                    return (
                      <span key="train" className="mode-tile">
                        {pill}
                        {f.transportMode === 'train' && (
                          <label className="ts-switch mode-local-switch">
                            <input type="checkbox" role="switch" checked={f.localTrain}
                              onChange={e => { haptic(HAPTIC.toggle); patchFields({ localTrain: e.target.checked }) }}
                              aria-label="Local / suburban train fares (much cheaper)" />
                            <span className="ts-switch-track" aria-hidden="true"></span>
                            <span className="ts-switch-label">Local</span>
                          </label>
                        )}
                      </span>
                    )
                  })}
                </div>
              </div>
              {/* Mixed is the one mode that asks (2026-10-19). The question sits
                  directly under the mode row it qualifies. */}
              {f.transportMode === 'mixed' && (
                <div className="ct-q-field">
                  <span className="ct-lbl" id="ct-mixed-driving-label">Will you drive any part of this trip?</span>
                  <div className="transport-answer-pair" role="group" aria-labelledby="ct-mixed-driving-label" aria-describedby={errs.drivesPart ? 'gcf-driving-error' : undefined} data-sel={f.drivesPart === true ? '0' : f.drivesPart === false ? '1' : 'none'}>
                    <button type="button" className={`crew-btn${f.drivesPart === true ? ' on' : ''}`}
                      aria-pressed={f.drivesPart === true}
                      onClick={() => { haptic(HAPTIC.select); patchFields({ drivesPart: true }) }}>Yes, I drive</button>
                    <button type="button" className={`crew-btn${f.drivesPart === false ? ' on' : ''}`}
                      aria-pressed={f.drivesPart === false}
                      onClick={() => { haptic(HAPTIC.select); patchFields({ drivesPart: false }) }}>No, passenger only</button>
                  </div>
                  {f.drivesPart === undefined && (
                    <p className="adv-hint" id="gcf-driving-error" role="status">{errs.drivesPart || 'Answer this to create the trip.'}</p>
                  )}
                </div>
              )}

              {guided && drivingPolicy.showsDrivingControls && <section className="gcf-vehicle" aria-label="Fuel and vehicle">
                <h3>Fuel &amp; vehicle</h3>
                <div className="gcf-fuel-grid">
                  <label>Mileage<span className="unit-input"><input {...guidedField('fuelEconomy')} className="input" type="number" min={2} max={80} step={0.1} value={f.fuelEconomy} onChange={e => patchFields({ fuelEconomy: e.target.value })} placeholder={String(DEFAULT_FUEL_ECONOMY_KML)} aria-label="Mileage in kilometres per litre" /><span className="unit">km/L</span></span></label>
                  <label>Fuel price<span className="unit-input"><input {...guidedField('fuelPrice')} className="input" type="number" min={50} max={250} step={0.1} value={f.fuelPrice} onChange={e => patchFields({ fuelPrice: e.target.value })} placeholder={String(FUEL_PRICE_INR_PER_L)} aria-label="Fuel price in rupees per litre" /><span className="unit">₹/L</span></span></label>
                  <label>Tank<span className="unit-input"><input {...guidedField('tankL')} className="input" type="number" min={5} max={300} value={f.tankL} onChange={e => patchFields({ tankL: e.target.value })} placeholder="45" aria-label="Tank capacity in litres" /><span className="unit">L</span></span></label>
                  {f.transportMode === 'rental' && <label>Rent<span className="unit-input"><input {...guidedField('rentPerDay')} className="input" type="number" min={200} step={50} value={f.rentPerDay} onChange={e => patchFields({ rentPerDay: e.target.value })} placeholder="1800" aria-label="Rental rate in rupees per day" /><span className="unit">₹/day</span></span></label>}
                </div>
                {['fuelEconomy', 'fuelPrice', 'tankL', 'rentPerDay'].filter(key => errs[key]).map(key => <p className="err-text" id={`${FIELD_DOM_IDS[key]}-error`} role="status" key={key}>{ERR_LABELS[key]}: {errs[key]}</p>)}
                {fuelNotice && <p className="hint-text" role="status">{fuelNotice}</p>}
                <label className="ts-switch gcf-round-trip"><span>Include drive to start</span><input type="checkbox" role="switch" checked={f.roundTrip} aria-describedby="ct-roundtrip-help" onChange={e => patchFields({ roundTrip: e.target.checked })} /><span className="ts-switch-track" aria-hidden /></label>
                <p className="hint-text" id="ct-roundtrip-help">Includes the final drive to your starting location. Without return stops, the estimate uses the outward distance for the drive back.</p>
              </section>}

              {/* The return leg lives here, not on Where: whether a drive back is
                  even possible is a fact about the MODE, so the control belongs
                  beside the mode that decides it. The reverse-route planner walks
                  a wheel (#377); a passenger mode has no wheel, so it gets no
                  control, and no substitute is invented for it — a return leg by
                  train is a ticket, not a reverse road route. */}
              {drivingPolicy.driving && (
                <div className="ct-q-field">
                  <label className="ts-switch">
                    <input type="checkbox" role="switch" checked={returnCount > 0}
                      onChange={e => setReturnOn(e.target.checked)} aria-label="Configure custom return journey stops" aria-describedby="ct-return-help" />
                    <span className="ts-switch-track" aria-hidden="true"></span>
                    <span className="ts-switch-label">Add return stops</span>
                  </label>
                  <p className="hint-text" id="ct-return-help">Start with the reversed route, then edit the stops. These replace the simple return-distance estimate. The final drive to your starting location is a separate option.</p>
                </div>
              )}

              {returnCount > 0 && (
                <div className="return-section" aria-label="Return journey stops">
                  <div className="return-head">
                    <span className="eyebrow">Return</span>
                    <span className="return-note">Auto-filled with the reverse route - edit freely</span>
                  </div>
                  <div className="ct-chips" role="list" aria-label="Return stops">
                    {returnStops.map((d, i) => {
                      const gi = outbound.length + i
                      return (
                        <span className="ct-dchip ret" role="listitem" key={`ret-${d.name}-${gi}`}>
                          <span className="n" aria-hidden>{i + 1}</span>
                          <span title={d.name}>{d.name}</span>
                          <button type="button" className="x" aria-label={`Remove ${d.name}`}
                            onClick={() => { haptic(HAPTIC.tick); removeDest(gi) }}>&#10005;</button>
                        </span>
                      )
                    })}
                  </div>
                  <LocationInput
                    id="ct-return-input"
                    ariaLabel="Add a return stop to the trip"
                    value={returnInput}
                    onChange={setReturnInput}
                    errorId={errs.returnStops ? 'ct-return-err' : undefined}
                    error={errs.returnStops}
                    onPick={p => addDest({ name: p.name + (p.admin1 ? `, ${p.admin1}` : ''), lat: p.latitude, lng: p.longitude }, true)}
                    placeholder="Add a return stop.  e.g. Guruvayur"
                  />
                  {errs.returnStops && <p className="err-text" id="ct-return-err" role="status" aria-live="polite">{errs.returnStops}</p>}
                  {returnInput.trim() !== '' && (
                    <button type="button" className="btn btn-sm btn-ghost"
                      onClick={() => { haptic(HAPTIC.tick); addDest({ name: returnInput.trim() }, true) }}>
                      Add without a map pin
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ---- 4 - Who: party, crew and the drivers drawer. Split out of the
               old combined "Who & how" block so the guided flow can ask the
               transport question and the party question on their own screens. ---- */}
          <div className={`ct-q${whoDone ? ' done' : ''}`} hidden={guided && step !== 'who'}>
            <span className="ct-n">4</span>
            <div className="ct-q-body">
              <h2>Who's coming?</h2>
              <p className="ct-hint">We plan meal stops and rest breaks for the group.</p>
              <div className="ct-q-field">
                <span className="ct-lbl">Party size</span>
                <div className="ct-party">
                  {/* #379: the travellers error has to land on something a person can
                      see. The number input that used to take that focus sits inside
                      `.sr-only`, so a sighted keyboard user was sent nowhere. The
                      stepper is the control people actually touch, so the stepper is
                      the target — and the range travels with it, since `min`/`max`
                      live on the input nobody can see. */}
                  <span className="ct-step" role="group" ref={el => (fieldRefs.current.travellers = el)}
                    tabIndex={-1} aria-label={`Party size, ${CREW_MIN} to ${CREW_MAX} travellers`}
                    aria-describedby={errs.travellers ? 'ct-travellers-err' : undefined}>
                    <button type="button" aria-label="One fewer traveller"
                      onClick={() => { haptic(HAPTIC.tick); patchFields({ travellers: clampCrew(f.travellers - 1) }) }}>&minus;</button>
                    <b aria-live="polite">{f.travellers}</b>
                    <button type="button" aria-label="One more traveller"
                      onClick={() => { haptic(HAPTIC.tick); patchFields({ travellers: clampCrew(f.travellers + 1) }) }}>+</button>
                  </span>
                  <span className="ct-party-sub">traveller{f.travellers !== 1 ? 's' : ''}</span>
                  {/* The shortcut opens the driving drawer. With no driving
                      fields to open, both the button and the drawer go, rather
                      than an empty section wearing a new label. */}
                  {drivingPolicy.showsDrivingControls && !guided && (
                    <button type="button" className="ct-mini" aria-expanded={drawerOpen} aria-controls="ct-driving-details" onClick={() => { setDrawerOpen(true); document.getElementById('ct-driving-details')?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() }) }}>
                      Driving settings
                    </button>
                  )}
                  <span className="sr-only">{f.travellers} traveller{f.travellers !== 1 ? 's' : ''} on {cap(f.transportMode)}</span>
                </div>
                {/* #379: rendered once, visibly, and pointed at by both the group and
                    the hidden input — the input used to render its own copy of this
                    message inside `.sr-only`, so a screen reader heard the failure
                    twice and saw it nowhere. */}
                {errs.travellers && <p className="err-text" id="ct-travellers-err" role="status" aria-live="polite">{errs.travellers}</p>}
                {/* The value channel for AT that needs a real input to type into —
                    deliberately no longer where the error lands. */}
                <div className="sr-only">
                  <Field label="Travellers">
                    <input className="input mono" type="number" min={CREW_MIN} max={CREW_MAX} data-create-field="travellers"
                      value={f.travellers} aria-invalid={!!errs.travellers}
                      aria-describedby={errs.travellers ? 'ct-travellers-err' : undefined}
                      onChange={e => patchFields({ travellers: clampCrew(Number(e.target.value)) })} />
                  </Field>
                </div>
              </div>
              {createFunnelOn('crew') && (
                <div className="crew-card">
                  <div className="crew-card-t">
                    <Users size={13} aria-hidden />
                    <b>Bring the crew</b>
                    <span className="why">Optional. Prepare invitations for later.</span>
                  </div>
                  <div className="crew-invite-row">
                    <label htmlFor="ct-crew-name">Name
                      <input id="ct-crew-name" className="input" value={crewName} autoComplete="off" maxLength={100}
                        placeholder="e.g. Ammu" aria-invalid={crewFeedback?.field === 'name'} aria-describedby="ct-crew-help ct-crew-feedback"
                        onChange={e => { setCrewName(e.target.value); setCrewFeedback(null) }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCrewMember() } }} />
                    </label>
                    <label htmlFor="ct-crew-mobile">Mobile number
                      <input id="ct-crew-mobile" className="input" type="tel" inputMode="tel" value={crewMobile} autoComplete="off" maxLength={24}
                        placeholder="e.g. +91 98450 21234" aria-invalid={crewFeedback?.field === 'mobile'} aria-describedby="ct-crew-help ct-crew-feedback"
                        onChange={e => { setCrewMobile(e.target.value); setCrewFeedback(null) }}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCrewMember() } }} />
                    </label>
                    <button type="button" className="btn btn-outline btn-sm" onClick={addCrewMember}
                      disabled={crew.length >= crewLimit || (!crewName.trim() && !crewMobile.trim())}>Add crew member</button>
                  </div>
                  <p className="hint-text" id="ct-crew-help">Add a name, an Indian mobile number, or both. No invitation is sent here.</p>
                  <p className={crewFeedback?.field ? 'err-text' : 'hint-text'} id="ct-crew-feedback" role="status">{crewFeedback?.message}</p>
                  {crew.length > 0 && (
                    <div className="crew-chips">
                      {crew.map((m, i) => (
                        <span className="crew-chip" key={`${m.phone ?? m.label ?? m.name}-${i}`}>
                          {/* The number is masked in BOTH flows. The draft
                              masks it on write (D7), so printing the full number
                              here contradicts the project's own privacy rule.
                              A resumed entry carries `label` instead of a number:
                              it names the person and cannot build a link. */}
                          {m.name || m.label || (m.phone ? maskPhone(m.phone) : '')}
                          {/* A resumed entry has `label` where it used to have a
                              masked `phone`, so the hint reads from either and
                              the chip still shows which number it is. */}
                          {m.name && (m.phone || m.label) ? <small>{m.phone ? maskPhone(m.phone) : m.label}</small> : null}
                          <button type="button" aria-label={`Remove ${m.name || m.label || m.phone}`}
                            onClick={() => setCrew(list => list.filter((_, n) => n !== i))}>&#10005;</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="hint-text">
                    {crewLimit === 0
                      ? 'One traveller - nobody to invite. Add the crew from the trip’s Share tab.'
                      : <>You're the <b className="crew-planner">planner</b> - the crew votes, you decide. The invite is ready for each of them the moment the trip exists.</>}
                  </p>
                </div>
              )}
              {/* The drawer holds only fuel/vehicle and driving party dials. With neither
                  applicable it would be an empty section, so a passenger mode
                  drops it entirely rather than showing one under a new label. */}
              {drivingPolicy.showsDrivingControls && (
              <details id="ct-driving-details" className="adv-drawer" open={guided || drawerOpen}
                onToggle={e => setDrawerOpen(e.currentTarget.open)}>
                <summary>
                  <span className="group-lab">{guided ? 'Driving settings' : 'Fuel, vehicle and driving settings'}</span>
                  <span className="adv-hint">{f.fuelEconomy || f.fuelPrice || f.tankL || f.rentPerDay || f.driverCount || f.hasVulnerable || f.driveAfterDinnerMin ? 'Custom settings' : 'Defaults available'}</span>
                </summary>
                <div className="adv-body">
              {fuelMode && !guided && (
                <div>
                  <span className="group-lab">Fuel &amp; vehicle</span>
                  <div className="fuel-stack">
                    <label className="mini-field">
                      <span className="mini-lab">Mileage</span>
                      <span className="unit-input">
                        <input className="input mono" type="number" inputMode="decimal" min={2} max={80} step={0.1}
                          value={f.fuelEconomy} onChange={e => patchFields({ fuelEconomy: e.target.value })} placeholder={`e.g. ${DEFAULT_FUEL_ECONOMY_KML}`} aria-label="Mileage in kilometres per litre" />
                        <span className="unit">km/L</span>
                      </span>
                    </label>
                    {isImplausibleFuelEconomy(f.transportMode, parseFuelEconomyKmL(f.fuelEconomy)) && (
                      <p className="hint-text"><InlineIcon icon={TriangleAlert} size={12} gap={3} />Unusual for a {f.transportMode === 'rental' ? 'rented car' : f.transportMode}. Check the value.</p>
                    )}
                    {fuelNotice && (
                      <p className="hint-text" role="status"><InlineIcon icon={TriangleAlert} size={12} gap={3} />{fuelNotice}</p>
                    )}
                    <label className="mini-field">
                      <span className="mini-lab">Fuel price</span>
                      <span className="unit-input">
                        <input className="input mono" type="number" inputMode="decimal" min={50} max={250} step={0.1}
                          value={f.fuelPrice} onChange={e => patchFields({ fuelPrice: e.target.value })} placeholder={`e.g. ${FUEL_PRICE_INR_PER_L}`} aria-label="Fuel price in rupees per litre" />
                        <span className="unit">₹/L</span>
                      </span>
                    </label>
                    <label className="mini-field">
                      <span className="mini-lab">Tank</span>
                      <span className="unit-input">
                        <input className="input mono" type="number" inputMode="decimal" min={5} max={300} step={1}
                          value={f.tankL} onChange={e => patchFields({ tankL: e.target.value })} placeholder="e.g. 45" aria-label="Tank capacity in litres" />
                        <span className="unit">L</span>
                      </span>
                    </label>
                    {bill.rangeKm != null && (
                      <p className="hint-text">≈ <b className="mono">{bill.rangeKm} km</b> per tank</p>
                    )}
                    {f.transportMode === 'rental' && (
                      <label className="mini-field">
                        <span className="mini-lab">Rent</span>
                        <span className="unit-input">
                          <input className="input mono" type="number" inputMode="decimal" min={200} step={50}
                            value={f.rentPerDay} onChange={e => patchFields({ rentPerDay: e.target.value })} placeholder="e.g. 1800" aria-label="Rental rate in rupees per day" />
                          <span className="unit">₹/day</span>
                        </span>
                      </label>
                    )}
                    <div className="chip-row">
                      <span title="Includes the final drive to your starting location. Turn off for a one-way plan.">
                        <Chip active={f.roundTrip} aria-pressed={f.roundTrip}
                          onClick={() => { haptic(HAPTIC.toggle); patchFields({ roundTrip: !f.roundTrip }) }}>
                          Include drive to start
                        </Chip>
                      </span>
                    </div>
                    <p className="hint-text">Includes the final drive to your starting location. Without return stops, the estimate uses the outward distance for the drive back.</p>
                  </div>
                </div>
              )}
                {/* #142 party inputs — the two dials that move the honest wheel
                    cap. Hidden for conducted modes: nobody drives, nobody
                    fatigues. #213 Phase 5: gated on the ENGINE's own predicate
                    so this and Trip settings agree — it used to list `taxi`
                    (which the engine ignores) and omit `mixed` (which it honours). */}
                {/* Control visibility, so this is the CONTROL flag, not the planner's (2026-10-19). */}
                {drivingPolicy.showsDrivingControls && (
                  <div className="crew-custom" style={{ marginTop: 10 }}>
                    <Field label="Drivers sharing the wheel" hint="More drivers can share longer driving days.">
                      <div className="crew-row" role="group" aria-label="Drivers sharing the wheel">
                        {[1, 2, 3].map(n => (
                          <button key={n} type="button" className={`crew-btn${(f.driverCount ?? 1) === n ? ' on' : ''}`}
                            aria-pressed={(f.driverCount ?? 1) === n}
                            onClick={() => { haptic(HAPTIC.select); patchFields({ driverCount: n === 1 ? undefined : n }) }}>{n} {n === 1 ? 'driver' : 'drivers'}</button>
                        ))}
                      </div>
                    </Field>
                    {guided && <label className="ts-switch gcf-vulnerable"><span>Travelling with children or older travellers</span><input type="checkbox" role="switch" checked={!!f.hasVulnerable} onChange={e => patchFields({ hasVulnerable: e.target.checked || undefined })} /><span className="ts-switch-track" aria-hidden /></label>}
                    <Field label={guided ? 'After dinner' : 'Pace of the party'}>
                      <div className="crew-row" role="group" aria-label="Party pace">
                        {!guided && <button type="button" className={`crew-btn${!f.hasVulnerable ? ' on' : ''}`} aria-pressed={!f.hasVulnerable}
                          onClick={() => { haptic(HAPTIC.select); patchFields({ hasVulnerable: undefined }) }}>Adults only</button>}
                        {!guided && <button type="button" className={`crew-btn${f.hasVulnerable ? ' on' : ''}`} aria-pressed={f.hasVulnerable}
                          title="Children or older travellers. Shorter days and earlier dinner."
                          onClick={() => { haptic(HAPTIC.select); patchFields({ hasVulnerable: true }) }}>Children or older travellers</button>}
                        {/* #122 dhaba case — opt-in post-dinner driving */}
                        <button type="button" className={`crew-btn${f.driveAfterDinnerMin ? ' on' : ''}`} aria-pressed={!!f.driveAfterDinnerMin}
                          title="Allow up to two hours of driving after dinner"
                          onClick={() => { haptic(HAPTIC.select); patchFields({ driveAfterDinnerMin: f.driveAfterDinnerMin ? undefined : 120 }) }}>
                          Drive after dinner
                        </button>
                      </div>
                    </Field>
                  </div>
                )}
                </div>
              </details>
              )}
            </div>
          </div>

          {/* ---- Budget: the funnel mockup promotes it out of the refine layer -
               pricing is a decision, so it gets its own question-sized block
               carrying the honest anchor and the experience translation. ---- */}
          <div className="ct-budget" hidden={guided && step !== 'budget'}>
            <div className="tpl-warm-head">
              {/* A question, like every other step heading. "Budget per head"
                  named the field; this asks what the step wants to know. */}
              <h2>What is your budget?</h2>
              <span className="why">Per person, for the whole trip</span>
            </div>
            {guided && <p className="ct-hint">Per person, for the whole trip. Change it at any time.</p>}
            <div className="ct-bud-card">
              <div className="ct-rrow">
                <div className="ct-bud">
                  <input type="range" min={2500} max={60000} step={500}
                    value={Math.min(60000, Math.max(2500, f.budgetPerPersonInr))}
                    aria-label="Budget per person in rupees"
                    onChange={e => { setBudgetTouched(true); patchFields({ budgetPerPersonInr: Number(e.target.value) }) }} />
                  <span className="v">
                    &#8377;{f.budgetPerPersonInr.toLocaleString('en-IN')}
                    <small>Group &#8377;{(f.budgetPerPersonInr * f.travellers).toLocaleString('en-IN')}</small>
                  </span>
                </div>
                {/* The exact number still matters - a slider cannot say 13,750. */}
                <label className="ct-bud-exact">
                  Exact amount
                  <input className="mono" type="number" min={0} step={500} data-create-field="budgetPerPersonInr"
                    ref={el => (fieldRefs.current.budgetPerPersonInr = el)}
                    aria-label="Budget per person, exact amount"
                    aria-invalid={!!errs.budgetPerPersonInr}
                    aria-describedby={errs.budgetPerPersonInr ? 'ct-budget-err' : undefined}
                    value={f.budgetPerPersonInr}
                    onChange={e => { setBudgetTouched(true); patchFields({ budgetPerPersonInr: Number(e.target.value) }) }} />
                </label>
                <button type="button" className="ct-mini"
                  disabled={suggestedBudget == null}
                  aria-describedby={createFunnelOn('budget') ? 'ct-budget-guidance' : undefined}
                  onClick={() => { if (suggestedBudget == null) return; setBudgetTouched(false); patchFields({ budgetPerPersonInr: suggestedBudget }) }}>
                  Use estimate
                </button>
              </div>
              {errs.budgetPerPersonInr && <p className="err-text" id="ct-budget-err" role="status" aria-live="polite">{errs.budgetPerPersonInr}</p>}
              {/* Politely live: the auto-fill above rewrites this number. */}
              <span className="sr-only" role="status">{budgetNotice}</span>
              {createFunnelOn('budget') && (<p className="hint-text budget-tier" id="ct-budget-guidance" role="status">
                {budgetTargetMessage(f.budgetPerPersonInr, bill.perHead)}
              </p>)}
              {createFunnelOn('budget') && band && (
                <p className="hint-text budget-anchor" role="status">
                  <i className="bench-mark" aria-hidden>&#9650;</i> A typical {band.days}-day {band.label} run costs <b>&#8377;{band.low.toLocaleString('en-IN')}&ndash;{band.high.toLocaleString('en-IN')}</b> per head
                  {f.budgetPerPersonInr > 0 ? <>. Your target is {f.budgetPerPersonInr < band.low ? 'below' : f.budgetPerPersonInr > band.high ? 'above' : 'within'} this range</> : null}.
                </p>
              )}
            </div>
          </div>

          {/* ---- Refine: accommodation sets the stay estimate. Travel style
               sets pace and suggestion preferences independently. ---- */}
          <div className="ct-refine" hidden={guided && step !== 'budget'}>
            <span className="ct-lbl">Refine the trip</span>

            <div className="ct-rrow">
              <span className="ct-lbl">Accommodation</span>
              <span className="ct-tier" role="group" aria-label="Accommodation tier">
                {(['budget', 'comfort', 'luxury'] as const).map(st => (
                  <button key={st} type="button" data-choice={st} className={f.stayStyle === st ? 'on' : ''}
                    aria-pressed={f.stayStyle === st}
                    onClick={() => { haptic(HAPTIC.select); patchFields({ stayStyle: st }) }}>{cap(st)}</button>
                ))}
              </span>
              <span className="ct-party-sub">Sets the accommodation estimate. Your route stays the same.</span>
            </div>

            <details className={guided ? 'gcf-budget-details' : undefined} open>
              <summary hidden={!guided}>Travel style</summary>
              <span className="ct-lbl">{guided ? 'Choose one' : 'Travel style. Choose one'}</span>
              <div className="ct-styles" role="group" aria-label="Travel style" style={{ marginTop: 6 }}>
                {TRAVEL_STYLES.map(st => (
                  <button key={st} type="button" data-choice={st} className={`ct-style${f.travelStyle === st ? ' on' : ''}`}
                    aria-pressed={f.travelStyle === st}
                    onClick={() => { haptic(HAPTIC.select); patchFields({ travelStyle: st }) }}>{cap(st)}</button>
                ))}
              </div>
              <p className="hint-text style-copy" role="status"><b>{cap(f.travelStyle)}.</b> {STYLE_COPY[f.travelStyle]}</p>
            </details>
          </div>

          {/* ---- cover + pinned: the optional layer ---- */}
          {guided && step === 'review' && <button type="button" className="btn btn-outline gcf-details-toggle" onClick={() => setDetailsOpen(value => !value)} aria-expanded={detailsOpen}>Add details <span className="muted">Optional</span></button>}
          <div className="ct-optional" hidden={guided && (step !== 'review' || !detailsOpen)}>
            <div className="ct-opt-head">
              <span className="ct-lbl">Trip cover</span>
              <span className="ct-party-sub">Optional</span>
            </div>
            <Field label="Trip emoji">
              <div className="chip-row" style={{ marginTop: 6 }}>
                {EMOJIS.map(em => (
                  <Chip key={em} active={f.coverEmoji === em} aria-pressed={f.coverEmoji === em}
                    aria-label={`Trip emoji ${em}`}
                    onClick={() => { haptic(HAPTIC.select); patchFields({ coverEmoji: em }) }}>
                    <span style={{ fontSize: 18 }}>{em}</span>
                  </Chip>
                ))}
              </div>
            </Field>
            <Field label="Cover image (optional)"
              hint="Leave blank to auto-use a popular photo of your destination, or paste your own image URL.">
              <div className="cover-picker-controls">
                <button type="button" className="btn btn-outline btn-sm" disabled={busyCover}
                  onClick={async () => {
                    haptic(HAPTIC.tick)
                    setBusyCover(true)
                    try {
                      const last = dests[dests.length - 1]?.name?.trim()
                      const q = last || f.startLocation.trim() || f.name.trim()
                      const u = q ? await fetchTripThumbUrl(q) : null
                      patchFields({ coverImageUrl: u ?? '' })
                      if (!u) toast("Couldn’t find a photo for that destination. Paste an image URL instead.", 'err')
                    } finally { setBusyCover(false) }
                  }}>
                  {busyCover ? 'Finding photo…' : f.coverImageUrl ? 'Refresh destination photo' : 'Use destination photo'}
                </button>
                <div className="cover-picker-custom">
                  {/* #88: nested two levels below Field, so Field's label wiring
                      (direct-control-child only) can't reach it — the accessible
                      name is set explicitly instead. */}
                  <input className="input" placeholder="Paste an image URL…" aria-label="Cover image URL" value={f.coverImageUrl}
                    onChange={e => patchFields({ coverImageUrl: e.target.value })} />
                </div>
              </div>
            </Field>

          <div className="ct-opt-head" style={{ marginTop: 16 }}>
              <span className="ct-lbl">Pinned plans</span>
              <span className="ct-party-sub">Optional. Trains, weddings or other plans with a fixed time.</span>
            </div>
            {createFunnelOn('iq') && radar.length > 0 && (
              <div className="ct-radar" role="status">
                {radar.map(line => (
                  <div key={line.headline} className="ct-radar-line">
                    <b>{line.headline}</b>
                    <span>{line.detail}</span>
                  </div>
                ))}
              </div>
            )}
            {commitments.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {commitments.map((x, i) => (
                  <div key={i} className="warn-item sev-low" style={{ marginBottom: 7 }}>
                    <span className="warn-icon"><Pin size={13} aria-hidden /></span>
                    <div style={{ flex: 1 }}>
                      <div className="warn-title">{x.title}</div>
                      <div className="warn-fix">Day {x.dayIndex + 1} at {formatHM(x.time, timeFormat)}{x.destName ? `, at ${x.destName}` : ''}</div>
                    </div>
                    <button type="button" className="icon-btn" aria-label={`Remove ${x.title}`} onClick={() => setCommitments(l => l.filter((_, j) => j !== i))}><X size={13} aria-hidden /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="form-row commitment-row">
              <Field label="What">
                <input id="ct-composer-input" className="input" value={c.title} onChange={e => setC(x => ({ ...x, title: e.target.value }))} placeholder="e.g. Houseboat boarding" aria-invalid={!!errs.composerRow} aria-describedby={errs.composerRow ? 'ct-composer-err' : undefined} />
                {errs.composerRow && <p className="err-text" id="ct-composer-err" role="status" aria-live="polite">{errs.composerRow}</p>}
              </Field>
              <Field label="Type">
                <Select value={c.type} onChange={val => setC(x => ({ ...x, type: val as FixedCommitment['type'] }))}
                  options={[
                    { value: 'hotel-checkin', label: 'Hotel check-in' },
                    { value: 'train-departure', label: 'Train departure' },
                    { value: 'flight-departure', label: 'Flight departure' },
                    { value: 'event', label: 'Event' },
                    { value: 'other', label: 'Other' },
                  ]} />
              </Field>
              <Field label="Day">
                <Select value={String(c.dayIndex)} disabled={!dayCount}
                  onChange={val => setC(x => ({ ...x, dayIndex: Number(val) }))}
                  options={Array.from({ length: Math.max(1, dayCount) }, (_, i) => ({ value: String(i), label: `Day ${i + 1}` }))} />
              </Field>
              <Field label="Time" error={guided ? errs.composerTime : undefined}><input data-create-field="composerTime" className="input" type="time" value={c.time} onChange={e => setC(x => ({ ...x, time: e.target.value }))} /></Field>
              <Field label="Linked stop">
                <Select value={c.destName ?? ''} onChange={val => setC(x => ({ ...x, destName: val }))}
                  aria-label="Destination this deadline is checked against"
                  options={[{ value: '', label: 'No linked stop' }, ...dests.map(d => ({ value: d.name, label: d.name }))]} />
              </Field>
              <button type="button" className="btn btn-outline" onClick={addCommitment} style={{ height: 42 }}>Add pinned plan</button>
            </div>
          </div>
          {guided && returnToReview && step !== 'review' && <button type="button" className="btn btn-outline gcf-return-review" onClick={() => goToStep('review')}>Back to Review</button>}
          {guided && <StepNav step={step} errors={errs} onGo={goToStep} submitting={submitting} failed={!!saveError}
            peek={`${outbound.length} stop${outbound.length === 1 ? '' : 's'}${bill.roadKm != null ? ` · ${Math.round(bill.roadKm)} km` : ''}`}
            onPeek={() => setTicketOpen(true)} />}
          {guided && step === 'review' && <div className="gcf-review-actions">
            <p className="hint-text">Creates the trip and opens your rough day plan.</p>
            <button type="button" className="btn btn-outline" disabled={!bill.perHead} onClick={() => {
              setBillPrinted(value => !value)
              requestAnimationFrame(() => document.querySelector<HTMLElement>('.gcf-printed-bill')?.focus())
            }}><Printer size={16} aria-hidden />{billPrinted ? 'Hide the rough bill' : 'Print the rough bill'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => onNavigate('/trips')}>Cancel</button>
            {billPrinted && <div className="gcf-printed-bill" role="region" aria-label="Rough trip bill" tabIndex={-1}>
              <h3>Rough trip bill</h3>
              <div className="bill-row"><span>Transport</span><b><Money v={bill.transportCost} animate={!reduced} /></b></div>
              <div className="bill-row"><span>Stay</span><b><Money v={bill.stayCost} animate={!reduced} /></b></div>
              <div className="bill-row"><span>Food</span><b><Money v={bill.mealCost} animate={!reduced} /></b></div>
              <p className="hint-text">Excludes tolls, parking and entry fees.</p>
            </div>}
          </div>}
          </div>
        </form>

        {/* ---- The Trip Ticket (right rail / hidden on mobile) ---- */}
        {guided && <aside className="gcf-rail" aria-label="Trip ticket preview">{guidedTicket}</aside>}
        <aside className="ts-rail" aria-label="Trip ticket preview" hidden={guided}>
          <div className="ticket">
            <div className="tk-head">
              <span className="tk-brand">YatraFlow</span>
              <span className="tk-kind">Trip ticket</span>
            </div>
            <div className="tk-cover">
              {f.coverImageUrl.trim()
                ? <img className="tk-scenery" src={f.coverImageUrl.trim()} alt="" />
                : <TicketScenery />}
              <span className="emoji-chip">{f.coverEmoji}</span>
            </div>
            <div className="tk-body">
              <div className="tk-title">{ticketTitle}</div>
              <p className="tk-route" title={ticketRoute}>
                {ticketRoute}
                {returnCount > 0 && <span className="tk-return-chip">↔ Custom return</span>}
              </p>
              <div className="tk-rows">
                <div className="tk-row"><span className="ic"><Calendar size={13} aria-hidden /></span><b>{dateLabel}</b></div>
                <div className="tk-row"><span className="ic">{modeIcon(f.transportMode, 12)}</span><span className="lab">{f.travellers} traveller{f.travellers !== 1 ? 's' : ''}</span><b>· {cap(f.transportMode)}{f.transportMode === 'train' && f.localTrain ? ' · local' : ''}</b></div>
                {fuelMode && ticketFuelSegments(f.fuelEconomy, f.fuelPrice, f.tankL).length > 0 && (
                  <div className="tk-row"><span className="ic"><Fuel size={13} aria-hidden /></span><span className="lab">{ticketFuelSegments(f.fuelEconomy, f.fuelPrice, f.tankL).join(' · ')}</span></div>
                )}
                <div className="tk-row"><span className="ic"><Wallet size={13} aria-hidden /></span><span className="lab">Budget</span><b className="mono">₹{f.budgetPerPersonInr.toLocaleString('en-IN')} / person</b></div>
              </div>
            </div>
            <div className="tear" aria-hidden="true"></div>
            {/* THE BILL ANSWERS AS YOU GO (the mockup's principle 3): the stub
                carries the rough take live - rows appear with their inputs and
                each shows its math, nothing hides behind Print. Printing stays
                as the paper moment below. */}
            <div className="tk-stub tk-bill">
              <div className="bill-row"><span>Transport</span><b className="mono">{bill.transportCost != null ? <Money v={bill.transportCost} animate={!reduced} /> : 'Not priced'}</b></div>
              <p className="bill-formula">{bill.transportFormula || `Add a mapped stop to estimate the ${costNoun}.`}</p>
              <div className="bill-row"><span>Stay</span><b className="mono"><Money v={bill.stayCost} animate={!reduced} /></b></div>
              <p className="bill-formula">{bill.stayFormula}</p>
              <div className="bill-row"><span>Food</span><b className="mono"><Money v={bill.mealCost} animate={!reduced} /></b></div>
              <p className="bill-formula">{bill.mealFormula}</p>
              <div className="bill-row bill-dim"><span>Entries &amp; tolls</span><b>Excluded</b></div>
              {bill.perHead != null && (
                <>
                  <div className="bill-row bill-total"><span>Total</span><b className="mono">{'\u20B9 '}<Money v={Math.round(bill.perHead * f.travellers)} animate={!reduced} /></b></div>
                  <div className="bill-perhead"><span className="mono">{'\u20B9 '}<Money v={bill.perHead} animate={!reduced} /></span><span className="per">/ head</span></div>
                </>
              )}
              <p className="tk-fine">
                {bill.perHead
                  ? 'Rough take - refined once your route resolves in the workspace. Excludes tolls, parking and entry fees.'
                  : `Add a date range and at least one geocoded stop to price the ${costNoun}.`}
              </p>
            </div>
          </div>
          {createFunnelOn('readiness') && (
            <div className="ready-block" role="status" aria-label="What is left before the trip can be created">
              <div className="ready-head">
                <span className="ready-lab">{readinessLine(readiness)}</span>
                <span className="ready-pct">{readiness.pct}%</span>
              </div>
              {readiness.items.map(item => (
                <div key={item.key} className={`ready-row${item.done ? ' ok' : ''}${item.optional ? ' opt' : ''}`}>
                  <span className="ready-tick" aria-hidden>{item.done ? '\u2713' : ''}</span>
                  <span className="ready-name">{item.label}</span>
                  <span className="ready-why">{item.why}</span>
                </div>
              ))}
            </div>
          )}
          <div className="tk-cta-block">
            {/* One primary action, always visible. The page used to hide
                Create trip behind "Print my bill", which left a form with no
                visible way to finish. Printing is a secondary peek. */}
            {saveFailure}
            <button type="submit" form="yf-create-form" className="tk-cta" disabled={submitting}>
              {submitting ? CREATE_ACTION_BUSY_LABEL : <>{CREATE_ACTION_LABEL} <ArrowRight size={16} aria-hidden /></>}
            </button>
            <div className="tk-subrow">
              <button type="button" className="tk-cancel" onClick={printBill} disabled={!bill.perHead}>
                {billPrinted ? 'Hide the rough bill' : 'Print the rough bill'}
              </button>
              <button type="button" className="tk-cancel" onClick={() => onNavigate('/trips')}>Cancel</button>
            </div>
              {billPrinted && (
                <>
                  <div className="bill-printer" role="region" aria-label="Rough trip bill" ref={billRef} tabIndex={-1}>
                    <div className="bill-slot" aria-hidden="true"><span></span></div>
                    <div className="bill-reveal">
                      <div className="bill-paper bill-paper-sway">
                        <p className="bill-brand">YATRAFLOW &ndash; ROUGH BILL</p>
                        <div className="bill-row"><span>Road (est.)</span><b className="mono">{bill.roadKm != null ? `\u2248 ${bill.roadKm} km` : '-'}</b></div>
                        <div className="bill-row"><span>Transport</span><b className="mono"><Money v={bill.transportCost} animate={!reduced} /></b></div>
<p className="bill-formula">{bill.transportFormula || `Add a mapped stop to estimate the ${costNoun}.`}</p>
                        <div className="bill-row"><span>Stay</span><b className="mono"><Money v={bill.stayCost} animate={!reduced} /></b></div>
                        <p className="bill-formula">{bill.stayFormula}</p>
                        <div className="bill-row"><span>Food</span><b className="mono"><Money v={bill.mealCost} animate={!reduced} /></b></div>
                        <p className="bill-formula">{bill.mealFormula}</p>
                        <div className="bill-row bill-total"><span>Total</span><b className="mono">{'\u20B9 '}<Money v={bill.perHead != null ? Math.round(bill.perHead * f.travellers) : null} animate={!reduced} /></b></div>
                        <div className="bill-perhead"><span className="mono">{'\u20B9 '}<Money v={bill.perHead ?? 0} animate={!reduced} /></span><span className="per">/ head</span></div>
                        <p className="bill-note">An estimate that updates when the route is measured. Excludes tolls, parking and entry fees.</p>
                      </div>
                    </div>
                  </div>
                </>
              )}
          </div>
        </aside>
      </div>

      {/* ---- Mobile dock (≤900px): the CTA surface ---- */}
      {guided && <Modal open={ticketOpen} onClose={() => setTicketOpen(false)} title="Your trip ticket">{guidedTicket}</Modal>}
      <div className="trip-dock" role="region" aria-label="Trip ticket dock" hidden={guided}>
        <div className="dock-thumb">{f.coverEmoji}</div>
        <div className="dock-meta">
          <b>{ticketTitle}</b>
          <span>
            {bill.days > 0 ? `${bill.days}d · ${bill.nights}n · ${f.travellers} travellers` : 'Pick your dates'}
            {billPrinted && bill.perHead != null && <> · <span className="mono dock-amt">{'≈ '}<Money v={bill.perHead} animate={!reduced} />{'/head'}</span></>}
          </span>
          {createFunnelOn('readiness') && <span className="dock-ready">{readinessLine(readiness)}</span>}
        </div>
        {/* Same fix as the rail: the primary is the primary, and printing is a
            peek at the numbers - not a gate in front of creating. */}
        <button type="submit" form="yf-create-form" className="dock-cta" disabled={submitting}>
          {submitting ? CREATE_ACTION_BUSY_LABEL : <>{CREATE_ACTION_LABEL} <ArrowRight size={15} aria-hidden /></>}
        </button>
        <button type="button" className="dock-secondary" onClick={printBill} disabled={!bill.perHead} aria-label="Print the rough bill"><Printer size={15} aria-hidden /></button>
      </div>
    </div>
  )
}
