// ============ The narrow-band planning sheet (#415) ============
// Below 1279px the Map tab's three-column grid collapsed to one column with both
// rails stacked under the map, so comparing a pin with a candidate meant scrolling
// between them. The rails are now one sheet at a time behind a one-line switcher.
//
// These pin the model AND the four ways this could quietly ruin the desktop layout:
// the band being decided by a second media query, `is-sheet-hidden` reaching a
// desktop column, the switcher rendering outside the band, and the three-column grid
// being "simplified" away while fixing the narrow case.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SHEET_MAX_WIDTH, SHEET_TABS, sheetAppliesAt, sheetHiddenClass, sheetTabFor, sheetTabMove } from '../src/lib/mapSheet'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tab = readFileSync(join(root, 'src', 'pages', 'trip', 'MapTab.tsx'), 'utf8')
// #420 slice 12: the sheet state and its measure effect live in the rail-view hook.
const hook = readFileSync(join(root, 'src', 'pages', 'trip', 'map', 'useRailView.ts'), 'utf8')
const css = readFileSync(join(root, 'src', 'styles.css'), 'utf8')

describe('the sheet tab model (A415)', () => {
  it('offers exactly the sections that exist, and points at their real ids', () => {
    expect(SHEET_TABS.map(t => t.key)).toEqual(['needs', 'see'])
    expect(SHEET_TABS.map(t => t.panelId)).toEqual(['rail-needs', 'rail-see'])
    for (const t of SHEET_TABS) expect(t.label.trim().length).toBeGreaterThan(0)
    expect(tab).toContain('id="rail-needs"')
    expect(tab).toContain('id="rail-see"')
  })

  it('falls back to the first tab for anything unrecognised', () => {
    expect(sheetTabFor('see')).toBe('see')
    expect(sheetTabFor('nonsense')).toBe('needs')
    expect(sheetTabFor(null)).toBe('needs')
    expect(sheetTabFor(undefined)).toBe('needs')
  })

  it('is in play only inside the band the CSS already stacks at', () => {
    expect(SHEET_MAX_WIDTH).toBe(1278)
    for (const w of [360, 768, 1024, 1278]) expect(sheetAppliesAt(w), `${w}px`).toBe(true)
    for (const w of [1279, 1440, 2560]) expect(sheetAppliesAt(w), `${w}px`).toBe(false)
  })

  it('refuses to act on an unmeasured width', () => {
    expect(sheetAppliesAt(null)).toBe(false)
    expect(sheetAppliesAt(undefined)).toBe(false)
    expect(sheetAppliesAt(Number.NaN)).toBe(false)
  })

  it('hides only the rails whose tab is elsewhere, and only in the band', () => {
    expect(sheetHiddenClass('needs', 'needs', true)).toBe('')
    expect(sheetHiddenClass('see', 'see', true)).toBe('')
    expect(sheetHiddenClass('needs', 'see', true)).toBe(' is-sheet-hidden')
    expect(sheetHiddenClass('see', 'needs', true)).toBe(' is-sheet-hidden')
    // the class cannot reach a desktop column at all
    expect(sheetHiddenClass('needs', 'see', false)).toBe('')
    expect(sheetHiddenClass('see', 'needs', false)).toBe('')
  })

  it('moves the switcher with the arrow keys and wraps at both ends', () => {
    expect(sheetTabMove('needs', 'ArrowRight')).toBe('see')
    expect(sheetTabMove('see', 'ArrowRight')).toBe('needs')
    expect(sheetTabMove('needs', 'ArrowLeft')).toBe('see')
    expect(sheetTabMove('see', 'ArrowLeft')).toBe('needs')
    expect(sheetTabMove('see', 'Home')).toBe('needs')
    expect(sheetTabMove('needs', 'End')).toBe('see')
  })

  it('claims no key it does not own, so it cannot eat page scroll', () => {
    for (const k of ['ArrowDown', 'ArrowUp', 'Escape', 'PageDown', 'a', 'Enter', ' ']) {
      expect(sheetTabMove('needs', k), `${k} must stay unclaimed`).toBeNull()
    }
  })
})

describe('MapTab renders the sheet (A415)', () => {
  it('renders the switcher only while the band is measured', () => {
    expect(tab).toMatch(/\{sheetApplies && \(\s*<div className="map-ideas-sheet-tabs"/)
    expect(hook).toMatch(/setSheetApplies\(sheetAppliesAt\(/)
  })

  it('is a pressed-state switcher, not inert tabs', () => {
    expect(tab).toMatch(/aria-pressed=\{sheetTab === t\.key\}/)
    expect(tab).toMatch(/aria-controls=\{t\.panelId\}/)
  })

  it('hides the inactive rail through the model, passing the band flag', () => {
    expect(tab).toMatch(/sheetHiddenClass\('needs', sheetTab, sheetApplies\)/)
    expect(tab).toMatch(/sheetHiddenClass\('see', sheetTab, sheetApplies\)/)
  })

  it('starts on a real tab', () => {
    expect(hook).toMatch(/useState<SheetTabKey>\('needs'\)/)
  })
})

describe('the CSS stays inside this repo\'s paid-for rules (A415)', () => {
  it('adds no second narrow-band block (stage2-p1 pins exactly one)', () => {
    expect(css.match(/@media \(max-width: 1278px\)/g)).toHaveLength(1)
  })

  it('keeps the hide rule outside every media query, as the mode requires', () => {
    const at = css.indexOf('.map-ideas-grid .poi-col.is-sheet-hidden { display: none; }')
    expect(at, 'the hide rule is missing').toBeGreaterThan(-1)
    expect(at).toBeGreaterThan(css.lastIndexOf('@media (max-width: 1278px)'))
  })

  it('leaves the desktop three-column layout exactly as it was', () => {
    expect(css).toMatch(/\.map-ideas-grid \{\s*display: grid;\s*grid-template-columns: 320px minmax\(0, 1fr\) 320px;/)
  })

  it('keeps the switcher chips on the touch floor and needs no motion opt-out', () => {
    expect(css).toContain('.map-ideas-sheet-tabs .chip { min-height: 40px; }')
    expect(css).not.toMatch(/\.map-ideas-sheet-tabs[^}]*animation:/)
  })
})
describe('the wiring is declared exactly once (A415)', () => {
  // Cost of learning this: the suite was green at 2533 while `tsc` -- which runs
  // LAST inside `npm run build` -- failed with duplicate identifiers, because a
  // second pass anchored on lines the first pass had already inserted. A regex
  // guard that reads "the wiring exists" cannot see a duplicate; these count.
  it('imports the sheet model once', () => {
    expect(tab.match(/from '\.\.\/\.\.\/lib\/mapSheet'/g)).toHaveLength(1)
  })

  it('declares the sheet state once', () => {
    expect(hook.match(/const \[sheetTab, setSheetTab\]/g)).toHaveLength(1)
    expect(hook.match(/const \[sheetApplies, setSheetApplies\]/g)).toHaveLength(1)
    expect(tab).toContain('} = useRailView(')
  })

  it('opens and closes the switcher conditional exactly once', () => {
    expect(tab.match(/\{sheetApplies && \(/g)).toHaveLength(1)
  })
})