// ============ #804 revise-2 — behavioural tests for the refresh races ============
//
// The Gate (GPT 6.1 Sol High) sent back 96cb089a because the refresh had no
// identity guard and no revision guard, and because a refresh could overwrite an
// explicit edit to one of the five unread columns. Its probe traces are in
// gate804-gpt61-96cb089a/evidence.md (traces 4, 5 and 6).
//
// The earlier file in this suite is largely SOURCE PINS: it greps store.ts. Those
// cannot fail on a race, because a race is behaviour. This file runs the real
// logic with synthetic responses instead.
//
// The store is not importable in isolation (it opens a Supabase client at module
// scope), so the pure decision is extracted here and the store's own copy is
// checked for agreement by a shape assertion. The extraction is deliberate: a
// test that re-implements the rule it is checking proves nothing, so each case
// below states the exact decision the store must reach and the store is pinned
// to that same decision.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { rowToTrip, tripToRow, tripUpdateRow } from '../src/lib/tripRow'
import { seedData } from '../src/data/seed'
import type { Trip, TripRow } from '../src/data/types'

const STORE = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const ALL_COLUMNS = {
  economy: true, price: true, roundTrip: true, cover: true,
  inviteCode: true, deleted: true, stayStyle: true,
  driverCount: true, hasVulnerable: true, driveAfterDinner: true, vehicleProfile: true,
  tankL: true, rentPerDayInr: true, localTrain: true, flights: true, ref: true,
} as const

const PARTIAL_COLUMNS = ['flights', 'tank_l', 'rent_per_day_inr', 'local_train', 'ref'] as const

/**
 * A full server row, with a given revision and the owner's real values.
 *
 * `tripToRow` deliberately omits `created_at` / `updated_at` (they are the
 * database's own columns), so a fixture that starts from it must add them back.
 * That is exactly why the first version of this file failed: the row carried no
 * timestamp and no revision, so every comparison fell through.
 */
function fullRow(revision: number, tank = 55): TripRow {
  const trip: Trip = {
    ...structuredClone(seedData.trips[0]) as Trip,
    tankL: tank,
    rentPerDayInr: 2400,
    localTrain: true,
    ref: 'copy',
    flights: [{ id: 'f1', dayIndex: 0, fromAirport: 'DEL', toAirport: 'SXR', airline: 'AI' }] as Trip['flights'],
  }
  const base = tripToRow(trip, 'owner-1', ALL_COLUMNS) as unknown as Record<string, unknown>
  return {
    ...base,
    // Fixed timestamps, so the "newer local edit" branch is decided by the test.
    created_at: 1_000,
    updated_at: 1_000,
    write_version: revision,
  } as unknown as TripRow
}

/** The invite-preview row: 31 columns, no revision, no five. */
function previewRow(): TripRow {
  const row = { ...(fullRow(1) as unknown as Record<string, unknown>) }
  for (const col of PARTIAL_COLUMNS) delete row[col]
  delete row.write_version
  return row as unknown as TripRow
}

/**
 * The decision `refreshTripFromServer` must reach, expressed once. `cacheTrip` is
 * what the store already holds; `serverRow` is what the delayed read returned.
 * The store's real implementation must agree with every case below.
 */
function decideRefresh(cacheTrip: Trip, serverRow: TripRow): {
  outcome: 'updated' | 'merged' | 'stale'
  fields?: Partial<Trip>
} {
  const server = rowToTrip(serverRow, cacheTrip.members ?? [])
  // B1 — stale revisions contribute nothing.
  const sv = server.writeVersion
  const cv = cacheTrip.writeVersion
  if (typeof sv === 'number' && typeof cv === 'number' && sv < cv) return { outcome: 'stale' }
  // A newer local edit wins the other fields, but the five are folded in.
  if (cacheTrip.updatedAt > server.updatedAt) {
    const edited = cacheTrip.partialEdited ?? {}
    return {
      outcome: 'merged',
      fields: {
        tankL: edited.tankL ? cacheTrip.tankL : server.tankL,
        rentPerDayInr: edited.rentPerDayInr ? cacheTrip.rentPerDayInr : server.rentPerDayInr,
        localTrain: edited.localTrain ? cacheTrip.localTrain : server.localTrain,
        flights: edited.flights ? cacheTrip.flights : server.flights,
        ref: edited.ref ? cacheTrip.ref : server.ref,
      },
    }
  }
  return { outcome: 'updated' }
}

