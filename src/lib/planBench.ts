// ============ Plan Bench — homepage what-if cost calculator ============
// Pure math behind the Landing page's interactive "honest bill" (issue #37).
// Transport mirrors the workspace engine's assumption tables (MODE_SPEED /
// MODE_COST_PER_KM / FUEL_PRICE_INR_PER_L) so the bench tells the same story
// as a real trip. Stay and meal rates are bench-local assumptions and every
// bill line renders its own formula — the transparency promise is the feature.

import { FUEL_PRICE_INR_PER_L, DEFAULT_FUEL_ECONOMY_KML, MODE_SPEED, MODE_COST_PER_KM, isFuelEconomyMode, formatInr } from './engine'
import { STAY_RATE_PER_NIGHT } from './rates'
import { STAY_STYLES, type StayStyle, type TravelStyle } from '../data/types'

/** Modes the bench offers ('motorcycle' is the engine's name for a bike). */
export const BENCH_MODES = ['car', 'motorcycle', 'bus', 'train'] as const
export type BenchMode = (typeof BENCH_MODES)[number]

/** The stay tier is the app-wide vocabulary (src/data/types.ts) — re-exported
 *  here because the bench's public API is where its consumers meet it. */
export { STAY_STYLES }

/** Stay style → trip travel style, applied when the bench hands off to trip creation. */
export const STAY_TO_TRAVEL_STYLE: Record<StayStyle, TravelStyle> = {
  budget: 'budget',
  comfort: 'balanced',
  luxury: 'luxury',
}

/** Bench lodging assumption: ₹ per room per night, two guests per room.
 *  Re-exported from rates.ts so the trip engine bills off the SAME table
 *  (#125b) — the bench's number and the trip's bill can never drift again. */
export { STAY_RATE_PER_NIGHT }
/** Bench-local food assumption: ₹ per head per day. */
export const MEALS_PER_HEAD_DAY = 600

/** Slider/control bounds (also the clamps applied by the math below). */
export const BENCH_LIMITS = {
  km: [100, 900] as const,
  nights: [1, 7] as const,
  crew: [1, 8] as const,
  kmPerL: [2, 80] as const,   // mirrors parseFuelEconomyKmL's hard band
  inrPerL: [50, 250] as const, // mirrors parseFuelPricePerL's hard band
}

/** True when the mode is priced through its own fuel economy (vs a blended fare).
 *  Delegates to the engine's classifier so the two can never drift apart. */
export function isBenchFuelMode(mode: BenchMode): boolean {
  return isFuelEconomyMode(mode)
}

export interface BenchInputs {
  km: number
  mode: BenchMode
  nights: number
  crew: number
  roundTrip: boolean
  kmPerL: number
  inrPerL: number
  stay: StayStyle
}

export interface BenchBill {
  roadKm: number
  transportCost: number
  transportFormula: string
  rooms: number
  stayCost: number
  stayFormula: string
  mealCost: number
  mealFormula: string
  perHead: number
  total: number
  wheelHours: number
  days: number
  hoursPerDay: number
  fatigue: { verdict: string; tone: 'calm' | 'warn' | 'hot' }
}

function clamp(n: number, [lo, hi]: readonly [number, number]): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo))
}

/** The whole bill in one pure pass — clamps every input, derives every line
 *  and the formula string that explains it. */
