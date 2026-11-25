// ============ Trip-cost calculator → trip-creation hand-off ============
// The static destination calculators (public/<slug>/calculator/) price a trip
// on their own page and then send the visitor into the app with one link:
//
//   /new?ref=calculator&calc=goa&dest=Goa&days=4&people=4&mode=train&stay=comfort&budget=18400
//
// That query is the whole contract. A signed-out visitor is diverted to
// sign-up first (App.tsx's CalcPrefillGate), so the query cannot survive the
// trip through the auth page — this module turns it into one pending row in
// sessionStorage, which Auth reads for its banner and CreateTrip reads to
// pre-fill the form. Same shape and the same degradation rules as the Plan
// Bench hand-off in lib/planBench.ts: a pure parser the node-env tests assert
// on, guarded storage wrappers, and no invented value ever.
//
// Read-and-NOT-clear on purpose: Auth reads the row first (for the banner) and
// CreateTrip reads it again (for the form). Clearing on the first read would
// break the second, so the 30-minute TTL is what retires it.

import { STAY_STYLES, TRANSPORT_MODES, type StayStyle, type TransportMode } from '../data/types'
import { CREW_MAX } from './crew'

export const CALC_PREFILL_KEY = 'yf.pending-calc-prefill'
export const CALC_PREFILL_TTL_MS = 30 * 60 * 1000

/** Clock skew allowed before a row stamped in the future counts as unusable.
 *  A phone a minute fast must still open its own estimate. */
const CALC_PREFILL_SKEW_MS = 60 * 1000

/** The destination slugs the calculators publish. A slug outside this set is
 *  dropped: the row never reaches a page that does not exist. */
export const CALC_PREFILL_SLUGS = ['ladakh', 'goa', 'rajasthan', 'meghalaya'] as const
export type CalcSlug = (typeof CALC_PREFILL_SLUGS)[number]

/** The most people one calculator estimate can state: MAX_PEOPLE in
 *  calculators/engine.mjs. A stated count above the trip limit but within this
 *  ceiling is real and is reported; a count above it cannot come from a page. */
export const CALC_PEOPLE_MAX = 40

export interface CalcPrefill {
  v: 1
  at: number
  calc: string | null
  dest: string | null
  days: number | null
  /** The party the form can take: 1 to CREW_MAX. */
  people: number | null
  /** A stated party above CREW_MAX, up to CALC_PEOPLE_MAX. The form never takes
   *  it as its own count. It says so instead (see calcPartyLimitText). */
  peopleOverLimit: number | null
  mode: TransportMode | null
  stay: StayStyle | null
  budget: number | null
}

/** The field half of a row, with every unusable value already dropped to null.
 *  `parseCalcPrefill` and `prefillFromSearch` both go through here, so the two
 *  readers cannot drift apart on what counts as usable. */
type CalcPrefillFields = Omit<CalcPrefill, 'v' | 'at'>

/** An integer inside a closed band, from a JSON number or a query string.
 *  Anything else — a decimal, `abc`, `4abc`, an empty string — is null. */
function intInBand(v: unknown, lo: number, hi: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null
}

/** One of a closed vocabulary, or null. */
function oneOf<T extends string>(v: unknown, vocabulary: readonly T[]): T | null {
  return typeof v === 'string' && (vocabulary as readonly string[]).includes(v) ? (v as T) : null
}

/** A human destination name: trimmed, non-empty, and short enough to be a name
 *  rather than a pasted paragraph. Null when there is nothing to say. */
function destName(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s.length > 0 && s.length <= 60 ? s : null
}

function normaliseFields(src: Record<string, unknown>): CalcPrefillFields {
  return {
    calc: oneOf(src.calc, CALC_PREFILL_SLUGS),
    dest: destName(src.dest),
    days: intInBand(src.days, 1, 90),
    people: intInBand(src.people, 1, CREW_MAX),
    peopleOverLimit: intInBand(src.people, CREW_MAX + 1, CALC_PEOPLE_MAX),
    mode: oneOf(src.mode, TRANSPORT_MODES),
    stay: oneOf(src.stay, STAY_STYLES),
    budget: intInBand(src.budget, 0, 1000000),
  }
}

/** Pure parser for a stashed row — assert on this in node-env tests; the
 *  storage wrappers below only add the try/catch a missing sessionStorage
 *  needs. Returns null on anything unusable (wrong version, no stamp, expired,
 *  junk JSON), so a corrupt stash never blocks the plain form. */
