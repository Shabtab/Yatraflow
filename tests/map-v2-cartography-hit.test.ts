import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/components/map/mapMarks.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const coarse = css.split('@media (pointer: coarse)').slice(1).join('\n')

// The browser run with elementFromPoint is in the report evidence (hit-areas.json).
// This guard keeps the rules that give each mark a 44px pad on a coarse pointer.
describe('coarse pointer hit areas', () => {
  it('gives pick, slot, warning and add marks a 44px pad', () => {
    for (const selector of ['.yf-map-pin--slot::before', '.yf-map-idea-add::before', '.mv2-warn-diamond::before']) expect(coarse).toContain(selector)
    expect(coarse).toMatch(/width: 44px; height: 44px/)
  })

  it('pads a turned diamond so a 44px square fits inside', () => {
    expect(coarse).toMatch(/\.mv2-warn-diamond::before \{ width: 62px; height: 62px; \}/)
  })

  it('raises toolbar controls and omnibar to 44px', () => {
    expect(coarse).toMatch(/\.yf-map-ctrls button[^{]*\{ min-width: 44px; min-height: 44px; \}/)
    expect(coarse).toMatch(/\.mv2-omnibar input, \.mv2-omnibar \.btn \{ min-height: 44px; \}/)
  })

  it('keeps the omnibar buttons at 44px on a fine pointer too', () => {
    expect(css.split('\n')).toContain('.mv2-omnibar .btn { min-height: 44px; }')
  })
})
