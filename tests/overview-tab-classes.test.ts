import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { DayWeather } from '../src/lib/weather'
import {
  filterOverviewWeather,
  mergeOverviewWeather,
  overviewSliceView,
  overviewWeatherKey,
} from '../src/pages/trip/OverviewTab'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const tab = read('../src/pages/trip/OverviewTab.tsx')
const css = read('../src/styles.css')
const count = (source: string, needle: string) => source.split(needle).length - 1
const PRIOR_SECTION = '/* ===== P10: Creator hub — panel titles and moved margins ===== */'
const SECTION = '/* ===== P12: Overview panels and titles ===== */'

const RULES = [
  { selector: '.yf-surface.ovw-panel', declarations: 'border-radius: var(--radius); box-shadow: var(--shadow-card);' },
  { selector: '.yf-surface.ovw-panel:not(.ovw-strip)', declarations: 'padding: var(--space-8);' },
  { selector: '.yf-surface.ovw-panel.ovw-strip', declarations: 'padding: 14px 18px;' },
  { selector: '.ovw-card-title', declarations: 'font-family: var(--font-body); font-size: 18px; font-weight: 800; line-height: 1.3; color: var(--text); margin: 0;' },
  { selector: '.card-head.ovw-card-title', declarations: 'margin-bottom: 14px;' },
  { selector: '.ovw-route-snap svg > text', declarations: 'fill: var(--text);' },
]

const weather = (date: string, tempMaxC: number): DayWeather => ({
  date,
  code: 1,
  tempMaxC,
  tempMinC: tempMaxC - 8,
  rainChancePct: 10,
})

const fulfilled = (forecast?: DayWeather): PromiseFulfilledResult<Record<string, DayWeather>> => ({
  status: 'fulfilled',
  value: forecast ? { [forecast.date]: forecast } : {},
})

const rejected = (): PromiseRejectedResult => ({ status: 'rejected', reason: new Error('read failed') })

describe('Overview panel classes', () => {
  it('uses Surface with a token-staggered entrance on every panel root', () => {
    expect(count(tab, '<Surface className="card')).toBe(10)
    expect(count(tab, 'enterIndex={')).toBe(10)
    expect(count(tab, '<div className="card')).toBe(0)
    expect(css).toContain('.yf-surface.is-entering { animation: cardIn var(--motion-slow) var(--ease-out) backwards; }')
    expect(css).toContain('.yf-surface.is-entering { animation: none; }')
    expect(css).toContain('@media (prefers-reduced-motion: reduce) {')
  })

  it('gives each Overview panel heading the R20 title class', () => {
    const titles = tab.match(/<h[23]\b[^>]*className="[^"]*\bovw-card-title\b[^"]*"[^>]*>/g) ?? []
    expect(titles).toHaveLength(11)
    expect(tab).toContain('<h3 className="ovw-card-title">Group pulse</h3>')
    expect(tab).toContain('<Surface className="card ovw-panel ovw-route-snap" enterIndex={2}>')
    expect(tab).toContain('<Surface className="card pulse-bar ovw-panel ovw-strip" enterIndex={7}>')
    expect(tab).not.toContain('className="card route-snap')
  })

  it('uses compact empty states and keeps the zero-decision label', () => {
    expect(count(tab, 'kind="empty"')).toBe(5)
    expect(tab).toContain('title="0 open decisions"')
    expect(tab).toContain('title="Nothing needs fixing right now" body="— the plan flows."')
    expect(tab).toContain('title="None saved yet." body="Add check-ins, trains or flights so the planner can protect them."')
    expect(tab).toContain('title="No route to draw yet"')
  })

  it('keeps only the dynamic health width inline', () => {
    expect(count(tab, 'style={')).toBe(1)
    expect(count(tab, 'style={{ width: `${health.score}%` }}')).toBe(1)
  })

  it('keeps the Overview rules in one named section', () => {
    expect(count(css, SECTION)).toBe(1)
    expect(count(css, PRIOR_SECTION)).toBe(1)
    const sectionStart = css.indexOf(SECTION)
    expect(css.indexOf(PRIOR_SECTION)).toBeLessThan(sectionStart)
    const nextSection = css.indexOf('\n/*', sectionStart + SECTION.length)
    const section = css.slice(sectionStart, nextSection < 0 ? undefined : nextSection)
    const matches = [...section.matchAll(/(?:^|\n)([^\n{}]+) \{([^}]*)\}/g)].filter(hit => /\.ovw-/.test(hit[1]))
    expect(matches.map(hit => hit[1].trim()).sort()).toEqual(RULES.map(rule => rule.selector).sort())
    for (const rule of RULES) {
      const hits = matches.filter(hit => hit[1].trim() === rule.selector)
      expect(hits).toHaveLength(1)
      expect(hits[0][2].replace(/\s+/g, ' ').trim()).toBe(rule.declarations)
    }
  })
})

