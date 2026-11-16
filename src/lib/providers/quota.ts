// ============ Google Places quota guard (Phase B) ============
// Per-SKU monthly event counters, persisted in localStorage. Soft-caps sit at
// 80% of the verified India free allowances (report §3/§4 — Text Search Pro
// 35k, Autocomplete/Place Details 70k per month). Since the 2026-09-07
// Google-only directive, hitting a cap PAUSES that SKU's Google-mode surface
// (surfaces show an explicit quota note) instead of silently falling back —
// the free stack serves only when no key is configured. Counters key by UTC
// month and roll over automatically.
//
// Two counters, two jobs:
//  - Local counter (below): a per-device runaway guard. Each browser counts its own events.
//  - Shared counter (reserveSharedQuota): the account-wide bill cap, kept in Supabase.
//    Only the routes SKU uses it in this change.
// The key is expected to be HTTP-referrer-restricted to the deployment domain
// (Google Cloud console). The quota guards are the second net if the key leaks.

import { isSupabaseConfigured, supabase } from '../supabase'

export type QuotaSku = 'autocomplete' | 'placeDetails' | 'textSearchPro' | 'nearbySearch' | 'routes'

/** Verified India monthly free allowances per SKU (pricing-india, 2026-08-25).
 *  `routes` = Routes API computeRoutes: 10k free computeRoutes calls/month
 *  (Google Maps Platform standard quota). `nearbySearch` = Nearby Search
 *  Essentials (id/displayName/location mask): 10k free events/month. */
export const SKU_ALLOWANCE: Record<QuotaSku, number> = {
  autocomplete: 70_000,
  placeDetails: 70_000,
  textSearchPro: 35_000,
  nearbySearch: 10_000,
  routes: 10_000,
}

/** 80%-of-allowance soft caps — hitting one flips that SKU to the free stack. */
export const SOFT_CAPS: Record<QuotaSku, number> = {
  autocomplete: Math.round(SKU_ALLOWANCE.autocomplete * 0.8),   // 56,000
  placeDetails: Math.round(SKU_ALLOWANCE.placeDetails * 0.8),   // 56,000
  textSearchPro: Math.round(SKU_ALLOWANCE.textSearchPro * 0.8), // 28,000
  nearbySearch: Math.round(SKU_ALLOWANCE.nearbySearch * 0.8),   //  8,000
  routes: Math.round(SKU_ALLOWANCE.routes * 0.8),               //  8,000
}

const NS = 'yf.gquota'

/**
 * In-memory mirror of the counters. Primary when localStorage is unavailable
 * (private mode, test environments) — the guard still works for the page
 * session; persisted only as a best-effort bonus.
 */
const memory = new Map<string, number>()

/** "2026-08" — UTC month bucket; changing it rolls all counters over. */
export function quotaMonthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function storageKey(sku: QuotaSku): string {
  return `${NS}.${quotaMonthKey()}.${sku}`
}

function readCount(sku: QuotaSku): number {
  const k = storageKey(sku)
  try {
    const raw = localStorage.getItem(k)
    if (raw != null) return Number(raw) || 0
  } catch { /* fall through to the in-memory mirror */ }
  return memory.get(k) ?? 0
}

function writeCount(sku: QuotaSku, n: number): void {
  const k = storageKey(sku)
  memory.set(k, n)
  try {
    localStorage.setItem(k, String(n))
  } catch { /* best-effort */ }
}

/** true when one more event of `sku` still fits under the soft cap */
export function quotaAllows(sku: QuotaSku): boolean {
  return readCount(sku) < SOFT_CAPS[sku]
}

/** count one fired event (call only after a request actually went out) */
export function quotaCount(sku: QuotaSku): void {
  writeCount(sku, readCount(sku) + 1)
}

/** events fired this month for `sku` (for diagnostics / tests) */
export function quotaUsed(sku: QuotaSku): number {
  return readCount(sku)
}

/** SKUs that also draw on the account-wide counter in Supabase. */
const SHARED_SKUS: ReadonlySet<QuotaSku> = new Set<QuotaSku>(['routes'])

/**
 * Takes one unit of the account-wide monthly quota for `sku`. Returns true only
 * when Supabase grants the unit. The check fails closed: no configured client,
 * an RPC error, a non-boolean answer or an abort all return false, and the
 * caller then takes its non-Google fallback. A SKU outside SHARED_SKUS returns
 * true without a call, so the local quotaAllows check still decides for it.
 */
export async function reserveSharedQuota(sku: QuotaSku, signal?: AbortSignal): Promise<boolean> {
  if (!SHARED_SKUS.has(sku)) return true
  if (!isSupabaseConfigured || signal?.aborted) return false
  try {
    const call = supabase.rpc('consume_provider_quota', { p_sku: sku })
    const { data, error } = await (signal ? call.abortSignal(signal) : call)
    return !error && data === true
  } catch {
    return false
  }
}

/** True when any of the supplied SKUs has reached its safety pause. */
export function anyQuotaExhausted(...skus: QuotaSku[]): boolean {
  return skus.some(sku => !quotaAllows(sku))
}

/** test hook — wipe every stored counter */
export function quotaResetForTests(): void {
  memory.clear()
  try {
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(NS)) stale.push(k)
    }
    for (const k of stale) localStorage.removeItem(k)
  } catch { /* noop */ }
}