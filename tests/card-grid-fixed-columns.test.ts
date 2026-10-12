// ============ Card grids — fixed columns, no spanning card ============
// The My trips grid and the Explore grid keep two columns at the middle width
// and three at the wide width, whatever the result count. One result is one
// normal card in the first cell. The wide card form belongs to Up next and to
// the Explore Featured card only. These pins read source text, so they judge
// code and not prose: comments are stripped before any scan.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

/** Source with block comments and whole-line comments removed. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** The body of the first block whose header matches `header`, braces balanced. */
function blockBody(source: string, header: string): string {
  const headerStart = source.indexOf(header)
  expect(headerStart, `block header not found: ${header}`).toBeGreaterThanOrEqual(0)
  const openBrace = source.indexOf('{', headerStart)
  let depth = 0
  for (let i = openBrace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') depth -= 1
    if (depth === 0) return source.slice(openBrace + 1, i)
  }
  throw new Error(`block not closed: ${header}`)
}

const css = stripComments(read('../src/styles.css'))
const tripsListSource = stripComments(read('../src/pages/TripsList.tsx'))
const tripsCardSource = stripComments(read('../src/lib/tripsCard.ts'))

describe('card grids keep a fixed column count', () => {
  it('styles.css has no lone-card attribute and no spanning last-child rule on a card', () => {
    expect(css).not.toContain('data-lone-')
    expect(css).not.toMatch(/\.(mt|ex)-card:last-child:nth-child\(/)
    expect(css).not.toMatch(/\.(mt|ex)-card:nth-child\([^)]*\):last-child/)
    expect(css).not.toMatch(/\.(mt|ex)-card:last-child[^{]*\{[^}]*grid-column:\s*1\s*\/\s*-1/)
  })

  it('styles.css does not read a per-result column count', () => {
    expect(css).not.toMatch(/--mt-c[23]\b/)
  })

  it('the My trips page sets no column count and no lone-card attribute', () => {
    expect(tripsListSource).not.toContain('gridShape')
    expect(tripsListSource).not.toContain('data-lone')
    expect(tripsListSource).not.toMatch(/--mt-c[23]\b/)
    expect(tripsCardSource).not.toContain('gridShape')
  })

  const grids = [
    { name: 'My trips', container: 'mt-catalog', selector: '.mt-grid' },
    { name: 'Explore', container: 'ex-main', selector: '.ex-grid' },
  ]

  for (const { name, container, selector } of grids) {
    it(`${name}: one result keeps the column tracks of a full grid`, () => {
      const middle = blockBody(css, `@container ${container} (min-width: 560px) {`)
      const wide = blockBody(css, `@container ${container} (min-width: 880px) {`)
      const middleGrid = blockBody(middle, `${selector} {`)
      const wideGrid = blockBody(wide, `${selector} {`)
      expect(middleGrid).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
      expect(wideGrid).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/)
    })
  }
})
