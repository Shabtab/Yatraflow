/**
 * #420, slice 1 — the shortlist tray as its own module.
 *
 * The rail collects, the tray decides: this is the bar that says how many places
 * are waiting and offers the three things that can happen to them. It owns no
 * state — the actions and the list live in `MapTab` (the next slice moves them into
 * a hook) — so what a reader has to review here is exactly the surface a user sees.
 */
export function ShortlistTray({
  count,
  busy,
  onAddAll,
  onVote,
  onClear,
}: {
  count: number
  /** a batch action is in flight; both writers disable together */
  busy: boolean
  onAddAll: () => void
  onVote: () => void
  onClear: () => void
}) {
  if (count === 0) return null
  return (
    <div className="poi-tray" role="region" aria-label="Shortlisted stops">
      <span className="poi-tray-n">{count} shortlisted</span>
      <span className="poi-tray-actions">
        <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={onAddAll}>Add all</button>
        <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={onVote}>Send to a vote</button>
        {/* Clear stays live while a batch runs: it only empties the collection,
            and the writers re-validate what they were handed. */}
        <button className="btn btn-ghost btn-sm" type="button" onClick={onClear}>Clear</button>
      </span>
    </div>
  )
}
