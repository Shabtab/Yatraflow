// ============ Map v2: the stop card's ways out ============
// The card used to open with no way to close it. It now closes from its own
// button, from Escape, and from a click on bare map. A node test cannot fire a
// DOM event, so the Escape rule is a pure function here and the wiring is read
// off the real sources.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { escapeClosesCard, escapeClosesCardWithin } from '../src/pages/trip/map/editing/cardClose'

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

// A node test cannot fire a DOM event, so the within-card decision is a pure
// function here. The event reader that feeds it is pinned off the sources.
const withinBase = { key: 'Escape', defaultPrevented: false, inTextField: false, inOtherDialog: false }

describe('escapeClosesCardWithin', () => {
  it('closes when the only dialog match is the card itself', () => {
    expect(escapeClosesCardWithin({ ...withinBase, inOtherDialog: true, inOwnDialog: true })).toBe(true)
  })

  it('keeps the key for a dialog that is not the card', () => {
    expect(escapeClosesCardWithin({ ...withinBase, inOtherDialog: true })).toBe(false)
    expect(escapeClosesCardWithin({ ...withinBase, inOtherDialog: true, inOwnDialog: false })).toBe(false)
  })

  it('closes on a plain Escape with no dialog around', () => {
    expect(escapeClosesCardWithin({ ...withinBase })).toBe(true)
  })

  it('still yields to a text field, another key and a taken key', () => {
    expect(escapeClosesCardWithin({ ...withinBase, inTextField: true, inOwnDialog: true })).toBe(false)
    expect(escapeClosesCardWithin({ ...withinBase, key: 'Enter', inOwnDialog: true })).toBe(false)
    expect(escapeClosesCardWithin({ ...withinBase, defaultPrevented: true, inOwnDialog: true })).toBe(false)
  })
})

describe('the stop-card close controls meet the 44 px floor', () => {
  it('grows the bottom bar X past the shared 40 px icon box', () => {
    const close = tripMap.slice(tripMap.indexOf('yf-stop-jump'))
    expect(close).toContain("className=\"icon-btn\"")
    expect(close).toMatch(/aria-label="Close" style=\{\{[^}]*minWidth: 44, minHeight: 44/)
  })

  it('carries the floor on the editor card X rule', () => {
    const rule = css.split('\n').find(line => line.startsWith('.map-edit-close {'))
    expect(rule).toContain('min-width: 44px')
    expect(rule).toContain('min-height: 44px')
  })
})

describe('the bottom stop bar closes on Escape too', () => {
  it('binds the shared decision while the bar is on screen', () => {
    expect(tripMap).toContain('cardCloseFromEventWithin')
    expect(tripMap).toContain('if (!stopJumpOpen) return')
    expect(tripMap).toContain("document.addEventListener('keydown', onKey)")
  })

  it('names the bar as its own card root and clears the same selection the buttons clear', () => {
    expect(tripMap).toContain('ref={stopJumpRef}')
    expect(tripMap).toMatch(/cardCloseFromEventWithin\(event, stopJumpRef\.current\)\) return\n\s*setSelectedStop\(null\)/)
  })

  it('returns focus to the pin that opened the bar', () => {
    expect(tripMap).toContain('stopJumpOpener.current = event.currentTarget')
    expect(tripMap).toContain('opener.focus({ preventScroll: true })')
  })
})
