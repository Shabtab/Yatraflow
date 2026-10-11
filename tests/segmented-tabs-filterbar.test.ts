// SegmentedTabs and FilterBar: the two shared page primitives, and the callers
// that must keep their markup after the refactor. Node env, no DOM: the tests
// read the source text. The rendered markup was compared byte for byte before
// and after in a real browser (see the changelog entry); these pins keep the
// shape from drifting.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const segmented = source('src/components/page/SegmentedTabs.tsx')
const filterBar = source('src/components/page/FilterBar.tsx')
const viewSwitch = source('src/components/trips/ViewSwitch.tsx')
const exploreBar = source('src/components/explore/ExploreFilterBar.tsx')
const styles = source('src/styles.css')

describe('SegmentedTabs', () => {
  it('takes the two semantics and the props every caller needs', () => {
    expect(segmented).toContain("semantics: 'tablist' | 'toggle'")
    for (const prop of ['items:', 'value:', 'onChange:', 'label:', 'className?:']) expect(segmented).toContain(prop)
    for (const field of ['key:', 'label:', 'icon?:', 'count?:', 'id?:', 'controls?:']) expect(segmented).toContain(field)
  })

  it('uses the tablist keyboard contract and the PillNav glider for tabs', () => {
    expect(segmented).toContain("from '../../hooks/useTablist'")
    expect(segmented).toContain("from '../PillNav'")
    expect(segmented).toContain('role="tablist"')
    expect(segmented).toContain('role="tab"')
    expect(segmented).toContain('data-pill-key')
    expect(segmented).toContain('aria-selected')
  })

  it('keeps the toggle a plain group of pressed buttons with no glider', () => {
    const toggleBranch = segmented.slice(segmented.indexOf("semantics === 'toggle'"), segmented.indexOf('return (\n    <PillNav'))
    expect(toggleBranch).toContain('role="group"')
    expect(toggleBranch).toContain('aria-pressed')
    expect(toggleBranch).not.toContain('PillNav')
    expect(toggleBranch).not.toContain('role="tab"')
  })

  it('adds no raw duration of its own', () => {
    expect(segmented).not.toMatch(/\d\s*ms\b/)
  })
})

describe('ViewSwitch', () => {
  it('is a thin caller of SegmentedTabs with the toggle semantics', () => {
    expect(viewSwitch).toContain("from '../page/SegmentedTabs'")
    expect(viewSwitch).toContain('<SegmentedTabs')
    expect(viewSwitch).toContain('semantics="toggle"')
    expect(viewSwitch).not.toContain('aria-pressed')
  })

  it('keeps the class name, the label and the two choices', () => {
    expect(viewSwitch).toContain('className="mt-seg"')
    expect(viewSwitch).toContain('label="Layout"')
    expect(viewSwitch).toContain("label: 'Grid'")
    expect(viewSwitch).toContain("label: 'List'")
    expect(viewSwitch).toContain('export type TripsLayout')
  })

  it('still has its look rules in styles.css', () => {
    expect(styles).toContain('.mt-seg {')
    expect(styles).toContain(".mt-seg button[aria-pressed='true']")
  })
})

describe('FilterBar', () => {
  it('takes slots, not one prop per filter', () => {
    for (const prop of ['label: string', 'search?:', 'selects?:', 'activeSelectCount?:', 'chips?:', 'trailing?:', 'onClear?:', 'className?:']) {
      expect(filterBar).toContain(prop)
    }
  })

  it('owns the frame, the stacking host and the phone fold', () => {
    expect(filterBar).toContain('ex-filterbar filterbar-host')
    expect(filterBar).toContain('role="search"')
    expect(filterBar).toContain('ex-filter-row')
    expect(filterBar).toContain('ex-filters-toggle')
    expect(filterBar).toContain('ex-selects')
    expect(filterBar).toContain('ex-chip-row')
    expect(filterBar).toContain('ex-chip-divider')
    expect(filterBar).toContain('ex-clear')
    expect(filterBar).toContain('aria-expanded')
    expect(filterBar).toContain('aria-controls')
  })

  it('holds no filter state of its own', () => {
    expect(filterBar.match(/useState/g)?.length).toBe(2) // the import and the one fold flag
    expect(filterBar).not.toContain('useEffect')
  })
})

describe('ExploreFilterBar', () => {
  it('is a thin caller of FilterBar and fills its slots', () => {
    expect(exploreBar).toContain("from '../page/FilterBar'")
    expect(exploreBar).toContain('<FilterBar')
    for (const slot of ['search={', 'selects={', 'chips={', 'trailing={', 'onClear={', 'activeSelectCount={']) {
      expect(exploreBar).toContain(slot)
    }
  })

  it('keeps the class names and the aria labels of the controls', () => {
    for (const token of ['ex-select', 'ex-select--sort', 'ex-chips', 'ex-chip-saved', 'ex-chip-count', 'ex-select-icon']) {
      expect(exploreBar).toContain(token)
    }
    for (const label of ['Filter itineraries', 'Travel style', 'Duration', 'Max budget', 'Sort by', 'Search by route, place or creator']) {
      expect(exploreBar).toContain(label)
    }
  })

  it('does not rebuild the frame the shell owns', () => {
    expect(exploreBar).not.toContain('ex-filterbar')
    expect(exploreBar).not.toContain('ex-filter-row')
    expect(exploreBar).not.toContain('useState')
  })
})
