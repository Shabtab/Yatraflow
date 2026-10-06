// ============ Map search listbox keys (#576) ============
// The listbox label has always told the user to "Use the arrow keys to move
// between them, then Enter to select one" — but the row handler carried one
// branch (the two commit keys) and the roving tabIndex kept every other row
// out of the tab order. Results 2+ were reachable by mouse only. These pins
// make the label and the handler stay in step: the shared grammar
// (lib/railKeys) must reach the list, and the highlight must move over the
// rows the user can see.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { railKeyAction } from '../src/lib/railKeys'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const omnibarSrc = readFileSync(join(root, 'src', 'pages', 'trip', 'MapOmnibar.tsx'), 'utf8')

describe('MapOmnibar keeps the keyboard promise its label makes (#576)', () => {
  it('the label and the grammar import stay in step', () => {
    // The label is the promise. The import is the proof the code can keep it.
    // Pin both here so neither can drift alone.
    expect(omnibarSrc).toMatch(/Use the arrow keys to move between them/)
    expect(omnibarSrc).toMatch(/import \{ railKeyAction \} from '\.\.\/\.\.\/lib\/railKeys'/)
    expect(omnibarSrc).toMatch(/railKeyAction\(/)
  })

  it('the row handler runs the shared grammar over the visible slice', () => {
    // `count: rows.length` sizes the move against the PAGE-limited view. A
    // count taken from `results.length` can point past the rows on screen.
    expect(omnibarSrc).toMatch(/railKeyAction\(e\.key, \{ highlight: rowIndex, count: rows\.length \}\)/)
    // The branch this replaces: the two commit keys and nothing else. With it
    // present, no arrow key can reach the grammar at all.
    expect(omnibarSrc).not.toMatch(/e\.key === 'Enter'/)
    // A key the list does not own stays unclaimed. Every claimed key must be
    // preventDefault-ed, or Space scrolls the page under the row it selects.
    expect(omnibarSrc).toMatch(/if \(action\.type === 'none'\) return\r?\n\s*e\.preventDefault\(\)/)
  })

  it('the highlight owns the roving tabIndex and carries focus with it', () => {
    // Exactly one row holds the tab stop, and it is the row the arrow keys
    // last moved to — not the row the mouse once picked.
    expect(omnibarSrc).toMatch(/tabIndex=\{rowIndex === roving \? 0 : -1\}/)
    // A move that changes only state leaves focus behind. The next keypress
    // would then land on the old row while the label says otherwise.
    expect(omnibarSrc).toMatch(/data-row-index=\{rowIndex\}/)
    expect(omnibarSrc).toMatch(/el\.focus\(\)/)
    // Fresh results and a show-all toggle reset the highlight (the issue's
    // pitfall): the stored mark carries the slice it indexes, and a mark that
    // no longer matches the visible rows reads as no highlight at all.
    expect(omnibarSrc).toMatch(/mark\.rows === rows \? mark\.highlight : -1/)
  })

  it('the first ArrowDown lands on row 0 and the last row holds', () => {
    // The -1 to 0 rule: pressing Down once must land on the first row, and
    // never skip it. These drive the grammar the way the list drives it.
    expect(railKeyAction('ArrowDown', { highlight: -1, count: 5 })).toEqual({ type: 'move', highlight: 0 })
    expect(railKeyAction('ArrowUp', { highlight: -1, count: 5 })).toEqual({ type: 'move', highlight: 4 })
    // Five visible rows: the move clamps at the last one in the slice.
    expect(railKeyAction('ArrowDown', { highlight: 4, count: 5 })).toEqual({ type: 'move', highlight: 4 })
  })
})
