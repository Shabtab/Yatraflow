// ============ The itinerary import contract ============
// ONE rule set for everything that reads or writes an itinerary JSON:
//
//   read  — src/lib/tripImport.ts (a user's file, in the browser)
//   write — src/lib/snapshot.ts   (Download JSON / snapshot links)
//   gate  — scripts/validate-itinerary.mjs (the repo's own shelf files, CI)
//   tools — scripts/itinerary.mjs (the authoring CLI)
//
// It is deliberately pure: no react, no supabase, no DOM — so the same rules run
// in the browser, in node tests and behind the validator CLI.
//
// Two jobs, and the difference matters:
//   1. DETECT + MIGRATE  — an older file is upgraded to the current shape
//                          (FORMAT_VERSION + MIGRATIONS). Never guesses.
//   2. NORMALIZE        — repair what is mechanically repairable, report what
//                          is not, refuse only what cannot become a trip.
//
// Why repair instead of reject: a file made by an older YatraFlow (or an
// older spec) is a support burden, not a user error. The importer fixes it,
// says exactly what it fixed, and only refuses when fixing would mean
// inventing data (a stop with no usable coordinate is dropped and named, never
// pinned to a guessed point).
//
// The 2026-09-18 incident that produced this file: shelf itineraries authored
// with 0-based `orderInDay` (the old spec's rule) against an app that writes
// 1-based, and with several stops per town reusing one city-level coordinate —
// so an imported trip drew four pins stacked on one point and the validator's
// gate never noticed. See docs/ITINERARY-IMPORT-SPEC.md §7.2.

import type {
  Trip, ItineraryDay, ItineraryStop, Expense, FixedCommitment, LatLngPoint,
  TransportMode, TravelStyle, StopCategory, StopStatus, ExpenseCategory,
} from '../data/types'
import {
  TRANSPORT_MODES, TRAVEL_STYLES, STOP_CATEGORIES, STOP_STATUSES, EXPENSE_CATEGORIES, STAY_STYLES,
} from '../data/types'

/** The wire format this build writes and reads. Bump it whenever the SHAPE
 *  changes — a reader that understands 2 must still read 1 (via MIGRATIONS). */
export const ITINERARY_FORMAT_VERSION = 2

/** The prose contract's version (docs/ITINERARY-IMPORT-SPEC.md). The rule IDs
 *  below are pinned to the validator CLI by tests/trip-import.test.ts. */
export const SPEC_VERSION = '2.0'

/**
 * Every structural rule the contract names. The validator CLI carries the same
 * list, and a test asserts both sides agree — a rule that exists in the app but
 * not in the gate (or the reverse) is how the shelf shipped un-pinable stops.
 */
export const SPEC_RULE_IDS = [
  'TRIP_SHAPE',            // an object; gallery files are { trip, publication }
  'FORMAT_VERSION',        // recognised version, never a future one
  'DAYS_SPAN',             // days.length == inclusive date span
  'DAY_INDEX',             // day.index == array position
  'ORDER_IN_DAY',          // stops are 1-based contiguous, array order is truth
  'STOP_IDS_UNIQUE',       // stop ids unique trip-wide
  'NUMERIC_REQUIRED',      // visitMinutes / fees / transport cost always numbers
  'COORDS_VALID',          // both coordinates, in range
  'COORDS_NOT_PLACEHOLDER',// never (0,0), never a mixed zero
  'COORDS_DISTINCT',       // two stops in one day must not share a pin
  'LEG_FIELDS_OMITTED',    // the engine measures legs; stale hand values lie
  'UNKNOWN_KEYS',          // a key no consumer reads is a lie in the data
  'ENUM_VOCAB',            // every enum value comes from src/data/types.ts
  'PUBLICATION_MIRRORS_TRIP', // durationDays/budget/travelStyle agree with the trip
  'REFERENCES_INTACT',     // expense.stopId / dayIndex point at something real
] as const
export type SpecRuleId = (typeof SPEC_RULE_IDS)[number]

// ---------------- key allowlists ----------------
// A key outside these lists is ignored by every consumer, so an author who sets
// it believes a value that the engine never sees. Reported, never silently kept.

