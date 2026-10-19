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
// Version 3 scopes pending edits by account and trip.
const DB_VERSION = 3
/** The account's last clean hydrate. */
export const SNAPSHOT_STORE = 'snapshots'
/** Trip edits that have not reached the server yet (PWA phase 3). */
export const WRITE_STORE = 'writes'

/** One pending edit per editor and trip. JSON keeps both identifiers distinct. */
export function writeQueueKey(ownerId: string, tripId: string): string {
  return JSON.stringify([ownerId, tripId])
}

let dbPromise: Promise<IDBDatabase | null> | null = null

/** Open (once) the offline database, creating any missing store. Resolves null
 *  when IndexedDB is unavailable or blocked — every caller degrades to "no
 *  cache" rather than failing. */
export function openOfflineDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  const opening = new Promise<IDBDatabase | null>(resolve => {
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const finish = (db: IDBDatabase | null) => {
      if (settled) {
        db?.close()
        return
      }
      settled = true
      clearTimeout(timeout)
      resolve(db)
    }
    try {
      if (typeof indexedDB === 'undefined') {
        finish(null)
        return
      }
      timeout = setTimeout(() => finish(null), 5_000)
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = event => {
        if (settled) {
          request.transaction?.abort()
          return
        }
        const db = request.result
        for (const store of [SNAPSHOT_STORE, WRITE_STORE]) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
        }
        if (event.oldVersion < 3 && request.transaction) {
          const writes = request.transaction.objectStore(WRITE_STORE)
          const cursor = writes.openCursor()
          cursor.onsuccess = () => {
            const row = cursor.result
            if (!row) return
            const entry = row.value as { ownerId?: unknown; tripId?: unknown; capturedAt?: unknown }
            if (typeof entry?.ownerId !== 'string' || typeof entry.tripId !== 'string') { row.continue(); return }
            const key = writeQueueKey(entry.ownerId, entry.tripId)
            if (row.primaryKey === key) { row.continue(); return }
            const existing = writes.get(key)
            existing.onsuccess = () => {
              const saved = existing.result as { capturedAt?: unknown } | undefined
              const incomingTime = Number(entry.capturedAt)
              const savedTime = Number(saved?.capturedAt)
              if (!saved || (Number.isFinite(incomingTime) && (!Number.isFinite(savedTime) || savedTime < incomingTime))) writes.put(entry, key)
              row.delete()
              row.continue()
            }
          }
        }
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          db.close()
          if (dbPromise === opening) dbPromise = null
        }
        db.onclose = () => { if (dbPromise === opening) dbPromise = null }
        finish(db)
      }
      request.onblocked = () => finish(null)
      request.onerror = () => finish(null)
    } catch {
      finish(null)
    }
  })
  dbPromise = opening
  void opening.then(db => {
    if (!db && dbPromise === opening) dbPromise = null
  })
  return opening
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

/** Report write success only after the transaction commits. */
function idbStore(): SnapshotStore {
  const run = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> => {
    const db = await openOfflineDb()
    if (!db) throw new Error('Offline storage is unavailable')
    return new Promise<T>((resolve, reject) => {
      try {
        const transaction = db.transaction(SNAPSHOT_STORE, mode)
        let result: T
        transaction.oncomplete = () => resolve(result)
        transaction.onerror = () => reject(transaction.error ?? new Error('Offline storage transaction failed'))
        transaction.onabort = () => reject(transaction.error ?? new Error('Offline storage transaction aborted'))
        const request = fn(transaction.objectStore(SNAPSHOT_STORE))
        request.onsuccess = () => { result = request.result as T }
        request.onerror = () => reject(request.error ?? new Error('Offline storage request failed'))
      } catch (error) {
        reject(error)
      }
    })
  }

  return {
    read: key => run('readonly', store => store.get(key)),
    write: async (key, value) => {
      await run('readwrite', store => store.put(value, key))
    },
    remove: async key => {
      await run('readwrite', store => store.delete(key))
    },
  }
}

const defaultSnapshotStore = idbStore()
const snapshotWrites = new WeakMap<SnapshotStore, Map<string, { generation: number; tail: Promise<void> }>>()

function snapshotWriteState(userId: string, store: SnapshotStore) {
  let users = snapshotWrites.get(store)
  if (!users) { users = new Map(); snapshotWrites.set(store, users) }
  let state = users.get(userId)
  if (!state) { state = { generation: 0, tail: Promise.resolve() }; users.set(userId, state) }
  return state
}

/** Persist the account's snapshot. Returns false when it could not be stored. */
export async function saveSnapshot(
  userId: string,
  slices: SnapshotSlices,
  store: SnapshotStore = defaultSnapshotStore,
): Promise<boolean> {
  const state = snapshotWriteState(userId, store)
  const generation = state.generation
  let snapshot: Snapshot
  try { snapshot = { version: SNAPSHOT_VERSION, savedAt: Date.now(), ...structuredClone(slices) } } catch { return false }
  const result = state.tail.then(async () => {
    if (state.generation !== generation) return false
    try { await store.write(userId, snapshot); return true } catch { return false }
  })
  state.tail = result.then(() => undefined, () => undefined)
  return result
}

/** The stored snapshot for this account, or null when absent/unreadable/from an
 *  older shape. Validation is strict: a half-written or version-skewed record
 *  must read as "no cache", never as a partial account. */
export async function loadSnapshot(userId: string, store: SnapshotStore = defaultSnapshotStore): Promise<Snapshot | null> {
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
export async function clearSnapshot(userId: string, store: SnapshotStore = defaultSnapshotStore): Promise<void> {
  const state = snapshotWriteState(userId, store)
  state.generation += 1
  const result = state.tail.then(async () => {
    try { await store.remove(userId) } catch { /* A failed clear must settle. */ }
  })
  state.tail = result
  await result
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
