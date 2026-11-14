import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CORRIDOR_PAINT,
  STAY_RING_FRAME_PADDING,
  STOP_TAG_BOX,
  showsStopTag,
  stopTagBox,
} from '../src/lib/mapStyles/lensMarks'

const marksCss = readFileSync(new URL('../src/components/map/mapMarks.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const stylesCss = readFileSync(new URL('../src/styles/components/map-v2-rail.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const map = readFileSync(new URL('../src/components/TripMap.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('showsStopTag', () => {
  it('shows the base tag on every day and other stops on the active day only', () => {
    expect(showsStopTag({ category: 'hotel', dayIndex: 2 }, null)).toBe(true)
    expect(showsStopTag({ category: 'hotel', dayIndex: 2 }, 5)).toBe(true)
    expect(showsStopTag({ category: 'nature', dayIndex: 2 }, 2)).toBe(true)
    expect(showsStopTag({ category: 'nature', dayIndex: 2 }, 3)).toBe(false)
    expect(showsStopTag({ category: 'nature', dayIndex: 2 }, null)).toBe(false)
  })

  it('never tags an auto anchor', () => {
    expect(showsStopTag({ category: 'hotel', dayIndex: 0, auto: true }, 0)).toBe(false)
  })
})

describe('stopTagBox', () => {
  it('grows with the name and stops at 184 px', () => {
    const short = stopTagBox('Goa')
    const long = stopTagBox('A very long stop name that would run off the map edge')
    expect(short.w).toBeGreaterThanOrEqual(56)
    expect(long.w).toBeGreaterThan(short.w)
    expect(long.w).toBeLessThanOrEqual(184)
    expect(long.h).toBe(STOP_TAG_BOX.h)
  })

  it('keeps the board height and a drop under the mark', () => {
    expect(STOP_TAG_BOX.h).toBe(26)
    expect(STOP_TAG_BOX.dy).toBeGreaterThan(STOP_TAG_BOX.h - 10)
  })
})

describe('the corridor wash', () => {
  it('is a wide, faint day-colour band with a dashed edge', () => {
    expect(CORRIDOR_PAINT.opacity).toBeCloseTo(0.15)
    expect(CORRIDOR_PAINT.width.at(-1)).toBe(46)
    expect(CORRIDOR_PAINT.edgeWidth).toBe(1)
    expect(CORRIDOR_PAINT.edgeOpacity).toEqual(['step', ['zoom'], 0, 9, 0.5])
  })

  it('draws over the casing and under the route line', () => {
    const corridor = map.indexOf('yf-day-corridor-')
    const casing = map.indexOf('yf-day-casing-')
    const line = map.indexOf('color={rough ? warnInk : colorForDay(d.index)}')
    expect(corridor).toBeGreaterThan(casing)
    expect(corridor).toBeLessThan(line)
  })
})

describe('the stay ring fit', () => {
  it('leaves room for the 30 min drive ring and its label', () => {
    expect(STAY_RING_FRAME_PADDING).toBeGreaterThanOrEqual(80)
  })

  it('frames a scale-free ring with the overlay insets', () => {
    expect(map).toMatch(/stayFrameBounds\(first\.ring, STAY_RING_CANVAS_FRACTION\)/)
    expect(map).toMatch(/padding: cameraPadding\(\), maxZoom: 15/)
    expect(map).not.toMatch(/padding: STAY_RING_FRAME_PADDING/)
  })
})

describe('the marks CSS', () => {
  it('gives the pick tile the board radius, the family edge and the white ring', () => {
    const rule = stylesCss.match(/\.mv2-workspace \.yf-map-pin-idea \{[^}]*\}/)?.[0] ?? ''
    expect(rule).toContain('border-radius: var(--radius-xs)')
    expect(rule).toContain('border: 1px solid var(--mark-edge')
    expect(rule).toContain('background: var(--mark-tint')
    expect(rule).toContain('0 0 0 2px var(--card)')
  })

  it('gives the selected pick the board size and the teal ring', () => {
    const rule = stylesCss.match(/\.mv2-workspace \.yf-map-pin-idea--active[^{]*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toContain('width: 40px')
    expect(rule).toContain('0 0 0 6px var(--pw-lagoon-600)')
  })

  it('declares the stop tag once, as a pill on the card ground', () => {
    const rules = marksCss.match(/^\.mv2-stop-tag \{[^}]*\}/gm) ?? []
    expect(rules).toHaveLength(1)
    expect(rules[0]).toContain('border-radius: var(--radius-pill)')
    // The board's tag is the card at 86% over a blur, edged in white, so the tag
    // still reads on the road wash under it.
    expect(rules[0]).toContain('background: color-mix(in srgb, var(--pw-card) 86%, transparent)')
    expect(rules[0]).toContain('backdrop-filter: blur(var(--yf-blur-chip))')
  })

  it('sits a stop tag beside its pin, as the board does', () => {
    expect(marksCss).toMatch(/\.mv2-pin-anchor > \.mv2-stop-tag \{[^}]*right: calc\(100% \+ 4px\)/)
  })

  it('shows a family tint for every family', () => {
    for (const family of ['water', 'nature', 'views', 'faith', 'heritage', 'culture', 'needs']) {
      expect(marksCss).toContain(`.yf-map-pin-idea[data-family='${family}']`)
    }
  })

  it('draws the pin beak under the tile', () => {
    expect(marksCss).toMatch(/\.mv2-workspace \.yf-map-pin-idea::after \{[^}]*rotate: 45deg/)
  })

  it('passes the family to the pin instead of a flat category colour', () => {
    expect(map).toMatch(/data-family=\{workspaceChrome && !isSearchHit \? placeSubtype/)
  })
})
