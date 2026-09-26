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
import { estimateTripStarter, buildOutlineSeedStops } from '../lib/tripStarter'
import { TRIP_TEMPLATES, applyTemplate, templateFromRange, fmtBand } from '../lib/tripTemplates'
import { regionFor, regionBand, nationalBand, experienceTier, anchorNote } from '../lib/budgetBenchmarks'
import { createFunnelOn } from '../lib/featureFlags'
import { createReadiness, readinessFromDraft, readinessLine } from '../lib/createReadiness'
import { saveDraft, loadDraft, clearDraft, draftIsWorthKeeping, draftAgeLabel, type StoredDraft } from '../lib/createDraft'
import { unpickedStopErrors } from '../lib/createSubmit'
import { addCrewEntry, type CrewEntry } from '../lib/crewInvite'
import { stashHandoff } from '../lib/createHandoff'
import { routeIq, routeIqLine, type RoutePoint } from '../lib/routeIq'
import { seasonNoteFor, monthOfIso } from '../lib/seasonality'
import { radarLines } from '../lib/createRadar'
import { fetchTripThumbUrl } from '../lib/tripThumb'
import { Field, Chip, toast, Odometer, useMedia, FormErrorSummary } from '../components/ui'
import { Select } from '../components/Select'
import { DateRangeCalendar, fmtDay, isoDay } from '../components/DateRangeCalendar'
import { isoAddDays } from '../lib/weather'
import { PillNav } from '../components/PillNav'
import { haptic, HAPTIC } from '../lib/haptics'
import { useTimeFormat, formatHM } from '../lib/timefmt'
import { cap } from '../lib/labels'
import { readBenchPrefill } from '../lib/planBench'
import { scrollBehavior } from '../lib/motion'
import { LocationInput } from '../components/LocationInput'

interface CommitDraft {
  title: string
  type: FixedCommitment['type']
  dayIndex: number
  time: string
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
  car: { hint: 'your fuel · ≈42 km/h' },
  rental: { hint: 'self-drive · ₹/day' },
  motorcycle: { hint: 'your fuel · ≈44 km/h' },
  train: { hint: '₹1.6/km fare' },
  bus: { hint: '₹2.2/km fare' },
  flight: { hint: '₹6.5/km + fees' },
  taxi: { hint: '₹16/km fare' },
  mixed: { hint: 'a bit of everything' },
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
  relaxed: 'gentle rhythm — stretch halts every ~120 km, meals ~260 km, 60 min/day of detour slack for suggestions.',
  packed: 'maximum ground — 180 km between stretch halts, meals ~300 km, 30 min/day of detour slack.',
  balanced: 'the default rhythm — stretches every 150 km, meals ~300 km, 45 min/day of detour slack.',
  adventure: 'suggestions favour treks, trails and outdoor stops — adventure and nature categories rank up.',
  luxury: 'the default driving rhythm. The bed\'s price is the Budget preference above — this dial never touches pricing.',
  budget: 'the default driving rhythm. The bed\'s price is the Budget preference above — this dial never touches pricing.',
  family: 'built around crew size — 5+ travellers get the gentler 120 km cadence automatically, style aside.',
  spiritual: 'suggestions favour temple stops and sacred circuits — the temple category ranks up.',
  'food-focused': 'suggestions favour food — local meals rank up wherever the route goes.',
  creator: 'suggestions favour landmark sights and museums — the content-worthy stops.',
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
 *  would never run. Falls back to an em dash when there is nothing to price. */
function Money({ v, animate }: { v: number | null | undefined; animate: boolean }) {
  if (v == null) return <>—</>
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
    // #142 party inputs — undefined until the user touches the controls
    driverCount: undefined as number | undefined,
    hasVulnerable: undefined as boolean | undefined,
    driveAfterDinnerMin: undefined as number | undefined,
    transportMode: 'car' as TransportMode,
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
  const [c, setC] = useState<CommitDraft>({ title: '', type: 'hotel-checkin', dayIndex: 0, time: '14:00' })
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

  const dayCount = f.startDate && f.endDate ? Math.round((new Date(f.endDate).getTime() - new Date(f.startDate).getTime()) / 86400000) + 1 : 0

  const orderedPoints = useMemo(
    () => [startCoords, ...dests.map(d => (d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : null))],
    [startCoords, dests],
  )
  const tankNum = Number(f.tankL)
  const rentNum = Number(f.rentPerDay)
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
  // P5 - the crew collector. Local state only: nothing is written to the trip
  // and nothing is sent from here. The invite is composed (and marked ready)
  // once the trip exists, so this page never promises a message it cannot send.
  const [crew, setCrew] = useState<CrewEntry[]>([])
  const [crewInput, setCrewInput] = useState('')
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

  useEffect(() => {
    if (!createFunnelOn('drafts') || !draftDecided) return
    const t = setTimeout(() => {
      saveDraft({ form: f as unknown as Record<string, unknown>, dests, returnCount, crew: crew.map(c => ({ name: c.name, phone: c.phone })) })
    }, 800)
    return () => clearTimeout(t)
  }, [f, dests, returnCount, crew, draftDecided])

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
    const next = addCrewEntry(crew, crewInput, crewLimit)
    if (next === crew) { setCrewInput(''); return }
    haptic(HAPTIC.tick)
    setCrew(next)
    setCrewInput('')
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
    setF(prev => ({ ...prev, ...(draft.form as Partial<typeof prev>) }))
    setDests(draft.dests)
    setReturnCount(draft.returnCount)
    if (draft.crew?.length) setCrew(draft.crew.map(c => ({ raw: c.name || c.phone || '', name: c.name, phone: c.phone })))
    // the restored budget is the user's own number - hand the field back to them
    setBudgetTouched(true)
    setDraft(null)
    setDraftDecided(true)
    toast('Picked up where you left off')
  }

