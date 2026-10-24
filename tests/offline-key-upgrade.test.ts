import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals() })

describe('offline queue key upgrade', () => {
  it('moves legacy keys and preserves the newer scoped replacement', async () => {
    vi.resetModules()
    const old = { ownerId: 'A', tripId: 'shared', capturedAt: 1, trip: { id: 'shared' } }
    const fresh = { ...old, capturedAt: 2 }
    const other = { ownerId: 'B', tripId: 'other', capturedAt: 3, trip: { id: 'other' } }
    const rows = new Map<string, unknown>([
      ['shared', old], ['["A","shared"]', fresh], ['other', other],
    ])
    let requestedVersion: number | undefined
    const db = {
      objectStoreNames: { contains: () => true },
      close: () => {},
    }
    const indexedDB = {
      open: (_name: string, version: number) => {
        requestedVersion = version
        const request = {
          result: db,
          onupgradeneeded: null as ((event: { oldVersion: number }) => void) | null,
          onsuccess: null as (() => void) | null,
          transaction: {
            objectStore: () => ({
              get: (key: string) => {
                const result = { result: rows.get(key), onsuccess: null as (() => void) | null }
                queueMicrotask(() => result.onsuccess?.())
                return result
              },
              put: (value: unknown, key: string) => { rows.set(key, value) },
              openCursor: () => {
                const initial = [...rows]
                let index = 0
                const cursorRequest = { result: null as unknown, onsuccess: null as (() => void) | null }
                const next = () => {
                  const entry = initial[index++]
                  cursorRequest.result = entry ? {
                    primaryKey: entry[0], value: entry[1],
                    delete: () => rows.delete(entry[0]),
                    continue: () => { queueMicrotask(next) },
                  } : null
                  cursorRequest.onsuccess?.()
                  if (!entry) queueMicrotask(() => request.onsuccess?.())
                }
                queueMicrotask(next)
                return cursorRequest
              },
            }),
          },
        }
        queueMicrotask(() => request.onupgradeneeded?.({ oldVersion: 2 }))
        return request
      },
    }
    vi.stubGlobal('indexedDB', indexedDB)
    const cache = await import('../src/lib/offlineCache')
    expect(await cache.openOfflineDb()).not.toBeNull()
    expect(requestedVersion).toBe(3)
    expect(rows.has('shared')).toBe(false)
    expect(rows.has('other')).toBe(false)
    expect(rows.get(cache.writeQueueKey('A', 'shared'))).toEqual(fresh)
    expect(rows.get(cache.writeQueueKey('B', 'other'))).toEqual(other)
  })
})
