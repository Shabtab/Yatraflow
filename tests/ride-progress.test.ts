import { afterEach, describe, expect, it, vi } from 'vitest'
import { freeDaysRead, markRideDayRead, parseRideProgress, rideProgressKey } from '../src/lib/rideProgress'

afterEach(() => vi.unstubAllGlobals())

describe('ride read progress', () => {
  it('accepts day indexes only and counts free days once', () => {
    const read = parseRideProgress('[0,2,2,-1,1.5,"3",null,999]')
    expect([...read]).toEqual([0, 2, 999])
    expect(freeDaysRead(read, [0, 2, 2, 4])).toBe(2)
    expect([...parseRideProgress('{broken')]).toEqual([])
    expect([...parseRideProgress('{"0":true}')]).toEqual([])
  })

  it('stores only opened free days under the publication key', () => {
    const entries = new Map<string, string>()
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
    }, dispatchEvent })
    markRideDayRead('first', 2, [0, 2])
    markRideDayRead('first', 2, [0, 2])
    markRideDayRead('first', 1, [0, 2])
    markRideDayRead('second', 0, [0])
    expect(entries.get(rideProgressKey('first'))).toBe('[2]')
    expect(entries.get(rideProgressKey('second'))).toBe('[0]')
    expect(dispatchEvent).toHaveBeenCalledTimes(2)
  })

  it('keeps the day usable when reads or writes throw', () => {
    vi.stubGlobal('window', { get localStorage() { throw new Error('blocked') } })
    expect(() => markRideDayRead('first', 0, [0])).not.toThrow()
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => { throw new Error('full') } } })
    expect(() => markRideDayRead('first', 0, [0])).not.toThrow()
  })
})
