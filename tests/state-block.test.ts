// Shared state block: the ARIA role per kind, and the source contract the
// Explore wrapper and the yf-state CSS rely on. Node env, no DOM.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stateBlockRole } from '../src/components/page/StateBlock'

const SOURCE = readFileSync(join(process.cwd(), 'src/components/page/StateBlock.tsx'), 'utf8')

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
    for (const className of ['yf-state', 'yf-state-icon', 'yf-state-title', 'yf-state-body', 'yf-state-actions']) {
      expect(SOURCE).toContain(`"${className}"`)
    }
  })
})
