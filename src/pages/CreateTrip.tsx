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
  Calendar, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Pin, TriangleAlert, X, ArrowRight, Printer,
  Car, Bike, Bus, TrainFront, Plane, KeyRound,
} from 'lucide-react'
import type { FixedCommitment, LatLngPoint, TransportMode, TravelStyle } from '../data/types'
import { TRAVEL_STYLES } from '../data/types'
import { useDb, currentUser, createTrip } from '../store/store'
import { FUEL_PRICE_INR_PER_L, isFuelEconomyMode, parseFuelEconomyKmL, parseFuelPricePerL, isImplausibleFuelEconomy } from '../lib/engine'
import { estimateTripStarter, buildOutlineSeedStops } from '../lib/tripStarter'
import { fetchTripThumbUrl } from '../lib/tripThumb'
import { Field, Chip, toast } from '../components/ui'
import { PillNav } from '../components/PillNav'
import { haptic, HAPTIC } from '../lib/haptics'
import { useTimeFormat, formatHM } from '../lib/timefmt'
import { cap } from '../lib/labels'
import { readBenchPrefill } from '../lib/planBench'
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

const CREW_CHIPS = [1, 2, 3, 4, 5, 6, 8, 10]

/** Mode tiles for the transport grid — taxi/mixed stay available later in
 *  Trip settings; trip start needs only the six honest everyday choices. */
const MODE_TILES: Array<{ mode: TransportMode; icon: typeof Car; hint: string }> = [
  { mode: 'car', icon: Car, hint: 'your fuel · ≈42 km/h' },
  { mode: 'rental', icon: KeyRound, hint: 'self-drive · ₹/day' },
  { mode: 'motorcycle', icon: Bike, hint: 'your fuel · ≈44 km/h' },
  { mode: 'train', icon: TrainFront, hint: '₹1.6/km fare' },
  { mode: 'bus', icon: Bus, hint: '₹2.2/km fare' },
  { mode: 'flight', icon: Plane, hint: '₹6.5/km + fees' },
]

/** Explainer copy — grounded in what the style really tunes later:
 *  halt cadence (cadenceForCrew), daily detour budget (STYLE_DELTA), the bill's
 *  stay tier and the AI planner prompt. Never claim more than the algorithm does. */
const STYLE_COPY: Record<TravelStyle, string> = {
  relaxed: 'slow pace — halts every ~120 km, +15 min of daily detour slack. Stay tier: comfort.',
  packed: 'maximum ground — ~180 km stretches, 15 min less detour slack. Stay tier: comfort.',
  balanced: 'the default rhythm — standard halts, 45 min of daily detour slack. Stay tier: comfort.',
  adventure: 'standard pace — the AI planner packs treks, trails and outdoor stops into suggestions.',
  luxury: 'standard pace — the rough bill prices stays at the luxury tier; the planner follows suit.',
  budget: 'standard pace — the rough bill prices stays at the budget tier; the planner follows suit.',
  family: 'crews of 5+ automatically get the gentler cadence; the planner favours family-friendly stops.',
  spiritual: 'standard pace — the AI planner leans temple circuits, ashrams and early-morning starts.',
  'food-focused': 'standard pace — the AI planner routes suggestions around local food landmarks.',
  creator: 'standard pace — the AI planner favours scenic, content-worthy stops for shoots and reels.',
}

const EMOJIS = ['🧭', '🏔️', '🏖️', '🛕', '🚗', '🚂', '🌴', '🎒']

// ---- Single range calendar (replaces the two raw date inputs) ---------------

