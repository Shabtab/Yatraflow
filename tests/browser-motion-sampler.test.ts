import { afterEach, describe, expect, it, vi } from 'vitest'
import { samplePageMotion } from '../scripts/motion-page-sampler.mjs'

afterEach(() => vi.unstubAllGlobals())

function collectPages(pageNames: string[]) {
  const roots = new Map(pageNames.map(name => [name, {
    children: [{ className: name, getBoundingClientRect: () => ({ height: 30 }) }],
  }]))
  let frame = 0
  const captured: { __blocks: { rows: { cls: string; op: number }[] }[] } = { __blocks: [] }
  const queued: (() => void)[] = []
  vi.stubGlobal('window', captured)
  vi.stubGlobal('document', { querySelector: () => roots.get(pageNames[frame]) })
  vi.stubGlobal('performance', { now: () => frame * 16 })
  vi.stubGlobal('requestAnimationFrame', (read: () => void) => queued.push(read))
  vi.stubGlobal('getComputedStyle', () => ({ opacity: '1', transform: 'none', visibility: 'visible' }))
  samplePageMotion((pageNames.length - 1) * 16)
  while (queued.length > 0) {
    queued.shift()?.()
    frame++
  }
  return captured.__blocks
}

describe('browser page motion sampling', () => {
  it('measures the final page when a lazy route replaces its loading screen', () => {
    const frames = collectPages(['spinner', 'auth-page', 'auth-page'])
    expect(frames).toHaveLength(2)
    expect(frames.flatMap(frame => frame.rows.map(row => row.cls))).toEqual(['auth-page', 'auth-page'])
  })

  it('keeps unchanged motionless page blocks in every sample', () => {
    const frames = collectPages(['hero', 'hero', 'hero'])
    expect(frames).toHaveLength(3)
    expect(frames.flatMap(frame => frame.rows)).toEqual(Array(3).fill({ cls: 'hero', op: 1, tf: 'none', vis: 'visible' }))
  })
})
