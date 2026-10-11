// Stage A proof for the Budget tab. Static inline styles moved into bud-
// classes in src/styles.css. Each class carries the inline values, copied
// exactly. This node test checks the source only. The rendered proof is the
// before and after screenshot pair.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const tab = read('../src/pages/trip/BudgetTab.tsx')
const css = read('../src/styles.css')

const count = (source: string, needle: string) => source.split(needle).length - 1
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SECTION = '/* ---------- Budget tab static styles (bud-) ---------- */'

// One entry per class. The selector and declarations must match styles.css.
// The compound selector on the watch row fights the host class .row-between,
// which sets gap: 12px, so it names both classes on the same element.
const RULES = [
  { cls: 'bud-card-lead', selector: '.bud-card-lead', declarations: 'margin: 4px 0 14px;' },
  { cls: 'bud-hint-note', selector: '.bud-hint-note', declarations: 'margin-top: 10px;' },
  { cls: 'bud-hero-meter', selector: '.bud-hero-meter', declarations: 'margin-top: 10px;' },
  { cls: 'bud-crew-card', selector: '.bud-crew-card', declarations: 'margin-top: 14px;' },
  { cls: 'bud-crew-invite', selector: '.bud-crew-invite', declarations: 'margin: 6px 0 0;' },
  { cls: 'bud-crew-status', selector: '.bud-crew-status', declarations: 'margin: 6px 0 10px;' },
  { cls: 'bud-settle-strip', selector: '.bud-settle-strip', declarations: 'margin-top: 12px;' },
  { cls: 'bud-settle-lead', selector: '.bud-settle-lead', declarations: 'margin: 0;' },
  { cls: 'bud-watch-row', selector: '.row-between.bud-watch-row', declarations: 'margin-top: 8px; gap: 8px;' },
  { cls: 'bud-watch-status', selector: '.bud-watch-status', declarations: 'margin-top: 6px;' },
  { cls: 'bud-line-chip', selector: '.bud-line-chip', declarations: 'margin-left: 6px;' },
  { cls: 'bud-editor-actions', selector: '.bud-editor-actions', declarations: 'display: flex; gap: 8px; margin-top: 10px;' },
  { cls: 'bud-essential-fill', selector: '.bud-essential-fill', declarations: 'background: var(--teal);' },
  { cls: 'bud-optional-fill', selector: '.bud-optional-fill', declarations: 'background: var(--saffron);' },
]

// Inline snippets that left the component. None may come back.
const REMOVED_INLINE = [
  "style={{ margin: '4px 0 14px' }}",
  'style={{ marginTop: 10 }}',
  'style={{ marginTop: 14 }}',
  'style={{ marginLeft: 6 }}',
  "style={{ margin: '6px 0 0' }}",
  "style={{ margin: '6px 0 10px' }}",
  'style={{ marginTop: 12 }}',
  'style={{ margin: 0 }}',
  'style={{ marginTop: 8, gap: 8 }}',
  'style={{ marginTop: 6 }}',
  "style={{ display: 'flex', gap: 8, marginTop: 10 }}",
  "background: 'var(--teal)'",
  "background: 'var(--saffron)'",
]

// The inline styles that stay. Each one reads a value from the trip data, so
// it cannot be a fixed class. Each entry carries its expected count.
const REMAINING_INLINE: [string, number][] = [
  ["style={{ width: `${(d.totalInr / maxDay) * 100}%`, background: over ? 'var(--saffron)' : 'var(--teal)' }}", 1],
  ['style={{ left: `${(avg / maxDay) * 100}%` }}', 1],
  ['style={{ background: `color-mix(in srgb, ${meta.color} 15%, transparent)` }}', 2],
  ['style={{ color: meta.color }}', 2],
  ['style={{ width: `${(v / maxCat) * 100}%`, background: meta.color }}', 1],
  ["style={{ width: `${Math.min(100, pctUsed)}%`, background: pctUsed > 100 ? 'var(--coral)' : pctUsed > 85 ? 'var(--saffron)' : 'var(--teal)' }}", 1],
  ['style={{ marginTop: trip.travellers >= 2 ? 14 : 0 }}', 1],
  ["style={{ width: `${(totals.essentialInr / Math.max(1, totals.totalCostInr)) * 100}%` }}", 1],
  ["style={{ width: `${(totals.optionalInr / Math.max(1, totals.totalCostInr)) * 100}%` }}", 1],
]

describe('BudgetTab inline styles moved to bud- classes', () => {
  it('leaves none of the replaced inline declarations in the component', () => {
    for (const snippet of REMOVED_INLINE) expect(count(tab, snippet), snippet).toBe(0)
  })

  it('keeps exactly the eleven data-driven inline styles', () => {
    expect(count(tab, 'style={')).toBe(11)
    for (const [snippet, expected] of REMAINING_INLINE) {
      expect(count(tab, snippet), snippet).toBe(expected)
    }
  })

  it('uses only the moved classes, and each moved class is used', () => {
    const used = new Set(tab.match(/\bbud-[a-z-]+/g) ?? [])
    expect([...used].sort()).toEqual(RULES.map(rule => rule.cls).sort())
  })

  it('puts the watch-row compound classes on the same element', () => {
    expect(tab).toContain('className="row-between bud-watch-row"')
  })

  it('keeps the moved rules under one section comment, after the rules they follow', () => {
    expect(count(css, SECTION)).toBe(1)
    expect(css.indexOf(SECTION)).toBeLessThan(css.indexOf('.bud-card-lead {'))
  })

  it('declares no bud- rule that the list above does not name', () => {
    const selectors = [...css.matchAll(/(?:^|\n)([^\n{}]*\.bud-[a-z-]+[^\n{}]*) \{/g)].map(hit => hit[1].trim())
    expect(selectors.sort()).toEqual(RULES.map(rule => rule.selector).sort())
  })

  for (const rule of RULES) {
    it(`declares ${rule.selector} once, with the inline values`, () => {
      const hits = [...css.matchAll(new RegExp(`(?:^|\\n)${escapeRe(rule.selector)} \\{([^}]*)\\}`, 'g'))]
      expect(hits.length).toBe(1)
      expect(hits[0][1].replace(/\s+/g, ' ').trim()).toBe(rule.declarations)
    })
  }
})
