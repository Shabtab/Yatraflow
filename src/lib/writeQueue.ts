// Pending trip edits use one key per editor and trip.
// Unique revisions protect newer edits during delayed cleanup.
// Failed storage keeps the latest payload in memory for recovery.
import { WRITE_STORE, openOfflineDb, writeQueueKey } from './offlineCache'
export { writeQueueKey } from './offlineCache'

/** Automatic sends stop at this cap. Recovery keeps the pending payload. */
export const MAX_WRITE_ATTEMPTS = 3

export interface QueuedWrite {
  /** The trip and editor together identify one queue slot. */
  tripId: string
  ownerId: string
  /** Capture time orders the pending edits. */
  capturedAt: number
  /** How many replay attempts have already failed. */
  attempts: number
  revision?: string
  /** The authoritative server revision used by the conditional write. */
  baseVersion?: number
  state?: 'conflict' | 'failed'
  storageFailed?: boolean
  /** The whole-trip snapshot that will be written (structured-cloneable). */
  trip: unknown
}

export interface WriteQueueStore {
  list(): Promise<unknown[]>
  put(entry: QueuedWrite): Promise<void>
  remove(tripId: string): Promise<void>
  /** Delete the matching revision atomically. Legacy entries use their capture time. */
  removeIf(key: string, capturedAt: number, revision?: string, ownerId?: string): Promise<boolean>
  /** Replace the matching revision atomically. Another editor uses another key. */
  putIf(entry: QueuedWrite, expectedCapturedAt: number, expectedRevision?: string): Promise<boolean>
}

/** The public wrappers handle errors. Writes resolve only after commit. */
function idbWriteStore(): WriteQueueStore {
  const run = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> => {
    const db = await openOfflineDb()
    if (!db) throw new Error('Offline storage is unavailable')
    return new Promise<T>((resolve, reject) => {
      try {
        const transaction = db.transaction(WRITE_STORE, mode)
        let result: T
        transaction.oncomplete = () => resolve(result)
        transaction.onerror = () => reject(transaction.error ?? new Error('Offline storage transaction failed'))
        transaction.onabort = () => reject(transaction.error ?? new Error('Offline storage transaction aborted'))
        const request = fn(transaction.objectStore(WRITE_STORE))
        request.onsuccess = () => { result = request.result as T }
        request.onerror = () => reject(request.error ?? new Error('Offline storage request failed'))
      } catch (error) {
        reject(error)
      }
    })
  }

  // The read and mutation share one transaction.
  // Storage failures remain distinct from a revision mismatch.
  const inTransaction = async (op: (store: IDBObjectStore, current: unknown) => IDBRequest | null, tripId: string): Promise<boolean> => {
    const db = await openOfflineDb()
    if (!db) throw new Error('Offline storage is unavailable')
    return new Promise<boolean>((resolve, reject) => {
      try {
        const tx = db.transaction(WRITE_STORE, 'readwrite')
        let changed = false
        tx.oncomplete = () => resolve(changed)
        tx.onerror = () => reject(tx.error ?? new Error('Offline storage transaction failed'))
        tx.onabort = () => reject(tx.error ?? new Error('Offline storage transaction aborted'))
        const store = tx.objectStore(WRITE_STORE)
        const get = store.get(tripId)
        get.onsuccess = () => {
          try {
            const request = op(store, get.result)
            changed = !!request
            if (request) request.onerror = () => reject(request.error ?? new Error('Offline storage request failed'))
          } catch {
            tx.abort()
            reject(new Error('Offline storage mutation failed'))
          }
        }
        get.onerror = () => reject(get.error ?? new Error('Offline storage request failed'))
      } catch (error) {
        reject(error)
      }
    })
  }

  return {
    list: () => run<unknown[]>('readonly', store => store.getAll()),
    put: async entry => {
      await run('readwrite', store => store.put(entry, writeQueueKey(entry.ownerId, entry.tripId)))
    },
    remove: async tripId => {
      await run('readwrite', store => store.delete(tripId))
    },
    removeIf: (key, capturedAt, revision, ownerId) => inTransaction((store, current) => {
      const saved = current as QueuedWrite | undefined
      if (!saved || (ownerId !== undefined && saved.ownerId !== ownerId)) return null
      if (!sameGeneration(saved, { capturedAt, revision })) return null
      return store.delete(key)
    }, key),
    putIf: (entry, expectedCapturedAt, expectedRevision) => inTransaction((store, current) => {
      const saved = current as QueuedWrite | undefined
      if (!saved || saved.ownerId !== entry.ownerId || !sameGeneration(saved, { capturedAt: expectedCapturedAt, revision: expectedRevision })) return null
      return store.put(entry, writeQueueKey(entry.ownerId, entry.tripId))
    }, writeQueueKey(entry.ownerId, entry.tripId)),
  }
}

