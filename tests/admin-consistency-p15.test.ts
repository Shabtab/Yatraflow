// ============ P15 - the admin console reads like the catalog pages ============
// The page moved onto the shared page scope, header, tab row, card skin and
// state blocks. These pins read the shipped source, so a later page pass that
// undoes one of them fails here instead of in a screenshot review.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const page = readFileSync(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const baseline = JSON.parse(
  readFileSync(new URL('./page-consistency-baseline.json', import.meta.url), 'utf8'),
) as { pageRootAllowlist: string[]; pageFiles: Record<string, Record<string, number>> }

// The gate counts `style={{`, so a data-driven bar height counts too. Three is
// the floor for this page: two bar heights (R4, they come from the series) and
// the one off-ladder 18px offset that stays inline under R13.
const inlineStyles = [...page.matchAll(/style=\{\{/g)].length

describe('P15 — the page scope, the header and the tab row', () => {
  it('carries the page scope, and the allowlist entry is gone', () => {
    expect(page).toMatch(/className="container yf-page form-page page-enter"/)
    expect(baseline.pageRootAllowlist).not.toContain('src/pages/AdminPage.tsx')
  })

  it('uses the shared header, with the audit notice kept word for word', () => {
    expect(page).toMatch(/import \{ PageHeader \} from '\.\.\/components\/page\/PageHeader'/)
    expect(page).toMatch(/<PageHeader\s+kicker="Admin"/)
    expect(page).toMatch(/headline=\{\{ lead: 'Master admin' \}\}/)
    // #367 — the boundary sentence the console exists to state.
    expect(page).toContain('Full-control console — every destructive action is audit-logged.')
    expect(page).toContain('Actions taken here are logged. Actions taken through the regular workspace are not.')
    expect(page).not.toMatch(/<h1[\s>]/)
  })

  it('switches sections with the tablist tabs, not a hand-rolled pill row', () => {
    expect(page).toMatch(/<SegmentedTabs semantics="tablist" className="tabbar adm-tabs" label="Admin sections"/)
    // Each section names its own tab and the one panel it controls.
    expect(page).toMatch(/id: `admin-tab-\$\{key\}`, controls: 'admin-panel'/)
    expect(page).toMatch(/<div id="admin-panel" role="tabpanel" aria-labelledby=\{`admin-tab-\$\{tab\}`\}>/)
    // The keyboard contract now lives in the component, so the page does not
    // build its own and no longer imports the hook.
    expect(page).not.toContain("from '../hooks/useTablist'")
    expect(page).not.toContain('role="tablist" aria-label="Admin sections"')
  })

  it('keeps the visibility filter a group, not a second tablist', () => {
    expect(page).toMatch(/<PillNav className="filter-pillbar" role="group" aria-label="Visibility filter"/)
  })
})

describe('P15 — the analytics sections sit on the card skin', () => {
  it('wraps each section in a Surface with an R20 title', () => {
    const sections = [...page.matchAll(/<Surface as="section" className="adm-section">/g)].length
    expect(sections).toBe(4)
    expect([...page.matchAll(/<\/Surface>/g)].length).toBe(4)
    expect([...page.matchAll(/<h2 className="adm-card-title">/g)].length).toBe(4)
    // One sub-title inside the revenue card, at the same rule minus the size.
    expect(page).toMatch(/<h3 className="adm-card-subtitle" style=\{\{ marginTop: 18 \}\}>By publication<\/h3>/)
  })

  it('the title and the section step follow the shared tokens', () => {
    expect(css).toMatch(/\.adm-card-title \{[^}]*font-family: var\(--font-body\); font-size: 18px; font-weight: 800; line-height: 1\.3;/)
    expect(css).toMatch(/\.adm-section \{ padding: var\(--space-8\); \}/)
    // The ladder, not the old 18px. 20px is --space-8, a documented step.
    expect(css).toMatch(/\.adm-section \+ \.adm-section \{ margin-top: var\(--space-8\); \}/)
  })

  it('a tile inside a card is a well, not a second card', () => {
    expect(css).toMatch(/\.adm-section \.stat-tile \{[^}]*box-shadow: none;/)
  })

  it('the states in a section are compact blocks', () => {
    // R22: a block inside a card is the compact size.
    expect(page).not.toMatch(/<StateBlock(?![^>]*size="compact")/)
  })
})

describe('P15 — the inline count, and what each survivor is for', () => {
  it('is three, and the baseline says three', () => {
    expect(inlineStyles).toBe(3)
    expect(baseline.pageFiles['src/pages/AdminPage.tsx'].inlineStyle).toBe(3)
  })

  it('the survivors are two data-driven bar heights and the one R13 offset', () => {
    const survivors = [...page.matchAll(/style=\{\{([^}]*)\}\}/g)].map(m => m[1].trim())
    expect(survivors).toHaveLength(3)
    // R4: a height that comes from the series stays inline.
    expect(survivors.filter(s => s.startsWith('height: Math.max'))).toHaveLength(2)
    // R13: 18px is off the spacing ladder, so it stays inline with a comment.
    expect(survivors).toContain('marginTop: 18')
    expect(page).toMatch(/\{\/\* R13: the 18px step is off the spacing ladder/)
  })

  it('no static colour, width or padding declaration is left inline', () => {
    // The first property of each survivor: a style that declares anything else
    // has moved to a class.
    const props = [...page.matchAll(/style=\{\{\s*([a-zA-Z-]+)\s*:/g)].map(m => m[1])
    expect(props.sort()).toEqual(['height', 'height', 'marginTop'])
  })
})
