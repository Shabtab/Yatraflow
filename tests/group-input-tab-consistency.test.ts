import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readCssSource } from '../scripts/css-source-graph.mjs'

// P12 consistency pins for the Group input tab. The panels and item cards sit
// on Surface, the card titles use the shared title class, and each state is its
// own compact StateBlock kind (rulings R20 and R22). The state roles come from
// StateBlock, so the tab adds none of its own. The source files are read with
// CRLF turned into LF. This is a node-env test: it reads text, it renders
// nothing.
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const tab = read('src/pages/trip/GroupInputTab.tsx')
const css = readCssSource('src/styles.css')

describe('Group input tab: panels, titles and states follow the page pattern', () => {
  it('puts every panel and item card on Surface, and leaves no bare card div', () => {
    expect(tab).toContain("import { Surface } from '../../components/page/Surface'")
    expect(tab.match(/<Surface\b/g)).toHaveLength(5)
    expect(tab.match(/<\/Surface>/g)).toHaveLength(5)
    expect(tab).not.toMatch(/<div className="card/)
  })

  it('gives every card title the shared title class, and no bare h3', () => {
    // Three titles are plain: the open and decided decision cards and the Raise a decision form.
    // Two panel titles carry an id, so the section regions can name themselves.
    // The Crew preferences title carries a ref and a -1 tabindex, so focus can return to it.
    expect(tab.match(/<h3 className="gin-card-title">/g)).toHaveLength(3)
    expect(tab.match(/<h3 id="gi-heading-[a-z]+" className="gin-card-title">/g)).toHaveLength(2)
    expect(tab.match(/<h3 ref=\{headingRef\} tabIndex=\{-1\} className="gin-card-title">/g)).toHaveLength(1)
    expect(tab).not.toMatch(/<h3>/)
    expect(css).toContain('.gin-card-title { font-family: var(--font-body); font-size: 18px; font-weight: 800; line-height: 1.3; color: var(--text); }')
  })

  it('gives each state its own compact StateBlock kind', () => {
    expect(tab.match(/<StateBlock kind="kept" size="compact"/g)).toHaveLength(3)
    expect(tab.match(/<StateBlock kind="failed" size="compact"/g)).toHaveLength(3)
    expect(tab.match(/<StateBlock kind="loading" size="compact"/g)).toHaveLength(2)
    expect(tab.match(/<StateBlock kind="empty" size="compact"/g)).toHaveLength(6)
  })

  it('keeps the old ad-hoc state markup out of the tab', () => {
    expect(tab).not.toMatch(/<EmptyState\b/)
    expect(tab).not.toContain('loading-block')
    expect(tab).not.toMatch(/<p className="small muted">(Couldn|No activity)/)
  })

  it('leaves the state roles to StateBlock, so the tab adds no status or alert of its own', () => {
    expect(tab).not.toMatch(/role="(status|alert)"/)
    expect(tab).not.toContain('aria-live')
  })

  it('restates the card skin for the panels, with the shared surface values', () => {
    expect(css).toContain('.yf-surface.gin-panel { border-radius: var(--radius); box-shadow: var(--shadow-card); border-color: var(--line-soft); }')
  })

  it('adds no raw millisecond value in the new CSS section', () => {
    const section = readFileSync(new URL('../src/styles/pages/group-input.css', import.meta.url), 'utf8')
    expect(section).not.toMatch(/\d+ms\b/)
  })
})
