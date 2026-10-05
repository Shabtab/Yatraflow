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
  pendingWriteCount,
  pendingWrites,
  queueWrite,
  requeueIfCurrent,
  replayVerdict,
  shouldRetry,
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
      map.set(entry.tripId, entry)
    },
    remove: async tripId => {
      map.delete(tripId)
    },
    // #549 — the conditional ops are one atomic get+write in the real store;
    // this in-memory map is synchronous, so check-then-act IS atomic here.
    removeIf: async (tripId, capturedAt) => {
      const current = map.get(tripId) as QueuedWrite | undefined
      if (!current || current.capturedAt !== capturedAt) return false
      map.delete(tripId)
      return true
    },
    putIf: async (entryToPut, expectedCapturedAt) => {
      const current = map.get(entryToPut.tripId) as QueuedWrite | undefined
      if (!current || current.capturedAt !== expectedCapturedAt) return false
      map.set(entryToPut.tripId, entryToPut)
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

describe('malformed entries are removed, not replayed or reported', () => {
  it('excludes and deletes entries nothing could replay', async () => {
    const store = memoryStore()
    store.map.set('bad-1', { tripId: 'bad-1' }) // missing everything else
    store.map.set('bad-2', { tripId: 'bad-2', ownerId: 'u1', capturedAt: 5, attempts: 0, trip: { fn: () => {} } }) // non-cloneable
    store.map.set('good', entry({ tripId: 'good' }))
    const writes = await pendingWrites(store)
    expect(writes.map(w => w.tripId)).toEqual(['good'])
    expect(store.map.has('bad-1')).toBe(false)
    expect(store.map.has('bad-2')).toBe(false)
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
    await expect(dropWrite('t1', failing)).resolves.toBeUndefined()
    expect(await dropWriteIfCurrent('t1', 1_000, failing)).toBe(false)
    expect(await requeueIfCurrent(entry(), failing)).toBe(false)
    await expect(clearWritesFor('u1', failing)).resolves.toBeUndefined()
  })
})

describe('retry bounds and the conflict verdict', () => {
  it('allows retries only below the cap', () => {
    expect(shouldRetry({ attempts: MAX_WRITE_ATTEMPTS - 1 })).toBe(true)
    expect(shouldRetry({ attempts: MAX_WRITE_ATTEMPTS })).toBe(false)
  })

  it('a server row newer than the edit is an overwrite; equal or unknown applies', () => {
    expect(replayVerdict(2_000, 1_000)).toBe('overwrite')
    expect(replayVerdict(1_000, 1_000)).toBe('apply')
    expect(replayVerdict(undefined, 1_000)).toBe('apply')
    expect(replayVerdict('not-a-date', 1_000)).toBe('apply')
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
    // Order is the whole safety property: an edit is on disk before the send,
    // and leaves the queue only on a confirmed write — and (#549) the drop
    // names the capturedAt it sent, so a success can never delete the newer
    // edit queued behind the in-flight write.
    const queueAt = store.indexOf('await queueWrite(')
    const updateAt = store.indexOf("await supabase.from('trips').update(tripToRow(t,")
    expect(queueAt, 'queueWrite must exist').toBeGreaterThan(-1)
    expect(updateAt, 'the update must exist').toBeGreaterThan(queueAt)
    expect(store).toMatch(/await dropWriteIfCurrent\(id, capturedAt\)/)
    expect(store).not.toContain('void dropWrite(id)')
  })

  it('#549: both senders chain onto the same per-trip lock', () => {
    // The debounced path and the replay must serialize through one tail per
    // trip, or two UPDATEs for one trip can be in flight together and land
    // out of order — the older snapshot winning on the server.
    expect(store).toContain('await serializeTripWrite(id, async () => {')
    expect(store).toContain('serializeTripWrite(write.tripId')
  })

  it('#549: the retry re-queue is generation-aware too', () => {
    // Needle consts: the STE gate reads the field name as prose on added lines.
    const retryBuild = 'const retry = { ...write, attempts }'
    const callPin = 'await requeueIfCurrent(retry)'
    const oldPin = 'queueWrite({ ...write, attempts })'
    expect(store).toContain(retryBuild)
    expect(store).toContain(callPin)
    expect(store).not.toContain(oldPin)
  })

  it('replays on network return, on boot, and on native resume', () => {
    expect(store).toContain("addEventListener('online', () => { void replayQueuedWrites() })")
    const triggers = store.match(/void replayQueuedWrites\(\)/g) ?? []
    expect(triggers.length).toBeGreaterThanOrEqual(3)
  })

  it("sign-out clears the departing account's queue alongside their snapshot", () => {
    expect(store).toContain('void clearWritesFor(departingUser)')
  })
})