  function discardDraft() {
    haptic(HAPTIC.toggle)
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
  // P2 - money in the user's hands, described by what it buys.
  const tier = experienceTier(f.budgetPerPersonInr)

  // Day Planner (P1, PR #105): the engine kicks in the moment a start and a
  // destination exist — the route demands its own days from the wheel-hour
  // cap, before any date juggling. Blended mode speed until the workspace's
  // OSRM road time exists; the verdict re-derives on every input change.
  const driveDaysVerdict = useMemo(() => {
    if (bill.roadKm == null || bill.roadKm < 90) return null
    // #126: conducted modes — train/bus/flight/taxi — have no driving fatigue
    // to split; the verdict stays silent for them.
    if (!isSelfDrivenMode(f.transportMode)) return null
    const speed = MODE_SPEED[f.transportMode] ?? 42
    // #126 mode gate + #142 party inputs: timetable modes get no verdict;
    // drivers/vulnerable party move the honest cap.
    return planDriveDays({ totalKm: bill.roadKm, driveMinutes: (bill.roadKm / speed) * 60, travelStyle: f.travelStyle, transportMode: f.transportMode, driverCount: f.driverCount, hasVulnerable: f.hasVulnerable })
  }, [bill.roadKm, f.transportMode, f.travelStyle, f.driverCount, f.hasVulnerable])

  function patchFields(next: Partial<typeof f>) {
    setF(x => ({ ...x, ...next }))
  }


  /** Warm start (P1): one tap pre-fills the form from a curated template.
   *  Never clobbers what the user already typed (applyTemplate merge rules),
   *  always lands on real coordinates so the bill computes immediately. */
  function pickTemplate(t: (typeof TRIP_TEMPLATES)[number]) {
    haptic(HAPTIC.select)
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
      ? 'Day out: one round-trip day — the bill prices meals and parking, no stay'
      : 'Weekend dash: two days there and back — no stay unless you add one')
  }

