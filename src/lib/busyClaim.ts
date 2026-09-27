// ============ One busy claim per crew-signal row (#394) ============
//
// Group Input's crew signals — Resolve on a decision, Add to timeline / Decline
// on a suggestion — write straight to the store *synchronously*: the cache
// patches and notifies inside the call, and only the network tail (`fire()`)
// is deferred. Nothing in that shape serializes two clicks, so the guard has
// to be UI state claimed in the handler BEFORE the store write — a fast second
// click can be dispatched while the first one's re-render is still painting
// through, and on a loaded main thread it can beat React's commit.
//
// The claim is deliberately NOT held for the network: `fire()` is best-effort
// by design, so releasing on it would strand a disabled button after a failed
// write. The row releases it instead — the store write spends the row
// synchronously (the decision resolves, the suggestion is accepted or
// declined), the buttons that carried the claim unmount with it, and nothing
// is left to release. There is no network-tail release to add, and a reader
// tempted by one would only build a stuck button.
//
// A claim is per ROW KEY, so one card's Resolve never disables a different
// card's buttons.

/** Keys of the rows whose crew signal is mid-flight. */
export type BusyClaim = ReadonlySet<string>

/** Is this row mid-signal? Drives the buttons' disabled attribute. */
export function isClaimed(claims: BusyClaim, key: string): boolean {
  return claims.has(key)
}

/** Take the row's claim. `claimed` is false when the row is already mid-signal,
 *  and the caller drops the click in that case — which is what makes a
 *  double-click impossible-feeling rather than merely harmless. The claims set
 *  is returned unchanged when refused, so a refused click can never leak a
 *  claim the row does not hold. */
export function takeClaim(claims: BusyClaim, key: string): { claimed: boolean; claims: BusyClaim } {
  if (claims.has(key)) return { claimed: false, claims }
  return { claimed: true, claims: new Set(claims).add(key) }
}
