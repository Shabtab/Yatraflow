// ============ Pending trip writes — the offline write queue (PWA phase 3) ====
// An edit made without a connection waits here until it reaches the server. It
// plugs into the ONE place a trip write is sent (`store.ts`
// persistTripFieldNow), which is what makes this tractable: the app's write
// model is already a whole-trip snapshot UPDATE per burst (the debounced
// coalescer), so an "unsynced edit" is one well-defined payload rather than a
// replayable operation log to invent.
//
// Three rules, each a silent failure if broken:
//   1. ONE entry per trip — a newer snapshot REPLACES the older one, exactly
//      like the in-memory coalescer it mirrors. Replaying an older snapshot
//      after a newer one would resurrect stops the user deleted. The same
//      keying cuts the other way (#549): a cleanup must remove only the
//      entry its writer SENT, or a success deletes the newer edit queued
//      behind it — hence the conditional removeIf/putIf and the
//      dropWriteIfCurrent/requeueIfCurrent wrappers.
//   2. Bounded retries. An entry carries an attempt count; a write that keeps
//      failing (RLS, a validation rejection — not just the network) is dropped
//      LOUDLY rather than retried forever behind the user's back.
//   3. Cleared with its account. An entry names its owner, sign-out drops that
//      account's entries, and replay only ever sends entries whose owner is
//      still the signed-in user — the snapshot cache's rule, for its reason.
import { WRITE_STORE, openOfflineDb } from './offlineCache'

/** Attempts before an entry is abandoned (with a toast, never silently). */
export const MAX_WRITE_ATTEMPTS = 3

export interface QueuedWrite {
  /** Also the store key: one pending snapshot per trip. */
  tripId: string
  ownerId: string
  /** When the edit was captured — the left side of the conflict comparison. */
  capturedAt: number
  /** How many replay attempts have already failed. */
  attempts: number
  /** The whole-trip snapshot that will be written (structured-cloneable). */
  trip: unknown
}

export interface WriteQueueStore {
  list(): Promise<unknown[]>
  put(entry: QueuedWrite): Promise<void>
  remove(tripId: string): Promise<void>
  /** Conditional delete in ONE transaction: the key is removed only when the
   *  stored entry's `capturedAt` matches. Returns whether it removed. (#549:
   *  the check and the delete must be atomic — a newer queueWrite landing
   *  between a read and a plain remove is exactly the race being closed.) */
  removeIf(tripId: string, capturedAt: number): Promise<boolean>
  /** Conditional put in ONE transaction: the key is overwritten only when the
   *  stored entry's `capturedAt` still matches `expectedCapturedAt`. Returns
   *  whether it wrote. (#549: a retry re-queue must not clobber a newer
   *  snapshot with the older one it read.) */
  putIf(entry: QueuedWrite, expectedCapturedAt: number): Promise<boolean>
}

/** IndexedDB-backed queue. Every path resolves; "no queue" is a valid answer. */
function idbWriteStore(): WriteQueueStore {
  const run = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest, fallback: T): Promise<T> => {
    const db = await openOfflineDb()
    if (!db) return fallback
    return new Promise<T>(resolve => {
      try {
        const transaction = db.transaction(WRITE_STORE, mode)
        const request = fn(transaction.objectStore(WRITE_STORE))
        request.onsuccess = () => resolve((request.result as T) ?? fallback)
        request.onerror = () => resolve(fallback)
      } catch {
        resolve(fallback)
      }
    })
  }

  // The conditional ops cannot ride the `run` helper: they need a get and a
  // write inside the SAME transaction, or the window between them reopens the
  // race they exist to close (#549). No db means nothing was stored, so the
  // conditional answer is honestly "did not match".
  const inTransaction = async (op: (store: IDBObjectStore, current: unknown) => IDBRequest | null, tripId: string): Promise<boolean> => {
    const db = await openOfflineDb()
    if (!db) return false
    return new Promise<boolean>(resolve => {
      try {
        const tx = db.transaction(WRITE_STORE, 'readwrite')
        const store = tx.objectStore(WRITE_STORE)
        const get = store.get(tripId)
        get.onsuccess = () => {
          const request = op(store, get.result)
          if (!request) { resolve(false); return }
          request.onsuccess = () => resolve(true)
          request.onerror = () => resolve(false)
        }
        get.onerror = () => resolve(false)
      } catch {
        resolve(false)
      }
    })
  }

  return {
    list: () => run<unknown[]>('readonly', store => store.getAll(), []),
    put: async entry => {
      // Keyed by tripId: a second edit to the same trip REPLACES the first.
      await run('readwrite', store => store.put(entry, entry.tripId), undefined as unknown)
    },
    remove: async tripId => {
      await run('readwrite', store => store.delete(tripId), undefined as unknown)
    },
    removeIf: (tripId, capturedAt) => inTransaction((store, current) => {
      if (!current || (current as QueuedWrite).capturedAt !== capturedAt) return null
      return store.delete(tripId)
    }, tripId),
    putIf: (entry, expectedCapturedAt) => inTransaction((store, current) => {
      if (!current || (current as QueuedWrite).capturedAt !== expectedCapturedAt) return null
      return store.put(entry, entry.tripId)
    }, entry.tripId),
  }
}