describe('Overview read states', () => {
  it('keeps activity and decision reads separate from loading, failed and empty states', () => {
    expect(overviewSliceView({}, 'activity', 0)).toBe('reading')
    expect(overviewSliceView({ activity: 'failed' }, 'activity', 0)).toBe('failed')
    expect(overviewSliceView({ activity: 'failed' }, 'activity', 2)).toBe('kept')
    expect(overviewSliceView({ decisions: 'ok' }, 'decisions', 0)).toBe('empty')
    expect(overviewSliceView({ decisions: 'ok' }, 'decisions', 2)).toBe('rows')
  })
})

describe('Overview weather anchors', () => {
  it('uses the date and coordinates as the cache key', () => {
    const first = { date: '2026-10-20', lat: 28.6, lng: 77.2 }
    const moved = { ...first, lat: 19.1, lng: 72.9 }
    expect(overviewWeatherKey(first)).not.toBe(overviewWeatherKey(moved))
  })

  it('filters visible weather when a same-date anchor moves', () => {
    const oldAnchor = { date: '2026-10-20', lat: 28.6, lng: 77.2 }
    const newAnchor = { date: oldAnchor.date, lat: 19.1, lng: 72.9 }
    const cached = { [overviewWeatherKey(oldAnchor)]: weather(oldAnchor.date, 30) }
    expect(filterOverviewWeather(cached, [newAnchor])).toEqual({})
  })

  it('filters visible weather when the date changes at the same coordinates', () => {
    const oldAnchor = { date: '2026-10-20', lat: 28.6, lng: 77.2 }
    const newAnchor = { date: '2026-10-21', lat: oldAnchor.lat, lng: oldAnchor.lng }
    const cached = { [overviewWeatherKey(oldAnchor)]: weather(oldAnchor.date, 30) }
    expect(filterOverviewWeather(cached, [newAnchor])).toEqual({})
  })

  it('keeps a failed day only at its matching anchor and keeps successful days', () => {
    const keptAnchor = { date: '2026-10-20', lat: 28.6, lng: 77.2 }
    const freshAnchor = { date: '2026-10-21', lat: 19.1, lng: 72.9 }
    const keptForecast = weather(keptAnchor.date, 30)
    const freshForecast = weather(freshAnchor.date, 31)
    const result = mergeOverviewWeather(
      [keptAnchor, freshAnchor],
      [rejected(), fulfilled(freshForecast)],
      { [overviewWeatherKey(keptAnchor)]: keptForecast },
    )

    expect(result.byDate).toEqual({
      [overviewWeatherKey(keptAnchor)]: keptForecast,
      [overviewWeatherKey(freshAnchor)]: freshForecast,
    })
    expect(result.failedKeys).toEqual([overviewWeatherKey(keptAnchor)])
    expect(result.retainedKeys).toEqual([overviewWeatherKey(keptAnchor)])
  })

  it('keeps a successful day during an initial partial read without claiming a cached row', () => {
    const available = { date: '2026-10-20', lat: 28.6, lng: 77.2 }
    const missing = { date: '2026-10-21', lat: 19.1, lng: 72.9 }
    const forecast = weather(available.date, 30)
    const result = mergeOverviewWeather(
      [available, missing],
      [fulfilled(forecast), rejected()],
      {},
    )

    expect(result.byDate).toEqual({ [overviewWeatherKey(available)]: forecast })
    expect(result.failedKeys).toEqual([overviewWeatherKey(missing)])
    expect(result.retainedKeys).toEqual([])
  })

  it('reports an initial all-failed read without inventing forecast rows', () => {
    const anchor = { date: '2026-10-20', lat: 28.6, lng: 77.2 }
    const result = mergeOverviewWeather([anchor], [rejected()], {})

    expect(result.byDate).toEqual({})
    expect(result.failedKeys).toEqual([overviewWeatherKey(anchor)])
    expect(result.retainedKeys).toEqual([])
  })

  it('does not keep a failed forecast from a different location on the same date', () => {
    const oldAnchor = { date: '2026-10-20', lat: 28.6, lng: 77.2 }
    const currentAnchor = { date: oldAnchor.date, lat: 19.1, lng: 72.9 }
    const result = mergeOverviewWeather(
      [currentAnchor],
      [rejected()],
      { [overviewWeatherKey(oldAnchor)]: weather(oldAnchor.date, 30) },
    )

    expect(result.byDate).toEqual({})
    expect(result.failedKeys).toEqual([overviewWeatherKey(currentAnchor)])
    expect(result.retainedKeys).toEqual([])
  })

  it('removes an old forecast when its current anchor succeeds without a forecast', () => {
    const anchor = { date: '2026-10-20', lat: 28.6, lng: 77.2 }
    const result = mergeOverviewWeather(
      [anchor],
      [fulfilled()],
      { [overviewWeatherKey(anchor)]: weather(anchor.date, 30) },
    )

    expect(result.byDate).toEqual({})
    expect(result.failedKeys).toEqual([])
    expect(result.retainedKeys).toEqual([])
  })
})
