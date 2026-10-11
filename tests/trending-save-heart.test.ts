// ============ Explore - the save heart on the trending shelf ============
//
// A trending card carries the same save heart as a grid card. One component
// draws it, one page-level hook owns the saved ids, and the shared `.ex-save`
// rules own the look and the motion. These pins read the source and render the
// shelf to markup (node env, no DOM). They fail when a second heart appears, when
// the heart loses its name or its pressed state, or when the heart sinks under
// the card's stretched link.
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PublishedItinerary, User } from '../src/data/types'
import { TrendingShelf } from '../src/components/explore/TrendingShelf'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const shelfSource = read('../src/components/explore/TrendingShelf.tsx')
const cardSource = read('../src/components/explore/ExploreCard.tsx')
const heartSource = read('../src/components/explore/ExploreSaveHeart.tsx')
const explorePage = read('../src/pages/Explore.tsx')
const css = read('../src/styles.css')

const creator: User = {
  id: 'c1', email: 'c1@example.test', createdAt: 0,
  profile: { name: 'Arun', languages: ['en'], travelStyles: ['relaxed'], isCreator: true },
}

const plan = (id: string): PublishedItinerary => ({
  id, tripId: `t-${id}`, creatorId: 'c1', title: `Plan ${id}`, tagline: `The ${id} plan`,
  routeSummary: ['Start', 'End'], durationDays: 3, estimatedBudgetPerPersonInr: 10000,
  travelStyle: 'relaxed', travelTips: [], warningsAndAssumptions: [], freeDayIndexes: [0],
  publishedAt: 1000, views: 30, copies: 0,
})

const shelf = (savedIds: string[]) => renderToStaticMarkup(createElement(TrendingShelf, {
  pubs: [plan('p1'), plan('p2')], users: [creator],
  isSaved: id => savedIds.includes(id), onToggleSave: () => {},
}))

/** The CSS text of one rule, from its selector to the closing brace. */
function ruleBody(selector: string): string {
  const start = css.indexOf(`\n${selector} {`)
  expect(start, `${selector} rule`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}

describe('trending save heart: one heart for both cards', () => {
  // `appLink` reads the page location at render time, and node has none.
  beforeAll(() => { vi.stubGlobal('location', new URL('https://app.example.test/explore')) })

  it('draws the heart with one shared component', () => {
    expect(heartSource).toMatch(/export function ExploreSaveHeart/)
    expect(shelfSource).toMatch(/<ExploreSaveHeart title=\{pub\.title\} saved=\{isSaved\(pub\.id\)\}/)
    expect(cardSource).toMatch(/<ExploreSaveHeart title=\{title\} saved=\{saved\}/)
    // Neither card keeps its own copy of the button.
    expect(shelfSource).not.toMatch(/className="ex-save"/)
    expect(cardSource).not.toMatch(/className="ex-save"/)
    expect(heartSource.match(/className="ex-save"/g)).toHaveLength(1)
  })

  it('reads the saved state from the same hook the grid uses', () => {
    expect(explorePage).toMatch(/const \{ saved, isSaved, toggleSaved \} = useSavedPubs\(\)/)
    expect(explorePage).toMatch(/<TrendingShelf [^>]*isSaved=\{isSaved\} onToggleSave=\{toggleHeart\}/)
    expect(explorePage).toMatch(/saved=\{isSaved\(p\.id\)\}[\s\S]*?onToggleSave=\{\(\) => onToggleSave\(p\.id\)\}/)
  })

  it('names the heart after the plan and carries aria-pressed', () => {
    expect(heartSource).toMatch(/aria-label=\{`Save \$\{title\}`\}/)
    expect(heartSource).toMatch(/aria-pressed=\{saved\}/)
    expect(heartSource).toMatch(/type="button"/)
  })

  it('renders one heart per trending card, named for its plan', () => {
    const html = shelf([])
    expect(html.match(/class="ex-save"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Save Plan p1"')
    expect(html).toContain('aria-label="Save Plan p2"')
  })

  it('shows only the saved plan as pressed', () => {
    const html = shelf(['p2'])
    const first = html.indexOf('aria-label="Save Plan p1"')
    const second = html.indexOf('aria-label="Save Plan p2"')
    expect(html.slice(first - 60, first + 40)).toContain('aria-pressed="false"')
    expect(html.slice(second - 60, second + 40)).toContain('aria-pressed="true"')
  })

  it('keeps the heart inside the cover, beside the rank and clear of the byline', () => {
    const cover = shelfSource.slice(shelfSource.indexOf('className="ex-trend-cover"'), shelfSource.indexOf('ex-trend-body'))
    expect(cover).toContain('ex-trend-rank')
    expect(cover).toContain('<ExploreSaveHeart')
    expect(cover.indexOf('ex-trend-rank')).toBeLessThan(cover.indexOf('<ExploreSaveHeart'))
  })
})

describe('trending save heart: layers, corner and motion', () => {
  it('raises the heart above the stretched link, like the byline', () => {
    expect(ruleBody('.ex-save')).toMatch(/z-index: var\(--z-raised\)/)
    expect(ruleBody('.ex-trend-link::after')).toMatch(/z-index: var\(--z-content\)/)
    expect(css).toMatch(/--z-raised: 2;/)
    expect(css).toMatch(/--z-content: 1;/)
  })

  it('puts the heart top right and the rank top left', () => {
    expect(ruleBody('.ex-save')).toMatch(/top: 4px; right: 4px/)
    expect(ruleBody('.ex-trend-rank')).toMatch(/top: 8px; left: 8px/)
  })

  it('keeps a 40px target around the 32px dot', () => {
    expect(ruleBody('.ex-save')).toMatch(/width: 40px; height: 40px/)
    expect(ruleBody('.ex-save-dot')).toMatch(/width: 32px; height: 32px/)
  })

  it('runs the heart hover and the saved pop from the motion tokens', () => {
    expect(ruleBody('.ex-save-dot')).toMatch(/transition: transform var\(--motion-fast\) var\(--ease-out\)/)
    expect(css).toMatch(/\.ex-save:hover \.ex-save-dot \{ transform: scale\(1\.08\); \}/)
    expect(css).toMatch(/\.ex-save\[aria-pressed='true'\] \.ex-save-dot,[\s\S]*?animation: exHeartPop var\(--motion-med\) var\(--ease-out\)/)
  })

  it('opts the heart out of motion under reduced motion', () => {
    const reduced = css.slice(css.indexOf('/* ---------- Reduced motion ---------- */'))
    expect(reduced).toMatch(/\.ex-save\[aria-pressed='true'\] \.ex-save-dot[\s\S]*?\{ animation: none; \}/)
    expect(reduced).toMatch(/\.ex-save-dot[\s\S]*?\{ transition: none; \}/)
    expect(reduced).toMatch(/\.ex-save:hover \.ex-save-dot, \.ex-save:active \.ex-save-dot[\s\S]*?\{ transform: none; \}/)
  })

  it('needs no login to save, same as the grid card', () => {
    expect(heartSource).not.toMatch(/needsLogin|onNavigate|login/i)
    expect(shelfSource).not.toMatch(/needsLogin/)
  })
})