export const TRIP_KEYS = new Set([
  'id', 'name', 'startLocation', 'startLocationCoords', 'destinations', 'destinationCoords',
  'startDate', 'endDate', 'travellers', 'driverCount', 'hasVulnerable', 'driveAfterDinnerMin',
  'transportMode', 'fuelEconomyKmL', 'fuelPricePerL', 'roundTrip', 'vehicleProfile',
  'budgetPerPersonInr', 'travelStyle', 'stayStyle', 'fixedCommitments', 'days', 'expenses',
  'coverEmoji', 'coverImageUrl', 'visibility', 'createdAt', 'updatedAt',
])
export const DAY_KEYS = new Set(['id', 'index', 'title', 'startTime', 'stops'])
export const STOP_KEYS = new Set([
  'id', 'title', 'category', 'locationName', 'placeId', 'lat', 'lng', 'description',
  'visitMinutes', 'openTime', 'closeTime', 'entryFeeInrPerPerson', 'transportCostInrTotal',
  'priority', 'notes', 'sourceUrl', 'status', 'orderInDay', 'weatherSensitive', 'auto',
])
export const EXPENSE_KEYS = new Set([
  'id', 'label', 'category', 'amountInr', 'perPerson', 'optional', 'stopId', 'dayIndex', 'paidBy',
  'settled',
])
export const COMMITMENT_KEYS = new Set(['id', 'title', 'type', 'dayIndex', 'time', 'notes', 'stopId'])
export const PUBLICATION_KEYS = new Set([
  'id', 'tripId', 'creatorId', 'title', 'tagline', 'coverImageUrl', 'routeSummary',
  'durationDays', 'estimatedBudgetPerPersonInr', 'travelStyle', 'bestSeason', 'travelTips',
  'warningsAndAssumptions', 'freeDayIndexes', 'premiumPriceInr', 'subscriberCta',
])

/** The `publication` half of a gallery file — carried through the import so the
 *  caller can tell the user what the file also contained. Never applied silently. */
export interface PublicationDraft {
  id?: string
  title?: string
  tagline?: string
  coverImageUrl?: string
  routeSummary?: string[]
  durationDays?: number
  estimatedBudgetPerPersonInr?: number
  travelStyle?: string
  bestSeason?: string
  travelTips?: string[]
  warningsAndAssumptions?: string[]
  freeDayIndexes?: number[]
  premiumPriceInr?: number
  subscriberCta?: string
}

/** Thrown with a message written for the person holding the file. */
export class TripImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TripImportError'
  }
}

// ---------------- report ----------------
export interface DroppedStop {
  /** 1-based day number, as the user sees it in the report. */
  day: number
  /** 0-based day index — half of the patch key a rescue re-parse matches on. */
  dayIndex: number
  /** 0-based position of the stop within its day — the other half. */
  stopIndex: number
  title: string
  reason: string
}

/** Hand-entered coordinates that rescue a dropped stop — the resolve-or-prompt
 *  guard's answer for an import row. Keyed by the stop's position in the file,
 *  so a patch can only ever land on the exact stop the person was shown. */
export interface DroppedStopPatch {
  dayIndex: number
  stopIndex: number
  latitude: number
  longitude: number
}

export interface NormalizeReport {
  /** Changes the importer made so the file fits the current contract. */
  repairs: string[]
  /** Things it could not fix — the user has to look at these. */
  warnings: string[]
  /** Stops that could not be placed and were therefore not imported. */
  droppedStops: DroppedStop[]
  /** Keys no consumer reads (a set-but-ignored field is a lie in the data). */
  unknownKeys: string[]
}

export function emptyReport(): NormalizeReport {
  return { repairs: [], warnings: [], droppedStops: [], unknownKeys: [] }
}

export interface ImportReportDigest { kind: 'ok' | 'err'; message: string }

/**
 * One short sentence a person can read in a toast: what the importer repaired,
 * what it could not, and — the part that matters most — which stops were left
 * out because they had nowhere to go on the map.
 *
 * Loss outranks cosmetics: a dropped stop is an error-toned message even when
 * everything else was repaired cleanly.
 */
export function digestImportReport(report: NormalizeReport): ImportReportDigest | null {
  const { repairs, warnings, droppedStops } = report
  if (!repairs.length && !warnings.length && !droppedStops.length) return null
  const parts: string[] = []
  if (repairs.length) {
    parts.push(`fixed ${repairs.length} thing${repairs.length === 1 ? '' : 's'} so the file fits the current format`)
  }
  if (droppedStops.length) {
    const first = droppedStops[0]
    parts.push(
      `left out ${droppedStops.length} stop${droppedStops.length === 1 ? '' : 's'} with no usable location (“${first.title}”, Day ${first.day})`,
    )
  }
  if (warnings.length) parts.push(warnings[0])
  return { kind: droppedStops.length ? 'err' : 'ok', message: `Import notes — ${parts.join(' · ')}` }
}

// ---------------- primitives ----------------

export function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** A number, accepting a numeric string ("60" from a spreadsheet export) but
 *  rejecting anything that isn't one. `fallback` when there is no number. */
