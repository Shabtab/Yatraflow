// The expanded Map is a fixed layer at --z-map-expanded, above the nav. The
// Map V2 canvas (.map-ideas-grid) isolates its stack, which trapped that layer
// at the canvas level: the trip header bar and the tab pill painted over the
// expanded map. The map controls also kept the space of the hidden deck.
import { describe, expect, it } from 'vitest'
import { readCssSource } from '../scripts/css-source-graph.mjs'

const css = readCssSource('src/styles.css').replace(/\r\n/g, '\n')

describe('the expanded Map sits above the trip header', () => {
  it('keeps the canvas isolation that the rails rely on', () => {
    expect(css).toMatch(/\.mv2-workspace \.map-ideas-grid \{[^}]*isolation: isolate;/)
  })

  it('lifts the isolated canvas to the expanded-map rung while the map is expanded', () => {
    expect(css).toContain('.mv2-workspace .map-ideas-grid:has(.map-shell--expanded) { z-index: var(--z-map-expanded); }')
  })

  it('gives the map controls the full width, with no space kept for the rail or the deck', () => {
    expect(css).toContain('.mv2-workspace .map-shell--expanded { --mv2-day-width: 0px; --mv2-deck-width: 0px; --mv2-deck-gutter: 0px; }')
  })
})
