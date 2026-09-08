// ============ Label formatter tests ============
// Pure string builders — node-testable like the rest of the lib. These pin the
// exact wording every surface shows, so a formatter refactor cannot silently
// change what users read.
import { describe, it, expect } from 'vitest'
import { cap, titleCase, statusLabel } from '../src/lib/labels'

describe('cap', () => {
  it('uppercases the first letter and leaves the rest untouched', () => {
    expect(cap('food-focused')).toBe('Food-focused')
    expect(cap('car')).toBe('Car')
    expect(cap('motorcycle')).toBe('Motorcycle')
  })
  it('does not lowercase the remainder (mixed text stays mixed)', () => {
    expect(cap('already Mixed')).toBe('Already Mixed')
  })
  it('handles empty and single-character strings', () => {
    expect(cap('')).toBe('')
    expect(cap('x')).toBe('X')
  })
})

describe('titleCase', () => {
  it('turns every hyphen into a space and capitalises each word', () => {
    expect(titleCase('transport-hub')).toBe('Transport Hub')
    expect(titleCase('food-focused')).toBe('Food Focused')
  })
  it('passes plain words through capitalised', () => {
    expect(titleCase('sightseeing')).toBe('Sightseeing')
  })
})

describe('statusLabel', () => {
  it('reads hyphenated statuses as a sentence, not a title', () => {
    expect(statusLabel('needs-booking')).toBe('Needs booking')
  })
  it('capitalises plain statuses', () => {
    for (const s of ['suggested', 'confirmed', 'rejected', 'maybe']) {
      expect(statusLabel(s)).toBe(s[0].toUpperCase() + s.slice(1))
    }
  })
})
