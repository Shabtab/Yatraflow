// ============ What this browser keeps, and how to clear it honestly ============
//
// The crash screen's "Reset app data & reload" removed `yatraflow_db_v1` — a key
// that **nothing in this codebase ever writes**. So the app's most destructive
// button removed nothing at all, while wearing the primary style and the promise
// of a reset. (It also inherited the name of a localStorage database this app no
// longer has: trips live in Supabase, and what is actually kept locally is
// preferences, caches and an offline copy.)
//
// This module is the one place that knows what "local app data" means, so the
// button can clear the real thing — and `tests/local-data.test.ts` reads the tree
// to keep the list honest: every `localStorage` key a module writes must sit under
// one of these prefixes, or the test says so.
//
// Prefixes rather than an enumeration: several keys are per-trip or per-day
// (`yatraflow_suggestions_v6_<tripId>`, `yatraflow_halt_shape_<tripId>`), so a
// list of literals would be stale the moment a trip is opened. The prefixes are
// narrow enough to be this app's alone.

/** Every localStorage key this app writes begins with one of these. */
export const LOCAL_KEY_PREFIXES = ['yatraflow_', 'yf.'] as const

/** True when the key belongs to this app (and may therefore be cleared by it). */
export function isAppLocalKey(key: string): boolean {
  return LOCAL_KEY_PREFIXES.some(p => key.startsWith(p))
}

/** What the clear promise means, in one sentence both the crash screen and the
 *  audit read. Trips are on the account, not here — so say that rather than
 *  implying the user is about to lose them. */
export const LOCAL_DATA_NOTE =
  'This clears what this browser saved — display preferences, cached suggestions and the offline copy. Trips saved to your account are not affected.'

/** Remove every key this app keeps in localStorage. Returns how many went, so a
 *  caller can say what happened instead of shrugging. Best-effort: private mode
 *  and quota errors leave the count short rather than throwing on a crash screen. */
export function clearLocalAppData(): number {
  if (typeof localStorage === 'undefined') return 0
  const doomed: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && isAppLocalKey(key)) doomed.push(key)
    }
  } catch {
    return 0
  }
  let removed = 0
  for (const key of doomed) {
    try {
      localStorage.removeItem(key)
      removed++
    } catch {
      /* keep going — one stubborn key must not abandon the rest */
    }
  }
  return removed
}
