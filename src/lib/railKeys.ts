// ============ Map rail keyboard grammar (pure) ============
// The rail's result lists are keyboard-operable or they are not, and the part
// that decides is small enough to state once and test without a DOM (#333 A1).
//
// The repo already had this grammar in `LocationInput.tsx` — ArrowDown/ArrowUp
// move a highlight, Enter commits, Escape dismisses. The map rail had only an
// Enter branch, so Space scrolled the page instead of pinning and the arrow keys
// did nothing at all. This is that grammar as a value, so the row handler, the
// focus ring and the tests all agree on what a key means.
//
// `highlight` is the index of the row that currently owns the roving tabIndex;
// -1 means "nothing highlighted yet", which the first ArrowDown turns into row 0
// rather than row 1 — pressing Down once must land on the first row, not skip it.
//
// Pure and node-testable: no DOM, no React.

export type RailKeyAction =
  | { type: 'move'; highlight: number }
  | { type: 'pin' }
  | { type: 'clear' }
  | { type: 'none' }

export interface RailKeyOpts {
  /** Index of the row holding the roving tabIndex, or -1 for none. */
  highlight: number
  /** How many rows the list currently shows. */
  count: number
}

/** What a key press means for a rail result list. `none` means "not our key" —
 *  the caller must leave the event alone so typing in the search box still
 *  works and Space still scrolls where scrolling is right. */
export function railKeyAction(key: string, opts: RailKeyOpts): RailKeyAction {
  const count = Math.max(0, Math.floor(opts.count))
  if (count === 0) return { type: 'none' }
  const last = count - 1
  const at = Math.min(Math.max(Math.floor(opts.highlight), -1), last)
  switch (key) {
    case 'ArrowDown':
      return { type: 'move', highlight: at < 0 ? 0 : Math.min(at + 1, last) }
    case 'ArrowUp':
      return { type: 'move', highlight: at < 0 ? last : Math.max(at - 1, 0) }
    // Enter commits and Space commits too — the listbox pattern — but their CALLER
    // must preventDefault on Space, or the page scrolls under the pin it just made.
    case 'Enter':
    case ' ':
      return { type: 'pin' }
    case 'Escape':
      return { type: 'clear' }
    default:
      return { type: 'none' }
  }
}
