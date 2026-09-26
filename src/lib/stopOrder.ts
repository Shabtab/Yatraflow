// ============ Stop order: one implementation of the day invariant ============
// The itinerary contract (src/lib/itinerarySpec.ts) is 1-based, CONTIGUOUS
// `orderInDay` per day. Four surfaces wrote orders independently — the store's
// stop mutators, the Timeline's delete/move handlers, the Map's fill, and the
// Board's own drop — and only the store renumbered: deleting a stop on the
// Timeline left `[1,3]`, the next add took `length + 1` = 3, and the day held
// two stops claiming position 3 (#337). A cross-day move that named no day
// spliced the source first and dropped the stop on the floor (#339).
//
// Every writer shares this module now, and it is pure — no store, no DOM — so
// the node-env suite can pin the rule the surfaces call.

import type { ItineraryDay, ItineraryStop, Trip } from '../data/types'

/** A locally minted id for a stop that is still being staged (the store hands
 *  it a real one when the change is kept). Platform CSPRNG, never
 *  `Math.random` — #267's presence-key lesson, applied to the stop add paths,
 *  which had each drifted onto the weak generator. `getRandomValues` (unlike
 *  `randomUUID`) also resolves outside a secure context. */
export function pendingStopId(): string {
  const rnd = new Uint32Array(2)
  globalThis.crypto.getRandomValues(rnd)
  return `pending_${rnd[0].toString(36)}${rnd[1].toString(36)}`
}

/** A day's stops in display order (stable: equal orders keep array order). */
export function stopsInOrder(day: ItineraryDay): ItineraryStop[] {
  return [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay)
}

/** A day's NON-REJECTED stops in display order — the list a surface that HIDES
 *  rejected rows (the Board) actually indexes into. The Timeline renders every
 *  stop, so it keeps using `stopsInOrder` directly. */
export function activeStopsInOrder(day: ItineraryDay): ItineraryStop[] {
  return stopsInOrder(day).filter(s => s.status !== 'rejected')
}

/** The position an add appends with. The contiguous count + 1 is only free
 *  once the day has been renumbered — that pairing is what makes the add's
 *  `length + 1` assumption true (see `renumberDay` below and #337). */
export function nextOrderInDay(day: ItineraryDay): number {
  return stopsInOrder(day).length + 1
}

/** Close the numbering: sort by order, assign 1..n by ARRAY order, and leave
 *  `day.stops` canonical (display order), so a later positional splice means
 *  what it says. */
export function renumberDay(day: ItineraryDay): void {
  const ordered = stopsInOrder(day)
  ordered.forEach((s, i) => { s.orderInDay = i + 1 })
  day.stops = ordered
}

/** The day that holds a stop, if any. */
export function dayHoldingStop(trip: Pick<Trip, 'days'>, stopId: string): ItineraryDay | undefined {
  return trip.days.find(d => d.stops.some(s => s.id === stopId))
}

/** The stop itself, wherever it lives. */
export function stopById(trip: Pick<Trip, 'days'>, stopId: string): ItineraryStop | undefined {
  for (const day of trip.days) {
    const stop = day.stops.find(s => s.id === stopId)
    if (stop) return stop
  }
  return undefined
}

/** Case/whitespace-insensitive title — the duplicate test the Map's picker and
 *  the suggestion rail already use, in one place. */
