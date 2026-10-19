// ============ #551 — imports toast the truth: the save is awaited ============
//
// Two import paths (snapshot link, file) fired `duplicateTrip`/`importTrip`
// without awaiting, then toasted success unconditionally. A failed save left a
// zombie row in My Trips, two contradictory toasts, and edits that queued
// against a row that did not exist — while `replayQueuedWrites` read a
// no-match UPDATE's { error: null, count: 0 } as success and toasted "synced"
// over a write that touched nothing. The create path got the #374 treatment;
// the store half here is behavioural (real store, mocked transport), the page
// halves are pinned textually per the repo's UI-contract convention.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { seedData } from '../src/data/seed'
import type { Trip } from '../src/data/types'

type FakeError = { code?: string; message: string } | null

const { state, toast, queue } = vi.hoisted(() => ({
  state: {
    replayTrip: null as any,
    tripErrors: [] as FakeError[],
    memberErrors: [] as FakeError[],
    /** a table whose write REJECTS instead of answering with an error object */
    throwOn: null as string | null,
    /** what every UPDATE answers — count models PostgREST's no-match reply */
    updateAnswer: { error: null as unknown, count: null as number | null },
    writes: [] as Array<{ table: string; method: string; payload: any }>,
  },
  toast: vi.fn(),
  queue: { map: new Map<string, any>() },
}))

vi.mock('../src/components/ui', () => ({ toast }))

// The replay half needs a queue the test can seed and inspect; the real one
// rides IndexedDB, so its send/cleanup pairs are rerouted onto one memory map
// while the rest of the module (verdict, retry cap) stays real.
vi.mock('../src/lib/writeQueue', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/lib/writeQueue')>()
  const sameGeneration = (tripId: string, capturedAt: number) => {
    const cur = queue.map.get(tripId)
    return !!cur && cur.capturedAt === capturedAt
  }
  return {
    ...actual,
    queueWrite: async (entry: any) => { queue.map.set(entry.tripId, structuredClone(entry)); return true },
    dropQueuedWrite: async (entry: any) => {
      if (!sameGeneration(entry.tripId, entry.capturedAt)) return false
      queue.map.delete(entry.tripId)
      return true
    },
    pendingWrites: async () => [...queue.map.values()],
    dropWriteIfCurrent: async (tripId: string, capturedAt: number) => {
      if (!sameGeneration(tripId, capturedAt)) return false
      queue.map.delete(tripId)
      return true
    },
    requeueIfCurrent: async (entry: any) => {
      if (!sameGeneration(entry.tripId, entry.capturedAt)) return false
      queue.map.set(entry.tripId, structuredClone(entry))
      return true
    },
  }
})