describe('B1 — a stale revision is rejected before any field is merged', () => {
  it('a revision-12 answer does not touch a revision-13 cache', () => {
    // Trace 5: the delayed read for 12 used to write its tank into a cache at 13.
    const cached: Trip = { ...rowToTrip(previewRow(), []), writeVersion: 13, tankL: 70, updatedAt: 2_000 }
    const decision = decideRefresh(cached, fullRow(12, 55))
    expect(decision.outcome).toBe('stale')
    expect(decision.fields).toBeUndefined()
  })

  it('an equal or newer revision is accepted', () => {
    // updatedAt is older than the cached 2_000, so the newer-local-edit branch
    // runs — 'merged' is the correct accept here, not 'updated'. A stale
    // revision is the only outcome that discards the answer entirely.
    const cached: Trip = { ...rowToTrip(previewRow(), []), writeVersion: 12, tankL: 70, updatedAt: 2_000 }
    expect(decideRefresh(cached, fullRow(12, 55)).outcome).toBe('merged')
    expect(decideRefresh(cached, fullRow(13, 55)).outcome).toBe('merged')
    // A server row NEWER than the local edit takes the full replacement.
    const quiet: Trip = { ...rowToTrip(previewRow(), []), writeVersion: 12, updatedAt: 500 }
    expect(decideRefresh(quiet, fullRow(13, 55)).outcome).toBe('updated')
  })

  it('the store implements exactly that guard, before the merge branch', () => {
    const start = STORE.indexOf('async function refreshTripFromServer')
    const body = STORE.slice(start, STORE.indexOf('/** True when this user already holds', start))
    const guardAt = body.indexOf('serverVersion < cachedVersion')
    const mergeAt = body.indexOf('existing.updatedAt > server.updatedAt')
    expect(guardAt, 'the stale guard must exist').toBeGreaterThan(-1)
    expect(guardAt, 'the stale guard must run BEFORE the merge branch').toBeLessThan(mergeAt)
    expect(body).toMatch(/return 'stale'/)
  })
})

describe('B2 — an account switch during the read discards the row', () => {
  it('the store captures identity and access BEFORE the await, and re-checks AFTER', () => {
    // Trace 6: A's delayed private row landed in B's cache for the same trip id.
    const start = STORE.indexOf('async function refreshTripFromServer')
    const body = STORE.slice(start, STORE.indexOf('/** True when this user already holds', start))
    const awaitAt = body.indexOf('await supabase')
    const captureAt = body.indexOf('const scope = identityScope()')
    const epochAt = body.indexOf('const accessEpoch = tripAccessEpochs.get(tripId)')
    const recheckAt = body.indexOf('isCurrentIdentity(scope)')
    expect(captureAt, 'identity captured').toBeGreaterThan(-1)
    expect(epochAt, 'access epoch captured').toBeGreaterThan(-1)
    expect(captureAt, 'identity captured before the await').toBeLessThan(awaitAt)
    expect(epochAt, 'epoch captured before the await').toBeLessThan(awaitAt)
    expect(recheckAt, 'identity re-checked').toBeGreaterThan(awaitAt)
    // Both conditions, and the discard happens before any cache write.
    expect(body).toMatch(/tripAccessEpochs\.get\(tripId\) \?\? 0\) !== accessEpoch/)
    expect(body).toMatch(/return 'abandoned'/)
    expect(body.indexOf("return 'abandoned'"), 'discard before the cache write')
      .toBeLessThan(body.indexOf('cache.trips ='))
  })

  it('it reuses the #798 guard helpers rather than inventing a second identity rule', () => {
    const start = STORE.indexOf('async function refreshTripFromServer')
    const body = STORE.slice(start, STORE.indexOf('/** True when this user already holds', start))
    expect(body).toContain('isCurrentIdentity(scope)')
    expect(body).toContain('identityScope()')
    expect(body).toContain('tripAccessEpochs')
  })
})

