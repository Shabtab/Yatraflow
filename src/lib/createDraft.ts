// ============ Create-trip drafts - the Zeigarnik catch ============
// A half-built trip is a made thing; discarding it silently is the reason most
// create forms lose people. This keeps the unfinished form on the device and
// hands it back on return ("Picking up where you left off - 80% ready").
//
// CONTRACT:
//  - Never throws. Private mode, a full quota, corrupt JSON, a future version -
//    every one of those degrades to "no draft", and the form behaves as if this
//    module did not exist.
//  - The store is injectable so the logic is node-testable without a DOM.
//  - Only explicit user actions clear a draft. Unmounting never does.

import { CREATE_STEPS, type CreateStep } from './createSteps'

export const DRAFT_KEY = 'yf.createDraft.v1'
export const DRAFT_VERSION = 1
/** Below this, a draft is just the untouched default form - not worth a prompt. */
export const DRAFT_WORTH_KEEPING = 1

export interface DraftDest {
  name: string
  lat?: number
  lng?: number
}

export interface DraftPayload {
  /** The page's `f` state, verbatim. Treated as opaque passthrough. */
  form: Record<string, unknown>
  dests: DraftDest[]
  returnCount: number
  /** P5: crew collected for the invite, so a resumed draft does not lose the
   *  people the planner already typed. Optional - older drafts simply have none. */
  crew?: { name: string; phone: string | null }[]
  /**
   * The guided flow's step, so a resumed draft reopens where it was left.
   * Optional on purpose: drafts written before the guided flow have no step, and
   * the version gate below rejects anything whose `v` differs. A new mandatory
   * field would have forced a version bump and thrown every existing draft away.
   */
  step?: string
}

export interface StoredDraft extends DraftPayload {
  v: number
  savedAt: string
}

/** The slice of Storage this module needs - a fake with the same shape works. */
export type DraftStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStore(): DraftStore | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

interface Opts {
  store?: DraftStore | null
  now?: Date
}

/** Write the draft. Returns false when it could not be stored (never throws). */
export function saveDraft(payload: DraftPayload, opts: Opts = {}): boolean {
  const store = opts.store === undefined ? defaultStore() : opts.store
  if (!store) return false
  try {
    const envelope: StoredDraft = {
      v: DRAFT_VERSION,
      savedAt: (opts.now ?? new Date()).toISOString(),
      form: payload.form,
      dests: payload.dests,
      returnCount: payload.returnCount,
      // A draft is a copy on the device, and it outlives the tab that wrote it.
      // A full number sitting in localStorage is a copy of someone else's phone
      // number that they never agreed to keep, so only the last three digits are
      // written. So a resumed draft cannot re-invite by number. The planner
      // retypes it, which is the honest cost of not storing it.
      crew: payload.crew?.map(c => ({ name: c.name, phone: c.phone ? maskPhone(c.phone) : null })),
      step: payload.step,
    }
    store.setItem(DRAFT_KEY, JSON.stringify(envelope))
    return true
  } catch {
    // quota exceeded, private mode, storage disabled - all the same to us
    return false
  }
}

/**
 * Keep the last three digits and nothing else: "9845021234" → "••• 234".
 *
 * Three digits identify a person to the planner who already knows them, and do
 * not identify them to anyone else who reads the device. The bullet is the same
 * one the approved mockup uses for the crew chip.
 */
export function maskPhone(phone: string): string {
  const digits = (phone ?? '').replace(/\D+/g, '')
  if (!digits) return ''
  return `••• ${digits.slice(-3)}`
}

/**
 * The stored step, or undefined when it is absent or unrecognised.
 *
 * A draft written by an older build has no step, and a draft written by a future
 * build could name one this build does not have. Both resume at the start of the
 * flow rather than opening a screen that does not exist.
 */
function readStep(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  return CREATE_STEPS.includes(raw as CreateStep) ? raw : undefined
}

/** Read the draft, or null when there is nothing usable (never throws). */
export function loadDraft(opts: Opts = {}): StoredDraft | null {
  const store = opts.store === undefined ? defaultStore() : opts.store
  if (!store) return null
  try {
    const raw = store.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredDraft>
    // a different writer's shape, or a future version we cannot honour
    if (!parsed || parsed.v !== DRAFT_VERSION) return null
    if (typeof parsed.savedAt !== 'string') return null
    if (!parsed.form || typeof parsed.form !== 'object') return null
    const dests = Array.isArray(parsed.dests) ? parsed.dests.filter(d => d && typeof d.name === 'string') : []
    const returnCount = typeof parsed.returnCount === 'number' && Number.isFinite(parsed.returnCount) ? Math.max(0, Math.round(parsed.returnCount)) : 0
    const crew = Array.isArray(parsed.crew)
      ? parsed.crew.filter((c: unknown) => !!c && typeof c === 'object' && (typeof (c as { name?: unknown }).name === 'string' || typeof (c as { phone?: unknown }).phone === 'string'))
          .map((c: { name?: unknown; phone?: unknown }) => ({
            name: typeof c.name === 'string' ? c.name : '',
            // Mask on the way in as well as on the way out. A draft written
            // before D7 still holds full numbers on the device, and this build
            // must not hand them back just because they were already there.
            phone: typeof c.phone === 'string' ? maskPhone(c.phone) : null,
          }))
      : []
    return { v: DRAFT_VERSION, savedAt: parsed.savedAt, form: parsed.form as Record<string, unknown>, dests, returnCount, crew, step: readStep(parsed.step) }
  } catch {
    return null
  }
}

/** Remove the draft. Explicit user actions only. */
export function clearDraft(opts: { store?: DraftStore | null } = {}): boolean {
  const store = opts.store === undefined ? defaultStore() : opts.store
  if (!store) return false
  try {
    store.removeItem(DRAFT_KEY)
    return true
  } catch {
    return false
  }
}

/** Is there anything here the user actually built? A untouched form is not a
 *  draft worth interrupting someone about. */
export function draftIsWorthKeeping(d: StoredDraft | null): boolean {
  if (!d) return false
  const f = d.form as Record<string, unknown>
  const name = typeof f.name === 'string' ? f.name.trim() : ''
  const start = typeof f.startLocation === 'string' ? f.startLocation.trim() : ''
  const startDate = typeof f.startDate === 'string' ? f.startDate : ''
  const endDate = typeof f.endDate === 'string' ? f.endDate : ''
  const touched = [name, start, startDate, endDate].filter(Boolean).length
  // crew the planner typed is real progress too - a draft holding only
  // names/numbers is worth resuming, not worth discarding silently
  return touched >= DRAFT_WORTH_KEEPING || d.dests.length > 0 || (d.crew?.length ?? 0) > 0
}

/** "just now" / "12 min ago" / "3 h ago" / "2 days ago" - honest, coarse, no clock. */
export function draftAgeLabel(savedAt: string, now: Date = new Date()): string {
  const then = new Date(savedAt).getTime()
  if (!Number.isFinite(then)) return 'earlier'
  const mins = Math.floor((now.getTime() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}
