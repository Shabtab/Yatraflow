// ============ What a page may claim about a read it depends on ============
// The conflation this exists to stop: a screen that reads from the store's
// hydrate cannot tell "there is nothing here" from "I could not read", because
// a failed hydrate leaves the cache empty and the page has only the array to
// look at. That is not hypothetical — the earnings ledger shipped the same
// shape and its error branch was unreachable (fixed in c460159).
//
// Three states, never two, because genuine new creators and empty galleries DO
// need the friendly copy: hiding it would fix the lie by replacing it with a
// worse one.
//
//   reading  — the read has not settled. "Nothing here" is a lie until it does.
//   failed   — it settled and it FAILED. The only state that offers a retry.
//   ready    — it succeeded. Empty is now a real answer, and the friendly copy
//              is correct.
//
// Ordering is the whole point, and it is why this is a function rather than a
// ternary written at the call site: `ready` is only reachable once a read has
// actually SUCCEEDED, so a failure can never fall through into it. The
// pre-existing bug in this family was exactly `hasData ? ready : loading` with
// the error branch behind the loading branch — unreachable by construction.

/** The three states a page may be in about the data it renders. */
export type ReadState = 'reading' | 'failed' | 'ready'

/**
 * Resolve what a page may say about one slice of hydrated data.
 *
 * `read` is deliberately the pair the store can actually answer, not a boolean
 * `hasData`: a slice can be empty AND successfully read (a new creator), or
 * empty because the read failed, and those are different truths about the same
 * array.
 */
export function readState(input: {
  /** Has the first hydrate of this session settled at all? A settled hydrate
   *  that recorded NOTHING about this slice is the ambiguous case: the read may
   *  have succeeded with zero rows, or been skipped entirely. Callers pass
   *  `read` to disambiguate, and this flag alone is never enough to reach
   *  'ready' — that is the whole trap. */
  settled: boolean
  /** Did THIS slice fail? Per-slice, never a global flag — a global `ready`
   *  can be true while these rows failed, which is what this replaces. */
  failed?: boolean
  /** Did this slice read successfully? */
  read?: boolean
}): ReadState {
  // A failure outranks everything: it is the only state that offers a way back,
  // and it must be reachable whether or not the array happens to hold rows.
  if (input.failed) return 'failed'
  // A successful read is an answer, even when the answer is "none".
  if (input.read) return 'ready'
  // Everything else is reading. Deliberately NOT `settled ? 'ready' : …`: a
  // settle is not a success, and treating it as one is how an empty array came
  // to mean "empty gallery" over a dropped connection.
  return 'reading'
}

/**
 * The copy a page shows for a read that produced nothing to display.
 *
 * Split out so the three cases cannot drift into one another in a template: the
 * failure sentence must never be reachable from a successful empty read, which
 * is what "your gallery is empty" over a dropped connection looked like.
 */
export function emptyCopyFor(state: ReadState, what: string, retry: () => void): {
  title: string
  body: string
  retry?: () => void
} {
  if (state === 'failed') {
    return {
      title: `Couldn’t load ${what}`,
      body: `The request failed, which is not the same as there being none. Nothing is missing from your account — try again.`,
      retry,
    }
  }
  if (state === 'reading') {
    return { title: `Loading ${what}…`, body: 'One moment.' }
  }
  return { title: `No ${what} yet`, body: 'When there is one, it appears here.' }
}

/**
 * Whether a "0" figure may be shown as a real zero.
 *
 * Creator stats used to be hidden at zero, which made a failed funnel read
 * indistinguishable from a brand-new creator. A number that could not be read
 * is not a number, and rendering it as `0` states something about the creator
 * that nobody verified.
 */
export function figureOrUnavailable(
  value: number | null | undefined,
  state: ReadState,
): number | null {
  if (state !== 'ready') return null
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * The state of one named slice, as the store reports it.
 *
 * `sliceReads` is absent until the first hydrate settles, and that absence is
 * `reading` rather than `ok` — an unreported read is an unread one. This is the
 * only place the two vocabularies (the store's per-slice record, this module's
 * three states) meet, so a page cannot get the inference subtly wrong.
 */
export function sliceState(
  sliceReads: Record<string, 'ok' | 'failed'> | undefined,
  slice: string,
): ReadState {
  const verdict = sliceReads?.[slice]
  if (verdict === 'failed') return 'failed'
  if (verdict === 'ok') return 'ready'
  return 'reading'
}