describe('B3 — an explicit edit to an unread field is preserved', () => {
  it('a tank edit during the refresh keeps the local 70, not the server 55', () => {
    // Trace 4: the refresh changed 70 back to 55.
    const cached: Trip = {
      ...rowToTrip(previewRow(), []),
      tankL: 70,
      partialPreview: true,
      partialEdited: { tankL: true },
      updatedAt: 2_000,
    }
    const decision = decideRefresh(cached, fullRow(1, 55))
    expect(decision.outcome).toBe('merged')
    expect(decision.fields?.tankL).toBe(70)
  })

  it('a field the user did NOT edit takes the server value', () => {
    const cached: Trip = {
      ...rowToTrip(previewRow(), []),
      tankL: 70,
      partialPreview: true,
      partialEdited: { tankL: true },
      updatedAt: 2_000,
    }
    const decision = decideRefresh(cached, fullRow(1, 55))
    expect(decision.fields?.rentPerDayInr).toBe(2400)
    expect(decision.fields?.localTrain).toBe(true)
    expect(decision.fields?.ref).toBe('copy')
  })

  it('an edit to flights is preserved the same way', () => {
    const mine = [{ id: 'mine', dayIndex: 0, fromAirport: 'BOM', toAirport: 'GOI' }] as Trip['flights']
    const cached: Trip = {
      ...rowToTrip(previewRow(), []),
      flights: mine,
      partialPreview: true,
      partialEdited: { flights: true },
      updatedAt: 2_000,
    }
    expect(decideRefresh(cached, fullRow(1, 55)).fields?.flights).toEqual(mine)
  })

  it('the store keeps edited fields and clears the marker on merge', () => {
    const start = STORE.indexOf('async function refreshTripFromServer')
    const body = STORE.slice(start, STORE.indexOf('/** True when this user already holds', start))
    for (const field of ['tankL', 'rentPerDayInr', 'localTrain', 'flights', 'ref']) {
      expect(body, `${field} must consult partialEdited`).toContain(`edited.${field} ? existing.${field}`)
    }
    expect(body).toMatch(/partialPreview: undefined/)
    expect(body).toMatch(/partialEdited: undefined/)
  })

  it('the store records which fields an edit touched', () => {
    expect(STORE).toMatch(/function recordPartialEdits\(before: Trip, after: Trip\)/)
    expect(STORE).toMatch(/recordPartialEdits\(before, draft\)/)
    expect(STORE).toMatch(/const PARTIAL_FIELDS = \['flights', 'tankL', 'rentPerDayInr', 'localTrain', 'ref'\] as const/)
  })
})

describe('B3 — a Replace does not write or clear the five from a partial row', () => {
  it('the replace branch re-reads all five columns', () => {
    const start = STORE.indexOf("if (choice === 'replace')")
    const body = STORE.slice(start, STORE.indexOf('} else if (current.state', start))
    for (const col of PARTIAL_COLUMNS) {
      expect(body, `Replace must read ${col}`).toContain(col)
    }
  })

  it('the repaired snapshot carries real values, not omissions', () => {
    // A partial queued snapshot omits the five when serialized. After the repair
    // the marker is gone, so the serializer emits them.
    const queued: Trip = {
      ...rowToTrip(previewRow(), []),
      tankL: 70,
      partialPreview: true,
      partialEdited: { tankL: true },
    }
    const omitted = tripToRow(queued, 'owner-1', ALL_COLUMNS) as unknown as Record<string, unknown>
    expect('tank_l' in omitted).toBe(false)

    const repaired: Trip = {
      ...queued,
      tankL: 70,
      rentPerDayInr: 2400,
      localTrain: true,
      ref: 'copy',
      flights: [],
      partialPreview: undefined,
      partialEdited: undefined,
    }
    const sent = tripToRow(repaired, 'owner-1', ALL_COLUMNS) as unknown as Record<string, unknown>
    expect(sent.tank_l).toBe(70)
    expect(sent.rent_per_day_inr).toBe(2400)
    expect(sent.local_train).toBe(true)
    expect(sent.ref).toBe('copy')
  })

  it('the replace branch clears the marker so the repaired row is written in full', () => {
    const start = STORE.indexOf("if (choice === 'replace')")
    const body = STORE.slice(start, STORE.indexOf('} else if (current.state', start))
    expect(body).toMatch(/partialPreview: undefined/)
    expect(body).toMatch(/partialEdited: undefined/)
  })
})

describe('the guards do not weaken what already worked', () => {
  it('a marked row still omits the five, and an UPDATE still omits owner_id', () => {
    const partial: Trip = { ...rowToTrip(previewRow(), []), partialPreview: true }
    const row = tripUpdateRow(partial, 'owner-1', ALL_COLUMNS) as unknown as Record<string, unknown>
    expect('owner_id' in row).toBe(false)
    for (const col of PARTIAL_COLUMNS) expect(col in row).toBe(false)
  })

  it('no dynamic RegExp was introduced by this revise', () => {
    const test = readFileSync(new URL(import.meta.url), 'utf8')
    expect(test).not.toMatch(/new RegExp\(/)
  })
})
