// ============ #349 — a paid unlock is fresh on the page AND in the fork ============
//
// Two things stranded a paying buyer on placeholders, and both are freshness
// bugs, not paywall bugs (the wire stubs correctly — it just never reached the
// page or the copy):
//
//   * `fetchPublicTrip` inserted only when absent, so the pre-purchase STUB it
//     had cached won the read after the unlock re-fetch: the page rendered
//     `cachedTrip ?? fetched` and got the stub, and the fork read the same stub
//     out of `tripById`;
//   * `forkPublication` preferred that cache hit over the RPC and re-stubbed
//     unconditionally, so even a correctly-served real trip was re-locked on the
//     way into the copy — and its `unlockedPresentationOnly` parameter was
//     accepted and then ignored.
//
// These tests go through the real store and the real fork with a mocked wire,
// because both bugs live in the interaction between them: a pure test of either
// half passes while the buyer still gets placeholders.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { PublishedItinerary, Trip } from '../src/data/types'
import { seedData } from '../src/data/seed'
import { tripToRow } from '../src/lib/tripRow'

/** The notice `get_public_trip` stamps on every stop of a withheld day. Written
 *  out here rather than imported: this is the wire's string, and a test that
 *  agrees with the code by construction cannot notice the code drifting. */
const LOCKED = 'Locked — the full plan is on the original itinerary.'

const { state, toast } = vi.hoisted(() => ({
  state: {
    /** what the next get_public_trip answers with (null = unknown/failed read) */
    rpcRows: null as unknown,
    rpcError: null as unknown,
    entitlements: [] as unknown[],
    inserts: [] as Array<{ table: string; payload: any }>,
  },
  toast: vi.fn(),
}))

vi.mock('../src/components/ui', () => ({ toast }))

vi.mock('../src/lib/supabase', () => {
  function query(table: string) {
    const qb: any = { table }
    qb.select = () => qb
    qb.eq = () => qb
    qb.in = () => qb
    qb.order = () => qb
    qb.limit = () => qb
    // Reads: entitlements is the only table this suite reads through
    // `from(...)`; everything else is a probe that must come back empty.
    qb.then = (res: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: table === 'entitlements' ? state.entitlements : [], error: null }).then(res)
    qb.maybeSingle = () => ({
      then: (res: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(res),
    })
    return qb
  }
  function write(table: string, method: string, payload: any) {
    const qb: any = {}
    qb.eq = () => qb
    qb.in = () => qb
    qb.select = () => qb
    qb.then = (res: (v: { data: unknown; error: unknown }) => unknown) => {
      state.inserts.push({ table, payload })
      return Promise.resolve({ data: null, error: null }).then(res)
    }
    return qb
  }
  return {
    isSupabaseConfigured: () => true,
    supabase: {
      from: (table: string) => {
        const qb = query(table)
        qb.insert = (p: any) => write(table, 'insert', p)
        qb.update = (p: any) => write(table, 'update', p)
        qb.upsert = (p: any) => write(table, 'upsert', p)
        qb.delete = () => write(table, 'delete', null)
        return qb
      },
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      channel: () => ({ on() { return this }, subscribe() { return this } }),
      removeChannel: () => {},
      rpc: async (fn: string) => {
        if (fn !== 'get_public_trip') return { data: null, error: null }
        return { data: state.rpcRows, error: state.rpcError }
      },
    },
  }
})

import {
  fetchPublicTrip, tripById, duplicateTrip,
  _clearRecentLocalWrites, _clearServerTripTimestamps,
} from '../src/store/store'
import { forkPublication, wireWithheld } from '../src/lib/forkPub'

const base = (): Trip => ({ ...structuredClone(seedData.trips[0]), id: 'trip-349' })

/** A wire row for `trip` as PostgREST would send it. */
function row(trip: Trip, updatedAt = 1000) {
  return { ...tripToRow(trip, 'owner-349'), created_at: 500, updated_at: updatedAt }
}

/** The wire's stub: the paywall's own shape, applied to every day the
 *  publication does not give away. */
function wireStub(trip: Trip, freeDayIndexes: number[]): Trip {
  const free = new Set(freeDayIndexes)
  return {
    ...trip,
    days: trip.days.map(d => free.has(d.index) ? d : {
      ...d,
      stops: d.stops.map(s => ({
        ...s,
        description: LOCKED,
        notes: '',
        openTime: undefined,
        closeTime: undefined,
        departTime: undefined,
        arrivalTime: undefined,
        sourceUrl: undefined,
        placeId: undefined,
        entryFeeInrPerPerson: 0,
        transportCostInrTotal: 0,
        status: 'confirmed' as const,
      })),
    }),
  }
}

function noticeCount(days: Trip['days']): number {
  return days.reduce((n, d) => n + d.stops.filter(s => s.description === LOCKED).length, 0)
}

