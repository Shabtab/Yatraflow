import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { seedData } from '../src/data/seed'
import type { QueuedWrite, WriteQueueStore } from '../src/lib/writeQueue'
import type { Trip } from '../src/data/types'

const { state } = vi.hoisted(() => ({
  state: {
    updates: [] as Array<{ payload: unknown; eq: Record<string, unknown> }>,
    refuse: null as null | { message: string },
    hold: null as null | Promise<{ data: null; error: null | { message: string }; count?: number }>,
    count: undefined as number | undefined,
    deny: false,
    configured: false,
    accessCalls: 0,
  },
}))

vi.mock('../src/lib/supabase', async () => {
  const { tripWriteClient } = await import('./helpers/tripWriteClient')
  const makeBuilder = (table: string) => {
    let method: string | undefined
    let payload: unknown
    const eqs: Record<string, unknown> = {}
    const builder: Record<string, unknown> = {}
    const chain = (m: string, p?: unknown) => { method = m; payload = p; return builder }
    builder.update = (p: unknown) => chain('update', p)
    builder.insert = (p: unknown) => chain('insert', p)
    builder.delete = () => chain('delete')
    builder.select = () => builder
    builder.eq = (col: string, val: unknown) => { eqs[col] = val; return builder }
    builder.in = () => builder
    builder.is = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.maybeSingle = () => {
      if (table === 'trip_members' && state.deny) builder.maybeSingleHasRow = true
      return builder
    }
    builder.single = () => builder
    builder.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (table === 'trip_members' && state.deny) return Promise.resolve({ data: null, error: null }).then(res, rej)
      if (method === 'update' && table === 'trips') {
        state.updates.push({ payload, eq: { ...eqs } })
        return (state.hold ?? Promise.resolve({ data: null, error: state.refuse, count: state.count })).then(res, rej)
      }
      return Promise.resolve({ data: null, error: null }).then(res, rej)
    }
    return builder
  }
  return { get isSupabaseConfigured() { return state.configured }, supabase: tripWriteClient({
    auth: { signOut: async () => ({ error: null }) }, from: (t: string) => makeBuilder(t),
    rpc: () => {
      const request = { setHeader: () => request,
        then: (resolve: (value: unknown) => unknown) => {
          state.accessCalls += 1
          return (state.hold ?? Promise.resolve({ data: null, error: null })).then(resolve)
        } }
      return request
    },
  }) }
})

// The queue normally lives in IndexedDB, which Node does not have. Swap only the
// backend for an in-memory store; the real queue logic still runs. That lets the
// test see whether a refused edit stayed queued for replay.
vi.mock('../src/lib/writeQueue', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/lib/writeQueue')>()
  const map = new Map<string, QueuedWrite>()
  const mem: WriteQueueStore = {
    list: async () => [...map.values()],
    put: async entry => { map.set(actual.writeQueueKey(entry.ownerId, entry.tripId), entry) },
    remove: async tripId => { map.delete(tripId) },
    removeIf: async (key, capturedAt, revision) => {
      const current = map.get(key)
      if (!current || current.revision !== revision || (revision === undefined && current.capturedAt !== capturedAt)) return false
      map.delete(key)
      return true
    },
    putIf: async (entry, expectedCapturedAt, expectedRevision) => {
      const key = actual.writeQueueKey(entry.ownerId, entry.tripId)
      const current = map.get(key)
      if (!current || current.revision !== expectedRevision || (expectedRevision === undefined && current.capturedAt !== expectedCapturedAt)) return false
      map.set(key, entry)
      return true
    },
  }
  return {
    ...actual,
    queueWrite: (entry: QueuedWrite) => actual.queueWrite(entry, mem),
    dropWrite: (tripId: string) => actual.dropWrite(tripId, mem),
    dropQueuedWrite: (entry: QueuedWrite) => actual.dropQueuedWrite(entry, mem),
    dropWriteIfCurrent: (tripId: string, capturedAt: number) => actual.dropWriteIfCurrent(tripId, capturedAt, mem),
    requeueIfCurrent: (entry: QueuedWrite) => actual.requeueIfCurrent(entry, mem),
    pendingWrites: () => actual.pendingWrites(mem),
    pendingWriteCount: (ownerId?: string) => actual.pendingWriteCount(ownerId, mem),
    clearWritesFor: (ownerId: string) => actual.clearWritesFor(ownerId, mem),
  }
})

import {
  duplicateTrip, updateTrip, tripById, tripWriteReceipt, admitTripPreview, getSnapshot, logout, subscribe, ensureInviteCode,
  _setTripWriteDebounceMs, _flushTripWrites, _cancelTripWrites,
} from '../src/store/store'
import { clearWritesFor, pendingWrites } from '../src/lib/writeQueue'

const tick = async () => { await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)) }
const keralaTrip = seedData.trips[0]

beforeEach(async () => {
  getSnapshot().sessionUserId = 'owner-test'
  _setTripWriteDebounceMs(0)
  await clearWritesFor('owner-test')
  state.updates.length = 0
  state.refuse = null
  state.hold = null
  state.count = undefined
  state.deny = false
  state.configured = false
  state.accessCalls = 0
})

afterEach(() => {
  _cancelTripWrites()
  _setTripWriteDebounceMs(0)
})


const baseOf = (id: string) => {
  const trip = tripById(id)
  if (!trip) throw new Error('Missing trip')
  return structuredClone(trip)
}

