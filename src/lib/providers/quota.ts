// ============ Google Places quota guard (Phase B) ============
// Per-SKU monthly event counters, persisted in localStorage. Soft-caps sit at
// 80% of the verified India free allowances (report §3/§4 — Text Search Pro
// 35k, Autocomplete/Place Details 70k per month), so the app silently falls
// back to the free stack long before a paid event can ever fire. Counters key
// by UTC month and roll over automatically.
//
// This is insurance, not a billing tool: the key is expected to be
// HTTP-referrer-restricted to the deployment domain (Google Cloud console),
// the quota guard is the second net if the key ever leaks.

export type QuotaSku = 'autocomplete' | 'placeDetails' | 'textSearchPro' | 'routes'

/** Verified India monthly free allowances per SKU (pricing-india, 2026-08-25).
 *  `routes` = Routes API computeRoutes: 10k free computeRoutes calls/month
 *  (Google Maps Platform standard quota). */
export const SKU_ALLOWANCE: Record<QuotaSku, number> = {
  autocomplete: 70_000,
  placeDetails: 70_000,
  textSearchPro: 35_000,
  routes: 10_000,
}

/** 80%-of-allowance soft caps — hitting one flips that SKU to the free stack. */
export const SOFT_CAPS: Record<QuotaSku, number> = {
  autocomplete: Math.round(SKU_ALLOWANCE.autocomplete * 0.8),   // 56,000
  placeDetails: Math.round(SKU_ALLOWANCE.placeDetails * 0.8),   // 56,000
  textSearchPro: Math.round(SKU_ALLOWANCE.textSearchPro * 0.8), // 28,000
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