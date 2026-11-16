import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Trip } from '../src/data/types'
import {
  WORKSPACE_TABS,
  foldWorkspaceHeader,
  resolveMapFocus,
  resolveTimelineFocus,
  workspacePanelId,
  workspaceTabId,
} from '../src/lib/workspaceHeader'
import { DEFAULT_COVER_EMOJI, coverPlanFor, isChosenCoverEmoji } from '../src/lib/regionArt'
import { readCssSource } from '../scripts/css-source-graph.mjs'

function tripFixture(): Trip {
  return {
    id: 'trip-1',
    coverEmoji: '🏔️',
    days: [
      { id: 'day-0', index: 0, stops: [{ id: 'stop-a', lat: 22.5, lng: 88.3 }] },
      { id: 'day-1', index: 1, stops: [{ id: 'stop-b', lat: 23, lng: 89 }] },
      { id: 'day-2', index: 2, stops: [{ id: 'stop-without-place', lat: 0, lng: 0 }] },
    ],
  } as Trip
}

function codeOf(path: string): string {
  return readFileSync(resolve(__dirname, path), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

describe('P2 workspace header rules', () => {
  it('folds only the Board and Map tabs', () => {
    expect(WORKSPACE_TABS.filter(([key]) => foldWorkspaceHeader(key)).map(([key]) => key))
      .toEqual(['board', 'map'])
  })

  it('keeps one stable tab and panel id for every tab', () => {
    expect(WORKSPACE_TABS.map(([key]) => workspaceTabId(key))).toEqual([
      'tab-overview', 'tab-board', 'tab-map', 'tab-timeline',
      'tab-group', 'tab-budget', 'tab-share', 'tab-settings',
    ])
    expect(WORKSPACE_TABS.map(([key]) => workspacePanelId(key))).toEqual([
      'panel-overview', 'panel-board', 'panel-map', 'panel-timeline',
      'panel-group', 'panel-budget', 'panel-share', 'panel-settings',
    ])
  })

  it('gives the header the shared cover plan, not a photo-or-emoji switch', () => {
    // The header used to pick ONE thing: the photo, else the emoji, else art.
    // That is why a saved emoji hid the artwork. It now asks the same resolver
    // every card asks, so the artwork is the default and the emoji is last.
    const goa = coverPlanFor({
      region: 'goa',
      seed: 'trip-1',
      placeCount: 2,
      destinations: ['Candolim', 'Colva'],
      startLocation: 'Panaji, Goa',
      fallbackEmoji: '🏖',
    })
    expect(goa.candidates[0]).toEqual({ kind: 'generated', id: expect.stringMatching(/^goa-/) })
    expect(goa.fallbackEmoji).toBe('🏖')

    // An upload still comes first, and the emoji still never joins the images.
    const uploaded = coverPlanFor({
      userCover: 'https://img.test/cover.jpg',
      region: 'goa',
      seed: 'trip-1',
      placeCount: 2,
      destinations: ['Candolim'],
      startLocation: 'Panaji, Goa',
      fallbackEmoji: '🏖',
    })
    expect(uploaded.candidates[0]).toEqual({ kind: 'user', url: 'https://img.test/cover.jpg' })
  })

  it('reads the create form’s compass as no saved emoji', () => {
    // This is the row the store writes for a trip created without touching the
    // emoji picker. It is a default marker, not a choice, so it must never be
    // what the cover falls back to while real artwork exists.
    expect(DEFAULT_COVER_EMOJI).toBe('🧭')
    expect(isChosenCoverEmoji('🧭')).toBe(false)
    expect(coverPlanFor({
      region: 'goa',
      seed: 'trip-1',
      placeCount: 2,
      destinations: ['Candolim'],
      startLocation: 'Panaji, Goa',
      fallbackEmoji: '🧭',
    }).fallbackEmoji).toBe('🧭')
  })

  it('keeps every emoji the traveller picks as the terminal fallback', () => {
    for (const emoji of ['🏔️', '🏖️', '🛕', '🚗', '🚂', '🌴', '🎒']) {
      expect(isChosenCoverEmoji(emoji)).toBe(true)
      const plan = coverPlanFor({
        region: 'generic',
        seed: 'trip-1',
        placeCount: 1,
        destinations: [],
        fallbackEmoji: emoji,
      })
      expect(plan.fallbackEmoji).toBe(emoji)
      // …and never as an image candidate.
      expect(plan.candidates.every(candidate => candidate.kind !== 'user')).toBe(true)
    }
    expect(isChosenCoverEmoji('')).toBe(false)
    expect(isChosenCoverEmoji(undefined)).toBe(false)
  })

  it('stores no cover emoji when the traveller leaves the picker alone', () => {
    const create = codeOf('../src/pages/CreateTrip.tsx')
    expect(create).toContain('coverEmoji: isChosenCoverEmoji(f.coverEmoji) ? f.coverEmoji : \'\',')
  })
})

describe('workspace focus targets', () => {
  const trip = tripFixture()

  it('validates a day and keeps a stop only when it belongs to that day', () => {
    expect(resolveTimelineFocus(trip, { dayIndex: 1, stopId: 'stop-b' }))
      .toEqual({ dayIndex: 1, stopId: 'stop-b', block: null })
    expect(resolveTimelineFocus(trip, { dayIndex: 0, stopId: 'stop-b' }))
      .toEqual({ dayIndex: 0, stopId: null, block: null })
    expect(resolveTimelineFocus(trip, { dayIndex: 99 }))
      .toEqual({ dayIndex: null, stopId: null, block: null })
  })

  it('finds the day for a stop-only request', () => {
    expect(resolveTimelineFocus(trip, { stopId: 'stop-b' }))
      .toEqual({ dayIndex: 1, stopId: 'stop-b', block: null })
  })

  it('maps the trip-wide target without inventing a day', () => {
    expect(resolveTimelineFocus(trip, { block: 'trip-wide' }))
      .toEqual({ dayIndex: null, stopId: null, block: 'trip-wide' })
  })

  it('selects the day for a map stop and clears it for a point or bounds target', () => {
    expect(resolveMapFocus(trip, { kind: 'stop', stopId: 'stop-b' }))
      .toEqual({ dayIndex: 1, target: { kind: 'stop', stopId: 'stop-b' } })
    expect(resolveMapFocus(trip, { kind: 'coordinate', coordinate: { lat: 22.5, lng: 88.3 } }))
      .toEqual({ dayIndex: null, target: { kind: 'coordinate', coordinate: { lat: 22.5, lng: 88.3 } } })
    expect(resolveMapFocus(trip, { kind: 'bounds', points: [{ lat: 22.5, lng: 88.3 }, { lat: 23, lng: 89 }] }).dayIndex)
      .toBeNull()
  })

  it('rejects a map target that names no stop on this trip', () => {
    expect(resolveMapFocus(trip, { kind: 'stop', stopId: 'missing' }))
      .toEqual({ dayIndex: null, target: null })
  })

  it('opens the day but sends no camera target for a stop without a place', () => {
    expect(resolveMapFocus(trip, { kind: 'stop', stopId: 'stop-without-place' }))
      .toEqual({ dayIndex: 2, target: null })
  })
})

describe('the workspace markup consumes the rules', () => {
  const ws = codeOf('../src/pages/TripWorkspace.tsx')

  it('wraps the header and tabs in yf-page without putting it on the container', () => {
    expect(ws).toContain('className="yf-page"')
    expect(ws).toContain('className="container page-enter yf-workspace"')
  })

  it('shows one invite action behind the editable gate', () => {
    const invites = ws.match(/\{editable && \(\s*<button[\s\S]{0,180}>Invite & share<\/button>/g) ?? []
    expect(invites).toHaveLength(1)
  })

  it('gives every tab its stable controls id', () => {
    expect(ws).toContain('id: workspaceTabId(key)')
    expect(ws).toContain('controls: workspacePanelId(key)')
  })

  it('publishes the fold state on the workspace container and page wrapper', () => {
    // W10 added the phone full-screen flag beside the two existing ones: the one
    // container still publishes the fold state and which tab holds the map.
    expect(ws).toMatch(/<div className="container page-enter yf-workspace" data-wide=\{headerFolded \? 'true' : 'false'\} data-map-active=\{tab === 'map' \? 'true' : undefined\} data-canvas=\{headerFolded \? 'true' : undefined\} data-map-fullscreen=\{phoneMapFullscreen \? 'true' : undefined\}>/)
    expect(ws).toMatch(/<div className="yf-page" data-compact=\{headerFolded \? 'true' : 'false'\}>/)
  })

  it('makes folded content inert after focus moves to the active tab', () => {
    expect(ws).toContain('<div className="yf-extra" ref={headerExtraRef}>')
    expect(ws).toMatch(/const \[headerExtraInert, setHeaderExtraInert\] = useState\(false\)/)
    expect(ws).toMatch(/extra\.contains\(active\)[\s\S]{0,220}workspaceTabId\(tab\)\)\?\.focus\(\)[\s\S]{0,100}setHeaderExtraInert\(true\)/)
    expect(ws).toMatch(/if \(headerExtraRef\.current\) headerExtraRef\.current\.inert = headerExtraInert/)
  })

  it('passes the map target and consume callback to the map consumer', () => {
    expect(ws).toMatch(/<MapTab\b[\s\S]*?mapTarget=\{mapTarget\} onMapTargetConsumed=\{consumeMapTarget\}/)
    const mapTab = codeOf('../src/pages/trip/MapTab.tsx')
    // W10: a phone Stay ring can ask for its own target, which outranks the
    // page's. The local request is still cleared first, before the page's is consumed.
    expect(mapTab).toMatch(/<TripMap\b[\s\S]*?mapTarget=\{localTarget \?\? mapTarget \?\? phoneStayTarget\}/)
    expect(mapTab).toContain('if (localTarget) setLocalTarget(null); else if (mapTarget) onMapTargetConsumed?.()')
    const map = codeOf('../src/components/TripMap.tsx')
    expect(map).toMatch(/targetCameraActive\.current = true\s*targetCameraDay\.current = dayFilter\s*onMapTargetConsumed\?\.\(\)/)
    expect(map).toMatch(/!validMapCoordinate\(sourceStop\) \|\| sourceStop\.lat === 0/)
  })

  it('clears a pending map target when the workspace switches trips', () => {
    const start = ws.indexOf('setMapInputs(null)')
    const reset = ws.slice(start, ws.indexOf('}, [tripId])', start))
    expect(start).toBeGreaterThan(-1)
    expect(reset).toContain('setMapInputs(null)')
    expect(reset).toContain('setCorridorSnapshot(null)')
    expect(reset).toContain('setMapTarget(null)')
  })

  it('passes the timeline focus block and consume callback to the timeline consumer', () => {
    expect(ws).toMatch(/<TimelineTab\b[\s\S]*?focusBlock=\{timelineFocusBlock\}[\s\S]{0,160}onFocusConsumed=\{clearTimelineFocus\}/)
    const timeline = codeOf('../src/pages/trip/TimelineTab.tsx')
    expect(timeline).toMatch(/if \(focusBlock !== 'trip-wide'\) return/)
    expect(timeline).toMatch(/const block = document\.getElementById\('timeline-trip-wide'\)[\s\S]{0,500}onFocusConsumed\?\.\(\)/)
  })
})

describe('PW-05: one cover height across the content tabs, a slim bar on Map', () => {
  // CRLF to LF, so the multi-line patterns below hold on a Windows checkout.
  const css = readCssSource('src/styles.css').replace(/\r\n/g, '\n')
  const ws = codeOf('../src/pages/TripWorkspace.tsx')

  /** The declaration block of the first rule whose selector list equals `selector`. */
  function ruleBody(selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)
    expect(match, `rule not found: ${selector}`).not.toBeNull()
    return match![1]
  }

  it('gives Settings and Timeline no cover height or title clamp of their own', () => {
    // These `body:has(...)` overrides resized the cover after the tab switched
    // (and again after the lazy mount), which moved the tab pill.
    expect(css).not.toContain('body:has(.tset-grid) .yf-page .yf-trip-head')
    expect(css).not.toContain('body:has(.tl-head) .yf-page .yf-trip-head')
  })

  it('sets one cover height per breakpoint and never animates it', () => {
    const base = ruleBody('.yf-page .yf-trip-head')
    expect(base).toMatch(/height:\s*308px;/)
    expect(base).toMatch(/transition:\s*box-shadow var\(--motion-slow\) var\(--ease-glide\);/)
    expect(base).not.toMatch(/transition:[^;]*height/)
    // Phone steps: 306px up to 720px, and 324px below 380px where the member row wraps.
    expect(css).toMatch(/@media \(max-width: 720px\) \{[\s\S]*?\.yf-page \.yf-trip-head \{\s*height: 306px;/)
    expect(css).toMatch(/@media \(max-width: 380px\) \{\s*\.yf-page \.yf-trip-head \{\s*height: 324px;/)
  })

  it('holds the Settings cover at the common width so the pill cannot slide', () => {
    const body = ruleBody('.container.yf-workspace.yf-workspace:has(.tset-grid) .yf-page')
    expect(body).toMatch(/max-width:\s*1140px;/)
    expect(body).toMatch(/margin-inline:\s*auto;/)
  })

  it('bounds the title and the meta line so the member row never reaches the pill', () => {
    const title = ruleBody(".yf-page[data-compact='false'] .yf-trip-head .yf-trip-title")
    expect(title).toMatch(/-webkit-line-clamp:\s*2;/)
    expect(title).toMatch(/line-clamp:\s*2;/)
    const meta = ruleBody(".yf-page[data-compact='false'] .yf-head-meta")
    expect(meta).toMatch(/-webkit-line-clamp:\s*1;/)
    // The folded Board header keeps its full wrap: the clamp is scoped to the open cover.
    expect(css).not.toMatch(/\.yf-page\[data-compact='true'\] \.yf-trip-head \.yf-trip-title \{[^}]*line-clamp/)
    // The full name and the full meta line stay reachable.
    expect(ws).toContain('<h1 className="yf-header-title yf-trip-title" title={trip.name}>{trip.name}</h1>')
    expect(ws).toContain('<p className="yf-head-meta yf-fade" title={headerMeta}>{headerMeta}</p>')
  })

  it('anchors the title block on the pill floor instead of the top', () => {
    expect(ruleBody('.yf-page .yf-head-row')).toMatch(/margin-top:\s*auto;/)
    expect(ruleBody('.yf-page .yf-trip-head > .yf-cover-content')).toMatch(
      /padding:\s*var\(--space-7\) var\(--space-11\) calc\(var\(--space-7a\) \+ var\(--yf-pill-h\) \+ var\(--space-7a\)\);/,
    )
  })

  it('keeps the pill left-aligned at the mockup offset on the cover', () => {
    const pill = ruleBody('.yf-page .yf-cover-content > .yf-tabbar')
    expect(pill).toMatch(/left:\s*var\(--space-9\);/)
    expect(pill).toMatch(/bottom:\s*var\(--space-7a\);/)
  })

  it('turns the cover into one slim bar on Map and Board by hiding the parts with display none', () => {
    // Map and Board share the bar through data-canvas, so they look the same.
    const scope = ".yf-workspace[data-canvas='true'] .yf-page.yf-page[data-compact='true']"
    const hidden = ruleBody(
      `${scope} .yf-trip-head > .yf-cover-media,\n${scope} .yf-fold,\n${scope} .yf-extra,\n${scope} .yf-cover-top .yf-invite`,
    )
    // `display: none` takes the member avatars and the invite button out of the tab order.
    expect(hidden).toMatch(/display:\s*none;/)
    expect(hidden).not.toMatch(/visibility/)
    expect(ruleBody(`${scope} .yf-trip-head`)).toMatch(/height:\s*auto;/)
    // The tab rail stays inside the bar, in the same tablist (no second tree).
    expect(ruleBody(`${scope} .yf-cover-content > .yf-tabbar`)).toMatch(/margin:\s*0;/)
    expect(ws.match(/<SegmentedTabs className="tabbar yf-tabbar"/g)).toHaveLength(1)
  })
})
