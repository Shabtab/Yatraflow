// #546 — the map scope label keeps one line inside the nowrap overflow-x rails.
//
// At phone width the map's day-filter rail goes `flex-wrap: nowrap` +
// `overflow-x: auto` so the day chips scroll — and the "Show on map" label, a
// plain flex item with no shrink protection, was the only child that could
// absorb the width deficit. It collapsed to its minimum content width and
// wrapped one word per line (measured 38×51px at 390px — "SHOW / ON / MAP").
// The fix lives on the class so every rail hosting the label is covered: the
// map's day filter ("Show on map") and the rail's day strip ("Plan this day").
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const tripMap = readFileSync(new URL('../src/components/TripMap.tsx', import.meta.url), 'utf8')
const mapTab = readFileSync(new URL('../src/pages/trip/MapTab.tsx', import.meta.url), 'utf8')

// The class's own rule, with comments stripped — the assertion judges
// declarations, never the prose explaining them (§6x).
const ruleRaw = new RegExp('\\.map-scope-lbl\\s*\\{([^}]*)\\}').exec(css)?.[1] ?? ''
const rule = ruleRaw.replace(/\/\*[\s\S]*?\*\//g, '')

describe('#546 — the map scope label stays out of the shrink calculation', () => {
  it('declares no-wrap on its own class', () => {
    expect(rule).toContain('white-space: nowrap')
  })

  it('declares no-shrink on its own class', () => {
    expect(rule).toContain('flex: none')
  })

  it('both rails that host the label use the class — one rule covers both', () => {
    // The map's day-filter rail ("Show on map") and the suggestion rail's day
    // strip ("Plan this day") share the class, so the fix cannot drift to one.
    expect(tripMap).toContain('className="map-scope-lbl"')
    expect(mapTab).toContain('className="map-scope-lbl"')
  })

  it('the day-filter rail really is the nowrap overflow-x container the fix assumes', () => {
    // If the rail ever stops being nowrap + overflow-x, this test's premise
    // should be revisited rather than the rule silently outliving its reason.
    const mobile = css.slice(css.indexOf('@media (max-width: 720px)'))
    // The base rule wraps on desktop; the phone-width rung is the nowrap rail —
    // assert on whichever rule the media block actually paints with.
    const rails = [...mobile.matchAll(new RegExp('\\.map-day-filter\\s*\\{([^}]*)\\}', 'g'))].map(m => m[1])
    expect(rails.some(r => r.includes('flex-wrap: nowrap') && r.includes('overflow-x: auto'))).toBe(true)
  })
})
