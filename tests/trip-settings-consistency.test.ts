// P12 — Trip settings tab consistency pins.
//
// These are source and stylesheet pins, the same shape the Share tab uses. They
// hold the decisions this pass made: the panels render through the shared
// Surface, the section titles read R20, the in-flight save is its own block, and
// the static inline styles are gone.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const code = readFileSync(join(process.cwd(), 'src/pages/trip/TripSettingsForm.tsx'), 'utf8')
const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')

/** The sheet with every @media block removed. The duplicate-selector gate reads
 *  top-level rules only, so a rule inside a media query is not a duplicate. The
 *  settings sheet already restates `.tsx-card` and `.tsx-q` at 760px. */
const topLevel = css.replace(/@media[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
const countTopLevel = (selector: string) => [...topLevel.matchAll(new RegExp(`^\\s*${selector.replace('.', '\\.')}\\s*\\{`, 'gm'))].length

describe('P12 — the panels sit on the shared card skin', () => {
  it('every panel renders through Surface, and none is a bare section', () => {
    // Five, not four: the Mixed driving answer became its own panel in 2026-10-19,
    // so it can sit next to the mode panel without a wheel it may never use.
    expect([...code.matchAll(/<Surface as="section" className="tsx-card/g)]).toHaveLength(5)
    expect(code).not.toMatch(/<section className="tsx-card/)
    expect(code).toContain("import { Surface } from '../../components/page/Surface'")
  })

  it('the panel aria-labels survive the move to Surface', () => {
    expect(code).toContain('aria-label="Trip name and cover"')
    expect(code).toContain('aria-label="Where does it go, and for how many days"')
    expect(code).toContain('aria-label="Who is going, and how do they split the money"')
    // The Mixed question has no wheel behind it yet, so it says who drives and
    // stops there. The older wording stays on the driving branch.
    expect(code).toContain('aria-label="Will you drive any part of this trip?"')
    expect(code).toContain("'What moves you, and who is behind the wheel' : 'What moves you'")
  })

  it('a passenger mode never announces a wheel it does not have', () => {
    // The neutral label is chosen, not dropped: a screen reader must not be told
    // about a driver on a bus trip.
    expect(code).not.toContain('aria-label="What moves you"')
  })

  it('the skin is restated as a same-element compound, so it wins in any order (R5)', () => {
    expect(css).toMatch(/\.yf-surface\.tsx-card \{ border-radius: var\(--radius\); box-shadow: var\(--shadow-card\); animation: cardIn/)
  })
})

describe('P12 — the section titles read R20', () => {
  it('the shared rule is the R20 one, as a descendant so no second .tsx-q exists', () => {
    expect(css).toMatch(/\.tsx-card \.tsx-q \{ font-family: var\(--font-body\); font-size: 18px; font-weight: 800; line-height: 1\.3; letter-spacing: 0; color: var\(--text\); \}/)
    // One top-level `.tsx-q` rule in the whole sheet: the original. A second
    // would be a duplicate-selector violation. The 760px restatement does not
    // count: the gate reads top-level rules only, and the descendant selector
    // outranks it anyway.
    expect(countTopLevel('.tsx-q')).toBe(1)
  })

  it('no title sets its own font size inline', () => {
    expect(code).not.toMatch(/<h3 className="tsx-q"[^>]*style=/)
  })
})

describe('P12 — the in-flight save is its own block (R22, R23)', () => {
  it('a save in flight renders a compact loading block', () => {
    expect(code).toMatch(/\{savingSettings && \(\s*<div className="set-save-state">\s*<StateBlock kind="loading" size="compact" title="Saving your settings\." \/>/)
  })

  it('a refused save keeps the alert role it had', () => {
    expect(code).toContain('{writeErr && <span className="err-text" role="alert">{writeErr}</span>}')
  })

  it('the three field-level roles stay exactly where they were', () => {
    expect(code).toContain('<p className="hint-text set-start-notice" role="status">{startNotice}</p>')
    expect(code).toContain('<div className="ts-save-refusal" role="alert">')
    expect(code).toContain('<div className="bench-receipt card ts-receipt-refusal" role="status">')
    expect(code).toContain('<span className="ts-savebar-note hint-text" role="status">')
  })
})

describe('P12 — the static inline styles are gone', () => {
  it('no static value stays inline; only data-driven ones do', () => {
    // The remaining inline styles all read a value from data: the reorder
    // opacity, the day-grid width, the health-bar width and the score width.
    const inline = [...code.matchAll(/style=\{\{[^}]*\}\}/g)].map(m => m[0])
    for (const s of inline) {
      expect(s, `static inline style left: ${s}`).toMatch(/\$\{|opacity|width/)
    }
  })

  it('the values that moved carry the same number they had', () => {
    expect(css).toContain('.set-daygrid-label { display: block; margin-bottom: 6px; }')
    expect(css).toContain('.set-start-notice { margin-top: 6px; }')
    expect(css).toContain('.set-receipt-reason { margin-top: 8px; }')
    expect(css).toContain('.set-bench-line-top { margin-top: 8px; }')
    expect(css).toContain('.set-bench-total-cap { max-width: 96px; }')
    expect(css).toContain('.set-read-gap { gap: 14px; }')
    expect(css).toContain('.set-read-score { font-size: 38px; }')
    expect(css).toContain('.set-read-bar { flex: 1; }')
    expect(css).toContain('.set-read-reasons { margin: 0; }')
  })

  it('no new class names the health-band vocabulary, which tests/health-band.test.ts reads', () => {
    // The engine-read block is the health block. A `set-health-*` class would
    // land in healthSelectors() and read as a new band, so the names avoid it.
    expect(css).not.toMatch(/\.set-health-/)
  })
})

describe('P12 — the motion is the catalog motion', () => {
  it('the panel entrance uses the tokens and no raw duration', () => {
    expect(css).toMatch(/\.yf-surface\.tsx-card \{[^}]*animation: cardIn var\(--motion-med\) var\(--ease-out\) var\(--stagger-step\) backwards;/)
    expect(css).not.toMatch(/\.yf-surface\.tsx-card \{[^}]*\d+ms/)
  })

  it('no second .tsx-card rule exists at the top level, so the sheet keeps one selector per rule', () => {
    expect(countTopLevel('.tsx-card')).toBe(1)
  })

  it('a reduced-motion user gets no panel entrance', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.yf-surface\.tsx-card \{ animation: none; \}/)
  })
})
