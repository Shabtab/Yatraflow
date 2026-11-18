// ============ Map v2: the stop card's ways out ============
// The card used to open with no way to close it. It now closes from its own
// button, from Escape, and from a click on bare map. A node test cannot fire a
// DOM event, so the Escape rule is a pure function here and the wiring is read
// off the real sources.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { escapeClosesCard } from '../src/pages/trip/map/editing/cardClose'

const read = (rel: string) => readFileSync(new URL('../' + rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const cards = read('src/pages/trip/map/editing/EditCards.tsx')
const panel = read('src/pages/trip/map/MapEditPanel.tsx')
const tab = read('src/pages/trip/MapTab.tsx')
const css = read('src/styles/components/map-v2-rail.css')
const tripMap = read('src/components/TripMap.tsx')

const base = { key: 'Escape', defaultPrevented: false, inTextField: false, inOtherDialog: false }

describe('escapeClosesCard', () => {
  it('closes on a plain Escape', () => {
    expect(escapeClosesCard(base)).toBe(true)
  })

  it('leaves every other key alone', () => {
    expect(escapeClosesCard({ ...base, key: 'Enter' })).toBe(false)
    expect(escapeClosesCard({ ...base, key: 'Tab' })).toBe(false)
  })

  it('lets a menu that already took the key keep it', () => {
    expect(escapeClosesCard({ ...base, defaultPrevented: true })).toBe(false)
  })

  it('never closes under a text field or another dialog', () => {
    expect(escapeClosesCard({ ...base, inTextField: true })).toBe(false)
    expect(escapeClosesCard({ ...base, inOtherDialog: true })).toBe(false)
  })

  it('leaves Escape to an open menu that listens on the document', () => {
    const closer = read('src/pages/trip/map/editing/cardClose.ts')
    expect(closer).toContain('[role="menu"]')
    expect(closer).toContain('[aria-haspopup][aria-expanded="true"]')
  })
})

describe('the card carries its own close control', () => {
  it('renders a labelled X button that calls the page', () => {
    expect(cards).toContain('className="map-edit-close"')
    expect(cards).toContain('aria-label="Close"')
    expect(cards).toContain('onClick={onClose}')
  })

  it('sits after the grip, so it reads at the top right of the head', () => {
    expect(cards.indexOf('map-edit-close')).toBeGreaterThan(cards.indexOf('map-edit-grip'))
  })

  it('meets the 44 px map floor', () => {
    const rule = css.split('\n').find(line => line.startsWith('.map-edit-close {'))
    expect(rule).toBeDefined()
    expect(rule).toContain('width: 44px')
    expect(rule).toContain('height: 44px')
  })

  it('keeps the day menu first in line for Escape', () => {
    expect(cards).toMatch(/key === 'Escape'\) \{ event\.preventDefault\(\); event\.stopPropagation\(\)/)
  })
})

describe('the panel passes the close down', () => {
  it('declares the handler and hands it to the card', () => {
    expect(panel).toContain('onClose: () => void')
    expect(panel).toContain('onClose={onClose}')
  })
})

describe('the page owns the one close', () => {
  it('clears the selected stop through its existing setter', () => {
    expect(tab).toMatch(/const closeSelectedStop = useCallback\(\(restoreFocus = true\) => \{\n\s*setSelectedStop\(null\)/)
  })

  it('gives the card the page close', () => {
    expect(tab).toContain('onClose={() => closeSelectedStop()}')
  })

  it('binds Escape only while the card is on screen', () => {
    expect(tab).toContain('cardCloseFromEvent')
    expect(tab).toContain('if (!stopCardOpen) return')
    expect(tab).toContain("document.addEventListener('keydown', onKey)")
    expect(tab).toContain('{stopCardOpen &&')
  })

  it('closes on a real map click, never on a press or a drag', () => {
    expect(tab).toContain('if (selectedStop != null) closeSelectedStop(false)')
    expect(tripMap).toContain("map.on('click', onClick)")
    expect(tripMap).not.toMatch(/map\.on\('mousedown'/)
  })

  it('returns focus to the stop that opened the card', () => {
    expect(tab).toContain('stopOpener.current = document.activeElement')
    expect(tab).toContain('target?.focus({ preventScroll: true })')
  })
})