function isValidEntry(raw: unknown): raw is QueuedWrite {
  if (raw === null || typeof raw !== 'object') return false
  const entry = raw as Partial<QueuedWrite>
  if (typeof entry.tripId !== 'string' || !entry.tripId) return false
  if (typeof entry.ownerId !== 'string' || !entry.ownerId) return false
  if (typeof entry.capturedAt !== 'number' || !Number.isFinite(entry.capturedAt)) return false
  if (typeof entry.attempts !== 'number' || !Number.isSafeInteger(entry.attempts) || entry.attempts < 0) return false
  if (entry.revision !== undefined && (typeof entry.revision !== 'string' || !entry.revision || entry.revision.length > 128)) return false
  if (entry.baseVersion !== undefined && (!Number.isSafeInteger(entry.baseVersion) || entry.baseVersion < 0)) return false
  if (entry.state !== undefined && entry.state !== 'conflict' && entry.state !== 'failed') return false
  if (entry.storageFailed !== undefined && typeof entry.storageFailed !== 'boolean') return false
  if (entry.trip === null || entry.trip === undefined) return false
  // The snapshot must survive a structured clone — a non-cloneable payload
  // would fail INSIDE the store's put, i.e. silently drop the edit.
  try {
    structuredClone(entry)
  } catch {
    return false
  }
  return true
}

const defaultStore = idbWriteStore()
const listeners = new Set<() => void>()
const memories = new WeakMap<WriteQueueStore, Map<string, QueuedWrite>>()
const latestWrites = new WeakMap<WriteQueueStore, Map<string, QueuedWrite | null>>()
const changeVersions = new WeakMap<WriteQueueStore, Map<string, number>>()
const storeVersions = new WeakMap<WriteQueueStore, number>()
const uncertainDrops = new WeakMap<WriteQueueStore, Set<string>>()
const tails = new WeakMap<WriteQueueStore, Map<string, Promise<void>>>()