export function num(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return fallback
}

/** A non-empty trimmed string, or the fallback. */
export function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback
}

export function isHHMM(v: unknown): v is string {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
}

export function hhmmToMinutes(v: string): number {
  const [h, m] = v.split(':').map(Number)
  return h * 60 + m
}

export function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
}

/** Inclusive day count of a date range, or null when the dates are unusable. */
export function spanDays(startDate: unknown, endDate: unknown): number | null {
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return null
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1
}

export function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * The ONE coordinate rule, shared by the importer, the validator and the map.
 *
 * The map's own plot filter refuses `lat === 0` outright (no real India stop is
 * on the equator) and refuses non-finite pairs, so an importer that accepted a
 * mixed placeholder would be handing the map a pin it silently drops — or,
 * worse, a leg that measures to the Gulf of Guinea. Accepting exactly what the
 * map accepts is the whole point: `null` means "cannot be placed".
 */
export function usableCoords(lat: unknown, lng: unknown): LatLngPoint | null {
  const la = num(lat, NaN)
  const ln = num(lng, NaN)
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null
  // (0,0) and the mixed placeholder (one coordinate literally 0) are both
  // rejected — the 2026-09-14 live incident was lat 0 with a real lng.
  if (la === 0 || ln === 0) return null
  return { lat: la, lng: ln }
}

/** Round to ~11 m for pin-cluster comparisons (the map's own resolution). */
export function coordKey(p: LatLngPoint): string {
  return `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`
}

// ---------------- format detection + migration ----------------

export type FileKind = 'bare-trip' | 'envelope'

export interface ReadExportResult {
  /** The trip object, in whatever shape that version used. */
  trip: Record<string, unknown>
  publication?: PublicationDraft
  /** The detected wire version (1 when the file predates versioning). */
  version: number
  kind: FileKind
  /** True when the file carried an envelope with metadata we ignore. */
  hasMetadata: boolean
}

/** Drop the envelope's own metadata keys from an object that also carries them,
 *  so only trip fields reach the normalizer's allowlist. */
function stripFileKeys(o: Record<string, unknown>): Record<string, unknown> {
  const { formatVersion, ...rest } = o
  void formatVersion
  return rest
}

/** True when the object looks like a `published_itineraries` row rather than a
 *  trip — the two are easy to confuse and the error should say which it is. */
export function looksLikePublicationRow(o: Record<string, unknown>): boolean {
  return !Array.isArray(o.days) && (
    Array.isArray(o.route_summary) || Array.isArray(o.routeSummary)
    || typeof o.tagline === 'string' || o.premium_price_inr !== undefined
    || o.premiumPriceInr !== undefined || typeof o.creator_id === 'string'
  )
}

/**
 * Read any accepted file into `{ trip, publication, version }`.
 *
 * Accepted:
 *   v1  a bare `Trip`               — what old "Download JSON" wrote
 *   v1  `{ trip, publication }`     — the gallery import format before versioning
 *   v2  `{ formatVersion, trip, publication? }` — what this build writes
 *
 * Refused, with a reason written for the person holding the file: anything that
 * is not JSON, a snapshot link payload, a published-itinerary row, a file with
 * publish details but no trip, a file from a NEWER version, and a file with no
 * itinerary days. Throws `TripImportError`; never returns a partial trip.
 */
