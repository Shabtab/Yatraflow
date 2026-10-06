// ============ Offline snapshot cache (PWA phase 2) ============
// The last CLEANLY-hydrated account, kept in IndexedDB so a cold start with no
// network shows the plan instead of an empty app. Three rules make this safe
// rather than clever:
//
//   1. Keyed by user id and CLEARED on sign-out — the next person on the device
//      must never inherit the last one's trips (issue #45's lesson, one layer
//      down: the in-memory version of that bug was the cache surviving a
//      sign-out and re-patching the previous user's rows).
//   2. Only a clean hydrate is persisted. A partial read (the store's
//      partial-failure model) is deliberately NOT written: an offline boot must
//      never present half an account as if it were the truth.
//   3. Every function resolves. No IndexedDB (private mode, an old WebView), a
//      blocked upgrade or a quota failure all degrade to "no cache", exactly
//      like uiPrefs/timefmt degrade to "no preference".
//
// A boot from a snapshot is READ-ONLY in spirit: every write path still needs
// the network, and cached trips can never trigger the demo seed — the failed
// reads that made the cache necessary keep `tripCountUnknown` true.

export const SNAPSHOT_VERSION = 1

const DB_NAME = 'yatraflow-offline'
// v2 adds the pending-write queue (lib/writeQueue.ts). An upgrade is exactly
// how an existing install gets the new store: onupgradeneeded creates whichever
// store this version names and leaves the other's data alone.
const DB_VERSION = 2
/** The account's last clean hydrate. */
export const SNAPSHOT_STORE = 'snapshots'
/** Trip edits that have not reached the server yet (PWA phase 3). */
export const WRITE_STORE = 'writes'

let dbPromise: Promise<IDBDatabase | null> | null = null

/** Open (once) the offline database, creating any missing store. Resolves null
 *  when IndexedDB is unavailable or blocked — every caller degrades to "no
 *  cache" rather than failing. */
export function openOfflineDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase | null>(resolve => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null)
        return
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        for (const store of [SNAPSHOT_STORE, WRITE_STORE]) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

/** The slices worth keeping: the plans themselves plus what renders around
 *  them. Notifications are perishable and the admin audit log is not this
 *  device's business, so neither is stored. */
export const SLICE_KEYS = [
  'trips',
  'trashedTrips',
  'users',
  'published',
  'suggestions',
  'decisions',
  'activity',
] as const

export type SnapshotSlices = Record<(typeof SLICE_KEYS)[number], unknown[]>

export interface Snapshot extends SnapshotSlices {
  version: number
  savedAt: number
}

/** Minimal key-value surface, injectable so tests never need a real IndexedDB. */
export interface SnapshotStore {
  read(key: string): Promise<unknown>
  write(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

/** IndexedDB-backed store. Every path resolves — "no cache" is a valid answer. */
function idbStore(): SnapshotStore {
  const run = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest, fallback: T): Promise<T> => {
    const db = await openOfflineDb()
    if (!db) return fallback
    return new Promise<T>(resolve => {
      try {
        const transaction = db.transaction(SNAPSHOT_STORE, mode)
        const request = fn(transaction.objectStore(SNAPSHOT_STORE))
        request.onsuccess = () => resolve((request.result as T) ?? fallback)
        request.onerror = () => resolve(fallback)
      } catch {
        resolve(fallback)
      }
    })
  }

  return {
    read: key => run('readonly', store => store.get(key), undefined as unknown),
    write: async (key, value) => {
      await run('readwrite', store => store.put(value, key), undefined as unknown)
    },
    remove: async key => {
      await run('readwrite', store => store.delete(key), undefined as unknown)
    },
  }
}

/** Persist the account's snapshot. Returns false when it could not be stored. */
export async function saveSnapshot(
  userId: string,
  slices: SnapshotSlices,
  store: SnapshotStore = idbStore(),
): Promise<boolean> {
  try {
    const snapshot: Snapshot = { version: SNAPSHOT_VERSION, savedAt: Date.now(), ...slices }
    await store.write(userId, snapshot)
    return true
  } catch {
    return false
  }
}

/** The stored snapshot for this account, or null when absent/unreadable/from an
 *  older shape. Validation is strict: a half-written or version-skewed record
 *  must read as "no cache", never as a partial account. */
export async function loadSnapshot(userId: string, store: SnapshotStore = idbStore()): Promise<Snapshot | null> {
  try {
    const raw = await store.read(userId)
    if (raw === null || typeof raw !== 'object') return null
    const candidate = raw as Partial<Snapshot>
    if (candidate.version !== SNAPSHOT_VERSION) return null
    if (typeof candidate.savedAt !== 'number' || !Number.isFinite(candidate.savedAt)) return null
    for (const key of SLICE_KEYS) {
      if (!Array.isArray(candidate[key])) return null
    }
    return candidate as Snapshot
  } catch {
    return null
  }
}

/** Forget an account's snapshot (sign-out). Never throws. */
export async function clearSnapshot(userId: string, store: SnapshotStore = idbStore()): Promise<void> {
  try {
    await store.remove(userId)
  } catch {
    /* nothing to undo */
  }
}

/** Wipe every account's snapshot rows — the recovery screen's clear owns
 *  derived data, and the offline copy is derived. The pending-write queue in
 *  WRITE_STORE is the user's own unsynced work and must survive. Resolves
 *  false when IndexedDB is unavailable or the clear failed, so the caller can
 *  still say what happened. The db is injectable like SnapshotStore, so tests
 *  never need a real IndexedDB. */
export async function clearAllSnapshots(
  dbPromise: Promise<IDBDatabase | null> = openOfflineDb(),
): Promise<boolean> {
  const db = await dbPromise
  if (!db) return false
  return new Promise(resolve => {
    try {
      const transaction = db.transaction(SNAPSHOT_STORE, 'readwrite')
      transaction.objectStore(SNAPSHOT_STORE).clear()
      transaction.oncomplete = () => resolve(true)
      transaction.onerror = () => resolve(false)
      transaction.onabort = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}
