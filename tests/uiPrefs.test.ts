// ============ uiPrefs — day-collapse persistence ============
// Node env: no localStorage. That's deliberate — the pure parser is what we
// assert on; the storage wrappers degrade to no-ops when storage is missing.
import { describe, it, expect } from 'vitest'
import { dayCollapseKey, parseDayCollapseMap, loadDayCollapsed, saveDayCollapsed, loadFlag, saveFlag } from '../src/lib/uiPrefs'

describe('dayCollapseKey', () => {
  it('namespaces by trip id and day index', () => {
    expect(dayCollapseKey('trip_abc', 2)).toBe('trip_abc:2')
    // suffix collisions are impossible: day 1 vs day 12 differ, and trip ids
    // that are prefixes of each other can't collide either
    expect(dayCollapseKey('trip_abc', 1)).not.toBe(dayCollapseKey('trip_abc', 12))
    expect(dayCollapseKey('t1', 0)).not.toBe(dayCollapseKey('t10', 0))
  })
})

describe('parseDayCollapseMap', () => {
  it('parses a valid stored map', () => {
    expect(parseDayCollapseMap('{"t1:0":true,"t1:1":false}')).toEqual({ 't1:0': true, 't1:1': false })
  })

  it('returns empty for null / empty string', () => {
    expect(parseDayCollapseMap(null)).toEqual({})
    expect(parseDayCollapseMap(undefined)).toEqual({})
    expect(parseDayCollapseMap('')).toEqual({})
  })

  it('returns empty for malformed JSON instead of throwing', () => {
    expect(parseDayCollapseMap('{not json')).toEqual({})
    expect(parseDayCollapseMap('"just a string"')).toEqual({})
  })

  it('drops non-object JSON (arrays, numbers, bare null)', () => {
    expect(parseDayCollapseMap('[true,false]')).toEqual({})
    expect(parseDayCollapseMap('42')).toEqual({})
    expect(parseDayCollapseMap('null')).toEqual({})
  })

  it('keeps boolean entries but drops corrupt value types', () => {
    expect(parseDayCollapseMap('{"a:true":true,"bad":1,"worse":"yes","ok":false}')).toEqual({ 'a:true': true, ok: false })
  })
})

describe('storage wrappers without localStorage (node)', () => {
  it('loadDayCollapsed defaults to expanded', () => {
    expect(loadDayCollapsed('nope', 0)).toBe(false)
  })

  it('saveDayCollapsed is a silent no-op', () => {
    expect(() => saveDayCollapsed('nope', 0, true)).not.toThrow()
    expect(loadDayCollapsed('nope', 0)).toBe(false)
  })
})

describe('storage wrappers with a real storage stub', () => {
  it('writes then reads back the toggled state', () => {
    const store = new Map<string, string>()
    const prev = globalThis.localStorage
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => store.clear(),
      key: () => null,
      get length() { return store.size },
    } as Storage
    try {
      expect(loadDayCollapsed('tripX', 1)).toBe(false)
      saveDayCollapsed('tripX', 1, true)
      expect(loadDayCollapsed('tripX', 1)).toBe(true)
      saveDayCollapsed('tripX', 1, false)
      expect(loadDayCollapsed('tripX', 1)).toBe(false)
      // other days unaffected
      expect(loadDayCollapsed('tripX', 0)).toBe(false)
      // corrupted storage degrades to expanded, then recovers on next save
      store.set('yatraflow_day_collapsed', '{oops')
      expect(loadDayCollapsed('tripX', 1)).toBe(false)
      saveDayCollapsed('tripX', 2, true)
      expect(loadDayCollapsed('tripX', 2)).toBe(true)
    } finally {
      ;(globalThis as unknown as { localStorage: Storage }).localStorage = prev
    }
  })
})

describe('named boolean flags', () => {
  it('degrade to the fallback without localStorage (node)', () => {
    expect(loadFlag('map_legend_open', false)).toBe(false)
    expect(loadFlag('map_legend_open', true)).toBe(true)
    expect(() => saveFlag('map_legend_open', true)).not.toThrow()
  })

  it('write then read back, keeping other keys untouched', () => {
    const store = new Map<string, string>()
    const prev = globalThis.localStorage
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => store.clear(),
      key: () => null,
      get length() { return store.size },
    } as Storage
    try {
      expect(loadFlag('map_legend_open', false)).toBe(false)
      saveFlag('map_legend_open', true)
      expect(loadFlag('map_legend_open', false)).toBe(true)
      // stored under the documented key, as "1"/"0"
      expect(store.get('yatraflow_map_legend_open')).toBe('1')
      saveFlag('map_legend_open', false)
      expect(loadFlag('map_legend_open', true)).toBe(false)
      expect(store.get('yatraflow_map_legend_open')).toBe('0')
      // a flag that was never saved still falls back
      expect(loadFlag('never_saved', true)).toBe(true)
    } finally {
      ;(globalThis as unknown as { localStorage: Storage }).localStorage = prev
    }
  })
})
