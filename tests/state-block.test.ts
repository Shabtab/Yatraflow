// Shared state block: the ARIA role per kind, and the source contract the
// Explore wrapper and the yf-state CSS rely on. Node env, no DOM.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { stateBlockHasBody, stateBlockRole, stateBlockRootClass } from '../src/components/page/StateBlock'

const SOURCE = readFileSync(join(process.cwd(), 'src/components/page/StateBlock.tsx'), 'utf8').replace(/\r\n/g, '\n')

describe('stateBlockRole', () => {
  it('announces loading as a polite status', () => {
    expect(stateBlockRole('loading')).toBe('status')
  })

  it('announces a failed read as an alert', () => {
    expect(stateBlockRole('failed')).toBe('alert')
  })

  it('keeps an empty state silent', () => {
    expect(stateBlockRole('empty')).toBeUndefined()
  })
})

const CSS = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8').replace(/\r\n/g, '\n')
const COMPACT_BLOCK = '/* ===== Shared page components: compact state block and surface roots ===== */'

describe('stateBlockRootClass', () => {
  it('gives the full block the base class alone', () => {
    expect(stateBlockRootClass()).toBe('yf-state')
    expect(stateBlockRootClass('full')).toBe('yf-state')
  })

  it('adds the compact modifier for the compact size only', () => {
    expect(stateBlockRootClass('compact')).toBe('yf-state yf-state--compact')
  })
})

describe('stateBlockHasBody', () => {
  it('shows no paragraph for an absent or empty body', () => {
    expect(stateBlockHasBody(undefined)).toBe(false)
    expect(stateBlockHasBody(null)).toBe(false)
    expect(stateBlockHasBody(false)).toBe(false)
    expect(stateBlockHasBody('')).toBe(false)
  })

  it('shows a plain string and a ReactNode with inline markup', () => {
    expect(stateBlockHasBody('Check your connection and try again.')).toBe(true)
    expect(stateBlockHasBody(createElement('b', null, 'Bold copy'))).toBe(true)
  })
})

describe('StateBlock size and body contract', () => {
  it('takes size with full as the default and sets the root class from the helper', () => {
    expect(SOURCE).toMatch(/size\?: StateSize/)
    expect(SOURCE).toContain("titleLevel = 'h3', size = 'full'")
    expect(SOURCE).toContain('className={stateBlockRootClass(size)}')
  })

  it('types the body as a ReactNode and renders it only when it has copy', () => {
    expect(SOURCE).toContain('body?: ReactNode')
    expect(SOURCE).toContain('{stateBlockHasBody(body) && <p className="yf-state-body">{body}</p>}')
  })
})

describe('compact state block styles', () => {
  // Comments are stripped, so a note that names a value cannot trip a check.
  const block = () => CSS.slice(CSS.indexOf(COMPACT_BLOCK)).replace(/\/\*[\s\S]*?\*\//g, '')

  it('has the compact section in the stylesheet', () => {
    expect(CSS.indexOf(COMPACT_BLOCK)).toBeGreaterThan(-1)
  })

  it('drops the dashed border and sets the compact padding, gap and margin', () => {
    expect(block()).toContain('.yf-state.yf-state--compact { gap: 6px; margin-top: 8px; padding: 12px 16px; border: 0; }')
  })

  it('sets the compact title one step below the full 20px title', () => {
    expect(CSS).toMatch(/\.yf-state-title \{\s*margin: 0;[^}]*font-size: 20px;/)
    expect(block()).toContain('.yf-state.yf-state--compact .yf-state-title { font-size: 18px; line-height: 1.3; }')
  })

  it('takes every padding, margin and gap value from the spacing ladder', () => {
    const ladder = new Set([0, 2, 4, 6, 8, 12, 14, 16, 20, 22, 24])
    const values = [...block().matchAll(/\b(?:gap|margin|padding)(?:-top|-bottom|-left|-right)?:\s*([^;}]+)/g)]
      .flatMap((m) => [...m[1].matchAll(/(\d+(?:\.\d+)?)px/g)].map((n) => Number(n[1])))
    expect(values.length).toBeGreaterThan(0)
    for (const v of values) expect(ladder.has(v), `${v}px is off the ladder`).toBe(true)
  })

  it('uses the motion tokens and no raw duration', () => {
    expect(block()).not.toMatch(/\d+ms/)
  })
})

describe('StateBlock source contract', () => {
  it('handles role and aria-live in the markup', () => {
    expect(SOURCE).toContain('role={role}')
    expect(SOURCE).toContain("aria-live={isLoading ? 'polite' : undefined}")
    expect(SOURCE).toContain('stateBlockRole(kind)')
  })

  it('names all three kinds', () => {
    expect(SOURCE).toContain("'loading'")
    expect(SOURCE).toContain("'failed'")
    expect(SOURCE).toContain("'empty'")
  })

  it('emits the shared yf-state class names', () => {
    for (const className of ['yf-state-icon', 'yf-state-title', 'yf-state-body', 'yf-state-actions']) {
      expect(SOURCE).toContain(`"${className}"`)
    }
  })
})
