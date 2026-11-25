// ============ Sign-up password meter ============
// Pure logic, node env. The count follows the typing and ends at the neutral hint.
import { describe, it, expect } from 'vitest'
import { PASSWORD_HINT, PASSWORD_MIN_LENGTH, passwordMeter } from '../src/lib/passwordMeter'

describe('passwordMeter', () => {
  it('keeps the neutral hint before typing starts', () => {
    expect(passwordMeter('')).toEqual({ short: false, remaining: PASSWORD_MIN_LENGTH, text: PASSWORD_HINT })
  })

  it('counts down as characters arrive', () => {
    expect(passwordMeter('abcde')).toEqual({
      short: true,
      remaining: 3,
      text: 'At least 8 characters, 3 more to go',
    })
    expect(passwordMeter('a').remaining).toBe(7)
    expect(passwordMeter('abcdefg').text).toBe('At least 8 characters, 1 more to go')
  })

  it('returns to the neutral hint at 8 characters and beyond', () => {
    for (const pw of ['abcdefgh', 'abcdefghijkl']) {
      expect(passwordMeter(pw)).toEqual({ short: false, remaining: 0, text: PASSWORD_HINT })
    }
  })

  it('agrees with the 8-character rule the submit check uses', () => {
    for (let n = 0; n <= 12; n += 1) {
      const pw = 'x'.repeat(n)
      const meter = passwordMeter(pw)
      expect(meter.remaining === 0).toBe(!(n < 8))
    }
  })
})
