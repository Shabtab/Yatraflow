import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QueuedWrite } from '../src/lib/writeQueue'

type Outcome = 'complete' | 'abort' | 'error' | 'quota'

/** Requests finish before transactions. Only committed writes reach the stored maps. */
function fakeIndexedDb() {
  const stores = new Map<string, Map<IDBValidKey, unknown>>([
    ['writes', new Map()], ['snapshots', new Map()],
  ])
  const state = {
    nextOutcome: 'complete' as Outcome,
    autoComplete: true,
    openMode: 'success' as 'success' | 'blocked' | 'error' | 'silent',
    closes: 0,
    opens: 0,
    finish: null as (() => void) | null,
    lastOpen: null as IDBOpenDBRequest | null,
  }
  const db = {
    close: () => { state.closes += 1 },
    onversionchange: null as (() => void) | null,
    onclose: null as (() => void) | null,
    transaction(name: string, mode: IDBTransactionMode) {
      const saved = stores.get(name)!
      const working = new Map(saved)
      const outcome = mode === 'readwrite' ? state.nextOutcome : 'complete'
      if (mode === 'readwrite') state.nextOutcome = 'complete'
      let pending = 0
      let ended = false
      const tx = {
        error: null as DOMException | null,
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        abort: () => {
          ended = true
          tx.onabort?.()
        },
        objectStore: () => ({
          get: (key: IDBValidKey) => request(() => working.get(key)),
          getAll: () => request(() => [...working.values()]),
          put: (value: unknown, key: IDBValidKey) => request(() => {
            working.set(key, structuredClone(value))
            return key
          }, true),
          delete: (key: IDBValidKey) => request(() => { working.delete(key) }, true),
        }),
      }
      const finish = () => {
        if (ended || pending > 0) return
        ended = true
        if (outcome === 'abort') { tx.onabort?.(); return }
        if (outcome === 'error') { tx.onerror?.(); return }
        if (mode === 'readwrite') {
          saved.clear()
          for (const [key, value] of working) saved.set(key, value)
        }
        tx.oncomplete?.()
      }
      function request(operation: () => unknown, mutation = false) {
        pending += 1
        const req = {
          result: undefined as unknown,
          error: null as DOMException | null,
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
        }
        queueMicrotask(() => {
          if (ended) return
          if (mutation && outcome === 'quota') {
            ended = true
            req.error = new DOMException('Storage quota reached', 'QuotaExceededError')
            req.onerror?.()
            tx.onabort?.()
            return
          }
          req.result = operation()
          req.onsuccess?.()
          pending -= 1
          if (state.autoComplete) queueMicrotask(finish)
        })
        return req
      }
      state.finish = finish
      return tx
    },
  }
  const indexedDB = {
    open() {
      state.opens += 1
      const request = {
        result: db,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onblocked: null as (() => void) | null,
      }
      state.lastOpen = request as unknown as IDBOpenDBRequest
      queueMicrotask(() => {
        if (state.openMode === 'blocked') request.onblocked?.()
        else if (state.openMode === 'error') request.onerror?.()
        else if (state.openMode === 'success') request.onsuccess?.()
      })
      return request
    },
  }
  return { indexedDB, stores, state, db }
}

const entry: QueuedWrite = {
  tripId: 'trip-one', ownerId: 'editor-one', capturedAt: 1_000, attempts: 0,
  trip: { id: 'trip-one', name: 'Saved locally' },
}
const slices = {
  trips: [], trashedTrips: [], users: [], published: [], suggestions: [], decisions: [], activity: [],
}
const requestsDone = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

