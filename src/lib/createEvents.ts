/**
 * The create funnel's dated event log (#428).
 *
 * One row per funnel step, mirroring the `pub_events` pattern so the codebase
 * keeps ONE analytics shape. The dated log is the ONLY source — no lifetime
 * counter columns on trips (the #363 drift lesson); every aggregate derives
 * from the rows at read time.
 *
 * PII RULE (load-bearing, teeth-tested): the log says a step happened, never
 * who took it or what they typed. `meta` carries counts, slugs, enums and
 * booleans ONLY. Crew names and phone numbers, trip names, destination
 * strings and budget figures never enter the log — a free-text field is how a
 * phone number ends up in analytics. `sanitizeCreateMeta` is the one gate
 * every write goes through, and the test suite constructs the nastiest
 * realistic state and asserts its absence from the serialized row.
 *
 * The write path is fire-and-forget AFTER the UX updates: analytics must
 * never block submit, and a failed write is logged to the console and
 * dropped, never surfaced to the user.
 */
import { supabase, isSupabaseConfigured } from './supabase'
import type { TransportMode } from '../data/types'

/** The closed event vocabulary — mirrored by the table's CHECK constraint
 *  (supabase/migrations/20260929_create_funnel_events.sql). The two lists are
 *  pinned to each other by tests/createEvents.test.ts; adding a value here
 *  without its migration half (or the reverse) fails the gate. */
export const CREATE_EVENTS = [
  'started',
  'template_picked',
  'readiness_complete',
  'draft_resumed',
  'draft_discarded',
  'crew_added',
  'submitted',
  'moment_invite_sent',
  'abandoned',
] as const
export type CreateEvent = (typeof CREATE_EVENTS)[number]

/** Invitation channels — the same four the crew invite rail offers
 *  (lib/crewInvite's CREW_CHANNELS) plus 'share' for the OS share-sheet
 *  fallback. Stored as the enum string, never a recipient. */
export const CREATE_INVITE_CHANNELS = ['whatsapp', 'telegram', 'sms', 'insta', 'share'] as const
export type CreateInviteChannel = (typeof CREATE_INVITE_CHANNELS)[number]

/** Where a template pick came from: a curated card, the user's previous trip
 *  shape, or the demo walk. The template ID (a slug like `kerala-backwaters`)
 *  is platform-authored content, not user content, so it is safe to store. */
export const CREATE_TEMPLATE_SOURCES = ['template', 'last', 'demo'] as const
export type CreateTemplateSource = (typeof CREATE_TEMPLATE_SOURCES)[number]

/** Per-event meta shapes. Each is closed: counts, slugs, enums, booleans. */
export interface CreateEventMeta {
  started: Record<string, never>
  template_picked: { source: CreateTemplateSource; templateId?: string }
  readiness_complete: Record<string, never>
  draft_resumed: Record<string, never>
  draft_discarded: Record<string, never>
  crew_added: { count: number }
  submitted: { days: number; travellers: number; mode: TransportMode }
  moment_invite_sent: { channel: CreateInviteChannel }
  abandoned: { lastStage: string }
}

const LAST_STAGE_MAX = 40

/** The one gate every write passes. Takes the caller's meta (typed loosely on
 *  purpose — this is the boundary) and returns ONLY the allow-listed fields of
 *  the event's own shape, coerced to safe values. Anything not in the event's
 *  shape is dropped; strings that are not from a closed enum are dropped.
 *  `lastStage` is the one free-ish string and it is clamped to 40 chars of
 *  stage key (`where`, `when`, `crew`…) — the funnel's own vocabulary, not
 *  user content. */
