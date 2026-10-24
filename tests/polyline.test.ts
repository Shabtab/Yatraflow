// ============ Google encoded polyline codec ============
// It checks the shared codec in polyline.ts. The cases cover the official
// Google vector, round trips, zero and negative deltas, skipped points,
// cut-off strings, and the re-exports in routes.ts and google.ts.
import { describe, expect, it } from 'vitest'
import * as google from '../src/lib/providers/google'
import * as polyline from '../src/lib/providers/polyline'
import * as routes from '../src/lib/providers/routes'

/** The official example from Google's polyline documentation. */
const EXAMPLE_ENCODED = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
/** The same example as [lng, lat] points. */
const EXAMPLE_POINTS: [number, number][] = [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]

/** Deterministic pseudo-random numbers in [0, 1), so a failure reproduces. */
function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

/** Rounds to 1e5 precision. The + 0 turns a -0 into 0. */
function toPrecision(x: number): number {
  return Math.round(x * 1e5) / 1e5 + 0
}

describe('encodePolyline', () => {
  it('encodes the official Google vector from [lng, lat] points', () => {
    expect(polyline.encodePolyline(EXAMPLE_POINTS)).toBe(EXAMPLE_ENCODED)
  })

  it('returns an empty string for an empty array', () => {
    expect(polyline.encodePolyline([])).toBe('')
  })

  it('skips non-finite points without moving the delta base', () => {
    expect(polyline.encodePolyline([[77, 10], [NaN, 12], [Infinity, 13], [-Infinity, 14]]))
      .toBe(polyline.encodePolyline([[77, 10]]))
    expect(polyline.encodePolyline([[-120.2, 38.5], [NaN, 0], [-120.95, 40.7]]))
      .toBe(polyline.encodePolyline([[-120.2, 38.5], [-120.95, 40.7]]))
  })

  it('encodes zero deltas and negative deltas', () => {
    expect(polyline.encodePolyline([[0, 0]])).toBe('??')
    expect(polyline.encodePolyline([[0, 0], [0, 0]])).toBe('????')
    expect(polyline.encodePolyline([[0, 0], [0, 0], [-0.00001, -0.00001]])).toBe('????@@')
  })
})

describe('decodePolyline', () => {
  it('decodes the official Google vector to [lng, lat] points', () => {
    expect(polyline.decodePolyline(EXAMPLE_ENCODED)).toEqual(EXAMPLE_POINTS)
  })

  it('returns an empty array for an empty string', () => {
    expect(polyline.decodePolyline('')).toEqual([])
  })

  it('decodes zero deltas and negative deltas', () => {
    expect(polyline.decodePolyline('????')).toEqual([[0, 0], [0, 0]])
    expect(polyline.decodePolyline('????@@')).toEqual([[0, 0], [0, 0], [-0.00001, -0.00001]])
  })

  it('round trips 200 pseudo-random points at 1e5 precision', () => {
    const rand = lcg(20261024)
    const points = Array.from({ length: 200 }, (): [number, number] => [
      toPrecision(-180 + rand() * 360),
      toPrecision(-90 + rand() * 180),
    ])
    expect(polyline.decodePolyline(polyline.encodePolyline(points))).toEqual(points)
  })

  it('keeps each raw coordinate within half a unit of 1e5 precision', () => {
    const rand = lcg(7)
    const raw = Array.from({ length: 200 }, (): [number, number] => [-180 + rand() * 360, -90 + rand() * 180])
    const decoded = polyline.decodePolyline(polyline.encodePolyline(raw))
    expect(decoded.length).toBe(raw.length)
    raw.forEach(([lng, lat], i) => {
      expect(Math.abs(decoded[i][0] - lng)).toBeLessThanOrEqual(0.5e-5 + 1e-12)
      expect(Math.abs(decoded[i][1] - lat)).toBeLessThanOrEqual(0.5e-5 + 1e-12)
    })
  })
})

describe('decodePolyline on cut-off strings', () => {
  const full = polyline.decodePolyline(EXAMPLE_ENCODED)

  it('returns a prefix of the full decode at every cut position', () => {
    for (let k = 0; k <= EXAMPLE_ENCODED.length; k++) {
      const partial = polyline.decodePolyline(EXAMPLE_ENCODED.slice(0, k))
      expect(partial).toEqual(full.slice(0, partial.length))
    }
  })

  it('never returns the last point before its final character arrives', () => {
    for (let k = 0; k < EXAMPLE_ENCODED.length; k++) {
      expect(polyline.decodePolyline(EXAMPLE_ENCODED.slice(0, k)).length).toBeLessThan(full.length)
    }
  })

  it('drops the last point when its final character is missing', () => {
    // The old decoder read past the end here and returned a wrong longitude.
    expect(polyline.decodePolyline(EXAMPLE_ENCODED.slice(0, -1))).toEqual(full.slice(0, 2))
  })

  it('drops a lat that has no lng after it', () => {
    expect(polyline.decodePolyline('_p~iF')).toEqual([])
    expect(polyline.decodePolyline('_p~iF~ps|U_ulL')).toEqual(full.slice(0, 1))
  })

  it('stops inside a multi-character value', () => {
    expect(polyline.decodePolyline('_p~iF~ps|U_ul')).toEqual(full.slice(0, 1))
  })
})

describe('shared module', () => {
  it('routes.ts and google.ts export the same function objects', () => {
    expect(routes.decodePolyline).toBe(polyline.decodePolyline)
    expect(google.encodePolyline).toBe(polyline.encodePolyline)
  })
})
