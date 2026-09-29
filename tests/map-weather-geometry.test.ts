// #420 slice 6 — the weather join, the road polyline and the journey budget.
//
// These five rules decided numbers the Plan tab spends (a damped cap, a detour
// distance, a fatigue budget) while living inline in a 2,710-line component, so
// the only regression test they had was a reader's attention. Each one is pinned
// here, plus the wiring: MapTab must go THROUGH the module, and the rule literals
// must not survive beside it — a second copy of a rule is how the module's copy
// becomes decorative.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  DRIZZLE_MIN_CHANCE_PCT,
  ROAD_TOTAL_MIN_KM,
  WMO_DRIZZLE_MAX,
  WMO_DRIZZLE_MIN,
  dayWeatherJoin,
  drizzleDayIndex,
  journeyKmFrom,
  routePolylineFrom,
  weatherAnchorFrom,
  weatherFetchRefusal,
} from '../src/pages/trip/map/weatherGeometry'

const mapTab = readFileSync(new URL('../src/pages/trip/MapTab.tsx', import.meta.url), 'utf8')
const module_ = readFileSync(new URL('../src/pages/trip/map/weatherGeometry.ts', import.meta.url), 'utf8')

describe('routePolylineFrom — OSRM pairs become the polyline the tab walks', () => {
  it('is null without a geometry', () => {
    expect(routePolylineFrom(null)).toBeNull()
    expect(routePolylineFrom(undefined)).toBeNull()
  })

  it('is null for an empty geometry', () => {
    expect(routePolylineFrom([])).toBeNull()
  })

  it('is null for a single point — one point has no direction', () => {
    expect(routePolylineFrom([[77.1, 28.6]])).toBeNull()
  })

  it('SWAPS the pair: GeoJSON [lng, lat] becomes {lat, lng}', () => {
    expect(routePolylineFrom([[77.1, 28.6], [77.2, 28.7]])).toEqual([
      { lat: 28.6, lng: 77.1 },
      { lat: 28.7, lng: 77.2 },
    ])
  })

  it('keeps the order of a longer polyline', () => {
    const line = routePolylineFrom([[1, 2], [3, 4], [5, 6]])
    expect(line?.map(p => p.lat)).toEqual([2, 4, 6])
    expect(line?.map(p => p.lng)).toEqual([1, 3, 5])
  })

  it('drops non-finite pairs rather than propagating them', () => {
    const line = routePolylineFrom([[77.1, 28.6], [Number.NaN, 28.7], [77.2, Number.POSITIVE_INFINITY], [77.3, 28.9]])
    expect(line).toEqual([{ lat: 28.6, lng: 77.1 }, { lat: 28.9, lng: 77.3 }])
  })

  it('is null when the drops leave fewer than two points', () => {
    expect(routePolylineFrom([[77.1, 28.6], [Number.NaN, Number.NaN]])).toBeNull()
  })

  it('does not mutate the geometry it is given', () => {
    const geometry = [[77.1, 28.6], [77.2, 28.7]]
    routePolylineFrom(geometry)
    expect(geometry).toEqual([[77.1, 28.6], [77.2, 28.7]])
  })
})

describe('journeyKmFrom — the trust floor under OSRM\'s total', () => {
  it('falls back when the total never resolved', () => {
    expect(journeyKmFrom(null, 412)).toBe(412)
    expect(journeyKmFrom(undefined, 412)).toBe(412)
  })

  it('reads a zero or non-finite total as a failure, not as a short trip', () => {
    expect(journeyKmFrom(0, 412)).toBe(412)
    expect(journeyKmFrom(Number.NaN, 412)).toBe(412)
    expect(journeyKmFrom(Number.POSITIVE_INFINITY, 412)).toBe(412)
  })

  it('falls back just below the floor and trusts the total AT it', () => {
    expect(journeyKmFrom(ROAD_TOTAL_MIN_KM - 0.1, 412)).toBe(412)
    expect(journeyKmFrom(ROAD_TOTAL_MIN_KM, 412)).toBe(ROAD_TOTAL_MIN_KM)
  })

  it('spends a resolved total', () => {
    expect(journeyKmFrom(421.3, 412)).toBe(421.3)
  })
})

