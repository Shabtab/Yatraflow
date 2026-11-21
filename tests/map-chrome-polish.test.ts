// The Map tab chrome polish: day pills, one panel by default, the cluster chip,
// the attribution corner and the motion that each panel carries.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const chrome = read('../src/components/map/MapWorkspaceChrome.tsx')
const tab = read('../src/pages/trip/MapTab.tsx')
const tripMap = read('../src/components/TripMap.tsx')
const mapcn = read('../src/components/mapcn/map.tsx')
const css = read('../src/styles/components/map-v2-rail.css')
const markCss = read('../src/components/map/mapMarks.css')

describe('Days on the map', () => {
  it('draws each day as one pill in its own colour, with no separate dot', () => {
    expect(chrome).toMatch(/className="mv2-day-pill" style=\{\{ '--mv2-day-tone': dayColor\(item\.index\) \}/)
    expect(chrome).not.toMatch(/<span aria-hidden="true" style=\{\{ '--mv2-day-tone'/)
    expect(css).toMatch(/\.mv2-day-strip > \.mv2-day-pill\[aria-pressed='true'\] \{[^}]*background: var\(--mv2-day-tone\)/)
  })
  it('wraps the pills and never scrolls the strip', () => {
    expect(css).toContain('.mv2-workspace .mv2-day-strip { flex-wrap: wrap; overflow: visible; }')
  })
})

describe('One panel by default', () => {
  it('opens only the day rail on a wide screen; the phone sheet keeps its deck', () => {
    expect(tab).toContain("const [deckOpen, setDeckOpen] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches)")
  })
})

describe('Suggestion states', () => {
  it('shows the live states on the deck top and keeps no hidden help button', () => {
    expect(tab).not.toContain('How suggestions work')
    expect(tab).not.toContain('mv2-suggestion-info')
    // The scope picker shares the deck title row, so the live status opens the deck.
    expect(tab).toContain('scopeSlot={scopeBand}')
    expect(tab).toMatch(/onSnapSettled=[^\n]*\n\n\s*\{deckStatus\}/)
  })
})

describe('Space round four', () => {
  it('puts the route warning on the Fix button, not in a strip', () => {
    expect(tab).not.toContain('mv2-route-banner')
    expect(tab).toContain("data-alert={routeAlert ? 'true' : undefined} title={routeAlert ? routeAlertText : undefined}")
    expect(css).toMatch(/\.mv2-lens-alert \{[^}]*background: var\(--pw-marigold-500\)/)
  })
  it('shows card facts as icon and value on one line, with a quick add on other cards', () => {
    const card = read('../src/components/map/lenses/LensPlaceCard.tsx')
    expect(card).toContain('<CellIcon className="mv2-lens-cell-icon" size={14} aria-hidden />')
    expect(card).toContain('className="mv2-lens-quick-add"')
    expect(css).toContain('.mv2-workspace[data-role="viewer"] .mv2-lens-quick-add { display: none; }')
  })
  it('puts the scope picker in the deck title row and drops the wide-screen close button', () => {
    expect(read('../src/components/map/lenses/DriveTabs.tsx')).toContain('aside={scopeSlot}')
    expect(css).toContain('@media (min-width: 761px) { .mv2-workspace .mv2-lens-deck-close { display: none; } }')
  })
})

describe('Space round five', () => {
  it('keeps the day title on one line, with the full title in its tooltip', () => {
    expect(chrome).toContain('<h2 title={headTitleText}>')
    expect(css).toContain('.mv2-workspace .mv2-day-header h2 { display: block; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }')
  })
  it('hides the detour box when the day has no detour stops', () => {
    expect(tab).toContain("driveBudget?.kind === 'empty'")
  })
  it('puts the time range in the day info line and the chip only on a folded rail', () => {
    expect(chrome).toContain('className="mv2-day-clock"')
    expect(tab).toContain('{!phoneSheet && !itineraryOpen && <button type="button" className="mv2-clock-chip"')
  })
  it('draws the footer as one row: day pills and a Timeline icon', () => {
    expect(chrome).not.toContain('Days on the map</span>')
    expect(chrome).toContain('aria-label="Open day in Timeline" title="Open day in Timeline"')
    expect(css).toContain('.mv2-workspace .mv2-day-footer { flex-direction: row;')
  })
  it('cycles the map view from one button, kept in the More menu on the phone', () => {
    expect(tripMap).toContain('className="mv2-map-tools-btn mv2-map-view-cycle"')
    expect(tripMap).toContain('className="mv2-map-tools-btn mv2-map-view-menu"')
    expect(css).toMatch(/@media \(max-width: 760px\) \{\n  \.mv2-workspace \.map-toolbar \.mv2-map-tools-card\.mv2-map-view \{ display: none; \}/)
  })
})

describe('Cluster badge', () => {
  it('draws a group as a DOM pin, a pile of pick tiles with its count', () => {
    expect(tripMap).toContain('drawBadges={!workspaceChrome}')
    expect(tripMap).toContain('onClusterBadges={workspaceChrome ? onClusterBadges : undefined}')
    expect(tripMap).toContain('className="mv2-stack"')
    expect(mapcn).toContain('onClusterBadges?: (badges: ClusterBadge[]) => void;')
    expect(mapcn).not.toContain('drawStack')
    expect(mapcn).not.toContain('styleimagemissing')
  })
  it('slides the pin off a stop, as a mark in the shared layout', () => {
    expect(tripMap).toContain("spreadMarks.push({ id: `group:${badge.id}`, layer: 'group'")
    expect(tripMap).toContain('offsetWrap(`group:${badge.id}`')
  })
  it('names the group on hover, opens it on click, and lifts', () => {
    expect(tripMap).toContain('title={`${label} · Click to open`}')
    expect(tripMap).toContain('zoom: Math.max(badge.expandZoom')
    expect(markCss).toMatch(/button\.mv2-stack:hover, button\.mv2-stack:focus-visible \{ transform: translateY\(-2px\)/)
  })
  it('moves the camera once, never guesses a zoom, and keeps only the latest report', () => {
    expect(mapcn).toContain('if (!drawBadges) return;')
    expect(mapcn).toContain('.catch(() => null)')
    expect(mapcn).not.toContain('getZoom() + 2')
    expect(mapcn).toContain('if (cancelled || seq !== reportSeq) return;')
    expect(chrome).toContain('<span className="sr-only" role="status">{daysCaption}</span>')
  })
  it('draws the key mark as the same stack', () => {
    expect(css).toMatch(/\.mv2-key-cluster \{[^}]*box-shadow: 0 -4px 0 -2px #D6EEEA/)
    expect(markCss).toMatch(/\.mv2-stack \{[^}]*box-shadow: 0 -4px 0 -2px #D6EEEA/)
  })
})

describe('Attribution', () => {
  it('sits in the map corner as a round chip', () => {
    expect(css).toContain('.mv2-workspace .maplibregl-ctrl-attrib.maplibregl-compact:not(.maplibregl-compact-show) { width: 28px; padding: 0; }')
  })
})

describe('Motion', () => {
  it('slides each panel in and restarts the deck rise on a lens change', () => {
    expect(css).toContain('.mv2-workspace .mv2-itinerary { animation: mv2-rail-in var(--motion-slow) var(--ease-paper) backwards; }')
    expect(css).toMatch(/\.poi-col:not\(\[hidden\]\), \.mv2-workspace \.mv2-detail \{ animation: mv2-deck-in/)
    expect(tab).toContain('id="rail-see" data-lens={lens}')
    for (const lens of ['stay', 'gap', 'fix']) expect(css).toContain(`[data-lens='${lens}'] { --mv2-lens-rise: mv2-rise-${lens}; }`)
  })
  it('turns every new animation off for reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n\s*\.mv2-workspace \.mv2-itinerary, [^}]*\.mv2-layers-dot \{ animation: none; \}/)
  })
})

describe('Map interaction round two', () => {
  it('hides a route tick that collides, so ticks never stack', () => {
    expect(tripMap).toContain("maxTravel: mark.kind === 'tick' ? 0 : 160")
    expect(tripMap).toMatch(/const TICK_ROOM = \d+/)
  })
  it('closes open map surfaces on a blank map click, but never on a pin or a cluster badge', () => {
    expect(tripMap).toContain("target.closest('.maplibregl-marker, .maplibregl-popup')) return")
    expect(tripMap).toContain(".some(f => f.layer.id.startsWith('clusters-') || f.layer.id.startsWith('cluster-count-'))")
    expect(tripMap).toContain('onBlankMapClickRef.current?.()')
    expect(tripMap).toContain("document.addEventListener('pointerdown', onPointerDown, true)")
    // The stop edit card closes on the same bare-map click, with no focus grab.
    expect(tab).toContain('onBlankMapClick={() => { if (detailId != null) setDetailId(null); if (selectedStop != null) closeSelectedStop(false) }}')
  })
  it('glides the camera on one eased curve, with no zero-time settle jump', () => {
    expect(tripMap).toContain('duration, easing: easeInOutCubic')
    expect(tripMap).toContain('duration: nudge, easing: easeInOutCubic')
  })
  it('puts a fold tab on the centre of each panel edge', () => {
    expect(tab).toContain('className={`mv2-edge-tab mv2-edge-tab--day')
    expect(tab).toContain('className={`mv2-edge-tab mv2-edge-tab--deck')
    expect(css).toMatch(/\.mv2-edge-tab \{[^}]*top: 50%;[^}]*translate: 0 -50%;/)
  })
  it('keeps a closing panel mounted while its exit plays', () => {
    expect(tab).toContain('const railPresence = usePresence(itineraryOpen)')
    expect(tab).toContain('const deckPresence = usePresence(deckOpen)')
    expect(css).toContain('.mv2-workspace .map-edit-keys.is-leaving .mv2-itinerary { animation: mv2-rail-out var(--motion-med) var(--ease-exit) forwards;')
  })
  it('replays the day cascade on a day change', () => {
    expect(chrome).toContain("<div className=\"mv2-day-head\" key={allDays ? 'all' : activeDay}>")
    expect(css).toContain('animation: mv2-day-swap var(--motion-slow) var(--ease-paper) backwards;')
  })
  it('keeps the corner controls one even inset from the edge when the deck folds', () => {
    expect(css).toContain('.mv2-workspace.is-deck-folded { --mv2-deck-width: 0px; --mv2-deck-gutter: 0px; }')
    expect(css).toContain('right: calc(var(--mv2-deck-width) + var(--mv2-inset) + var(--mv2-edge-tab-w) + var(--space-4));')
  })
  it('stacks each lens fact label over its value, so a fact never runs into the next column', () => {
    expect(css).not.toMatch(/\.mv2-lens-drive \.mv2-lens-cell \{[^}]*flex-direction: row/)
    expect(css).toContain('.mv2-lens-drive .mv2-lens-cell-value { white-space: nowrap; }')
  })
})

describe('Every tappable map mark answers a hover', () => {
  const marks = read('../src/components/map/mapMarks.css')
  it('gives the problem diamond a pointer and a lift, and the gap ring a fill', () => {
    expect(marks).toMatch(/\.mv2-warn-diamond \{[^}]*cursor: pointer;/)
    expect(marks).toContain('button.mv2-warn-diamond:hover {')
    expect(marks).toContain('button.mv2-lens-gap-ring:hover {')
    expect(marks).toContain('.mv2-warn-diamond, button.mv2-lens-gap-ring { transition: none; }')
  })
})

describe('Map surfaces round three', () => {
  it('puts every floating part on the app glass, with one blur', () => {
    expect(css).toMatch(/\.mv2-workspace \.mv2-map-key, \.mv2-workspace \.map-filters-pop \{\n\s*background: var\(--pw-glass\); -webkit-backdrop-filter: blur\(var\(--yf-blur-panel\)\) saturate\(1\.25\); backdrop-filter: blur\(var\(--yf-blur-panel\)\) saturate\(1\.25\);/)
  })
  it('gives the deck an even 16 px side inset, with no scrollbar eating the right side', () => {
    expect(css).toContain('.mv2-lens { display: flex; flex-direction: column; gap: var(--space-5); padding: 0 var(--mv2-panel-pad) var(--mv2-panel-pad);')
    expect(css).toContain('.mv2-workspace { --mv2-day-width: 380px; --mv2-deck-width: 372px; --mv2-inset: var(--space-5); --mv2-panel-pad: var(--space-7);')
    expect(css).toMatch(/\.mv2-workspace \.map-ideas-grid > \.poi-col, \.mv2-detail \{[^}]*scrollbar-width: none;/)
  })
  it('draws a pick on the map as a solid family tile', () => {
    const marks = read('../src/components/map/mapMarks.css')
    expect(marks).toContain('.mv2-workspace .maplibregl-marker .yf-map-pin-idea[data-family] { --mark-tint: var(--mark-family); --mark-edge: var(--mark-family); color: var(--mv2-pick-glyph, #FFFFFF); }')
  })
})