export function normalizeStopTitle(title: string | undefined): string {
  return (title ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Is a place of this name already on the trip? The dedupe behind "resolving a
 *  vote never adds a second copy of a place the plan already holds". */
export function hasStopNamed(trip: Pick<Trip, 'days'>, title: string): boolean {
  const wanted = normalizeStopTitle(title)
  if (!wanted) return false
  return trip.days.some(d => d.stops.some(s => normalizeStopTitle(s.title) === wanted))
}

/** Remove a stop from its day and close the numbering gap. Returns what was
 *  removed (the Undo payload) or null when the id is unknown — never a partial
 *  or silent drop. */
export function removeStopFromDay(trip: Pick<Trip, 'days'>, stopId: string): { stop: ItineraryStop; dayIndex: number } | null {
  for (const day of trip.days) {
    const at = day.stops.findIndex(s => s.id === stopId)
    if (at < 0) continue
    const [stop] = day.stops.splice(at, 1)
    renumberDay(day)
    return { stop, dayIndex: day.index }
  }
  return null
}

/** Shared core of both reorders below: clamp out-of-range indices (an OOB
 *  splice would insert `undefined` into the day and crash the simulator later —
 *  "bug #5"), treat from === to as a no-op, and refuse a missing stop. Returns
 *  whether the list changed. */
function spliceMove(list: ItineraryStop[], fromIdx: number, toIdx: number): boolean {
  const len = list.length
  if (len === 0) return false
  const from = Math.max(0, Math.min(Math.trunc(fromIdx), len - 1))
  const to = Math.max(0, Math.min(Math.trunc(toIdx), len))
  if (from === to) return false
  const [moved] = list.splice(from, 1)
  if (!moved) return false
  list.splice(to, 0, moved)
  return true
}

/** Reorder within one day, with indices into the FULL stop list — what the
 *  Timeline (which renders every stop) shows. The whole day is renumbered
 *  1..n. Returns whether anything moved. */
export function moveStopWithinDay(day: ItineraryDay, fromIdx: number, toIdx: number): boolean {
  const arr = stopsInOrder(day)
  if (!spliceMove(arr, fromIdx, toIdx)) return false
  arr.forEach((s, i) => { s.orderInDay = i + 1 })
  day.stops = arr
  return true
}

/** Reorder within one day, with indices into the ACTIVE list — the stops a
 *  surface that HIDES rejected rows actually shows (the Board). Rejected stops
 *  keep their slots; the WHOLE day is renumbered 1..n either way, because
 *  splicing only the visible list (the Board's old private remap) left hidden
 *  stops holding their old numbers — two stops could claim one position and the
 *  hidden one resurfaced mispositioned on the Timeline (#371). */
export function moveActiveStopWithinDay(day: ItineraryDay, fromIdx: number, toIdx: number): boolean {
  const active = activeStopsInOrder(day)
  if (!spliceMove(active, fromIdx, toIdx)) return false
  const rebuilt: ItineraryStop[] = []
  for (const s of stopsInOrder(day)) {
    if (s.status === 'rejected') rebuilt.push(s)
    else {
      const next = active.shift()
      if (next) rebuilt.push(next)
    }
  }
  rebuilt.forEach((s, i) => { s.orderInDay = i + 1 })
  day.stops = rebuilt
  return true
}

/** Where a stop with a known along-route km belongs among a day's ordered
 *  stops: before the first stop that sits FURTHER along the road. An unknown
 *  position appends — it cannot be ordered honestly, and dropping it is worse
 *  (the road order can be fixed by a reorder; a lost stop cannot). */
export function roadOrderInsertionIndex(
  ordered: ItineraryStop[],
  movedKm: number | null | undefined,
  kmOf: (s: ItineraryStop) => number | null | undefined,
): number {
  if (movedKm == null || !Number.isFinite(movedKm)) return ordered.length
  const at = ordered.findIndex(s => {
    const km = kmOf(s)
    return km != null && Number.isFinite(km) && km > movedKm
  })
  return at === -1 ? ordered.length : at
}

/**
 * Move a stop to another day — the ONE path the Timeline's drag, its move
 * modal and the Board share.
 *
 *  - A missing target day refuses and leaves the source untouched. The old
 *    Timeline handler spliced the source FIRST and then dropped `moved` when
 *    the target did not resolve, deleting the stop with no recovery (#339).
 *  - `position` is the drag's own insertion slot, clamped to the day's length.
 *  - Without a slot (the modal has no drop point) the stop is inserted by ROAD
 *    order through `kmOf`, matching what the Map's add-to-day does for a
 *    place with a route measurement; an unknown position appends.
 *  - Both days end contiguous, so the next add cannot mint a duplicate order.
 */
export function moveStopToDay(
  days: ItineraryDay[],
  stopId: string,
  toDayIndex: number,
  position: number | null,
  kmOf?: (s: ItineraryStop) => number | null | undefined,
): boolean {
  // Resolve the destination FIRST: an unknown day is an abort, never a delete.
  const target = days.find(d => d.index === toDayIndex)
  if (!target) return false
  let moved: ItineraryStop | undefined
  let source: ItineraryDay | undefined
  for (const day of days) {
    const at = day.stops.findIndex(s => s.id === stopId)
    if (at >= 0) { [moved] = day.stops.splice(at, 1); source = day; break }
  }
  if (!moved) return false
  const ordered = stopsInOrder(target)
  const at = position == null
    ? roadOrderInsertionIndex(ordered, kmOf?.(moved) ?? null, kmOf ?? (() => null))
    : Math.max(0, Math.min(Math.trunc(position), ordered.length))
  ordered.splice(at, 0, moved)
  ordered.forEach((s, i) => { s.orderInDay = i + 1 })
  target.stops = ordered
  // Same-day moves renumber the one day; cross-day moves close the source gap
  // too, so neither side keeps a hole its next add would collide with.
  if (source && source !== target) renumberDay(source)
  return true
}