function forkedDays(): Trip['days'] {
  const insert = state.inserts.filter(i => i.table === 'trips').pop()
  expect(insert, 'the fork persisted a trips row').toBeDefined()
  return insert!.payload.days as Trip['days']
}

function grant(pubId: string, userId: string) {
  state.entitlements = [{
    id: 'ent-1', user_id: userId, pub_id: pubId, order_id: 'order_1',
    amount_paid_inr: 199, granted_at: new Date(1700_000_000_000).toISOString(),
  }]
}

const FREE = [0]
const pubRow = {
  id: 'pub-349', tripId: 'trip-349', title: 'Kerala, unlocked',
  freeDayIndexes: FREE, premiumPriceInr: 199, creatorId: 'creator-349',
} as PublishedItinerary

beforeEach(() => {
  state.rpcRows = null
  state.rpcError = null
  state.entitlements = []
  state.inserts.length = 0
  toast.mockClear()
  _clearRecentLocalWrites()
  _clearServerTripTimestamps()
})

describe('#349 — fetchPublicTrip converges the cache to the RPC, never first-wins', () => {
  it('a re-fetch REPLACES a cached stub with the row the server just served', async () => {
    const trip = base()
    // The pre-purchase read: the wire withholds days 1–3, and that stub lands in
    // the cache. This is the state every paying buyer is in when they click
    // Unlock.
    state.rpcRows = [row(wireStub(trip, FREE))]
    const before = await fetchPublicTrip(pubRow.id)
    expect(noticeCount(before!.days)).toBeGreaterThan(0)
    expect(noticeCount(tripById(trip.id)!.days)).toBeGreaterThan(0)

    // The post-purchase read of the SAME publication: real days now.
    state.rpcRows = [row(trip)]
    const after = await fetchPublicTrip(pubRow.id)!

    expect(noticeCount(after!.days)).toBe(0)
    // …and the cache is the same row, which is what the page renders from
    // (`cachedTrip ?? fetched`) and what the fork reads.
    expect(noticeCount(tripById(trip.id)!.days)).toBe(0)
  })

  it('keeps the cached membership, which the RPC cannot carry', async () => {
    // rowToTrip is handed an empty member list, so a blind replace would drop
    // the crew — the vote quorum's denominator (#335) — every time a public
    // page loaded a trip this session is a member of.
    const trip = base()
    const copy = duplicateTrip(trip, 'member-349')
    const owned = tripById(copy.id)!
    owned.members = [
      ...(owned.members ?? []),
      { userId: 'friend-349', role: 'editor' as const, joinedAt: 1 },
    ]
    _clearRecentLocalWrites()

    state.rpcRows = [row(copy)]
    const after = await fetchPublicTrip(pubRow.id)

    expect(after!.members!.map(m => m.userId)).toEqual(['member-349', 'friend-349'])
    expect(tripById(copy.id)!.members).toHaveLength(2)
    // The row itself was still replaced (not merely left alone).
    expect(tripById(copy.id)!.updatedAt).toBe(1000)
  })

  it('drops a strictly older row — a replay must not walk the cache backwards', async () => {
    const trip = base()
    state.rpcRows = [row(trip, 5000)]
    await fetchPublicTrip(pubRow.id)
    state.rpcRows = [row(trip, 4000)]
    const out = await fetchPublicTrip(pubRow.id)
    expect(out!.updatedAt).toBe(5000)
    expect(tripById(trip.id)!.updatedAt).toBe(5000)
  })

  it('the guards are the realtime handler`s own (source tripwire)', () => {
    // A replacement path is a second writer of `cache.trips`; it has to honor
    // the same two guards the realtime handler does, or the echo of a local
    // write and an out-of-order replay start fighting it.
    const src = readFileSync(
      new URL('../src/store/store.ts', import.meta.url), 'utf8',
    )
    const fn = src.slice(src.indexOf('export async function fetchPublicTrip'))
    expect(fn).toMatch(/isStaleServerRow\(serverTripTimestamps\.get\(fetched\.id\), fetched\.updatedAt\)/)
    expect(fn).toMatch(/isRecentLocalWrite\(recentLocalWrites, 'trips', fetched\.id/)
    expect(fn).toMatch(/cache\.trips\.map\(t => \(t\.id === trip\.id \? trip : t\)\)/)
  })
})

describe('#349 — the fork asks the wire and the entitlement, never the cache', () => {
  it('a buyer with a grant forks REAL days, from the stale-stub start state', async () => {
    const trip = base()
    // Broken precondition: the cache already holds the pre-purchase stub.
    state.rpcRows = [row(wireStub(trip, FREE))]
    await fetchPublicTrip(pubRow.id)
    expect(noticeCount(tripById(trip.id)!.days)).toBeGreaterThan(0)
    // The unlock: the same RPC now serves the real trip, and the buyer's own
    // entitlement row exists.
    state.rpcRows = [row(trip)]
    grant(pubRow.id, 'buyer-349')
    _clearRecentLocalWrites()

    // Explore/Purchases fork shape — no presentation flag is passed at all, so
    // the entitlement decision has to come from the read.
    const ok = await forkPublication(pubRow, 'buyer-349', vi.fn())
    expect(ok).toBe(true)
    expect(noticeCount(forkedDays())).toBe(0)
  })

  it('the creator forks their own priced publication in full', async () => {
    const trip = base()
    state.rpcRows = [row(trip)]   // the wire returns the real trip to the creator
    const ok = await forkPublication(pubRow, 'creator-349', vi.fn())
    expect(ok).toBe(true)
    expect(noticeCount(forkedDays())).toBe(0)
  })

  it('a visitor still forks placeholders — the fix is freshness, not the paywall', async () => {
    const trip = base()
    state.rpcRows = [row(wireStub(trip, FREE))]
    const ok = await forkPublication(pubRow, 'visitor-349', vi.fn())
    expect(ok).toBe(true)
    const days = forkedDays()
    expect(noticeCount(days)).toBeGreaterThan(0)
    // The free day is untouched; only the withheld ones are placeholders.
    expect(noticeCount(days.filter(d => d.index === 0))).toBe(0)
    // The withheld days' expenses do not ride into the copy either.
    expect(days.some(d => d.index === 0)).toBe(true)
  })

  it('a grant the wire contradicts fails closed', async () => {
    const trip = base()
    // The entitlement read says yes, but the row the server served is still
    // stubbed (revoked mid-session, a stranded grant, a lying flag): the copy
    // must not be widened by the claim.
    state.rpcRows = [row(wireStub(trip, FREE))]
    grant(pubRow.id, 'buyer-349')
    const ok = await forkPublication(pubRow, 'buyer-349', vi.fn(), true)
    expect(ok).toBe(true)
    expect(noticeCount(forkedDays())).toBeGreaterThan(0)
  })

  it('a FAILED read falls back to the cache but re-stubs it anyway', async () => {
    const trip = base()
    // The cache holds a real row (this session can see it), but the wire read
    // fails — so nothing here is evidence about entitlement, or about what the
    // server would have served.
    state.rpcRows = [row(trip)]
    await fetchPublicTrip(pubRow.id)
    state.rpcRows = null
    grant(pubRow.id, 'buyer-349')
    _clearRecentLocalWrites()

    const ok = await forkPublication(pubRow, 'buyer-349', vi.fn(), true)
    expect(ok).toBe(true)
    expect(noticeCount(forkedDays())).toBeGreaterThan(0)
  })

  it('wireWithheld reads the server`s own notice, and only for withheld days', () => {
    const trip = base()
    expect(wireWithheld(trip, FREE)).toBe(false)
    expect(wireWithheld(wireStub(trip, FREE), FREE)).toBe(true)
    // A free publication gives every day away: no day is withheld, so no notice
    // can make the fork read as locked.
    const allFree = trip.days.map(d => d.index)
    expect(wireWithheld(wireStub(trip, allFree), allFree)).toBe(false)
  })

  it('the fork reads the wire BEFORE the cache (source tripwire)', () => {
    const src = readFileSync(
      new URL('../src/lib/forkPub.ts', import.meta.url), 'utf8',
    )
    const fn = src.slice(src.indexOf('export async function forkPublication'))
    // The cache is a fallback for a failed read, not the first choice.
    expect(fn).toMatch(/const wireRow = await fetchPublicTrip\(pub\.id\)/)
    expect(fn).toMatch(/const src = wireRow \?\? tripById\(pub\.tripId\)/)
    expect(fn).not.toMatch(/tripById\(pub\.tripId\) \?\? await fetchPublicTrip/)
    // A negative presentation flag is never trusted; only a positive skips the
    // entitlement read. #359 made that read REJECT, so the `||` short-circuit
    // became an explicit branch — a rejection must not escape (a buyer who
    // could not be checked could not fork their own plan) and must not be read
    // as entitled (which would hand paid content to a stranger).
    expect(fn).toMatch(/let entitled = unlockedPresentationOnly === true/)
    expect(fn).toMatch(/if \(!entitled && meId\)/)
    expect(fn).toMatch(/hasUnlock\(await fetchMyEntitlements\(meId\), meId, pub\.id, pub\.creatorId\)/)
    expect(fn).toMatch(/\} catch \{\s*entitled = false\s*\}/)
    // The re-stub stays the default and the public persist path stays the one
    // that drops locked-day expenses. #352 added the money flag to the re-stub
    // and made the persist path the default for every fork the server did not
    // hand over in full, so the branch no longer depends on `src.days`.
    expect(fn).toContain('restubLockedDays(src, pub.freeDayIndexes,')
    expect(fn).toMatch(/duplicateTripPublicPersisted\(safe, meId, pub\.freeDayIndexes, source\)/)
  })
})
