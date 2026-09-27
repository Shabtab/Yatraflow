/**
 * #420, slice 3 — the Map tab page's module-level pieces.
 *
 * These three helpers had no direct test at all: they were private to a 2,700-line
 * page, so the only way to exercise them was to render the page. Moving them into
 * `pages/trip/map/pageHelpers.ts` is what makes this file possible — which is the
 * point of the move, not a side effect of it.
 *
 * The slice also deleted a duplicate: `MapTab` carried a byte-identical copy of
 * `lib/clockOverlay.ts`'s `clockHM`, which already has its own tests. A refactor that
 * relocates one copy of a function while leaving another is not a refactor.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { googleMapsUrl, newStopId, smallThumb, SCOPE_KM_STEPS, NEED_PURPOSES } from '../src/pages/trip/map/pageHelpers'

const mapTab = readFileSync(new URL('../src/pages/trip/MapTab.tsx', import.meta.url), 'utf8')
const helpers = readFileSync(new URL('../src/pages/trip/map/pageHelpers.ts', import.meta.url), 'utf8')

describe('#420 — smallThumb rewrites Wikimedia sizes and nothing else', () => {
  it('asks Wikimedia for the 120px rendition', () => {
    expect(smallThumb('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/800px-X.jpg'))
      .toBe('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/120px-X.jpg')
  })

  it('leaves another host alone, even when it looks like a size segment', () => {
    // #177: rewriting a path segment that merely LOOKS like a size mangles it.
    const other = 'https://example.com/photos/800px-holiday.jpg'
    expect(smallThumb(other)).toBe(other)
  })

  it('leaves a Wikimedia URL with no size segment alone', () => {
    const raw = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg'
    expect(smallThumb(raw)).toBe(raw)
  })
})

describe('#420 — googleMapsUrl prefers the place page, then coords, then the name', () => {
  const base = { name: 'Valara Waterfalls', latitude: 10.1, longitude: 76.9 }

  it('uses the real Place page when Google gave us a place_id', () => {
    expect(googleMapsUrl({ ...base, placeId: 'ChIJabc/def' }))
      .toBe('https://www.google.com/maps/place/?q=place_id:ChIJabc%2Fdef')
  })

  it('falls back to the documented coordinate pin URL', () => {
    expect(googleMapsUrl(base)).toBe('https://www.google.com/maps/search/?api=1&query=10.1,76.9')
  })

  it('falls back to the name when there is no position at all', () => {
    expect(googleMapsUrl({ ...base, latitude: Number.NaN }))
      .toBe('https://www.google.com/maps/search/?api=1&query=Valara%20Waterfalls')
  })
})

describe('#420 — newStopId is a CSPRNG handle', () => {
  it('mints a pending id, differently every time', () => {
    const a = newStopId()
    const b = newStopId()
    expect(a).toMatch(/^pending_[0-9a-z]+$/)
    expect(b).toMatch(/^pending_[0-9a-z]+$/)
    expect(a).not.toBe(b)
  })

  it('never reaches for Math.random (#267)', () => {
    expect(helpers).toContain('crypto.getRandomValues')
    // Match a CALL, not the name: this file's own doc comment names the forbidden
    // function in prose, and a source guard reads comments too (AGENTS §3).
    expect(helpers).not.toMatch(/Math\.random\(/)
  })
})

describe('#420 — slice 3 wiring', () => {
  it('the page imports its helpers instead of declaring them', () => {
    expect(mapTab).toContain("from './map/pageHelpers'")
    for (const gone of ['function smallThumb(', 'function googleMapsUrl(', 'function newStopId(', 'const SCOPE_KM_STEPS =', 'const NEED_PURPOSES =']) {
      expect(mapTab, `MapTab still declares ${gone}`).not.toContain(gone)
    }
  })

  it('the duplicated clockHM is gone and the tested one is imported', () => {
    // One implementation, in the module that already tests it.
    expect(mapTab).not.toContain('function clockHM(')
    expect(mapTab).toContain("import { clockHM, deriveClockMilestones } from '../../lib/clockOverlay'")
  })

  it('the constants still mean what the rails assume', () => {
    expect(SCOPE_KM_STEPS).toEqual([10, 20, 30, 50, 80, 100])
    expect(NEED_PURPOSES.has('fuel')).toBe(true)
    expect(NEED_PURPOSES.has('sightseeing')).toBe(false)
  })
})