describe('weatherAnchorFrom — which stops a forecast may be centred on', () => {
  it('is null with no stops at all', () => {
    expect(weatherAnchorFrom([])).toBeNull()
  })

  it('is null when every stop is rejected', () => {
    expect(weatherAnchorFrom([
      { lat: 28, lng: 77, status: 'rejected' },
      { lat: 30, lng: 79, status: 'rejected' },
    ])).toBeNull()
  })

  it('is null when no stop is geocoded', () => {
    expect(weatherAnchorFrom([
      { lat: Number.NaN, lng: 77 },
      { lat: 30, lng: Number.NaN },
    ])).toBeNull()
  })

  it('centres on the only usable stop', () => {
    expect(weatherAnchorFrom([{ lat: 28.6, lng: 77.1 }])).toEqual({ lat: 28.6, lng: 77.1 })
  })

  it('averages the usable stops', () => {
    expect(weatherAnchorFrom([
      { lat: 28, lng: 77 },
      { lat: 30, lng: 79 },
      { lat: 32, lng: 81 },
    ])).toEqual({ lat: 30, lng: 79 })
  })

  it('leaves rejected and un-geocoded stops OUT of the mean', () => {
    const anchor = weatherAnchorFrom([
      { lat: 28, lng: 77 },
      { lat: 90, lng: 90, status: 'rejected' },
      { lat: Number.NaN, lng: 79 },
      { lat: 30, lng: 79 },
    ])
    // (28 + 30) / 2 and (77 + 79) / 2 — a 4-stop mean would read 37 / 81.25
    expect(anchor).toEqual({ lat: 29, lng: 78 })
  })

  it('counts a stop whose status is anything but rejected', () => {
    expect(weatherAnchorFrom([
      { lat: 28, lng: 77, status: 'planned' },
      { lat: 30, lng: 79, status: 'done' },
    ])).toEqual({ lat: 29, lng: 78 })
  })
})

describe('weatherFetchRefusal — an empty join is honest, a guessed one is not', () => {
  const always = () => true
  const never = () => false

  it('refuses when there is no usable stop to centre on', () => {
    const refusal = weatherFetchRefusal({ stops: [], startDate: '2026-10-01', forecastAvailable: always })
    expect(refusal?.kind).toBe('no-stops')
    expect(refusal?.reason).not.toBe('')
  })

  it('refuses when the start date is past the forecast horizon', () => {
    const refusal = weatherFetchRefusal({
      stops: [{ lat: 28, lng: 77 }],
      startDate: '2027-01-01',
      forecastAvailable: never,
    })
    expect(refusal?.kind).toBe('no-forecast')
    expect(refusal?.reason).toContain('2027-01-01')
  })

  it('does not ask the forecaster at all when there are no stops', () => {
    let asked = 0
    weatherFetchRefusal({ stops: [], startDate: '2026-10-01', forecastAvailable: () => { asked += 1; return true } })
    expect(asked).toBe(0)
  })

  it('permits the fetch when both halves hold', () => {
    expect(weatherFetchRefusal({
      stops: [{ lat: 28, lng: 77 }],
      startDate: '2026-10-01',
      forecastAvailable: always,
    })).toBeNull()
  })
})

