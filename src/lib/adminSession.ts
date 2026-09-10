// ============ Masteradmin session plumbing ============
// Where the JWT role becomes something the app can gate on. The admin check
// reads the ALREADY-RESOLVED session object — it must NEVER call
// getSession()/getUser() itself, because hydrate() awaits it inside
// Promise.all and an unmocked extra auth call hangs the mocked tests (and
// costs a real round-trip in production).
import { parseAdminRole } from './admin'
import type { Session } from '@supabase/supabase-js'

/** Cached admin flag for this session — set once per sign-in, cleared on sign-out. */
let cachedIsAdmin: boolean | null = null

/** Derive the flag from a resolved session (getSession / onAuthStateChange arg). */
export function adminFromSession(session: Session | null | undefined): boolean {
  const admin = parseAdminRole(session?.user.app_metadata)
  cachedIsAdmin = admin
  return admin
}

/** Synchronous read of the last fetched flag (false until the first fetch settles). */
export function isAdminCached(): boolean {
  return cachedIsAdmin === true
}

/** Forget the flag — called on sign-out alongside the session clear. */
export function clearAdminCache(): void {
  cachedIsAdmin = null
}
