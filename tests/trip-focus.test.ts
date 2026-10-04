import { describe, it, expect } from 'vitest'
import { resolveRailDay } from '../src/lib/tripFocus'

describe('resolveRailDay (#610)', () => {
  it('a shared day this trip holds wins over the local day', () => {
    expect(resolveRailDay(2, [0, 1, 2], 0)).toBe(2)
  })
  it('all, absent, or foreign focus falls back to the local day', () => {
    expect(resolveRailDay('all', [0, 1, 2], 1)).toBe(1)
    expect(resolveRailDay(undefined, [0, 1, 2], 1)).toBe(1)
    expect(resolveRailDay(9, [0, 1, 2], 1)).toBe(1)
  })
  it('a removed local day falls back to day one', () => {
    expect(resolveRailDay(undefined, [1, 2], 0)).toBe(1)
    expect(resolveRailDay(9, [1, 2], 0)).toBe(1)
  })
  it('an empty trip reads day zero without crashing', () => {
    expect(resolveRailDay(undefined, [], 0)).toBe(0)
  })
})