export function readExport(raw: string): ReadExportResult {
  const text = raw.trim()
  if (!text) throw new TripImportError('That file is empty.')
  if (text.startsWith('yf1_')) {
    throw new TripImportError(
      'That is a snapshot-link payload, not a file export — open it as a link instead.',
    )
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new TripImportError('That file is not JSON.')
  }
  if (!isObject(data)) throw new TripImportError('That file is not a YatraFlow trip export.')

  // Version: explicit when the file says so, otherwise 1 (everything written
  // before versioning existed). A file from the FUTURE is refused rather than
  // half-read — migrating forwards is well-defined, backwards is guesswork.
  // A version that is present but unreadable is refused too: silently treating
  // "formatVersion": "two" as a v1 file would import it under the wrong rules.
  const declaresVersion = data.formatVersion !== undefined
  const declared = typeof data.formatVersion === 'number' && Number.isInteger(data.formatVersion) && data.formatVersion >= 1
    ? data.formatVersion
    : undefined
  if (declaresVersion && declared === undefined) {
    throw new TripImportError(`That file declares formatVersion ${JSON.stringify(data.formatVersion)}, which is not a version.`)
  }
  const version = declared ?? 1
  if (version > ITINERARY_FORMAT_VERSION) {
    throw new TripImportError(
      `That file was written for a newer YatraFlow (format ${version}; this build reads ${ITINERARY_FORMAT_VERSION}). Update the app, then import it.`,
    )
  }

  let trip: Record<string, unknown>
  let publication: PublicationDraft | undefined
  let kind: FileKind

  if (isObject(data.trip)) {
    kind = 'envelope'
    trip = data.trip
    publication = isObject(data.publication) ? (data.publication as PublicationDraft) : undefined
  } else if (Array.isArray(data.days)) {
    kind = 'bare-trip'
    // The version tag is FILE metadata, not a trip field. A bare trip can carry
    // it legitimately — `encodeTripSnapshot` stamps `formatVersion` into its
    // payload — and without this it would come back as an "unknown key nothing
    // reads" warning on a file that is perfectly correct.
    trip = stripFileKeys(data)
  } else if (looksLikePublicationRow(data)) {
    throw new TripImportError(
      'That is a published-itinerary row, not a trip export — it carries no itinerary days.',
    )
  } else if (isObject(data.publication)) {
    throw new TripImportError('That file has publish details but no `trip` block — it looks incomplete.')
  } else {
    throw new TripImportError('That export has no itinerary days — it is not a trip.')
  }

  return {
    trip,
    publication: migratePublication(publication, version),
    version,
    kind,
    hasMetadata: kind === 'envelope',
  }
}

/**
 * Forward migrations, one step per version. A migration may only reshape what
 * it must; the normalizer (below) is what fixes rule violations, so a new
 * version needs a migration only when the SHAPE changes.
 *
 * v1 → v2: the shape is unchanged (the normalizer handles v1's 0-based
 * `orderInDay` and its stale leg fields). v2 exists so a file can declare
 * itself, and so a v3 change has somewhere honest to land.
 */
export const MIGRATIONS: Record<number, (trip: Record<string, unknown>) => Record<string, unknown>> = {
  1: (trip) => trip,
}

/** Apply the migration chain up to the current version. */
export function migrateTrip(trip: Record<string, unknown>, fromVersion: number): Record<string, unknown> {
  let current = trip
  for (let v = fromVersion; v < ITINERARY_FORMAT_VERSION; v++) {
    const step = MIGRATIONS[v]
    if (!step) continue
    current = step(current)
  }
  return current
}

function migratePublication(pub: PublicationDraft | undefined, version: number): PublicationDraft | undefined {
  void version
  if (!pub) return undefined
  return publicationExport(pub as Record<string, unknown>) as PublicationDraft
}

/** Cut a publication row down to the fields the contract defines — the exact
 *  inverse of what the validator rejects. Tool-managed stats (views, copies,
 *  publishedAt/refreshedAt) are dropped so an exported file never carries a
 *  stale counter, and an unknown key never round-trips into a reader's belief. */
export function publicationExport(pub: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of PUBLICATION_KEYS) {
    const v = pub[k]
    if (v !== undefined && v !== null) out[k] = v
  }
  return out
}

// ---------------- the trip export envelope ----------------

export interface TripExport {
  formatVersion: number
  exportedAt: string
  app: string
  trip: Trip
  publication?: Record<string, unknown>
}

/** Build the file `Download JSON` writes: a versioned envelope carrying the trip
 *  (and the publication row, when the trip has one, so a round trip through the
 *  file does not lose the shelf metadata). */
export function buildTripExport(trip: Trip, publication?: Record<string, unknown>, appVersion = '0.0.0'): TripExport {
  const out: TripExport = {
    formatVersion: ITINERARY_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    app: `yatraflow/${appVersion}`,
    trip,
  }
  if (publication) out.publication = publication
  return out
}

// ---------------- normalization ----------------

function unknownKeys(o: Record<string, unknown>, allowed: Set<string>, where: string, report: NormalizeReport): void {
  const extra = Object.keys(o).filter(k => !allowed.has(k) && o[k] !== undefined)
  for (const k of extra) report.unknownKeys.push(`${where}: "${k}"`)
}

function validEnum<T extends string>(v: unknown, list: readonly T[]): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined
}

let idSeq = 0
function freshId(prefix: string): string {
  idSeq += 1
  return `imp_${prefix}${idSeq}`
}

/**
 * sourceUrl renders as an <a href> in the timeline, so an import file must
 * meet the SAME boundary rule StopEditor enforces on manual entry: http(s)
 * only. Anything else (javascript:, data:, intent:, custom app schemes) is
 * dropped and named — the Android WebView turns arbitrary off-origin schemes
 * into ACTION_VIEW intents, so "the browser will block it" is not a defense.
 */
