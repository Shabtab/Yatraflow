// ============ Trip DNA (Horizon 3.3) ============
// The engine remembers accepted/declined suggestions and builds a small
// preference vector per trip: category affinity, detour tolerance, accept
// volume. New candidates score a similarity boost and explain themselves
// ("you've picked 3 waterfall stops this trip"). Pure core first; the log at
// the bottom is the only impure part — a device copy in localStorage and,
// since I-16, an account copy in `user_dna` (both best-effort, capped, and
// never throwing).
import type { SupabaseClient } from '@supabase/supabase-js'
import { SLOT_KIND_CATEGORIES, SLOT_KIND_PURPOSES, type SlotKind } from './haltFit'
export interface DnaEvent {
  tripId: string
  /** 'seed' = an open crew idea: bends affinity but is NOT a crew acceptance */
  action: 'accept' | 'decline' | 'seed'
  category?: string
  /** The engine purpose this pick was offered for ('meal' | 'fuel' | 'rest' |
   *  'overnight' | 'stretch' | 'sight'), when the caller knew it. `category`
   *  alone cannot tell a town accepted as a night halt from one accepted as
   *  lunch — both log 'rest' — so the P7.2 hints read this first and fall back
   *  to the category only for events written before it existed. */
  haltKind?: string
  detourMin?: number
  /** predicted visit length for the stop (stop-length preference learning) */
  visitMin?: number
}

export interface DnaVector {
  accepts: number
  declines: number
  /** accepted count per category, minus declines (floored at 0) */
  categoryAffinity: Record<string, number>
  /** mean detour of accepted picks in minutes, null when none recorded */
  avgDetourMin: number | null
  /** mean visit length of accepted picks in minutes, null when none recorded */
  avgVisitMin: number | null
}

/** Affinity streak that earns a "you've picked N…" note on cards. */
const NOTE_THRESHOLD = 2
/** Boost points per affinity count, capped — same scale as purpose-fit. */
const BOOST_PER_PICK = 1
const MAX_BOOST = 3

function normCat(category: string | undefined): string | null {
  const c = (category ?? '').trim().toLowerCase()
  return c ? c : null
}

/** Fold events into a preference vector. Optionally scoped to one trip. */
export function buildDnaVector(events: DnaEvent[], tripId?: string): DnaVector {
  const v: DnaVector = { accepts: 0, declines: 0, categoryAffinity: {}, avgDetourMin: null, avgVisitMin: null }
  let detourSum = 0
  let detourN = 0
  let visitSum = 0
  let visitN = 0
  for (const e of events) {
    if (tripId != null && e.tripId !== tripId) continue
    const cat = normCat(e.category)
    if (e.action === 'accept') {
      v.accepts += 1
      if (cat) v.categoryAffinity[cat] = (v.categoryAffinity[cat] ?? 0) + 1
      if (Number.isFinite(e.detourMin) && (e.detourMin as number) >= 0) {
        detourSum += e.detourMin as number
        detourN += 1
      }
      if (Number.isFinite(e.visitMin) && (e.visitMin as number) >= 0) {
        visitSum += e.visitMin as number
        visitN += 1
      }
    } else if (e.action === 'seed') {
      // A proposed idea biases the corridor toward its kind but must not
      // inflate the acceptance record — proposing ≠ the crew having gone.
      if (cat) v.categoryAffinity[cat] = (v.categoryAffinity[cat] ?? 0) + 1
    } else {
      v.declines += 1
      if (cat) v.categoryAffinity[cat] = Math.max(0, (v.categoryAffinity[cat] ?? 0) - 1)
    }
  }
  if (detourN > 0) v.avgDetourMin = detourSum / detourN
  if (visitN > 0) v.avgVisitMin = visitSum / visitN
  return v
}

/**
 * Build the preference vector for EVERY trip on the device (no tripId scope).
 * This is the "across a user's trips" learning — a hire of a waterfall in one
 * trip gently biases corridor ties in later trips. Returns an empty vector's
 * twin when the log is empty.
 */
export function buildDnaVectorAcrossTrips(
  events: DnaEvent[],
  seedEvents: DnaEvent[] = [],
): DnaVector {
  return buildDnaVector([...events, ...seedEvents])
}

/** Similarity boost in score points (subtract from the segment score). */
export function dnaBoostForHit(
  hit: { category?: string },
  vector: DnaVector,
): number {
  const cat = normCat(hit.category)
  if (!cat) return 0
  const affinity = vector.categoryAffinity[cat] ?? 0
  return Math.min(MAX_BOOST, affinity * BOOST_PER_PICK)
}

