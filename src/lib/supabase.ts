// ============ Supabase client ============
// Single shared client. Reads the anon key from Vite env vars. The anon key is
// PUBLIC by design (safe to ship to the browser); the service_role key must
// NEVER be exposed here. Row Level Security in supabase/schema.sql is the
// real authorization boundary.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isRealSupabaseUrl, PLACEHOLDER_SUPABASE_URL } from './authErrors'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/**
 * False when no real project was compiled into this bundle. Surfaced as a
 * banner on the auth page (Auth.tsx) and as an actionable error from
 * store.login/signup, because the placeholder client below otherwise fails
 * with a bare "Failed to fetch" that looks like a wrong password.
 */
export const isSupabaseConfigured = isRealSupabaseUrl(url) && Boolean(anonKey)

if (!isSupabaseConfigured) {
  // Surfaced loudly so a missing .env.local / Vercel env var isn't silent.
  console.error(
    '[yatraflow] No Supabase project compiled into this build ' +
    '(missing or placeholder VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). ' +
    'Login and every data call will fail. Locally: copy .env.example to .env.local. ' +
    'On Vercel: set both variables for Preview as well as Production, then REDEPLOY ' +
    '— Vite inlines them at build time, so an existing deployment never picks them up.',
  )
}

// createClient() throws on an empty URL ("supabaseUrl is required."), which
// would crash the whole module graph before React mounts — every page imports
// the store, which imports this file — leaving a white blank page for anyone
// running without a configured backend. Fall back to a syntactically valid
// placeholder so the UI still renders; individual data/auth calls then fail
// with a normal fetch error instead of killing the app at startup.
export const supabase: SupabaseClient = createClient(
  url ?? PLACEHOLDER_SUPABASE_URL,
  anonKey ?? 'public-anon-key-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true, // handles the OAuth redirect callback (?code=...)
    },
  },
)

