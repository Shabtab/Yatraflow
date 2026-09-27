// ============ A start pin belongs to the text it was picked for (#410) ============
//
// Renaming the start city while the old coordinates stay set is how a "Udaipur"
// trip silently measures Jaipur's roads: every downstream figure — road
// measurement, distances, the map's framing, the route signature — is then
// honest math over the wrong city, with nothing anywhere saying so. The same
// impossible-geometry family as Null Island, caused by a mismatch instead of a
// placeholder.
//
// So the TEXT owns the pin. A pin carries the label it was picked for; a text
// that names a different city has no pin, and the trip saves as unpositioned —
// which flows through the EXISTING degraders (chord estimates, honest "no
// route" states) instead of through a confident wrong city. A pick re-sets the
// pin, instantly, and nothing else can.

import type { LatLngPoint } from '../data/types'

/** A picked position and the city label it was picked for. */
export type StartPin = { coords: LatLngPoint; label: string }

/** Does this text still name the city the pin was picked for? Compared on the
 *  trimmed, case-folded text — a capitalisation fix is not a new city, and a
 *  stray trailing space from a paste is not an edit. */
export function pinMatchesText(pin: StartPin | null | undefined, text: string): boolean {
  if (!pin) return false
  const label = pin.label.trim().toLowerCase()
  return label.length > 0 && label === text.trim().toLowerCase()
}

/** The coordinates the trip may persist for this text: the pin's own, or none.
 *  This is the save-time backstop — a mismatched pair must never persist
 *  silently, whatever produced it. */
export function coordsForText(pin: StartPin | null | undefined, text: string): LatLngPoint | null {
  if (!pin || !pinMatchesText(pin, text)) return null
  return pin.coords
}