/** Streak note for cards, or null when there is no story to tell. */
export function dnaNoteForHit(
  hit: { category?: string },
  vector: DnaVector,
): string | null {
  const cat = normCat(hit.category)
  if (!cat) return null
  const affinity = vector.categoryAffinity[cat] ?? 0
  if (affinity < NOTE_THRESHOLD) return null
  return `you've picked ${affinity} ${cat} stops this trip`
}

/** P7.2: what the log has learned about a KIND of part - how often the crew
 *  takes it and the detour they tolerate. Null until the evidence is real
 *  (3+ accepts for the kind), so a young log never pretends to a habit.
 *
 *  Membership is the event's OWN recorded purpose (`haltKind`) whenever it has
 *  one. Category alone is not enough to tell the kinds apart: a town accepted
 *  as a NIGHT HALT and a town accepted as LUNCH both log `category: 'rest'`,
 *  so the old category-only filter counted one accept toward every kind's hint.
 *  Events written before `haltKind` existed fall back to the engine's own
 *  category list (`SLOT_KIND_CATEGORIES`, derived from `PURPOSE_FIT`). */
export function slotPatternHint(log: DnaEvent[], kind: SlotKind): string | null {
  const purposes: readonly string[] = SLOT_KIND_PURPOSES[kind]
  const legacyCats = SLOT_KIND_CATEGORIES[kind]
  const relevant = log.filter(e => e.haltKind != null
    ? purposes.includes(e.haltKind)
    : e.category != null && legacyCats.includes(normCat(e.category) ?? ''))
  const accepts = relevant.filter(e => e.action === 'accept')
  if (accepts.length < 3) return null
  const detours = accepts
    .map(e => e.detourMin)
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  if (detours.length >= 3) {
    const avg = Math.round(detours.reduce((a, b) => a + b, 0) / detours.length)
    return avg <= 2
      ? 'you usually take these without a detour'
      : `you usually accept about +${avg} min for these`
  }
  return `you have accepted ${accepts.length} of these`
}
// ---- best-effort log (impure; UI layer only) ----
const DNA_KEY = 'yatraflow_dna_log'
const DNA_CAP = 500
/** One upsert per burst of accepts, rather than one per tap. */
const DNA_PUSH_DELAY_MS = 1200

/**
 * Keep only well-formed events. The same rule guards the device copy and the
 * `user_dna.log` row, because both are JSON this session did not author: a
 * malformed entry must degrade to "ignored", never to a broken suggestion list.
 */
export function normalizeDnaLog(parsed: unknown): DnaEvent[] {
  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    (e): e is DnaEvent =>
      !!e && typeof e === 'object' && typeof (e as DnaEvent).tripId === 'string' &&
      ((e as DnaEvent).action === 'accept' || (e as DnaEvent).action === 'decline' || (e as DnaEvent).action === 'seed'),
  )
}

/**
 * Identity of one event, for the merge below. Events carry no id and no clock
 * — the engine only ever needs what happened, never when — so two identical
 * records are indistinguishable from one record synced twice. Collapsing them
 * is the deliberate trade: without it every sync would double every count,
 * which is systematic, while a genuinely repeated twin costs at most one
 * affinity point.
 */
function dnaEventKey(e: DnaEvent): string {
  return [e.tripId, e.action, e.category ?? '', e.detourMin ?? '', e.visitMin ?? ''].join('|')
}

/**
 * Union of the device log and the account log, newest-last and capped. This is
 * how a second device inherits the profile: the account's events land in front
 * of whatever this device recorded on its own.
 */
