/**
 * #420, slice 1 — the shortlist's ordering rule, lifted out of `MapTab` so it can
 * be tested without a DOM.
 *
 * The tray adds a shortlist in ROAD order: the promise printed in its own toast is
 * that the plan reads the way the drive does. A place the route cannot position
 * sorts LAST rather than first — an unplaceable hit must never be treated as the
 * trip's opening stop.
 *
 * Moved verbatim from `MapTab`'s `addShortlisted`, including its one subtlety: two
 * unplaceable hits compare `Infinity - Infinity`, which is `NaN`, and `Array.sort`
 * treats a `NaN` comparator result as "keep the order". That is the behaviour the
 * tray shipped with, so it is kept deliberately rather than "fixed" inside a
 * refactor that promises no behaviour change.
 */
export function orderByRoad<T extends { latitude: number; longitude: number }>(
  hits: readonly T[],
  kmOf: (lat: number, lng: number) => number | null,
): T[] {
  return [...hits].sort((a, b) =>
    (kmOf(a.latitude, a.longitude) ?? Number.POSITIVE_INFINITY) -
    (kmOf(b.latitude, b.longitude) ?? Number.POSITIVE_INFINITY),
  )
}
