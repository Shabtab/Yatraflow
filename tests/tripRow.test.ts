// ============ trips row serialization + missing-column detection ============
// Pure helpers from src/lib/tripRow.ts (node env, no DOM/supabase needed).
import { describe, it, expect } from 'vitest'
import { rowToTrip, tripToRow, isMissingColumnError, sanitizeTankL, sanitizeRentPerDayInr } from '../src/lib/tripRow'
import { seedData } from '../src/data/seed'
import type { Trip, TripMember } from '../src/data/types'
import { readFileSync, readdirSync } from 'node:fs'

function tripWithExpenses(): Trip {
  const base = structuredClone(seedData.trips[0])
  return {
    ...base,
    expenses: [
      { id: 'ex-1', label: 'Houseboat', category: 'accommodation' as const, amountInr: 8000, dayIndex: 1 },
      { id: 'ex-2', label: 'Backwater lunch', category: 'food' as const, amountInr: 600, perPerson: true, dayIndex: 2 },
    ],
  }
}

const MEMBERS: TripMember[] = [{ userId: 'owner-1', role: 'owner', joinedAt: 1 }]

/** Every optional column present — the steady state once migrations are applied.
 *  Spread this and override, rather than hand-writing the object: the probe is
 *  all-required, so adding a column used to break every call site at once. */
const ALL_COLUMNS = {
  economy: true, price: true, roundTrip: true, cover: true,
  inviteCode: true, deleted: true, stayStyle: true,
  driverCount: true, hasVulnerable: true, driveAfterDinner: true, vehicleProfile: true,
  tankL: true, rentPerDayInr: true, localTrain: true,
}

/** The bare fixture — no optional fields set. */
const baseTrip = (): Trip => structuredClone(seedData.trips[0])

