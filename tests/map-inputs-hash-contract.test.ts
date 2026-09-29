// #404 — the freshness contract between the Map tab and the Overview's matrix.
//
// The Overview cannot recompute `mapInputsHash`: `routeHash(routeGeometry)` needs
// the measured road and the rain/code arrays are the Map's own state. So the Map
// publishes it. Three things must hold for the Overview's gate to mean anything,
// and all three are visible in the source:
//
//  1. the callback exists in MapTab's props,
//  2. the Map notifies ONCE per value — a naive effect re-fires on every new
//     callback identity, and the two tabs then ping-pong state at each other,
//  3. the map cache is READ and WRITTEN with that same hash. A write under a
//     different value would make `isMapCacheFresh(…)` report "stale" forever,
//     which is worse than the silence #404 set out to replace.
//
// This is a cross-lane contract, so it is pinned as text: the alternative — a
// rendered test — cannot see push-back loops, and this repo's suite is pure/node.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const mapTab = readFileSync(new URL('../src/pages/trip/MapTab.tsx', import.meta.url), 'utf8')
const cache = readFileSync(new URL('../src/hooks/useSuggestionCache.ts', import.meta.url), 'utf8')

describe('the Map publishes the freshness the Overview gates on (#404)', () => {
  it('declares the callback in its props', () => {
    expect(mapTab).toContain('onInputsHash?: (inputsHash: string, scopeKm: number) => void')
  })

  it('actually DESTRUCTURES it — a prop in the type and not in the pattern is TS2552', () => {
    // learned the hard way: adding the prop to the inline type only made
    // `onInputsHash` unresolvable in the body, and the typecheck (not the tests)
    // caught it.
    expect(mapTab).toMatch(/export function MapTab\(\{[^}]*\bonInputsHash\b/)
  })

  it('notifies with the same pair the cache entry is keyed by', () => {
    expect(mapTab).toContain('onInputsHash(mapInputsHash, scopeKm)')
  })

  it('notifies once per VALUE, not once per render', () => {
    expect(mapTab).toContain('publishedInputsRef')
    expect(mapTab).toMatch(/if \(publishedInputsRef\.current === key\) return/)
  })

  it('reads and writes the map cache under that one hash', () => {
    expect(mapTab).toContain('const inputsHash = mapInputsHash')
    expect(mapTab).toContain('isMapCacheFresh(cached, scopeKm, inputsHash)')
    expect(mapTab).toContain('setMapCache(plan, inputsHash, scopeKm)')
  })

  it('keeps the freshness predicate comparing scope and hash, not age', () => {
    expect(cache).toContain('cached.scopeKm === scopeKm && cached.inputsHash === inputsHash')
  })
})
