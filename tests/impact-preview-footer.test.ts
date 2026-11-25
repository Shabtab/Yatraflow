import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readFileSync(
  new URL('../src/styles/legacy/02-select-and-print.css', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n')

const tsx = readFileSync(new URL('../src/components/ImpactPreview.tsx', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n')

/** Text of the first block that starts at `open` with `{` and matches its brace. */
function blockAfter(source: string, open: number): string {
  const start = source.indexOf('{', open)
  let depth = 0
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start + 1, i)
    }
  }
  return ''
}

function phoneQuery(): string {
  const open = css.indexOf('@media (max-width: 640px)')
  expect(open, 'the phone media query is present').toBeGreaterThan(-1)
  return blockAfter(css, open)
}

function actionRule(): string {
  const block = phoneQuery()
  const at = block.indexOf('.impact-actions')
  expect(at, '.impact-actions is styled inside the phone query').toBeGreaterThan(-1)
  return blockAfter(block, at)
}

describe('the change preview action row is a sticky footer on a phone', () => {
  it('sticks to the bottom of the panel scroll area', () => {
    const rule = actionRule()
    expect(rule).toMatch(/position:\s*sticky/)
    expect(rule).toMatch(/bottom:\s*0/)
  })

  it('hides the warnings behind it and respects the safe area', () => {
    const rule = actionRule()
    expect(rule).toMatch(/background:\s*var\(--card\)/)
    expect(rule).toMatch(/border-top:\s*1px solid var\(--line\)/)
    expect(rule).toMatch(/padding:\s*10px 24px calc\(10px \+ var\(--safe-bottom\)\)/)
  })

  it('uses tokens only, with no raw colour in the new rules', () => {
    expect(actionRule()).not.toMatch(/#[0-9a-fA-F]{3,8}/)
    expect(actionRule()).not.toMatch(/rgba?\(/)
  })

  it('keeps the scroll region focusable and labelled, with the buttons inside it', () => {
    expect(tsx).toMatch(/className="impact-panel" role="region" tabIndex=\{0\} aria-label="Impact preview"/)
    const region = tsx.indexOf('className="impact-panel"')
    const actions = tsx.indexOf('className="impact-actions"')
    expect(actions).toBeGreaterThan(region)
  })
})