export function computeBenchBill(input: BenchInputs): BenchBill {
  const km = clamp(input.km, BENCH_LIMITS.km)
  const nights = Math.round(clamp(input.nights, BENCH_LIMITS.nights))
  const crew = Math.round(clamp(input.crew, BENCH_LIMITS.crew))
  const kmPerL = clamp(input.kmPerL, BENCH_LIMITS.kmPerL)
  const inrPerL = clamp(input.inrPerL, BENCH_LIMITS.inrPerL)
  const roadKm = input.roundTrip ? km * 2 : km
  const days = nights + 1

  // Transport: self-drive burns litres (km ÷ economy × pump price); bus/train
  // ride the blended fare table — the same split the engine draws. Fuel modes
  // round through the engine's 2-dp ₹/km path so a bench bill and a real trip
  // agree to the rupee on identical inputs.
  let transportCost: number
  let transportFormula: string
  if (isBenchFuelMode(input.mode)) {
    const inrPerKm = Math.round((inrPerL / kmPerL) * 100) / 100
    transportCost = Math.round(roadKm * inrPerKm)
    transportFormula = `${roadKm} km ÷ ${kmPerL} km/L × ₹${inrPerL}`
  } else {
    const rate = MODE_COST_PER_KM[input.mode]
    transportCost = Math.round(roadKm * rate)
    transportFormula = `${roadKm} km × ₹${rate}/km fare`
  }

  const rooms = Math.ceil(crew / 2)
  const stayRate = STAY_RATE_PER_NIGHT[input.stay]
  const stayCost = nights * rooms * stayRate
  const stayFormula = `${nights} night${nights === 1 ? '' : 's'} × ${rooms} room${rooms === 1 ? '' : 's'} × ₹${stayRate}`

  const mealCost = days * crew * MEALS_PER_HEAD_DAY
  const mealFormula = `${days} day${days === 1 ? '' : 's'} × ${crew} head${crew === 1 ? '' : 's'} × ₹${MEALS_PER_HEAD_DAY}`

  const total = transportCost + stayCost + mealCost
  const perHead = Math.round(total / crew)

  const wheelHours = roadKm / (MODE_SPEED[input.mode] ?? 40)
  const hoursPerDay = wheelHours / days
  // Verdict copy is mode-aware: "split it or take the train" makes no sense
  // to someone already on one — passenger modes get ride-framing instead.
  const passenger = input.mode === 'bus' || input.mode === 'train'
  const fatigue =
    hoursPerDay <= 4
      ? { verdict: passenger ? 'Easy riding — sit back and enjoy' : 'Easy going — time for detours', tone: 'calm' as const }
      : hoursPerDay <= 7
        ? { verdict: passenger ? 'Long ride — carry snacks and a playlist' : 'Full driving days — pace yourself', tone: 'warn' as const }
        : { verdict: passenger ? 'Marathon ride — book a sleeper or break the journey' : 'Long haul — split it or take the train', tone: 'hot' as const }

  return {
    roadKm, transportCost, transportFormula, rooms, stayCost, stayFormula,
    mealCost, mealFormula, perHead, total, wheelHours, days, hoursPerDay, fatigue,
  }
}

/** One-tap route presets (issue #37's table). `roundTrip` states whether the
 *  km figure is one leg of an out-and-back (true) or an already-complete
 *  circuit (false) — the loops here return to their start, so doubling their
 *  distance would bill the same road twice. */
export const BENCH_PRESETS: Array<{ label: string; km: number; mode: BenchMode; nights: number; crew: number; roundTrip: boolean }> = [
  { label: 'Kerala loop', km: 612, mode: 'car', nights: 4, crew: 4, roundTrip: false },
  { label: 'Golden Triangle', km: 780, mode: 'car', nights: 5, crew: 6, roundTrip: false },
  { label: 'Goa coast', km: 330, mode: 'motorcycle', nights: 3, crew: 2, roundTrip: true },
  { label: 'Himalayan loop', km: 470, mode: 'car', nights: 4, crew: 3, roundTrip: false },
]

export const BENCH_DEFAULTS: BenchInputs = {
  km: 612, mode: 'car', nights: 4, crew: 4, roundTrip: true,
  kmPerL: DEFAULT_FUEL_ECONOMY_KML, inrPerL: FUEL_PRICE_INR_PER_L, stay: 'comfort',
}

// ---------------- Hand-off to trip creation ----------------
// The bench is stateless by design; the only thing that crosses into the app
// is this one-shot sessionStorage stash that CreateTrip reads (and clears)
// exactly once on mount to pre-fill travellers / mode / budget / fuel fields.

export interface BenchPrefill {
  travellers: number
  transportMode: BenchMode
  budgetPerPersonInr: number
  travelStyle: TravelStyle
  /** The bench's stay tier, carried into the trip's own dial. Without this the
   *  hand-off set `travelStyle` and left `stayStyle` at its 'comfort' default,
   *  so a Luxury bench run (₹8,000/room) created a trip that billed ₹3,200. */
  stayStyle?: StayStyle
  roundTrip: boolean
  kmPerL?: number
  inrPerL?: number
}

export const BENCH_PREFILL_KEY = 'yatraflow_bench_prefill'

/** Pure parser — same contract as uiPrefs: assert on this in node-env tests;
 *  the storage wrappers below just degrade to no-ops when storage is missing. */
export function parseBenchPrefill(raw: string | null | undefined): BenchPrefill | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<BenchPrefill>
    if (
      !Number.isFinite(p.travellers) || !p.transportMode || !BENCH_MODES.includes(p.transportMode as BenchMode) ||
      !Number.isFinite(p.budgetPerPersonInr) || !p.travelStyle
    ) return null
    // stayStyle is optional in the stash (older sessions predate it) but must
    // be a known tier when present — a stray value would index
    // STAY_RATE_PER_NIGHT to undefined downstream.
    if (p.stayStyle != null && !(STAY_STYLES as readonly string[]).includes(p.stayStyle)) return null
    return p as BenchPrefill
  } catch { return null }
}

