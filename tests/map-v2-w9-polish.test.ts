// W9-polish: leg times, the fold tab, the edit card, the choice menu, the
// scope counts and the place card actions. Node has no DOM, so component
// checks read the markup string.
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MapItinerary } from '../src/components/map/MapWorkspaceChrome'
import { ChoiceMenu, StopEditorCard, editClockSpan, isChoiceSelected } from '../src/pages/trip/map/editing/EditCards'
import { MapScopeBand, scopeBandCountsSpoken } from '../src/pages/trip/map/MapScopeBand'
import { LensPlaceCard, placeCardActions } from '../src/components/map/lenses/LensPlaceCard'
import { fmtDur } from '../src/lib/engine'
import type { Trip } from '../src/data/types'
import type { Journey } from '../src/lib/engine'

const noop = () => undefined
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const css = read('../src/styles/components/map-v2-rail.css')
const tokens = read('../src/styles/tokens.css')

/** One CSS rule body. The selector must be unique in the file. */
function rule(text: string, selector: string): string {
  const start = text.indexOf(`${selector} {`)
  if (start < 0) return ''
  return text.slice(start, text.indexOf('}', start))
}

/** One pixel value of a token in tokens.css. */
function pxToken(name: string): number {
  return Number(new RegExp(`--${name}: (\\d+)px`).exec(tokens)?.[1] ?? NaN)
}

const trip = {
  id: 'w9-trip',
  name: 'W9 trip',
  startDate: '2027-11-14',
  fixedCommitments: [],
  days: [{ id: 'w9-day', index: 0, title: 'Day one', startTime: '10:00', stops: [] }],
} as unknown as Trip

const journey = {
  dayIndex: 0,
  startTime: '10:00',
  startTitle: 'Munnar',
  endTitle: 'Kattappana',
  distanceKm: 16,
  driveMinutes: 143,
  points: [{
    stop: { id: 'boat', title: 'Periyar boat', category: 'nature' },
    title: 'Periyar boat',
    arrive: '17:00',
    depart: '17:30',
    dwellMinutes: 30,
    kind: 'stop',
  }, {
    stop: { id: 'falls', title: 'Attukad falls', category: 'nature' },
    title: 'Attukad falls',
    arrive: '17:53',
    depart: '18:10',
    dwellMinutes: 17,
    kind: 'stop',
    legIn: { distanceKm: 16, durationMinutes: 23 },
  }],
} as unknown as Journey

function rail(): string {
  return renderToStaticMarkup(createElement(MapItinerary, {
    trip,
    journey,
    activeDay: 0,
    budgetMin: 45,
    selectedStop: null,
    allDays: false,
    onShowAll: noop,
    onDayChange: noop,
    onSelect: noop,
    onFold: noop,
  }))
}

function editor(over: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(StopEditorCard, {
    title: 'Lunch · Nalla Ruchi Kitchen',
    clockLabel: '12:05',
    placeLabel: 'Kattappana',
    order: 2,
    dayIndex: 2,
    visitMinutes: 45,
    days: [{ index: 1, label: 'Day 2' }, { index: 2, label: 'Day 3' }],
    swapOptions: [{ id: 's2', label: '1 · Attukad waterfalls' }],
    fixed: false,
    onStep: noop,
    onMoveToDay: noop,
    onSwap: noop,
    onRemove: noop,
    onClose: noop,
    ...over,
  }))
}

describe('leg times use fmtDur', () => {
  it('prints the day drive line and the rail leg with fmtDur', () => {
    const html = rail()
    expect(fmtDur(143)).toBe('2h 23m')
    expect(fmtDur(16)).toBe('16 min')
    expect(html).toContain('16 km · 2h 23m drive')
    expect(html).toContain('16 km · 23 min')
  })
  it('never prints the old minutesToHM zero-hour form', () => {
    expect(rail()).not.toContain('0h 16m')
  })
})

describe('the fold tab clears the arrow and the omnibar', () => {
  const fold = rule(css, '.mv2-fold-day')
  const header = rule(css, '.mv2-day-header')
  const arrows = rule(css, '.mv2-day-arrows')
  const workspace = rule(css, '.mv2-workspace')
  const omnibar = rule(css, '.mv2-workspace .mv2-omnibar')

  it('sits inside the rail, level with the sub line, below the day arrows', () => {
    // The tab hangs from the header bottom, so it cannot reach the arrow row
    // (the header pads space-7 above a 32px arrow) and never leaves the rail.
    expect(fold).toMatch(/bottom: var\(--space-\d+\)/)
    expect(fold).not.toMatch(/\btop:/)
    const right = /right: var\(--space-(\d+)\)/.exec(fold)
    expect(right).not.toBeNull()
    expect(Number(right?.[1])).toBeGreaterThanOrEqual(5)
    expect(/--mv2-day-arrow: (\d+)px/.exec(arrows)?.[1]).toBeDefined()
  })
  it('stays inside the rail, so it never meets the omnibar', () => {
    const inset = /--mv2-inset: var\(--space-5\)/.test(workspace) ? pxToken('space-5') : NaN
    const offset = /left: calc\(var\(--mv2-day-width\) \+ var\(--space-10\)\)/.test(omnibar) ? pxToken('space-10') : NaN
    // A non-negative right offset keeps the tab inside the rail edge.
    const right = /right: (-\d)/.test(fold) ? -1 : 0
    expect(right).toBe(0)
    expect(offset - inset).toBeGreaterThanOrEqual(8)
  })
  it('keeps a 44px hit area through ::before', () => {
    const hit = rule(css, '.mv2-itinerary .mv2-fold-day::before')
    const width = Number(/width: (\d+)px/.exec(fold)?.[1] ?? NaN)
    const inset = Number(/inset: (-?\d+)px/.exec(hit)?.[1] ?? NaN)
    expect(width + Math.abs(inset) * 2).toBeGreaterThanOrEqual(44)
  })
})

