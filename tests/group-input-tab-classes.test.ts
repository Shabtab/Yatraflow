import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readCssSource } from '../scripts/css-source-graph.mjs'

// Pins for the Group input tab's S9 layout classes. The tab styles live in
// src/styles/pages/group-input.css, which docs/css-ownership.json registers.
// The source files are read with CRLF turned into LF. This is a node-env test:
// it reads text, it renders nothing.
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const tab = read('src/pages/trip/GroupInputTab.tsx')
const own = read('src/styles/pages/group-input.css')
const entry = read('src/styles.css')
const css = readCssSource('src/styles.css')
const ownership = JSON.parse(read('docs/css-ownership.json')) as {
  owners: Array<{ id: string; file: string; owned?: string[] }>
}

/** The declarations of one one-line rule, in source order, with spaces collapsed. */
function declarationsOf(selector: string): string[] | undefined {
  const start = css.indexOf(`\n${selector} {`)
  if (start < 0) return undefined
  const open = start + selector.length + 3
  const close = css.indexOf('}', open)
  return css.slice(open, close).split(';').map((d) => d.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/** Rules whose values other tests and screens rely on. */
const PINNED: Array<[selector: string, declarations: string[]]> = [
  ['.gin-grid', ['display: grid', 'grid-template-columns: 1.15fr 1fr 0.8fr', 'gap: 18px', 'align-items: start']],
  ['.gin-card-title', ['font-family: var(--font-body)', 'font-size: 18px', 'font-weight: 800', 'line-height: 1.3', 'color: var(--text)']],
  ['.yf-surface.gin-panel', ['border-radius: var(--radius)', 'box-shadow: var(--shadow-card)']],
  ['.stop-meta.gin-stop-meta', ['margin-top: 8px']],
  ['.gin-fill', ['display: block', 'height: 100%', 'width: 0', 'border-radius: var(--radius-pill)', 'background: var(--teal)', 'opacity: 0.35', 'transition: width var(--motion-med) var(--ease-paper)']],
  // #839 stage B: the retarget / add-another-visit follow-up. Motion only. The
  // panel's own spacing comes from .gin-item-actions, which it is combined with.
  ['.gin-followup', ['animation: popover-in var(--motion-fast) var(--ease-glide)']],
]

describe('Group input tab: S9 layout classes', () => {
  it('declares the pinned rules with their values', () => {
    for (const [selector, declarations] of PINNED) {
      expect(declarationsOf(selector), selector).toEqual(declarations)
    }
  })

  it('has a rule for every gin- class the tab uses, and the tab uses every class the page file owns', () => {
    const used = new Set(tab.match(/gin-[a-z-]+/g) ?? [])
    const owned = new Set(own.match(/\.gin-[a-z-]+/g)?.map((c) => c.slice(1)) ?? [])
    // gin-followup keeps its entrance rule in the legacy motion file.
    const external = new Set(['gin-followup'])
    for (const cls of used) expect(css, cls).toContain(`.${cls}`)
    expect([...owned].filter((c) => !used.has(c)), 'dead gin- rules').toEqual([])
    expect([...used].filter((c) => !owned.has(c) && !external.has(c)), 'gin- classes without a rule').toEqual([])
  })

  it('registers the page file once, with exactly the classes it declares', () => {
    const owners = ownership.owners.filter((o) => o.file === 'src/styles/pages/group-input.css')
    expect(owners).toHaveLength(1)
    const owned = new Set(own.match(/\.gin-[a-z-]+/g)?.map((c) => c.slice(1)) ?? [])
    expect([...(owners[0].owned ?? [])].sort()).toEqual([...owned].sort())
  })

  it('imports the page file from the entry list and adds no gin- rule to it', () => {
    expect(entry).toContain("@import './styles/pages/group-input.css';")
    expect(entry).not.toMatch(/\.gin-/)
  })

  it('keeps one inline style: the vote bar width, which depends on data', () => {
    expect(tab.match(/style=\{\{/g) ?? []).toHaveLength(1)
    expect(tab).toContain("style={{ width: `${percent}%` }}")
  })

  it('keeps the two item cards on the shared focus target', () => {
    expect(tab.match(/tabIndex=\{-1\} className=\{`card gi-item gin-panel gin-decision/g)).toHaveLength(1)
    expect(tab.match(/tabIndex=\{-1\} className=\{`gin-row gi-item/g)).toHaveLength(1)
  })

  it('uses motion tokens only, with a reduced-motion mirror for the bar and the stamp', () => {
    expect(own).not.toMatch(/\d+ms\b/)
    expect(own).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.gin-fill \{ transition: none; \}[^}]*\.gin-stamp \{ animation: none; \}/)
  })

  it('collapses to two columns at 1180px and one at 860px', () => {
    expect(own).toContain('@media (max-width: 1180px)')
    expect(own).toContain('@media (max-width: 860px)')
  })
})
