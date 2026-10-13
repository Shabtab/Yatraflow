import { describe, expect, it } from 'vitest'
import type { DayWeather } from '../src/lib/weather'
import {
  filterOverviewWeather,
  mergeOverviewWeather,
  overviewSliceView,
  overviewWeatherKey,
} from '../src/pages/trip/OverviewTab'

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
