// My trips states: the page renders its loading, failed and empty states
// through the shared StateBlock. Node env, no DOM: this reads the page source.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = readFileSync(join(process.cwd(), 'src/pages/TripsList.tsx'), 'utf8')

describe('My trips state blocks', () => {
  it('imports the shared StateBlock', () => {
    expect(SOURCE).toMatch(/import \{ StateBlock \} from '\.\.\/components\/page\/StateBlock'/)
  })

  it('no longer renders the old empty-state component or the old loading block', () => {
    expect(SOURCE).not.toContain('<EmptyState')
    expect(SOURCE).not.toContain('loading-block')
  })

  it('renders loading, failed and empty states as StateBlock kinds', () => {
    expect(SOURCE).toMatch(/<StateBlock\s+kind="loading"/)
    expect(SOURCE).toMatch(/<StateBlock\s+kind="failed"/)
    expect(SOURCE).toMatch(/<StateBlock\s+kind="empty"/)
  })
})
