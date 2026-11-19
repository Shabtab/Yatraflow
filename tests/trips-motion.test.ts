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

  it('sets the arrival pace in one place: a double stagger step and the slower clock', () => {
    expect(MAIN).toContain(':where(.trips-page) { --mt-step: calc(var(--stagger-step) * 2); --mt-dur: var(--motion-slower); }')
  })
  it('keeps the settle ease to the score number (48px or smaller)', () => {
    const users = [...MAIN.matchAll(/([^{}]+)\{[^}]*var\(--ease-settle\)/g)].map(m => m[1].replace(/\s+/g, ' ').trim())
    expect(users.sort()).toEqual(['.mt-ring text'])
  })
})

describe('the flip countdown', () => {
  it('flips each digit once, one stagger step apart', () => {
    const body = bodyOf(MAIN, '.mt-flip span')
    expect(body).toMatch(/animation:\s*mt-flip-in var\(--mt-dur\) var\(--ease-paper\) backwards/)
    expect(body).toMatch(/animation-delay:\s*calc\(var\(--mt-step\) \* \(var\(--mt-i, 0\) \+ 1\)\)/)
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
    expect(arc).toMatch(/animation:\s*mt-ring-fade calc\(var\(--motion-slower\) \* 2\) var\(--ease-paper\) backwards/)
    expect(MAIN).toMatch(/@keyframes mt-ring-fade\s*\{\s*from\s*\{\s*opacity:\s*0;\s*\}\s*\}/)
    expect(MAIN).not.toMatch(/mt-ring-draw/)
    const ring = read('src/components/trips/HealthRing.tsx')
    expect(ring).toContain('strokeDasharray={CIRCUMFERENCE}')
    expect(ring).not.toContain('--mt-ring-full')
  })

  it('pops the score number in after the arc begins', () => {
    const body = bodyOf(MAIN, '.mt-ring text')
    expect(body).toMatch(/animation:\s*mt-pop-in var\(--motion-slow\) var\(--ease-settle\) backwards/)
    expect(body).toMatch(/transform-box:\s*fill-box/)
  })
})

describe('the day strip', () => {
  it('rises each cell in turn and grows its tone bar from the left', () => {
    const cell = bodyOf(MAIN, '.mt-day')
    expect(cell).toMatch(/animation:\s*pageRise var\(--mt-dur\) var\(--ease-paper\) backwards/)
    expect(cell).toMatch(/animation-delay:\s*calc\(var\(--mt-step\) \* var\(--mt-i, 0\)\)/)
    const bar = bodyOf(MAIN, '.mt-day-bar')
    expect(bar).toMatch(/animation:\s*mt-bar-grow var\(--mt-dur\) var\(--ease-paper\) backwards/)
    expect(bar).toMatch(/transform-origin:\s*left center/)
  })

  it('caps the cell step at six', () => {
    const strip = read('src/components/trips/DayStrip.tsx')
    expect(strip).toContain("'--mt-i': staggerStep(index)")
  })
})

describe('the trip card and its cover', () => {
  it('lifts 2px on hover and on keyboard focus, on the slow clock and ease-out', () => {
    const card = bodyOf(MAIN, '.mt-card')
    expect(card).toMatch(/transition:\s*transform var\(--motion-slow\) var\(--ease-out\);/)
    // Neither the shadow nor the edge animates on the card: both repaint the page every frame.
    expect(card).not.toMatch(/transition:[^;]*(box-shadow|border-color)/)
    const lift = bodyOf(MAIN, '.mt-card:hover, .mt-card:has(.mt-card-link:focus-visible)')
    expect(lift).toMatch(/transform:\s*translateY\(-2px\)/)
    expect(lift).not.toMatch(/border-color/)
  })

  it('fades a ready-made hover shadow on opacity, and keeps the wide hero still', () => {
    const layer = bodyOf(MAIN, '.mt-card::before')
    expect(layer).toMatch(/box-shadow:\s*var\(--shadow-card-hover\), inset 0 0 0 1px var\(--line-strong\)/)
    expect(layer).toMatch(/opacity:\s*0/)
    expect(layer).toMatch(/transition:\s*opacity var\(--motion-slow\) var\(--ease-out\)/)
    expect(bodyOf(MAIN, '.mt-card:hover::before, .mt-card:has(.mt-card-link:focus-visible)::before')).toMatch(/opacity:\s*1/)
    expect(bodyOf(MAIN, '.mt-feat:hover, .mt-feat:has(.mt-card-link:focus-visible)')).toMatch(/transform:\s*none/)
  })

  it('keeps the chips over the zooming cover free of backdrop blur', () => {
    // A blur over a moving image is recomputed every frame, so the cover zoom stutters.
    expect(bodyOf(MAIN, '.mt-stamp')).not.toMatch(/backdrop-filter/)
    expect(bodyOf(MAIN, '.mt-status')).not.toMatch(/backdrop-filter/)
  })

  it('grows the cover art and the photo to 1.035 inside the clip, on the slower clock', () => {
    const grow = bodyOf(
      MAIN,
      '.mt-card:hover .mt-motif, .mt-card:hover .mt-cover-img, .mt-card:has(.mt-card-link:focus-visible) .mt-motif, .mt-card:has(.mt-card-link:focus-visible) .mt-cover-img',
    )
    expect(grow).toMatch(/transform:\s*scale\(1\.035\)/)
    expect(bodyOf(MAIN, '.mt-motif, .mt-cover .mt-cover-img')).toMatch(/transition:\s*transform var\(--motion-slower\) var\(--ease-out\)/)
    expect(bodyOf(MAIN, '.mt-cover')).toMatch(/overflow:\s*hidden/)
  })

  it('keeps the entrance and the list exit', () => {
    expect(bodyOf(MAIN, '.mt-card')).toMatch(/animation:\s*mt-card-in var\(--mt-dur\) var\(--ease-out\) backwards/)
    // The entrance moves translate and scale only: transform belongs to the hover lift.
    expect(MAIN).toMatch(/@keyframes mt-card-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*translate:\s*0 14px;\s*scale:\s*\.98;\s*\}\s*\}/)
    const page = read('src/pages/TripsList.tsx')
    expect(page).toContain('usePresenceList(')
    expect(page).toContain('presence={presenceAttrs({ exiting })}')
  })
})

