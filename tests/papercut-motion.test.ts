import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readCssSource } from '../scripts/css-source-graph.mjs'

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const css = readCssSource('src/styles.css')
const sourceCss = read('docs/redesign/papercut-warmth/sources/papercut-tokens.css')
const gallery = read('dev/papercut-tokens.html')
const browserCheck = read('scripts/papercut-motion-check.mjs')

const declarations = (block: string) => Object.fromEntries(
  [...block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)]
    .map(match => [match[1], match[2].replace(/\s+/g, '')]),
)

describe('Papercut motion foundation', () => {
  it('keeps every supplied root and dark token value in the runtime foundation', () => {
    const sourceRoot = sourceCss.match(/^:root\s*\{([\s\S]*?)\n\}/m)?.[1] ?? ''
    const sourceDark = sourceCss.match(/^\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/m)?.[1] ?? ''
    const runtime = css.slice(css.indexOf('/* Papercut foundations */'), css.indexOf('/* ===== Papercut motion foundation ===== */'))
    const runtimeDark = runtime.slice(runtime.indexOf(":root:where([data-theme='dark'])"), runtime.indexOf(':root, [data-theme='))
    const runtimePairs = new Set(
      [...css.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)]
        .map(match => `${match[1]}=${match[2].replace(/\s+/g, '')}`),
    )
    expect(sourceRoot).not.toBe('')
    expect(sourceDark).not.toBe('')
    for (const [name, value] of Object.entries(declarations(sourceRoot))) {
      expect(runtimePairs.has(`${name}=${value}`), `--${name}`).toBe(true)
    }
    const darkDeclarations = declarations(runtimeDark)
    for (const [name, value] of Object.entries(declarations(sourceDark))) {
      expect(darkDeclarations[name], `--${name}`).toBe(value)
    }
  })

  it('pins the Linen palette and shared role aliases', () => {
    const light = [
      '--pw-paper: #F8F5F0', '--pw-sunken: #ECE7DE', '--pw-soft: #F2EDE4',
      '--pw-card: #FEFDFB', '--pw-line: #DFDBD1', '--pw-line-soft: #E8E4DB',
      '--pw-ink: #22201E', '--pw-ink-2: #57524C', '--pw-ink-3: #6B645C',
      '--pw-ink-4: #8C857B',
    ]
    const dark = [
      '--pw-paper: #0C1420', '--pw-sunken: #101B2B', '--pw-soft: #182740',
      '--pw-card: #16233A', '--pw-raised: #1A2A44', '--pw-line: #27395A',
      '--pw-line-soft: #1E3050', '--pw-ink: #E8EFF5', '--pw-ink-2: #ADBCCF',
      '--pw-ink-3: #8FA0B5', '--pw-ink-4: #5F757F',
    ]
    for (const value of [...light, ...dark]) expect(css).toContain(value)
    expect(css).toContain('--shadow-navy-rgb: 34, 32, 30')
    expect(css).toContain('--font-serif: var(--font-display)')
    expect(css).toContain('--font-hand: var(--font-body)')
    expect(css).toContain('--pw-display-xl: 700 56px/1.04 var(--font-display)')
    expect(css).toContain('--pw-body: 500 15px/1.5 var(--font-body)')
    expect(css).not.toMatch(/#FBF5EA|#F3E6D3|#FFFDF8|rgba\(96,\s*60,\s*24/)
    // The cool-mist neutrals must not come back: Linen replaced them, and a
    // half-migrated file would read as cool paper with warm ink.
    expect(css).not.toMatch(/#F0F8F6|#E0EBE9|#EAF3F2|#FCFEFD|#D3DEDC|#DCE7E6/)
  })

  it('pins six stagger items and holds later items on step five', () => {
    expect(css).toContain('--stagger-step: 60ms')
    expect(css).toMatch(/--stagger-index:\s*5/)
    expect(css).toMatch(/:nth-child\(n\+7\)/)
    expect(css).toMatch(/calc\(var\(--stagger-step\) \* min\(var\(--i, 0\), 5\)\)/)
  })

  it('pins each named exit at its full token lifetime with no stagger', () => {
    expect(css).not.toContain('--exit-factor')
    expect(css).toMatch(/presence-out var\(--motion-med\) var\(--ease-exit\) 0s forwards/)
    expect(css).toMatch(/ex-clear-out var\(--motion-med\) var\(--ease-exit\) 0s forwards/)
    expect(css).toMatch(/mapCollapse var\(--motion-slow\) var\(--ease-exit\) 0s both/)
    expect(css).toMatch(/opacity var\(--motion-med\) var\(--ease-exit\)/)
    expect(css).toMatch(/visibility 0s linear var\(--motion-med\)/)
  })

  it('uses an immediate reduced-motion lifecycle and keeps final art outside it', () => {
    expect(css).not.toContain('--reduced-motion-fade')
    expect(css).not.toContain('@keyframes reducedFade')
    const reducedStart = css.indexOf('/* Reduced motion is immediate.')
    const reducedEnd = css.indexOf('/* Reduced exits keep', reducedStart)
    const block = reducedStart >= 0 && reducedEnd > reducedStart ? css.slice(reducedStart, reducedEnd) : ''
    expect(block).toContain('animation: none !important')
    expect(block).toContain('animation-delay: 0s !important')
    expect(block).toContain("):not([data-presence='exit'])")
    expect(block).not.toMatch(/\.rm-|\.ovw-bar|\.tr\b|opacity:\s*0/)
  })

  it('keeps reduced exits and map unmounts immediate', () => {
    const reducedExitRule = css.lastIndexOf('/* Reduced exits keep')
    const exitRule = css.indexOf(":is([data-presence='exit'])", reducedExitRule)
    expect(reducedExitRule).toBeGreaterThan(-1)
    expect(exitRule).toBeGreaterThan(-1)
    expect(exitRule).toBeGreaterThan(reducedExitRule)
    expect(css.slice(reducedExitRule)).toMatch(/:is\(\[data-presence='exit'\]\)[\s\S]*animation:\s*none !important/)
    expect(css.slice(reducedExitRule)).toMatch(/\.map-shell--closing:is\(\.map-shell--closing\)[\s\S]*animation:\s*none !important/)
  })

  it('keeps the stagger cap in every shared entrance helper', () => {
    const files = [
      'src/components/page/Surface.tsx',
      'src/components/explore/ExploreCard.tsx',
      'src/components/PubCard.tsx',
      'src/components/trips/TripCard.tsx',
      'src/components/trips/SavedShelfSection.tsx',
      'src/components/trips/OverviewRouteCard.tsx',
      'src/components/storefront/CoverPlate.tsx',
      'src/components/storefront/WhatIsInside.tsx',
    ]
    for (const file of files) {
      const source = read(file)
      expect(source, file).toMatch(/stagger(?:Delay|Step)/)
      expect(source, file).not.toMatch(/Math\.min\((?:enterIndex|index|i|n|j)\s*,\s*8\)/)
    }
  })

  it('keeps the browser gallery checks on real computed state', () => {
    expect(gallery).toContain('Array.from({ length: 8 }')
    expect(gallery).toContain('class="gallery-stagger-item"')
    expect(gallery).toContain('id="replay-stagger"')
    expect(gallery).toContain('id="replay-exit"')
    expect(gallery).toContain('id="replay-reduced"')
    expect(gallery).toContain("matchMedia('(prefers-reduced-motion: reduce)')")
    expect(browserCheck).toContain('getAnimations()')
    expect(browserCheck).toContain('getBoundingClientRect()')
    expect(browserCheck).toContain('scrollWidth')
    expect(browserCheck).toContain('App lifecycle failed')
    expect(browserCheck).toContain("mapExit[1] === 360 && mapExit[2] === 'mapCollapse'")
    expect(browserCheck).toContain('EXPECTED_PALETTE')
    expect(browserCheck).toContain('document.fonts.check')
    expect(browserCheck).toContain('contrast')
  })

  it('keeps settle easing off ordinary transitions and on the small gallery pop only', () => {
    const bounceRules = [...css.matchAll(/([^{}]+)\{[^}]*var\(--ease-settle\)/g)]
      .map(match => match[1].trim())
      // The Settings rail's 18px edited-count badge pops in on the settle ease: the
      // badge case the motion tokens doc allows (tests/settings-entrance-motion.test.ts).
      .filter(selector => selector !== '.tset-nav-item i')
    expect(bounceRules).toEqual([])
    expect(css).not.toContain('.save-heart.save-heart')
    expect(gallery).toMatch(/\.gallery-final-pin\s*\{[^}]*width:\s*20px[^}]*height:\s*20px/)
    expect(gallery).toMatch(/\.gallery-final-pin\s*\{[^}]*animation:\s*galleryPinIn var\(--motion-fast\) var\(--ease-settle\)/)
  })
})
