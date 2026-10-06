// ============ Age gate at signup ============
// Behavioral tests over lib/ageGate, called the way the signup page calls
// it, plus source pins that the page really gates the account creation.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { MIN_SIGNUP_AGE, ageFromDob, isAdultSignup } from '../src/lib/ageGate'

const auth = readFileSync(new URL('../src/pages/Auth.tsx', import.meta.url), 'utf8')

describe('ageFromDob counts completed years', () => {
  it('the 18th birthday itself is adult: age 18', () => {
    expect(ageFromDob('2008-03-15', new Date(2026, 2, 15))).toBe(18)
    expect(isAdultSignup('2008-03-15', new Date(2026, 2, 15))).toBe(true)
  })

  it('one day before the 18th birthday is not adult: age 17', () => {
    expect(ageFromDob('2008-03-15', new Date(2026, 2, 14))).toBe(17)
    expect(isAdultSignup('2008-03-15', new Date(2026, 2, 14))).toBe(false)
  })

  it('a Feb-29 birth waits for Mar 1 in a non-leap turning year', () => {
    // The (2, 29) pair is compared literally: Feb 28 is still one short.
    expect(ageFromDob('2008-02-29', new Date(2026, 1, 28))).toBe(17)
    expect(isAdultSignup('2008-02-29', new Date(2026, 1, 28))).toBe(false)
    expect(ageFromDob('2008-02-29', new Date(2026, 2, 1))).toBe(18)
    expect(isAdultSignup('2008-02-29', new Date(2026, 2, 1))).toBe(true)
  })

  it('a future date of birth is not a person: null and refused', () => {
    expect(ageFromDob('2030-01-01', new Date(2026, 0, 1))).toBeNull()
    expect(isAdultSignup('2030-01-01', new Date(2026, 0, 1))).toBe(false)
    expect(ageFromDob('2026-06-01', new Date(2026, 0, 1))).toBeNull()
  })
})

describe('ageFromDob refuses input that is not a real past date', () => {
  const bad = ['', '2003/05/01', '2010-13-01', '2010-01-32', '2010-02-30']

  for (const dob of bad) {
    it(`rejects ${JSON.stringify(dob)}`, () => {
      expect(ageFromDob(dob, new Date(2026, 0, 1))).toBeNull()
      expect(isAdultSignup(dob, new Date(2026, 0, 1))).toBe(false)
    })
  }
})

describe('the signup page gates account creation on age', () => {
  it('pins the minimum age at 18', () => {
    expect(MIN_SIGNUP_AGE).toBe(18)
  })

  it('Auth.tsx calls isAdultSignup and names the field error', () => {
    expect(auth).toContain('isAdultSignup(')
    expect(auth).toContain('You need to be 18 or older to create an account.')
  })

  it('the age check sits before the signup call in submit()', () => {
    const gate = auth.indexOf('isAdultSignup(dob')
    const create = auth.indexOf('await signup(')
    expect(gate).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(create)
  })
})
