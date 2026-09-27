// ============ The narrow-band planning sheet (#415) ============
// Below 1279px the Map tab's three-column grid collapses to one column and both
// rails stack under the map, so comparing a pin with a candidate means scrolling
// between them. The rails become a sheet that shows ONE at a time, switched by a
// line that only exists in that band.
//
// WHY THIS IS A MODE AND NOT A MEDIA QUERY. The obvious CSS shape -- a second
// narrow-band block (`max-width: 1278px`) that hides the inactive rail -- breaks two
// rules this repo already paid for: `tests/stage2-p1.test.ts` asserts there is
// exactly ONE such block (the #156 reset must stay last among the folded-rail
// rules), and the design-system ratchet is keyed on line numbers, so folding new
// rules into that block mid-file would force a re-baseline of findings that did not
// change. So the band is decided in JS (`sheetAppliesAt`) and the hiding class can
// never be applied at desktop width. The CSS rule for it is therefore unconditional
// and safe: a class that never appears cannot hide a column.
//
// WHY TWO TABS AND NOT THREE. The audit's guide asked for Needs / Sights / Search.
// This tab has exactly three sections: the map, the needs rail and the sights rail.
// The corridor search is not a fourth section -- it lives INSIDE the needs rail --
// so a "Search" tab would be an empty panel advertising a surface that does not
// exist. If search ever becomes its own section it becomes a third entry here.
//
// Pure and DOM-free so it is testable in this repo's node env; MapTab owns the one
// browser listener and renders only what these return.
export interface SheetTab {
  key: 'needs' | 'see'
  /** the words on the switcher -- also its accessible name */
  label: string
  /** the id of the section this tab shows (an existing id on the column, not a new one) */
  panelId: string
}

/** The widest viewport that still stacks the rails under the map (the #156 band). */
export const SHEET_MAX_WIDTH = 1278

export const SHEET_TABS: SheetTab[] = [
  { key: 'needs', label: 'Needs', panelId: 'rail-needs' },
  { key: 'see', label: 'Sights & extras', panelId: 'rail-see' },
]

export type SheetTabKey = (typeof SHEET_TABS)[number]['key']

/** The tab a key refers to, or the first tab for anything unrecognised. */
export function sheetTabFor(key: string | null | undefined): SheetTabKey {
  return SHEET_TABS.some(t => t.key === key) ? (key as SheetTabKey) : SHEET_TABS[0].key
}

/**
 * Whether the sheet is in play at this viewport width. `null` (or anything that is
 * not a finite number) means the width is not known yet -- the first render, before
 * the listener runs -- and answers false. The rail must not be hidden on a guess, so
 * an unmeasured width renders the desktop layout and the sheet appears once the width
 * is real.
 */
export function sheetAppliesAt(width: number | null | undefined): boolean {
  return typeof width === 'number' && Number.isFinite(width) && width <= SHEET_MAX_WIDTH
}

/**
 * The class that hides a rail while its tab is elsewhere. It returns '' unless the
 * sheet actually applies, so the class cannot reach a desktop column even if the tab
 * state says otherwise -- belt and braces with the JSX conditional.
 */
export function sheetHiddenClass(tabKey: SheetTabKey, activeKey: SheetTabKey, applies: boolean): string {
  return applies && tabKey !== activeKey ? ' is-sheet-hidden' : ''
}

/**
 * Standard roving-tabindex movement for the switcher: Left/Right wrap around the
 * tabs, Home/End jump to the ends. Returns null for every key the control does not
 * own, so the caller leaves the event alone -- that is what stops a sheet switcher
 * from eating the page's scroll keys.
 */
export function sheetTabMove(current: SheetTabKey, key: string, count = SHEET_TABS.length): SheetTabKey | null {
  if (count <= 0) return null
  const i = SHEET_TABS.findIndex(t => t.key === current)
  const at = i < 0 ? 0 : i
  if (key === 'ArrowRight') return SHEET_TABS[(at + 1) % count].key
  if (key === 'ArrowLeft') return SHEET_TABS[(at - 1 + count) % count].key
  if (key === 'Home') return SHEET_TABS[0].key
  if (key === 'End') return SHEET_TABS[count - 1].key
  return null
}