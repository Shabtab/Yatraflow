/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Optional — Google Places API (New). Absent ⇒ 100% free stack everywhere. */
  readonly VITE_GOOGLE_MAPS_API_KEY: string
  /** Optional — Mappls place search key. */
  readonly VITE_MAPPLS_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
