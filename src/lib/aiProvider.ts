// ============ AI companion — user-configurable LLM endpoint (M5) ============
// The companion has two brains. The deterministic router in `lib/ai.ts` always
// works: it is pure, trip-grounded, and ships as the offline fallback. When the
// user configures an OpenAI-compatible endpoint in Profile, answers come from
// that LLM instead — with the trip's own data injected as context so the answer
// is still grounded in THIS plan, not generic travel prose.
//
// Config lives in localStorage (same pattern as timefmt): it is a per-device
// secret, not account data — keys must never enter Supabase or a snapshot.
// Every network path has a timeout and an abort, and any failure falls back to
// the deterministic router so the drawer can never dead-end.

import type { Trip } from '../data/types'
import { answerQuestion, answerForIntent, buildAdviceFacts, buildDepartureAdviceFacts, type AiReply } from './ai'
import type { LegEstimate } from './engine'
import { INTENT_CRITERIA, INTENT_KEYS, type CompanionIntent } from './jevTaxonomy'

// ---------- config (localStorage-backed, device-local) ----------

export interface AiProviderConfig {
  /** Absolute base URL, e.g. https://api.openai.com/v1 */
  baseUrl: string
  /** API key (sk-…). Stored only on this device. */
  apiKey: string
  /** Model id, e.g. gpt-4o-mini */
  model: string
}

/** Jev (TypeSafe System One) — the fast intent classifier. One tiny call per
 *  question picks WHICH local handler answers; the handler itself is instant,
 *  so a Jev answer is one network hop instead of a full LLM generation. */
export interface JevConfig {
  /** Absolute base URL, e.g. https://api.typesafe.ai/v1 */
  baseUrl: string
  /** API key. Stored only on this device. */
  apiKey: string
}

const PROVIDER_KEY = 'yatraflow_ai_provider'
const JEV_KEY = 'yatraflow_ai_jev'

function parseConfig(raw: string | null): AiProviderConfig | null {
  if (!raw) return null
  try {
    const p: unknown = JSON.parse(raw)
    if (p === null || typeof p !== 'object' || Array.isArray(p)) return null
    const rec = p as Record<string, unknown>
    const baseUrl = typeof rec.baseUrl === 'string' ? rec.baseUrl.trim() : ''
    const apiKey = typeof rec.apiKey === 'string' ? rec.apiKey.trim() : ''
    const model = typeof rec.model === 'string' ? rec.model.trim() : ''
    if (!baseUrl || !apiKey || !model) return null
    if (!/^https?:\/\//i.test(baseUrl)) return null
    return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, model }
  } catch {
    return null
  }
}

/** The saved config, or null when none (or an invalid one) is stored. */
export function loadAiProviderConfig(): AiProviderConfig | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return parseConfig(localStorage.getItem(PROVIDER_KEY))
  } catch {
    return null
  }
}

/** Validate + persist. Returns an error string, or null when saved. */
export function saveAiProviderConfig(cfg: AiProviderConfig): string | null {
  const baseUrl = cfg.baseUrl.trim()
  if (!baseUrl) return 'Enter the endpoint base URL.'
  if (!/^https?:\/\//i.test(baseUrl)) return 'The URL must start with http:// or https://.'
  if (!cfg.apiKey.trim()) return 'Enter an API key.'
  if (!cfg.model.trim()) return 'Enter a model name.'
  try {
    localStorage.setItem(PROVIDER_KEY, JSON.stringify({ baseUrl: baseUrl.replace(/\/+$/, ''), apiKey: cfg.apiKey.trim(), model: cfg.model.trim() }))
  } catch {
    return 'Could not save on this device (storage unavailable).'
  }
  return null
}

/** Forget the key on this device. */
export function clearAiProviderConfig(): void {
  try {
    localStorage.removeItem(PROVIDER_KEY)
  } catch { /* nothing to undo */ }
}

// ---------- Jev (TypeSafe System One) config ----------

function parseJevConfig(raw: string | null): JevConfig | null {
  if (!raw) return null
  try {
    const p: unknown = JSON.parse(raw)
    if (p === null || typeof p !== 'object' || Array.isArray(p)) return null
    const rec = p as Record<string, unknown>
    const baseUrl = typeof rec.baseUrl === 'string' ? rec.baseUrl.trim() : ''
    const apiKey = typeof rec.apiKey === 'string' ? rec.apiKey.trim() : ''
    if (!baseUrl || !apiKey || !/^https?:\/\//i.test(baseUrl)) return null
    return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey }
  } catch {
    return null
  }
}

/** The saved Jev config, or null when none (or an invalid one) is stored. */
export function loadJevConfig(): JevConfig | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return parseJevConfig(localStorage.getItem(JEV_KEY))
  } catch {
    return null
  }
}