describe('dayWeatherJoin — one entry per day, missing weather stays missing', () => {
  const addDay = (iso: string, days: number) => {
    const d = new Date(`${iso}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }

  it('joins each day by its own date', () => {
    const join = dayWeatherJoin({
      dayCount: 3,
      startDate: '2026-10-01',
      byDate: {
        '2026-10-01': { rainChancePct: 10, code: 1 },
        '2026-10-02': { rainChancePct: 55, code: 61 },
        '2026-10-03': { rainChancePct: 80, code: 95 },
      },
      isoAddDays: addDay,
    })
    expect(join.rainPct).toEqual([10, 55, 80])
    expect(join.codes).toEqual([1, 61, 95])
  })

  it('reads a day the forecast does not cover as null in BOTH columns', () => {
    const join = dayWeatherJoin({
      dayCount: 2,
      startDate: '2026-10-01',
      byDate: { '2026-10-01': { rainChancePct: 10, code: 1 } },
      isoAddDays: addDay,
    })
    expect(join.rainPct).toEqual([10, null])
    expect(join.codes).toEqual([1, null])
  })

  it('keeps the columns independent when a row carries only one of them', () => {
    const join = dayWeatherJoin({
      dayCount: 1,
      startDate: '2026-10-01',
      byDate: { '2026-10-01': { rainChancePct: 55 } },
      isoAddDays: addDay,
    })
    expect(join.rainPct).toEqual([55])
    expect(join.codes).toEqual([null])
  })

  it('is empty for no days, and floors a fractional count', () => {
    expect(dayWeatherJoin({ dayCount: 0, startDate: '2026-10-01', byDate: {}, isoAddDays: addDay }))
      .toEqual({ rainPct: [], codes: [] })
    expect(dayWeatherJoin({ dayCount: -3, startDate: '2026-10-01', byDate: {}, isoAddDays: addDay }))
      .toEqual({ rainPct: [], codes: [] })
    const fractional = dayWeatherJoin({
      dayCount: 2.7,
      startDate: '2026-10-01',
      byDate: { '2026-10-01': { rainChancePct: 1 }, '2026-10-02': { rainChancePct: 2 }, '2026-10-03': { rainChancePct: 3 } },
      isoAddDays: addDay,
    })
    expect(fractional.rainPct).toEqual([1, 2])
  })

  it('walks from the START DATE it is given, not from today', () => {
    const seen: string[] = []
    dayWeatherJoin({
      dayCount: 3,
      startDate: '2026-12-24',
      byDate: {},
      isoAddDays: (iso, days) => { seen.push(`${iso}+${days}`); return iso },
    })
    expect(seen).toEqual(['2026-12-24+0', '2026-12-24+1', '2026-12-24+2'])
  })
})

describe('drizzleDayIndex — #141: drizzle-grade needs BOTH the chance and the code', () => {
  it('is -1 without a rain array', () => {
    expect(drizzleDayIndex(null, null)).toBe(-1)
    expect(drizzleDayIndex(undefined, [61])).toBe(-1)
    expect(drizzleDayIndex([], [])).toBe(-1)
  })

  it('finds the drizzle day', () => {
    expect(drizzleDayIndex([DRIZZLE_MIN_CHANCE_PCT, 5], [WMO_DRIZZLE_MIN, 1])).toBe(0)
  })

  it('a chance below the floor is not drizzle, however drizzly the code', () => {
    expect(drizzleDayIndex([DRIZZLE_MIN_CHANCE_PCT - 1, 5], [61, 1])).toBe(-1)
  })

  it('a code below the band is cloud; a code above it is a storm', () => {
    expect(drizzleDayIndex([90], [WMO_DRIZZLE_MIN - 1])).toBe(-1)
    expect(drizzleDayIndex([90], [WMO_DRIZZLE_MAX + 1])).toBe(-1)
  })

  it('the top of the band still counts', () => {
    expect(drizzleDayIndex([90], [WMO_DRIZZLE_MAX])).toBe(0)
  })

  it('a missing chance or a missing code skips that day', () => {
    expect(drizzleDayIndex([null, 90], [61, 61])).toBe(1)
    expect(drizzleDayIndex([90, 90], [null, 61])).toBe(1)
    expect(drizzleDayIndex([90], [null])).toBe(-1)
  })

  it('tolerates ragged input — a day with no code is simply not a drizzle day', () => {
    expect(drizzleDayIndex([90, 90], [1])).toBe(-1)
  })

  it('returns the FIRST qualifying day, and does not confuse a storm for one', () => {
    expect(drizzleDayIndex([10, 50, 70], [1, 61, 63])).toBe(1)
    expect(drizzleDayIndex([95, 90], [95, 61])).toBe(1)
  })
})

describe('MapTab goes THROUGH the module (wiring is part of the contract)', () => {
  it('imports all five rules from the module', () => {
    expect(mapTab).toContain("from './map/weatherGeometry'")
    for (const name of ['dayWeatherJoin', 'drizzleDayIndex', 'journeyKmFrom', 'routePolylineFrom', 'weatherAnchorFrom']) {
      expect(mapTab).toContain(name)
    }
  })

  it('calls each of them', () => {
    for (const call of [
      'routePolylineFrom(',
      'journeyKmFrom(',
      'weatherAnchorFrom(',
      'weatherFetchRefusal(',
      'dayWeatherJoin(',
      'drizzleDayIndex(',
    ]) {
      expect(mapTab).toContain(call)
    }
  })

  it('keeps no second copy of a rule the module owns', () => {
    // the drizzle rule, spelled inline
    expect(mapTab).not.toContain('p >= 40')
    expect(mapTab).not.toContain('c >= 51')
    expect(mapTab).not.toContain('c <= 63')
    // the journey floor and the polyline's two-point minimum
    expect(mapTab).not.toContain('>= 90')
    expect(mapTab).not.toContain('pts.length >= 2')
  })

  it('makes the module\'s thresholds load-bearing rather than decorative', () => {
    expect(module_).toContain('p >= DRIZZLE_MIN_CHANCE_PCT')
    expect(module_).toContain('c >= WMO_DRIZZLE_MIN')
    expect(module_).toContain('c <= WMO_DRIZZLE_MAX')
    expect(module_).toContain('routeTotalKm >= ROAD_TOTAL_MIN_KM')
    expect(module_).toContain('pts.length >= 2')
  })
})
