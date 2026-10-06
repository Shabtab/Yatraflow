// ============ Offline snapshot cache (PWA phase 2) ============
// Pure logic against an injected in-memory store. The contract worth pinning is
// what the cache REFUSES: a stale schema, a partial record, another account's
// rows, or anything at all once the store itself has failed. The store wiring
// is pinned at source level, because those are the two rules that would fail
// silently and hand the wrong person the wrong trips.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  SNAPSHOT_VERSION,
  SLICE_KEYS,
  clearAllSnapshots,
  clearSnapshot,
  loadSnapshot,
  saveSnapshot,
  type SnapshotStore,
} from '../src/lib/offlineCache'

function memoryStore(): SnapshotStore & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>()
  return {
    map,
    read: async key => map.get(key) ?? null,
    write: async (key, value) => {
      map.set(key, value)
    },
    remove: async key => {
      map.delete(key)
    },
  }
}

const slices = () => ({
  trips: [{ id: 't1' }],
  trashedTrips: [],
  users: [{ id: 'u1' }],
  published: [],
  suggestions: [],
  decisions: [],
  activity: [],
})

describe('the snapshot round-trips', () => {
  it('stores the slices and reads them back with a timestamp and the current version', async () => {
    const store = memoryStore()
    expect(await saveSnapshot('u1', slices(), store)).toBe(true)
    const snapshot = await loadSnapshot('u1', store)
    expect(snapshot?.version).toBe(SNAPSHOT_VERSION)
    expect(snapshot?.trips).toEqual([{ id: 't1' }])
    expect(typeof snapshot?.savedAt).toBe('number')
  })

  it('is keyed by account — one user can never read another\'s plan', async () => {
    const store = memoryStore()
    await saveSnapshot('u1', slices(), store)
    expect(await loadSnapshot('u2', store)).toBeNull()
  })

  it('clearing forgets only that account', async () => {
    const store = memoryStore()
    await saveSnapshot('u1', slices(), store)
    await saveSnapshot('u2', slices(), store)
    await clearSnapshot('u1', store)
    expect(await loadSnapshot('u1', store)).toBeNull()
    expect(await loadSnapshot('u2', store)).not.toBeNull()
  })
})

describe('the cache refuses anything it cannot fully vouch for', () => {
  it('rejects a snapshot from another schema version', async () => {
    const store = memoryStore()
    store.map.set('u1', { version: SNAPSHOT_VERSION + 1, savedAt: Date.now(), ...slices() })
    expect(await loadSnapshot('u1', store)).toBeNull()
  })

  it('rejects a partial or malformed record', async () => {
    const broken = [
      { version: SNAPSHOT_VERSION, savedAt: Date.now(), trips: [] }, // slices missing
      { version: SNAPSHOT_VERSION, ...slices() }, // no timestamp
      { version: SNAPSHOT_VERSION, savedAt: Number.NaN, ...slices() }, // unusable timestamp
      { version: SNAPSHOT_VERSION, savedAt: Date.now(), ...slices(), trips: 'nope' }, // wrong type
      { version: SNAPSHOT_VERSION, savedAt: Date.now(), ...slices(), decisions: null },
    ]
    for (const record of broken) {
      const store = memoryStore()
      store.map.set('u1', record)
      expect(await loadSnapshot('u1', store), JSON.stringify(record).slice(0, 48)).toBeNull()
    }
  })

  it('degrades to "no cache" when the store itself fails, and never throws', async () => {
    const failing: SnapshotStore = {
      read: async () => {
        throw new Error('blocked')
      },
      write: async () => {
        throw new Error('quota')
      },
      remove: async () => {
        throw new Error('blocked')
      },
    }
    expect(await loadSnapshot('u1', failing)).toBeNull()
    expect(await saveSnapshot('u1', slices(), failing)).toBe(false)
    await expect(clearSnapshot('u1', failing)).resolves.toBeUndefined()
  })

  it('validates exactly the slices it persists', () => {
    // The two lists must not drift: a slice added to the writer but not to the
    // validator would be handed back to the store unchecked.
    expect([...SLICE_KEYS].sort()).toEqual([
      'activity', 'decisions', 'published', 'suggestions', 'trashedTrips', 'trips', 'users',
    ])
  })
})

describe('the store wiring keeps the two silent-failure rules', () => {
  const store = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8')

  it('persists only a CLEAN hydrate — never half an account', () => {
    // The save sits inside `if (partial.length === 0)`; the partial-failure
    // model is the store's own signal that something did not load.
    expect(store).toMatch(/if \(partial\.length === 0\) \{\s*\n\s*void saveSnapshot\(/)
  })

  it('forgets the snapshot when its owner signs out', () => {
    expect(store).toContain('void clearSnapshot(departingUser)')
  })

  it('marks cache-served rows with their snapshot time and clears it on a network hydrate', () => {
    expect(store).toContain('cachedAt: snapshot.savedAt')
    expect(store).toMatch(/sessionUserId: userId,\s*\n\s*cachedAt: null,/)
  })
})

// ---------------------------------------------------------------------------
// #575 Face C — the recovery screen's clear wipes the snapshot store whole,
// and never the pending-write queue: those rows are unsynced user work.
// ---------------------------------------------------------------------------

/** A hand-rolled IDBDatabase fake: records which stores were opened and
 *  cleared, and settles each transaction in a microtask like a real one. */
function fakeDb(settle: 'complete' | 'error') {
  const cleared: string[] = []
  const opened: string[] = []
  const db = {
    transaction(name: string, _mode: IDBTransactionMode) {
      opened.push(name)
      const tx = {
        objectStore(storeName: string) {
          return { clear: () => cleared.push(storeName) }
        },
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
      }
      queueMicrotask(() => (settle === 'complete' ? tx.oncomplete?.() : tx.onerror?.()))
      return tx
    },
  } as unknown as IDBDatabase
  return { db, cleared, opened }
}

describe('clearAllSnapshots (#575 Face C)', () => {
  it('clears the snapshot store and never opens the write queue', async () => {
    const f = fakeDb('complete')
    expect(await clearAllSnapshots(Promise.resolve(f.db))).toBe(true)
    expect(f.cleared).toEqual(['snapshots'])
    expect(f.opened).toEqual(['snapshots'])
  })

  it('resolves false when there is no database — a best-effort clear', async () => {
    expect(await clearAllSnapshots(Promise.resolve(null))).toBe(false)
  })

  it('resolves false when the transaction fails', async () => {
    const f = fakeDb('error')
    expect(await clearAllSnapshots(Promise.resolve(f.db))).toBe(false)
  })
})
