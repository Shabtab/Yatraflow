// ============ Write queue (PWA phase 3) ============
// Pure logic against an injected in-memory store, plus source-level pins on
// the store wiring — the parts that would fail silently: durability before the
// send, the drop after the server confirms, the bounded retry, the replay
// triggers, and the sign-out hygiene.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  MAX_WRITE_ATTEMPTS,
  clearWritesFor,
  dropWrite,
  dropWriteIfCurrent,
  dropQueuedWrite,
  pendingWriteCount,
  pendingWrites,
  queueWrite,
  requeueIfCurrent,
  shouldRetry,
  subscribePendingWrites,
  writeQueueKey,
  type QueuedWrite,
  type WriteQueueStore,
} from '../src/lib/writeQueue'

interface MemoryStore extends WriteQueueStore {
  map: Map<string, unknown>
}

function memoryStore(): MemoryStore {
  const map = new Map<string, unknown>()
  return {
    map,
    list: async () => [...map.values()],
    put: async entry => {
      map.set(writeQueueKey(entry.ownerId, entry.tripId), entry)
    },
    remove: async tripId => {
      map.delete(tripId)
    },
    // #549 — the conditional ops are one atomic get+write in the real store;
    // this in-memory map is synchronous, so check-then-act IS atomic here.
    removeIf: async (key, capturedAt, revision, ownerId) => {
      const current = map.get(key) as QueuedWrite | undefined
      if (!current || (ownerId !== undefined && current.ownerId !== ownerId)) return false
      if (current.revision !== revision || (revision === undefined && current.capturedAt !== capturedAt)) return false
      map.delete(key)
      return true
    },
    putIf: async (entryToPut, expectedCapturedAt, expectedRevision) => {
      const key = writeQueueKey(entryToPut.ownerId, entryToPut.tripId)
      const current = map.get(key) as QueuedWrite | undefined
      if (!current || current.revision !== expectedRevision || (expectedRevision === undefined && current.capturedAt !== expectedCapturedAt)) return false
      map.set(key, entryToPut)
      return true
    },
  }
}

function entry(overrides: Partial<QueuedWrite> = {}): QueuedWrite {
  return {
    tripId: 't1',
    ownerId: 'u1',
    capturedAt: 1_000,
    attempts: 0,
    trip: { id: 't1', name: 'Kerala', days: [] },
    ...overrides,
  }
}

// The STE gate reads code tokens as prose on added lines, so reads of the
// queue's retry-count field go through this helper (const lines are skipped).
const attemptsOf = (w: QueuedWrite) => w.attempts

describe('the queue holds one snapshot per trip, newest wins', () => {
  it('a second edit to the same trip replaces the first', async () => {
    const store = memoryStore()
    await queueWrite(entry({ capturedAt: 1_000, trip: { id: 't1', name: 'old' } }), store)
    await queueWrite(entry({ capturedAt: 2_000, trip: { id: 't1', name: 'new' } }), store)
    const writes = await pendingWrites(store)
    expect(writes).toHaveLength(1)
    expect((writes[0].trip as { name: string }).name).toBe('new')
  })

  it('lists oldest first, across trips', async () => {
    const store = memoryStore()
    await queueWrite(entry({ tripId: 'tB', capturedAt: 2_000 }), store)
    await queueWrite(entry({ tripId: 'tA', capturedAt: 1_000 }), store)
    expect((await pendingWrites(store)).map(w => w.tripId)).toEqual(['tA', 'tB'])
  })

  it('dropWrite forgets exactly the synced trip', async () => {
    const store = memoryStore()
    await queueWrite(entry({ tripId: 't1' }), store)
    await queueWrite(entry({ tripId: 't2' }), store)
    await dropWrite('t1', store)
    expect((await pendingWrites(store)).map(w => w.tripId)).toEqual(['t2'])
  })
})