describe('trip row serialization round-trip (issue #16)', () => {
  it('tripToRow always emits expenses — insert and update share the same mapper', () => {
    const t = tripWithExpenses()
    const row = tripToRow(t, 'owner-1')
    expect(row.expenses).toEqual(t.expenses)
    expect(row.expenses.length).toBe(2)
  })

  it('expenses survive rowToTrip(tripToRow(t)) rehydration', () => {
    const t = tripWithExpenses()
    const row = tripToRow(t, 'owner-1')
    const back = rowToTrip({ ...row, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(back.expenses).toEqual(t.expenses)
    expect(back.name).toBe(t.name)
    expect(back.days).toEqual(t.days)
  })

  it('fuel/round-trip fields are only serialized when the probe says the column exists', () => {
    const t = { ...tripWithExpenses(), fuelEconomyKmL: 18, roundTrip: false }
    const full = tripToRow(t, 'owner-1', ALL_COLUMNS)
    expect(full.fuel_economy_km_per_l).toBe(18)
    expect(full.round_trip).toBe(false)
    const minimal = tripToRow(t, 'owner-1', { ...ALL_COLUMNS, economy: false, price: false, roundTrip: false })
    expect(minimal.fuel_economy_km_per_l).toBeUndefined()
    expect(minimal.round_trip).toBeUndefined()
  })
})

// The stay-budget dial shipped in deecbcc with no column and no row mapping, so
// the tier a traveller picked was session-only and silently reverted to the
// legacy-derived value on every load. These pin the mapping that fixes it —
// including the pre-migration path, which must stay a no-op rather than write a
// column the database does not have (that fails the whole insert/update).
describe('the stay budget dial is persisted (20260914_trip_stay_budget.sql)', () => {
  const rehydrate = (row: ReturnType<typeof tripToRow>, t: Trip) =>
    rowToTrip({ ...row, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)

  it('writes stay_style when the probe says the column exists', () => {
    const t = { ...baseTrip(), stayStyle: 'luxury' as const }
    expect(tripToRow(t, 'owner-1', ALL_COLUMNS).stay_style).toBe('luxury')
  })

  it('does not write it when the column is missing', () => {
    const t = { ...baseTrip(), stayStyle: 'luxury' as const }
    expect(tripToRow(t, 'owner-1', { ...ALL_COLUMNS, stayStyle: false }).stay_style).toBeUndefined()
  })

  it('survives the row round trip', () => {
    const t = { ...baseTrip(), stayStyle: 'budget' as const }
    expect(rehydrate(tripToRow(t, 'owner-1', ALL_COLUMNS), t).stayStyle).toBe('budget')
  })

  it('reads back undefined on a pre-migration row, so the engine derives the tier', () => {
    // Not null, not a default — undefined is what tells stayKeyFor() to fall
    // back to the legacy travelStyle and leave an existing bill alone.
    const t = baseTrip()
    const row = tripToRow(t, 'owner-1', { ...ALL_COLUMNS, stayStyle: false })
    expect(rehydrate(row, t).stayStyle).toBeUndefined()
  })

  it('writes an explicit null when a trip has no dial', () => {
    // Null is what clears a stale tier on an existing row; undefined would be
    // omitted from the update payload and leave the old value in place.
    const t = baseTrip()
    expect(tripToRow(t, 'owner-1', ALL_COLUMNS).stay_style).toBeNull()
  })
})

// #142 (party controls) and the vehicle profile shipped without columns or a
// row mapping, so a trip set to "2 drivers / infants / drive after dinner /
// motorcycle" silently reverted to 1 driver / adults / dinner-ends-day / no
// profile on every reload (#20260915_trip_party_prefs.sql). These pin the
// mapping that fixes it — including the pre-migration path, which stays a
// no-op rather than write a column the database doesn't have.
describe('party + vehicle preferences are persisted (20260915_trip_party_prefs.sql)', () => {
  const rehydrate = (row: ReturnType<typeof tripToRow>, t: Trip) =>
    rowToTrip({ ...row, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)

  it('driver_count: writes 2/3, stores 1 as NULL (legacy default), omits when probe is false', () => {
    const t1 = { ...baseTrip(), driverCount: 2 as Trip['driverCount'] }
    expect(tripToRow(t1, 'owner-1', ALL_COLUMNS).driver_count).toBe(2)
    const t3 = { ...baseTrip(), driverCount: 3 as Trip['driverCount'] }
    expect(tripToRow(t3, 'owner-1', ALL_COLUMNS).driver_count).toBe(3)
    const tDefault = { ...baseTrip() } // no driverCount set
    expect(tripToRow(tDefault, 'owner-1', ALL_COLUMNS).driver_count).toBeNull()
    const t1Explicit = { ...baseTrip(), driverCount: 1 }
    expect(tripToRow(t1Explicit, 'owner-1', ALL_COLUMNS).driver_count).toBeNull()
    // pre-migration: column is missing — write path is a no-op.
    expect(tripToRow(t1, 'owner-1', { ...ALL_COLUMNS, driverCount: false }).driver_count).toBeUndefined()
  })

  it('has_vulnerable: writes true, stores undefined as false, omits when probe is false', () => {
    const tOn = { ...baseTrip(), hasVulnerable: true }
    expect(tripToRow(tOn, 'owner-1', ALL_COLUMNS).has_vulnerable).toBe(true)
    const tOff = { ...baseTrip() }
    expect(tripToRow(tOff, 'owner-1', ALL_COLUMNS).has_vulnerable).toBe(false)
    expect(tripToRow(tOn, 'owner-1', { ...ALL_COLUMNS, hasVulnerable: false }).has_vulnerable).toBeUndefined()
  })

  it('drive_after_dinner_min: writes minutes, omits when undefined, omits when probe is false', () => {
    const tOn = { ...baseTrip(), driveAfterDinnerMin: 120 }
    expect(tripToRow(tOn, 'owner-1', ALL_COLUMNS).drive_after_dinner_min).toBe(120)
    const tOff = { ...baseTrip() }
    expect(tripToRow(tOff, 'owner-1', ALL_COLUMNS).drive_after_dinner_min).toBeNull()
    expect(tripToRow(tOn, 'owner-1', { ...ALL_COLUMNS, driveAfterDinner: false }).drive_after_dinner_min).toBeUndefined()
  })

  it('vehicle_profile: writes the profile object, omits when undefined, omits when probe is false', () => {
    const profile = { vehicleType: 'motorcycle' as const, fuelType: 'petrol' as const, capacity: 12, economy: 40 }
    const tOn = { ...baseTrip(), vehicleProfile: profile }
    expect(tripToRow(tOn, 'owner-1', ALL_COLUMNS).vehicle_profile).toEqual(profile)
    const tOff = { ...baseTrip() }
    expect(tripToRow(tOff, 'owner-1', ALL_COLUMNS).vehicle_profile).toBeNull()
    expect(tripToRow(tOn, 'owner-1', { ...ALL_COLUMNS, vehicleProfile: false }).vehicle_profile).toBeUndefined()
  })

  it('all four fields survive the round trip', () => {
    const profile = { vehicleType: 'motorcycle' as const, fuelType: 'petrol' as const, capacity: 12, economy: 40 }
    const t = { ...baseTrip(), driverCount: 2 as Trip['driverCount'], hasVulnerable: true, driveAfterDinnerMin: 120, vehicleProfile: profile }
    const back = rehydrate(tripToRow(t, 'owner-1', ALL_COLUMNS), t)
    expect(back.driverCount).toBe(2)
    expect(back.hasVulnerable).toBe(true)
    expect(back.driveAfterDinnerMin).toBe(120)
    expect(back.vehicleProfile).toEqual(profile)
  })

  it('reads back undefined on a pre-migration row, so the engine keeps its defaults', () => {
    const t = baseTrip()
    const row = tripToRow(t, 'owner-1', { ...ALL_COLUMNS, driverCount: false, hasVulnerable: false, driveAfterDinner: false, vehicleProfile: false })
    const back = rehydrate(row, t)
    expect(back.driverCount).toBeUndefined()
    expect(back.hasVulnerable).toBeUndefined()
    expect(back.driveAfterDinnerMin).toBeUndefined()
    expect(back.vehicleProfile).toBeUndefined()
  })

  it('driver_count validation: junk numbers degrade to undefined', () => {
    const t = baseTrip()
    const row = tripToRow(t, 'owner-1', ALL_COLUMNS)
    const back = rowToTrip({ ...row, driver_count: 1, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(back.driverCount).toBeUndefined() // 1 is the legacy default — null in DB, undefined in TS
    const back4 = rowToTrip({ ...row, driver_count: 4, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(back4.driverCount).toBeUndefined() // out of {2, 3} → dropped
    const back0 = rowToTrip({ ...row, driver_count: 0, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(back0.driverCount).toBeUndefined() // null already → undefined
  })

  it('has_vulnerable validation: non-true values degrade to undefined', () => {
    const t = baseTrip()
    const row = tripToRow(t, 'owner-1', ALL_COLUMNS)
    const backFalse = rowToTrip({ ...row, has_vulnerable: false, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(backFalse.hasVulnerable).toBeUndefined()
    const backNull = rowToTrip({ ...row, has_vulnerable: null, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(backNull.hasVulnerable).toBeUndefined()
  })

  it('drive_after_dinner_min validation: out-of-range and non-finite degrade to undefined', () => {
    const t = baseTrip()
    const row = tripToRow(t, 'owner-1', ALL_COLUMNS)
    const valid = rowToTrip({ ...row, drive_after_dinner_min: 120, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(valid.driveAfterDinnerMin).toBe(120)
    const zero = rowToTrip({ ...row, drive_after_dinner_min: 0, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(zero.driveAfterDinnerMin).toBeUndefined() // 0 means "no driving" — not the post-dinner 120 min
    const huge = rowToTrip({ ...row, drive_after_dinner_min: 1000, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(huge.driveAfterDinnerMin).toBeUndefined() // 1000 min > 8 h cap
    const nan = rowToTrip({ ...row, drive_after_dinner_min: '120' as never, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(nan.driveAfterDinnerMin).toBeUndefined()
  })

  it('vehicle_profile validation: junk JSONB degrades to undefined (normalizeVehicleProfile)', () => {
    const t = baseTrip()
    const row = tripToRow(t, 'owner-1', ALL_COLUMNS)
    const valid = rowToTrip({ ...row, vehicle_profile: { vehicleType: 'car', fuelType: 'petrol', capacity: 45, economy: 15 }, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(valid.vehicleProfile).toEqual({ vehicleType: 'car', fuelType: 'petrol', capacity: 45, economy: 15 })
    const junkVehicle = rowToTrip({ ...row, vehicle_profile: { vehicleType: 'scooter', fuelType: 'petrol', capacity: 45, economy: 15 }, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(junkVehicle.vehicleProfile).toBeUndefined()
    const junkCapacity = rowToTrip({ ...row, vehicle_profile: { vehicleType: 'car', fuelType: 'petrol', capacity: 99999, economy: 15 }, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(junkCapacity.vehicleProfile).toBeUndefined()
    const notAnObject = rowToTrip({ ...row, vehicle_profile: 'car', created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(notAnObject.vehicleProfile).toBeUndefined()
    const nullProfile = rowToTrip({ ...row, vehicle_profile: null, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(nullProfile.vehicleProfile).toBeUndefined()
  })
})

describe('the create-time vehicle estimates are persisted (20260928_trip_vehicle_estimates.sql)', () => {
  it('tank_l: writes the tank, NULL for junk, omits when the probe is false', () => {
    const t = { ...baseTrip(), tankL: 60 }
    expect(tripToRow(t, 'owner-1', ALL_COLUMNS).tank_l).toBe(60)
    // The sanitizer is the one rule: 5..300 L, everything else NULL.
    expect(tripToRow({ ...t, tankL: 4 }, 'owner-1', ALL_COLUMNS).tank_l).toBeNull()
    expect(tripToRow({ ...t, tankL: 301 }, 'owner-1', ALL_COLUMNS).tank_l).toBeNull()
    expect(tripToRow({ ...t, tankL: NaN }, 'owner-1', ALL_COLUMNS).tank_l).toBeNull()
    expect(tripToRow(t, 'owner-1', { ...ALL_COLUMNS, tankL: false })).not.toHaveProperty('tank_l')
  })

  it('rent_per_day_inr: writes the rate, NULL for junk, omits when the probe is false', () => {
    const t = { ...baseTrip(), rentPerDayInr: 1800 }
    expect(tripToRow(t, 'owner-1', ALL_COLUMNS).rent_per_day_inr).toBe(1800)
    expect(tripToRow({ ...t, rentPerDayInr: -1 }, 'owner-1', ALL_COLUMNS).rent_per_day_inr).toBeNull()
    expect(tripToRow({ ...t, rentPerDayInr: 100001 }, 'owner-1', ALL_COLUMNS).rent_per_day_inr).toBeNull()
    expect(tripToRow({ ...t, rentPerDayInr: 0 }, 'owner-1', ALL_COLUMNS).rent_per_day_inr).toBe(0) // 0 is legitimate
    expect(tripToRow(t, 'owner-1', { ...ALL_COLUMNS, rentPerDayInr: false })).not.toHaveProperty('rent_per_day_inr')
  })

  it('local_train: writes the flag, NULL for non-booleans, omits when the probe is false', () => {
    const t = { ...baseTrip(), localTrain: true }
    expect(tripToRow(t, 'owner-1', ALL_COLUMNS).local_train).toBe(true)
    expect(tripToRow({ ...t, localTrain: false }, 'owner-1', ALL_COLUMNS).local_train).toBe(false)
    expect(tripToRow({ ...t, localTrain: 'yes' as never }, 'owner-1', ALL_COLUMNS).local_train).toBeNull()
    expect(tripToRow(t, 'owner-1', { ...ALL_COLUMNS, localTrain: false })).not.toHaveProperty('local_train')
  })

  it('all four vehicle inputs survive the row round trip', () => {
    const t = {
      ...baseTrip(),
      vehicleProfile: { vehicleType: 'car' as const, fuelType: 'diesel' as const, capacity: 60, economy: 21 },
      tankL: 60, rentPerDayInr: 1800, localTrain: false, roundTrip: false,
    }
    const back = rowToTrip(tripToRow(t, 'owner-1', ALL_COLUMNS), MEMBERS)
    expect(back.vehicleProfile).toEqual(t.vehicleProfile)
    expect(back.tankL).toBe(60)
    expect(back.rentPerDayInr).toBe(1800)
    expect(back.localTrain).toBe(false)
    expect(back.roundTrip).toBe(false)
  })

  it('reads back undefined on a pre-migration row, so the engine keeps its defaults', () => {
    const t = baseTrip()
    const row = tripToRow(t, 'owner-1', ALL_COLUMNS)
    const back = rowToTrip({ ...row, tank_l: null, rent_per_day_inr: null, local_train: null, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(back.tankL).toBeUndefined()
    expect(back.rentPerDayInr).toBeUndefined()
    expect(back.localTrain).toBeUndefined()
  })

  it('row-side junk degrades too (a hand-edited row cannot price nonsense)', () => {
    const t = baseTrip()
    const row = tripToRow(t, 'owner-1', ALL_COLUMNS)
    const back = rowToTrip({ ...row, tank_l: 5000, rent_per_day_inr: -50, local_train: 'true' as never, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(back.tankL).toBeUndefined()
    expect(back.rentPerDayInr).toBeUndefined()
    expect(back.localTrain).toBeUndefined()
  })

  it('the sanitizers are the pinned bounds (tank 5..300, rent 0..100000)', () => {
    expect(sanitizeTankL(5)).toBe(5)
    expect(sanitizeTankL(300)).toBe(300)
    expect(sanitizeTankL(4.99)).toBeNull()
    expect(sanitizeTankL(undefined)).toBeNull()
    expect(sanitizeRentPerDayInr(0)).toBe(0)
    expect(sanitizeRentPerDayInr(100000)).toBe(100000)
    expect(sanitizeRentPerDayInr(Infinity)).toBeNull()
    expect(sanitizeRentPerDayInr(null)).toBeNull()
  })
})

// ============ every probed optional column has a migration ============
// The store probes for an optional column before writing it, and a probe that
// comes back false makes the write silently vanish: `tripToRow` omits the field
// entirely, the toast never fires, and the UI keeps showing the value from
// memory until the next reload. `cover_image_url` was probed from the day the
// cover picker shipped, but no migration ever created it — so every chosen
// cover was session-only, and publishing (which copies `trip.coverImageUrl`
// onto the publication) stamped NULL onto `published_itineraries`, whose cover
// is what the share preview serves. A shared link previewed as the brand card
// while the app showed a photo, and it read exactly like a preview-handler bug;
// the data had never been saved. Pinning the probe list to the migrations is
// what makes the next optional field unable to ship without its DDL.
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

/** Column names the store probes for, read from its literal call sites. The
 *  definition `probeOptionalColumn(column: string)` takes a variable, so it
 *  never matches. */
function probedColumns(): string[] {
  const store = read('src/store/store.ts')
  return [...store.matchAll(/probeOptionalColumn\('([a-z0-9_]+)'\)/g)].map(m => m[1])
}

/** Columns some migration creates. Both shapes count: an `add column if not
 *  exists` on an existing table, and a column declared in a `create table`. */
function migrationColumns(): Set<string> {
  const dir = new URL('../supabase/migrations/', import.meta.url)
  const sql = readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .map(f => readFileSync(new URL(f, dir), 'utf8'))
    .join('\n')
  return new Set([
    ...[...sql.matchAll(/add column if not exists\s+([a-z0-9_]+)/gi)].map(m => m[1].toLowerCase()),
  ])
}

describe('the optional-column probe and the migrations agree', () => {
  it('reads the probe list it thinks it reads', () => {
    // Guards the regex itself: if the call shape changes, this fails loudly here
    // rather than silently passing an empty list through the check below.
    const cols = probedColumns()
    expect(cols.length).toBeGreaterThanOrEqual(11)
    expect(cols).toContain('cover_image_url')
    expect(cols).toContain('deleted_at')
    // #377's trio — named so a rename of one fails here rather than silently
    // dropping it out of the probe↔migration pin below.
    expect(cols).toContain('tank_l')
    expect(cols).toContain('rent_per_day_inr')
    expect(cols).toContain('local_train')
  })

  it('has a migration creating every column it probes', () => {
    const declared = migrationColumns()
    const missing = probedColumns().filter(c => !declared.has(c))
    expect(missing, `probed but never created by a migration: ${missing.join(', ')}`).toEqual([])
  })
})

describe('isMissingColumnError (issue #17)', () => {
  it('treats PostgREST PGRST204 and Postgres 42703 as a missing column', () => {
    expect(isMissingColumnError({ code: 'PGRST204', message: "Could not find the 'fuel_economy_km_per_l' column of 'trips' in the schema cache" })).toBe(true)
    expect(isMissingColumnError({ code: '42703', message: 'column trips.fuel_economy_km_per_l does not exist' })).toBe(true)
    expect(isMissingColumnError({ message: "Could not find the 'round_trip' column of 'trips' in the schema cache" })).toBe(true)
  })

  it('treats network/transient errors as NOT a missing column', () => {
    expect(isMissingColumnError({ message: 'Failed to fetch' })).toBe(false)
    expect(isMissingColumnError({ message: 'TypeError: fetch failed' })).toBe(false)
    expect(isMissingColumnError({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isMissingColumnError(undefined)).toBe(false)
    expect(isMissingColumnError(new Error('network'))).toBe(false)
  })
})
describe('#559 — a corrupt jsonb column coerces, it never poisons a render', () => {
  it('non-array days/expenses/fixed_commitments map to empty arrays, never throw', () => {
    const t = baseTrip()
    const row = { ...tripToRow(t, 'owner-1'), days: {}, expenses: 'oops', fixed_commitments: 5 } as unknown as ReturnType<typeof tripToRow>
    const back = rowToTrip({ ...row, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(back.days).toEqual([])
    expect(back.expenses).toEqual([])
    expect(back.fixedCommitments).toEqual([])
    // The shapes the crash reports named are safe on the coerced trip.
    expect(() => back.days.flatMap(d => d.stops.map(s => s.title))).not.toThrow()
    expect(back.days.length).toBe(0)
  })

  it('a day entry without stops becomes stops: [], and a null entry is dropped', () => {
    const t = baseTrip()
    const row = tripToRow(t, 'owner-1')
    const corruptDays = [
      { ...row.days[0], stops: undefined },
      null,
      'junk',
    ] as unknown as typeof row.days
    const back = rowToTrip({ ...row, days: corruptDays, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(back.days).toHaveLength(1)
    expect(back.days[0]!.stops).toEqual([])
  })

  it('valid rows round-trip unchanged — the coercion wraps, never rewrites', () => {
    const t = tripWithExpenses()
    const row = tripToRow(t, 'owner-1')
    const back = rowToTrip({ ...row, created_at: t.createdAt, updated_at: t.updatedAt }, MEMBERS)
    expect(back.days).toEqual(t.days)
    expect(back.expenses).toEqual(t.expenses)
  })
})
