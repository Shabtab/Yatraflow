import { afterEach, describe, expect, it, vi } from 'vitest'
import { motionTiming } from '../src/lib/motion'

afterEach(() => vi.unstubAllGlobals())

function styleWith(duration: string) {
  vi.stubGlobal('window', {})
  vi.stubGlobal('document', { documentElement: {} })
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => name === '--ease-glide' ? 'ease-out' : duration,
  }))
}

describe('motionTiming', () => {
  it.each(['180ms', '.18s', '0.18s', ' 180ms '])('keeps a 180ms timer for CSS time %s', value => {
    styleWith(value)
    expect(motionTiming('--motion-med')).toEqual({ duration: 180, easing: 'ease-out' })
  })

  it.each(['', 'auto', '0s', '-1ms', '180'])('uses the token default for invalid CSS time %s', value => {
    styleWith(value)
    expect(motionTiming('--motion-med').duration).toBe(180)
  })

  it('converts a panel duration in seconds', () => {
    styleWith('.56s')
    expect(motionTiming('--motion-slower').duration).toBe(560)
  })

  it('uses the token default without a browser', () => {
    expect(motionTiming('--motion-slower').duration).toBe(560)
  })
})
