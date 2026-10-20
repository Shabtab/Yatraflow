// ============ Map gesture mode ============
// An embed sits in a scrolling page, so a coarse pointer keeps cooperative
// gestures (one finger scrolls, two fingers pan). A surface that owns its area —
// the expanded overlay and the dedicated Map tab — hands one-finger pan and
// pinch to the map. A fine pointer is untouched either way.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { wantsCooperativeGestures } from '../src/components/mapcn/map'

const source = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8')

describe('cooperative gesture policy', () => {
  it('keeps cooperative gestures for an embed in a scrolling page', () => {
    expect(wantsCooperativeGestures({ dedicated: false, expanded: false })).toBe(true)
  })

  it('hands one-finger pan and pinch to the dedicated Map tab', () => {
    expect(wantsCooperativeGestures({ dedicated: true, expanded: false })).toBe(false)
  })

  it('hands them to the expanded overlay too', () => {
    expect(wantsCooperativeGestures({ dedicated: false, expanded: true })).toBe(false)
    expect(wantsCooperativeGestures({ dedicated: true, expanded: true })).toBe(false)
  })
})

describe('the policy is wired to the real surfaces', () => {
  // The matrix above only matters if these two files use it. These are wiring
  // guards, not behaviour: the behaviour is the matrix.
  it('TripMap derives its mode from both flags through the helper', () => {
    const tripMap = source('src/components/TripMap.tsx')
    expect(tripMap).toMatch(/import\s*\{[^}]*\bwantsCooperativeGestures\b[^}]*\}\s*from\s*'\.\/mapcn\/map'/)
    expect(tripMap).toContain(
      '<CooperativeGestures enabled={wantsCooperativeGestures({ dedicated, expanded })} />',
    )
  })

  it('the dedicated Map tab marks itself dedicated', () => {
    const mapTab = source('src/pages/trip/MapTab.tsx')
    expect(mapTab).toMatch(/<TripMap\s+trip=\{trip\}\s+dedicated\b/)
  })

  it('the embed default stays cooperative', () => {
    // A caller that does not opt in must keep the protected mode.
    const tripMap = source('src/components/TripMap.tsx')
    expect(tripMap).toContain('dedicated = false')
  })
})