vi.mock('../src/lib/supabase', async () => {
  const { tripWriteClient } = await import('./helpers/tripWriteClient')
  function query() {
    const qb: any = {}
    qb.select = () => qb
    qb.eq = () => qb
    qb.in = () => qb
    qb.order = () => qb
    qb.limit = () => qb
    qb.then = (res: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(res)
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
    // Both handlers: a thenable that only accepts `res` hangs the awaiting
    // caller forever when it means to reject (the rejection lands in an
    // unhandled-promise slot and the await never settles).
    qb.then = (
      res: (v: { data: unknown; error: unknown; count?: number | null }) => unknown,
      rej?: (e: unknown) => unknown,
    ) => {
      state.writes.push({ table, method, payload })
      if (state.throwOn === table) return Promise.reject(new Error('fetch failed')).then(res, rej)
      const body: { data: unknown; error: unknown; count?: number | null } = { data: null, error: null }
      if (method === 'update') {
        body.error = state.updateAnswer.error
        body.count = state.updateAnswer.count
      } else if (table === 'trips') {
        body.error = state.tripErrors.length ? state.tripErrors.shift()! : null
      } else if (table === 'trip_members') {
        body.error = state.memberErrors.length ? state.memberErrors.shift()! : null
      }
      return Promise.resolve(body).then(res, rej)
    }
    return qb
  }
  return {
    isSupabaseConfigured: () => true,
    supabase: tripWriteClient({
      from: (table: string) => {
        const qb = query()
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
      rpc: async () => ({ data: null, error: null }),
    }, () => ({ trips: state.replayTrip ? [state.replayTrip] : [], members: state.replayTrip
      ? [{ trip_id: state.replayTrip.id, user_id: IMPORTER, role: 'owner' }] : [] })),
  }
})

import { updateTrip, importTripPersisted, retryImportTrip, tripById, getSnapshot, replayQueuedWrites } from '../src/store/store'
import { queueWrite, pendingWrites } from '../src/lib/writeQueue'

const IMPORTER = 'importer-551'

/** A fresh plan to import — the seed trips are real shapes, not hand stubs. */
function source(): Trip {
  return structuredClone(seedData.trips[0])
}

function tripsInsertIds() {
  return state.writes.filter(w => w.table === 'trips' && w.method === 'insert').map(w => w.payload.id)
}

beforeEach(() => {
  state.replayTrip = null
  state.tripErrors.length = 0
  state.memberErrors.length = 0
  state.throwOn = null
  state.updateAnswer = { error: null, count: null }
  state.writes.length = 0
  toast.mockClear()
  queue.map.clear()
  getSnapshot().sessionUserId = IMPORTER
})

describe('#551 — importTripPersisted reports the truth and leaves no zombie', () => {
  it('a failed trips insert retracts the copy: no zombie row, only the failure toast', async () => {
    state.tripErrors.push({ message: 'network unreachable' })
    const { trip, persisted } = await importTripPersisted(source(), IMPORTER)

    expect(persisted).toBe(false)
    expect(tripById(trip.id)).toBeUndefined()
    expect(getSnapshot().trips.some(t => t.id === trip.id)).toBe(false)
    expect(toast).toHaveBeenCalledWith('Could not save trip.')
    expect(toast.mock.calls.some(c => String(c[0]).startsWith('Imported'))).toBe(false)
    // an import is not a copy: the plan keeps its own name
    expect(trip.name).toBe(seedData.trips[0].name)
  })

  it('a member-row failure counts as a failed import too', async () => {
    // The trips row landed, the membership did not: invisible to its owner
    // after a reload, so the verdict stays "not persisted".
    state.memberErrors.push({ message: 'new row violates row-level security policy' })
    const { trip, persisted } = await importTripPersisted(source(), IMPORTER)
    expect(persisted).toBe(false)
    expect(tripById(trip.id)).toBeUndefined()
  })

  it('a dropped fetch (a rejection, not an error object) is caught and retracts too', async () => {
    state.throwOn = 'trips'
    const { trip, persisted } = await importTripPersisted(source(), IMPORTER)
    expect(persisted).toBe(false)
    expect(tripById(trip.id)).toBeUndefined()
  })

  it('a saved import is in the cache and reports persisted', async () => {
    const { trip, persisted } = await importTripPersisted(source(), IMPORTER)
    expect(persisted).toBe(true)
    expect(tripById(trip.id)).toBeDefined()
    expect(tripsInsertIds()).toHaveLength(1)
  })
})

describe('#551 — the import retry re-uses the trip instead of minting a twin', () => {
  it('a retry after a failed save lands ONE trip, with the original id', async () => {
    state.tripErrors.push({ message: 'network unreachable' })
    const { trip } = await importTripPersisted(source(), IMPORTER)
    expect(tripById(trip.id)).toBeUndefined()

    const ok = await retryImportTrip(trip, IMPORTER)
    expect(ok).toBe(true)
    expect(tripsInsertIds()).toEqual([trip.id, trip.id])
    expect(getSnapshot().trips.filter(t => t.id === trip.id)).toHaveLength(1)
  })

  it('a retry that meets its own earlier rows succeeds (23505 tolerated)', async () => {
    state.tripErrors.push({ message: 'connection reset' })
    const { trip } = await importTripPersisted(source(), IMPORTER)
    state.tripErrors.push({ code: '23505', message: 'duplicate key' })
    state.memberErrors.push({ code: '23505', message: 'duplicate key' })
    expect(await retryImportTrip(trip, IMPORTER)).toBe(true)
    expect(tripById(trip.id)).toBeDefined()
  })

  it('a retry that fails again is rolled back again', async () => {
    state.tripErrors.push({ message: 'offline' })
    const { trip } = await importTripPersisted(source(), IMPORTER)
    state.tripErrors.push({ message: 'still offline' })
    expect(await retryImportTrip(trip, IMPORTER)).toBe(false)
    expect(tripById(trip.id)).toBeUndefined()
  })
})

describe('#551 — the replay never confirms a write that touched no row', () => {
  let sequence = 0
  function seedQueue(trip: Trip) {
    trip.id = `replay-${++sequence}`
    trip.writeVersion = 0
    trip.members = [{ userId: IMPORTER, role: 'owner', joinedAt: 1 }]
    getSnapshot().trips = [...getSnapshot().trips.filter(t => t.id !== trip.id), trip]
    state.replayTrip = { id: trip.id, owner_id: IMPORTER, write_version: 0 }
    return queueWrite({ tripId: trip.id, ownerId: IMPORTER, capturedAt: 1728000000000, baseVersion: 0, attempts: 0, trip })
  }

  it('a { error: null, count: 0 } UPDATE stays queued, unsynced, and un-toasted', async () => {
    const trip = source()
    await seedQueue(trip)
    state.updateAnswer = { error: null, count: 0 }

    const synced = await replayQueuedWrites()

    expect(synced).toBe(0)
    const left = await pendingWrites()
    expect(left.some(w => w.tripId === trip.id)).toBe(true)
    expect(left[0].attempts).toBe(0)
    expect(left[0].state).toBe('conflict')
    const toastTexts = toast.mock.calls.map(c => String(c[0]))
    expect(toastTexts.some(t => t.includes('synced'))).toBe(false)
  })

  it('a returned revision confirms sync and removes its queued edit', async () => {
    const trip = source()
    await seedQueue(trip)
    state.updateAnswer = { error: null, count: 1 }

    expect(await replayQueuedWrites()).toBe(1)
    expect((await pendingWrites()).some(w => w.tripId === trip.id)).toBe(false)
    expect(toast.mock.calls.some(c => String(c[0]).includes('could not sync'))).toBe(false)
  })

  it('a returned revision confirms sync even when count is absent', async () => {
    const trip = source()
    await seedQueue(trip)
    state.updateAnswer = { error: null, count: null }

    expect(await replayQueuedWrites()).toBe(1)
    expect((await pendingWrites()).some(w => w.tripId === trip.id)).toBe(false)
  })

  it('network failures pause at the cap and keep the local copy', async () => {
    const trip = source()
    await seedQueue(trip)
    state.updateAnswer = { error: { message: 'offline' }, count: null }

    await replayQueuedWrites()
    await replayQueuedWrites()
    await replayQueuedWrites() // MAX_WRITE_ATTEMPTS reached

    expect((await pendingWrites()).find(w => w.tripId === trip.id)).toMatchObject({ attempts: 3, state: 'failed' })
    expect(toast).toHaveBeenCalledWith('Changes could not sync. Retry or download your copy from Saved edits.', 'err')
  })
})

describe('#551 — the two callers await the truth (page contracts)', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const button = readFileSync(new URL('../src/components/ImportTripButton.tsx', import.meta.url), 'utf8')

  it('the snapshot page imports through the awaited path, never the fire-and-forget one', () => {
    expect(app).toMatch(/await importTripPersisted\(/)
    expect(app).not.toMatch(/duplicateTrip\(/)
  })

  it('the snapshot page navigates and toasts only below the verdict check', () => {
    const fn = app.slice(app.indexOf('async function importIt'), app.indexOf("if (state.s === 'error')"))
    const verdict = fn.indexOf('if (!persisted)')
    const success = fn.indexOf("toast('Snapshot imported")
    expect(verdict).toBeGreaterThan(-1)
    expect(success).toBeGreaterThan(verdict)
    expect(fn.indexOf("onNavigate('/trips')")).toBeGreaterThan(success)
  })

  it('the snapshot page retries the SAME object it held back', () => {
    expect(app).toMatch(/setPendingImport\(copy\)/)
    expect(app).toMatch(/const retry = pendingImport/)
    expect(app).toMatch(/await retryImportTrip\(retry, me\.id\)/)
  })

  it('the file import toasts success only after the save confirms it', () => {
    expect(button).toMatch(/await importTripPersisted\(/)
    expect(button).not.toMatch(/\bimportTrip\(/)
    const verdict = button.indexOf('if (!persisted)')
    const success = button.indexOf('announceImported({ trip: imported')
    expect(success).toBeGreaterThan(verdict)
    expect(button).toMatch(/setPending\(\{ trip: imported/)
  })

  it('the retry button carries the same-object contract', () => {
    expect(button).toMatch(/await retryImportTrip\(pending\.trip, ownerId\)/)
  })
})


describe('imported flight day protection', () => {
  it('assigns flight IDs to the copy and refuses to orphan its flight', async () => {
    const original = source()
    original.startDate = '2026-11-01'
    original.endDate = '2026-11-02'
    original.days = [0, 1].map(index => ({ id: `d${index}`, index, stops: [] }))
    original.fixedCommitments = []
    original.flights = [{ id: 'foreign-flight', dayIndex: 1, fromAirport: 'DEL', toAirport: 'BOM' }]
    const { trip, persisted } = await importTripPersisted(original, IMPORTER)
    expect(persisted).toBe(true)
    expect(trip.flights![0].id).not.toBe('foreign-flight')
    expect(updateTrip(trip.id, { endDate: '2026-11-01' })).toBe(false)
    expect(tripById(trip.id)?.days).toHaveLength(2)
    expect(tripById(trip.id)?.flights).toHaveLength(1)
  })
})
