// ============ Create funnel: submit-time input honesty ============
// The add-stop fields are autocompletes. `destInput` / `returnInput` hold what
// the user typed, and only a PICK turns that text into a stop (`onPick` →
// `addDest`). Text left unpicked therefore never reached `dests`, and the form
// discarded it the moment it was submitted without saying a word (#375) — the
// user watched a place they had typed simply not appear on the trip.
//
// These helpers decide what to say instead. They are pure so the rule is
// testable without a DOM (`tests/` runs in node — AGENTS §1).

export interface UnpickedStopInputs {
  /** What currently sits in the outbound "add a stop" field. */
  dest: string
  /** What currently sits in the return-leg add field. */
  ret: string
  /** False when the trip has no custom return leg — that field is not rendered. */
  returnOpen: boolean
}

/** Error keys this module produces. Both name real controls, so F-15 focus can
 *  land on the field the message is about. */
export interface UnpickedStopErrors {
  destinations?: string
  returnStops?: string
}

/** The typed text is quoted back so the message names what is about to be
 *  dropped — shortened, because a field error is not the place for a paragraph. */
export function unpickedStopMessage(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  const shown = t.length > 48 ? `${t.slice(0, 47)}…` : t
  return `Pick “${shown}” from the suggestions so it gets a map pin — or add it without one.`
}

/** Only non-empty, unpicked text counts. Whitespace is not a stop, and a return
 *  field that is not on screen cannot be holding the user's intent: when the
 *  custom return leg is off, its leftover text is neither shown nor lost, so it
 *  must not block the save. */
export function unpickedStopErrors({ dest, ret, returnOpen }: UnpickedStopInputs): UnpickedStopErrors {
  const out: UnpickedStopErrors = {}
  if (dest.trim()) out.destinations = unpickedStopMessage(dest)
  if (returnOpen && ret.trim()) out.returnStops = unpickedStopMessage(ret)
  return out
}