describe('edit card sub line', () => {
  it('adds the dwell to the arrival for a single clock label', () => {
    expect(editClockSpan('12:05', 45)).toBe('12:05–12:50')
    expect(editClockSpan('12:05 PM', 45)).toBe('12:05 PM–12:50 PM')
    expect(editClockSpan('11:40 PM', 30)).toBe('11:40 PM–12:10 AM')
  })
  it('keeps a real span and an unknown clock as they are', () => {
    expect(editClockSpan('12:05–12:50', 45)).toBe('12:05–12:50')
    expect(editClockSpan('Time not planned yet', 45)).toBe('Time not planned yet')
    expect(editClockSpan(null, 45)).toBeNull()
    expect(editClockSpan('12:05', null)).toBe('12:05')
  })
  it('shows the arrival to departure span with the place and drops the hint', () => {
    const html = editor()
    expect(html).toContain('12:05–12:50 · Kattappana')
    expect(html).not.toContain('map-edit-hint')
    expect(html).toContain('aria-label="Reorder this stop with Alt and the up or down arrow"')
  })
  it('shows the place only when it differs from the title', () => {
    expect(editor({ title: 'Kattappana' })).toContain('<span class="map-edit-clock">12:05–12:50</span>')
    expect(editor({ placeLabel: null })).not.toContain(' · Kattappana')
  })
})

describe('ChoiceMenu selection', () => {
  const menu = (value: string | null) => renderToStaticMarkup(createElement(ChoiceMenu, {
    label: 'Move to day',
    icon: null,
    choices: [{ id: '1', label: 'Day 2' }, { id: '2', label: 'Day 3' }],
    value,
    onChoose: noop,
    defaultOpen: true,
  }))

  it('marks only the current value as selected', () => {
    const options = menu('2').match(/<li[^>]*role="option"[^>]*>/g) ?? []
    expect(options).toHaveLength(2)
    expect(options[0]).toContain('aria-selected="false"')
    expect(options[1]).toContain('aria-selected="true"')
  })
  it('leaves every option unselected when there is no current value', () => {
    const options = menu(null).match(/<li[^>]*role="option"[^>]*>/g) ?? []
    expect(options.every(option => option.includes('aria-selected="false"'))).toBe(true)
  })
  it('names the highlighted option with aria-activedescendant only', () => {
    const html = menu('2')
    expect(html).toMatch(/aria-activedescendant="[^"]+-opt-1"/)
    expect(isChoiceSelected('2', '2')).toBe(true)
    expect(isChoiceSelected('2', '1')).toBe(false)
    expect(isChoiceSelected(null, '2')).toBe(false)
  })
})

describe('scope counts text', () => {
  it('joins the spoken parts with commas', () => {
    expect(scopeBandCountsSpoken({ inside: 3, justPast: 2, worthDetour: 1 }))
      .toBe('3 Inside, 2 Just past it, 1 Worth the detour')
    expect(scopeBandCountsSpoken(null)).toBeNull()
  })
  it('gives the container that aria-label and keeps the visual text bare', () => {
    const html = renderToStaticMarkup(createElement(MapScopeBand, {
      minutes: 30,
      onMinutes: noop,
      counts: { inside: 3, justPast: 2, worthDetour: 1 },
    }))
    expect(html).toContain('aria-label="3 picks fit scope and budget"')
    const counts = /class="mv2-lens-scope-count"[^>]*>(.*?)<\/span>/.exec(html)?.[1] ?? ''
    expect(counts).toBe('Fits: 3')
    expect(counts).not.toContain('·')
    expect(counts).not.toContain(',')
  })
})

describe('place card heart and swap', () => {
  const card = (over: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(LensPlaceCard, {
    name: 'Periyar boat',
    cells: [{ key: 'arrive', label: 'Arrive', value: '12:30' }],
    addLabel: 'Add to Day 2',
    onAdd: noop,
    ...over,
  }))

  it('calls the Keep action through the heart', () => {
    const keep = vi.fn()
    const actions = placeCardActions({ onShortlist: keep })
    expect(actions.shortlist).not.toBeNull()
    actions.shortlist?.()
    expect(keep).toHaveBeenCalledTimes(1)
    expect(actions.swap).toBeNull()
  })
  it('renders the heart only with a handler, and no swap without one', () => {
    expect(card()).not.toContain('Add to shortlist')
    expect(card()).not.toContain('Swap this stop')
    expect(card({ selected: true, onShortlist: noop })).toContain('aria-label="Add to shortlist"')
    expect(card({ selected: true, onShortlist: noop, shortlisted: true })).toContain('aria-pressed="true"')
    expect(card({ selected: true, onSwap: noop })).toContain('aria-label="Swap this stop"')
  })
  it('lets the Add pill fill the row', () => {
    const add = rule(css, '.mv2-lens-place-add')
    expect(add).toContain('flex: 1 1 auto')
  })
})
