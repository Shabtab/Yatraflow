// ============ Fork persistence — the invite-code vanish bug ============
// duplicateTrip copied the source trip's `inviteCode` verbatim; the trips row
// insert then died on the unique `idx_trips_invite_code` index (every trip
// that had ever been invite-shared has one), leaving a cache-only fork that
// the next reload silently discarded. These tests pin the strip + the honest
// persist result + the zombie rollback.
import { beforeEach, describe, it, expect, vi } from 'vitest'
import type { Trip } from '../src/data/types'
import { seedData } from '../src/data/seed'

const state: {
  inserts: Array<{ table: string; payload: any }>
  /** table name → error object the next write returns */
  failures: Record<string, unknown>
} = { inserts: [], failures: {} }

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('../src/components/ui', () => ({ toast }))

vi.mock('../src/lib/supabase', () => {
  function query(table: string) {
    const qb: any = { table }
    qb.select = () => qb
    qb.eq = () => qb
    qb.in = () => qb
    qb.order = () => qb
    qb.limit = () => qb
    // Optional-column probe reads: all columns present (truthy probe).
    qb.then = (res: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(res)
    // A single-row read that matches nothing resolves to null in the real
    // client (not []), which is what fetchSharedTrip branches on.
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
      const failure = state.failures[method === 'insert' ? table : '']
      state.inserts.push({ table, payload })
      const out = failure ? { data: null, error: failure } : { data: null, error: null }
      return Promise.resolve(out).then(res)
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
      // The public read is an RPC after the paywall moved to the wire, so an
      // empty payload is what "this trip did not load" looks like here.
      rpc: async () => ({ data: null, error: null }),
    },
  }
})

import { duplicateTripPersisted, duplicateTripPublicPersisted, tripById } from '../src/store/store'
import { forkPublication } from '../src/lib/forkPub'
import type { PublishedItinerary } from '../src/data/types'

const base = seedData.trips[0] as Trip
const pubRow = { id: 'pub_test', tripId: 'trip-that-does-not-exist', title: 'A test itinerary' } as PublishedItinerary

beforeEach(() => {
  state.inserts.length = 0
  state.failures = {}
  toast.mockClear()
})

describe('fork persist — invite-code strip (unique-index bug)', () => {
  it('a fork never inherits the source invite code or trash tombstone', async () => {
    const source: Trip = {
      ...structuredClone(base),
      inviteCode: 'KERALAHILL-XPNX',
      deletedAt: Date.now() - 1000,
    }
    const { trip: copy, persisted } = await duplicateTripPersisted(source, 'forker-1')
    expect(persisted).toBe(true)
    // The strip happens on the domain object...
    expect(copy.inviteCode).toBeUndefined()
    expect(copy.deletedAt).toBeUndefined()
    // ...and on the row that actually went to the database.
    const tripInsert = state.inserts.find(i => i.table === 'trips' && i.payload.id === copy.id)
    expect(tripInsert).toBeDefined()
    expect(tripInsert!.payload.invite_code).toBeNull()
    expect(tripInsert!.payload.deleted_at).toBeNull()
  })

  it('the premium-respectful fork strips it too', async () => {
    const source: Trip = { ...structuredClone(base), inviteCode: 'PURULIAESC-NDJQ' }
    const { trip: copy } = await duplicateTripPublicPersisted(source, 'forker-2', [0])
    expect(copy.inviteCode).toBeUndefined()
    expect(state.inserts.find(i => i.table === 'trips')!.payload.invite_code).toBeNull()
  })
})

describe('fork persist — honest result + zombie rollback', () => {
  it('a failed trips insert (e.g. the unique invite-code clash) retracts the copy', async () => {
    state.failures.trips = {
      message: 'duplicate key value violates unique constraint "idx_trips_invite_code"',
    }
    const source: Trip = { ...structuredClone(base), inviteCode: 'SPITIVALLE-GQMT' }
    const { trip: copy, persisted } = await duplicateTripPersisted(source, 'forker-3')
    expect(persisted).toBe(false)
    expect(toast).toHaveBeenCalledWith('Could not save trip.')
    // No zombie: the copy must not sit in the cache looking saved.
    expect(tripById(copy.id)).toBeUndefined()
  })

  it('a failed member insert counts as not persisted (invisible after reload)', async () => {
    state.failures.trip_members = { message: 'new row violates row-level security policy' }
    const { trip: copy, persisted } = await duplicateTripPersisted(structuredClone(base), 'forker-4')
    expect(persisted).toBe(false)
    expect(tripById(copy.id)).toBeUndefined()
  })

  it('control: a clean fork stays in the cache and reports persisted', async () => {
    const { trip: copy, persisted } = await duplicateTripPersisted(structuredClone(base), 'forker-5')
    expect(persisted).toBe(true)
    expect(tripById(copy.id)).toBeDefined()
    expect(state.inserts.some(i => i.table === 'trip_members')).toBe(true)
  })
})

describe('fork — the gate and its failure message are honest', () => {
  it('a signed-out viewer is sent to auth, told why, and writes nothing', async () => {
    const nav = vi.fn()
    const ok = await forkPublication(pubRow, null, nav)
    expect(ok).toBe(false)
    expect(nav).toHaveBeenCalledWith('/auth')
    expect(toast).toHaveBeenCalledWith('Log in to fork this trip into your plans.')
    // The redirect is the whole interaction — no half-fork, no orphan rows.
    expect(state.inserts).toEqual([])
  })

  it('a trip that will not load is not reported as deleted', async () => {
    // The public read returns null for a missing row AND for a failed read, so
    // the message may not claim the itinerary is gone.
    const nav = vi.fn()
    const ok = await forkPublication(pubRow, 'forker-6', nav)
    expect(ok).toBe(false)
    expect(nav).not.toHaveBeenCalledWith('/trips')
    const msg = String(toast.mock.calls.at(-1)?.[0] ?? '')
    expect(msg).toContain('Couldn’t load that itinerary')
    expect(msg).not.toMatch(/no longer available|deleted|gone/i)
    expect(state.inserts).toEqual([])
  })
})

describe('fork stamp (#230) — the copy carries its own route in', () => {
  it('stamps the ref on the trip and on the row that goes to the database', async () => {
    const { trip: copy } = await duplicateTripPersisted(structuredClone(base), 'forker-7', undefined, 'explore')
    expect(copy.ref).toBe('explore')
    const tripInsert = state.inserts.find(i => i.table === 'trips' && i.payload.id === copy.id)
    expect(tripInsert).toBeDefined()
    expect(tripInsert!.payload.ref).toBe('explore')
  })

  it('never inherits the SOURCE trip’s ref — a copy of a copy starts a new chain', async () => {
    const source: Trip = { ...structuredClone(base), ref: 'buyer' }
    const { trip: copy } = await duplicateTripPublicPersisted(source, 'forker-8', [0], undefined)
    expect(copy.ref).toBeUndefined()
    expect(state.inserts.find(i => i.table === 'trips')!.payload.ref).toBeNull()
  })
})