export function sanitizeCreateMeta<E extends CreateEvent>(
  event: E,
  meta?: Partial<CreateEventMeta[E]> | Record<string, unknown>,
): Partial<CreateEventMeta[E]> | undefined {
  if (meta == null || typeof meta !== 'object') return undefined
  const m = meta as Record<string, unknown>
  const num = (v: unknown): number | undefined => {
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
  }
  switch (event) {
    case 'template_picked': {
      const source = CREATE_TEMPLATE_SOURCES.find(s => s === m.source)
      if (!source) return undefined
      const templateId = typeof m.templateId === 'string' && /^[\w-]{1,60}$/.test(m.templateId)
        ? m.templateId
        : undefined
      return { source, ...(templateId ? { templateId } : {}) } as unknown as Partial<CreateEventMeta[E]>
    }
    case 'crew_added': {
      const count = num(m.count)
      return count == null ? undefined : { count } as unknown as Partial<CreateEventMeta[E]>
    }
    case 'submitted': {
      const days = num(m.days)
      const travellers = num(m.travellers)
      const mode = typeof m.mode === 'string' && m.mode.length <= 20 ? m.mode : undefined
      if (days == null || travellers == null || mode == null) return undefined
      return { days, travellers, mode } as unknown as Partial<CreateEventMeta[E]>
    }
    case 'moment_invite_sent': {
      const channel = CREATE_INVITE_CHANNELS.find(c => c === m.channel)
      return channel ? ({ channel } as unknown as Partial<CreateEventMeta[E]>) : undefined
    }
    case 'abandoned': {
      // Stage keys are alphabetic words from the funnel's own vocabulary
      // (`where`, `when`, `crew`…). The charset strip drops EVERYTHING else —
      // digits included — so a phone number pasted here cannot survive, even
      // with its separators stripped (the teeth test caught exactly that).
      const lastStage = typeof m.lastStage === 'string' && m.lastStage.length > 0
        ? m.lastStage.slice(0, LAST_STAGE_MAX).replace(/[^a-zA-Z_-]/g, '')
        : undefined
      return lastStage ? ({ lastStage } as unknown as Partial<CreateEventMeta[E]>) : undefined
    }
    default:
      // started / readiness_complete / draft_resumed / draft_discarded carry
      // no meta at all — anything handed in is dropped.
      return undefined
  }
}

// ---------- session id ----------

const SESSION_KEY = 'yatraflow_create_funnel_session'

/** This browser session's funnel id — generated once per tab session and
 *  never the Supabase user id (the funnel starts pre-signup). A session is a
 *  SESSION, not a person: it dies with the tab and is never joined across
 *  sessions except through the user_id backfill. */
export function createFunnelSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    sessionStorage.setItem(SESSION_KEY, id)
    return id
  } catch {
    // sessionStorage denied (private mode etc.) — an ephemeral id, this page
    // load only. Analytics degrades, the product does not notice.
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  }
}

/** Sign-in backfill: the rows this session wrote before auth adopt the user.
 *  Exactly one keyed UPDATE; fire-and-forget like every write here. */
export function backfillCreateFunnelSession(userId: string): void {
  if (!isSupabaseConfigured || !userId) return
  const sessionId = createFunnelSessionId()
  // Best-effort by design: analytics never surfaces to the user, so a builder
  // chain that throws (a mocked supabase in tests, a client mid-teardown) is
  // caught HERE rather than escaping as an unhandled rejection.
  try {
    void Promise.resolve(
      supabase
        .from('create_funnel_events')
        .update({ user_id: userId })
        .eq('session_id', sessionId)
        .is('user_id', null)
        .then(({ error }) => {
          if (error) console.warn('[yatraflow] funnel session backfill failed', { message: error.message })
        }),
    ).catch((err: unknown) => {
      console.warn('[yatraflow] funnel session backfill failed', { message: err instanceof Error ? err.message : String(err) })
    })
  } catch (err) {
    console.warn('[yatraflow] funnel session backfill failed', { message: err instanceof Error ? err.message : String(err) })
  }
}

// ---------- write path ----------

/** Record one funnel step. Fire-and-forget and silent by design: it runs
 *  AFTER the UX has reacted, never blocks the caller, and a failed insert is
 *  dropped with a console line. The meta passes the sanitizer gate — unknown
 *  events and shapes are refused HERE as well as by the table's CHECK. */
