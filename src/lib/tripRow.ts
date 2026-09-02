// ============ trips table serialization + Supabase error classification ============
// Pure helpers with NO react/supabase/toast imports, so the row mapping and the
// missing-column detection are unit-testable in the node test environment.
import type { Trip, ItineraryDay, TripMember, Expense, FixedCommitment, LatLngPoint } from '../data/types'

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
  days: ItineraryDay[]; expenses: Expense[]; cover_emoji: string;
  /** present only after the cover-image migration (see supabase/schema.sql) */
  cover_image_url?: string | null; visibility: 'private' | 'public';
  created_at: number; updated_at: number;
}

export function rowToTrip(row: TripRow, members: TripMember[]): Trip {
  return {
    id: row.id, name: row.name, startLocation: row.start_location, startLocationCoords: row.start_location_coords ?? undefined,
    destinations: row.destinations ?? [],
    destinationCoords: row.destination_coords ?? undefined,
    startDate: row.start_date, endDate: row.end_date, travellers: row.travellers,
    transportMode: row.transport_mode as Trip['transportMode'], budgetPerPersonInr: row.budget_per_person_inr,
    fuelEconomyKmL: row.fuel_economy_km_per_l ?? undefined,
    fuelPricePerL: row.fuel_price_per_l ?? undefined,
    roundTrip: row.round_trip ?? undefined,
    travelStyle: row.travel_style as Trip['travelStyle'], fixedCommitments: row.fixed_commitments ?? [],
    days: row.days ?? [], expenses: row.expenses ?? [], coverEmoji: row.cover_emoji,
    coverImageUrl: row.cover_image_url ?? undefined, visibility: row.visibility,
    createdAt: row.created_at, updatedAt: row.updated_at, members,
  }
}

export interface OptionalColumnsProbe {
  economy: boolean; price: boolean; roundTrip: boolean; cover: boolean
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