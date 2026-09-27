// ============ Label formatter tests ============
// Pure string builders — node-testable like the rest of the lib. These pin the
// exact wording every surface shows, so a formatter refactor cannot silently
// change what users read.
import { describe, it, expect } from 'vitest'
import { cap, titleCase, statusLabel, insertionWhere } from '../src/lib/labels'

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

// #422: one phrasing for where an inserted stop lands — the leg's control
// announces it and the quick-add dialog repeats it, so the two can never drift
// into saying different things about the same slot.
describe('insertionWhere', () => {
  it('names both neighbours when the stop lands between two', () => {
    expect(insertionWhere('Fort Kochi', 'Munnar')).toBe('between “Fort Kochi” and “Munnar”')
  })

  it('names the single neighbour at either end of the day', () => {
    expect(insertionWhere(undefined, 'Fort Kochi')).toBe('before “Fort Kochi”')
    expect(insertionWhere('Fort Kochi', undefined)).toBe('after “Fort Kochi”')
  })

  it('says so when the day is empty', () => {
    expect(insertionWhere(undefined, undefined)).toBe('at the start of the day')
  })

  it('drops the engine\u2019s own anchor suffix from a neighbour it names', () => {
    // auto anchors are stored as "Goa (start)" — that suffix is the engine's
    // bookkeeping, not something to read out to a user
    expect(insertionWhere('Goa (start)', 'Munnar')).toBe('between “Goa” and “Munnar”')
    expect(insertionWhere('Goa (end)', undefined)).toBe('after “Goa”')
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
