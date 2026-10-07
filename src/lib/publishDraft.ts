// ============ One-shot publish-draft stash ============
// An imported file can carry a publish block. Applying it is the creator's
// decision, made in the publish form — so the import stashes the block here
// and the form picks it up once, on mount. The stash is an offer, never a
// publish: the form's own rules still decide what may go live.
//
// Storage design: sessionStorage when the platform has one, an in-memory Map
// when it does not (node tests, native edge cases). Both paths run through
// the same guarded helpers, so the node test exercises the real consume-once
// logic on the memory path. A draft never survives a restart.
import type { PublicationDraft } from './itinerarySpec'

const memory = new Map<string, string>()

/** sessionStorage can throw at ACCESS time (some privacy modes), so the
 *  lookup itself is guarded. null means "no session storage here". */
function defaultStore(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null
  } catch {
    return null
  }
}

function keyFor(tripId: string): string {
  return `yatraflow_publish_draft:${tripId}`
}

function readRaw(k: string): string | null {
  const store = defaultStore()
  if (store) {
    try {
      const v = store.getItem(k)
      if (v !== null) return v
    } catch { /* denied — the memory map may still hold it */ }
  }
  return memory.get(k) ?? null
}

function removeRaw(k: string): void {
  const store = defaultStore()
  if (store) {
    try { store.removeItem(k) } catch { /* already gone is fine */ }
  }
  memory.delete(k)
}

/** Hold a draft for the trip's publish form to pick up. A second stash for
 *  the same trip replaces the first. */
export function stashPublishDraft(tripId: string, draft: PublicationDraft): void {
  const k = keyFor(tripId)
  const json = JSON.stringify(draft)
  const store = defaultStore()
  if (store) {
    try {
      store.setItem(k, json)
      return
    } catch { /* full or denied — the memory map still holds the draft */ }
  }
  memory.set(k, json)
}

/** Take the draft stashed for this trip. The FIRST read consumes it: a
 *  second read answers null, and so does a trip with nothing stashed. */
export function takePublishDraft(tripId: string): PublicationDraft | null {
  const k = keyFor(tripId)
  const raw = readRaw(k)
  removeRaw(k)
  if (!raw) return null
  try {
    const draft = JSON.parse(raw) as PublicationDraft
    return draft && typeof draft === 'object' ? draft : null
  } catch {
    return null
  }
}
