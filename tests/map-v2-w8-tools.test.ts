import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const tsx = readFileSync(new URL('../src/components/TripMap.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const css = readFileSync(new URL('../src/styles/components/map-v2-rail.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// The workspace branch runs from the ternary to the legacy branch.
function workspaceBranch(): string {
  const start = tsx.indexOf('{workspaceChrome ? (')
  const end = tsx.indexOf(') : (', start)
  return start >= 0 && end > start ? tsx.slice(start, end) : ''
}

describe('W8 tools map controls', () => {
  it('keeps primary tools in a column and secondary tools in menus', () => {
    const b = workspaceBranch()
    expect(b.length).toBeGreaterThan(0)
    expect(b).toContain('aria-label="Zoom and recentre"')
    expect(b).toContain('mv2-map-view')
    expect(b).toContain('aria-label="More map tools"')
    expect(b).toContain('aria-label="Layers"')
  })

  it('keeps the zoom buttons and their labels', () => {
    const b = workspaceBranch()
    expect(b).toContain('aria-label="Zoom in"')
    expect(b).toContain('aria-label="Zoom out"')
  })

  it('keeps the view switch in the tools column, out of the Layers menu', () => {
    const b = workspaceBranch()
    expect(b).toContain('className="mv2-map-tools-card mv2-map-view" role="group" aria-label="Map view mode"')
    expect(b.indexOf('mv2-map-view')).toBeLessThan(b.indexOf('aria-label="Layers"'))
    expect(b).not.toContain("'TER'")
  })

  it('puts Expand in the tools column on a tablet or desktop, and in the menu on a phone', () => {
    const b = workspaceBranch()
    // One card between the view switch and Layers. One button function, so the two places cannot drift.
    expect(b).toContain('<div className="mv2-map-tools-card mv2-map-expand" role="group" aria-label="Map size">')
    expect(b.indexOf('mv2-map-expand"')).toBeGreaterThan(b.indexOf('mv2-map-view"'))
    expect(b.indexOf('mv2-map-expand"')).toBeLessThan(b.indexOf('aria-label="Layers"'))
    expect(b).toContain("{mapExpandButton('mv2-map-expand-menu')}")
    expect(tsx.match(/aria-label=\{expanded \? 'Shrink the map back into the page' : 'Expand the map to fill the screen'\}/g)).toHaveLength(2)
    expect(css).toContain('.mv2-workspace .map-toolbar .mv2-map-tools-card.mv2-map-view, .mv2-workspace .map-toolbar .mv2-map-tools-card.mv2-map-expand { display: none; }')
    expect(css).toContain('.mv2-workspace .mv2-tool-menu-body > .mv2-map-expand-menu { display: flex; }')
  })

  it('drops the Filters text label', () => {
    expect(workspaceBranch()).not.toContain('>Filters')
  })

  it('lists the idea filters inside the layers menu, each with a visible switch', () => {
    const b = workspaceBranch()
    // One menu, no second pop-out: every category row says on or off with a switch.
    expect(b).not.toContain('map-filters-pop')
    expect(b).toContain('aria-label="Nearby idea categories"')
    expect(b).toMatch(/className="mv2-layer-row" aria-pressed=\{!hiddenIdeaCats\.has\(cat\)\}/)
    expect(b).toContain('<span className="mv2-switch" aria-hidden="true" />')
    expect(b).toContain('{shownIdeaCats} / {ideaCats.length} shown')
    expect(css).toMatch(/\.mv2-layer-row\[aria-pressed='true'\] \.mv2-switch \{ background: var\(--pw-sea-700\); \}/)
  })

  it('marks the Layers button while a layer differs from its default', () => {
    expect(workspaceBranch()).toContain('{layersChanged && <span className="mv2-layers-dot" aria-hidden="true" />}')
  })

  it('keeps each map action labelled', () => {
    const b = workspaceBranch()
    for (const label of [
      'Recentre the map on the trip route',
      'Road milestones',
      'Directions for this day in Google Maps',
    ]) expect(b).toContain(label)
    // Expand is drawn by one function, which both the column and the phone menu call.
    const expandFn = tsx.slice(tsx.indexOf('function mapExpandButton('), tsx.indexOf('function collapseExpanded('))
    expect(expandFn).toContain('Expand the map to fill the screen')
  })

  it('divides the buttons with a hairline', () => {
    expect(workspaceBranch()).toContain('mv2-map-tools-divider')
    expect(css).toContain('.mv2-workspace .mv2-map-tools-divider')
  })

  it('uses a teal wash, not a filled circle', () => {
    expect(css).toMatch(/\.mv2-workspace \.mv2-map-tools-card button\.mv2-map-tools-btn\.on,[\s\S]{0,240}var\(--pw-lagoon-100\)/)
    expect(css).toContain('var(--pw-sea-700)')
  })

  it('keeps a 44 px touch target on phone', () => {
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]{0,400}width: 44px; height: 44px/)
  })
})
