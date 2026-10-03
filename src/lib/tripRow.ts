// ============ trips table serialization + Supabase error classification ============
// Pure helpers with NO react/supabase/toast imports, so the row mapping and the
// missing-column detection are unit-testable in the node test environment.
import type { Trip, ItineraryDay, ItineraryStop, TripMember, Expense, FixedCommitment, LatLngPoint } from '../data/types'
import { normalizeVehicleProfile } from './vehicleProfile'
import { allowedAmount } from './expenseAmount'

/** #559 — the jsonb coercion: a real array passes, ANYTHING else (null, an
 *  object, a string, a number) becomes empty. `?? []` only answers null, which
 *  is how a corrupt jsonb value reached renders as a typed lie. */
function arrayOrEmpty<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

export interface TripRow {
  id: string; owner_id: string; name: string; start_location: string;
  start_location_coords: LatLngPoint | null; destinations: string[];
  destination_coords: (LatLngPoint | null)[] | null;
  start_date: string; end_date: string; travellers: number; transport_mode: string;
  /** present only after the fuel migrations (see supabase/schema.sql) */
  fuel_economy_km_per_l?: number | null;
  fuel_price_per_l?: number | null;
  /** absent/null = default (round trip on for self-drive) */
  round_trip?: boolean | null;
  budget_per_person_inr: number; travel_style: string; fixed_commitments: FixedCommitment[];
  /** present only after the stay-budget migration (20260914_trip_stay_budget.sql) */
  stay_style?: string | null;
  /** present only after the party+vehicle migration (20260915_trip_party_prefs.sql) */
  driver_count?: number | null;
  has_vulnerable?: boolean | null;
  drive_after_dinner_min?: number | null;
  /** JSONB: vocabulary-validated by normalizeVehicleProfile on read. */
  vehicle_profile?: unknown | null;
  /** present only after the vehicle-estimates migration (20260928_trip_vehicle_estimates.sql) */
  tank_l?: number | null;
  rent_per_day_inr?: number | null;
  local_train?: boolean | null;
  days: ItineraryDay[]; expenses: Expense[]; cover_emoji: string;
  /** present only after the cover-image migration (see supabase/schema.sql) */
  cover_image_url?: string | null;
  /** present only after the invite-code migration (see supabase/schema.sql) */
  invite_code?: string | null; visibility: 'private' | 'public';
  /** present only after the share-source migration (20260929_pub_events_share_source.sql) —
   *  how this trip's owner ARRIVED: the shared link's ref, or the in-app surface */
  ref?: string | null;
  /** present only after the trip-trash migration (20260910_trip_trash.sql) */
  deleted_at?: string | null;
  created_at: number; updated_at: number;
}

/** Sanity bounds for party fields — a row with garbage numbers would silently
 *  degrade the split verdict and the wheel-cap calc. Narrow range; anything
 *  outside is dropped and the engine falls back to its 1-driver / no-vulnerable
 *  / dinner-ends-day defaults. */
const DRIVER_COUNT_VALUES = new Set([2, 3])
const DRIVE_AFTER_DINNER_MAX_MIN = 480 // 8 h post-dinner is the trip's cap

/** #377 sanity bounds for the create form's vehicle estimates — the same
 *  drop-the-junk rule as the party sanitizers above. A row that skipped them
 *  (hand-edited, legacy) degrades to NULL and the engine falls back to its
 *  defaults instead of pricing nonsense. Tank: 5..300 L — under 5 is a typo
 *  and 300 is the estimate's own cap (the "≈ N km per tank" note never bills
 *  more). Rent: 0..100000 ₹/day — 0 is legitimate (a free upgrade), a lakh a
 *  day is not. */
const TANK_L_MIN = 5
const TANK_L_MAX = 300
const RENT_PER_DAY_MIN_INR = 0
const RENT_PER_DAY_MAX_INR = 100000

export function sanitizeTankL(v: number | undefined | null): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= TANK_L_MIN && v <= TANK_L_MAX ? v : null
}

export function sanitizeRentPerDayInr(v: number | undefined | null): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= RENT_PER_DAY_MIN_INR && v <= RENT_PER_DAY_MAX_INR ? v : null
}

