// ============ One preview at a time — chained, not forked (#334) ============
//
// The impact-preview sheet is NOT modal: the timeline, board and map stay live
// while it is open. Every mutation used to clone the COMMITTED trip, so a
// second edit made while a preview was open replaced the first one outright —
// the staged change vanished with no toast, no merge and no warning.
//
// The policy (Option A of the issue's fix guide) is to CHAIN: the base for a
// mutation is the staged proposal when one exists, so the second change builds
// on the first and the sheet reports the combined delta. The committed trip is
// still the measuring stick for the impact itself, which keeps the numbers
// honest about what Save will actually write.
//
// Kept pure and React-free so the composition is pinned in node tests
// (tests/preview-chain.test.ts); the workspace owns the state.
import type { Trip } from '../data/types'

/** The shape a mutation must be applied to: the staged proposal when a preview
 *  is open, otherwise the committed row. */
export function previewBase(committed: Trip, staged: Trip | null): Trip {
  return staged ?? committed
}

/** Apply a mutation to the right base and hand back the proposed shape. The
 *  first staged change survives a second mutation because the second clones
 *  the first's proposal, never the committed row.
 *
 *  #563 — the belt under the mutators' own day guards: a mutator that throws
 *  anyway (a stale index no guard reached) must not crash the workspace, and
 *  must not stage a HALF-applied draft either. The throw discards the draft —
 *  a fresh clone of the base is proposed, so the impact sheet reads zero-delta
 *  — and the reason is logged, not swallowed. */
export function stagedChange(committed: Trip, staged: Trip | null, mutator: (draft: Trip) => void): Trip {
  const base = previewBase(committed, staged)
  const proposed = structuredClone(base) as Trip
  try {
    mutator(proposed)
  } catch (err) {
    console.error('[yatraflow] staged change refused — the mutator threw', err)
    return structuredClone(base) as Trip
  }
  return proposed
}

/** The one refusal a direct-cache writer speaks while a preview is open.
 *
 *  Resolved decisions and accepted suggestions are CREW signals written
 *  straight to the cache — they are deliberately NOT staged into the preview.
 *  Staging one would put a resolution the rest of the group cannot see inside a
 *  proposal its author might never keep; the group's own record (votes, tally,
 *  feed) would then disagree with the timeline. So they wait: the preview is a
 *  study-and-commit surface, not a second place for the crew to vote. */
export const PREVIEW_BUSY = 'Keep or remove your staged change first.'

/** True when the committed row is no longer the object the preview was built
 *  on — a direct write (a resolved decision, an accepted suggestion, a realtime
 *  edit) landed while the preview was open, so saving the proposal would
 *  silently overwrite it. Identity is a sufficient signal: the store clones the
 *  trip row on every write. */
export function keepIsStale(base: Trip | null, current: Trip): boolean {
  return base !== null && base !== current
}
