// One place that decides which abort signal a provider fetch gets: the caller's
// signal combined with the per-request timeout. Kept out of routing.ts so the
// Google Routes provider can use it without an import cycle.

/** Per-request timeout for every routing fetch. */
export const ROUTE_REQUEST_TIMEOUT_MS = 8000

/** Combine a caller's signal with the per-request timeout where supported. */
export function requestSignal(signal: AbortSignal | undefined): AbortSignal {
  // an already-aborted caller must hand the fetch an ABORTED signal — a fresh
  // timeout here would send post-abort fallback fetches out un-aborted
  if (signal?.aborted) return AbortSignal.abort()
  const timeout = AbortSignal.timeout(ROUTE_REQUEST_TIMEOUT_MS)
  if (!signal) return timeout
  const Any = AbortSignal as unknown as { any?: (sigs: AbortSignal[]) => AbortSignal }
  return Any.any ? Any.any([signal, timeout]) : timeout
}
