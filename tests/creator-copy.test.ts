import { describe, expect, it } from 'vitest'
import { placeShortName } from '../src/lib/creatorCopy'

describe('placeShortName', () => {
  it('strips a trailing country from a place', () => {
    expect(placeShortName('Kolkata, India')).toBe('Kolkata')
    expect(placeShortName('Patratu Valley, India')).toBe('Patratu Valley')
  })

  it('leaves a place without the suffix unchanged', () => {
    expect(placeShortName('Kolkata')).toBe('Kolkata')
    expect(placeShortName('India Gate')).toBe('India Gate')
  })
})