function isValidEntry(raw: unknown): raw is QueuedWrite {
  if (raw === null || typeof raw !== 'object') return false
  const entry = raw as Partial<QueuedWrite>
  if (typeof entry.tripId !== 'string' || !entry.tripId) return false
  if (typeof entry.ownerId !== 'string' || !entry.ownerId) return false
  if (typeof entry.capturedAt !== 'number' || !Number.isFinite(entry.capturedAt)) return false
  if (typeof entry.attempts !== 'number' || !Number.isFinite(entry.attempts) || entry.attempts < 0) return false
  if (entry.trip === null || entry.trip === undefined) return false
  // The snapshot must survive a structured clone — a non-cloneable payload
  // would fail INSIDE the store's put, i.e. silently drop the edit.
  try {
    structuredClone(entry.trip)
  } catch {
    return false
  }
  return true
}

/** Record (or replace) the pending snapshot for a trip. Returns whether the
 *  edit is now durable. */
export async function queueWrite(entry: QueuedWrite, store: WriteQueueStore = idbWriteStore()): Promise<boolean> {
  try {
    await store.put(entry)
    return true
  } catch {
    return false
  }
}

/** The pending writes, oldest first. Malformed entries are REMOVED rather than
 *  returned — an entry nothing can replay would otherwise sit there forever. */
export async function pendingWrites(store: WriteQueueStore = idbWriteStore()): Promise<QueuedWrite[]> {
  let raw: unknown[]
  try {
    raw = await store.list()
  } catch {
    return []
  }
  const valid: QueuedWrite[] = []
  for (const candidate of Array.isArray(raw) ? raw : []) {
    if (isValidEntry(candidate)) {
      valid.push(candidate)
    } else {
      const tripId = (candidate as { tripId?: unknown })?.tripId
      if (typeof tripId === 'string') void store.remove(tripId).catch(() => {})
    }
  }
  return valid.sort((a, b) => a.capturedAt - b.capturedAt)
}

/** Forget one trip's pending write — it reached the server. */
export async function dropWrite(tripId: string, store: WriteQueueStore = idbWriteStore()): Promise<void> {
  try {
    await store.remove(tripId)
  } catch {
    /* nothing to undo */
  }
}

/** Forget one trip's pending write ONLY if the key still holds the entry that
 *  was sent — #549: the success of an in-flight write must not delete the
 *  newer snapshot a later edit queued behind it. Returns whether the entry
 *  was dropped (false also covers "nothing was queued"). */
export async function dropWriteIfCurrent(tripId: string, capturedAt: number, store: WriteQueueStore = idbWriteStore()): Promise<boolean> {
  try {
    return await store.removeIf(tripId, capturedAt)
  } catch {
    return false
  }
}

/** Re-queue a retry ONLY if the key still holds the entry that was read —
 *  #549: the bumped-attempts older snapshot must not clobber a newer edit
 *  queued while the failed write was in flight. Returns whether it re-queued. */
export async function requeueIfCurrent(entry: QueuedWrite, store: WriteQueueStore = idbWriteStore()): Promise<boolean> {
  try {
    return await store.putIf(entry, entry.capturedAt)
  } catch {
    return false
  }
}

/** How many edits this device is holding — the offline banner's count. */
export async function pendingWriteCount(ownerId?: string, store: WriteQueueStore = idbWriteStore()): Promise<number> {
  const writes = await pendingWrites(store)
  return ownerId ? writes.filter(write => write.ownerId === ownerId).length : writes.length
}

/** Whether an entry has retries left. A hopeless entry is dropped loudly by
 *  the caller, never retried forever. */
export function shouldRetry(entry: Pick<QueuedWrite, 'attempts'>): boolean {
  return entry.attempts < MAX_WRITE_ATTEMPTS
}

/**
 * What a replay should do about the server's current row.
 *
 * `apply` is the normal case. `overwrite` means a collaborator's change landed
 * after this edit was captured — the replay still wins (the app's whole-trip
 * write model is last-writer-wins, and the peer is told by the realtime
 * remote-edit banner), but the local user is told too rather than left to
 * discover it. Unknown or missing timestamps apply, mirroring the stale-row
 * guard in realtimeCore: the comparison is never a blocker, only a notice.
 */
export function replayVerdict(serverUpdatedAt: unknown, capturedAt: number): 'apply' | 'overwrite' {
  const server = Number(serverUpdatedAt)
  if (!Number.isFinite(server) || !Number.isFinite(capturedAt)) return 'apply'
  return server > capturedAt ? 'overwrite' : 'apply'
}

/** Forget every queued write belonging to one account (sign-out). Their
 *  unsynced edits are theirs alone: the next person on this device must never
 *  be the one whose session "syncs" them. */
export async function clearWritesFor(ownerId: string, store: WriteQueueStore = idbWriteStore()): Promise<void> {
  try {
    for (const write of await pendingWrites(store)) {
      if (write.ownerId === ownerId) await store.remove(write.tripId)
    }
  } catch {
    /* nothing to undo */
  }
}
