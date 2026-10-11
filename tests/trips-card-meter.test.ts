// ============ My trips meter — source pins ============
// The trip card drops its meter. Up next keeps one meter, labelled through
// meterLabel(). These pins read source text, so they judge code and not prose:
// comments are stripped before any scan.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

/** TSX source with its comments removed. */
function stripTsComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/** CSS source with its block comments removed. */
function stripCssComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The body of the innermost block that holds `needle`. Braces are matched by
 *  depth, so a block nested inside a container or media query still resolves. */
function enclosingBlockBody(source: string, needle: string): string {
  const at = source.indexOf(needle)
  let depth = 0
  for (let index = at - 1; index >= 0; index--) {
    const character = source[index]
    if (character === '}') {
      depth++
      continue
    }
    if (character !== '{') continue
    if (depth > 0) {
      depth--
      continue
    }
    let level = 0
    for (let closing = index; closing < source.length; closing++) {
      if (source[closing] === '{') level++
      if (source[closing] === '}') level--
      if (level === 0) return source.slice(index + 1, closing)
    }
    throw new Error('the enclosing block never closes')
  }
  throw new Error('the needle sits outside every block')
}

const tripCardSource = stripTsComments(read('../src/components/trips/TripCard.tsx'))
const upNextSource = stripTsComments(read('../src/components/trips/UpNextCard.tsx'))
const stylesSource = stripCssComments(read('../src/styles.css'))

describe('TripCard drops the meter', () => {
  it('has no progressbar role, in either quote style', () => {
    expect(tripCardSource).not.toMatch(/role\s*=\s*(["']|\{\s*["'`])progressbar/)
  })
  it('has no card meter class', () => {
    expect(tripCardSource).not.toContain('mt-card-meter')
  })
})

describe('UpNextCard labels its one meter through meterLabel', () => {
  it('calls meterLabel(', () => {
    expect(upNextSource).toContain('meterLabel(')
  })
  it('keeps the old "days planned" wording out of the code', () => {
    expect(upNextSource).not.toContain('days planned')
  })
})

describe('the desktop list layout gives the next-step row a grid column', () => {
  const listRowAnchor = '.mt-grid.is-list .mt-card-main { display: grid; grid-template-columns: minmax(0, 1.6fr) 150px'

  it('finds the list row rule exactly once', () => {
    expect(stylesSource.split(listRowAnchor).length - 1).toBe(1)
  })
  it('places a .mt-task rule with a grid-column inside that same desktop block', () => {
    const desktopBlock = enclosingBlockBody(stylesSource, listRowAnchor)
    const taskRules = [...desktopBlock.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector]) => /\.mt-task(?![\w-])/.test(selector))
    expect(taskRules.length, 'the desktop block needs a .mt-task rule').toBeGreaterThan(0)
    expect(taskRules.some(([, , declarations]) => /grid-column\s*:/.test(declarations))).toBe(true)
  })
})