export function recordCreateEvent<E extends CreateEvent>(
  event: E,
  meta?: Partial<CreateEventMeta[E]>,
  opts?: { tripId?: string; userId?: string | null },
): void {
  if (!isSupabaseConfigured) return
  if (!CREATE_EVENTS.includes(event)) {
    console.warn('[yatraflow] refused unknown funnel event', { event })
    return
  }
  const safeMeta = sanitizeCreateMeta(event, meta)
  if (meta != null && safeMeta == null) {
    // A meta the event's shape cannot accept is a caller bug — say so rather
    // than writing a half-row.
    console.warn('[yatraflow] funnel event meta refused by sanitizer', { event })
    return
  }
  // Best-effort: the insert must never throw into the caller (analytics runs
  // after the UX, a sync failure in a mocked/teardown client is caught here).
  try {
    void Promise.resolve(
      supabase
        .from('create_funnel_events')
        .insert({
          session_id: createFunnelSessionId(),
          user_id: opts?.userId ?? null,
          event,
          phase: null,
          trip_id: opts?.tripId ?? null,
          meta: safeMeta ?? null,
        })
        .then(({ error }) => {
          if (error) console.warn('[yatraflow] funnel event write failed', { message: error.message })
        }),
    ).catch((err: unknown) => {
      console.warn('[yatraflow] funnel event write failed', { message: err instanceof Error ? err.message : String(err) })
    })
  } catch (err) {
    console.warn('[yatraflow] funnel event write failed', { message: err instanceof Error ? err.message : String(err) })
  }
}

/** Best-effort `abandoned` beacon on pagehide. The API may kill it (mobile) —
 *  `abandoned` is directional, never a denominator. */
export function recordAbandonedBeacon(lastStage: string): void {
  if (typeof document === 'undefined') return
  const send = () => recordCreateEvent('abandoned', { lastStage })
  if (document.visibilityState === 'hidden') return // already leaving
  window.addEventListener('pagehide', send, { once: true, capture: true })
}

// ---------- read derivations (pure — the dashboard's answer key) ----------

/** The shape of a row as the read surface consumes it. */
export interface CreateFunnelRow {
  event: CreateEvent
  at: string
  meta: Record<string, unknown> | null
}

export interface CreateFunnelStats {
  /** per-event counts over the window */
  counts: Record<CreateEvent, number>
  /** started → submitted, over sessions that started */
  conversionPct: number
  /** template picks per template id (slugs only) */
  templates: { templateId: string; picks: number }[]
  /** the most common abandonment stage, or null */
  topAbandonStage: string | null
  /** per-day counts for a trend strip, oldest → newest */
  perDay: { day: string; started: number; submitted: number }[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Derive the read surface's numbers from a window of rows. Pure: same rows
 *  in, same numbers out — the tests pin the arithmetic. */
export function deriveCreateFunnel(rows: CreateFunnelRow[], days = 30): CreateFunnelStats {
  const counts = Object.fromEntries(CREATE_EVENTS.map(e => [e, 0])) as Record<CreateEvent, number>
  const templates = new Map<string, number>()
  const abandonStages = new Map<string, number>()
  const perDay = new Map<string, { started: number; submitted: number }>()
  const now = Date.now()
  for (let i = days - 1; i >= 0; i--) {
    perDay.set(new Date(now - i * DAY_MS).toISOString().slice(0, 10), { started: 0, submitted: 0 })
  }
  for (const row of rows) {
    if (!CREATE_EVENTS.includes(row.event)) continue // unknown rows never poison the window
    counts[row.event]++
    const meta = (row.meta ?? {}) as Record<string, unknown>
    if (row.event === 'template_picked' && typeof meta.templateId === 'string') {
      templates.set(meta.templateId, (templates.get(meta.templateId) ?? 0) + 1)
    }
    if (row.event === 'abandoned' && typeof meta.lastStage === 'string') {
      abandonStages.set(meta.lastStage, (abandonStages.get(meta.lastStage) ?? 0) + 1)
    }
    const day = new Date(row.at).toISOString().slice(0, 10)
    const bucket = perDay.get(day)
    if (bucket) {
      if (row.event === 'started') bucket.started++
      if (row.event === 'submitted') bucket.submitted++
    }
  }
  const started = counts.started
  const conversionPct = started > 0 ? (counts.submitted / started) * 100 : 0
  const topAbandonStage =
    [...abandonStages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  return {
    counts,
    conversionPct,
    templates: [...templates.entries()]
      .map(([templateId, picks]) => ({ templateId, picks }))
      .sort((a, b) => b.picks - a.picks),
    topAbandonStage,
    perDay: [...perDay.entries()].map(([day, v]) => ({ day, ...v })),
  }
}
