// W8 Package rail: the rail top and the Stay rail follow the boards.
// The node env has no DOM, so a component check reads the markup string.
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MapItinerary } from '../src/components/map/MapWorkspaceChrome'
import { LensRailExtras, budgetValueParts, windowDurationText } from '../src/pages/trip/map/LensRailExtras'
import { DAY_COLORS, dayColor } from '../src/lib/mapStyles/dayColors'
import type { Trip } from '../src/data/types'
import type { Journey } from '../src/lib/engine'

const noop = () => undefined
const clock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const trip = {
  id: 'w8-rail-trip',
  name: 'W8 rail trip',
  startDate: '2027-11-16',
  fixedCommitments: [],
  days: [
    { id: 'w8-a', index: 0, title: 'Day one', startTime: '10:00', stops: [] },
    { id: 'w8-b', index: 1, title: 'Day two', startTime: '10:00', stops: [] },
    { id: 'w8-c', index: 2, title: 'Day three', startTime: '10:00', stops: [] },
  ],
} as unknown as Trip

const journey = {
  dayIndex: 2,
  startTime: '10:00',
  startTitle: 'Munnar',
  endTitle: 'Thekkady',
  distanceKm: 83,
  driveMinutes: 145,
  points: [{
    stop: { id: 'falls', title: 'Attukad falls', category: 'nature' },
    title: 'Attukad falls',
    arrive: '10:16',
    dwellMinutes: 45,
    kind: 'stop',
  }],
} as unknown as Journey

function rail(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(MapItinerary, {
    trip,
    journey,
    activeDay: 2,
    budgetMin: 45,
    selectedStop: null,
    allDays: false,
    onShowAll: noop,
    onDayChange: noop,
    onSelect: noop,
    onFold: noop,
    ...props,
  }))
}

