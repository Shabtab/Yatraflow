import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Stage A pins for the Group input tab. The inline styles moved into gin-
// classes, and each value stayed the same. The source files are read with
// CRLF turned into LF. This is a node-env test: it reads text, it renders
// nothing.
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const tab = read('src/pages/trip/GroupInputTab.tsx')
const css = read('src/styles.css')

/** The declarations of one one-line rule, in source order, with spaces collapsed. */
function declarationsOf(selector: string): string[] | undefined {
  const start = css.indexOf(`\n${selector} {`)
  if (start < 0) return undefined
  const open = start + selector.length + 3
  const close = css.indexOf('}', open)
  return css.slice(open, close).split(';').map((d) => d.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

// Each class with the declarations copied from the inline style it replaced.
const CLASSES: Array<[selector: string, declarations: string[]]> = [
  ['.gin-digest-card', ['margin-bottom: 14px']],
  ['.gin-item-card', ['margin-bottom: 14px']],
  ['.gin-item-layout', ['display: grid', 'grid-template-columns: auto 1fr', 'gap: 14px']],
  ['.gin-chip-group', ['display: inline-flex', 'gap: 6px']],
  ['.gin-creator-line', ['margin: 5px 0']],
  ['.stop-meta.gin-stop-meta', ['margin-top: 7px']],
  ['.gin-consensus-row', ['margin-top: 9px', 'display: flex', 'align-items: center', 'gap: 10px']],
  ['.gin-consensus-track', ['flex: 1']],
  ['.gin-consensus-count', ['white-space: nowrap']],
  ['.gin-item-actions', ['display: flex', 'gap: 7px', 'flex-wrap: wrap']],
  ['.gin-comments', ['margin-top: 8px']],
  ['.gin-comment-form', ['display: flex', 'gap: 7px', 'margin-top: 10px']],
  ['.gin-decision-context', ['margin: 5px 0 10px']],
  ['.gin-decision-options', ['margin: 8px 0']],
  ['.gin-option-label', ['flex: 1']],
  ['.gin-guide-block', ['margin-top: 10px']],
  ['.gin-guide-note', ['margin: 0']],
  ['.gin-guide-rec', ['margin: 4px 0 0']],
  ['.gin-composer-hint', ['margin: 6px 0 12px']],
  ['.gin-submit', ['width: 100%']],
  ['.gin-option-grid', ['display: grid', 'gap: 7px']],
  ['.gin-card-title', ['font-family: var(--font-body)', 'font-size: 18px', 'font-weight: 800', 'line-height: 1.3', 'color: var(--text)']],
  ['.yf-surface.gin-panel', ['border-radius: var(--radius)', 'box-shadow: var(--shadow-card)']],
  // #839 stage B — the retarget / add-another-visit follow-up. Motion only: the
  // panel's own spacing comes from .gin-item-actions, which it is combined with.
  ['.gin-followup', ['animation: popover-in var(--motion-fast) var(--ease-glide)']],
]

// Every inline style attribute the change removed from the tab.
const REMOVED_INLINE = [
  "style={{ marginBottom: 14 }}",
  "style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 14 }}",
  "style={{ display: 'inline-flex', gap: 6 }}",
  "style={{ margin: '5px 0' }}",
  "style={{ marginTop: 7 }}",
  "style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 10 }}",
  "style={{ flex: 1 }}",
  "style={{ whiteSpace: 'nowrap' }}",
  "style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 11 }}",
  "style={{ marginTop: 8 }}",
  "style={{ display: 'flex', gap: 7, marginTop: 10 }}",
  "style={{ margin: '5px 0 10px' }}",
  "style={{ margin: '8px 0' }}",
  "style={{ marginTop: 10 }}",
  "style={{ margin: 0 }}",
  "style={{ margin: '4px 0 0' }}",
  "style={{ margin: '6px 0 12px' }}",
  "style={{ width: '100%' }}",
  "style={{ display: 'grid', gap: 7 }}",
]

describe('Group input tab: inline styles now live in gin- classes', () => {
  it('declares each gin- class with the values its inline style used', () => {
    for (const [selector, declarations] of CLASSES) {
      expect(declarationsOf(selector), selector).toEqual(declarations)
    }
  })

  it('uses every declared gin- class in the tab, and no other', () => {
    const declared = new Set(CLASSES.flatMap(([selector]) => selector.match(/gin-[a-z-]+/g) ?? []))
    const used = new Set(tab.match(/gin-[a-z-]+/g) ?? [])
    expect([...used].sort()).toEqual([...declared].sort())
  })

  it('no longer carries the replaced inline style values', () => {
    for (const removed of REMOVED_INLINE) {
      expect(tab, removed).not.toContain(removed)
    }
  })

  it('keeps only the two inline styles that depend on data or on an off-ladder value', () => {
    expect(tab.match(/style=\{\{/g) ?? []).toHaveLength(2)
    expect(tab).toContain("style={{ width: `${consensusPct}%`, background:")
    expect(tab).toContain('// off-ladder 11px: stays inline until the page redesign')
    expect(tab).toContain('<div className="gin-item-actions" style={{ marginTop: 11 }}>')
  })

  it('puts both classes on the stop meta row, so the host margin cannot win', () => {
    expect(tab).toContain('<div className="stop-meta gin-stop-meta">')
    expect(css).toContain('.stop-meta.gin-stop-meta { margin-top: 7px; }')
  })

  it('keeps the two suggestion and decision item cards on the shared card prefix', () => {
    expect(tab.match(/tabIndex=\{-1\} className=\{`card gi-item gin-item-card/g)).toHaveLength(2)
  })
})
