// ============ Masteradmin role helpers ============
// Pure and dependency-free (node-testable). The admin role lives in the
// Supabase Auth JWT's app_metadata ({"role":"masteradmin"}), NOT in a
// profiles column — a column would be self-grantable through the
// "profiles update self" RLS policy. See supabase/migrations/20260909_masteradmin.sql.

/** The exact app_metadata role value that marks a masteradmin. */
export const MASTERADMIN_ROLE = 'masteradmin'

/**
 * True when the JWT app_metadata carries the masteradmin role.
 * Tolerant of every non-shape (null, arrays, missing key) — anything
 * unexpected means "not an admin", never a crash.
 */
export function parseAdminRole(appMetadata: unknown): boolean {
  if (!appMetadata || typeof appMetadata !== 'object' || Array.isArray(appMetadata)) return false
  return (appMetadata as Record<string, unknown>).role === MASTERADMIN_ROLE
}
