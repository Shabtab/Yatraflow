// ============ uiPrefs — day-collapse persistence ============
// Node env: no localStorage. That's deliberate — the pure parser is what we
// assert on; the storage wrappers degrade to no-ops when storage is missing.
import { describe, it, expect, afterEach } from 'vitest'
import { dayCollapseKey, parseDayCollapseMap, loadDayCollapsed, saveDayCollapsed, parseOpenDayMap, loadOpenDay, saveOpenDay, NO_OPEN_DAY, loadReviewAll, saveReviewAll, loadFlag, saveFlag, loadPref, savePref } from '../src/lib/uiPrefs'

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

describe('open-day accordion persistence', () => {
  it('degrades to all-collapsed without localStorage (node)', () => {
    expect(loadOpenDay('nope')).toBe(NO_OPEN_DAY)
    expect(() => saveOpenDay('nope', 3)).not.toThrow()
    expect(loadOpenDay('nope')).toBe(NO_OPEN_DAY)
  })

  it('parses a valid open-day map and drops junk', () => {
    expect(parseOpenDayMap('{"t1":2,"t2":-1}')).toEqual({ t1: 2, t2: -1 })
    expect(parseOpenDayMap(null)).toEqual({})
    expect(parseOpenDayMap(undefined)).toEqual({})
    expect(parseOpenDayMap('{oops')).toEqual({})
    // non-object JSON, non-integers, values below the sentinel, wrong types
    expect(parseOpenDayMap('[3]')).toEqual({})
    expect(parseOpenDayMap('{"a":1.5,"b":-2,"c":"3","d":true,"e":null}')).toEqual({})
  })

  it('writes then reads back per trip, isolating trips (storage stub)', () => {
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
      expect(loadOpenDay('tripX')).toBe(NO_OPEN_DAY)
      saveOpenDay('tripX', 2)
      expect(loadOpenDay('tripX')).toBe(2)
      // closing all persists the sentinel
      saveOpenDay('tripX', NO_OPEN_DAY)
      expect(loadOpenDay('tripX')).toBe(NO_OPEN_DAY)
      // trips are isolated
      saveOpenDay('tripY', 0)
      expect(loadOpenDay('tripX')).toBe(NO_OPEN_DAY)
      expect(loadOpenDay('tripY')).toBe(0)
      // corrupted storage degrades to all-collapsed, then recovers on next save
      store.set('yatraflow_open_day', '{oops')
      expect(loadOpenDay('tripY')).toBe(NO_OPEN_DAY)
      saveOpenDay('tripY', 1)
      expect(loadOpenDay('tripY')).toBe(1)
      // invalid writes are rejected instead of persisting corrupt state
      saveOpenDay('tripY', -2)
      saveOpenDay('tripY', 1.5)
      expect(loadOpenDay('tripY')).toBe(1)
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

describe('loadPref / savePref — guarded string prefs (#181)', () => {
  const g = globalThis as unknown as { localStorage: Storage }
  const prev = g.localStorage
  afterEach(() => { g.localStorage = prev })

  it('round-trips a value under the yatraflow_ namespace and falls back when missing', () => {
    const store = new Map<string, string>()
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    } as unknown as Storage
    savePref('nearby_scope_km', '40')
    expect(store.get('yatraflow_nearby_scope_km')).toBe('40')
    expect(loadPref('nearby_scope_km', '20')).toBe('40')
    expect(loadPref('never_saved', '20')).toBe('20')
  })

  it('is silent when storage throws (private mode) — no crash', () => {
    g.localStorage = {
      getItem: () => { throw new DOMException('denied') },
      setItem: () => { throw new DOMException('denied') },
    } as unknown as Storage
    expect(loadPref('anything', 'fb')).toBe('fb')
    expect(() => savePref('anything', 'x')).not.toThrow()
  })

  it('degrades to the fallback when storage is unavailable (node)', () => {
    g.localStorage = undefined as unknown as Storage
    expect(loadPref('anything', 'fb')).toBe('fb')
    expect(() => savePref('anything', 'x')).not.toThrow()
  })
})

// ---- Review-all-days view (#421) ----
// The Timeline's view choice is the sibling of the open day: per trip, and it
// must never touch the accordion's own preference — leaving review returns you
// to the day you were in.
describe('review-all-days view (#421)', () => {
  const g = globalThis as unknown as { localStorage: Storage }
  const prev = globalThis.localStorage
  afterEach(() => { g.localStorage = prev })

  function stub(): Map<string, string> {
    const store = new Map<string, string>()
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
      clear: () => store.clear(),
      key: () => null,
      get length() { return store.size },
    } as Storage
    return store
  }

  it('degrades to off without localStorage (node)', () => {
    g.localStorage = undefined as unknown as Storage
    expect(loadReviewAll('tripX')).toBe(false)
    expect(() => saveReviewAll('tripX', true)).not.toThrow()
  })

  it('writes then reads back per trip, isolating trips', () => {
    stub()
    expect(loadReviewAll('tripX')).toBe(false)
    saveReviewAll('tripX', true)
    expect(loadReviewAll('tripX')).toBe(true)
    saveReviewAll('tripY', true)
    saveReviewAll('tripX', false)
    expect(loadReviewAll('tripX')).toBe(false)
    expect(loadReviewAll('tripY')).toBe(true)
  })

  it('degrades to off on corrupted storage instead of throwing', () => {
    const store = stub()
    store.set('yatraflow_review_all', '{oops')
    expect(loadReviewAll('tripX')).toBe(false)
  })

  it('never disturbs the trip’s saved open day', () => {
    const store = stub()
    saveOpenDay('tripX', 2)
    saveReviewAll('tripX', true)
    expect(loadOpenDay('tripX')).toBe(2) // what review returns you to
    saveReviewAll('tripX', false)
    expect(loadOpenDay('tripX')).toBe(2)
    expect(store.get('yatraflow_open_day')).toBe('{"tripX":2}')
    // and the two prefs live under different keys, so neither can clobber the other
    expect(store.has('yatraflow_review_all')).toBe(true)
  })
})