function safeSourceUrl(v: unknown, where: string, report: NormalizeReport): string | undefined {
  if (v === undefined || v === null) return undefined
  const url = typeof v === 'string' ? v.trim() : ''
  if (!url) return undefined
  if (!/^https?:\/\//i.test(url) || url.length > 500) {
    report.repairs.push(`${where}: sourceUrl was not an http(s) link — dropped it.`)
    return undefined
  }
  return url
}

/**
 * Turn a file's trip object into a real `Trip`, repairing what can be repaired
 * and reporting everything it changed or could not change.
 *
 * Repairs are mechanical and non-destructive except for two cases: a stop whose
 * coordinates cannot be placed is DROPPED and named (a guessed pin is the one
 * error that poisons every number downstream, and the app's own rule is to
 * refuse rather than fabricate), and a sourceUrl that is not http(s) is
 * dropped and named (it renders as a clickable link — the app's own boundary
 * rule, applied to imported files too). Unknown keys are dropped and named.
 *
 * Returns null when nothing importable remains — the caller turns that into a
 * `TripImportError` that says why.
 */
export function normalizeTrip(source: Record<string, unknown>, report: NormalizeReport, patches: DroppedStopPatch[] = []): Trip | null {
  unknownKeys(source, TRIP_KEYS, 'trip', report)

  const rawDays = source.days
  if (!Array.isArray(rawDays) || rawDays.length === 0) {
    throw new TripImportError('That export has no itinerary days — it is not a trip.')
  }
  const badDay = rawDays.findIndex(d => !isObject(d) || !Array.isArray((d as Record<string, unknown>).stops))
  if (badDay >= 0) {
    throw new TripImportError(`Day ${badDay + 1} of that export has no stops list — the file looks truncated.`)
  }

  const days: ItineraryDay[] = []
  const stopIds = new Set<string>()
  let renumberedDays = 0
  let renumberedStops = 0

  rawDays.forEach((rawDay, di) => {
    const d = rawDay as Record<string, unknown>
    const where = `Day ${di + 1}`
    unknownKeys(d, DAY_KEYS, where, report)
    if (num(d.index, di) !== di) renumberedDays++

    const rawStops = (d.stops as unknown[]).filter(isObject) as Record<string, unknown>[]
    const stops: ItineraryStop[] = []

    rawStops.forEach((s, si) => {
      const stopWhere = `${where} stop ${si + 1}`
      unknownKeys(s, STOP_KEYS, stopWhere, report)

      const title = str(s.title) || str(s.locationName) || `Stop ${si + 1}`
      const locationName = str(s.locationName) || title
      if (!str(s.title)) report.repairs.push(`${stopWhere}: had no title — used "${locationName}".`)

      // The one refusal: a stop that cannot be placed is not pinned anywhere.
      // A hand-entered patch (the resolve-or-prompt guard's answer, keyed to
      // this exact file position) rescues it — the wall refuses FABRICATION,
      // not a person's own coordinates. An invalid patch rescues nothing.
      const own = usableCoords(s.lat, s.lng)
      const patch = own ? undefined : patches.find(p => p.dayIndex === di && p.stopIndex === si)
      const rescued = patch ? usableCoords(patch.latitude, patch.longitude) : null
      const coords = own ?? rescued
      if (!coords) {
        report.droppedStops.push({
          day: di + 1,
          dayIndex: di,
          stopIndex: si,
          title,
          reason: coordsReason(s.lat, s.lng),
        })
        return
      }
      if (rescued) report.repairs.push(`${stopWhere}: coordinates entered by hand.`)

      if (s.orderInDay !== si + 1) renumberedStops++
      if (s.departTime !== undefined || s.arrivalTime !== undefined || s.legDistanceKm !== undefined || s.legTravelMinutes !== undefined) {
        report.repairs.push(`${stopWhere}: dropped hand-written leg fields — the engine measures the road itself.`)
      }

      const category = validEnum<StopCategory>(s.category, STOP_CATEGORIES)
      if (!category) report.repairs.push(`${stopWhere}: category "${String(s.category ?? '')}" is not a stop category — used "sightseeing".`)
      const priority = validEnum(s.priority, ['must-do', 'nice-to-have', 'optional'] as const)
      if (!priority) report.repairs.push(`${stopWhere}: priority "${String(s.priority ?? '')}" is not valid — used "must-do".`)
      const status = validEnum<StopStatus>(s.status, STOP_STATUSES)
      if (!status) report.repairs.push(`${stopWhere}: status "${String(s.status ?? '')}" is not valid — used "confirmed".`)

      // Opening hours are all-or-nothing, and must read forwards.
      let openTime: string | undefined
      let closeTime: string | undefined
      if (s.openTime !== undefined || s.closeTime !== undefined) {
        if (isHHMM(s.openTime) && isHHMM(s.closeTime) && hhmmToMinutes(s.openTime) <= hhmmToMinutes(s.closeTime)) {
          openTime = s.openTime
          closeTime = s.closeTime
        } else {
          report.repairs.push(`${stopWhere}: opening hours were incomplete or out of order — dropped both.`)
        }
      }

      let id = str(s.id)
      if (!id || stopIds.has(id)) {
        if (id) report.repairs.push(`${stopWhere}: stop id "${id}" was already used — re-issued it.`)
        id = freshId('st')
      }
      stopIds.add(id)

      for (const [field, value] of [['visitMinutes', s.visitMinutes], ['entryFeeInrPerPerson', s.entryFeeInrPerPerson], ['transportCostInrTotal', s.transportCostInrTotal]] as const) {
        if (num(value, NaN) !== num(value, 0) || !Number.isFinite(num(value, NaN))) {
          report.repairs.push(`${stopWhere}: ${field} was missing or not a number — set to 0.`)
        }
      }

      stops.push({
        id,
        title: title.slice(0, 120),
        category: category ?? 'sightseeing',
        locationName,
        placeId: str(s.placeId) || undefined,
        lat: coords.lat,
        lng: coords.lng,
        description: str(s.description) || undefined,
        visitMinutes: Math.max(0, num(s.visitMinutes, 0)),
        openTime,
        closeTime,
        entryFeeInrPerPerson: Math.max(0, num(s.entryFeeInrPerPerson, 0)),
        transportCostInrTotal: Math.max(0, num(s.transportCostInrTotal, 0)),
        priority: priority ?? 'must-do',
        notes: str(s.notes) || undefined,
        sourceUrl: safeSourceUrl(s.sourceUrl, stopWhere, report),
        status: status ?? 'confirmed',
        // 1-based and contiguous — the app's own convention (createTrip, addStop
        // and every renumber path write n+1). The array order is the truth.
        orderInDay: si + 1,
        auto: s.auto === true || undefined,
        weatherSensitive: s.weatherSensitive === true || undefined,
      })
    })

    // A day is NEVER dropped. Removing it would renumber every later day and
    // silently shift every `dayIndex` reference (fixed commitments, expenses) —
    // far more damage than an empty day, which the app already renders. Say so
    // instead, and let the user fill it in.
    if (stops.length === 0 && rawStops.length > 0) {
      report.warnings.push(`${where}: none of its stops could be placed — the day imports empty.`)
    } else if (rawStops.length === 0) {
      report.warnings.push(`${where} has no stops — it will import as a free day.`)
    }

    const startTime = isHHMM(d.startTime) ? d.startTime : undefined
    if (d.startTime !== undefined && !startTime) report.repairs.push(`${where}: start time "${String(d.startTime)}" is not "HH:MM" — dropped it.`)

    days.push({
      id: str(d.id) || `d${di + 1}`,
      index: days.length,
      title: str(d.title) || undefined,
      startTime,
      stops,
    })
  })

  // Nothing importable at all: no day carries a single placeable stop.
  if (days.every(d => d.stops.length === 0)) return null
  if (renumberedDays > 0) report.repairs.push(`Rebuilt day numbering (${renumberedDays} day${renumberedDays > 1 ? 's' : ''} did not match their position in the list).`)
  if (renumberedStops > 0) report.repairs.push(`Rebuilt the per-day stop order (${renumberedStops} stop${renumberedStops > 1 ? 's' : ''} were numbered from 0 or out of sequence — this app numbers from 1).`)
  warnSharedPins(days, report)

  // ---- dates vs day count ----
  // The itinerary's CONTENT decides how long the trip is: a file whose dates
  // disagree with its days would otherwise import days the UI cannot show.
  let startDate = isIsoDate(source.startDate) ? source.startDate : ''
  let endDate = isIsoDate(source.endDate) ? source.endDate : ''
  if (!startDate) {
    startDate = todayIso()
    report.repairs.push('startDate was missing or not a date — dated the trip from today.')
  }
  const span = spanDays(startDate, endDate)
  if (span === null || span < 1 || span !== days.length) {
    endDate = shiftIsoDate(startDate, days.length - 1)
    report.repairs.push(
      span === null
        ? `endDate was missing or not a date — set it to ${endDate} for a ${days.length}-day plan.`
        : `dates covered ${span} day${span === 1 ? '' : 's'} but the plan has ${days.length} — set the range to ${startDate} → ${endDate}.`,
    )
  }

  // ---- anchors + collections ----
  const destinations = (Array.isArray(source.destinations) ? source.destinations : [])
    .filter((x): x is string => typeof x === 'string' && !!x.trim())
    .map(x => x.trim())
  const rawDestCoords = Array.isArray(source.destinationCoords) ? source.destinationCoords : []
  const destinationCoords = destinations.map((_, i) => {
    const c = rawDestCoords[i]
    if (!isObject(c)) return null
    return usableCoords(c.lat, c.lng)
  })
  if (rawDestCoords.length !== destinations.length && rawDestCoords.length > 0) {
    report.warnings.push('destinationCoords did not line up with destinations — the trip start will anchor the map instead.')
  }

  const startLocationCoords = isObject(source.startLocationCoords)
    ? usableCoords(source.startLocationCoords.lat, source.startLocationCoords.lng) ?? undefined
    : undefined
  if (!startLocationCoords && source.startLocationCoords !== undefined) {
    report.repairs.push('trip.startLocationCoords could not be used — the trip start has no map anchor.')
  }

  const commitments: FixedCommitment[] = []
  const rawCommitments = Array.isArray(source.fixedCommitments) ? source.fixedCommitments : []
  rawCommitments.forEach((raw, i) => {
    if (!isObject(raw)) return
    unknownKeys(raw, COMMITMENT_KEYS, `fixedCommitments[${i}]`, report)
    const dayIndex = num(raw.dayIndex, -1)
    const time = str(raw.time)
    const title = str(raw.title)
    if (!title || dayIndex < 0 || dayIndex >= days.length || !isHHMM(time)) {
      report.warnings.push(`fixedCommitments[${i}] "${title || 'untitled'}" did not fit the plan (bad day or time) — dropped.`)
      return
    }
    let stopId = str(raw.stopId) || undefined
    if (stopId && !days[dayIndex].stops.some(s => s.id === stopId)) {
      report.repairs.push(`fixedCommitments[${i}] "${title}" pointed at no stop of Day ${dayIndex + 1} — kept the deadline, dropped the link.`)
      stopId = undefined
    }
    commitments.push({
      id: freshId('fc'),
      title,
      type: validEnum(raw.type, ['hotel-checkin', 'train-departure', 'flight-departure', 'event', 'other'] as const) ?? 'other',
      dayIndex,
      time,
      notes: str(raw.notes) || undefined,
      stopId,
    })
  })

  const expenses: Expense[] = []
  const rawExpenses = Array.isArray(source.expenses) ? source.expenses : []
  rawExpenses.forEach((raw, i) => {
    if (!isObject(raw)) return
    unknownKeys(raw, EXPENSE_KEYS, `expenses[${i}]`, report)
    const label = str(raw.label)
    const category = validEnum<ExpenseCategory>(raw.category, EXPENSE_CATEGORIES)
    const amountInr = num(raw.amountInr, NaN)
    const dayIndex = raw.dayIndex === undefined ? undefined : num(raw.dayIndex, -1)
    if (!label || !Number.isFinite(amountInr) || amountInr <= 0 || (dayIndex !== undefined && (dayIndex < 0 || dayIndex >= days.length))) {
      report.warnings.push(`expenses[${i}] "${label || 'untitled'}" had no usable amount or day — dropped.`)
      return
    }
    let stopId = str(raw.stopId) || undefined
    if (stopId && !stopIds.has(stopId)) {
      report.repairs.push(`expenses[${i}]: stopId "${stopId}" pointed at no stop — kept the expense, dropped the link.`)
      stopId = undefined
    }
    // M6 B4: the settled record round-trips when well-formed; anything else
    // is dropped (an import must never carry a malformed flag into the app).
    let settled: Expense['settled']
    if (raw.settled !== undefined) {
      const s = isObject(raw.settled) ? raw.settled : undefined
      const by = s ? str(s.by) : ''
      const at = s ? num(s.at, NaN) : NaN
      if (by && Number.isFinite(at)) settled = { by, at }
      else report.repairs.push(`expenses[${i}]: "settled" was malformed — imported the line as open.`)
    }
    expenses.push({
      id: freshId('ex'),
      label,
      category: category ?? 'activities',
      amountInr,
      perPerson: raw.perPerson === true || undefined,
      optional: raw.optional === true || undefined,
      stopId,
      dayIndex,
      settled,
    })
  })

  const travellers = Math.max(1, Math.round(num(source.travellers, 2)))
  if (num(source.travellers, NaN) !== travellers) report.repairs.push(`travellers was not a whole number ≥ 1 — used ${travellers}.`)

  const transportMode = validEnum<TransportMode>(source.transportMode, TRANSPORT_MODES)
  if (!transportMode) report.repairs.push(`transportMode "${String(source.transportMode ?? '')}" is not a mode — used "car".`)
  const travelStyle = validEnum<TravelStyle>(source.travelStyle, TRAVEL_STYLES)
  if (!travelStyle) report.repairs.push(`travelStyle "${String(source.travelStyle ?? '')}" is not a style — used "balanced".`)
  const stayStyle = validEnum(source.stayStyle, STAY_STYLES)
  if (source.stayStyle !== undefined && !stayStyle) report.repairs.push(`stayStyle "${String(source.stayStyle)}" is not a stay tier — left unset.`)

  const trip = {
    // Placeholders: the store assigns real ids and re-ids every day, stop and
    // expense on write, so a foreign file can never collide with a local row.
    id: 'import-pending',
    createdAt: 0,
    updatedAt: 0,
    name: str(source.name, 'Imported trip').slice(0, 120),
    startLocation: str(source.startLocation) || destinations[0] || 'Unknown start',
    startLocationCoords,
    destinations,
    destinationCoords,
    startDate,
    endDate,
    travellers,
    driverCount: [2, 3].includes(num(source.driverCount, 0)) ? num(source.driverCount, 0) : undefined,
    hasVulnerable: source.hasVulnerable === true || undefined,
    driveAfterDinnerMin: num(source.driveAfterDinnerMin, NaN) >= 1 && num(source.driveAfterDinnerMin, NaN) <= 480
      ? num(source.driveAfterDinnerMin, 0)
      : undefined,
    transportMode: transportMode ?? 'car',
    fuelEconomyKmL: num(source.fuelEconomyKmL, NaN) > 0 ? num(source.fuelEconomyKmL, 0) : undefined,
    fuelPricePerL: num(source.fuelPricePerL, NaN) > 0 ? num(source.fuelPricePerL, 0) : undefined,
    roundTrip: typeof source.roundTrip === 'boolean' ? source.roundTrip : undefined,
    budgetPerPersonInr: Math.max(0, num(source.budgetPerPersonInr, 0)),
    travelStyle: travelStyle ?? 'balanced',
    stayStyle,
    fixedCommitments: commitments,
    days,
    expenses,
    coverEmoji: str(source.coverEmoji, '🧭'),
    coverImageUrl: str(source.coverImageUrl) || undefined,
    // An import is the user's own private plan until they publish it. A gallery
    // file carries `visibility: "public"`; that must not decide anything here.
    visibility: 'private',
    // Assigned by the store, never taken from the file.
    members: undefined,
    inviteCode: undefined,
    deletedAt: undefined,
  } as unknown as Trip

  return trip
}