async function setup() {
  vi.resetModules()
  const fake = fakeIndexedDb()
  vi.stubGlobal('indexedDB', fake.indexedDB)
  const queue = await import('../src/lib/writeQueue')
  const cache = await import('../src/lib/offlineCache')
  return { ...fake, queue, cache }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the real IndexedDB adapters wait for transaction commit', () => {
  it('keeps a successful request pending until the transaction commits', async () => {
    const { queue, state, stores } = await setup()
    state.autoComplete = false
    let settled = false
    const result = queue.queueWrite(entry).then(value => { settled = true; return value })
    await requestsDone()
    expect(settled).toBe(false)
    expect(stores.get('writes')!.has(queue.writeQueueKey(entry.ownerId, entry.tripId))).toBe(false)
    state.finish!()
    expect(await result).toBe(true)
    expect(stores.get('writes')!.get(queue.writeQueueKey(entry.ownerId, entry.tripId))).toEqual(entry)
  })

  it.each(['abort', 'error', 'quota'] as const)('reports a failed queue transaction: %s', async outcome => {
    const { queue, state, stores } = await setup()
    state.nextOutcome = outcome
    expect(await queue.queueWrite(entry)).toBe(false)
    expect(stores.get('writes')!.has(queue.writeQueueKey(entry.ownerId, entry.tripId))).toBe(false)
  })

  it.each(['abort', 'error', 'quota'] as const)('reports a failed snapshot transaction: %s', async outcome => {
    const { cache, state, stores } = await setup()
    state.nextOutcome = outcome
    expect(await cache.saveSnapshot('editor-one', slices)).toBe(false)
    expect(stores.get('snapshots')!.has('editor-one')).toBe(false)
  })

  it('commits a snapshot and reads it through the default adapter', async () => {
    const { cache } = await setup()
    expect(await cache.saveSnapshot('editor-one', slices)).toBe(true)
    expect((await cache.loadSnapshot('editor-one'))?.version).toBe(cache.SNAPSHOT_VERSION)
  })

  it('keeps a conditional delete after request success when commit aborts', async () => {
    const { queue, state, stores } = await setup()
    expect(await queue.queueWrite(entry)).toBe(true)
    state.nextOutcome = 'abort'
    expect(await queue.dropWriteIfCurrent(entry.tripId, entry.capturedAt)).toBe(false)
    expect(stores.get('writes')!.get(queue.writeQueueKey(entry.ownerId, entry.tripId))).toEqual(entry)
    expect(await queue.dropWriteIfCurrent(entry.tripId, entry.capturedAt)).toBe(true)
    expect(stores.get('writes')!.has(queue.writeQueueKey(entry.ownerId, entry.tripId))).toBe(false)
  })

  it('keeps the original entry when a conditional replacement aborts', async () => {
    const { queue, state, stores } = await setup()
    expect(await queue.queueWrite(entry)).toBe(true)
    const replacement = { ...entry, attempts: 1 }
    state.nextOutcome = 'abort'
    expect(await queue.requeueIfCurrent(replacement)).toBe(false)
    expect(stores.get('writes')!.get(queue.writeQueueKey(entry.ownerId, entry.tripId))).toEqual(entry)
    expect(await queue.requeueIfCurrent(replacement)).toBe(true)
    expect(stores.get('writes')!.get(queue.writeQueueKey(entry.ownerId, entry.tripId))).toEqual(replacement)
  })

  it('does not mutate an entry with a different conditional generation', async () => {
    const { queue, stores } = await setup()
    await queue.queueWrite(entry)
    expect(await queue.dropWriteIfCurrent(entry.tripId, entry.capturedAt + 1)).toBe(false)
    expect(await queue.requeueIfCurrent({ ...entry, capturedAt: 2_000 })).toBe(false)
    expect(stores.get('writes')!.get(queue.writeQueueKey(entry.ownerId, entry.tripId))).toEqual(entry)
  })
})

describe('offline database availability', () => {
  it('reports unavailable storage and can recover without a reload', async () => {
    const { queue, cache, indexedDB } = await setup()
    vi.stubGlobal('indexedDB', undefined)
    expect(await queue.queueWrite(entry)).toBe(false)
    expect(await cache.saveSnapshot('editor-one', slices)).toBe(false)
    expect(await queue.pendingWrites()).toEqual([{ ...entry, state: 'failed', storageFailed: true }])
    vi.stubGlobal('indexedDB', indexedDB)
    expect(await queue.queueWrite(entry)).toBe(true)
  })

  it.each(['blocked', 'error'] as const)('settles a failed open and retries later: %s', async mode => {
    const { cache, state } = await setup()
    state.openMode = mode
    expect(await cache.openOfflineDb()).toBeNull()
    const abandoned = state.lastOpen!
    state.openMode = 'success'
    expect(await cache.openOfflineDb()).not.toBeNull()
    expect(state.opens).toBe(2)
    if (mode === 'blocked') {
      abandoned.onsuccess?.(new Event('success'))
      expect(state.closes).toBe(1)
    }
  })

  it('closes an old connection when another tab upgrades the database', async () => {
    const { cache, state, db } = await setup()
    await cache.openOfflineDb()
    db.onversionchange?.()
    expect(state.closes).toBe(1)
    await cache.openOfflineDb()
    expect(state.opens).toBe(2)
  })

  it('settles an open request that never reports an outcome', async () => {
    vi.useFakeTimers()
    const { cache, state } = await setup()
    state.openMode = 'silent'
    const result = cache.openOfflineDb()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await result).toBeNull()
  })
})