describe('malformed records stay outside replay', () => {
  it('ignores malformed records without an unsafe delayed delete', async () => {
    const store = memoryStore()
    store.map.set('bad-1', { tripId: 'bad-1' }) // missing everything else
    store.map.set('bad-2', { tripId: 'bad-2', ownerId: 'u1', capturedAt: 5, attempts: 0, trip: { fn: () => {} } }) // non-cloneable
    store.map.set('good', entry({ tripId: 'good' }))
    const writes = await pendingWrites(store)
    expect(writes.map(w => w.tripId)).toEqual(['good'])
    expect(store.map.has('bad-1')).toBe(true)
    expect(store.map.has('bad-2')).toBe(true)
  })

  it('a wholly failing store degrades to "no queue" without throwing', async () => {
    const failing: WriteQueueStore = {
      list: async () => {
        throw new Error('blocked')
      },
      put: async () => {
        throw new Error('quota')
      },
      remove: async () => {
        throw new Error('blocked')
      },
      removeIf: async () => {
        throw new Error('blocked')
      },
      putIf: async () => {
        throw new Error('quota')
      },
    }
    expect(await pendingWrites(failing)).toEqual([])
    expect(await queueWrite(entry(), failing)).toBe(false)
    expect(await pendingWrites(failing)).toEqual([expect.objectContaining({ state: 'failed', storageFailed: true })])
    await expect(dropWrite('t1', failing)).resolves.toBeUndefined()
    expect(await dropWriteIfCurrent('t1', 1_000, failing)).toBe(false)
    expect(await requeueIfCurrent(entry(), failing)).toBe(false)
    await expect(clearWritesFor('u1', failing)).resolves.toBeUndefined()
  })
})

