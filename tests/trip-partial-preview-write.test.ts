// ============ #804 — a partial preview row must never write what it did not read ============
//
// The invite-code RPC (migrations/20260926_paywall_invite_code_leak.sql:224)
// names 31 of the trips table's 34 columns. The five it omits are `flights`,
// `tank_l`, `rent_per_day_inr`, `local_train` and `ref`.
//
// `fetchTripByInviteCode` puts that row straight into cache.trips
// (store.ts:1371), `joinViaInvite` mutates the cached trip (:3028), and the
// whole-row write at :2798 / :2858 calls tripToRow. Without a guard the absent
// columns read as `undefined`, sanitizeFlights turns that into `[]`, and the
// write sends [] and null over the OWNER's real values.
//
// The trace that makes this reachable, and not a race:
//   * hydrate scopes trips by `myTripIds`, built from the user's OWN membership
//     rows (store.ts:790-791). Before the join this user has no membership, so
//     hydration never reads the trip (:852, :854) and never replaces the row.
//   * fetchSharedTrip returns the cached row without reading (:1260-1261).
//   * fetchTripIntoCache is insert-if-absent (:4543), so even a realtime fetch
//     for an already-cached id does not replace it.
// The marker is therefore the only thing standing between the preview and a
// destructive write.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { rowToTrip, tripToRow } from '../src/lib/tripRow'
import { seedData } from '../src/data/seed'
import type { Trip, TripRow } from '../src/data/types'

const ALL_COLUMNS = {
  economy: true, price: true, roundTrip: true, cover: true,
  inviteCode: true, deleted: true, stayStyle: true,
  driverCount: true, hasVulnerable: true, driveAfterDinner: true, vehicleProfile: true,
  tankL: true, rentPerDayInr: true, localTrain: true, flights: true,
  ref: true,
} as const

/** The five columns the invite-code RPC does not return. */
const PARTIAL_COLUMNS = ['flights', 'tank_l', 'rent_per_day_inr', 'local_train', 'ref'] as const

/**
 * A row shaped exactly like the invite RPC's output: the owner's real values for
 * the five columns are ABSENT, not null and not empty.
 */
function inviteRpcRow(ownerTrip: Trip): TripRow {
  const full = tripToRow(ownerTrip, 'owner-1', ALL_COLUMNS) as Record<string, unknown>
  const row: Record<string, unknown> = { ...full }
  for (const col of PARTIAL_COLUMNS) delete row[col]
  return row as unknown as TripRow
}

/** The owner's trip, with real values in every column the RPC omits. */
function ownerTripWithData(): Trip {
  const base = structuredClone(seedData.trips[0]) as Trip
  return {
    ...base,
    flights: [
      { id: 'f1', dayIndex: 0, fromAirport: 'DEL', toAirport: 'SXR', airline: 'AI', costInrPerPerson: 5400 },
    ] as Trip['flights'],
    tankL: 55,
    rentPerDayInr: 2400,
    localTrain: true,
    ref: 'copy',
  }
}

describe('#804 — the partial preview row', () => {
  it('the RPC row really is missing the five columns (fixture sanity)', () => {
    const row = inviteRpcRow(ownerTripWithData()) as unknown as Record<string, unknown>
    for (const col of PARTIAL_COLUMNS) expect(col in row, `${col} must be absent`).toBe(false)
  })

  it('rowToTrip turns the absent columns into undefined, which is what makes the write destructive', () => {
    // Not a bug in rowToTrip: it cannot tell "absent" from "empty". That is
    // exactly why the marker has to travel on the Trip.
    const trip = rowToTrip(inviteRpcRow(ownerTripWithData()), [])
    expect(trip.flights).toBeUndefined()
    expect(trip.tankL).toBeUndefined()
    expect(trip.rentPerDayInr).toBeUndefined()
    expect(trip.localTrain).toBeUndefined()
    expect(trip.ref).toBeUndefined()
  })

  it('a whole-row write from the UNMARKED partial trip WOULD destroy the owner data (the bug)', () => {
    // This is the control: it shows the defect the marker prevents. If this test
    // ever stops failing to preserve the values, the guard below is redundant
    // and should be re-examined.
    const partial = rowToTrip(inviteRpcRow(ownerTripWithData()), [])
    const written = tripToRow(partial, 'owner-1', ALL_COLUMNS)
    expect(written.flights).toEqual([])
    expect(written.tank_l).toBeNull()
    expect(written.rent_per_day_inr).toBeNull()
    expect(written.local_train).toBeNull()
    expect(written.ref).toBeNull()
  })

  it('a MARKED partial trip omits all five columns from the write', () => {
    const partial: Trip = { ...rowToTrip(inviteRpcRow(ownerTripWithData()), []), partialPreview: true }
    const written = tripToRow(partial, 'owner-1', ALL_COLUMNS) as unknown as Record<string, unknown>
    for (const col of PARTIAL_COLUMNS) {
      expect(col in written, `${col} must not be sent`).toBe(false)
    }
  })

  it('the marker does not suppress anything the RPC DID return', () => {
    // A guard that also dropped read columns would be a second data-loss bug.
    const full = ownerTripWithData()
    const partial: Trip = { ...rowToTrip(inviteRpcRow(full), []), partialPreview: true }
    const written = tripToRow(partial, 'owner-1', ALL_COLUMNS)
    expect(written.name).toBe(full.name)
    expect(written.days).toEqual(tripToRow(full, 'owner-1', ALL_COLUMNS).days)
    expect(written.expenses).toEqual(tripToRow(full, 'owner-1', ALL_COLUMNS).expenses)
    expect(written.visibility).toBe(full.visibility)
  })

  it('a full row clears the marker, and then every column is written again', () => {
    // The realtime UPDATE path and the post-join refetch both build the row with
    // rowToTrip, which never sets partialPreview.
    const full = ownerTripWithData()
    const refetched = rowToTrip(tripToRow(full, 'owner-1', ALL_COLUMNS), [])
    expect(refetched.partialPreview).toBeUndefined()
    const written = tripToRow(refetched, 'owner-1', ALL_COLUMNS)
    expect(written.flights).toEqual(full.flights)
    expect(written.tank_l).toBe(55)
    expect(written.rent_per_day_inr).toBe(2400)
    expect(written.local_train).toBe(true)
    expect(written.ref).toBe('copy')
  })

  it('the marker survives the store’s structuredClone-based mutation', () => {
    // mutateTrip clones the cached trip, so a marker held on the Trip is still
    // there for the write that follows the mutation.
    const partial: Trip = { ...rowToTrip(inviteRpcRow(ownerTripWithData()), []), partialPreview: true }
    const mutated = structuredClone(partial)
    mutated.name = 'Renamed by the new editor'
    expect(mutated.partialPreview).toBe(true)
    const written = tripToRow(mutated, 'owner-1', ALL_COLUMNS) as unknown as Record<string, unknown>
    expect('flights' in written).toBe(false)
    expect(written.name).toBe('Renamed by the new editor')
  })

  it('partialPreview is never a column: tripToRow has no key for it', () => {
    const partial: Trip = { ...ownerTripWithData(), partialPreview: true }
    const written = tripToRow(partial, 'owner-1', ALL_COLUMNS) as unknown as Record<string, unknown>
    expect('partialPreview' in written).toBe(false)
    expect('partial_preview' in written).toBe(false)
  })
})

