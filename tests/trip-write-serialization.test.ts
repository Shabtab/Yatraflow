// ============ #549 — trip writes serialize per trip; the drop is generation-aware ============
// Two races, one guarantee. The debounced write path used to issue its UPDATE
// with no per-trip ordering: a second edit during an in-flight write started a
// second UPDATE, the network landed them in arrival order, and the OLDER
// snapshot could win on the server. Its success cleanup was unconditional too:
// dropWrite(tripId) removed whatever entry currently sat at the key, so a
// successful write deleted the NEWER edit a later change had queued behind it.
// These tests drive the real pipeline (persistTripField → persistTripFieldNow)
// with a supabase mock whose UPDATE promises the test resolves by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { seedData } from '../src/data/seed'
import type { QueuedWrite, WriteQueueStore } from '../src/lib/writeQueue'

const { state } = vi.hoisted(() => ({
  state: {
    updates: [] as Array<{ payload: unknown; resolve: (r: { data: unknown; error: unknown }) => void }>,
  },
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    let method: string | undefined
    let payload: unknown
    const builder: Record<string, unknown> = {}
    const chain = (m: string, p?: unknown) => { method = m; payload = p; return builder }
    builder.update = (p: unknown) => chain('update', p)
    builder.insert = (p: unknown) => chain('insert', p)
    builder.delete = () => chain('delete')
    builder.select = () => builder
    builder.eq = () => builder
    builder.in = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.maybeSingle = () => builder
    builder.single = () => builder
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) => {
      if (method !== 'update' || table !== 'trips') {
        return Promise.resolve({ data: null, error: null }).then(res)
      }
      // The test decides when (and with what) each UPDATE settles.
      return new Promise<{ data: unknown; error: unknown }>(resolve => {
        state.updates.push({ payload, resolve })
      }).then(res)
    }
    return builder
  }
  return { isSupabaseConfigured: false, supabase: { from: (t: string) => makeBuilder(t) } }
})

// The store calls the queue without injecting a store; reroute every entry
// point onto one in-memory store so the tests can observe the durable copy.
// The REAL queue logic runs (importOriginal) — only the backend is swapped.
vi.mock('../src/lib/writeQueue', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/lib/writeQueue')>()
  const map = new Map<string, QueuedWrite>()
  const mem: WriteQueueStore = {
    list: async () => [...map.values()],
    put: async entry => { map.set(entry.tripId, entry) },
    remove: async tripId => { map.delete(tripId) },
    removeIf: async (tripId, capturedAt) => {
      const current = map.get(tripId)
      if (!current || current.capturedAt !== capturedAt) return false
      map.delete(tripId)
      return true
    },
    putIf: async (entry, expectedCapturedAt) => {
      const current = map.get(entry.tripId)
      if (!current || current.capturedAt !== expectedCapturedAt) return false
      map.set(entry.tripId, entry)
      return true
    },
  }
  return {
    ...actual,
    queueWrite: (entry: QueuedWrite) => actual.queueWrite(entry, mem),
    dropWrite: (tripId: string) => actual.dropWrite(tripId, mem),
    dropWriteIfCurrent: (tripId: string, capturedAt: number) => actual.dropWriteIfCurrent(tripId, capturedAt, mem),
    requeueIfCurrent: (entry: QueuedWrite) => actual.requeueIfCurrent(entry, mem),
    pendingWrites: () => actual.pendingWrites(mem),
    pendingWriteCount: (ownerId?: string) => actual.pendingWriteCount(ownerId, mem),
    clearWritesFor: (ownerId: string) => actual.clearWritesFor(ownerId, mem),
  }
})

import { duplicateTrip, updateStop, _setTripWriteDebounceMs, getSnapshot } from '../src/store/store'
import { clearWritesFor, pendingWrites } from '../src/lib/writeQueue'

const updates = () => state.updates
const lastUpdate = () => state.updates[state.updates.length - 1]
const ok = { data: null, error: null }
const tick = async () => { await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)) }

beforeEach(async () => {
  getSnapshot().sessionUserId = 'owner-test'
  // The pipeline's module default is the 600ms debounce; these tests drive the
  // fire path directly, like the rest of the store suites.
  _setTripWriteDebounceMs(0)
  // Each test's queue entries (and their captured trip ids) start clean.
  await clearWritesFor('owner-test')
  state.updates.length = 0
})

afterEach(() => {
  state.updates.length = 0
})

const keralaTrip = seedData.trips[0]

describe('#549 — the write pipeline serializes per trip', () => {
  it('issues the second UPDATE only after the first resolves, and lands snapB last', async () => {
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    const stop = trip.days[0].stops[0]
    updateStop(trip.id, stop.id, { visitMinutes: 777 })
    await tick()
    expect(updates()).toHaveLength(1)
    // Edit B lands while UPDATE(snapA) is still in flight: no second UPDATE
    // may be issued — nothing orders two in-flight writes, so the older
    // snapshot could land last and win on the server.
    updateStop(trip.id, stop.id, { visitMinutes: 888 })
    await tick()
    expect(updates()).toHaveLength(1)
    lastUpdate().resolve(ok)
    await tick()
    expect(updates()).toHaveLength(2)
    expect(JSON.stringify(updates()[1].payload)).toContain('888')
    lastUpdate().resolve(ok)
    await tick()
    // The row ends as snapB, and a fully confirmed pipeline leaves no queue.
    expect(JSON.stringify(updates()[1].payload)).toContain('888')
    expect(await pendingWrites()).toEqual([])
  })

  it('a successful write never deletes the newer edit queued behind it', async () => {
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    const stop = trip.days[0].stops[0]
    updateStop(trip.id, stop.id, { visitMinutes: 777 })
    await tick()
    expect(await pendingWrites()).toHaveLength(1)
    // Edit B queues its own snapshot (ONE entry per trip: B replaces A), and
    // its UPDATE waits behind A's.
    updateStop(trip.id, stop.id, { visitMinutes: 888 })
    await tick()
    expect(updates()).toHaveLength(1)
    expect(await pendingWrites()).toHaveLength(1)
    // A succeeds — the drop must remove only the entry A sent. The old
    // unconditional dropWrite(tripId) deleted entry B here.
    updates()[0].resolve(ok)
    await tick()
    expect(await pendingWrites()).toHaveLength(1)
    // B's UPDATE now runs and FAILS (connection flake): the edit must be on
    // the queue still — on neither the server nor the queue is the loss.
    expect(updates()).toHaveLength(2)
    updates()[1].resolve({ data: null, error: { message: 'offline flake' } })
    await tick()
    const queued = await pendingWrites()
    expect(queued).toHaveLength(1)
    expect(JSON.stringify(queued[0].trip)).toContain('888')
  })

  it('a failed write keeps its own entry queued for the replay', async () => {
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    const stop = trip.days[0].stops[0]
    updateStop(trip.id, stop.id, { visitMinutes: 777 })
    await tick()
    updates()[0].resolve({ data: null, error: { message: 'offline flake' } })
    await tick()
    const queued = await pendingWrites()
    expect(queued).toHaveLength(1)
    expect(JSON.stringify(queued[0].trip)).toContain('777')
  })
})