export function rowToTrip(row: TripRow, members: TripMember[]): Trip {
  // driverCount: NULL means "1 driver" (the legacy default). Anything outside
  // {2, 3} is junk — pre-migration trips stay at undefined, post-migration
  // typos degrade to undefined (engine falls back to 1).
  const driverCount = row.driver_count != null && DRIVER_COUNT_VALUES.has(row.driver_count)
    ? row.driver_count
    : undefined
  // hasVulnerable: NULL is the legacy default = false. Booleans pass through.
  const hasVulnerable = row.has_vulnerable === true ? true : undefined
  // driveAfterDinnerMin: NULL = dinner ends the day. 1..MAX are the only
  // meaningful values; the settings form emits 120, anything else is noise.
  const driveAfterDinnerMin = typeof row.drive_after_dinner_min === 'number'
    && Number.isFinite(row.drive_after_dinner_min)
    && row.drive_after_dinner_min >= 1
    && row.drive_after_dinner_min <= DRIVE_AFTER_DINNER_MAX_MIN
    ? row.drive_after_dinner_min
    : undefined
  // vehicleProfile: vocabulary/range check via normalizeVehicleProfile. Any
  // junk field drops the whole profile; the engine's mode default kicks in.
  const vehicleProfile = normalizeVehicleProfile(row.vehicle_profile)
  // #377 vehicle estimates: the writers' sanitizers, restated as read guards —
  // a hand-edited row that skipped the write path still degrades instead of
  // carrying a negative rent into the totals.
  const tankL = sanitizeTankL(row.tank_l)
  const rentPerDayInr = sanitizeRentPerDayInr(row.rent_per_day_inr)
  const localTrain = typeof row.local_train === 'boolean' ? row.local_train : undefined
  // #559 — the jsonb columns are corruptible (direct SQL, a partial write, a
  // restored dump): the server's own RPCs guard them with `jsonb_typeof`,
  // so `?? []` is not enough — it answers null but passes a non-array object
  // straight through, and the first render that calls .flatMap/.map on the
  // lie crashes. This mapper is the chokepoint: every downstream reader
  // inherits the coercion, so it lives here and nowhere else.
  const destinations = arrayOrEmpty<string>(row.destinations)
  const fixedCommitments = arrayOrEmpty<FixedCommitment>(row.fixed_commitments)
  const days = arrayOrEmpty<ItineraryDay>(row.days)
    .filter(d => d != null && typeof d === 'object')
    .map(d => ({ ...d, stops: arrayOrEmpty<ItineraryStop>(d.stops) }))
  // #382: a hydrate drops what the writers refuse. A row persisted by the old
  // code — or hand-edited in the dashboard — can carry a non-finite, negative
  // or zero amount, and it would flow into the totals, the settlement math and
  // the pacing figure. The rule is the importer's own (lib/expenseAmount), one
  // rule for every path; the drop is said in the console because a hydrate has
  // no toast surface to say it on.
  const expenses = arrayOrEmpty<Expense>(row.expenses).filter(e => {
    if (e == null || typeof e !== 'object') return false
    if (allowedAmount(e.amountInr) !== null) return true
    console.warn(`tripRow: dropped expense "${e.label}" — amount ${String(e.amountInr)} is not a finite number of rupees above zero`)
    return false
  })
  return {
    id: row.id, name: row.name, startLocation: row.start_location, startLocationCoords: row.start_location_coords ?? undefined,
    destinations,
    destinationCoords: row.destination_coords ?? undefined,
    startDate: row.start_date, endDate: row.end_date, travellers: row.travellers,
    transportMode: row.transport_mode as Trip['transportMode'], budgetPerPersonInr: row.budget_per_person_inr,
    fuelEconomyKmL: row.fuel_economy_km_per_l ?? undefined,
    fuelPricePerL: row.fuel_price_per_l ?? undefined,
    roundTrip: row.round_trip ?? undefined,
    travelStyle: row.travel_style as Trip['travelStyle'], fixedCommitments,
    // Absent column (pre-migration) stays undefined so stayKeyFor() falls back to
    // the legacy travelStyle and no stored trip re-prices silently.
    stayStyle: (row.stay_style ?? undefined) as Trip['stayStyle'],
    driverCount,
    hasVulnerable,
    driveAfterDinnerMin,
    vehicleProfile,
    tankL: tankL ?? undefined,
    rentPerDayInr: rentPerDayInr ?? undefined,
    localTrain,
    days, expenses, coverEmoji: row.cover_emoji,
    coverImageUrl: row.cover_image_url ?? undefined, inviteCode: row.invite_code ?? undefined,
    ref: row.ref ?? undefined,
    visibility: row.visibility, deletedAt: row.deleted_at != null ? new Date(row.deleted_at).getTime() : undefined,
    createdAt: row.created_at, updatedAt: row.updated_at, members,
  }
}

