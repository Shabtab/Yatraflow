// ============ My trips — motion pins ============
// The redesign parts of My trips take their motion from docs/MOTION-TOKENS.md:
// the flip countdown, the health ring, the day strip, the card and cover hover,
// the date stamp, the toolbar, the postcards and the page cascade. Each part is
// pinned here as source shape, and each has an opt-out under reduced motion.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')

const FULL = stripComments(read('src/styles/legacy/09-trips-list.css'))
const REDUCED_AT = FULL.indexOf('@media (prefers-reduced-motion: reduce)')
const MAIN = FULL.slice(0, REDUCED_AT)
const REDUCED = FULL.slice(REDUCED_AT)

/** The body of the first rule whose selector list is exactly `selector`. */
function bodyOf(text: string, selector: string): string {
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].replace(/\s+/g, ' ').trim() === selector) return m[2]
  }
  return ''
}

describe('My trips motion uses tokens only', () => {
  it('has no raw duration outside the live dot ambient loop', () => {
    const offenders: string[] = []
    for (const m of FULL.matchAll(/(?:^|[;{\s])(transition|animation)\s*:([^;}]*)/g)) {
      const value = m[2]
      if (/\binfinite\b/.test(value)) continue
      for (const raw of value.matchAll(/(?<![\d.])[0-9]*\.?[0-9]+m?s\b/g)) {
        if (parseFloat(raw[0]) === 0) continue
        offenders.push(`${m[1]}: ${raw[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the settle ease to the date stamp and the score number', () => {
    const users = [...MAIN.matchAll(/([^{}]+)\{[^}]*var\(--ease-settle\)/g)].map(m => m[1].replace(/\s+/g, ' ').trim())
    expect(users.sort()).toEqual(['.mt-ring text', '.mt-stamp'])
  })
})

describe('the flip countdown', () => {
  it('flips each digit once, one stagger step apart', () => {
    const body = bodyOf(MAIN, '.mt-flip span')
    expect(body).toMatch(/animation:\s*mt-flip-in var\(--motion-slow\) var\(--ease-paper\) backwards/)
    expect(body).toMatch(/animation-delay:\s*calc\(var\(--stagger-step\) \* \(var\(--mt-i, 0\) \+ 1\)\)/)
    expect(body).not.toMatch(/infinite/)
    expect(MAIN).toMatch(/@keyframes mt-flip-in\s*\{\s*from\s*\{[^}]*rotateX\(/)
    expect(bodyOf(MAIN, '.mt-flip')).toMatch(/perspective:/)
  })

  it('sets the digit place from the capped stagger step', () => {
    const card = read('src/components/trips/UpNextCard.tsx')
    expect(card).toMatch(/'--mt-i': staggerStep\(index\)/)
  })
})

describe('the health ring', () => {
  it('fades its dasharray arc, and does not draw it', () => {
    const arc = bodyOf(MAIN, '.mt-ring-arc')
    expect(arc).toMatch(/animation:\s*mt-ring-fade var\(--motion-slower\) var\(--ease-paper\) backwards/)
    expect(MAIN).toMatch(/@keyframes mt-ring-fade\s*\{\s*from\s*\{\s*opacity:\s*0;\s*\}\s*\}/)
    expect(MAIN).not.toMatch(/mt-ring-draw/)
    const ring = read('src/components/trips/HealthRing.tsx')
    expect(ring).toContain('strokeDasharray={CIRCUMFERENCE}')
    expect(ring).not.toContain('--mt-ring-full')
  })

  it('pops the score number in after the arc begins', () => {
    const body = bodyOf(MAIN, '.mt-ring text')
    expect(body).toMatch(/animation:\s*mt-pop-in var\(--motion-fast\) var\(--ease-settle\) backwards/)
    expect(body).toMatch(/transform-box:\s*fill-box/)
  })
})

describe('the day strip', () => {
  it('rises each cell in turn and grows its tone bar from the left', () => {
    const cell = bodyOf(MAIN, '.mt-day')
    expect(cell).toMatch(/animation:\s*pageRise var\(--motion-slow\) var\(--ease-paper\) backwards/)
    expect(cell).toMatch(/animation-delay:\s*calc\(var\(--stagger-step\) \* var\(--mt-i, 0\)\)/)
    const bar = bodyOf(MAIN, '.mt-day-bar')
    expect(bar).toMatch(/animation:\s*mt-bar-grow var\(--motion-med\) var\(--ease-paper\) backwards/)
    expect(bar).toMatch(/transform-origin:\s*left center/)
  })

  it('caps the cell step at six', () => {
    const strip = read('src/components/trips/DayStrip.tsx')
    expect(strip).toContain("'--mt-i': staggerStep(index)")
  })
})

describe('the trip card and its cover', () => {
  it('lifts 2px on hover and on keyboard focus, on the paper ease', () => {
    const card = bodyOf(MAIN, '.mt-card')
    expect(card).toMatch(/transition:\s*transform var\(--motion-med\) var\(--ease-paper\), box-shadow var\(--motion-med\) var\(--ease-paper\)/)
    const lift = bodyOf(MAIN, '.mt-card:hover, .mt-card:has(.mt-card-link:focus-visible)')
    expect(lift).toMatch(/transform:\s*translateY\(-2px\)/)
    expect(lift).toMatch(/box-shadow:\s*var\(--shadow-card-hover\)/)
  })

  it('grows the cover art and the photo to 1.04 inside the clip', () => {
    const grow = bodyOf(
      MAIN,
      '.mt-card:hover .mt-motif, .mt-card:hover .mt-cover-img, .mt-card:has(.mt-card-link:focus-visible) .mt-motif, .mt-card:has(.mt-card-link:focus-visible) .mt-cover-img',
    )
    expect(grow).toMatch(/transform:\s*scale\(1\.04\)/)
    expect(bodyOf(MAIN, '.mt-motif, .mt-cover .mt-cover-img')).toMatch(/transition:\s*transform var\(--motion-med\) var\(--ease-paper\)/)
    expect(bodyOf(MAIN, '.mt-cover')).toMatch(/overflow:\s*hidden/)
  })

  it('keeps the entrance and the list exit', () => {
    expect(bodyOf(MAIN, '.mt-card')).toMatch(/animation:\s*cardIn var\(--motion-slow\) var\(--ease-out\) backwards/)
    const page = read('src/pages/TripsList.tsx')
    expect(page).toContain('usePresenceList(')
    expect(page).toContain('presence={presenceAttrs({ exiting })}')
  })
})

describe('the date stamp', () => {
  it('pops in once, after its own card', () => {
    const body = bodyOf(MAIN, '.mt-stamp')
    expect(body).toMatch(/animation:\s*mt-pop-in var\(--motion-med\) var\(--ease-settle\) backwards/)
    expect(body).toMatch(/animation-delay:\s*calc\(var\(--stagger-step\) \* \(var\(--mt-enter, 0\) \+ 2\)\)/)
    expect(MAIN).toMatch(/@keyframes mt-pop-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*transform:\s*scale\(\.4\);\s*\}\s*\}/)
    expect(read('src/components/trips/TripCard.tsx')).toContain("'--mt-enter': staggerStep(enterIndex)")
  })
})

describe('the Coming up toolbar', () => {
  it('moves the chips and the sort control on the fast clock', () => {
    const chip = bodyOf(MAIN, '.mt-chips .ex-chip')
    expect(chip).toMatch(/transition:\s*background-color var\(--motion-fast\) var\(--ease-paper\), color var\(--motion-fast\) var\(--ease-paper\)/)
    const sort = bodyOf(MAIN, '.mt-sort select')
    expect(sort).toMatch(/transition:\s*background-color var\(--motion-fast\) var\(--ease-paper\), color var\(--motion-fast\) var\(--ease-paper\)/)
    expect(bodyOf(MAIN, '.mt-sort select:hover')).toMatch(/background:/)
  })
})

describe('the Memories postcards', () => {
  it('rise into their own tilt and lift on hover', () => {
    const body = bodyOf(MAIN, '.mt-pc')
    expect(body).toMatch(/animation:\s*mt-pc-in var\(--motion-slow\) var\(--ease-paper\) backwards/)
    expect(body).toMatch(/transition:\s*transform var\(--motion-med\) var\(--ease-paper\), box-shadow var\(--motion-med\) var\(--ease-paper\)/)
    // No end frame: the card lands on its resting tilt and does not snap.
    expect(MAIN).toMatch(/@keyframes mt-pc-in\s*\{\s*from\s*\{[^}]*rotate\(var\(--mt-tilt, 0deg\)\)[^}]*\}\s*\}/)
    expect(bodyOf(MAIN, '.mt-pc:hover, .mt-pc:focus-within')).toMatch(/translateY\(-3px\) rotate\(0deg\)/)
    expect(read('src/components/trips/MemoriesSection.tsx')).toContain("'--mt-i': staggerStep(index)")
  })
})

describe('the page cascade reaches every My trips block', () => {
  it('puts the greeting, the draft banner and the catalog directly under the page root', () => {
    const page = read('src/pages/TripsList.tsx')
    expect(page).toContain('className="container trips-page page-enter"')
    // The catalog holds Up next, Coming up and Memories, so it carries all three.
    expect(page).toContain('<div className="mt-catalog">')
    expect(page).toMatch(/<MemoriesSection[\s\S]*?\/>\s*<\/div>\s*\)\)\}/)
    // The greeting and the draft banner sit at the root, not inside another wrapper.
    expect(page).toMatch(/<\/>\s*\}\s*\/>\s*\{view === 'trash'/)
    expect(page).toMatch(/\{view !== 'trash' && draft && \(\s*<DraftBanner/)
  })

  it('has the container cascade rule at the top level', () => {
    const shared = stripComments(read('src/styles/legacy/11-shared-page.css'))
    expect(shared).toMatch(/\.page-enter > \*\s*\{[^}]*animation:\s*pageRise var\(--motion-slow\) var\(--ease-(?:out|paper)\) backwards/)
  })
})

describe('reduced motion', () => {
  const stops = (selector: string, prop: 'animation' | 'transition') =>
    new RegExp(`(?:^|[}\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{[^}]*${prop}:\\s*none`).test(REDUCED)

  it('stops every My trips entrance', () => {
    for (const selector of ['.mt-flip span', '.mt-ring text', '.mt-ring-arc', '.mt-stamp', '.mt-card', '.mt-pc']) {
      expect(stops(selector, 'animation'), `${selector} keeps its animation under reduced motion`).toBe(true)
    }
    expect(REDUCED).toMatch(/\.mt-day,\s*\.mt-day-bar\s*\{\s*animation:\s*none/)
  })

  it('stops the hover, focus and toolbar transitions and the lift', () => {
    expect(REDUCED).toMatch(/\.mt-chips \.ex-chip,\s*\.mt-sort select\s*\{\s*transition:\s*none/)
    expect(REDUCED).toMatch(/\.mt-motif,\s*\.mt-cover \.mt-cover-img,\s*\.mt-seg button\s*\{\s*transition:\s*none/)
    expect(REDUCED).toMatch(/\.mt-card:hover,\s*\.mt-card:has\(\.mt-card-link:focus-visible\)\s*\{\s*transform:\s*none/)
    expect(REDUCED).toMatch(/\.mt-card:has\(\.mt-card-link:focus-visible\) \.mt-cover-img\s*\{\s*transform:\s*none/)
  })
})
