// Horizon 2 deferred: opening-hours in scoring.
// A hit whose reported hours don't contain the segment's arrival clock is
// degraded; a hit open when you'd arrive is untouched. Unknown hours leave it
// alone. Only this module's pure helper is tested (scoring wires it in).
import { describe, it, expect } from 'vitest'
import { hoursFitAdj } from '../src/lib/ridePlan'

describe('opening-hours scoring', () => {
  it('leaves a hit open at arrival untouched', () => {
    expect(hoursFitAdj({ openTime: '09:00', closeTime: '17:00' }, 13 * 60)).toBe(0)
  })

  it('penalizes a hit closed when you arrive', () => {
    expect(hoursFitAdj({ openTime: '09:00', closeTime: '17:00' }, 18 * 60)).toBeGreaterThan(0)
  })

  it('penalizes arriving long before it opens', () => {
    expect(hoursFitAdj({ openTime: '09:00', closeTime: '17:00' }, 6 * 60)).toBeGreaterThan(0)
  })

  it('ignores hits/segments without hours or arrival', () => {
    expect(hoursFitAdj({}, 13 * 60)).toBe(0)
    expect(hoursFitAdj({ openTime: '09:00', closeTime: '17:00' }, null)).toBe(0)
    expect(hoursFitAdj({ openTime: '09:00' }, 13 * 60)).toBe(0)
  })

  it('handles an overnight place (open > close)', () => {
    // Bar open 20:00–02:00: open late-night, closed mid-day.
    expect(hoursFitAdj({ openTime: '20:00', closeTime: '02:00' }, 23 * 60)).toBe(0)
    expect(hoursFitAdj({ openTime: '20:00', closeTime: '02:00' }, 13 * 60)).toBeGreaterThan(0)
  })
})