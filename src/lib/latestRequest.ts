/**
 * Latest-request guard for async searches.
 *
 * Each begin() call issues a new id, and only the newest id is current. Before
 * an async answer changes state, check isCurrent(id). An older answer then drops
 * itself. cancel() makes every issued id stale at once.
 *
 * Pure logic with no React import, so the node test env can run it.
 */

export interface LatestRequest {
  /** Start a request. Its id is the only current id. */
  begin(): number
  /** True only for the newest id from begin(), and only until cancel(). */
  isCurrent(id: number): boolean
  /** Make every issued id stale. A later begin() issues a fresh id. */
  cancel(): void
}

/** Create one guard. Keep it for the life of the component that owns it. */
export function createLatestRequest(): LatestRequest {
  let lastIssued = 0
  // 0 means no request is current. Ids start at 1, so 0 never matches one.
  let current = 0
  return {
    begin() {
      lastIssued += 1
      current = lastIssued
      return current
    },
    isCurrent(id) {
      return current !== 0 && id === current
    },
    cancel() {
      current = 0
    },
  }
}