describe('operation-bound preview admission', () => {
  it('waits for the admitted generation to persist', async () => {
    let release: (result: { data: null; error: null }) => void = () => {}
    state.hold = new Promise(resolve => { release = resolve })
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    await tick()
    const patch = { name: 'Preview' }
    const result = admitTripPreview({ tripId: trip.id, expectedBase: baseOf(trip.id), patch })
    patch.name = 'Changed after admission'
    let settled = false
    void result.then(() => { settled = true })
    await tick()
    const queued = (await pendingWrites()).find(write => write.tripId === trip.id)
    expect(settled).toBe(false)
    expect((queued?.trip as Trip).name).toBe('Preview')
    release({ data: null, error: null })
    await expect(result).resolves.toEqual({ kind: 'acknowledged', revision: queued?.revision, writeVersion: 1 })
  })

  it('refuses a stale base without mutation', async () => {
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    await tick()
    const base = baseOf(trip.id)
    base.name = 'Old'
    await expect(admitTripPreview({ tripId: trip.id, expectedBase: base, patch: { name: 'Preview' } })).resolves.toEqual({ kind: 'stale' })
    expect(tripById(trip.id)?.name).toBe(trip.name)
    expect(state.updates).toHaveLength(0)
  })

  it('reports a synchronous update refusal without a write', async () => {
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    await tick()
    await expect(admitTripPreview({ tripId: trip.id, expectedBase: baseOf(trip.id), patch: { drivesPart: true } })).resolves.toEqual({ kind: 'refused' })
    expect(state.updates).toHaveLength(0)
    expect(tripById(trip.id)?.drivesPart).toBe(trip.drivesPart)
  })

  it('retains an existing conflicted queue entry', async () => {
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    await tick()
    const current = tripById(trip.id)
    if (!current) throw new Error('Missing trip')
    current.writeVersion = 55
    updateTrip(trip.id, { name: 'Existing' })
    await expect(tripWriteReceipt(trip.id)).resolves.toMatchObject({ kind: 'conflict' })
    const before = (await pendingWrites()).find(write => write.tripId === trip.id)
    await expect(admitTripPreview({ tripId: trip.id, expectedBase: baseOf(trip.id), patch: { name: 'Preview' } })).resolves.toMatchObject({ kind: 'conflict' })
    expect((await pendingWrites()).find(write => write.tripId === trip.id)).toEqual(before)
    expect(tripById(trip.id)?.name).toBe('Existing')
  })

  it('does not take the receipt of a nested subscriber edit', async () => {
    _setTripWriteDebounceMs(10_000)
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    await tick()
    const proposedDays = structuredClone(trip.days)
    const days = structuredClone(proposedDays)
    days[0].stops = []
    let nested = false
    const unsubscribe = subscribe(() => {
      if (!nested && tripById(trip.id)?.name === 'Preview') {
        nested = true
        updateTrip(trip.id, { name: 'Nested', days })
      }
    })
    try {
      const result = await admitTripPreview({ tripId: trip.id, expectedBase: baseOf(trip.id), patch: { name: 'Preview', days: proposedDays } })
      expect(result.kind).toBe('superseded')
      const nestedReceipt = tripWriteReceipt(trip.id)
      _flushTripWrites()
      await expect(nestedReceipt).resolves.toMatchObject({ kind: 'acknowledged' })
      expect(tripById(trip.id)?.name).toBe('Nested')
    } finally { unsubscribe() }
  })

  it('refuses a draft changed in place by a synchronous subscriber', async () => {
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    await tick()
    const unsubscribe = subscribe(() => {
      const current = tripById(trip.id)
      if (current?.name === 'Preview') current.name = 'Changed in place'
    })
    try {
      await expect(admitTripPreview({ tripId: trip.id, expectedBase: baseOf(trip.id), patch: { name: 'Preview' } })).resolves.toMatchObject({ kind: 'superseded' })
      expect(state.updates).toHaveLength(0)
    } finally { unsubscribe() }
  })

  it('does not let an older response admit a new preview over pending work', async () => {
    let release: (result: { data: null; error: null }) => void = () => {}
    state.hold = new Promise(resolve => { release = resolve })
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    await tick()
    const first = admitTripPreview({ tripId: trip.id, expectedBase: baseOf(trip.id), patch: { name: 'First' } })
    await tick()
    const second = admitTripPreview({ tripId: trip.id, expectedBase: baseOf(trip.id), patch: { name: 'Second' } })
    await expect(second).resolves.toMatchObject({ kind: 'conflict' })
    release({ data: null, error: null })
    await expect(first).resolves.toMatchObject({ kind: 'acknowledged' })
    expect(tripById(trip.id)?.name).toBe('First')
  })

  it.each(['cancel', 'failure', 'identity'] as const)('does not claim success on %s', async kind => {
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    await tick()
    if (kind === 'failure') state.refuse = { message: 'offline' }
    else state.hold = new Promise(() => {})
    const result = admitTripPreview({ tripId: trip.id, expectedBase: baseOf(trip.id), patch: { name: 'Pending' } })
    await tick()
    if (kind === 'cancel') _cancelTripWrites()
    if (kind === 'identity') await logout()
    await expect(result).resolves.toMatchObject({ kind: 'unavailable' })
  })

  it('refuses while the same identity has a metadata write in flight', async () => {
    const trip = duplicateTrip(keralaTrip, 'owner-test')
    await tick()
    state.configured = true
    state.hold = new Promise(() => {})
    void ensureInviteCode(trip.id)
    await tick()
    expect(state.accessCalls).toBe(1)
    await expect(admitTripPreview({ tripId: trip.id, expectedBase: baseOf(trip.id), patch: { name: 'Preview' } }))
      .resolves.toMatchObject({ kind: 'conflict' })
  })
})
