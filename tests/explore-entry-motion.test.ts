// ============ Explore — page entry motion pins ============
// The page arrives in reading order, one stagger step apart: hero copy, hero
// visual, stats, the Itineraries heading and filters, the list, then the aside.
// Each pin reads the source, so a change to a step, a scope or an opt-out fails.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')

const CSS = stripComments(read('src/styles/legacy/10-explore.css'))
const REDUCED_AT = CSS.lastIndexOf('@media (prefers-reduced-motion: reduce)')
const MAIN = CSS.slice(0, REDUCED_AT)
const REDUCED = CSS.slice(REDUCED_AT)

function bodyOf(text: string, selector: string): string {
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].replace(/\s+/g, ' ').trim() === selector) return m[2]
  }
  return ''
}
const delayStep = (body: string): number | null => {
  const m = body.match(/calc\(var\(--stagger-step\) \* (\d+)\)\s+backwards/)
  return m ? Number(m[1]) : body.includes('var(--stagger-step) backwards') ? 1 : /backwards/.test(body) ? 0 : null
}

describe('no later stylesheet resets the Explore entry delays', () => {
  it('explore-redesign.css sets no animation-delay on the hero or the list blocks', () => {
    const later = read('src/styles/pages/explore-redesign.css').replace(/\/\*[\s\S]*?\*\//g, '')
    let checked = 0
    for (const m of later.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/\.ex-(hero-copy|hero-visual|stats|head|filterbar|enter|aside)\b/.test(m[1])) {
        checked++
        expect(m[2], m[1].trim()).not.toMatch(/animation(-delay)?\s*:/)
      }
    }
    // The hero visual rule exists in that file, so the scan cannot pass empty.
    expect(checked).toBeGreaterThan(0)
  })
})

describe('the Explore entry order', () => {
  it('steps the page in reading order: copy 0, visual 1, stats 2, head and filters 3, aside 4 to 6', () => {
    expect(delayStep(bodyOf(MAIN, '.ex-page .ex-hero-copy'))).toBe(0)
    expect(delayStep(bodyOf(MAIN, '.ex-page .ex-hero-visual'))).toBe(1)
    expect(delayStep(bodyOf(MAIN, '.ex-page .ex-stats'))).toBe(2)
    expect(delayStep(bodyOf(MAIN, '.ex-page :is(.ex-head, .ex-filterbar)'))).toBe(3)
    expect(delayStep(bodyOf(MAIN, '.ex-page .ex-aside > :nth-child(1)'))).toBe(4)
    expect(delayStep(bodyOf(MAIN, '.ex-page .ex-aside > :nth-child(2)'))).toBe(5)
    expect(delayStep(bodyOf(MAIN, '.ex-page .ex-aside > :nth-child(3)'))).toBe(6)
  })

  it('keeps the cascade to about six steps on the slow clock', () => {
    // Every entrance reads --motion-slow and the shared --stagger-step, with no raw duration.
    for (const m of MAIN.matchAll(/\.ex-page[^{]*\{[^}]*animation:\s*ex-in([^;}]*)/g)) {
      expect(m[1]).toContain('var(--motion-slow)')
      expect(m[1]).not.toMatch(/(?<![\d.])[0-9]*\.?[0-9]+m?s\b/)
    }
    const steps = [...MAIN.matchAll(/\.ex-page \.ex-aside > :nth-child\(\d\)[^{]*\{[^}]*calc\(var\(--stagger-step\) \* (\d+)\)/g)].map(m => Number(m[1]))
    expect(Math.max(...steps)).toBeLessThanOrEqual(6)
  })

  it('moves translate and scale only, so a card hover keeps transform', () => {
    const keyframes = MAIN.match(/@keyframes ex-in\s*\{([^@]*?)\}\s*\}/)?.[1] ?? ''
    expect(keyframes).toMatch(/opacity:\s*0/)
    expect(keyframes).toMatch(/translate:\s*0 14px/)
    expect(keyframes).toMatch(/scale:\s*\.98/)
    expect(keyframes).not.toMatch(/transform/)
  })

  it('lets the hero and layout children, not their wrappers, carry the entrance', () => {
    expect(bodyOf(MAIN, '.ex-page.page-enter > :is(.ex-hero, .ex-layout)')).toMatch(/animation:\s*none/)
  })

  it('scopes every new rule to the Explore page, because the hero parts are shared', () => {
    for (const sel of ['.ex-hero-copy', '.ex-hero-visual', '.ex-stats', '.ex-enter']) {
      expect(bodyOf(MAIN, '.ex-page ' + sel)).toMatch(/animation:\s*ex-in/)
    }
  })

  it('stops every new entrance under reduced motion', () => {
    expect(REDUCED).toMatch(/\.ex-page \.ex-hero-copy,[\s\S]*?\.ex-page \.ex-hero-visual,[\s\S]*?\.ex-page \.ex-stats,[\s\S]*?\.ex-page :is\(\.ex-head, \.ex-filterbar\),[\s\S]*?\.ex-page \.ex-enter,[\s\S]*?\.ex-page \.ex-aside > :nth-child\(n\)\s*\{\s*animation:\s*none/)
  })
})

describe('the Explore list waits for the filters, then plays at once on a later mount', () => {
  it('starts the first list at step 4 from a base on the page root', () => {
    expect(MAIN).toContain('.ex-page[data-arriving] { --ex-list-at: 4; }')
    expect(bodyOf(MAIN, '.ex-page .ex-feature.ex-enter')).toMatch(/animation-delay:\s*calc\(var\(--stagger-step\) \* var\(--ex-list-at, 0\)\)/)
    const card = read('src/components/explore/ExploreCard.tsx')
    expect(card).toContain("staggerDelayAfter(enterIndex, '--ex-list-at')")
    expect(read('src/lib/motion.ts')).toContain('calc(var(--stagger-step) * (var(${baseVar}, 0) + ${staggerStep(index)}))')
  })

  it('clears the base after the arrival, so cards that mount later do not wait again', () => {
    const page = read('src/pages/Explore.tsx')
    expect(page).toContain('className="container ex-page page-enter" ref={rootRef} data-arriving=""')
    expect(page).toContain('useArrival(rootRef)')
    expect(read('src/lib/useArrival.ts')).toMatch(/removeAttribute\('data-arriving'\)/)
    // No registered property: an animation's own delay ignores a custom property that a keyframe animates.
    expect(MAIN).not.toMatch(/@property --ex-list-at/)
  })

  it('holds one row of height while the catalog reads, so the cards do not jump in', () => {
    expect(bodyOf(MAIN, ".ex-main > .yf-state[data-kind='loading']")).toMatch(/min-height:\s*24rem/)
    // The loading block still shows only for a read in flight; failed and empty use other blocks.
    expect(read('src/pages/Explore.tsx')).toMatch(/pubsRead === 'reading' \? \(\s*<ExploreStateBlock kind="loading"/)
  })
})