describe('the Clear filters button', () => {
  it('fades and slides in when it mounts, on translate, with a reduced-motion opt-out', () => {
    expect(bodyOf(MAIN, '.mt-clear')).toMatch(/animation:\s*mt-clear-in var\(--motion-med\) var\(--ease-out\) backwards/)
    expect(MAIN).toMatch(/@keyframes mt-clear-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*translate:\s*-6px 0;\s*\}\s*\}/)
    expect(REDUCED).toMatch(/\.mt-pc::before, \.mt-clear \{ transition: none; animation: none; \}/)
    expect(read('src/pages/TripsList.tsx')).toContain('className="btn btn-quiet mt-clear"')
  })
})

describe('the date stamp', () => {
  it('pops in once, after its own card', () => {
    const body = bodyOf(MAIN, '.mt-stamp')
    expect(body).toMatch(/animation:\s*mt-pop-in var\(--motion-slow\) var\(--ease-out\) backwards/)
    expect(body).toMatch(/animation-delay:\s*calc\(var\(--mt-step\) \* \(var\(--mt-enter, 0\) \+ var\(--mt-grid-at, 0\) \+ 2\)\)/)
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
    expect(body).toMatch(/animation:\s*mt-pc-in var\(--mt-dur\) var\(--ease-paper\) backwards/)
    expect(body).toMatch(/transition:\s*transform var\(--motion-slow\) var\(--ease-out\);/)
    expect(body).not.toMatch(/transition:[^;]*box-shadow/)
    expect(bodyOf(MAIN, '.mt-pc::before')).toMatch(/opacity:\s*0;\s*transition:\s*opacity var\(--motion-slow\) var\(--ease-out\)/)
    expect(bodyOf(MAIN, '.mt-pc:hover, .mt-pc:focus-within')).not.toMatch(/box-shadow/)
    // No end frame: the card lands on its resting tilt and does not snap.
    // The tilt stays on transform; the entrance moves translate and scale, so the two never blend as matrices.
    expect(MAIN).toMatch(/@keyframes mt-pc-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*translate:\s*0 14px;\s*scale:\s*\.98;\s*\}\s*\}/)
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

describe('the My trips cascade runs in reading order', () => {
  it('starts the greeting first and every other root block one step later', () => {
    expect(MAIN).toContain(':where(.trips-page.page-enter > *) { --mt-at: 1; }')
    expect(MAIN).toContain('.trips-page.page-enter > .mt-greet { --mt-at: 0; }')
    const body = bodyOf(MAIN, '.trips-page.page-enter > :nth-child(n)')
    expect(body).toMatch(/animation-name:\s*mt-block-in/)
    expect(body).toMatch(/animation-duration:\s*var\(--mt-dur\)/)
    expect(body).toMatch(/animation-delay:\s*calc\(var\(--mt-step\) \* var\(--mt-at\)\)/)
  })

  it('lets the blocks, not the catalog wrapper, carry the entrance', () => {
    expect(bodyOf(MAIN, '.trips-page.page-enter > .mt-catalog')).toMatch(/animation:\s*none/)
    const block = bodyOf(MAIN, '.mt-block')
    expect(block).toMatch(/animation:\s*mt-block-in var\(--mt-dur\) var\(--ease-paper\) backwards/)
    expect(block).toMatch(/animation-delay:\s*calc\(var\(--mt-step\) \* var\(--mt-at, 1\)\)/)
    const page = read('src/pages/TripsList.tsx')
    expect(page).toContain('<section className="mt-block" aria-labelledby={upNextTitleId}>')
    expect(page).toContain('<div className="mt-listhead mt-block">')
    // The refresh notice (a state block) rides a wrapper, so no `.yf-state` rule declares an animation.
    expect(page).toMatch(/<div className="mt-block">\s*<StateBlock\s+size="compact"\s+kind="kept"/)
  })

  it('puts the toolbar after Up next, and Memories after the toolbar', () => {
    expect(bodyOf(MAIN, '.mt-listhead')).toMatch(/--mt-at:\s*2/)
    const memories = bodyOf(MAIN, '.mt-memories')
    expect(memories).toMatch(/--mt-at:\s*3/)
    expect(memories).toMatch(/animation:\s*mt-block-in var\(--mt-dur\) var\(--ease-paper\) backwards/)
    expect(memories).toMatch(/animation-delay:\s*calc\(var\(--mt-step\) \* var\(--mt-at\)\)/)
  })

  it('moves translate only, so no entrance owns transform', () => {
    expect(MAIN).toMatch(/@keyframes mt-block-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*translate:\s*0 8px;\s*\}\s*\}/)
  })

  it('starts the first grid at step 3, after the toolbar, from a base on the page root', () => {
    expect(MAIN).toContain('.trips-page[data-arriving] { --mt-grid-at: 3; }')
    const card = read('src/components/trips/TripCard.tsx')
    expect(card).toContain('calc(var(--mt-step) * (var(--mt-grid-at, 0) + ${staggerStep(enterIndex)}))')
  })

  it('clears the base after the arrival, so a Grid | List switch plays at once', () => {
    const page = read('src/pages/TripsList.tsx')
    expect(page).toContain('className="container trips-page page-enter" ref={rootRef} data-arriving=""')
    expect(page).toContain('useArrival(rootRef)')
    const hook = read('src/lib/useArrival.ts')
    expect(hook).toMatch(/removeAttribute\('data-arriving'\)/)
    expect(hook).toMatch(/motionTiming\('--motion-slower'\)\.duration \* ARRIVAL_STEPS/)
    // No registered property: an animation's own delay ignores a custom property that a keyframe animates.
    expect(MAIN).not.toMatch(/@property --mt-grid-at/)
  })
})

