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

export const supabase: SupabaseClient = createClient(url ?? '', anonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // handles the OAuth redirect callback (?code=...)
  },
})

export const isSupabaseConfigured = Boolean(url && anonKey)