const CAL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const CAL_WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** yyyy-mm-dd in local time — toISOString would drift by a day on IST evenings. */
function isoDay(d: Date): string {
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function fmtDay(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${d} ${CAL_MONTHS[m - 1]}`
}

/** One-month grid; first click sets the start, second sets the end (a day
 *  before the current start restarts the selection). Hover previews the range. */
function DateRangeCalendar({ start, end, error, registerRef, onChange }: {
  start: string
  end: string
  error?: string
  registerRef: (el: HTMLButtonElement | null) => void
  onChange: (next: { startDate: string; endDate: string }) => void
}) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const [view, setView] = useState(() => {
    const t = new Date()
    return { y: t.getFullYear(), m: t.getMonth() }
  })
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  function toggle() {
    const anchor = start || end
    if (anchor) {
      const [y, m] = anchor.split('-').map(Number)
      setView({ y, m: m - 1 })
    }
    setOpen(o => !o)
  }

  function pick(day: string) {
    if (!start || end || day < start) onChange({ startDate: day, endDate: '' })
    else onChange({ startDate: start, endDate: day })
  }

  function shiftMonth(delta: number) {
    setView(v => {
      const d = new Date(v.y, v.m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }

  const lead = new Date(view.y, view.m, 1).getDay()
  const lastDate = new Date(view.y, view.m + 1, 0).getDate()
  const today = isoDay(new Date())
  // Second edge is the real end, or the hovered day while choosing one.
  const endPreview = end || (start && hover && hover > start ? hover : '')
  const cells: Array<number | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: lastDate }, (_, i) => i + 1),
  ]
  const label = start && end ? `${fmtDay(start)} – ${fmtDay(end)}` : start ? `${fmtDay(start)} – pick end day` : 'Choose your dates'

  return (
    <Field label="Trip dates" error={error}>
      <div className="cal-wrap" ref={wrapRef}>
        <button type="button" className="input cal-trigger" aria-expanded={open} aria-haspopup="dialog"
          ref={registerRef} onClick={toggle}>
          <Calendar size={14} aria-hidden />
          <span className={start && end ? undefined : 'muted'}>{label}</span>
          <ChevronDown size={14} className="cal-caret" aria-hidden />
        </button>
        {open && (
          <div className="cal-pop" role="dialog" aria-label="Pick trip dates">
            <div className="cal-head">
              <button type="button" className="route-btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}><ChevronLeft size={14} aria-hidden /></button>
              <b>{CAL_MONTHS[view.m]} {view.y}</b>
              <button type="button" className="route-btn" aria-label="Next month" onClick={() => shiftMonth(1)}><ChevronRight size={14} aria-hidden /></button>
            </div>
            <div className="cal-grid">
              {CAL_WEEKDAYS.map((w, i) => <span key={`wd${i}`} className="cal-wd" aria-hidden>{w}</span>)}
              {cells.map((d, i) => {
                if (d == null) return <span key={`pad${i}`} />
                const iso = `${view.y}-${String(view.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
                const edge = iso === start || iso === endPreview
                const cls = `${edge ? ' edge' : endPreview && iso > start && iso < endPreview ? ' in-range' : ''}${iso === today ? ' today' : ''}`
                return (
                  <button key={iso} type="button" className={`cal-day${cls}`} aria-label={iso}
                    onMouseEnter={() => setHover(iso)} onMouseLeave={() => setHover(null)}
                    onClick={() => pick(iso)}>{d}</button>
                )
              })}
            </div>
            <p className="cal-hint">{start && !end ? 'Now pick the last day of the trip.' : 'Tap a start day, then an end day.'}</p>
          </div>
        )}
      </div>
    </Field>
  )
}

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

