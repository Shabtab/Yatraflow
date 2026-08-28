// ============ Supabase client ============
// Single shared client. Reads the anon key from Vite env vars. The anon key is
// PUBLIC by design (safe to ship to the browser); the service_role key must
// NEVER be exposed here. Row Level Security in supabase/schema.sql is the
// real authorization boundary.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  // Surfaced loudly so a missing .env.local / Vercel env var isn't silent.
  console.error(
    '[yatraflow] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Copy .env.example to .env.local and fill in your Supabase project values.',
  )
}

// createClient() throws on an empty URL ("supabaseUrl is required."), which
// would crash the whole module graph before React mounts — every page imports
// the store, which imports this file — leaving a white blank page for anyone
// running without a configured backend. Fall back to a syntactically valid
// placeholder so the UI still renders; individual data/auth calls then fail
// with a normal fetch error instead of killing the app at startup.
export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'public-anon-key-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true, // handles the OAuth redirect callback (?code=...)
    },
  },
)

export const isSupabaseConfigured = Boolean(url && anonKey)