function coordsReason(lat: unknown, lng: unknown): string {
  const la = num(lat, NaN)
  const ln = num(lng, NaN)
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return 'the file has no usable coordinates'
  if (la === 0 && ln === 0) return 'coordinates were (0,0) — the Null-Island placeholder'
  if (la === 0 || ln === 0) return 'only one coordinate was real (the mixed-placeholder case)'
  return 'coordinates were outside the globe'
}

/**
 * One pin per place. Two stops in one day at the same coordinate are two pins
 * drawn on top of each other, a zero-length leg, and (when the day then drives)
 * the engine's own backtracking warning. It cannot be repaired — only the
 * author knows where the second place actually is — so it is reported.
 *
 * ONE exception, because it is a fact rather than a shortcut: a meal at the
 * place you sleep or break IS one place. So at most two stops may share a
 * coordinate, and one of them must be a `food`, `hotel` or `rest` stop.
 */
function warnSharedPins(days: ItineraryDay[], report: NormalizeReport): void {
  days.forEach((d, di) => {
    const byKey = new Map<string, ItineraryStop[]>()
    for (const s of d.stops) {
      const k = coordKey(s)
      byKey.set(k, [...(byKey.get(k) ?? []), s])
    }
    for (const [key, shared] of byKey) {
      if (shared.length === 1) continue
      const isBaseOverlap = shared.length === 2 && shared.some(s => s.category === 'food' || s.category === 'hotel' || s.category === 'rest')
      if (isBaseOverlap) continue
      report.warnings.push(
        `Day ${di + 1}: ${shared.length} stops share one coordinate (${key}) — ${shared.map(s => `“${s.title}”`).join(', ')} will draw as one pin. Give each stop its own place.`,
      )
    }
  })
}