describe('#804 — the wiring that makes the marker necessary', () => {
  const store = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  /** Code only: the file's comments discuss the very lines these pins read. */
  const code = store.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')

  it('fetchTripByInviteCode marks the trip it builds from the RPC row', () => {
    const start = code.indexOf('export async function fetchTripByInviteCode')
    const body = code.slice(start, code.indexOf('export async function', start + 10))
    expect(body).toMatch(/partialPreview:\s*true/)
    expect(body).toMatch(/rowToTrip\(rows\[0\], \[\]\)/)
  })

  it('hydration scopes trips by the viewer’s own memberships, so it cannot replace the preview first', () => {
    // myTripIds comes from the user's membership rows; a pre-join visitor has
    // none, so stage 2 skips the trips read entirely.
    expect(code).toMatch(/const myRows = \(myMembershipsRes\.data \?\? \[\]\) as MemberRow\[\]/)
    expect(code).toMatch(/const myTripIds = \[\.\.\.new Set\(memberTripIds\)\]/)
    expect(code).toMatch(/if \(admin \|\| myTripIds\.length > 0\)/)
    expect(code).toMatch(/\.from\('trips'\)\.select\('\*'\)\.in\('id', myTripIds\)/)
  })

  it('fetchTripIntoCache is insert-if-absent, so it does not replace a cached preview', () => {
    const start = code.indexOf('async function fetchTripIntoCache')
    const body = code.slice(start, code.indexOf('const tripFetches', start))
    expect(body).toMatch(/if \(!cache\.trips\.some\(t => t\.id === trip\.id\)\) cache\.trips = \[\.\.\.cache\.trips, trip\]/)
  })

  it('fetchSharedTrip returns the cached row before reading', () => {
    const start = code.indexOf('export async function fetchSharedTrip')
    const body = code.slice(start, start + 400)
    expect(body).toMatch(/const local = tripById\(tripId\)/)
    expect(body).toMatch(/if \(local\) return local/)
  })

  it('the join refetches the full row, which clears the marker', () => {
    const start = code.indexOf('export async function joinViaInvite')
    const body = code.slice(start, code.indexOf('export async function', start + 10))
    expect(body).toMatch(/refreshTripFromServer\(tripId\)/)
    // The refetch must not clobber a local edit that landed while it was in flight.
    const refresh = code.slice(code.indexOf('async function refreshTripFromServer'))
    expect(refresh).toMatch(/existing\.updatedAt > \(data as TripRow\)\.updated_at/)
  })

  it('the RPC still returns 31 columns: this fix does not widen the anon read', () => {
    // The guard is the client-side answer precisely so the RPC stays narrow.
    const migration = readFileSync(
      new URL('../supabase/migrations/20260926_paywall_invite_code_leak.sql', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n')
    const start = migration.indexOf('create or replace function public.get_trip_by_invite_code')
    const body = migration.slice(start, migration.indexOf('from public.trips t', start))
    const selected = [...body.matchAll(/\bt\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1])
    expect(selected.length).toBe(31)
    for (const col of PARTIAL_COLUMNS) {
      expect(selected, `the RPC must not start returning ${col}`).not.toContain(col)
    }
  })
})
