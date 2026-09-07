// Scout finding: the Map tab reused its cached plan on scope match alone,
// so editing stops (new anchors) still served the old route's suggestions.
import { describe, it, expect } from 'vitest'
import { isMapCacheFresh } from '../src/hooks/useSuggestionCache'

function cached(over = {}) {
  return { segments: [], anchorsHash: 'abc', scopeKm: 20, ts: Date.now(), ...over }
}

describe('map cache freshness', () => {
  it('reuses the cache when scope and anchors both match', () => {
    expect(isMapCacheFresh(cached(), 20, 'abc')).toBe(true)
  })

  it('misses when stops moved the anchors', () => {
    expect(isMapCacheFresh(cached(), 20, 'def')).toBe(false)
  })

  it('misses when the detour scope changed', () => {
    expect(isMapCacheFresh(cached(), 30, 'abc')).toBe(false)
  })

  it('misses on an empty cache', () => {
    expect(isMapCacheFresh(null, 20, 'abc')).toBe(false)
  })
})