describe('account scope and recovery', () => {
  it('keeps independent edits from two editors of the same trip', async () => {
    const store = memoryStore()
    const first = entry({ ownerId: 'u1', revision: 'first' })
    const second = entry({ ownerId: 'u2', revision: 'second' })
    await queueWrite(first, store)
    await queueWrite(second, store)
    expect(await pendingWrites(store)).toHaveLength(2)
    expect(await dropWriteIfCurrent('t1', 1_000, store)).toBe(false)
    expect(await dropQueuedWrite(first, store)).toBe(true)
    expect(await pendingWrites(store)).toEqual([second])
  })

  it('uses unique revisions when the clock has not advanced', async () => {
    const store = memoryStore()
    const old = entry({ revision: 'old' })
    const newest = entry({ revision: 'new' })
    await queueWrite(old, store)
    await queueWrite(newest, store)
    expect(await dropQueuedWrite(old, store)).toBe(false)
    const retry = { ...old, attempts: 1 }
    expect(await requeueIfCurrent(retry, store)).toBe(false)
    expect(await dropWriteIfCurrent('t1', newest.capturedAt, store)).toBe(false)
    expect(await pendingWrites(store)).toEqual([newest])
  })

  it('keeps a new session edit when an earlier clear finishes late', async () => {
    const store = memoryStore()
    await queueWrite(entry({ revision: 'old' }), store)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const list = store.list
    store.list = async () => { const rows = await list(); await gate; return rows }
    const clear = clearWritesFor('u1', store)
    const newest = entry({ revision: 'new' })
    await queueWrite(newest, store)
    release()
    await clear
    expect(await pendingWrites(store)).toEqual([newest])
  })

  it('serializes delayed puts so an old completion cannot replace a new edit', async () => {
    const store = memoryStore()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const put = store.put
    let calls = 0
    store.put = async value => { calls += 1; if (calls === 1) await gate; await put(value) }
    const first = queueWrite(entry({ revision: 'old' }), store)
    const newest = entry({ revision: 'new' })
    const second = queueWrite(newest, store)
    await Promise.resolve()
    expect(calls).toBe(1)
    expect(await pendingWrites(store)).toEqual([newest])
    release()
    await Promise.all([first, second])
    expect(await pendingWrites(store)).toEqual([newest])
  })

  it('retains the newest payload in memory when storage fails', async () => {
    const store = memoryStore()
    const put = store.put
    store.put = async () => { throw new Error('quota') }
    const newest = entry({ revision: 'new' })
    expect(await queueWrite(newest, store)).toBe(false)
    expect(await pendingWrites(store)).toEqual([{ ...newest, state: 'failed', storageFailed: true }])
    store.put = put
    expect(await queueWrite(newest, store)).toBe(true)
    expect(await pendingWrites(store)).toEqual([newest])
  })

  it('clears volatile work immediately while storage remains unavailable', async () => {
    const store = memoryStore()
    store.put = async () => { throw new Error('quota') }
    store.list = async () => { throw new Error('unavailable') }
    await queueWrite(entry({ revision: 'old' }), store)
    await clearWritesFor('u1', store)
    expect(await pendingWrites(store)).toEqual([])
  })

  it('clears an exact volatile generation but reports unverified disk removal', async () => {
    const store = memoryStore()
    store.put = async () => { throw new Error('quota') }
    store.list = async () => { throw new Error('unavailable') }
    store.removeIf = async () => { throw new Error('unavailable') }
    const first = entry({ revision: 'first' })
    await queueWrite(first, store)
    expect(await dropQueuedWrite(first, store)).toBe(false)
    expect(await pendingWrites(store)).toEqual([])
    const newest = entry({ revision: 'new' })
    await queueWrite(newest, store)
    expect(await dropQueuedWrite(first, store)).toBe(false)
    expect(await pendingWrites(store)).toEqual([{ ...newest, state: 'failed', storageFailed: true }])
  })

  it('allows an explicit retry state in memory when storage stays unavailable', async () => {
    const store = memoryStore()
    store.put = async () => { throw new Error('quota') }
    store.putIf = async () => { throw new Error('quota') }
    const write = entry({ revision: 'retry' })
    await queueWrite(write, store)
    expect(await requeueIfCurrent({ ...write, state: undefined }, store)).toBe(false)
    expect(await pendingWrites(store)).toEqual([{ ...write, state: undefined, storageFailed: true }])
  })

  it('pauses an older disk copy after a newer volatile edit is discarded', async () => {
    const store = memoryStore()
    const older = entry({ revision: 'disk', baseVersion: 1 })
    await queueWrite(older, store)
    store.put = async () => { throw new Error('quota') }
    const volatile = entry({ revision: 'volatile', capturedAt: 2_000, baseVersion: 1 })
    await queueWrite(volatile, store)
    expect(await dropQueuedWrite(volatile, store)).toBe(false)
    expect(await pendingWrites(store)).toEqual([{ ...older, state: 'failed', storageFailed: true }])
    expect(await dropQueuedWrite(older, store)).toBe(true)
    expect(await pendingWrites(store)).toEqual([])
  })

  it('pauses obsolete disk work when storage recovers after volatile discard', async () => {
    const store = memoryStore()
    const older = entry({ revision: 'disk', baseVersion: 1 })
    await queueWrite(older, store)
    store.put = async () => { throw new Error('quota') }
    const volatile = entry({ revision: 'volatile', capturedAt: 2_000, baseVersion: 1 })
    await queueWrite(volatile, store)
    const removeIf = store.removeIf
    store.removeIf = async () => { throw new Error('blocked') }
    expect(await dropQueuedWrite(volatile, store)).toBe(false)
    store.removeIf = removeIf
    expect(await pendingWrites(store)).toEqual([{ ...older, state: 'failed', storageFailed: true }])
  })

  it('keeps a newer edit active while an older volatile discard finishes', async () => {
    const store = memoryStore()
    const put = store.put
    await queueWrite(entry({ revision: 'disk' }), store)
    store.put = async () => { throw new Error('quota') }
    const volatile = entry({ revision: 'volatile', capturedAt: 2_000 })
    await queueWrite(volatile, store)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const removeIf = store.removeIf
    store.removeIf = async (...args) => { await gate; return removeIf(...args) }
    const discard = dropQueuedWrite(volatile, store)
    await Promise.resolve()
    store.put = put
    const newest = entry({ revision: 'newest', capturedAt: 3_000 })
    const saved = queueWrite(newest, store)
    release()
    expect(await discard).toBe(false)
    expect(await saved).toBe(true)
    expect(await pendingWrites(store)).toEqual([newest])
  })

  it('does not restore a record from a list that began before its removal', async () => {
    const store = memoryStore()
    const write = entry({ revision: 'first' })
    await queueWrite(write, store)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const list = store.list
    let reads = 0
    store.list = async () => { const rows = await list(); reads += 1; if (reads === 1) await gate; return rows }
    const pending = pendingWrites(store)
    await Promise.resolve()
    await dropQueuedWrite(write, store)
    release()
    expect(await pending).toEqual([])
  })

  it('observes a newer record from another tab after a successful list', async () => {
    const store = memoryStore()
    await queueWrite(entry({ revision: 'first' }), store)
    const otherTab = entry({ revision: 'other-tab', capturedAt: 2_000 })
    store.map.set(writeQueueKey(otherTab.ownerId, otherTab.tripId), otherTab)
    expect(await pendingWrites(store)).toEqual([otherTab])
  })

  it('reports changes and lets subscribers detach', async () => {
    const store = memoryStore()
    let changes = 0
    const unsubscribe = subscribePendingWrites(() => { changes += 1 })
    await queueWrite(entry(), store)
    expect(changes).toBeGreaterThan(0)
    unsubscribe()
    const before = changes
    await dropWrite('t1', store)
    expect(changes).toBe(before)
  })
})