export function stashBenchPrefill(bill: BenchBill, input: BenchInputs): void {
  const prefill: BenchPrefill = {
    travellers: input.crew,
    transportMode: input.mode,
    budgetPerPersonInr: bill.perHead,
    travelStyle: STAY_TO_TRAVEL_STYLE[input.stay],
    // The tier itself, so the created trip prices the bed at the rate the
    // bench just showed (travelStyle alone no longer prices anything).
    stayStyle: input.stay,
    roundTrip: input.roundTrip,
    ...(isBenchFuelMode(input.mode) ? { kmPerL: input.kmPerL, inrPerL: input.inrPerL } : {}),
  }
  try { sessionStorage.setItem(BENCH_PREFILL_KEY, JSON.stringify(prefill)) } catch { /* private mode etc. */ }
}

/** Read-and-clear the bench hand-off. Returns null when absent or unusable —
 *  a corrupt stash must never block the plain form. */
export function readBenchPrefill(): BenchPrefill | null {
  try {
    const raw = sessionStorage.getItem(BENCH_PREFILL_KEY)
    if (!raw) return null
    sessionStorage.removeItem(BENCH_PREFILL_KEY)
    return parseBenchPrefill(raw)
  } catch { return null }
}

// ---------------- Input persistence (returning visitors resume) ----------------
// Same view-prefs pattern as lib/uiPrefs: a localStorage map, parse-guarded,
// never trip data. A corrupt stash degrades to the defaults, never a crash.

export const BENCH_INPUTS_KEY = 'yatraflow_bench_inputs'

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Pure parser for the persisted inputs — assert on this in node-env tests. */
export function parseBenchInputs(raw: string | null | undefined): BenchInputs | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<BenchInputs>
    if (
      !isFiniteNum(p.km) || !isFiniteNum(p.nights) || !isFiniteNum(p.crew) ||
      !isFiniteNum(p.kmPerL) || !isFiniteNum(p.inrPerL) ||
      typeof p.roundTrip !== 'boolean' ||
      !p.mode || !BENCH_MODES.includes(p.mode as BenchMode) ||
      !p.stay || !STAY_STYLES.includes(p.stay as StayStyle)
    ) return null
    return {
      km: p.km, nights: p.nights, crew: p.crew, kmPerL: p.kmPerL, inrPerL: p.inrPerL,
      mode: p.mode as BenchMode, stay: p.stay as StayStyle, roundTrip: p.roundTrip,
    }
  } catch { return null }
}

export function loadBenchInputs(): BenchInputs | null {
  try {
    const raw = localStorage.getItem(BENCH_INPUTS_KEY)
    return raw ? parseBenchInputs(raw) : null
  } catch { return null }
}

export function saveBenchInputs(input: BenchInputs): void {
  try { localStorage.setItem(BENCH_INPUTS_KEY, JSON.stringify(input)) } catch { /* private mode etc. */ }
}

export function benchInputsEqual(a: BenchInputs, b: BenchInputs): boolean {
  return a.km === b.km && a.mode === b.mode && a.nights === b.nights && a.crew === b.crew &&
    a.roundTrip === b.roundTrip && a.kmPerL === b.kmPerL && a.inrPerL === b.inrPerL && a.stay === b.stay
}

// ---------------- Share text ----------------

/** Clipboard-friendly plain-text receipt — the transparency promise, portable.
 *  (formatInr already renders the ₹ sign.) */
export function formatBenchShareText(bill: BenchBill, input: BenchInputs): string {
  const rideWord = input.mode === 'bus' || input.mode === 'train' ? 'on the move' : 'driving'
  return [
    'YatraFlow — trip cost estimate',
    `${bill.roadKm} km road · ${bill.days} days · ${input.crew} traveller${input.crew === 1 ? '' : 's'} · ${input.mode}${input.roundTrip ? ' (return)' : ''}`,
    '',
    `Transport  ${formatInr(bill.transportCost)} — ${bill.transportFormula}`,
    `Stay  ${formatInr(bill.stayCost)} — ${bill.stayFormula}`,
    `Food  ${formatInr(bill.mealCost)} — ${bill.mealFormula}`,
    '',
    `Total ${formatInr(bill.total)} · ${formatInr(bill.perHead)} per person`,
    `${bill.fatigue.verdict} (~${Math.round(bill.wheelHours)}h ${rideWord}, ~${bill.hoursPerDay.toFixed(1)}h/day)`,
    '',
    'Excludes tolls, parking and entry fees. Price your own trip on the Plan Bench → https://www.yatraflow.in/',
  ].join('\n')
}
