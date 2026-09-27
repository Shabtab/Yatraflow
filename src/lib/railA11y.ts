// ============ Rail announcements, names and associations (pure) ============
// #333 A2/A5/A6/A8. Four of the rail's accessibility gaps are strings: what a live
// region says when a result list arrives, what a "Fill" button is called, what the
// scope slider is worth, and what id a vote status answers to. They live here so
// they can be asserted without a DOM, and so the component cannot quietly disagree
// with the sentence a screen reader is given.

/** A5 — search results arriving. The count lived in a static `aria-label`, which a
 *  screen reader reads only if you go looking for it; a live region says it. */
export function searchAnnouncement(q: string, count: number, shown: number): string {
  const query = q.trim()
  if (count === 0) return `No results for ${query || 'that search'}.`
  const rest = shown < count ? `, showing the closest ${shown}` : ''
  return `${count} result${count === 1 ? '' : 's'} for ${query || 'that search'}${rest}.`
}

/** A5 — a slot's candidates arriving (the second list the issue named). */
export function candidatesAnnouncement(slotLabel: string, count: number): string {
  if (count === 0) return `No candidates in reach for ${slotLabel}.`
  return `${count} candidate${count === 1 ? '' : 's'} for ${slotLabel}.`
}

/** A2 — the row's action is a button labelled "Fill", so a keyboard user who
 *  reached it was told nothing about WHICH place they were about to fill the slot
 *  with: the name sat in a sibling span that the button does not own. */
export function fillLabel(place: string, slotLabel: string): string {
  return `Fill ${slotLabel} with ${place}`
}

/** A8 — the slider's value lived in the <b> beside it. `aria-valuetext` is how the
 *  control states its own value, in words, at the step it is actually on. */
export function scopeValueText(km: number): string {
  return `${km} km from the route`
}

/** A6 — the vote status sits in its own element beside the toggle, so the toggle
 *  has to point at it. Sanitized because an id with a quote, colon or space in it
 *  either fails to resolve or is tokenized by `aria-describedby` into several
 *  ids that match nothing — and slot keys are not guaranteed to be tame. */
export function voteStatusId(slotKey: string): string {
  return `slot-vote-${slotKey.replace(/[^A-Za-z0-9_-]/g, '-')}`
}

/** A9 — the add modal preselects the day a hit's along-route km falls in. A hit
 *  with no road position cannot be placed, so the fallback to the first day is a
 *  GUESS: it was preselected in silence, with the reasoning living only in a code
 *  comment the user never sees. Say it in the modal instead, and stop saying it
 *  the moment the user picks a day themselves. */
export function pickDayCaveat(dayIndex: number, derivedFromRoute: boolean): string | null {
  if (derivedFromRoute) return null
  return `This place has no position on the route, so Day ${dayIndex + 1} is a guess — pick the day you want.`
}


/**
 * #416: the map and the rail can plan different scopes. The map's own chips
 * include "All days" while the rail always plans exactly one day, and nothing
 * said so — the map's choice simply did not reach the rail.
 *
 * The sentence is deliberately one-sided. It names both scopes and points at the
 * control (the map's day chips) rather than offering a trip-wide rail, because
 * the rail's slots are per-day by construction: fuel, meal and overnight halts
 * are scheduled inside a driving day, so a "whole trip" rail would have to invent
 * a scope the data does not have.
 *
 * `null` means MapTab has not been told what the map is showing yet — the rail
 * must say nothing rather than assert a mismatch nobody reported.
 */
export function mapScopeNote(mapFilter: number | 'all' | null, dayIndex: number): string | null {
  if (mapFilter !== 'all') return null
  return `The map is showing all days; this rail plans Day ${dayIndex + 1}. Use the map's day chips to match them.`
}