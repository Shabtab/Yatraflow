import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { railOverflow } from '../src/lib/railOverflow'

// #684: the trip tab rail scrolls sideways at phone width and hides its
// scrollbar, so the edge fade has to know which side still holds hidden tabs.
// The state is pure, so it is pinned here rather than in a browser.

describe('rail overflow state', () => {
  it('reports no overflow when the rail fits', () => {
    expect(railOverflow(0, 360, 360)).toBe('none')
    expect(railOverflow(0, 300, 360)).toBe('none')
  })

  it('names the side that still holds hidden tabs', () => {
    expect(railOverflow(0, 600, 360)).toBe('start')
    expect(railOverflow(240, 600, 360)).toBe('end')
    expect(railOverflow(120, 600, 360)).toBe('middle')
  })

  it('treats a sub-pixel offset as the edge it sits on', () => {
    expect(railOverflow(0.5, 600, 360)).toBe('start')
    expect(railOverflow(239.5, 600, 360)).toBe('end')
  })

  it('tolerates the one-pixel overflow a rounded layout can leave', () => {
    expect(railOverflow(0, 361, 360)).toBe('none')
    expect(railOverflow(0, 362, 360)).toBe('start')
  })
})

// The fade needs both halves. PillNav publishes the state. The stylesheet
// paints it. A pin on each half keeps one of them from going quiet.

describe('the rail publishes its state, and the stylesheet paints it', () => {
  const pillNav = readFileSync(new URL('../src/components/PillNav.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

  it('PillNav reads the rail and writes the state it measured', () => {
    expect(pillNav).toContain("import { railOverflow } from '../lib/railOverflow'")
    expect(pillNav).toMatch(/railOverflow\(wrap\.scrollLeft, wrap\.scrollWidth, wrap\.clientWidth\)/)
    expect(pillNav).toMatch(/wrap\.dataset\.overflow = state/)
    expect(pillNav).toContain("wrap.addEventListener('scroll', syncOverflow")
  })

  it('a state that hides tabs gets a mask, and a rail that fits gets none', () => {
    for (const state of ['start', 'middle', 'end']) {
      expect(css, `the ${state} state needs a mask rule`).toContain(`.tabbar[data-overflow='${state}']`)
    }
    expect(css).toMatch(/\.tabbar\[data-overflow='start'\] \{\s*-webkit-mask-image: linear-gradient\(90deg, #000 calc\(100% - 28px\), transparent\);/)
    expect(css, 'the fitting state must paint no mask').not.toContain("[data-overflow='none']")
  })
})