  // Auto-fill: the rounded-up rough take lands in the budget field whenever it
  // changes and the user hasn't claimed the field by editing it.
  const suggestedBudget = bill.perHead != null && bill.perHead > 0
    ? Math.max(500, Math.round(bill.perHead / 500) * 500)
    : null
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
      toast('Return stops cleared — driving back the same way.')
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
  const SAVE_FAILED = 'Couldn’t save this trip to the server — your inputs are still here. Try again.'

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
  }

  /** Error keys whose control is a LocationInput. It owns its own <input>, so
   *  F-15 focus reaches it by the id we hand it rather than a ref (#375). */
  const FIELD_DOM_IDS: Record<string, string> = {
    destinations: 'ct-dest-input',
    returnStops: 'ct-return-input',
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!me) return
    const next: Record<string, string> = {}
    if (!f.name.trim()) next.name = 'Name your trip.'
    if (!f.startLocation.trim()) next.startLocation = 'Where does the journey start?'
    // #375: text typed into an add-stop field but never picked used to vanish
    // here — the stop count looked fine and the place the user typed was simply
    // absent from the trip. Say so instead, on the field that holds the text.
    // The unpicked message wins over the bare "add a destination" one: it names
    // the text the user can see in the box, which is the more useful sentence.
    const unpicked = unpickedStopErrors({ dest: destInput, ret: returnInput, returnOpen: returnCount > 0 })
    if (unpicked.destinations) next.destinations = unpicked.destinations
    else if (dests.length === 0) next.destinations = 'Add at least one destination.'
    if (unpicked.returnStops) next.returnStops = unpicked.returnStops
    if (!f.startDate) next.startDate = 'Pick a start date.'
    if (!f.endDate) next.endDate = 'Pick an end date.'
    else if (f.startDate && new Date(f.endDate) < new Date(f.startDate)) next.endDate = 'End date must be after the start date.'
    if (f.travellers < CREW_MIN) next.travellers = 'At least one traveller!'
    else if (f.travellers > CREW_MAX) next.travellers = `Split groups over ${CREW_MAX} into multiple trips.`
    // #213 Phase 5: the floor is the crew helper's, not a magic 500 — Trip
    // settings allows ₹0 (= "no per-person target", which the pacing tile
    // already renders honestly), so the two surfaces agree.
    if (f.budgetPerPersonInr < 0) next.budgetPerPersonInr = 'A budget cannot be negative.'
    setErrs(next)
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
      transportMode: f.transportMode,
      fuelEconomyKmL: fuelMode ? parseFuelEconomyKmL(f.fuelEconomy) : undefined,
      fuelPricePerL: fuelMode ? parseFuelPricePerL(f.fuelPrice) : undefined,
      roundTrip: fuelMode ? f.roundTrip : undefined,
      budgetPerPersonInr: f.budgetPerPersonInr,
      travelStyle: f.travelStyle,
      stayStyle: f.stayStyle,
      fixedCommitments: commitments.filter(x => x.title.trim()),
      coverEmoji: f.coverEmoji,
      coverImageUrl: f.coverImageUrl.trim() || undefined,
      }, seed)
      // Not saved: the store has already rolled the trip back out of the cache,
      // so there is nothing to route into. The form keeps every input and
      // offers the retry instead.
      if (!persisted) {
        pendingTrip.current = trip
        setSaveError(SAVE_FAILED)
        return
      }
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
        crew: crew.map(c => ({ name: c.name, phone: c.phone })),
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
    setCommitments(list => [...list, { ...c, title: c.title.trim() }])
    setC({ title: '', type: 'hotel-checkin', dayIndex: 0, time: '14:00' })
  }

  // The mockup's step markers answer "is this question done?" - derived from
  // state, never stamped: the soft circle is the goal-gradient, the solid one
  // is still inviting an answer.
  const whereDone = dests.length > 0 && !!f.startLocation.trim()
  const whenDone = !!f.startDate && !!f.endDate
  const whoDone = f.travellers >= CREW_MIN && f.travellers <= CREW_MAX

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
  const dateLabel = f.startDate && f.endDate
    ? `${fmtDay(f.startDate)} – ${fmtDay(f.endDate)} · ${bill.days} day${bill.days !== 1 ? 's' : ''} · ${bill.nights} night${bill.nights !== 1 ? 's' : ''}`
    : 'Pick your dates'

  // ---- Shared fragments ----------------------------------------------------

  return (
    <div className="container form-page trip-starter">
      {createFunnelOn('drafts') && draft && (
        <div className="draft-banner" role="status">
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
        </div>
      )}
      <header className="ts-head">
        <div>
          <p className="eyebrow">Start something</p>
          <h1>Plan a new trip</h1>
          <p className="muted small">Fill the blocks — your ticket assembles itself as you go.</p>
        </div>
      </header>

      {/* ---- Warm start (P1): the front door, full width above the grid ---- */}
      {createFunnelOn('templates') && (
      <section className="tpl-warm" aria-label="Start from a real trip">
        <div className="tpl-warm-head">
          <h2>Start from a real trip</h2>
          <span className="why">or blank - your call</span>
        </div>
<div className="tpl-strip">
              {TRIP_TEMPLATES.map(t => (
                <button type="button" className={`tpl-card${tplId === t.id ? ' on' : ''}`} key={t.id}
                  onClick={() => pickTemplate(t)}
                  aria-pressed={tplId === t.id}>
                  <span className="tpl-cov" style={{ background: t.coverGradient }}>
                    <span className="em" aria-hidden>{t.emoji}</span>
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
                  <small>three questions and a live ticket</small>
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
        <form id="yf-create-form" className="ct-flow" onSubmit={submit} aria-busy={submitting}>
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
          <div className="tpl-nameblock">
            <div className="tpl-warm-head">
              <h2 id="ct-name-h">Name your trip</h2>
              <span className="why">it becomes yours the moment it has a name</span>
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
          <div className={`ct-q${whereDone ? ' done' : ''}`}>
            <span className="ct-n">1</span>
            <div className="ct-q-body">
              <h2>Where are you going?</h2>
              <p className="ct-hint">Start typing - places geocode and order themselves along the road.</p>
              <div className="ct-q-field">
                <Field label="Starting location" error={errs.startLocation}>
                  <LocationInput
                    value={f.startLocation}
                    onChange={v => patchFields({ startLocation: v })}
                    onPick={p => setStartCoords({ lat: p.latitude, lng: p.longitude })}
                    placeholder="Search a city, e.g. Kochi"
                  />
                </Field>
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
                  <Plus size={12} aria-hidden /> Add a stop
                </button>
              </div>
              {errs.destinations && <p className="err-text" id="ct-dest-err" role="status" aria-live="polite">{errs.destinations}</p>}

              <div className="ct-q-field ct-add-stop">
                <LocationInput
                  id="ct-dest-input"
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
                  A day out<small>one round trip - no stay</small>
                </button>
                <button type="button" className="ct-pre" onClick={() => applyDayOutShape(2)}>
                  Weekend dash<small>two days, one night</small>
                </button>
                <button type="button" className="ct-pre" onClick={() => focusAddStop()}>
                  The full route<small>multi-day, stays planned</small>
                </button>
              </div>

              <div className="ct-rrow" style={{ marginTop: 12 }}>
                <label className="ts-switch">
                  <input type="checkbox" role="switch" checked={returnCount > 0}
                    onChange={e => setReturnOn(e.target.checked)} aria-label="Configure custom return journey stops" />
                  <span className="ts-switch-track" aria-hidden="true"></span>
                  <span className="ts-switch-label">Plot the drive back</span>
                </label>
              </div>

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

          {/* ---- 2 - When ---- */}
          <div className={`ct-q${whenDone ? ' done' : ''}`}>
            <span className="ct-n">2</span>
            <div className="ct-q-body">
              <h2>When?</h2>
              <p className="ct-hint">The clock walk and every window on the trip starts here.</p>
              <div className="ct-q-field">
                <DateRangeCalendar
                  start={f.startDate} end={f.endDate}
                  error={errs.startDate || errs.endDate}
                  registerRef={el => { fieldRefs.current.startDate = el; fieldRefs.current.endDate = el }}
                  onChange={({ startDate, endDate }) => patchFields({ startDate, endDate })}
                />
              </div>
              {createFunnelOn('iq') && seasonLine && (
                <p className="hint-text season-note" role="status">{seasonLine}</p>
              )}
            </div>
          </div>

          {/* ---- 3 - Who & how ---- */}
          <div className={`ct-q${whoDone ? ' done' : ''}`}>
            <span className="ct-n">3</span>
            <div className="ct-q-body">
              <h2>Who's coming, and how are you travelling?</h2>
              <p className="ct-hint">Party shape tunes the engine - meal windows, driver rotation, fatigue cadence.</p>
              <div className="ct-q-field">
                <span className="ct-lbl">Transport</span>
                <div className="ct-modes" role="group" aria-label="Transport mode">
                  {MODE_TILES.map(t => {
                    // The local-train switch belongs to the train pill, so the
                    // pill and its switch stay siblings inside one tile.
                    const pill = (
                      <button key={t.mode} type="button" className={`ct-mode${f.transportMode === t.mode ? ' on' : ''}`}
                        aria-pressed={f.transportMode === t.mode}
                        title={t.hint}
                        onClick={() => {
                          haptic(HAPTIC.select)
                          patchFields(t.mode !== 'train' && f.localTrain ? { transportMode: t.mode, localTrain: false } : { transportMode: t.mode })
                        }}>
                        <t.icon size={13} aria-hidden />
                        <span>{t.mode === 'rental' ? 'Car rental' : cap(t.mode)}</span>
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
                  <button type="button" className="ct-mini" onClick={() => setDrawerOpen(true)}>
                    {f.driverCount && f.driverCount > 1 ? `${f.driverCount} drivers` : 'Drivers & pace'}{f.hasVulnerable ? ' · kids aboard' : ''}
                  </button>
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
                    <input className="input mono" type="number" min={CREW_MIN} max={CREW_MAX}
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
                    <span className="why">optional - the invite is ready when the trip is</span>
                  </div>
                  <div className="crew-invite-row">
                    <input className="input" value={crewInput} autoComplete="off"
                      placeholder="Name or mobile, e.g. Ammu 98450 21234"
                      aria-label="Crew member name or mobile number"
                      onChange={e => setCrewInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCrewMember() } }} />
                    <button type="button" className="btn btn-outline btn-sm" onClick={addCrewMember}
                      disabled={crew.length >= crewLimit || !crewInput.trim()}>Add crew member</button>
                  </div>
                  {crew.length > 0 && (
                    <div className="crew-chips">
                      {crew.map((m, i) => (
                        <span className="crew-chip" key={`${m.phone ?? m.name}-${i}`}>
                          {m.name || `+91 ${m.phone}`}
                          {m.name && m.phone ? <small>{m.phone}</small> : null}
                          <button type="button" aria-label={`Remove ${m.name || m.phone}`}
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
              <details className="adv-drawer" open={drawerOpen}
                onToggle={e => setDrawerOpen((e.target as HTMLDetailsElement).open)}>
                <summary>
                  <span className="group-lab">Fuel, vehicle &amp; party details</span>
                  <span className="adv-hint">{f.fuelEconomy || f.fuelPrice || f.tankL || f.rentPerDay || f.driverCount || f.hasVulnerable || f.driveAfterDinnerMin ? 'set' : 'the engine has good defaults'}</span>
                </summary>
                <div className="adv-body">
              {fuelMode && (
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
                      <p className="hint-text"><InlineIcon icon={TriangleAlert} size={12} gap={3} />Unusual for a {f.transportMode === 'rental' ? 'rented car' : f.transportMode} — double-check the value.</p>
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
                      <span title={f.roundTrip && bill.roadKm != null
                        ? `Bills the drive back to ${f.startLocation || 'your start'} (≈ ${Math.round(bill.roadKm / 2)} km each way) on the last day. Turn off for a one-way plan.`
                        : 'On by default for self-drive — it bills the drive back to your start on the last day. Turn off for a one-way plan.'}>
                        <Chip active={f.roundTrip} aria-pressed={f.roundTrip}
                          onClick={() => { haptic(HAPTIC.toggle); patchFields({ roundTrip: !f.roundTrip }) }}>
                          Drive back to start
                        </Chip>
                      </span>
                    </div>
                  </div>
                </div>
              )}
                {/* #142 party inputs — the two dials that move the honest wheel
                    cap. Hidden for conducted modes: nobody drives, nobody
                    fatigues. #213 Phase 5: gated on the ENGINE's own predicate
                    so this and Trip settings agree — it used to list `taxi`
                    (which the engine ignores) and omit `mixed` (which it honours). */}
                {isSelfDrivenMode(f.transportMode) && (
                  <div className="crew-custom" style={{ marginTop: 10 }}>
                    <Field label="Drivers sharing the wheel" hint="2 drivers rotate — honest days get longer.">
                      <div className="crew-row" role="group" aria-label="Drivers sharing the wheel">
                        {[1, 2, 3].map(n => (
                          <button key={n} type="button" className={`crew-btn${(f.driverCount ?? 1) === n ? ' on' : ''}`}
                            aria-pressed={(f.driverCount ?? 1) === n}
                            onClick={() => { haptic(HAPTIC.select); patchFields({ driverCount: n === 1 ? undefined : n }) }}>{n}</button>
                        ))}
                      </div>
                    </Field>
                    <Field label="Pace of the party">
                      <div className="crew-row" role="group" aria-label="Party pace">
                        <button type="button" className={`crew-btn${!f.hasVulnerable ? ' on' : ''}`} aria-pressed={!f.hasVulnerable}
                          onClick={() => { haptic(HAPTIC.select); patchFields({ hasVulnerable: undefined }) }}>Everyone adult</button>
                        <button type="button" className={`crew-btn${f.hasVulnerable ? ' on' : ''}`} aria-pressed={f.hasVulnerable}
                          title="Infants or seniors aboard — shorter days, earlier dinner"
                          onClick={() => { haptic(HAPTIC.select); patchFields({ hasVulnerable: true }) }}>Infants / seniors</button>
                        {/* #122 dhaba case — opt-in post-dinner driving */}
                        <button type="button" className={`crew-btn${f.driveAfterDinnerMin ? ' on' : ''}`} aria-pressed={!!f.driveAfterDinnerMin}
                          title="Dhaba dinner, then keep going — dinner no longer ends the day"
                          onClick={() => { haptic(HAPTIC.select); patchFields({ driveAfterDinnerMin: f.driveAfterDinnerMin ? undefined : 120 }) }}>
                          Drive after dinner
                        </button>
                      </div>
                    </Field>
                  </div>
                )}
                </div>
              </details>
            </div>
          </div>

          {/* ---- Budget: the funnel mockup promotes it out of the refine layer -
               pricing is a decision, so it gets its own question-sized block
               carrying the honest anchor and the experience translation. ---- */}
          <div className="ct-budget">
            <div className="tpl-warm-head">
              <h2>Budget per head</h2>
              <span className="why">anchored honestly - the tool earns trust here</span>
            </div>
            <div className="ct-bud-card">
              <div className="ct-rrow">
                <div className="ct-bud">
                  <input type="range" min={2500} max={60000} step={500}
                    value={Math.min(60000, Math.max(2500, f.budgetPerPersonInr))}
                    aria-label="Budget per person in rupees"
                    onChange={e => { setBudgetTouched(true); patchFields({ budgetPerPersonInr: Number(e.target.value) }) }} />
                  <span className="v">
                    &#8377;{f.budgetPerPersonInr.toLocaleString('en-IN')}
                    <small>group &#8377;{(f.budgetPerPersonInr * f.travellers).toLocaleString('en-IN')}</small>
                  </span>
                </div>
                {/* The exact number still matters - a slider cannot say 13,750. */}
                <label className="ct-bud-exact">
                  exact amount
                  <input className="mono" type="number" min={0} step={500}
                    ref={el => (fieldRefs.current.budgetPerPersonInr = el)}
                    aria-label="Budget per person, exact amount"
                    aria-invalid={!!errs.budgetPerPersonInr}
                    aria-describedby={errs.budgetPerPersonInr ? 'ct-budget-err' : undefined}
                    value={f.budgetPerPersonInr}
                    onChange={e => { setBudgetTouched(true); patchFields({ budgetPerPersonInr: Number(e.target.value) }) }} />
                </label>
                <button type="button" className="ct-mini"
                  onClick={() => { setBudgetTouched(false); if (suggestedBudget != null) patchFields({ budgetPerPersonInr: suggestedBudget }) }}>
                  use our estimate
                </button>
              </div>
              {errs.budgetPerPersonInr && <p className="err-text" id="ct-budget-err" role="status" aria-live="polite">{errs.budgetPerPersonInr}</p>}
              {/* Politely live: the auto-fill above rewrites this number. */}
              <span className="sr-only" role="status">{budgetNotice}</span>
              {/* Mockup order: money in the hand first (the translation), then
                  the anchor against reality. Both flag-gated (P2). */}
              {createFunnelOn('budget') && (<p className="hint-text budget-tier">
                At <b>&#8377;{f.budgetPerPersonInr.toLocaleString('en-IN')}</b> per head: {tier.blurb}.
              </p>)}
              {createFunnelOn('budget') && band && (
                <p className="hint-text budget-anchor" role="status">
                  <i className="bench-mark" aria-hidden>&#9650;</i> A typical {band.days}-day {band.label} run costs <b>&#8377;{band.low.toLocaleString('en-IN')}&ndash;{band.high.toLocaleString('en-IN')}</b> per head
                  {f.budgetPerPersonInr > 0 ? <> - {anchorNote(f.budgetPerPersonInr, band)}</> : null}.
                </p>
              )}
            </div>
          </div>

          {/* ---- Refine: the bed & style ---- */}
          <div className="ct-refine">
            <span className="ct-lbl">Refine the trip</span>

            <div className="ct-rrow">
              <span className="ct-lbl">The bed</span>
              <span className="ct-tier" role="group" aria-label="Bed tier">
                {(['budget', 'comfort', 'luxury'] as const).map(st => (
                  <button key={st} type="button" className={f.stayStyle === st ? 'on' : ''}
                    aria-pressed={f.stayStyle === st}
                    onClick={() => { haptic(HAPTIC.select); patchFields({ stayStyle: st }) }}>{cap(st)}</button>
                ))}
              </span>
              <span className="ct-party-sub">prices the bed - the drive never changes with it</span>
            </div>

            <div>
              <span className="ct-lbl">Travel style &middot; pick one</span>
              <div className="ct-styles" role="group" aria-label="Travel style" style={{ marginTop: 6 }}>
                {TRAVEL_STYLES.map(st => (
                  <button key={st} type="button" className={`ct-style${f.travelStyle === st ? ' on' : ''}`}
                    aria-pressed={f.travelStyle === st}
                    onClick={() => { haptic(HAPTIC.select); patchFields({ travelStyle: st }) }}>{cap(st)}</button>
                ))}
              </div>
              <p className="hint-text style-copy" role="status"><b>{cap(f.travelStyle)}</b> - {STYLE_COPY[f.travelStyle]}</p>
            </div>
          </div>

          {/* ---- cover + pinned: the optional layer ---- */}
          <div className="ct-optional">
            <div className="ct-opt-head">
              <span className="ct-lbl">Trip cover</span>
              <span className="ct-party-sub">optional</span>
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
                      if (!u) toast("Couldn’t find a photo for that destination — paste an image URL instead.", 'err')
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
              <span className="ct-party-sub">optional - trains, weddings, anything with a time</span>
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
                      <div className="warn-fix">Day {x.dayIndex + 1} at {formatHM(x.time, timeFormat)}</div>
                    </div>
                    <button type="button" className="icon-btn" aria-label={`Remove ${x.title}`} onClick={() => setCommitments(l => l.filter((_, j) => j !== i))}><X size={12} aria-hidden /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="form-row commitment-row">
              <Field label="What"><input className="input" value={c.title} onChange={e => setC(x => ({ ...x, title: e.target.value }))} placeholder="e.g. Houseboat boarding" /></Field>
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
              <Field label="Time"><input className="input" type="time" value={c.time} onChange={e => setC(x => ({ ...x, time: e.target.value }))} /></Field>
              <button type="button" className="btn btn-outline" onClick={addCommitment} style={{ height: 42 }}>Add pinned plan</button>
            </div>
          </div>
          </div>
        </form>

        {/* ---- The Trip Ticket (right rail / hidden on mobile) ---- */}
        <aside className="ts-rail" aria-label="Trip ticket preview">
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
                {returnCount > 0 && <span className="tk-return-chip">↔ custom return</span>}
              </p>
              <div className="tk-rows">
                <div className="tk-row"><span className="ic"><Calendar size={12} aria-hidden /></span><b>{dateLabel}</b></div>
                <div className="tk-row"><span className="ic">{modeIcon(f.transportMode, 12)}</span><span className="lab">{f.travellers} traveller{f.travellers !== 1 ? 's' : ''}</span><b>· {cap(f.transportMode)}{f.transportMode === 'train' && f.localTrain ? ' · local' : ''}</b></div>
                {fuelMode && (f.fuelEconomy || f.fuelPrice || f.tankL) && (
                  <div className="tk-row"><span className="ic"><Fuel size={12} aria-hidden /></span><span className="lab">{f.fuelEconomy ? `${f.fuelEconomy} km/L` : null}{f.fuelPrice && f.fuelEconomy ? ' · ' : ''}{f.fuelPrice ? `₹${f.fuelPrice}/L` : null}{f.tankL && f.fuelEconomy ? ` · ${f.tankL} L tank` : ''}</span></div>
                )}
                <div className="tk-row"><span className="ic"><Wallet size={12} aria-hidden /></span><span className="lab">Budget</span><b className="mono">₹{f.budgetPerPersonInr.toLocaleString('en-IN')} / person</b></div>
              </div>
            </div>
            <div className="tear" aria-hidden="true"></div>
            {/* THE BILL ANSWERS AS YOU GO (the mockup's principle 3): the stub
                carries the rough take live - rows appear with their inputs and
                each shows its math, nothing hides behind Print. Printing stays
                as the paper moment below. */}
            <div className="tk-stub tk-bill">
              <div className="bill-row"><span>Transport</span><b className="mono">{bill.transportCost != null ? <Money v={bill.transportCost} animate={!reduced} /> : '\u2014'}</b></div>
              <p className="bill-formula">{bill.transportFormula || 'add a geocoded stop to price the drive'}</p>
              <div className="bill-row"><span>Stay</span><b className="mono"><Money v={bill.stayCost} animate={!reduced} /></b></div>
              <p className="bill-formula">{bill.stayFormula}</p>
              <div className="bill-row"><span>Food</span><b className="mono"><Money v={bill.mealCost} animate={!reduced} /></b></div>
              <p className="bill-formula">{bill.mealFormula}</p>
              <div className="bill-row bill-dim"><span>Entries &amp; tolls</span><b>excluded</b></div>
              {bill.perHead != null && (
                <>
                  <div className="bill-row bill-total"><span>Total</span><b className="mono">{'\u20B9 '}<Money v={Math.round(bill.perHead * f.travellers)} animate={!reduced} /></b></div>
                  <div className="bill-perhead"><span className="mono">{'\u20B9 '}<Money v={bill.perHead} animate={!reduced} /></span><span className="per">/ head</span></div>
                </>
              )}
              <p className="tk-fine">
                {bill.perHead
                  ? 'Rough take - refined once your route resolves in the workspace. Excludes tolls, parking and entry fees.'
                  : 'Add a date range and at least one geocoded stop to price the drive.'}
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
              {submitting ? 'Creating…' : <>Start planning <ArrowRight size={16} aria-hidden /></>}
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
                        <p className="bill-formula">{bill.transportFormula || 'add a geocoded stop to price the drive'}</p>
                        <div className="bill-row"><span>Stay</span><b className="mono"><Money v={bill.stayCost} animate={!reduced} /></b></div>
                        <p className="bill-formula">{bill.stayFormula}</p>
                        <div className="bill-row"><span>Food</span><b className="mono"><Money v={bill.mealCost} animate={!reduced} /></b></div>
                        <p className="bill-formula">{bill.mealFormula}</p>
                        <div className="bill-row bill-total"><span>Total</span><b className="mono">{'\u20B9 '}<Money v={bill.perHead != null ? Math.round(bill.perHead * f.travellers) : null} animate={!reduced} /></b></div>
                        <div className="bill-perhead"><span className="mono">{'\u20B9 '}<Money v={bill.perHead ?? 0} animate={!reduced} /></span><span className="per">/ head</span></div>
                        <p className="bill-note">rough take - refined once your route resolves in the workspace &middot; excludes tolls, parking &amp; entry fees</p>
                      </div>
                    </div>
                  </div>
                </>
              )}
          </div>
        </aside>
      </div>

      {/* ---- Mobile dock (≤900px): the CTA surface ---- */}
      <div className="trip-dock" role="region" aria-label="Trip ticket dock">
        <div className="dock-thumb">{f.coverEmoji}</div>
        <div className="dock-meta">
          <b>{ticketTitle}</b>
          <span>
            {dayCount > 0 ? `${dayCount}d · ${Math.max(0, dayCount - 1)}n · ${f.travellers} travellers` : 'Pick your dates'}
            {billPrinted && bill.perHead != null && <> · <span className="mono dock-amt">{'≈ '}<Money v={bill.perHead} animate={!reduced} />{'/head'}</span></>}
          </span>
          {createFunnelOn('readiness') && <span className="dock-ready">{readinessLine(readiness)}</span>}
        </div>
        {/* Same fix as the rail: the primary is the primary, and printing is a
            peek at the numbers - not a gate in front of creating. */}
        <button type="submit" form="yf-create-form" className="dock-cta" disabled={submitting}>
          {submitting ? 'Creating…' : <>Start planning <ArrowRight size={15} aria-hidden /></>}
        </button>
        <button type="button" className="dock-secondary" onClick={printBill} disabled={!bill.perHead} aria-label="Print the rough bill"><Printer size={15} aria-hidden /></button>
      </div>
    </div>
  )
}
