// ============ Auth failure diagnosis ============
// Pure and dependency-free (node-testable). The bug this fixes: when a build
// ships without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — the usual cause
// being Vercel env vars scoped to Production only, so every Preview deploy is
// built without them — lib/supabase.ts falls back to a placeholder client (on
// purpose, to avoid a white screen). Auth calls then hit localhost and the
// user sees a bare "Failed to fetch" that reads like a wrong password.
// These helpers turn that state into something actionable instead.

/** The deliberate placeholder origin in lib/supabase.ts. Never a real project. */
export const PLACEHOLDER_SUPABASE_URL = 'http://localhost:54321'

/** Shown when the bundle has no Supabase project baked into it. */
export const MISSING_BACKEND_MESSAGE =
  'This build is not connected to a backend — VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ' +
  'were missing when it was compiled, so sign-in requests go nowhere. ' +
  'Set both variables for this environment and redeploy (they are read at build time).'

/**
 * Is this a usable Supabase project URL, or an absent / placeholder / unfilled
 * template value? Rejects the placeholder origin and the `.env.example`
 * stand-in, accepts anything else absolute — including a local Supabase instance.
 */
export function isRealSupabaseUrl(url: string | undefined | null): boolean {
  if (!url) return false
  if (!/^https?:\/\/\S+$/i.test(url.trim())) return false
  const u = url.trim()
  if (u === PLACEHOLDER_SUPABASE_URL) return false
  if (u.includes('YOUR-PROJECT')) return false
  return true
}

function extractMessage(err: unknown): string {
  if (typeof err === 'string') return err.trim()
  if (err && typeof err === 'object') {
    const m = (err as { message?: unknown }).message
    if (typeof m === 'string' && m.trim()) return m.trim()
  }
  return ''
}

/**
 * Map whatever the auth call returned or threw to a message worth showing.
 *
 * supabase-js is inconsistent here: a rejected credential comes back as
 * `{ error }`, while a network failure can *throw* an AuthRetryableFetchError.
 * Both paths land here, so no caller has to remember which is which.
 */
export function describeAuthFailure(
  err: unknown,
  opts: { configured: boolean },
): string {
  // Unconfigured outranks the network text: "Failed to fetch" is the symptom,
  // the missing env var is the cause, and only the cause is fixable.
  if (!opts.configured) return MISSING_BACKEND_MESSAGE

  const msg = extractMessage(err)
  if (!msg) return 'Sign-in failed for an unknown reason — check the browser console.'
  if (/failed to fetch|networkerror|fetch failed|load failed|err_connection|timed? ?out/i.test(msg)) {
    return `Cannot reach the Supabase backend (network, CORS or an auth-protection rule blocked the request): ${msg}`
  }
  return msg
}
