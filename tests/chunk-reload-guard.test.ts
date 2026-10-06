// #575 Face B — the stale-chunk reload guard is one-shot per TAB SESSION.
// The old code cleared the flag in componentDidMount, but React runs that
// before the componentDidCatch callback in the same commit — every page life
// disarmed the guard before reading it, so a recurring error reloaded forever
// and the fallback UI was unreachable. The decision is now a pure function
// pinned here; the lifecycle wiring is pinned at source (node env: no DOM).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { chunkReloadAction } from '../src/components/ErrorBoundary'

const boundary = readFileSync(new URL('../src/components/ErrorBoundary.tsx', import.meta.url), 'utf8')
/** The boundary with comments removed — a pin judges code, not prose. */
const boundaryCode = boundary
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\n)\s*\/\/.*/g, '$1')

describe('chunkReloadAction — the episode machine (#575 Face B)', () => {
  it('a first occurrence (no flag) reloads automatically', () => {
    expect(chunkReloadAction(false)).toBe('reload')
  })

  it('a recurring occurrence (flag present) lands on the fallback, never a second auto-reload', () => {
    expect(chunkReloadAction(true)).toBe('fallback')
  })

  it('the boundary routes the crash through the pure guard', () => {
    expect(boundary).toContain('chunkReloadAction(flagPresent)')
  })

  it('no mount-time flag clear — the commit-order trap stays gone', () => {
    expect(boundaryCode).not.toContain('componentDidMount')
  })

  it('the fallback reload button clears the flag, so a deliberate reload re-arms', () => {
    expect(boundary).toMatch(/removeItem\(RELOAD_FLAG\)[\s\S]{0,80}location\.reload\(\)/)
  })
})
