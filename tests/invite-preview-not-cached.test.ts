// ============ #804 — the invite preview never enters the writable cache ============
//
// The invite-code RPC (migrations/20260926_paywall_invite_code_leak.sql:224)
// returns 31 of the 34 trips columns. The five it omits are flights, tank_l,
// rent_per_day_inr, local_train and ref.
//
// An earlier design put that partial row into cache.trips and marked it, then
// taught every writer to skip the five. Two Gates showed the guard leaking
// through each consumer of the cache in turn — stale revisions, account
// switches, explicit edits, Replace, timestamp masking, unknown revisions.
//
// The design now is the cause-level fix: the partial row is RETURNED to the
// caller (App.tsx keeps it in local state for the gate) and is never cached,
// queued or snapshotted. A partial row that is not in the writable cache cannot
// be built into a whole-row UPDATE, so there is nothing to guard.
//
// These pins are behavioural where they can be and structural where the store is
// not importable (it opens a Supabase client at module scope).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { tripToRow } from '../src/lib/tripRow'
import { seedData } from '../src/data/seed'
import type { Trip } from '../src/data/types'

const STORE = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const APP = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const TYPES = readFileSync(new URL('../src/data/types.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const TRIPROW = readFileSync(new URL('../src/lib/tripRow.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** The body of one exported store function, by brace matching. */
function fnBody(source: string, signature: string): string {
  const start = source.indexOf(signature)
  expect(start, `${signature} must exist`).toBeGreaterThan(-1)
  let depth = 0
  let i = source.indexOf('{', start)
  const from = i
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(from, i + 1)
    }
  }
  throw new Error(`unbalanced braces after ${signature}`)
}

const ALL_COLUMNS = {
  economy: true, price: true, roundTrip: true, cover: true,
  inviteCode: true, deleted: true, stayStyle: true,
  driverCount: true, hasVulnerable: true, driveAfterDinner: true, vehicleProfile: true,
  tankL: true, rentPerDayInr: true, localTrain: true, flights: true, ref: true,
} as const

