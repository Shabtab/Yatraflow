// P12 — Trip settings tab consistency pins.
//
// These are source and stylesheet pins, the same shape the Share tab uses. They
// hold the decisions this pass made: the panels render through the shared
// Surface, the section titles read R20, the in-flight save is its own block, and
// the static inline styles are gone.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readCssSource } from '../scripts/css-source-graph.mjs'

const code = readFileSync(join(process.cwd(), 'src/pages/trip/TripSettingsForm.tsx'), 'utf8')
const css = readCssSource('src/styles.css')

/** The sheet with every @media block removed. The duplicate-selector gate reads
 *  top-level rules only, so a rule inside a media query is not a duplicate. The
 *  settings sheet already restates `.tsx-card` and `.tsx-q` at 760px. */
const topLevel = css.replace(/@media[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
const countTopLevel = (selector: string) => [...topLevel.matchAll(new RegExp(`^\\s*${selector.replace('.', '\\.')}\\s*\\{`, 'gm'))].length

describe('P12 — the panels sit on the shared card skin', () => {
  it('every panel renders through Surface, and none is a bare section', () => {
    // Seven: the artboard's six sections (name, dates, group, travel, people,
    // archive) plus the Mixed driving answer, which became its own panel in
    // 2026-10-19 so it can sit next to the mode panel without a wheel it may
    // never use. The archive panel renders for the owner only.
    expect([...code.matchAll(/<Surface as="section" className="tsx-card/g)]).toHaveLength(7)
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
    expect(css).toContain('.yf-surface.tsx-card { border-radius: var(--radius); box-shadow: var(--shadow-card); }')
  })
})

describe('P12 — the section titles read the settings artboard scale', () => {
  it('the shared rule keeps the token and sets the artboard size', () => {
    // R14 and R20: a card title is Plus Jakarta Sans 800, 18px, line height 1.3.
    // `.tsx-q` is used here alone.
    expect(css).toMatch(/\.tsx-card \.tsx-q \{ font-family: var\(--font-body\); font-size: 18px; font-weight: 800; line-height: 1\.3; color: var\(--text\); \}/)
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
  it('the panel entrance is the tab-owned cascade, with no cardIn left on the page', () => {
    // The cascade lives in one block in 16-motion-and-cover-v2.css, pinned by
    // tests/settings-entrance-motion.test.ts. The page sheet keeps the skin only.
    expect(css).not.toMatch(/^\.yf-surface\.tsx-card \{[^}]*animation:/m)
    expect(css).not.toMatch(/^\.tset-nav \{[^}]*animation:/m)
    expect(css).not.toContain('.tset-aside > :nth-child(1) { animation-delay')
    expect(css).toMatch(/\.tset-main > section\.yf-surface\.tsx-card \{\s*animation: pageRise var\(--motion-slow\) var\(--ease-paper\) backwards;/)
  })

  it('no second .tsx-card rule exists at the top level, so the sheet keeps one selector per rule', () => {
    expect(countTopLevel('.tsx-card')).toBe(1)
  })

  it('a reduced-motion user gets no panel entrance', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.tset-main > section\.yf-surface\.tsx-card,[^}]*\.tset-aside > \*,[^}]*\{\s*animation: none;\s*\}/)
  })
})

describe('P12 — the measured artboard gaps stay closed', () => {
  it('a moved date range marks the card and the rail keeps its divider', () => {
    expect(code).toContain('const datesChanged = f.startDate !== trip.startDate || f.endDate !== trip.endDate')
    expect(code).toContain('{datesChanged && <span className="tset-changed">Changed</span>}')
    expect(css).toContain('.tset-main > .yf-surface.tsx-card:has(.tset-changed) { border-color: var(--pw-marigold-300); }')
    expect(code).toContain("{key === 'danger' && <span className=\"tset-nav-divider\" aria-hidden=\"true\" />}")
    expect(css).toContain('.tset-nav-divider { height: 1px;')
  })

  it('the People strip outranks the base card and copy rules', () => {
    expect(css).toContain('.tset-main > .yf-surface.tsx-card--people { flex-direction: row; align-items: center; gap: 14px; padding: 18px 22px; }')
    expect(css).toContain('.tset-people-title { font-family: var(--font-body); font-size: 18px; font-weight: 800; line-height: 1.3; color: var(--pw-ink); }')
    expect(css).not.toContain('.tset-people-copy b {')
  })

  it('the day number and the glance value keep the artboard type scale', () => {
    expect(css).toContain('.tset-day-num { font: 700 18px/1.25 var(--font-display);')
    expect(css).toContain('.tset-stat-v { font: 700 19px/1.2 var(--font-display);')
  })

  it('the current cover tile and the travel copy read as the artboard says', () => {
    expect(code).toContain('<span className="tset-cover-now">Current</span>')
    expect(code).toContain('<p className="tsx-a">Sets drive times, rest breaks and fuel cost.</p>')
  })

  it('the settings page gets 1180px of content without widening other tabs', () => {
    expect(css).toContain('.container.yf-workspace.yf-workspace:has(.tset-grid) {')
    expect(css).toContain('max-width: 1220px;')
    expect(css).toContain(".container.yf-workspace.yf-workspace[data-wide='true'] {")
  })

  it('the measured type and aside spacing stay pinned', () => {
    expect(css).toMatch(/\.tsx-a \{\s*margin: 1px 0 0;\s*font-size: 12\.5px; font-weight: 400; line-height: 1\.4;/)
    expect(css).toContain('.flab { font: 700 13px/1.4 var(--font-body); color: var(--pw-ink); }')
    expect(css).toMatch(/\.tset-nav-item i \{[\s\S]*?font-size: 11px;\s*font-weight: 800;/)
    expect(css).toMatch(/\.tset-cover-now \{[\s\S]*?font-size: 11px;\s*font-weight: 700;/)
    expect(css).toContain('.tset-save-title { font-family: var(--font-body); font-size: 18px; font-weight: 800; line-height: 1.3; color: var(--pw-ink); }')
    expect(css).toContain('.tset-aside { position: sticky; top: var(--space-7); display: flex; flex-direction: column; gap: 14px; }')
    expect(css).toMatch(/\.tset-savecard \{\s*display: flex;\s*flex-direction: column;\s*gap: 12px;/)
    expect(css).toMatch(/\.tset-diff \{\s*display: flex;\s*flex-direction: column;\s*gap: 4px;\s*padding: 12px;/)
    expect(css).toContain('.tset-save-actions { display: flex; gap: 8px; margin-top: 2px; }')
    expect(css).toMatch(/\.tset-glance \{\s*display: flex;\s*flex-direction: column;\s*gap: 10px;\s*padding: 16px 18px;/)
    expect(css).toContain('.tset-glance-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }')
  })

  it('the People strip and day tiles carry the artboard geometry', () => {
    expect(css).toContain('.tset-stack > * + * { margin-inline-start: -8px; }')
    expect(css).toMatch(/\.tset-av \{[\s\S]*?width: 34px;\s*height: 34px;/)
    expect(css).toMatch(/\.tset-day \{[\s\S]*?min-height: 72px;[\s\S]*?border: 0;/)
    expect(css).toContain('.tset-day-stops { font: 400 11px/1.4 var(--font-body); font-style: normal; color: var(--pw-ink-2); }')
    expect(css).toContain('.tset-day.is-new { border: 1.5px dashed var(--pw-marigold-500); background: var(--pw-card); }')
  })

  it('each avatar tone carries an ink that clears its own fill', () => {
    expect(css).toContain('.tset-av--1 { background: var(--pw-lagoon-600); color: var(--pw-on-lagoon); }')
    expect(css).toContain('.tset-av--2 { background: var(--pw-bloom-500); color: var(--pw-on-bloom); }')
    expect(css).toContain('.tset-av--3 { background: var(--pw-time-stop); color: var(--pw-on-time-stop); }')
  })

  it('the cover uses the shared height and title rule, and the touch targets stay 44px', () => {
    // The Settings tab used to carry its own cover heights (304, 384, 352, 380)
    // and a four-line title clamp. Those moved to one rule for every content tab
    // (tests/workspace-header.test.ts), so the pill does not move on this tab.
    expect(css).not.toContain('body:has(.tset-grid) .yf-page .yf-trip-head')
    expect(css).not.toContain('-webkit-line-clamp: 4;')
    // The grid stays wider than the cover: the cover is capped and centred.
    expect(css).toContain('.container.yf-workspace.yf-workspace:has(.tset-grid) .yf-page {')
    expect(css).toContain('@media (pointer: coarse) {')
    expect(css).toMatch(/\.tsx-node > button,\s*\.tsx-node-tools button \{/)
    expect(css).toMatch(/\.tsx-node > button,[\s\S]*?width: 44px;\s*height: 44px;/)
  })

  it('the route keeps stored stops editable and the return row read-only', () => {
    expect(code).toContain('const routeSummary = settingsRouteSummary(dests, f.startLocation, fuelMode && f.roundTrip)')
    expect(code).toContain('<Field label={`Destinations (${routeSummary.destinationCount})`}')
    expect(code).toContain('{routeSummary.returnPlace !== null && (')
    expect(code).toContain('<span className="tsx-node tsx-node--return"')
    expect(code).toContain('<span className="dest-pin" aria-hidden>📍</span>')
    expect(code).toContain('<span className="tsx-return-marker">Return</span>')
    expect(code).toContain('id="tset-start-location"')
    expect(code).not.toContain("addDest(routeSummary.returnPlace")
  })

  it('the date read-back truncates instead of spilling out of its box', () => {
    expect(code).toContain('<span className="tset-when-value" title=')
    expect(css).toContain('.tset-when-value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }')
  })

  it('the driver and pace pair responds and the pace rows wrap', () => {
    expect(css).toContain('.tset-driver-pace-pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; }')
    expect(css).toContain('.tset-driver-pace-pair { grid-template-columns: minmax(0, 1fr); }')
    // The ten styles wrap into rows rather than scrolling off the right edge,
    // and the row reaches 44px on a coarse pointer.
    expect(css).toMatch(/\.tset-pace-rows \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/)
    expect(css).toContain('.tset-pace-row { height: 44px; }')
  })
})