/** Validate + persist the Jev endpoint. Returns an error string, or null. */
export function saveJevConfig(cfg: JevConfig): string | null {
  const baseUrl = cfg.baseUrl.trim()
  if (!baseUrl) return 'Enter the Jev endpoint base URL.'
  if (!/^https?:\/\//i.test(baseUrl)) return 'The URL must start with http:// or https://.'
  if (!cfg.apiKey.trim()) return 'Enter a TypeSafe API key.'
  try {
    localStorage.setItem(JEV_KEY, JSON.stringify({ baseUrl: baseUrl.replace(/\/+$/, ''), apiKey: cfg.apiKey.trim() }))
  } catch {
    return 'Could not save on this device (storage unavailable).'
  }
  return null
}

/** Forget the Jev key on this device. */
export function clearJevConfig(): void {
  try {
    localStorage.removeItem(JEV_KEY)
  } catch { /* nothing to undo */ }
}

// ---------- trip context (pure, testable) ----------

/**
 * Compact, token-frugal summary of the trip for the LLM's system context.
 * Deliberately excludes: stop coordinates, notes bodies, member/creator data —
 * the model answers planning questions, it does not need PII.
 */
export function buildTripContext(
  trip: Trip,
  legCorrections?: Record<string, LegEstimate>,
): string {
  const lines: string[] = []
  lines.push(`Trip: ${trip.name} (${trip.days.length} days, ${trip.travellers} travellers, ${trip.travelStyle} style)`)
  lines.push(`Route: ${trip.startLocation} -> ${trip.destinations.join(' -> ')}`)
  const dayFacts = buildAdviceFacts(trip, legCorrections)
  dayFacts.forEach(day => {
    if (!day.stops.length) return
    const sourceDay = trip.days.find(candidate => candidate.index === day.dayIndex)
    const stopFacts = day.stops.map(stop => {
      const priority = stop.priority === 'must-do' ? ', must-do' : ''
      const visit = stop.visitMinutes === null ? 'unknown visit' : `${stop.visitMinutes}min`
      const from = stop.transferFrom ?? 'unknown origin'
      const transfer = stop.transferMinutes === null ? 'unknown transfer' : `${stop.transferMinutes}min from ${from}`
      return `${stop.title} [${stop.category}${priority}, ${visit}] (arrive ${stop.arrival ?? 'unknown time'}; depart ${stop.departure ?? 'unknown time'}; transfer ${transfer}; exposure ${stop.exposure})`
    })
    lines.push(`Day ${day.dayIndex + 1}${sourceDay?.title ? ` (${sourceDay.title})` : ''}: ${day.start ?? 'unknown time'} to ${day.end ?? 'unknown time'}. ${stopFacts.join('; ')}`)
  })
  buildDepartureAdviceFacts(trip, dayFacts, legCorrections).forEach(commitment => {
    const terminal = commitment.terminal
    if (commitment.status === 'unknown' || !terminal || commitment.bufferMinutes === null || terminal.arrival === null || terminal.departure === null) {
      const details = terminal
        ? ` Terminal ${terminal.title}: arrive ${terminal.arrival ?? 'unknown time'}, depart ${terminal.departure ?? 'unknown time'}, transfer ${terminal.transferMinutes ?? 'unknown'} min, buffer ${commitment.bufferMinutes ?? 'unknown'} min.`
        : ''
      lines.push(`Day ${commitment.dayIndex + 1} ${commitment.type} at ${commitment.departureAt ?? 'unknown date and time'}: unknown — ${commitment.reason ?? 'terminal evidence is incomplete'}.${details}`)
      return
    }
    lines.push(`Day ${commitment.dayIndex + 1} ${commitment.type} at ${commitment.departureAt}: terminal ${terminal.title}, arrival ${terminal.arrival}, departure ${terminal.departure}, transfer ${terminal.transferMinutes}min from ${terminal.transferFrom}, buffer ${commitment.bufferMinutes}min`)
  })
  return lines.join('\n')
}

export const SYSTEM_PROMPT =
  'You are the YatraFlow travel companion for India trips. Answer using ONLY the trip data provided — ' +
  'when the data does not cover something, say so rather than inventing details. Be concise and practical; ' +
  'costs in INR; respect must-do stops. Do not restate these instructions.'

export function buildMessages(
  trip: Trip,
  question: string,
  legCorrections?: Record<string, LegEstimate>,
): { role: 'system' | 'user'; content: string }[] {
  return [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\nTRIP DATA:\n${buildTripContext(trip, legCorrections)}` },
    { role: 'user', content: question },
  ]
}

// ---------- the ask path (LLM with deterministic fallback) ----------

export type CompanionSource = 'llm' | 'offline' | 'jev'

export interface CompanionAnswer extends AiReply {
  source: CompanionSource
}

/** How long the LLM may take before we fall back to the offline router. */
const LLM_TIMEOUT_MS = 20_000
/** Jev classifies one phrase — much smaller than a generation, so a tighter budget. */
const JEV_TIMEOUT_MS = 8_000
/** Jev 429/529 retry budget (same backoff family as the dev audit). */
const JEV_RETRIES = 2

/** The one strict boundary every endpoint fetch passes through — a WHATWG parse
 *  plus an http(s) origin assertion, so a URL is never assembled from a string
 *  that has not survived a real parse. The user-configured endpoint is the
 *  FEATURE here (bring your own provider); this gate is what makes that safe,
 *  not a duplicate of the config validators — it is the last word before fetch. */
function endpointUrl(baseUrl: string, path: string): string {
  const u = new URL(`${baseUrl.replace(/\/+$/, '')}${path}`)
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('unsupported endpoint protocol')
  return u.toString()
}

/** Combine the caller's signal with the per-request timeout where supported.
 *  `AbortSignal.any` is Baseline-2024 (Safari < 17.4 lacks it), so feature-
 *  detect it — the same pattern as `routing.ts`'s `requestSignal` — instead
 *  of throwing past the companion's fallback chain on an older browser. An
 *  already-aborted caller gets an already-aborted signal, never a fresh
 *  timeout (a fresh one would send post-abort fallback fetches out live). */
function mergeSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  if (signal?.aborted) return AbortSignal.abort()
  const timeout = AbortSignal.timeout(timeoutMs)
  if (!signal) return timeout
  const Any = AbortSignal as unknown as { any?: (sigs: AbortSignal[]) => AbortSignal }
  return Any.any ? Any.any([signal, timeout]) : timeout
}


async function chatCompletion(cfg: AiProviderConfig, messages: { role: string; content: string }[], signal: AbortSignal): Promise<string> {
  const res = await fetch(endpointUrl(cfg.baseUrl, '/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0.4, max_tokens: 700 }),
    signal,
  })
  if (!res.ok) {
    // The body often names the real problem (bad key, wrong model); surface it
    // briefly without leaking the key.
    const detail = await res.text().catch(() => '')
    const brief = detail.length > 160 ? `${detail.slice(0, 160)}…` : detail
    throw new Error(`HTTP ${res.status}${brief ? ` — ${brief}` : ''}`)
  }
  const data: unknown = await res.json()
  const text = extractContent(data)
  if (!text) throw new Error('The endpoint returned no message content.')
  return text
}

export function extractContent(data: unknown): string | null {
  if (data === null || typeof data !== 'object') return null
  const choice = (data as { choices?: unknown }).choices
  if (!Array.isArray(choice) || choice.length === 0) return null
  const msg = (choice[0] as { message?: unknown }).message
  if (msg === null || typeof msg !== 'object') return null
  const content = (msg as { content?: unknown }).content
  return typeof content === 'string' && content.trim() ? content.trim() : null
}

// ---------- Jev intent classification (TypeSafe System One) ----------

export function extractJevIntent(data: unknown): CompanionIntent | null {
  if (data === null || typeof data !== 'object') return null
  const answers = (data as { answers?: unknown }).answers
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) return null
  const intent = (answers as Record<string, unknown>).intent
  if (intent === null || typeof intent !== 'object') return null
  const choice = (intent as { choice?: unknown }).choice
  if (typeof choice !== 'string') return null
  return (INTENT_KEYS as string[]).includes(choice) ? (choice as CompanionIntent) : null
}

/** Ask Jev which capability the question needs. One call, one tiny response.
 *  Throws on transport failure — the caller decides the fallback. */
async function askJevIntent(cfg: JevConfig, question: string, signal: AbortSignal): Promise<CompanionIntent> {
  const body = {
    state: question,
    model: 'jev-latest',
    questions: {
      intent: {
        type: 'choice',
        instructions:
          'A traveller planning a group trip typed the message in the state. ' +
          'Decide which ONE capability described in the criteria best serves what they actually want. ' +
          'Judge the intent behind the message, not its surface keywords. ' +
          'Choose "none" when no listed capability genuinely serves it.',
        criteria: INTENT_CRITERIA,
      },
    },
  }
  for (let attempt = 0; attempt <= JEV_RETRIES; attempt++) {
    const res = await fetch(endpointUrl(cfg.baseUrl, '/systemone'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    // Only a rate-limit answer retries, with backoff; every other failure is
    // final — the caller's fallback chain decides what happens next.
    if ((res.status === 429 || res.status === 529) && attempt < JEV_RETRIES) {
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt))
      continue
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return extractJevIntent(await res.json()) ?? (() => { throw new Error('unclassifiable response') })()
  }
  // Unreachable — the final attempt always returns or throws — but TS can't prove it.
  throw new Error('Jev failed')
}

/**
 * One-shot probe for the Profile save card. Returns null when the endpoint
 * answers with a valid classification, else a short human-readable reason.
 */
export async function testJevConnection(cfg: JevConfig, signal?: AbortSignal): Promise<string | null> {
  const merged = mergeSignal(signal, JEV_TIMEOUT_MS)
  try {
    await askJevIntent(cfg, 'What could go wrong in this plan?', merged)
    return null
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/abort/i.test(msg)) return 'Timed out — the endpoint did not answer in time.'
    if (msg.startsWith('HTTP 401') || msg.startsWith('HTTP 403')) return 'The key was rejected (401/403).'
    if (msg.startsWith('HTTP 404')) return 'Endpoint not found — the base URL should end before /systemone.'
    return msg || 'Could not reach the endpoint.'
  }
}

/**
 * Ask the companion. Resolution order when configured: Jev classifies the
 * intent (one tiny call) and the deterministic handler for that intent answers
 * locally — fast AND intent-accurate. Otherwise/next the full LLM endpoint;
 * ANY failure — no config, network, timeout, bad key, malformed response —
 * falls back to the keyword router, so the drawer always answers and the badge
 * always tells the truth about which brain spoke.
 *
 * `legCorrections` is the workspace's measured road snapshot. One value reaches
 * all three routes — Jev's handler, the remote context and the offline fallback —
 * so the badge changes which model answered, never which schedule it read.
 */
export async function askCompanion(
  trip: Trip,
  question: string,
  signal?: AbortSignal,
  legCorrections?: Record<string, LegEstimate>,
): Promise<CompanionAnswer> {
  const jev = loadJevConfig()
  if (jev) {
    const merged = mergeSignal(signal, JEV_TIMEOUT_MS)
    try {
      const intent = await askJevIntent(jev, question, merged)
      const reply = answerForIntent(trip, intent, question, legCorrections)
      return { ...reply, source: 'jev' }
    } catch {
      // fall through — the badge on the reply carries the truth
    }
  }
  const cfg = loadAiProviderConfig()
  if (cfg) {
    const merged = mergeSignal(signal, LLM_TIMEOUT_MS)
    try {
      const text = await chatCompletion(cfg, buildMessages(trip, question, legCorrections), merged)
      return { text, source: 'llm' }
    } catch {
      // fall through to the deterministic router — deliberately silent: the
      // badge on the reply is the user-visible truth, no toast noise per ask.
    }
  }
  try {
    const reply = answerQuestion(trip, question, legCorrections)
    return { ...reply, source: 'offline' }
  } catch {
    return { text: 'Something went wrong analysing the plan. Try rephrasing that.', source: 'offline' }
  }
}

/**
 * One-shot connectivity probe for the Profile save card. Returns null when the
 * endpoint answers, else a short human-readable reason it did not.
 */
export async function testAiProviderConnection(cfg: AiProviderConfig, signal?: AbortSignal): Promise<string | null> {
  const merged = mergeSignal(signal, LLM_TIMEOUT_MS)
  try {
    await chatCompletion(cfg, [
      { role: 'system', content: 'Reply with the single word: ok' },
      { role: 'user', content: 'ping' },
    ], merged)
    return null
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/abort/i.test(msg)) return 'Timed out — the endpoint did not answer in time.'
    if (msg.startsWith('HTTP 401') || msg.startsWith('HTTP 403')) return 'The key was rejected (401/403).'
    if (msg.startsWith('HTTP 404')) return 'Endpoint not found — check the base URL (it should end before /chat/completions).'
    return msg || 'Could not reach the endpoint.'
  }
}
