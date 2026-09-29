// ============ #404 (lane E's half) — the matrix knows fresh from stale ============
// The slot matrix re-derives with today's settings over the corridor scan the
// Map wrote, possibly under older settings. The gate is the Map's own
// published pair, consumed through isMapCacheFresh — one hash, never two.
// A missing pair is UNKNOWN (the Map never mounted this session), never stale
// and never fresh: unknown is qualified, stale replaces the numbers.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { matrixFreshness } from '../src/lib/matrixFreshness'

const cache = { scopeKm: 45, inputsHash: 'abc123' }
const published = { hash: 'abc123', scopeKm: 45 }

describe('#404 — the freshness resolver', () => {
  it('reports empty when the corridor was never scanned, whatever else holds', () => {
    expect(matrixFreshness({ hasCorridor: false, mapCache: cache, mapInputs: published })).toBe('empty')
    expect(matrixFreshness({ hasCorridor: false, mapCache: null, mapInputs: null })).toBe('empty')
  })

  it('reports unknown when the Map never published this session — never stale', () => {
    expect(matrixFreshness({ hasCorridor: true, mapCache: cache, mapInputs: null })).toBe('unknown')
    expect(matrixFreshness({ hasCorridor: true, mapCache: null, mapInputs: null })).toBe('unknown')
  })

  it('reports stale on a hash mismatch, a scope mismatch, or a missing cache', () => {
    expect(matrixFreshness({ hasCorridor: true, mapCache: cache, mapInputs: { ...published, hash: 'changed' } })).toBe('stale')
    expect(matrixFreshness({ hasCorridor: true, mapCache: cache, mapInputs: { ...published, scopeKm: 60 } })).toBe('stale')
    expect(matrixFreshness({ hasCorridor: true, mapCache: null, mapInputs: published })).toBe('stale')
  })

  it('reports fresh only for the matching triple', () => {
    expect(matrixFreshness({ hasCorridor: true, mapCache: cache, mapInputs: published })).toBe('fresh')
  })
})

describe('#404 — the matrix reads the gate (source)', () => {
  const page = readFileSync(new URL('../src/pages/trip/OverviewTab.tsx', import.meta.url), 'utf8')
  const workspace = readFileSync(new URL('../src/pages/TripWorkspace.tsx', import.meta.url), 'utf8')

  it('the matrix resolves freshness and branches stale before numbers', () => {
    expect(page).toContain('matrixFreshness(')
    const stale = page.indexOf(`freshness === 'stale'`)
    const grid = page.indexOf('className="slotmatrix"')
    expect(stale).toBeGreaterThan(-1)
    expect(grid).toBeGreaterThan(-1)
    expect(stale, 'the stale qualifier must precede the numbers grid').toBeLessThan(grid)
  })

  it('the stale qualifier offers the Map tab, not dead text', () => {
    expect(page).toContain('Refresh on the Map tab')
    expect(page).toContain('onClick={onRefreshMatrix}')
    expect(page).toContain('onRefreshMatrix={onOpenMap}')
  })

  it('the workspace holds the pair, clears it on trip switch, and wires both ends', () => {
    expect(workspace).toContain('onInputsHash={publishMapInputs}')
    expect(workspace).toContain('mapInputs={mapInputs}')
    expect(workspace).toContain('mapCache={suggestionCache.cache.map}')
    // The workspace outlives trips (it is not keyed by trip id): a previous
    // trip's hash must never gate the next trip's matrix.
    const clear = workspace.indexOf('setMapInputs(null)')
    const dep = workspace.indexOf('[tripId]', clear)
    expect(clear).toBeGreaterThan(-1)
    expect(dep, 'the clearing effect must depend on the trip').toBeGreaterThan(-1)
  })
})
