import { describe, expect, it } from 'vitest'
import { parseSavedIds, savedDayId, savedStopId, flipSavedId, saveSavedIds, loadSavedIds } from '../src/lib/uiPrefs'

/* MR8. The parsing is the only part worth pinning here: the load/save wrappers
   need localStorage, which node does not have. A corrupted value must save
   nothing rather than crash the timeline, because the timeline is where it is
   read. */

describe('parseSavedIds', () => {
  it('reads a stored array of ids', () => {
    expect(parseSavedIds('["day:0","stop:abc"]')).toEqual(['day:0', 'stop:abc'])
  })

  it('reads nothing from missing or empty storage', () => {
    expect(parseSavedIds(null)).toEqual([])
    expect(parseSavedIds(undefined)).toEqual([])
    expect(parseSavedIds('')).toEqual([])
  })

  it('survives malformed JSON instead of throwing at the timeline', () => {
    expect(parseSavedIds('{not json')).toEqual([])
  })

  it('drops a non-array whole, rather than reading an object as a set', () => {
    expect(parseSavedIds('{"day:0":true}')).toEqual([])
    expect(parseSavedIds('"day:0"')).toEqual([])
    expect(parseSavedIds('7')).toEqual([])
    expect(parseSavedIds('null')).toEqual([])
  })

  it('keeps only non-empty strings from a mixed array', () => {
    expect(parseSavedIds('["day:0", 7, null, "", {"a":1}, "stop:x"]')).toEqual(['day:0', 'stop:x'])
  })
})

describe('saved ids', () => {
  it('namespaces a day and a stop so the same key cannot mean both', () => {
    // A stop whose id happens to be "0" must not collide with day 0.
    expect(savedDayId(0)).toBe('day:0')
    expect(savedStopId('0')).toBe('stop:0')
    expect(savedDayId(0)).not.toBe(savedStopId('0'))
  })

  it('gives the same id for the same day every time, so a reload matches', () => {
    expect(savedDayId(3)).toBe(savedDayId(3))
  })
})

/* S1: the updater used to read storage, flip and write storage inside React's
   state calculation. Strict Mode runs that calculation twice, so one press
   saved then un-saved; and with storage denied every read came back empty, so
   two presses kept only the last id. The set is derived from the previous
   STATE now, and the write mirrors it afterwards. */

describe('flipSavedId', () => {
  it('is pure: repeated calculation of one press gives the same set', () => {
    // React may run the updater twice for one dispatch. A derivation from
    // `prev` lands the same answer twice; a side-effecting flip does not.
    const prev = ['day:0']
    expect(flipSavedId(prev, 'day:1')).toEqual(['day:0', 'day:1'])
    expect(flipSavedId(prev, 'day:1')).toEqual(['day:0', 'day:1'])
  })

  it('two saves keep both ids with no storage read between them', () => {
    let state: string[] = []
    state = flipSavedId(state, 'day:0')
    state = flipSavedId(state, 'day:1')
    expect(state).toEqual(['day:0', 'day:1'])
  })

  it('removes the id on the press that follows the save', () => {
    expect(flipSavedId(flipSavedId([], 'stop:abc'), 'stop:abc')).toEqual([])
  })
})

describe('saved-set persistence', () => {
  it('fails soft when storage is denied: no throw, and the read stays empty', () => {
    // Node has no localStorage, which is exactly the denied path.
    expect(() => saveSavedIds('t1', ['day:0'])).not.toThrow()
    expect(loadSavedIds('t1')).toEqual([])
  })

  it('reloads exactly the set it saved', () => {
    const store = new Map<string, string>()
    const stub = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    }
    const g = globalThis as { localStorage?: unknown }
    const original = g.localStorage
    g.localStorage = stub
    try {
      saveSavedIds('t2', ['day:1', 'stop:abc'])
      expect(loadSavedIds('t2')).toEqual(['day:1', 'stop:abc'])
    } finally {
      g.localStorage = original
    }
  })
})
