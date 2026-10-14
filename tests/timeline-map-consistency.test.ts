// ============ P12 - the workspace's last ad-hoc states are shared blocks ============
// The timeline's empty day and the map's empty route are compact StateBlocks now,
// and the five inline styles left in DaySection are the data-driven ones. Node
// env, no DOM: these read the shipped source and the block's own role table.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { stateBlockRole } from '../src/components/page/StateBlock'

const day = readFileSync(new URL('../src/pages/trip/timeline/DaySection.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const map = readFileSync(new URL('../src/components/TripMap.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const baseline = JSON.parse(
  readFileSync(new URL('./page-consistency-baseline.json', import.meta.url), 'utf8'),
) as { pageFiles: Record<string, Record<string, number>> }

describe('P12 — the timeline and the map render the shared state block', () => {
  it('an empty day is a compact empty block, and its icon and action survive', () => {
    expect(day).toMatch(/<StateBlock kind="empty" size="compact" icon=\{<CloudSun size=\{38\} aria-hidden \/>\} title="Nothing planned yet"/)
    // The block's prop is `actions`, not the empty state's `action`.
    expect(day).toMatch(/actions=\{editable \? <button className="btn btn-primary btn-sm" onClick=\{\(\) => onAdd\(day\.index\)\}>\+ Add stop<\/button> : undefined\}/)
    expect(day).not.toContain('<EmptyState')
    expect(day).toContain("import { StateBlock } from '../../../components/page/StateBlock'")
  })

  it('the map draws the same block when the trip has nothing to plot', () => {
    expect(map).toMatch(/<StateBlock kind="empty" size="compact" icon=\{<MapIcon size=\{38\} aria-hidden \/>\}/)
    expect(map).toContain("import { StateBlock } from './page/StateBlock'")
  })

  it('neither file takes the full size, and the roles are the shared ones', () => {
    for (const source of [day, map]) {
      expect(source).not.toMatch(/<StateBlock(?![^>]*size="compact")/)
    }
    // An empty state stays silent; a failed read would interrupt.
    expect(stateBlockRole('empty')).toBeUndefined()
    expect(stateBlockRole('failed')).toBe('alert')
  })

  it('the cluster note stays a polite status: it is information, not an empty room', () => {
    expect(map).toMatch(/<p className="hint-text tm-note" role="status">/)
    expect(map).not.toMatch(/className="hint-text"[^>]*role="status"/)
  })
})

describe('P12 — the static steps moved out of the style attribute', () => {
  it('the ten new classes carry the values the attributes had', () => {
    const rules: Record<string, string> = {
      '.tl-rain-gap': 'margin-left: 4px;',
      '.tl-stop-flex': 'flex: 1; min-width: 160px;',
      '.tl-day-note': 'max-width: 300px; margin-bottom: 4px;',
      '.tl-day-tools': 'display: flex; gap: 6px; flex-wrap: wrap; align-items: center;',
      '.tl-fixed-inline': 'display: inline-flex;',
      '.tl-warn-gap': 'margin-bottom: 8px;',
      '.tl-arrive-gap': 'margin-left: 6px;',
      '.tl-source-gap': 'margin-left: 2px;',
      '.tl-hint-gap': 'margin: 0 0 12px;',
      '.tl-day-footer': 'display: flex; gap: 8px; margin-top: 14px;',
      '.tm-note': 'margin-top: 8px;',
    }
    for (const [selector, declarations] of Object.entries(rules)) {
      expect(css, selector).toContain(`${selector} { ${declarations} }`)
    }
  })

  it('the five survivors are the data-driven ones, and the baseline agrees', () => {
    const properties = [...day.matchAll(/style=\{\{\s*([a-zA-Z-]+)\s*:/g)].map(m => m[1])
    expect(properties).toHaveLength(5)
    // A weight, a width and three drag transforms: all read the trip or a drag.
    expect(properties.filter(p => p === 'flexGrow')).toHaveLength(1)
    expect(properties.filter(p => p === 'width')).toHaveLength(1)
    expect(properties.filter(p => p === 'transform')).toHaveLength(3)
    expect(baseline.pageFiles['src/pages/trip/timeline/DaySection.tsx'].inlineStyle).toBe(5)
    expect(baseline.pageFiles['src/pages/trip/timeline/DaySection.tsx'].EmptyState).toBe(0)
  })

  it('the state blocks keep an entrance on the motion tokens, with the opt-out', () => {
    expect(css).toMatch(/\.tl-state, \.tm-state \{ animation: errIn var\(--motion-med\) var\(--ease-out\); \}/)
    const optOut = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .tl-state'))
    expect(optOut).toContain('.tl-state, .tm-state { animation: none; }')
  })

  it('the new section names no raw duration', () => {
    const section = css.slice(css.indexOf('/* ===== P12: Timeline and map')).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(section).not.toMatch(/\d+ms/)
  })
})