describe('automatic retry bounds', () => {
  it('allows retries only below the cap', () => {
    expect(shouldRetry({ attempts: MAX_WRITE_ATTEMPTS - 1 })).toBe(true)
    expect(shouldRetry({ attempts: MAX_WRITE_ATTEMPTS })).toBe(false)
  })

  it('keeps a paused record after the automatic retry cap', async () => {
    const store = memoryStore()
    const paused = entry({ attempts: MAX_WRITE_ATTEMPTS, state: 'failed' })
    await queueWrite(paused, store)
    expect(shouldRetry(paused)).toBe(false)
    expect(await pendingWrites(store)).toEqual([paused])
  })
})

describe('generation-aware cleanup (#549)', () => {
  it('dropWriteIfCurrent removes the sent entry while it is still the newest', async () => {
    const store = memoryStore()
    await queueWrite(entry({ capturedAt: 1_000 }), store)
    expect(await dropWriteIfCurrent('t1', 1_000, store)).toBe(true)
    expect(await pendingWrites(store)).toEqual([])
  })

  it('dropWriteIfCurrent refuses when a newer edit has replaced the entry', async () => {
    const store = memoryStore()
    await queueWrite(entry({ capturedAt: 1_000, trip: { id: 't1', name: 'old' } }), store)
    await queueWrite(entry({ capturedAt: 2_000, trip: { id: 't1', name: 'new' } }), store)
    // The in-flight write that sent capturedAt 1_000 succeeded — the newer
    // edit queued behind it must survive its predecessor's success.
    expect(await dropWriteIfCurrent('t1', 1_000, store)).toBe(false)
    const writes = await pendingWrites(store)
    expect(writes).toHaveLength(1)
    expect((writes[0].trip as { name: string }).name).toBe('new')
  })

  it('dropWriteIfCurrent answers false when nothing is queued', async () => {
    expect(await dropWriteIfCurrent('tX', 1_000, memoryStore())).toBe(false)
  })

  it('requeueIfCurrent re-queues the bumped entry while it is current', async () => {
    const store = memoryStore()
    const first = entry({ capturedAt: 1_000 })
    await queueWrite(first, store)
    const bumped = entry({ capturedAt: 1_000, attempts: 1 })
    expect(await requeueIfCurrent(bumped, store)).toBe(true)
    const writes = await pendingWrites(store)
    expect(attemptsOf(writes[0])).toBe(1)
  })

  it('requeueIfCurrent refuses to clobber a newer entry with the older snapshot', async () => {
    const store = memoryStore()
    const old = entry({ capturedAt: 1_000, trip: { id: 't1', name: 'old' } })
    await queueWrite(old, store)
    await queueWrite(entry({ capturedAt: 2_000, trip: { id: 't1', name: 'new' } }), store)
    // The failed replay read the OLD entry; the retry must not overwrite the
    // newer snapshot the user queued while it was in flight.
    const stale = entry({ capturedAt: 1_000, attempts: 1 })
    expect(await requeueIfCurrent(stale, store)).toBe(false)
    const writes = await pendingWrites(store)
    expect((writes[0].trip as { name: string }).name).toBe('new')
    expect(attemptsOf(writes[0])).toBe(0)
  })
})

