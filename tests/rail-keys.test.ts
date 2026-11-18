// ============ The map rail's key grammar (#333 A1) ============
// The old row handler had one branch — Enter, and only when the row itself was
// the event target — so Space scrolled the page instead of pinning the place and
// no key moved between rows. These pin the replacement: what each key means, what
// "nothing highlighted yet" means, and that a key the list does not own stays
// unclaimed so typing and normal paging keep working.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { railKeyAction } from '../src/lib/railKeys'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const omniSrc = readFileSync(join(root, 'src', 'pages', 'trip', 'MapOmnibar.tsx'), 'utf8').replace(/\r\n/g, '\n')
const mapTabSrc = readFileSync(join(root, 'src', 'pages', 'trip', 'MapTab.tsx'), 'utf8')

// A source-string guard cannot tell a control from a container, and a raw
// regex stops at the arrow token in an earlier attribute. Read the TSX AST.
const INTERACTIVE_TAGS = new Set(['button', 'input', 'select', 'textarea', 'a', 'summary'])
const INTERACTIVE_ROLES = new Set(['button', 'link'])

const attrOf = (el: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string): ts.JsxAttribute | undefined =>
  el.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && ts.isIdentifier(a.name) && a.name.text === name)

const stringAttr = (el: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string): string | null => {
  const init = attrOf(el, name)?.initializer
  if (!init) return null
  if (ts.isStringLiteralLike(init)) return init.text
  if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression)) return init.expression.text
  return null
}

/** True when a JSX tabIndex initializer is the literal -1. */
const isNegativeOne = (el: ts.JsxOpeningElement | ts.JsxSelfClosingElement): boolean => {
  const init = attrOf(el, 'tabIndex')?.initializer
  if (!init) return false
  if (ts.isStringLiteralLike(init)) return init.text === '-1'
  if (!ts.isJsxExpression(init) || !init.expression) return false
  const e = init.expression
  return ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.MinusToken
    && ts.isNumericLiteral(e.operand) && e.operand.text === '1'
}

/** Native interactive controls, or any element with role button/link. Custom
 *  components are outside this source guard; a separate a11y review covers them. */
const isInteractive = (el: ts.JsxOpeningElement | ts.JsxSelfClosingElement): boolean => {
  const tag = el.tagName.getText()
  if (/^[a-z]/.test(tag) && INTERACTIVE_TAGS.has(tag)) return true
  const role = stringAttr(el, 'role')
  return role != null && INTERACTIVE_ROLES.has(role)
}

/** Interactive JSX controls that opt out of the tab order. */
function unreachableControls(source: string): { tag: string; line: number }[] {
  const sf = ts.createSourceFile('fixture.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: { tag: string; line: number }[] = []
  const visit = (n: ts.Node): void => {
    const el = ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n) ? n : null
    if (el && isInteractive(el) && isNegativeOne(el)) {
      found.push({ tag: el.tagName.getText(), line: sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1 })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return found
}

describe('railKeyAction', () => {
  const count = 5

  it('moves the highlight down and up one row', () => {
    expect(railKeyAction('ArrowDown', { highlight: 1, count })).toEqual({ type: 'move', highlight: 2 })
    expect(railKeyAction('ArrowUp', { highlight: 3, count })).toEqual({ type: 'move', highlight: 2 })
  })

  it('clamps at both ends instead of wrapping off the list', () => {
    expect(railKeyAction('ArrowDown', { highlight: 4, count })).toEqual({ type: 'move', highlight: 4 })
    expect(railKeyAction('ArrowUp', { highlight: 0, count })).toEqual({ type: 'move', highlight: 0 })
  })

  it('the first ArrowDown lands on the FIRST row, not the second', () => {
    // -1 is "nothing highlighted": treating it as an index would make the first
    // press skip row 1, which is the classic off-by-one in this pattern.
    expect(railKeyAction('ArrowDown', { highlight: -1, count })).toEqual({ type: 'move', highlight: 0 })
  })

  it('the first ArrowUp from nothing lands on the LAST row', () => {
    // Up from the search box means "the nearest thing above me" — the bottom of
    // the list, which is where the eye already is after typing.
    expect(railKeyAction('ArrowUp', { highlight: -1, count })).toEqual({ type: 'move', highlight: 4 })
  })

  it('Enter and Space both pin', () => {
    expect(railKeyAction('Enter', { highlight: 2, count })).toEqual({ type: 'pin' })
    expect(railKeyAction(' ', { highlight: 2, count })).toEqual({ type: 'pin' })
  })

  it('Escape clears, and unknown keys stay unclaimed', () => {
    expect(railKeyAction('Escape', { highlight: 2, count })).toEqual({ type: 'clear' })
    // Typing in the search box, Tab, PageDown: none of these are the list's to take.
    for (const key of ['a', 'Tab', 'PageDown', 'Home', 'End']) {
      expect(railKeyAction(key, { highlight: 2, count }), `${key} must stay unclaimed`).toEqual({ type: 'none' })
    }
  })

  it('an empty list claims nothing, whatever the key', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Escape']) {
      expect(railKeyAction(key, { highlight: 0, count: 0 })).toEqual({ type: 'none' })
    }
  })

  it('an out-of-range highlight is clamped before it is moved', () => {
    // A list that shrank under the user (a query narrowed) must not produce an
    // index the caller then reads out of bounds.
    expect(railKeyAction('ArrowDown', { highlight: 99, count: 3 })).toEqual({ type: 'move', highlight: 2 })
    expect(railKeyAction('ArrowDown', { highlight: -99, count: 3 })).toEqual({ type: 'move', highlight: 0 })
  })
})