export function mergeDnaLogs(device: DnaEvent[], account: DnaEvent[], cap: number = DNA_CAP): DnaEvent[] {
  const seen = new Set<string>()
  const out: DnaEvent[] = []
  for (const e of [...account, ...device]) {
    const key = dnaEventKey(e)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out.slice(-Math.max(0, cap))
}

function readDeviceLog(): DnaEvent[] {
  try {
    const raw = localStorage.getItem(DNA_KEY)
    return raw ? normalizeDnaLog(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

function writeDeviceLog(log: DnaEvent[]): void {
  try {
    localStorage.setItem(DNA_KEY, JSON.stringify(log.slice(-DNA_CAP)))
  } catch {
    /* DNA is best-effort — a full/blocked store never breaks suggestions */
  }
}

// ---- account copy (I-16) — one `user_dna` row per user, migration
// 20260921_user_dna.sql. Read once per hydrate; written back debounced. ----

let accountClient: SupabaseClient | null = null
let accountUserId: string | null = null
let accountLog: DnaEvent[] = []
let pushTimer: ReturnType<typeof setTimeout> | null = null
let warnedMissingTable = false

/** "The table does not exist yet" — PGRST205/42P01, or the message when a proxy
 *  rewrites the code away. A capability to report once, never an error. */
function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: string }).code
  if (code === 'PGRST205' || code === '42P01') return true
  const msg = (error as { message?: string }).message ?? ''
  return /could not find the table|relation .* does not exist/i.test(msg)
}

/**
 * Point the log at the signed-in account and fold in what it already knows.
 * Called from the store's hydrate; a null client or userId (signed out, public
 * view, no backend) leaves the device-only behaviour exactly as it was.
 *
 * Best-effort by construction: a database that has not run
 * 20260921_user_dna.sql answers PGRST205, which is treated as a capability and
 * warned about once. Every other failure (offline, RLS denial, a malformed
 * row) is silent — the device log stays the source of truth until the account
 * copy proves otherwise.
 */
export async function attachDnaAccount(client: SupabaseClient | null, userId: string | null): Promise<void> {
  detachDnaAccount()
  if (!client || !userId) return
  accountClient = client
  accountUserId = userId
  try {
    const { data, error } = await client.from('user_dna').select('log').eq('user_id', userId).maybeSingle()
    if (error) {
      if (isMissingTableError(error) && !warnedMissingTable) {
        console.warn('[yatraflow] user_dna missing — run supabase/migrations/20260921_user_dna.sql; Trip DNA stays device-local until then.')
        warnedMissingTable = true
      }
      return
    }
    // An account switch during the read must not adopt the wrong log.
    if (accountUserId !== userId) return
    accountLog = normalizeDnaLog((data as { log?: unknown } | null)?.log)
    const merged = mergeDnaLogs(readDeviceLog(), accountLog)
    if (merged.length !== accountLog.length) {
      // Something lived only on this device: adopt the union locally and let
      // the debounced push carry it up, so the profile follows the account
      // from here on instead of starting over per device.
      accountLog = merged
      writeDeviceLog(merged)
      schedulePush()
    }
  } catch { /* offline / transport — device-only until the next hydrate */ }
}

/** Sign-out and anonymous hydrates: stop syncing and forget the account's log,
 *  so the next person on this device never inherits the last one's profile. */
export function detachDnaAccount(): void {
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null }
  accountClient = null
  accountUserId = null
  accountLog = []
}

/** The log the engine reads: the device copy plus whatever the account brought. */
export function loadDnaLog(): DnaEvent[] {
  const device = readDeviceLog()
  return accountUserId ? mergeDnaLogs(device, accountLog) : mergeDnaLogs(device, [])
}

function schedulePush(): void {
  if (!accountClient || !accountUserId) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    const client = accountClient
    const userId = accountUserId
    if (!client || !userId) return
    const log = loadDnaLog().slice(-DNA_CAP)
    accountLog = log
    void client.from('user_dna')
      .upsert({ user_id: userId, log, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .then(({ error }) => {
        if (error) console.warn('[yatraflow] Trip DNA sync failed', error)
      })
  }, DNA_PUSH_DELAY_MS)
}

/** Record one accept/decline/seed. The device copy is written synchronously (it
 *  is what the next render reads); the account copy follows, debounced. */
export function recordDnaEvent(event: DnaEvent): void {
  const log = readDeviceLog()
  log.push(event)
  writeDeviceLog(log)
  schedulePush()
}

// ---- crew seeds (Horizon 3.4): open group-input ideas feed the engine ----
export interface CrewSeed {
  name: string
  category?: string
  lat: number
  lng: number
}

/** Open ideas with usable coords become seeds; declined/coord-less ones drop. */
export function crewSeedsFromSuggestions(
  suggestions: { status: string; title: string; category?: string; lat: number; lng: number }[],
): CrewSeed[] {
  return suggestions
    .filter(s => s.status === 'open' && Number.isFinite(s.lat) && Number.isFinite(s.lng) && s.lat !== 0 && s.lng !== 0)
    .map(s => ({ name: s.title, category: s.category, lat: s.lat, lng: s.lng }))
}

/** Seeds in planned-stop shape — near-duplicate corridor hits get suppressed. */
export function crewSeedsToPlannedStops(seeds: CrewSeed[]): { lat: number; lng: number; name: string }[] {
  return seeds.map(s => ({ lat: s.lat, lng: s.lng, name: s.name }))
}

/** Each seed biases its kind ('seed' action — affinity without accept credit). */
export function crewSeedEvents(tripId: string, seeds: CrewSeed[]): DnaEvent[] {
  return seeds.map(s => ({ tripId, action: 'seed' as const, category: s.category }))
}

/** "More like X" note when a hit matches a seed's kind. */
export function crewNoteForHit(
  hit: { category?: string },
  seeds: CrewSeed[],
): string | null {
  const cat = normCat(hit.category)
  if (!cat) return null
  const seed = seeds.find(s => normCat(s.category) === cat)
  return seed ? `more like ${seed.name}` : null
}