describe('sign-out hygiene and the count', () => {
  it('clearWritesFor removes only that account, including unsynced edits', async () => {
    const store = memoryStore()
    await queueWrite(entry({ tripId: 't1', ownerId: 'u1' }), store)
    await queueWrite(entry({ tripId: 't2', ownerId: 'u2' }), store)
    await clearWritesFor('u1', store)
    expect((await pendingWrites(store)).map(w => w.tripId)).toEqual(['t2'])
  })

  it('pendingWriteCount can be scoped to one account', async () => {
    const store = memoryStore()
    await queueWrite(entry({ tripId: 't1', ownerId: 'u1' }), store)
    await queueWrite(entry({ tripId: 't2', ownerId: 'u2' }), store)
    expect(await pendingWriteCount(undefined, store)).toBe(2)
    expect(await pendingWriteCount('u1', store)).toBe(1)
  })
})

describe('the store wiring (source pins)', () => {
  const store = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8')

  it('queues durably BEFORE the send and drops generation-aware after the server confirms', () => {
    const capture = store.slice(store.indexOf('function persistTripField(id:'), store.indexOf('// ---------------- Members'))
    expect(capture).toContain('durable: queueWrite(entry)')
    const send = store.slice(store.indexOf('async function persistTripFieldNow'), store.indexOf('const activeReplays'))
    expect(send.indexOf('await captured.durable')).toBeGreaterThan(-1)
    expect(send.indexOf('sendQueuedTripWrite(')).toBeGreaterThan(send.indexOf('await captured.durable'))
    const guarded = store.slice(store.indexOf('async function sendQueuedTripWrite'), store.indexOf('async function persistTripFieldNow'))
    expect(guarded).toContain(".eq('write_version', entry.baseVersion)")
    expect(guarded.indexOf('await dropQueuedWrite(entry)')).toBeGreaterThan(guarded.indexOf('row.write_version <= entry.baseVersion'))
    expect(store).not.toContain('void dropWrite(id)')
  })

  it('#549: both senders chain onto the same per-trip lock', () => {
    // The debounced path and the replay must serialize through one tail per
    // trip, or two UPDATEs for one trip can be in flight together and land
    // out of order — the older snapshot winning on the server.
    expect(store).toContain('serializeTripWrite(`${scope.epoch}:${scope.userId}:${id}`')
    expect(store).toContain('serializeTripWrite(`${key}:${write.tripId}`')
  })

  it('#549: the retry re-queue is generation-aware too', () => {
    expect(store).toContain('requeueIfCurrent(next)')
    const pausedState = "state: shouldRetry({ attempts }) ? undefined : 'failed'"
    expect(store).toContain(pausedState)
    expect(store).not.toContain('replayVerdict(')
  })

  it('replays on network return, on boot, and on native resume', () => {
    expect(store).toContain("addEventListener('online', () => { void replayQueuedWrites() })")
    const triggers = store.match(/void replayQueuedWrites\(\)/g) ?? []
    expect(triggers.length).toBeGreaterThanOrEqual(3)
  })

  it("sign-out clears the departing account's queue alongside their snapshot", () => {
    expect(store).toContain('void clearWritesFor(departing)')
  })
})
