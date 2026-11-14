// W10 phone full screen: the Map tab owns the phone, the day pill carries the
// back control, the settings stay reachable, and desktop keeps its chrome.
// The node env has no DOM, so the component check reads the markup string.
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MapPhoneDay } from '../src/components/map/MapWorkspaceChrome'
import type { Trip } from '../src/data/types'
import type { Journey } from '../src/lib/engine'

const noop = () => undefined
const read = (...parts: string[]) => readFileSync(new URL(`../${parts.join('/')}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const trip = {
  id: 'w10-trip',
  name: 'W10 trip',
  startDate: '2027-11-14',
  fixedCommitments: [],
  days: [{ id: 'w10-day', index: 0, title: 'Munnar to Thekkady', startTime: '10:00', stops: [] }],
} as unknown as Trip

const journey = {
  dayIndex: 0,
  startTime: '10:00',
  startTitle: 'Munnar',
  endTitle: 'Thekkady',
  distanceKm: 42,
  driveMinutes: 80,
  points: [],
} as unknown as Journey

function pill(extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(MapPhoneDay, {
    trip,
    journey,
    activeDay: 0,
    allDays: false,
    onShowAll: noop,
    onDayChange: noop,
    onBack: noop,
    ...extra,
  }))
}

describe('W10 phone full screen', () => {
  it('proves the runner runs', () => { expect(1).toBe(1) })

  it('keeps one slim pill row: back, day and map, route title, then the day steps', () => {
    const html = pill()
    expect(html).toContain('Back to trip')
    expect(html).toContain('Day 1 · Map')
    expect(html).toContain('Munnar')
    expect(html).toContain('Thekkady')
    expect(html).toContain('Previous map day')
    expect(html).toContain('Next map day')
    // W14: "All days" is a mode, not a day step. It moved behind the pill's
    // overflow, so the row keeps the board's four controls.
    expect(html).toContain('Map day options')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).not.toContain('mv2-phone-day-all')
  })

  it('keeps the all-days choice in the pill overflow', () => {
    const chrome = read('src', 'components', 'map', 'MapWorkspaceChrome.tsx')
    expect(chrome).toContain('All days')
    expect(chrome).toContain('role="menuitemradio"')
    expect(chrome).toContain('onShowAll()')
  })

  it('draws the back control only when the trip can take it back', () => {
    expect(pill()).toContain('aria-label="Back to trip"')
    expect(pill({ onBack: undefined })).not.toContain('Back to trip')
  })

  it('sets the full-screen attribute only for the map tab on a phone', () => {
    const workspace = read('src', 'pages', 'TripWorkspace.tsx')
    expect(workspace).toContain("useMedia('(max-width: 760px)') && tab === 'map'")
    expect(workspace).toContain("data-map-fullscreen={phoneMapFullscreen ? 'true' : undefined}")
    expect(workspace).toContain("onBackToTrip={() => setTab('overview')}")
  })

  it('hides the trip header and gives the map the viewport in the phone query', () => {
    const css = read('src', 'styles', 'components', 'map-v2-rail.css')
    expect(css).toMatch(/@media \(max-width: 760px\) \{[\s\S]*\.yf-workspace\[data-map-fullscreen='true'\] \.yf-page \{ display: none; \}/)
    expect(css).toMatch(/\.yf-workspace\[data-map-fullscreen='true'\] \.mv2-workspace \{ height: 100dvh;/)
  })

  it('puts source and Refresh after the deck and route advice in Fix', () => {
    const mapTab = read('src', 'pages', 'trip', 'MapTab.tsx')
    expect(mapTab).not.toContain('settingsTools')
    const see = mapTab.indexOf('id="rail-see"')
    expect(mapTab.indexOf('{deckFooter}', see)).toBeGreaterThan(mapTab.indexOf('<MapLensPanel', see))
    expect(mapTab).toContain('routeAdvice={routeAdvice}')
    expect(mapTab).toContain('const deckFooter = <footer')
    expect(mapTab).toContain('title="Refresh suggestions"')
  })

  it('frames the stay ring above the phone sheet at every snap', () => {
    const mapTab = read('src', 'pages', 'trip', 'MapTab.tsx')
    expect(mapTab).toContain('kind: \'bounds\'')
    expect(mapTab).toContain('sheet.addEventListener(\'transitionend\', measure)')
    expect(mapTab).toContain('bottom: phoneSheet ? phoneSheetHeight : 0')
    expect(mapTab).toContain("frameStayRing={lens === 'stay' && lenses.stay.base != null && !phoneSheet}")
    expect(mapTab).toContain('mapTarget={localTarget ?? mapTarget ?? phoneStayTarget}')
    expect(mapTab).toContain('inSheet={false}')
    expect(read('src', 'components', 'map', 'MapWorkspaceChrome.tsx'))
      .toContain("const rootClass = inSheet ? 'mv2-ribbon-sheet' : 'mv2-ribbon'")
  })

  it('floats the requested phone ribbon above the sheet and keeps the peek row', () => {
    const css = read('src', 'styles', 'components', 'map-v2-rail.css')
    expect(css).toMatch(/\.mv2-workspace \.mv2-ribbon \{[^}]*bottom: calc\(var\(--mv2-sheet-height\)/)
    const mapTab = read('src', 'pages', 'trip', 'MapTab.tsx')
    expect(mapTab).toContain('mv2-peek-eyebrow')
    expect(mapTab).toContain('mv2-peek-count')
    expect(mapTab).not.toContain('ribbonSheet')
  })

  it('hides the fixture host header on a phone and keeps it on desktop', () => {
    const fixture = read('dev', 'map-workspace-fixture.css')
    expect(fixture).toMatch(/@media\s*\(max-width:\s*760px\)\s*\{[\s\S]*?\.map-fixture-header[^{}]*\{[^}]*display\s*:\s*none/)
    expect(read('dev', 'map-workspace-fixture.tsx')).toContain('onBackToTrip=')
  })
})