describe('(a) fetchTripByInviteCode never puts the preview into the writable cache', () => {
  const body = fnBody(STORE, 'export async function fetchTripByInviteCode(')

  it('does not assign to cache.trips', () => {
    expect(body).not.toMatch(/cache\.trips\s*=/)
  })

  it('does not commit, queue, persist or snapshot', () => {
    for (const forbidden of ['commit(', 'queueWrite(', 'persistTripField', 'saveSnapshot', 'queuedLocalTrips.set']) {
      expect(body, `must not call ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('returns the row without recording it as a server timestamp', () => {
    // recordServerTripTimestamp exists to keep the #798 stale-update ledger in
    // step with rows the client caches. A row that is not cached must not enter
    // that ledger.
    expect(body).not.toContain('recordServerTripTimestamp')
    expect(body).toMatch(/return rowToTrip\(rows\[0\], \[\]\)/)
  })

  it('the marker machinery is gone from the whole store and type', () => {
    for (const gone of ['partialPreview', 'partialEdited', 'PARTIAL_FIELDS', 'recordPartialEdits', 'refreshTripFromServer']) {
      expect(STORE, `store must not mention ${gone}`).not.toContain(gone)
      expect(TYPES, `types must not mention ${gone}`).not.toContain(gone)
    }
    // tripToRow no longer suppresses the five. Assert the absence of the guard
    // itself, not the word "partial" — that word also appears in an unrelated
    // comment about corruptible jsonb columns.
    expect(TRIPROW).not.toContain('trip.partialPreview')
    expect(TRIPROW).not.toContain('!partial')
  })
})

describe('(b) joinViaInvite leaves the FULL row in the cache', () => {
  const body = fnBody(STORE, 'export async function joinViaInvite(')

  it('awaits a full-row load before returning true', () => {
    // The awaited call is what stops /trip/:id flashing "not found".
    expect(body).toMatch(/const loaded = await loadFullTripIntoCache\(tripId\)/)
    expect(body).toMatch(/if \(!loaded\)/)
    // The FINAL `return true` must come after the load. The function also has an
    // early `return true` for an already-member caller, so compare the last one.
    expect(body.lastIndexOf('return true')).toBeGreaterThan(body.indexOf('loadFullTripIntoCache'))
  })

  it('it no longer reads the preview from tripById', () => {
    // The preview is not cached, so reading it there would find nothing.
    expect(body).not.toMatch(/const t = tripById\(tripId\)\s*\n\s*if \(!t\) return false/)
  })

  it('the full load writes a complete row through the normal serializer', () => {
    const load = fnBody(STORE, 'async function loadFullTripIntoCache(')
    expect(load).toContain("select('*')")
    expect(load).toContain('rowToTrip(')
    expect(load).toMatch(/cache\.trips\s*=/)
    // Identity and access are re-checked after the await, like #798's queue keys.
    expect(load).toContain('isCurrentIdentity(scope)')
    expect(load).toContain('tripAccessEpochs')
  })

  it('a full row carries all five columns through tripToRow', () => {
    // The behavioural half: once the row is complete, nothing suppresses them.
    const full: Trip = {
      ...structuredClone(seedData.trips[0]) as Trip,
      tankL: 55, rentPerDayInr: 2400, localTrain: true, ref: 'copy',
      flights: [{ id: 'f1', dayIndex: 0, fromAirport: 'DEL', toAirport: 'SXR' }] as Trip['flights'],
    }
    const row = tripToRow(full, 'owner-1', ALL_COLUMNS) as unknown as Record<string, unknown>
    expect(row.tank_l).toBe(55)
    expect(row.rent_per_day_inr).toBe(2400)
    expect(row.local_train).toBe(true)
    expect(row.ref).toBe('copy')
    expect(row.flights).toEqual(full.flights)
  })

  it('App passes the preview name, since the store can no longer read it', () => {
    expect(APP).toMatch(/joinViaInvite\(trip\.id, me\.id, trip\.inviteCode \?\? linkTarget, trip\.name\)/)
  })

  it('App no longer primes the cache before joining', () => {
    // fetchSharedTrip(trip.id, true) existed only so joinViaInvite could read
    // tripById. Both are gone from this path.
    const gate = APP.slice(APP.indexOf("setStatus('joining')"), APP.indexOf('navigateRef.current(`/trip/${trip.id}`)'))
    expect(gate).not.toContain('fetchSharedTrip(trip.id, true)')
  })
})

describe('(c) a failed full fetch is reported as a failure, not success', () => {
  const body = fnBody(STORE, 'export async function joinViaInvite(')

  it('returns false and logs when the row cannot be read back', () => {
    expect(body).toMatch(/console\.error\('\[yatraflow\] joined, but the full trip row could not be read back'/)
    expect(body).toMatch(/toast\('You joined, but the trip did not load/)
    const load = body.indexOf('loadFullTripIntoCache')
    const fail = body.indexOf('return false', load)
    expect(fail, 'a failed load must return false after the load').toBeGreaterThan(load)
  })

  it('the failure message distinguishes joined-but-unloaded from not joined', () => {
    // R23 — "you joined but it did not load" is not "you did not join".
    expect(body).toMatch(/You joined, but the trip did not load/)
    expect(body).not.toMatch(/Could not join[\s\S]{0,80}did not load/)
  })

  it('the loader treats an error and an empty row as failure, and says which', () => {
    const load = fnBody(STORE, 'async function loadFullTripIntoCache(')
    expect(load).toMatch(/tripRes\.error \|\| memRes\.error \|\| !tripRes\.data/)
    expect(load).toContain('full trip read after join failed')
    expect(load).toContain('member read after join failed')
    expect(load).toMatch(/return false/)
  })
})

describe('(d) the SQL pin reads the NEWEST invite RPC definition', () => {
  it('the join RPC is still read from the last migration that defines it', () => {
    // One of the first Gate findings: pinning an older migration would assert a
    // superseded body. The pin picks the newest FILE by name, so it stays correct
    // before and after Branch A merges.
    const src = readFileSync(new URL('../tests/invite-code.test.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/get_trip_by_invite_code/)
  })
})