export function subscribePendingWrites(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function notifyPendingWrites(): void {
  for (const listener of listeners) { try { listener() } catch { /* A subscriber must not stop a save. */ } }
}

function memoryFor(store: WriteQueueStore): Map<string, QueuedWrite> {
  let memory = memories.get(store)
  if (!memory) { memory = new Map(); memories.set(store, memory) }
  return memory
}

function latestFor(store: WriteQueueStore): Map<string, QueuedWrite | null> {
  let latest = latestWrites.get(store)
  if (!latest) { latest = new Map(); latestWrites.set(store, latest) }
  return latest
}

function uncertainFor(store: WriteQueueStore): Set<string> {
  let keys = uncertainDrops.get(store)
  if (!keys) { keys = new Set(); uncertainDrops.set(store, keys) }
  return keys
}

function changed(store: WriteQueueStore, key: string, entry: QueuedWrite | null): void {
  latestFor(store).set(key, entry)
  let versions = changeVersions.get(store)
  if (!versions) { versions = new Map(); changeVersions.set(store, versions) }
  const version = (storeVersions.get(store) ?? 0) + 1
  storeVersions.set(store, version)
  versions.set(key, version)
}

function sameGeneration(left: Pick<QueuedWrite, 'capturedAt' | 'revision'>, right: Pick<QueuedWrite, 'capturedAt' | 'revision'>): boolean {
  return left.revision !== undefined || right.revision !== undefined
    ? left.revision === right.revision
    : left.capturedAt === right.capturedAt
}

function serialize<T>(store: WriteQueueStore, key: string, run: () => Promise<T>): Promise<T> {
  let map = tails.get(store)
  if (!map) { map = new Map(); tails.set(store, map) }
  const next = (map.get(key) ?? Promise.resolve()).then(run, run)
  const tail = next.then(() => undefined, () => undefined)
  map.set(key, tail)
  void tail.then(() => { if (map.get(key) === tail) map.delete(key) })
  return next
}

/** Keep the latest local edit when durable storage fails. */
export async function queueWrite(entry: QueuedWrite, store: WriteQueueStore = defaultStore): Promise<boolean> {
  if (!isValidEntry(entry)) return false
  const copy = structuredClone(entry)
  const key = writeQueueKey(copy.ownerId, copy.tripId)
  const memory = memoryFor(store)
  uncertainFor(store).delete(key)
  memory.set(key, copy)
  changed(store, key, copy)
  notifyPendingWrites()
  return serialize(store, key, async () => {
    try {
      const durable = { ...copy }
      delete durable.storageFailed
      await store.put(durable)
      if (memory.get(key) === copy) memory.delete(key)
      const latest = latestFor(store)
      if (latest.get(key) === copy) changed(store, key, durable)
      notifyPendingWrites()
      return true
    } catch {
      if (memory.get(key) === copy) memory.set(key, { ...copy, state: copy.state ?? 'failed', storageFailed: true })
      notifyPendingWrites()
      return false
    }
  })
}

/** Ignore malformed records. A late read must never delete a newer replacement. */
export async function pendingWrites(store: WriteQueueStore = defaultStore): Promise<QueuedWrite[]> {
  const readVersion = storeVersions.get(store) ?? 0
  let raw: unknown[] = []
  let readFailed = false
  try {
    raw = await store.list()
  } catch { readFailed = true }
  const valid = new Map<string, QueuedWrite>()
  for (const candidate of Array.isArray(raw) ? raw : []) {
    if (isValidEntry(candidate)) {
      const key = writeQueueKey(candidate.ownerId, candidate.tripId)
      valid.set(key, uncertainFor(store).has(key) ? { ...candidate, state: 'failed', storageFailed: true } : candidate)
    }
  }
  for (const [key, entry] of memoryFor(store)) valid.set(key, entry)
  for (const [key, entry] of latestFor(store)) {
    if (!readFailed && (changeVersions.get(store)?.get(key) ?? 0) <= readVersion) continue
    if (entry === null) valid.delete(key)
    else if (!memoryFor(store).has(key)) valid.set(key, entry)
  }
  return [...valid.values()].sort((a, b) => a.capturedAt - b.capturedAt)
}

/** Forget one trip's pending write — it reached the server. */
export async function dropWrite(tripId: string, store: WriteQueueStore = defaultStore): Promise<void> {
  const matches = (await pendingWrites(store)).filter(entry => entry.tripId === tripId)
  if (matches.length === 1) await dropQueuedWrite(matches[0], store)
}

/** Forget one trip's pending write ONLY if the key still holds the entry that
 *  was sent — #549: the success of an in-flight write must not delete the
 *  newer snapshot a later edit queued behind it. Returns whether the entry
 *  was dropped (false also covers "nothing was queued"). */
export async function dropWriteIfCurrent(tripId: string, capturedAt: number, store: WriteQueueStore = defaultStore): Promise<boolean> {
  const matches = (await pendingWrites(store)).filter(entry => entry.tripId === tripId && entry.capturedAt === capturedAt && entry.revision === undefined)
  return matches.length === 1 ? dropQueuedWrite(matches[0], store) : false
}

/** Delete only the observed edit. True confirms durable removal or absence.
 * False can still clear matching volatile data. Newer memory remains intact. */
export async function dropQueuedWrite(entry: QueuedWrite, store: WriteQueueStore = defaultStore): Promise<boolean> {
  const key = writeQueueKey(entry.ownerId, entry.tripId)
  return serialize(store, key, async () => {
    const memory = memoryFor(store)
    const current = memory.get(key)
    if (current && !sameGeneration(current, entry)) return false
    if (current) memory.delete(key)
    const latest = latestFor(store).get(key)
    if (!latest || sameGeneration(latest, entry)) changed(store, key, null)
    const canQuarantine = () => {
      const newest = latestFor(store).get(key)
      return !newest || sameGeneration(newest, entry)
    }
    if (current) notifyPendingWrites()
    try {
      const removed = await store.removeIf(key, entry.capturedAt, entry.revision, entry.ownerId)
      const absent = !removed && current && !(await store.list()).some(raw => isValidEntry(raw) && writeQueueKey(raw.ownerId, raw.tripId) === key)
      if (removed || absent) {
        uncertainFor(store).delete(key)
        const newestMemory = memory.get(key)
        if (newestMemory && sameGeneration(newestMemory, entry)) memory.delete(key)
        const latest = latestFor(store)
        if (sameGeneration(latest.get(key) ?? entry, entry)) changed(store, key, null)
        notifyPendingWrites()
      } else if (current && canQuarantine()) {
        // An obsolete disk copy must stay paused after a failed volatile cleanup.
        uncertainFor(store).add(key)
        notifyPendingWrites()
      }
      return !!(removed || absent)
    } catch {
      if (current && canQuarantine()) uncertainFor(store).add(key)
      notifyPendingWrites()
      return false
    }
  })
}

/** Re-queue a retry ONLY if the key still holds the entry that was read —
 *  #549: the bumped-attempts older snapshot must not clobber a newer edit
 *  queued while the failed write was in flight. Returns whether it re-queued. */
export async function requeueIfCurrent(entry: QueuedWrite, store: WriteQueueStore = defaultStore): Promise<boolean> {
  if (!isValidEntry(entry)) return false
  const key = writeQueueKey(entry.ownerId, entry.tripId)
  return serialize(store, key, async () => {
    const memory = memoryFor(store)
    const current = memory.get(key)
    if (current && !sameGeneration(current, entry)) return false
    try {
      const persisted = await store.putIf(entry, entry.capturedAt, entry.revision)
      if (persisted) {
        uncertainFor(store).delete(key)
        if (sameGeneration(memory.get(key) ?? entry, entry)) memory.delete(key)
        const latest = latestFor(store)
        if (sameGeneration(latest.get(key) ?? entry, entry)) changed(store, key, structuredClone(entry))
        notifyPendingWrites()
        return true
      }
      if (!current) return false
    } catch {
      const latest = latestFor(store).get(key)
      if (latest === null || (latest && !sameGeneration(latest, entry))) return false
      memory.set(key, { ...structuredClone(entry), storageFailed: true })
      notifyPendingWrites()
      return false
    }
    memory.set(key, { ...structuredClone(entry), storageFailed: true })
    notifyPendingWrites()
    return false
  })
}

/** How many edits this device is holding — the offline banner's count. */
export async function pendingWriteCount(ownerId?: string, store: WriteQueueStore = defaultStore): Promise<number> {
  const writes = await pendingWrites(store)
  return ownerId ? writes.filter(write => write.ownerId === ownerId).length : writes.length
}

/** Whether an edit has automatic retries left. */
export function shouldRetry(entry: Pick<QueuedWrite, 'attempts'>): boolean {
  return entry.attempts < MAX_WRITE_ATTEMPTS
}

/** Forget every queued write belonging to one account (sign-out). Their
 *  unsynced edits are theirs alone: the next person on this device must never
 *  be the one whose session "syncs" them. */
export async function clearWritesFor(ownerId: string, store: WriteQueueStore = defaultStore): Promise<void> {
  const memory = memoryFor(store)
  const initial = new Map(latestFor(store))
  const captured = [...memory.values()].filter(write => write.ownerId === ownerId)
  for (const write of captured) memory.delete(writeQueueKey(write.ownerId, write.tripId))
  for (const [key, write] of initial) if (write?.ownerId === ownerId) changed(store, key, null)
  if (captured.length) notifyPendingWrites()
  try {
    const disk = await store.list()
    const candidates = [...captured, ...(Array.isArray(disk) ? disk.filter(isValidEntry) : [])]
    for (const write of candidates) {
      if (write.ownerId !== ownerId) continue
      const key = writeQueueKey(write.ownerId, write.tripId)
      const latest = latestFor(store).get(key)
      const observed = initial.get(key)
      if (latest && (!observed || !sameGeneration(latest, observed))) continue
      await dropQueuedWrite(write, store)
    }
  } catch {
    /* nothing to undo */
  }
}
