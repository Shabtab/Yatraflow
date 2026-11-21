import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { railScrollToReveal } from '../src/lib/railOverflow'

/* #1007: a long trip used to wrap the map's day chips into a second row.
   These source pins keep the strip on one sideways-scrolling row. */

const root = fileURLToPath(new URL('../', import.meta.url))
const css = readFileSync(`${root}src/styles/components/map-v2-rail.css`, 'utf8').replace(/\r\n/g, '\n')
const chrome = readFileSync(`${root}src/components/map/MapWorkspaceChrome.tsx`, 'utf8').replace(/\r\n/g, '\n')

function ruleText(selector: string): string {
  const at = css.indexOf(selector)
  expect(at, `missing CSS rule ${selector}`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open))
}

describe('map day chips', () => {
  it('keeps the chip row unwrapped and scrolls it sideways', () => {
    const strip = ruleText('.mv2-workspace .mv2-day-strip')
    expect(strip).toMatch(/flex-wrap:\s*nowrap/)
    expect(strip).toMatch(/overflow-x:\s*auto/)
    expect(strip).not.toMatch(/flex-wrap:\s*wrap\b/)
    expect(css).not.toMatch(/\.mv2-workspace \.mv2-day-strip \{[^}]*flex-wrap:\s*wrap\b/)
  })

  it('hides the scrollbar without disabling touch, wheel or trackpad scrolling', () => {
    const strip = ruleText('.mv2-workspace .mv2-day-strip')
    expect(strip).toMatch(/scrollbar-width:\s*none/)
    expect(css).toMatch(/\.mv2-workspace \.mv2-day-strip::-webkit-scrollbar\s*\{\s*display:\s*none/)
    expect(strip).not.toMatch(/overflow:\s*hidden/)
  })

  it('fades only the side that still holds chips', () => {
    expect(ruleText('.mv2-workspace .mv2-day-strip')).toMatch(/mask-image:\s*linear-gradient/)
    expect(css).toMatch(/\.mv2-day-strip\[data-overflow='start'\]/)
    expect(css).toMatch(/\.mv2-day-strip\[data-overflow='middle'\]/)
    expect(css).toMatch(/\.mv2-day-strip\[data-overflow='end'\]/)
    expect(chrome).toMatch(/data-overflow=\{dayOverflow\}/)
    expect(chrome).toMatch(/railOverflow\(strip\.scrollLeft, strip\.scrollWidth, strip\.clientWidth\)/)
  })

  it('keeps the calendar button beside the row and reveals the selected day', () => {
    const footer = ruleText('.mv2-workspace .mv2-day-footer')
    const link = ruleText('.mv2-workspace .mv2-day-footer > .mv2-timeline-link')
    expect(footer).toMatch(/flex-direction:\s*row/)
    expect(footer).toMatch(/align-items:\s*center/)
    expect(link).toMatch(/flex:\s*none/)
    expect(chrome).toMatch(/strip\.scrollLeft = railScrollToReveal\(/)
    // scrollIntoView also scrolls the page and the rail, not only the strip.
    expect(chrome).not.toMatch(/selected\??\.scrollIntoView\(/)
    expect(chrome).not.toMatch(/inline: 'nearest'/)
  })

  it('moves the strip just far enough to show the selected day', () => {
    // 30 chips of 40px in a 318px strip: day 12 sits at 440 to 480.
    expect(railScrollToReveal(0, 1200, 318, 440, 480)).toBe(162)
    // Already in view: the strip keeps its position.
    expect(railScrollToReveal(200, 1200, 318, 440, 480)).toBe(200)
    // Behind the left edge: the strip moves back to the chip's start.
    expect(railScrollToReveal(600, 1200, 318, 440, 480)).toBe(440)
    // A strip that fits does not move.
    expect(railScrollToReveal(0, 300, 318, 40, 80)).toBe(0)
  })
})
