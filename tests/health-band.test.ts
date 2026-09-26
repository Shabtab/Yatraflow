// ============ One band → colour mapping (#369) ============
// The Board coloured trip health from raw SCORE cuts (`>=70 ok | >=40 mid`)
// while printing the engine's BAND name — so between 40 and 54 it stated
// “Unrealistic” in reassuring mid-blue. The mapping is keyed on the band the
// engine produced, and both the Board and the Overview read this one copy.
import { describe, expect, it } from 'vitest'
import { healthBandClass, healthBandTone } from '../src/lib/healthBand'
import { scoreWarnings } from '../src/lib/engine'

describe('band → class', () => {
  it('maps every band the engine can state', () => {
    expect(healthBandClass('Comfortable')).toBe('ok')
    expect(healthBandClass('Manageable')).toBe('ok')
    expect(healthBandClass('Tight')).toBe('mid')
    expect(healthBandClass('Unrealistic')).toBe('bad')
  })

  it('a 45-score Unrealistic trip wears the BAD colour (the exact broken case)', () => {
    const warnings = Array.from({ length: 5 }, (_, i) => ({
      code: `high-${i}`, severity: 'high' as const, title: 't', detail: 'd', fix: 'f',
    }))
    const health = scoreWarnings(warnings) // 100 − 5 × 11
    expect(health.score).toBe(45)
    expect(health.band).toBe('Unrealistic')
    // …'bad', not 'mid': the old `>= 40` cut painted it re-assuring.
    expect(healthBandClass(health.band)).toBe('bad')
  })

  it('follows the band at each engine boundary, not a fresh cut', () => {
    for (const [band, cls] of [
      ['Comfortable', 'ok'], ['Manageable', 'ok'], ['Tight', 'mid'], ['Unrealistic', 'bad'],
    ] as const) {
      expect(healthBandClass(band)).toBe(cls)
    }
  })
})

describe('band → chip tone', () => {
  it('keeps the palette the Overview already used for the band word', () => {
    expect(healthBandTone('Comfortable')).toBe('ok')
    expect(healthBandTone('Manageable')).toBe('teal')
    expect(healthBandTone('Tight')).toBe('saffron')
    expect(healthBandTone('Unrealistic')).toBe('danger')
  })
})
