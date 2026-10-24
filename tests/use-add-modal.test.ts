import { describe, expect, it } from 'vitest'
import { resolvePickDay } from '../src/pages/trip/map/useAddModal'

const days = [{ index: 3 }, { index: 7 }]

describe('add-modal day default', () => {
  it('discloses a guess when a known km has no derived plan day', () => {
    expect(resolvePickDay(120, undefined, () => null, days)).toEqual({ day: 3, guessed: true })
  })

  it('is not a guess when the plan assigns the km', () => {
    expect(resolvePickDay(120, undefined, () => 7, days)).toEqual({ day: 7, guessed: false })
  })

  it('discloses a guess when the km is unknown', () => {
    expect(resolvePickDay(undefined, undefined, () => null, days)).toEqual({ day: 3, guessed: true })
  })
})
