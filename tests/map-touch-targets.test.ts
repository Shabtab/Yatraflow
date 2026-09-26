// ============ The map shapes a thumb aims at (#333 A10) ============
// The pin (30px) and the tear (34px) both sat under the 40px coarse-pointer floor
// the rest of the app's controls keep. They cannot simply grow — the pin is a flex
// circle inside MapLibre's marker wrapper and the tear is a rotated square, so a
// min-width/height moves the map instead of the target — so both take an invisible
// hit area. These pin the shapes of that fix, including the two things that would
// be easy to get wrong: stretching the tear's ::after (which draws its tail), and
// inventing a target for the flag, which is decoration.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'src', 'styles.css'), 'utf8')

describe('coarse-pointer hit areas on the map shapes (A10)', () => {
  it('the pin and the tear both get one', () => {
    const block = /@media \(pointer: coarse\) \{[^}]*\.yf-map-pin::before,\s*\.yf-map-tear::before\s*\{[^}]*inset: -8px/.exec(css)
    expect(block, 'no coarse-pointer hit area covering the pin and the tear').not.toBeNull()
  })

  it('the tear keeps its drawn tail — the slop is ::before, never ::after', () => {
    // ::after is the teardrop's tail; attaching a hit area to it would stretch the
    // drawn shape, which is a visual change pretending to be an a11y one.
    expect(css).toMatch(/\.yf-map-tear::after\s*\{/)
    const tailRule = /\.yf-map-tear::after\s*\{[^}]*\}/.exec(css)
    expect(tailRule![0]).not.toContain('inset: -8px')
  })

  it('the pin is a positioning context for its own hit area', () => {
    // Without this the ::before resolves against whatever ancestor happens to be
    // positioned, and the tap target silently lands somewhere else on the map.
    const pin = /\.yf-map-pin \{[^}]*\}/.exec(css)
    expect(pin, 'the pin rule is missing or reshaped').not.toBeNull()
    expect(pin![0]).toMatch(/position: relative/)
  })

  it('the flag is given no target, because it is not tappable', () => {
    // Rendered as <span className="yf-map-pin yf-map-flag"> with no handler, so it
    // already inherits the pin's area; a rule of its own would advertise an
    // interaction that does not exist.
    expect(css).not.toMatch(/\.yf-map-flag::(before|after)/)
  })
})