export function parseCalcPrefill(raw: string | null | undefined, now = Date.now()): CalcPrefill | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Record<string, unknown> | null
    if (!p || typeof p !== 'object' || p.v !== 1) return null
    if (typeof p.at !== 'number' || !Number.isFinite(p.at)) return null
    const age = now - p.at
    if (age < -CALC_PREFILL_SKEW_MS || age > CALC_PREFILL_TTL_MS) return null
    // A stored row keeps its stated party in whichever of the two fields it was
    // written from. Read both fields so an over-limit party survives the round trip.
    return { v: 1, at: p.at, ...normaliseFields({ ...p, people: p.people ?? p.peopleOverLimit }) }
  } catch { return null }
}

/** Pure reader for a `location.search` slice. Anything but `ref=calculator` is
 *  somebody else's query (an invite, a campaign) and yields null; under that
 *  ref, each unusable field is dropped to null and the rest survives. */
export function prefillFromSearch(search: string, now = Date.now()): CalcPrefill | null {
  let params: URLSearchParams
  try {
    // Tolerate a slice with the hash still attached, as shareRefFromSearch
    // does: a copied URL carries `#/new` after its query.
    params = new URLSearchParams(search.split('#')[0])
  } catch {
    return null
  }
  if (params.get('ref') !== 'calculator') return null
  return {
    v: 1,
    at: now,
    ...normaliseFields({
      calc: params.get('calc'),
      dest: params.get('dest'),
      days: params.get('days'),
      people: params.get('people'),
      mode: params.get('mode'),
      stay: params.get('stay'),
      budget: params.get('budget'),
    }),
  }
}

/** Store the pending row. Private mode and a disabled storage degrade to a
 *  silent no-op: the visitor loses the pre-fill, never the form. */
export function stashCalcPrefill(p: CalcPrefill): void {
  try { sessionStorage.setItem(CALC_PREFILL_KEY, JSON.stringify(p)) } catch { /* private mode etc. */ }
}

/** Parse the arriving query and stash it. True when a row was written.
 *  Idempotent: the same query twice leaves one identical row. */
export function stashCalcPrefillFromSearch(search: string, now = Date.now()): boolean {
  const p = prefillFromSearch(search, now)
  if (!p) return false
  stashCalcPrefill(p)
  return true
}

/** Read-only, never clears: Auth reads it for the banner and CreateTrip reads
 *  it again for the form. Null when absent, expired or unusable. */
export function readCalcPrefill(now = Date.now()): CalcPrefill | null {
  try { return parseCalcPrefill(sessionStorage.getItem(CALC_PREFILL_KEY), now) } catch { return null }
}

export function clearCalcPrefill(): void {
  try { sessionStorage.removeItem(CALC_PREFILL_KEY) } catch { /* private mode etc. */ }
}

/** The sign-up banner's sentence, or null when there is nothing true to say.
 *  It names the destination and the two figures the row actually carries, and
 *  never a rupee amount: the calculator's price is not re-checked here. */
export function calcPrefillBannerText(p: CalcPrefill): string | null {
  if (!p.dest) return null
  const span = p.days != null ? `${p.days}-day ` : ''
  const headcount = p.people ?? p.peopleOverLimit
  const crew = headcount != null ? ` for ${headcount} ${headcount === 1 ? 'person' : 'people'}` : ''
  return `Your ${span}${p.dest} estimate${crew} is ready. Sign up free to open your group plan.`
}

/** The create form's line for a stated party above the trip limit, or null when
 *  the stated party fits or none was stated. It names the stated count and the
 *  limit. It never changes the form's party count, which the traveller sets. */
export function calcPartyLimitText(p: CalcPrefill): string | null {
  if (p.peopleOverLimit == null) return null
  return `Your estimate was for ${p.peopleOverLimit} people. A trip holds up to ${CREW_MAX} people, so set the party size yourself.`
}

/** The trip name to pre-fill: "Goa trip", "4-day Goa trip", or "" with no
 *  destination to name. */
export function calcPrefillTripName(p: CalcPrefill): string {
  if (!p.dest) return ''
  return p.days != null ? `${p.days}-day ${p.dest} trip` : `${p.dest} trip`
}