export interface OptionalColumnsProbe {
  economy: boolean; price: boolean; roundTrip: boolean; cover: boolean; inviteCode: boolean; deleted: boolean
  /** the stay-budget dial (20260914_trip_stay_budget.sql) */
  stayStyle: boolean
  /** the party + vehicle preference batch (20260915_trip_party_prefs.sql) */
  driverCount: boolean
  hasVulnerable: boolean
  driveAfterDinner: boolean
  vehicleProfile: boolean
  /** the create-time vehicle estimates (20260928_trip_vehicle_estimates.sql) */
  tankL: boolean
  rentPerDayInr: boolean
  localTrain: boolean
  /** share attribution (20260929_pub_events_share_source.sql) */
  ref: boolean
}

/**
 * Map a trip to its Postgres row. `cols` says which optional columns the
 * database actually has (see tripsHaveOptionalColumns) — writing a column the
 * database doesn't know yet would fail the whole insert/update.
 */
export function tripToRow(trip: Trip, ownerId: string, cols?: OptionalColumnsProbe): Omit<TripRow, 'created_at' | 'updated_at'> {
  const row: Omit<TripRow, 'created_at' | 'updated_at'> = {
    id: trip.id, owner_id: ownerId, name: trip.name, start_location: trip.startLocation,
    start_location_coords: trip.startLocationCoords ?? null,
    destinations: trip.destinations,
    destination_coords: trip.destinationCoords ?? null,
    start_date: trip.startDate, end_date: trip.endDate,
    travellers: trip.travellers, transport_mode: trip.transportMode, budget_per_person_inr: trip.budgetPerPersonInr,
    travel_style: trip.travelStyle, fixed_commitments: trip.fixedCommitments, days: trip.days,
    expenses: trip.expenses, cover_emoji: trip.coverEmoji, visibility: trip.visibility,
  }
  if (cols?.economy) row.fuel_economy_km_per_l = trip.fuelEconomyKmL ?? null
  if (cols?.price) row.fuel_price_per_l = trip.fuelPricePerL ?? null
  if (cols?.roundTrip) row.round_trip = trip.roundTrip ?? null
  if (cols?.cover) row.cover_image_url = trip.coverImageUrl ?? null
  if (cols?.inviteCode) row.invite_code = trip.inviteCode ?? null
  if (cols?.deleted) row.deleted_at = trip.deletedAt != null ? new Date(trip.deletedAt).toISOString() : null
  if (cols?.stayStyle) row.stay_style = trip.stayStyle ?? null
  // 1 is the legacy default — store 1 and undefined both as NULL, so the row
  // round-trips to `undefined` (engine falls back to 1 driver). 2/3 are the
  // only meaningful values written; anything else is junk and also NULL.
  if (cols?.driverCount) row.driver_count = (trip.driverCount === 2 || trip.driverCount === 3) ? trip.driverCount : null
  if (cols?.hasVulnerable) row.has_vulnerable = trip.hasVulnerable === true
  if (cols?.driveAfterDinner) row.drive_after_dinner_min = trip.driveAfterDinnerMin ?? null
  if (cols?.vehicleProfile) row.vehicle_profile = trip.vehicleProfile ?? null
  if (cols?.tankL) row.tank_l = sanitizeTankL(trip.tankL)
  if (cols?.rentPerDayInr) row.rent_per_day_inr = sanitizeRentPerDayInr(trip.rentPerDayInr)
  if (cols?.localTrain) row.local_train = typeof trip.localTrain === 'boolean' ? trip.localTrain : null
  if (cols?.ref) row.ref = trip.ref ?? null
  return row
}

/**
 * True when a Supabase/PostgREST error means "this column does not exist".
 * Anything else (network failure, auth/RLS, etc.) is transient and must NOT be
 * cached as a missing column — see issue #17.
 */
export function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: string }).code
  if (code === 'PGRST204' || code === '42703') return true
  const msg = (error as { message?: string }).message ?? ''
  return /could not find the ['"]?[a-z_]+['"]? column|column .* does not exist/i.test(msg)
}