describe('the rail uses that grammar, not a one-branch Enter handler', () => {
  it('the search list is a listbox whose rows are options', () => {
    expect(omniSrc).toMatch(/role="listbox"/)
    expect(omniSrc).toMatch(/role="option"/)
    // The invalid pairing the issue named: listitem + aria-selected announces
    // static text, so a screen reader never says the row is selectable.
    expect(mapTabSrc).not.toMatch(/role="listitem"/)
  })

  it('rows run the shared grammar and keep a roving tabIndex', () => {
    expect(omniSrc).toMatch(/railKeyAction\(/)
    // Roving, not every-row-tabbable: exactly one row owns the tab stop, and the
    // first row owns it while nothing is highlighted so the list is still enterable.
    expect(omniSrc).toMatch(/tabIndex=\{[^}]*\? 0 : -1\}/)
    expect(mapTabSrc).not.toMatch(/aria-selected=\{selected\} tabIndex=\{0\}/)
  })

  it('hover no longer fights the reader for scroll position (A3)', () => {
    // The activation effect must be gated on a keyboard/focus flag: every mouse
    // hover used to yank the list back to the active row.
    const effect = /useEffect\(\(\) => \{\s*if \(activeHitId == null\) return[\s\S]*?\}, \[activeHitId\]\)/.exec(mapTabSrc)
    expect(effect, 'the activeHitId scroll effect is missing or reshaped').not.toBeNull()
    expect(effect![0]).toContain('keyboardScrollRef.current')
  })
})

describe('A4 guard reads the TSX AST, not a raw source regex', () => {
  const bad = [
    { label: 'the original #333 A4 button', source: '<button onClick={h} tabIndex={-1}>x</button>' },
    { label: 'an arrow callback before tabIndex', source: '<button onClick={() => act()} tabIndex={-1}>x</button>' },
    { label: 'a multiline arrow callback', source: '<button\n  onClick={() => act()}\n  tabIndex={-1}\n>x</button>' },
    { label: 'tabIndex before the handler', source: '<button tabIndex={-1} onClick={() => act()}>x</button>' },
    { label: 'a self-closing input', source: '<input tabIndex={-1} />' },
    { label: 'summary', source: '<summary tabIndex={-1}>x</summary>' },
    { label: 'a string -1 initializer', source: '<button tabIndex="-1">x</button>' },
    { label: 'an explicit role button', source: '<div role="button" tabIndex={-1}>x</div>' },
    { label: 'an explicit role link', source: '<span role="link" tabIndex={-1}>x</span>' },
  ]
  const legal = [
    { label: 'a non-interactive sheet panel region', source: '<div tabIndex={-1} className="poi-col" id="rail-see"></div>' },
    { label: 'a roving tabIndex expression', source: '<button tabIndex={row === active ? 0 : -1}>x</button>' },
    { label: 'a zero tab stop', source: '<button tabIndex={0}>x</button>' },
    { label: 'a plain group role', source: '<div role="group" tabIndex={-1}></div>' },
    { label: 'a custom component outside this guard', source: '<MyControl tabIndex={-1} />' },
  ]

  it('flags every interactive control shape with a negative tabIndex', () => {
    for (const c of bad) expect(unreachableControls(c.source), c.label).not.toEqual([])
  })

  it('allows non-interactive regions, roving tabIndex and custom components', () => {
    for (const c of legal) expect(unreachableControls(c.source), c.label).toEqual([])
  })

  it('finds no interactive control with tabIndex -1 in MapTab', () => {
    expect(unreachableControls(mapTabSrc)).toEqual([])
  })
})

describe('the rail states scope in words, and keeps nothing unreachable (#333 A4, A7)', () => {
  it('A4: the Map tab keeps no rotating tip strip and no unreachable control', () => {
    // The tip strip hid behind an info button and served no purpose, so it is gone.
    // The live suggestion states (over limit, rain, empty, failed) sit on the deck top.
    expect(mapTabSrc).not.toContain('engine-tips')
    expect(mapTabSrc).toContain('{deckStatus}')
    // No keyboard-reachable control may opt itself out of the tab order. A sheet
    // panel region is not a control, so it may carry a negative tabIndex.
    expect(unreachableControls(mapTabSrc)).toEqual([])
  })

  it('A7: an out-of-scope row is never dimmed, and says why in words', () => {
    // opacity 0.6 washed out text already near the contrast floor AND made the
    // row's own action buttons read as disabled while they were still pressable.
    expect(mapTabSrc).not.toMatch(/opacity: inScope \? undefined : 0\.6/)
    expect(omniSrc).toContain('className="chip chip-saffron"')
    expect(omniSrc).toContain("'Beyond your detour scope'")
    expect(omniSrc).not.toMatch(/opacity: inScope/)
    // the phrase must not still be trailing the muted comma-run
    expect(mapTabSrc).not.toMatch(/, beyond your detour scope'/)
  })
})