describe('W8 rail top and stay rail', () => {
  it('proves the runner runs', () => { expect(1).toBe(1) })

  it('reads the header dot from the one shared day palette', () => {
    const chrome = read('../src/components/map/MapWorkspaceChrome.tsx')
    expect(chrome).toContain("from '../../lib/mapStyles/dayColors'")
    expect(chrome).toContain('dayColor(activeDay)')
    expect(read('../src/pages/trip/map/LensRailExtras.tsx')).not.toMatch(/#0D8D82/i)
  })

  it('wraps the day colour in both directions', () => {
    expect(dayColor(0)).toBe(DAY_COLORS[0])
    expect(dayColor(2)).toBe('#7D5EFC')
    expect(dayColor(9)).toBe('#7D5EFC')
    expect(dayColor(-1)).toBe(DAY_COLORS[6])
  })

  it('splits the budget number from the rest of the line', () => {
    expect(budgetValueParts('12 of 45 min · 2 free stops')).toEqual({ lead: '12', rest: ' of 45 min · 2 free stops' })
    expect(budgetValueParts('11 of 35 min · 2 free stops')).toEqual({ lead: '11', rest: ' of 35 min · 2 free stops' })
    expect(budgetValueParts('35 min')).toEqual({ lead: null, rest: '35 min' })
    expect(budgetValueParts('')).toEqual({ lead: null, rest: '' })
  })

  it('draws the day dot in the active day colour before the label', () => {
    const html = rail()
    expect(html).toContain('<i class="mv2-day-dot" style="--mv2-day-tone:#7D5EFC" aria-hidden="true"></i>')
    expect(html).toContain('class="mv2-day-mark"')
    expect(html.indexOf('mv2-day-dot')).toBeLessThan(html.indexOf('Day 3'))
  })

  it('puts the fold control on the edge tab, outside the header rows', () => {
    const html = rail()
    const fold = html.indexOf('class="mv2-fold-day"')
    const budget = html.indexOf('class="mv2-budget mv2-lens-budget"')
    expect(fold).toBeGreaterThan(html.indexOf('</p>'))
    expect(budget).toBeGreaterThan(fold)
    expect(html).toContain('aria-label="Fold day itinerary"')
    expect(html).not.toContain('mv2-day-tools')
    expect(html).not.toContain('mv2-fold-day mv2-icon-btn')
  })

  it('nests the eyebrow and the title in one header line', () => {
    const html = rail()
    const head = html.indexOf('class="mv2-day-head"')
    expect(head).toBeGreaterThan(html.indexOf('mv2-day-arrows'))
    expect(html.indexOf('class="mv2-day-mark"')).toBeGreaterThan(head)
    expect(html.indexOf('<h2 ')).toBeGreaterThan(head)
    expect(html.indexOf('<h2 ')).toBeLessThan(html.indexOf('aria-label="Next day"'))
  })

  it('names the day line a drive, as the board does', () => {
    const html = rail()
    expect(html).toContain('83 km · 2h 25m drive · Planned')
    expect(html).not.toContain(' travel · ')
  })

  it('keeps the budget label, the bold number and the bar in one card', () => {
    const html = rail({ budgetBar: { text: '12 of 45 min · 2 free stops', step: 1 } })
    expect(html).toContain('class="mv2-lens-budget-label sr-only">Detour budget</span>')
    expect(html).toContain('<b class="mv2-lens-budget-number">12</b> of 45 min · 2 free stops')
    expect(html).toContain('role="progressbar"')
    expect(html.indexOf('mv2-lens-budget-label')).toBeLessThan(html.indexOf('mv2-lens-budget-value'))
    expect(html.indexOf('mv2-lens-budget-value')).toBeLessThan(html.indexOf('mv2-budget-progress'))
  })

  it('draws no bar and no number on a lens with the budget alone', () => {
    const html = rail()
    expect(html).toContain('>45 min</strong>')
    expect(html).not.toContain('role="progressbar"')
    expect(html).not.toContain('mv2-lens-budget-number')
  })

  it('writes the window length from the two known clocks', () => {
    expect(windowDurationText(1020, 1200)).toBe('3 h')
    expect(windowDurationText(1020, 1125)).toBe('1 h 45')
    expect(windowDurationText(834, 1260)).toBe('7 h 06')
    expect(windowDurationText(600, 630)).toBe('30 min')
    expect(windowDurationText(600, 600)).toBeNull()
    expect(windowDurationText(700, 600)).toBeNull()
    expect(windowDurationText(Number.NaN, 900)).toBeNull()
    const html = rail({ windowRow: { label: 'Free evening', startMin: 1020, endMin: 1200 }, clock })
    expect(html).toContain('17:00–20:00 · 3 h')
    expect(html).not.toContain('picks nearby')
  })

  it('keeps the window time in a fixed, unbroken column', () => {
    const html = rail({ windowRow: { label: 'Free evening', startMin: 1020, endMin: 1200 }, clock })
    expect(html).toContain('class="mv2-lens-window-time">17:00</time>')
    const css = read('../src/styles/components/map-v2-rail.css')
    expect(css).toContain('.mv2-lens-window-time {\n  white-space: nowrap; text-align: right;')
    expect(css).toContain('font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text);')
  })

  it('renders the stay rail card with its title, both rings and the note', () => {
    const html = renderToStaticMarkup(createElement(LensRailExtras, { lens: 'stay', ringId: 'walk-15', onRing: noop }))
    expect(html).toContain('How far from the base')
    expect(html).toContain('aria-label="Reach from the base"')
    expect(html.match(/mv2-lens-rail-ring-btn/g)).toHaveLength(2)
    expect(html).toContain('Range · Walk or 30 min drive')
  })

  it('renders no rail card outside the stay lens', () => {
    expect(renderToStaticMarkup(createElement(LensRailExtras, { lens: 'drive', ringId: 'walk-15', onRing: noop }))).toBe('')
  })

  it('guards the CSS: the boards card, track and window row values', () => {
    const css = read('../src/styles/components/map-v2-rail.css')
    expect(css).toContain('.mv2-budget.mv2-lens-budget {\n  display: grid; grid-template-columns: minmax(0, 1fr) auto;')
    expect(css).toContain('padding: 10px var(--space-5); border-radius: 14px;')
    expect(css).toContain('--mv2-rail-sunken: #F4F1EA;')
    expect(css).toContain('.mv2-budget-progress {\n  height: 6px;')
    expect(css).toContain('.mv2-budget .mv2-lens-budget-value { font-size: 12px;')
    expect(css).toContain('.mv2-budget .mv2-budget-progress-fill { margin-top: 0; }')
    expect(css).toContain('.mv2-lens-budget-number { font-weight: 700;')
    expect(css).toContain('.mv2-window-row.is-active-window {\n  background: var(--pw-marigold-50);\n  box-shadow: inset 0 0 0 1.5px var(--pw-marigold-500);')
    expect(css).toContain('.mv2-day-dot {\n  flex: 0 0 auto; width: 9px; height: 9px;')
    expect(css).toContain('.mv2-day-mark { display: flex; align-items: center; gap: var(--space-3);')
    expect(css).toContain('.mv2-day-arrows { --mv2-day-arrow: 32px; display: flex;')
    expect(css).toContain('.mv2-day-arrows .mv2-icon-btn { position: relative; width: var(--mv2-day-arrow); height: var(--mv2-day-arrow); }')
    expect(css).toContain('.mv2-day-arrows .mv2-icon-btn::before { content: ""; position: absolute; inset: -6px;')
    expect(css).toContain('.mv2-fold-day {\n  position: absolute; bottom: var(--space-3); right: var(--space-7); z-index: 2;')
    expect(css).toContain('.mv2-itinerary .mv2-fold-day::before { content: ""; position: absolute; inset: -8px;')
    expect(css).toContain('.mv2-day-header { position: relative; padding: var(--mv2-panel-pad) var(--mv2-panel-pad) calc(var(--space-5) + 1px); }')
    expect(css).toContain('margin: 0; font: var(--pw-title); font-size: 17px; line-height: 21px;')
    expect(css).toContain('.mv2-lens-window-time {\n  white-space: nowrap; text-align: right;')
    expect(css).toContain('.mv2-window-row .mv2-stop-copy strong { display: block; color: var(--pw-marigold-ink);')
    expect(css).not.toContain('bottom: -30px')
    expect(css).toContain('.mv2-itinerary .mv2-lens-rail-card {\n  position: static;')
    expect(css).toContain('background: var(--mv2-rail-sunken);\n  box-shadow: none;')
  })
})