export function CreateTripPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const timeFormat = useTimeFormat()

  const [f, setF] = useState({
    name: '', startLocation: '',
    startDate: '', endDate: '', travellers: 2,
    transportMode: 'car' as TransportMode,
    localTrain: false,
    fuelEconomy: '',
    fuelPrice: '',
    tankL: '',
    rentPerDay: '',
    roundTrip: true,
    budgetPerPersonInr: 15000,
    travelStyle: 'balanced' as TravelStyle,
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
  /** first-invalid focus targets (F-15) — plain inputs only register here */
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({})

  const fuelMode = isFuelEconomyMode(f.transportMode)

  // Plan Bench hand-off (issue #37): when the homepage calculator stashed its
  // inputs into sessionStorage, pre-fill the matching fields. Read-once — the
  // stash clears itself on read, so a refresh returns to the plain form.
  useEffect(() => {
    const p = readBenchPrefill()
    if (!p) return
    setF(prev => ({
      ...prev,
      travellers: p.travellers,
      transportMode: p.transportMode,
      budgetPerPersonInr: p.budgetPerPersonInr,
      travelStyle: p.travelStyle,
      roundTrip: p.roundTrip,
      ...(isFuelEconomyMode(p.transportMode) && p.kmPerL != null && p.inrPerL != null
        ? { fuelEconomy: String(p.kmPerL), fuelPrice: String(p.inrPerL) }
        : {}),
    }))
  }, [])

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
    travelStyle: f.travelStyle,
  }), [f.startDate, f.endDate, f.travellers, f.transportMode, f.localTrain, f.roundTrip, f.fuelEconomy, f.fuelPrice, f.tankL, f.rentPerDay, f.travelStyle, orderedPoints, returnCount, fuelMode, tankNum, rentNum])

  function patchFields(next: Partial<typeof f>) {
    setF(x => ({ ...x, ...next }))
  }

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
  }

  function navigateWithTransition(route: string) {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } }
    const go = () => onNavigate(route)
    if (doc.startViewTransition) doc.startViewTransition(go)
    else go()
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!me) return
    const next: Record<string, string> = {}
    if (!f.name.trim()) next.name = 'Name your trip.'
    if (!f.startLocation.trim()) next.startLocation = 'Where does the journey start?'
    if (dests.length === 0) next.destinations = 'Add at least one destination.'
    if (!f.startDate) next.startDate = 'Pick a start date.'
    if (!f.endDate) next.endDate = 'Pick an end date.'
    else if (f.startDate && new Date(f.endDate) < new Date(f.startDate)) next.endDate = 'End date must be after the start date.'
    if (f.travellers < 1) next.travellers = 'At least one traveller!'
    else if (f.travellers > 30) next.travellers = 'Split groups over 30 into multiple trips.'
    if (f.budgetPerPersonInr <= 0) next.budgetPerPersonInr = 'Give a per-person budget in ₹.'
    else if (f.budgetPerPersonInr < 500) next.budgetPerPersonInr = 'The minimum budget is ₹500 per person.'
    setErrs(next)
    if (Object.keys(next).length) {
      // F-15: move focus to the first invalid field so keyboard / screen-reader
      // users don't have to hunt for what failed. LocationInput fields don't
      // register a ref — fall back to focusing that field's own error message.
      const first = Object.keys(next).find(k => fieldRefs.current[k])
      if (first) {
        fieldRefs.current[first]!.focus()
      } else {
        const firstErr = document.querySelector<HTMLElement>('.err-text')
        if (firstErr) { firstErr.setAttribute('tabindex', '-1'); firstErr.focus() }
      }
      return
    }

    const seed = buildOutlineSeedStops({ dests, returnCount, dayCount })
    const trip = createTrip(me.id, {
      name: f.name.trim(),
      startLocation: f.startLocation.trim(),
      startLocationCoords: startCoords ?? undefined,
      destinations: dests.map(d => d.name),
      destinationCoords: dests.map(d => (d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : null)),
      startDate: f.startDate, endDate: f.endDate,
      travellers: f.travellers,
      transportMode: f.transportMode,
      fuelEconomyKmL: fuelMode ? parseFuelEconomyKmL(f.fuelEconomy) : undefined,
      fuelPricePerL: fuelMode ? parseFuelPricePerL(f.fuelPrice) : undefined,
      roundTrip: fuelMode ? f.roundTrip : undefined,
      budgetPerPersonInr: f.budgetPerPersonInr,
      travelStyle: f.travelStyle,
      fixedCommitments: commitments.filter(x => x.title.trim()),
      coverEmoji: f.coverEmoji,
      coverImageUrl: f.coverImageUrl.trim() || undefined,
    }, seed)
    haptic(HAPTIC.success)
    toast('Trip created — your rough outline is on the timeline')
    navigateWithTransition(`/trip/${trip.id}`)
  }

  function addCommitment() {
    if (!c.title.trim()) { toast('Name the commitment first (e.g. "Train 12626").', 'err'); return }
    if (!dayCount || c.dayIndex >= dayCount) { toast('Pick a day within the trip dates.', 'err'); return }
    setCommitments(list => [...list, { ...c, title: c.title.trim() }])
    setC({ title: '', type: 'hotel-checkin', dayIndex: 0, time: '14:00' })
  }

  const outbound = dests.slice(0, dests.length - returnCount)
  const returnStops = dests.slice(dests.length - returnCount)
  const showCustomCrew = !CREW_CHIPS.includes(f.travellers)
  const ticketTitle = f.name.trim() || 'Your next trip'
  const dateLabel = f.startDate && f.endDate
    ? `${fmtDay(f.startDate)} – ${fmtDay(f.endDate)} · ${bill.days} day${bill.days !== 1 ? 's' : ''} · ${bill.nights} night${bill.nights !== 1 ? 's' : ''}`
    : 'Pick your dates'

  // ---- Shared fragments ----------------------------------------------------

  function RouteLeg({ stops, offset, returnLeg }: { stops: DestDraft[]; offset: number; returnLeg?: boolean }) {
    return (
      <div className={returnLeg ? 'route-line route-line--return' : 'route-line'}>
        {stops.map((d, i) => {
          const gi = offset + i
          const first = i === 0
          const lastInLeg = i === stops.length - 1
          return (
            <div key={`${d.name}-${gi}`} className="route-row">
              <span className="route-dot">{returnLeg ? i + 1 : offset + i + 1}</span>
              <span className="route-name">{d.name}</span>
              <span className="route-acts">
                <button type="button" className="route-btn" aria-label={`Move ${d.name} earlier`}
                  disabled={first} style={{ opacity: first ? .25 : undefined }}
                  onClick={() => { haptic(HAPTIC.tick); moveDest(gi, -1) }}><ChevronUp size={13} aria-hidden /></button>
                <button type="button" className="route-btn" aria-label={`Move ${d.name} later`}
                  disabled={lastInLeg} style={{ opacity: lastInLeg ? .25 : undefined }}
                  onClick={() => { haptic(HAPTIC.tick); moveDest(gi, 1) }}><ChevronDown size={13} aria-hidden /></button>
                <button type="button" className="route-btn" aria-label={`Remove ${d.name}`}
                  onClick={() => { haptic(HAPTIC.tick); removeDest(gi) }}><X size={13} aria-hidden /></button>
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="container form-page trip-starter">
      <header className="ts-head">
        <div>
          <p className="eyebrow">Start something</p>
          <h1>Plan a new trip</h1>
          <p className="muted small">Fill the blocks — your ticket assembles itself as you go.</p>
        </div>
      </header>

      <div className="ts-layout">
        <form id="yf-create-form" className="ts-blocks" onSubmit={submit}>

          {/* ---- Route (7) ---- */}
          <section className="ts-block span7">
            <div className="ts-block-head">
              <span className="eyebrow">Route</span>
              <span className="ts-block-value">
                {dests.length > 0 && <>{dests.length} stop{dests.length !== 1 ? 's' : ''}{bill.roadKm != null ? ` · ≈ ${bill.roadKm} km` : ''}</>}
              </span>
              <label className="ts-switch">
                <input type="checkbox" role="switch" checked={returnCount > 0}
                  onChange={e => setReturnOn(e.target.checked)} aria-label="Configure custom return journey stops" />
                <span className="ts-switch-track" aria-hidden="true"></span>
                <span className="ts-switch-label">↔ Return stops</span>
              </label>
            </div>
            <Field label="Trip name" error={errs.name}>
              <input className="input" autoComplete="off" ref={el => (fieldRefs.current.name = el)} aria-invalid={!!errs.name}
                value={f.name} onChange={e => patchFields({ name: e.target.value })} placeholder="e.g. Kerala monsoon escape" />
            </Field>
            <Field label="Starting location" error={errs.startLocation}>
              <LocationInput
                value={f.startLocation}
                onChange={v => patchFields({ startLocation: v })}
                onPick={p => setStartCoords({ lat: p.latitude, lng: p.longitude })}
                placeholder="Search a city, e.g. Kochi"
              />
            </Field>
            <div className="route-line">
              <div className="route-row route-row--start">
                <span className="route-dot">★</span>
                <span className="route-name">{f.startLocation.trim() || 'Start of the journey'}</span>
                <span className="route-tag">start</span>
              </div>
            </div>
            <RouteLeg stops={outbound} offset={0} />
            {errs.destinations && <p className="err-text" role="alert">{errs.destinations}</p>}
            <LocationInput
              value={destInput}
              onChange={setDestInput}
              onPick={p => addDest({ name: p.name + (p.admin1 ? `, ${p.admin1}` : ''), lat: p.latitude, lng: p.longitude }, false)}
              placeholder={dests.length === 0 ? 'Search your first stop, e.g. Munnar' : 'Add another destination…'}
            />

            {returnCount > 0 && (
              <div className="return-section" aria-label="Return journey stops">
                <div className="return-head">
                  <span className="eyebrow">Return</span>
                  <span className="return-note">auto-filled with the reverse route — edit freely</span>
                </div>
                <RouteLeg stops={returnStops} offset={outbound.length} returnLeg />
                <LocationInput
                  value={returnInput}
                  onChange={setReturnInput}
                  onPick={p => addDest({ name: p.name + (p.admin1 ? `, ${p.admin1}` : ''), lat: p.latitude, lng: p.longitude }, true)}
                  placeholder="Add a return stop…  e.g. Guruvayur"
                />
              </div>
            )}
          </section>

          {/* ---- Dates (5) ---- */}
          <section className="ts-block span5">
            <div className="ts-block-head">
              <span className="eyebrow">Dates</span>
            </div>
            <DateRangeCalendar
              start={f.startDate} end={f.endDate}
              error={errs.startDate || errs.endDate}
              registerRef={el => { fieldRefs.current.startDate = el; fieldRefs.current.endDate = el }}
              onChange={({ startDate, endDate }) => patchFields({ startDate, endDate })}
            />
            {dayCount > 0 && (
              <span className="pill"><Calendar size={12} aria-hidden /> {dayCount} day{dayCount !== 1 ? 's' : ''} · {Math.max(0, dayCount - 1)} night{dayCount - 1 !== 1 ? 's' : ''}</span>
            )}
          </section>

          {/* ---- Crew & transport (12) ---- */}
          <section className="ts-block span12">
            <div className="ts-block-head">
              <span className="eyebrow">Crew &amp; transport</span>
              <span className="ts-block-value">{f.travellers} traveller{f.travellers !== 1 ? 's' : ''} · {cap(f.transportMode)}</span>
            </div>
            <div className="ct-grid">
              <div>
                <span className="group-lab">Transport mode</span>
                <div className="mode-grid" role="group" aria-label="Transport mode">
                  {MODE_TILES.map(t => {
                    const tile = (
                      <button type="button" className={`mode-btn${f.transportMode === t.mode ? ' on' : ''}`}
                        aria-pressed={f.transportMode === t.mode}
                        onClick={() => {
                          haptic(HAPTIC.select)
                          patchFields(t.mode !== 'train' && f.localTrain ? { transportMode: t.mode, localTrain: false } : { transportMode: t.mode })
                        }}>
                        <t.icon size={17} aria-hidden />
                        <span><span className="nm">{t.mode === 'rental' ? 'Car rental' : cap(t.mode)}</span><span className="hint">{t.mode === 'train' && f.localTrain ? 'local · ₹0.45/km' : t.hint}</span></span>
                      </button>
                    )
                    // The local-train toggle lives inside the train tile — a
                    // sibling of the select button so both stay real controls.
                    if (t.mode !== 'train') return tile
                    return (
                      <div key="train" className="mode-tile">
                        {tile}
                        {f.transportMode === 'train' && (
                          <label className="ts-switch mode-local-switch">
                            <input type="checkbox" role="switch" checked={f.localTrain}
                              onChange={e => { haptic(HAPTIC.toggle); patchFields({ localTrain: e.target.checked }) }}
                              aria-label="Local / suburban train fares (much cheaper)" />
                            <span className="ts-switch-track" aria-hidden="true"></span>
                            <span className="ts-switch-label">Local</span>
                          </label>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
              {fuelMode && (
                <div>
                  <span className="group-lab">Fuel &amp; vehicle</span>
                  <div className="fuel-stack">
                    <label className="mini-field">
                      <span className="mini-lab">Mileage</span>
                      <span className="unit-input">
                        <input className="input mono" type="number" inputMode="decimal" min={2} max={80} step={0.1}
                          value={f.fuelEconomy} onChange={e => patchFields({ fuelEconomy: e.target.value })} placeholder="e.g. 15" aria-label="Mileage in kilometres per litre" />
                        <span className="unit">km/L</span>
                      </span>
                    </label>
                    {isImplausibleFuelEconomy(f.transportMode, parseFuelEconomyKmL(f.fuelEconomy)) && (
                      <p className="hint-text"><TriangleAlert size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />Unusual for a {f.transportMode === 'rental' ? 'rented car' : f.transportMode} — double-check the value.</p>
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
                      <Chip active={f.roundTrip} aria-pressed={f.roundTrip}
                        onClick={() => { haptic(HAPTIC.toggle); patchFields({ roundTrip: !f.roundTrip }) }}>
                        Round trip — return to start
                      </Chip>
                    </div>
                  </div>
                </div>
              )}
              <div>
                <span className="group-lab">Crew size</span>
                <div className="crew-row" role="group" aria-label="Crew size">
                  {CREW_CHIPS.map(n => (
                    <button key={n} type="button" className={`crew-btn${f.travellers === n ? ' on' : ''}`}
                      aria-pressed={f.travellers === n}
                      onClick={() => { haptic(HAPTIC.select); patchFields({ travellers: n }) }}>{n}</button>
                  ))}
                  <button type="button" className={`crew-btn crew-btn--custom${showCustomCrew ? ' on' : ''}`}
                    aria-pressed={showCustomCrew}
                    onClick={() => { haptic(HAPTIC.select); patchFields({ travellers: showCustomCrew ? 2 : 9 }) }}>Custom…</button>
                </div>
                {showCustomCrew && (
                  <div className="crew-custom">
                    <Field label="Travellers" error={errs.travellers}>
                      <input className="input mono" type="number" min={1} max={30} ref={el => (fieldRefs.current.travellers = el)}
                        aria-invalid={!!errs.travellers} value={f.travellers}
                        onChange={e => patchFields({ travellers: Number(e.target.value) })} />
                    </Field>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ---- Budget & style (7) ---- */}
          <section className="ts-block span7">
            <div className="ts-block-head">
              <span className="eyebrow">Budget &amp; style</span>
            </div>
            <div className="form-row">
              <Field label="Budget per person (₹)" error={errs.budgetPerPersonInr}>
                <input className="input mono" type="number" min={500} step={500} ref={el => (fieldRefs.current.budgetPerPersonInr = el)}
                  aria-invalid={!!errs.budgetPerPersonInr} value={f.budgetPerPersonInr}
                  onChange={e => patchFields({ budgetPerPersonInr: Number(e.target.value) })} />
              </Field>
              <div className="quick-budget" role="group" aria-label="Quick budget amounts">
                {[10000, 15000, 25000].map(v => (
                  <button key={v} type="button" className={`chip${f.budgetPerPersonInr === v ? ' on' : ''}`}
                    aria-pressed={f.budgetPerPersonInr === v}
                    onClick={() => { haptic(HAPTIC.tick); patchFields({ budgetPerPersonInr: v }) }}>
                    ₹{v >= 1000 ? `${Math.round(v / 1000)}k` : v}
                  </button>
                ))}
              </div>
            </div>
            <span className="group-lab">Travel style</span>
            <PillNav className="tabbar style-carousel" role="group" aria-label="Travel style" activeKey={f.travelStyle}>
              {TRAVEL_STYLES.map(s => (
                <button key={s} type="button" data-pill-key={s} className={`tab-btn${f.travelStyle === s ? ' active' : ''}`}
                  aria-pressed={f.travelStyle === s}
                  onClick={() => { haptic(HAPTIC.select); patchFields({ travelStyle: s }) }}>{cap(s)}</button>
              ))}
            </PillNav>
            <p className="hint-text style-copy" role="status"><b>{cap(f.travelStyle)}</b> — {STYLE_COPY[f.travelStyle]}</p>
          </section>

          {/* ---- Trip cover (5) ---- */}
          <section className="ts-block span5">
            <div className="ts-block-head">
              <span className="eyebrow">Trip cover</span>
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
                      if (!u) toast("Couldn't find a photo for that destination — paste an image URL instead.", 'err')
                    } finally { setBusyCover(false) }
                  }}>
                  {busyCover ? 'Finding photo…' : f.coverImageUrl ? 'Refresh destination photo' : 'Use destination photo'}
                </button>
                <div className="cover-picker-custom">
                  <input className="input" placeholder="Paste an image URL…" value={f.coverImageUrl}
                    onChange={e => patchFields({ coverImageUrl: e.target.value })} />
                </div>
              </div>
            </Field>
          </section>

          {/* ---- Pinned plans (12) ---- */}
          <section className="ts-block span12">
            <div className="ts-block-head">
              <span className="eyebrow">Pinned plans <span className="muted" style={{ fontWeight: 500 }}>(optional)</span></span>
            </div>
            <p className="hint-text" style={{ margin: '0 0 10px' }}>
              Hotel check-ins, train or flight departures, events. The planner protects these when it warns about tight schedules.
            </p>
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
                <select className="select" value={c.type} onChange={e => setC(x => ({ ...x, type: e.target.value as FixedCommitment['type'] }))}>
                  <option value="hotel-checkin">Hotel check-in</option>
                  <option value="train-departure">Train departure</option>
                  <option value="flight-departure">Flight departure</option>
                  <option value="event">Event</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Day">
                <select className="select" value={c.dayIndex} disabled={!dayCount}
                  onChange={e => setC(x => ({ ...x, dayIndex: Number(e.target.value) }))}>
                  {Array.from({ length: Math.max(1, dayCount) }, (_, i) => <option key={i} value={i}>Day {i + 1}</option>)}
                </select>
              </Field>
              <Field label="Time"><input className="input" type="time" value={c.time} onChange={e => setC(x => ({ ...x, time: e.target.value }))} /></Field>
              <button type="button" className="btn btn-outline" onClick={addCommitment} style={{ height: 42 }}>Add</button>
            </div>
          </section>
        </form>

        {/* ---- The Trip Ticket (right rail / hidden on mobile) ---- */}
        <aside className="ts-rail" aria-label="Trip ticket preview">
          <div className="ticket">
            <div className="tk-head">
              <span className="tk-brand">Yatraflow</span>
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
              <p className="tk-route">
                {f.startLocation.trim() || 'Start'} → {outbound.length ? outbound.map(d => d.name.split(',')[0]).join(' → ') : '…'}
                {returnCount > 0 && <span className="tk-return-chip">↔ custom return</span>}
              </p>
              <div className="tk-rows">
                <div className="tk-row"><span className="ic"><Calendar size={12} aria-hidden /></span><b>{dateLabel}</b></div>
                <div className="tk-row"><span className="ic"><Car size={12} aria-hidden /></span><span className="lab">{f.travellers} traveller{f.travellers !== 1 ? 's' : ''}</span><b>· {cap(f.transportMode)}{f.transportMode === 'train' && f.localTrain ? ' · local' : ''}</b></div>
                {fuelMode && (f.fuelEconomy || f.fuelPrice || f.tankL) && (
                  <div className="tk-row"><span className="ic">⛽</span><span className="lab">{f.fuelEconomy ? `${f.fuelEconomy} km/L` : null}{f.fuelPrice && f.fuelEconomy ? ' · ' : ''}{f.fuelPrice ? `₹${f.fuelPrice}/L` : null}{f.tankL && f.fuelEconomy ? ` · ${f.tankL} L tank` : ''}</span></div>
                )}
                <div className="tk-row"><span className="ic">👛</span><span className="lab">Budget</span><b className="mono">₹{f.budgetPerPersonInr.toLocaleString('en-IN')} / person</b></div>
              </div>
            </div>
            <div className="tear" aria-hidden="true"></div>
            <div className="tk-stub">
              {!billPrinted ? (
                <>
                  <button type="button" className="tk-print-btn" onClick={printBill}>
                    <Printer size={16} aria-hidden /> Print my bill
                  </button>
                  <p className="tk-fine">
                    {bill.perHead
                      ? 'The rough take stays hidden until you print it.'
                      : 'Add a date range and at least one geocoded stop to price the trip.'}
                  </p>
                  <button type="button" className="tk-cancel" onClick={() => onNavigate('/trips')}>Cancel</button>
                </>
              ) : (
                <>
                  <div className="bill-printer" role="region" aria-label="Rough trip bill">
                    <div className="bill-slot" aria-hidden="true"><span></span></div>
                    <div className="bill-reveal">
                      <div className="bill-paper bill-paper-sway">
                        <p className="bill-brand">YATRAFLOW · ROUGH BILL</p>
                        <div className="bill-row"><span>Road (est.)</span><b className="mono">{bill.roadKm != null ? `≈ ${bill.roadKm} km` : '—'}</b></div>
                        <div className="bill-row"><span>Transport</span><b className="mono">{bill.transportCost != null ? `₹${bill.transportCost.toLocaleString('en-IN')}` : '—'}</b></div>
                        <p className="bill-formula">{bill.transportFormula || 'add a geocoded stop to price the drive'}</p>
                        <div className="bill-row"><span>Stay</span><b className="mono">₹{bill.stayCost.toLocaleString('en-IN')}</b></div>
                        <p className="bill-formula">{bill.stayFormula}</p>
                        <div className="bill-row"><span>Food</span><b className="mono">₹{bill.mealCost.toLocaleString('en-IN')}</b></div>
                        <p className="bill-formula">{bill.mealFormula}</p>
                        <div className="bill-row bill-total"><span>Total</span><b className="mono">{bill.perHead != null ? `≈ ₹${Math.round(bill.perHead * f.travellers).toLocaleString('en-IN')}` : '—'}</b></div>
                        <div className="bill-perhead"><span className="mono">≈ ₹{(bill.perHead ?? 0).toLocaleString('en-IN')}</span><span className="per">/ head</span></div>
                        <p className="bill-note">rough take — refined once your route resolves in the workspace · excludes tolls, parking &amp; entry fees</p>
                      </div>
                    </div>
                  </div>
                  <button type="submit" form="yf-create-form" className="tk-cta">
                    Create trip <ArrowRight size={16} aria-hidden />
                  </button>
                  <div className="tk-subrow">
                    <button type="button" className="tk-cancel" aria-label="Discard the printed bill and edit the trip details"
                      onClick={() => { haptic(HAPTIC.toggle); setBillPrinted(false) }}>Discard bill</button>
                    <button type="button" className="tk-cancel" onClick={() => onNavigate('/trips')}>Cancel</button>
                  </div>
                </>
              )}
            </div>
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
            {billPrinted && bill.perHead != null && <> · <span className="mono dock-amt">≈ ₹{bill.perHead.toLocaleString('en-IN')}/head</span></>}
          </span>
        </div>
        {!billPrinted ? (
          <button type="button" className="dock-cta" onClick={printBill}><Printer size={15} aria-hidden /> Print bill</button>
        ) : (
          <button type="submit" form="yf-create-form" className="dock-cta">Create trip <ArrowRight size={15} aria-hidden /></button>
        )}
      </div>
    </div>
  )
}