describe('the lazy-route loader waits before it shows', () => {
  const shared = stripComments(read('src/styles/legacy/11-shared-page.css'))
  const app = read('src/App.tsx')

  it('gives the fallback root the grace class', () => {
    expect(app).toContain('<div className="container page-enter route-fallback"><StateBlock kind="loading"')
  })

  it('fades in after the grace period, on tokens, with a backwards fill', () => {
    const body = bodyOf(shared, ".route-fallback, :is(.ex-page, .trips-page) .yf-state[data-kind='loading']")
    expect(body).toMatch(/animation:\s*loaderIn var\(--motion-med\) var\(--ease-out\) calc\(var\(--motion-slow\) \+ var\(--motion-fast\)\) backwards/)
    expect(shared).toMatch(/@keyframes loaderIn\s*\{\s*from\s*\{\s*opacity:\s*0;\s*\}\s*\}/)
  })

  it('holds a page of height, so the footer stays below the fold', () => {
    expect(bodyOf(shared, '.route-fallback')).toMatch(/min-height:\s*calc\(100dvh - var\(--nav-h\)\)/)
  })

  it('keeps the grace period under reduced motion and drops only the fade', () => {
    const reduced = shared.slice(shared.indexOf('@keyframes loaderIn'))
    expect(reduced).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.route-fallback,[\s\S]*?animation-duration:\s*0s/)
    expect(reduced).not.toMatch(/\.route-fallback[^{]*\{[^}]*animation:\s*none/)
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
    // The root blocks, the toolbar and Memories stop too.
    expect(REDUCED).toMatch(/\.trips-page\.page-enter > :nth-child\(n\),\s*\.mt-block,\s*\.mt-memories\s*\{\s*animation:\s*none/)
  })

  it('stops the hover, focus and toolbar transitions and the lift', () => {
    expect(REDUCED).toMatch(/\.mt-chips \.ex-chip,\s*\.mt-sort select\s*\{\s*transition:\s*none/)
    expect(REDUCED).toMatch(/\.mt-motif,\s*\.mt-cover \.mt-cover-img,\s*\.mt-seg button\s*\{\s*transition:\s*none/)
    expect(REDUCED).toMatch(/\.mt-card:hover,\s*\.mt-card:has\(\.mt-card-link:focus-visible\)\s*\{\s*transform:\s*none/)
    expect(REDUCED).toMatch(/\.mt-card:has\(\.mt-card-link:focus-visible\) \.mt-cover-img\s*\{\s*transform:\s*none/)
  })
})
