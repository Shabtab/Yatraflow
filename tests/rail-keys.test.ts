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
import { railKeyAction } from '../src/lib/railKeys'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mapTabSrc = readFileSync(join(root, 'src', 'pages', 'trip', 'MapTab.tsx'), 'utf8')

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
    expect(mapTabSrc).toMatch(/role="listbox"/)
    expect(mapTabSrc).toMatch(/role="option"/)
    // The invalid pairing the issue named: listitem + aria-selected announces
    // static text, so a screen reader never says the row is selectable.
    expect(mapTabSrc).not.toMatch(/role="listitem"/)
  })

  it('rows run the shared grammar and keep a roving tabIndex', () => {
    expect(mapTabSrc).toMatch(/railKeyAction\(/)
    // Roving, not every-row-tabbable: exactly one row owns the tab stop, and the
    // first row owns it while nothing is highlighted so the list is still enterable.
    expect(mapTabSrc).toMatch(/tabIndex=\{[^}]*\? 0 : -1\}/)
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

describe('the rail states scope in words, and keeps nothing unreachable (#333 A4, A7)', () => {
  it('A4: the rotating tip dots are indicators, not unreachable buttons', () => {
    // They were <button onClick tabIndex={-1}> inside an aria-hidden container:
    // clickable, unreachable by keyboard, 8px wide, and hidden below 720px. The
    // strip rotates on its own and screen readers get a static summary instead
    // (#168), so the dots carry no control at all now.
    expect(mapTabSrc).toMatch(/engine-tips-dots" aria-hidden="true"/)
    expect(mapTabSrc).toMatch(/<span key=\{i\} className=\{`engine-tips-dot/)
    // No control anywhere in the rail may opt itself out of the tab order —
    // that is the shape of "focusable things a keyboard cannot reach".
    expect(mapTabSrc).not.toMatch(/tabIndex=\{-1\}/)
    expect(mapTabSrc).not.toMatch(/engine-tips-dot[^>]*onClick/)
  })

  it('A7: an out-of-scope row is never dimmed, and says why in words', () => {
    // opacity 0.6 washed out text already near the contrast floor AND made the
    // row's own action buttons read as disabled while they were still pressable.
    expect(mapTabSrc).not.toMatch(/opacity: inScope \? undefined : 0\.6/)
    expect(mapTabSrc).toMatch(/chip chip-saffron[^>]*>beyond your detour scope</)
    // the phrase must not still be trailing the muted comma-run
    expect(mapTabSrc).not.toMatch(/, beyond your detour scope'/)
  })
})
