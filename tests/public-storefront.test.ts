import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import type { ItineraryDay, ItineraryStop, Trip } from '../src/data/types'
import { cap } from '../src/lib/labels'
import {
  chooseCover, countKinds, describeKinds, flightSignalFor, foldWeeks, hasAirLeg, kindOfCategory, lockedRunLine,
  paceOf, planLede, roadMinutesOf, summariseDay, summariseDayFromLegs, truncatePitch,
  type DaySummary,
} from '../src/lib/publicStorefront'
import { originOf, simulateDay } from '../src/lib/engine'
import { DayCard } from '../src/components/storefront/DayCard'
import { WhatIsInside } from '../src/components/storefront/WhatIsInside'

/** A stand-in stop that carries secret data everywhere a name must never leak. */
function secretStop(category: string, visitMinutes = 60): ItineraryStop {
  return {
    id: 's',
    title: 'SECRET-TITLE',
    category: category as ItineraryStop['category'],
    locationName: 'SECRET-LOCATION',
    lat: 12.345678,
    lng: 78.987654,
    visitMinutes,
    entryFeeInrPerPerson: 0,
    transportCostInrTotal: 0,
    priority: 'must-do',
  } as unknown as ItineraryStop
}

const KINDS = [
  { kind: 'nature', count: 4 },
  { kind: 'sight', count: 3 },
  { kind: 'temple', count: 2 },
  { kind: 'food', count: 1 },
]

describe('kindOfCategory', () => {
  const CASES: [string, string][] = [
    ['sightseeing', 'sight'], ['food', 'food'], ['nature', 'nature'], ['beach', 'beach'],
    ['temple', 'temple'], ['adventure', 'outdoors'], ['shopping', 'market'], ['museum', 'museum'],
    ['event', 'evening'], ['hotel', 'stay'], ['rest', 'stay'], ['travel', 'travel'], ['transport-hub', 'travel'],
  ]
  it.each(CASES)("maps %s to %s", (category, kind) => expect(kindOfCategory(category)).toBe(kind))
  it('maps an unknown or missing category to sight', () => {
    expect(kindOfCategory('festival')).toBe('sight')
    expect(kindOfCategory(undefined)).toBe('sight')
  })
})

describe('countKinds', () => {
  it('ignores stay and travel', () => {
    expect(countKinds([{ category: 'hotel' }, { category: 'rest' }, { category: 'travel' }, { category: 'transport-hub' }])).toEqual([])
  })
  it('sorts by count desc, then kind name', () => {
    const counts = countKinds([{ category: 'sightseeing' }, { category: 'sightseeing' }, { category: 'nature' }, { category: 'shopping' }])
    expect(counts).toEqual([{ kind: 'sight', count: 2 }, { kind: 'market', count: 1 }, { kind: 'nature', count: 1 }])
  })
})

describe('describeKinds', () => {
  it('says one kind', () => {
    expect(describeKinds([{ kind: 'nature', count: 4 }])).toBe('4 nature stops')
    expect(describeKinds([{ kind: 'temple', count: 1 }])).toBe('1 temple')
  })
  it('joins two kinds with and', () => {
    expect(describeKinds([{ kind: 'sight', count: 3 }, { kind: 'temple', count: 2 }])).toBe('3 sights and 2 temples')
  })
  it('joins three kinds', () => {
    expect(describeKinds(KINDS.slice(0, 3))).toBe('4 nature stops, 3 sights and 2 temples')
  })
  it('says nothing for an empty list', () => expect(describeKinds([])).toBe(''))
})

describe('paceOf boundaries', () => {
  it('nothing planned on an empty day', () => {
    expect(paceOf({ placeCount: 0, travelMinutes: 0, hasFlight: false, visitMinutes: 0 })).toEqual({ key: 'empty', label: 'Nothing planned' })
  })
  it('a flight wins over everything', () => {
    expect(paceOf({ placeCount: 0, travelMinutes: 0, hasFlight: true, visitMinutes: 0 })).toEqual({ key: 'flight', label: 'Flight day' })
  })
  it('under the limits is an easy day', () => {
    expect(paceOf({ placeCount: 3, travelMinutes: 179, hasFlight: false, visitMinutes: 599 })).toEqual({ key: 'easy', label: 'Easy day' })
  })
  it('180 min on the road is a long drive', () => {
    expect(paceOf({ placeCount: 3, travelMinutes: 180, hasFlight: false, visitMinutes: 0 }).label).toBe('Long drive')
  })
  it('4 stops is a full day', () => {
    expect(paceOf({ placeCount: 4, travelMinutes: 0, hasFlight: false, visitMinutes: 0 }).key).toBe('full')
  })
  it('a 10-hour span is a full day', () => {
    expect(paceOf({ placeCount: 3, travelMinutes: 0, hasFlight: false, visitMinutes: 600 }).key).toBe('full')
  })
})

describe('flightSignalFor', () => {
  it('withholds the flight on a locked day', () => {
    expect(flightSignalFor(true, true)).toBe('withheld')
    expect(flightSignalFor(false, true)).toBe('withheld')
  })
  it('passes the flight through on an open day', () => {
    expect(flightSignalFor(true, false)).toBe(true)
    expect(flightSignalFor(false, false)).toBe(false)
  })
})

// A flight lives on the trip, not inside `day.stops`, so a flight-only day
// carries no countable stop at all. That is the day the old code called empty.
const flightOnlyDay: ItineraryDay = { id: 'day', index: 6, stops: [] }

describe('a locked day never invents a pace', () => {
  it('shows no pace word whichever way the hidden flight goes', () => {
    // The card must read the same with a flight and without one, because the
    // flight signal never reaches it.
    for (const hasFlight of [true, false]) {
      const summary = summariseDay(flightOnlyDay, 0, flightSignalFor(hasFlight, true))
      expect(summary.pace).toBeNull()
      expect(summary.hasFlight).toBe(false)
    }
  })

  it('renders no pace word and no flight word on the locked card', () => {
    const summary = summariseDay(flightOnlyDay, 0, flightSignalFor(true, true))
    const html = renderToStaticMarkup(createElement(DayCard, { state: 'locked', summary }))
    expect(html).not.toContain('Nothing planned')
    expect(html).not.toContain('Flight day')
    expect(html).not.toContain('sf-pace')
    expect(html).not.toContain('sf-day-meta')
  })

  it('keeps an honest empty day and a flight day on an open card', () => {
    expect(summariseDay(flightOnlyDay, 0, flightSignalFor(false, false)).pace).toEqual({ key: 'empty', label: 'Nothing planned' })
    expect(summariseDay(flightOnlyDay, 0, flightSignalFor(true, false)).pace).toEqual({ key: 'flight', label: 'Flight day' })
  })

  it('keeps the pace word on a locked day that counts places', () => {
    const day: ItineraryDay = { id: 'day', index: 2, stops: [secretStop('temple')] }
    const summary = summariseDay(day, 200, flightSignalFor(true, true))
    expect(summary.pace).toEqual({ key: 'drive', label: 'Long drive' })
    expect(summary.hasFlight).toBe(false)
  })

  it('keeps the day title and the road minutes visible while locked', () => {
    const day: ItineraryDay = { id: 'day', index: 2, title: 'Munnar hills', stops: [] }
    const summary = summariseDay(day, 200, flightSignalFor(true, true))
    const html = renderToStaticMarkup(createElement(DayCard, { state: 'locked', summary }))
    expect(html).toContain('Munnar hills')
    expect(html).toContain('3 h 20 m on the road')
  })

  it('renders no stop name, location or coordinate on a locked card', () => {
    const day: ItineraryDay = { id: 'day', index: 3, stops: [secretStop('temple'), secretStop('food')] }
    const summary = summariseDay(day, 0, flightSignalFor(true, true))
    const html = renderToStaticMarkup(createElement(DayCard, { state: 'locked', summary }))
    for (const secret of ['SECRET-TITLE', 'SECRET-LOCATION', '12.345678', '78.987654']) {
      expect(html).not.toContain(secret)
    }
  })
})

describe('a plan with no days has no lede', () => {
  it('composes no sentence for zero days', () => {
    expect(planLede(0, KINDS)).toBeNull()
    expect(planLede(0, [])).toBeNull()
  })

  it('keeps the sentence a real plan had', () => {
    expect(planLede(5, KINDS)).toBe('A 5-day plan with 4 nature stops, 3 sights, 2 temples and 1 food stop.')
    expect(planLede(5, KINDS.slice(0, 3))).toBe('A 5-day plan with 4 nature stops, 3 sights and 2 temples.')
    expect(planLede(5, [])).toBe('A 5-day plan.')
  })

  it('renders no lede paragraph and no zero-day claim', () => {
    const html = renderToStaticMarkup(createElement(WhatIsInside, { lede: planLede(0, []), kinds: [], days: [] }))
    expect(html).not.toContain('sf-inside-lede')
    expect(html).not.toContain('0-day')
  })

  it('renders the lede paragraph for a real plan', () => {
    const html = renderToStaticMarkup(createElement(WhatIsInside, { lede: planLede(5, KINDS), kinds: KINDS, days: [] }))
    expect(html).toContain('A 5-day plan with 4 nature stops, 3 sights, 2 temples and 1 food stop.')
  })
})

const wk = (n: number, at = 0) => Array.from({ length: n }, (_, i) => i + at)

describe('foldWeeks', () => {
  it('7 days stays flat', () => expect(foldWeeks(7)).toBeNull())
  it('8 days folds 7 plus 1', () => {
    expect(foldWeeks(8)).toEqual([{ label: 'Week 1', days: wk(7) }, { label: 'Week 2', days: [7] }])
  })
  it('14 days folds 7 plus 7', () => {
    expect(foldWeeks(14)).toEqual([{ label: 'Week 1', days: wk(7) }, { label: 'Week 2', days: wk(7, 7) }])
  })
  it('15 days folds 7, 7 and 1', () => {
    expect(foldWeeks(15)).toEqual([{ label: 'Week 1', days: wk(7) }, { label: 'Week 2', days: wk(7, 7) }, { label: 'Week 3', days: [14] }])
  })
  it('30 days folds into 5 groups', () => {
    expect(foldWeeks(30)).toEqual([
      { label: 'Week 1', days: wk(7) },
      { label: 'Week 2', days: wk(7, 7) },
      { label: 'Week 3', days: wk(7, 14) },
      { label: 'Week 4', days: wk(7, 21) },
      { label: 'Week 5', days: [28, 29] },
    ])
  })
})

describe('chooseCover', () => {
  const pub = { coverImageUrl: undefined, routeSummary: ['Delhi', 'Agra'], durationDays: 5 }
  it('a photo wins when a cover url exists', () => {
    expect(chooseCover({ ...pub, coverImageUrl: 'https://c/x.jpg' }, KINDS, 'road')).toEqual({ kind: 'photo', src: 'https://c/x.jpg' })
  })
  it('a ticket with the top 3 kinds when there is no photo', () => {
    expect(chooseCover(pub, KINDS, 'road')).toEqual({ kind: 'ticket', routeLine: 'Delhi to Agra', days: 5, mode: 'road', kinds: KINDS.slice(0, 3) })
  })
  it('a round trip says Round trip from', () => {
    const plan = chooseCover({ ...pub, routeSummary: ['Bangalore', 'Mysore', 'Bangalore'] }, KINDS, 'road')
    expect(plan.kind).toBe('ticket')
    expect((plan as { routeLine: string }).routeLine).toBe('Round trip from Bangalore')
  })
})

describe('lockedRunLine', () => {
  it('says the exact locked line', () => {
    expect(lockedRunLine(5, 8, KINDS.slice(0, 3))).toBe('Inside days 5 to 8: 4 nature stops, 3 sights and 2 temples. Their names open when you buy the plan.')
  })
  it('says one locked day', () => {
    expect(lockedRunLine(5, 5, [{ kind: 'temple', count: 1 }])).toBe('Inside day 5: 1 temple. Their names open when you buy the plan.')
  })
  it('says two locked days with and', () => {
    expect(lockedRunLine(5, 6, KINDS).startsWith('Inside days 5 and 6:')).toBe(true)
  })
  it('says nothing with no kinds', () => expect(lockedRunLine(5, 8, [])).toBe(''))
})

describe('truncatePitch', () => {
  it('keeps text at the limit', () => expect(truncatePitch('a'.repeat(140))).toBe('a'.repeat(140)))
  it('cuts text over the limit with an ellipsis', () => {
    const cut = truncatePitch('a'.repeat(141))
    expect(cut.length).toBe(140)
    expect(cut.endsWith('…')).toBe(true)
  })
  it('keeps an empty pitch empty', () => expect(truncatePitch('')).toBe(''))
  it('trims the space before the ellipsis', () => {
    expect(truncatePitch('word '.repeat(40), 10)).toBe('word word…')
  })
  it('never splits a surrogate pair', () => {
    const cut = truncatePitch('😀'.repeat(10), 4)
    expect(cut).toBe('😀😀😀…')
    expect(/[�-�](?![�-�])/.test(cut)).toBe(false)
  })
})

describe('lockedRunLine closing', () => {
  it('takes a neutral closing sentence', () => {
    expect(lockedRunLine(2, 3, [{ kind: 'sight', count: 2 }], 'Their names stay hidden here.')).toBe('Inside days 2 and 3: 2 sights. Their names stay hidden here.')
  })
})

describe('lock safety', () => {
  it('locked-day results never carry a name or a coordinate', () => {
    const day: ItineraryDay = { id: 'day', index: 4, stops: ['nature', 'sightseeing', 'temple', 'hotel', 'food', 'travel'].map((c) => secretStop(c)) }
    const kinds = countKinds(day.stops)
    const summary = summariseDay(day, 200, false)
    const results = [
      JSON.stringify(summary),
      JSON.stringify(countKinds(day.stops)),
      JSON.stringify(describeKinds(kinds)),
      JSON.stringify(lockedRunLine(5, 8, kinds)),
      JSON.stringify(chooseCover({ routeSummary: ['Public City A', 'Public City B'], durationDays: 8 }, kinds, 'road')),
    ]
    for (const json of results) {
      expect(json).not.toContain('SECRET-TITLE')
      expect(json).not.toContain('SECRET-LOCATION')
      expect(json).not.toContain('12.345678')
      expect(json).not.toContain('78.987654')
    }
    expect(summary.placeCount).toBe(4)
    expect(summary.kinds).toEqual([{ kind: 'food', count: 1 }, { kind: 'nature', count: 1 }, { kind: 'sight', count: 1 }, { kind: 'temple', count: 1 }])
  })
})

describe('page lock safety (source scan)', () => {
  const page = readFileSync(new URL('../src/pages/PublicItinerary.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const RETURN = "return { state: 'locked', summary }"
  const open = page.indexOf('if (isLocked) {')
  const close = open < 0 ? -1 : page.indexOf(RETURN, open)
  const lockedBranch = open < 0 || close < 0 ? '' : page.slice(open, close + RETURN.length)

  it('finds the locked branch and returns only state and summary', () => {
    expect(lockedBranch).not.toBe('')
    expect(lockedBranch).toContain(RETURN)
  })

  it('the locked branch has no places key, stop title or location name', () => {
    expect(lockedBranch).not.toMatch(/\bplaces\b/)
    expect(lockedBranch).not.toMatch(/\.title\b/)
    expect(lockedBranch).not.toMatch(/locationName/)
  })

  it('the page withholds the flight on a locked day', () => {
    // The flight signal goes through `flightSignalFor`, so a locked card cannot
    // read a hidden flight as an empty day.
    const call = page.match(/summariseDay\w*\([\s\S]*?\)\n/)?.[0] ?? ''
    expect(call).toContain('flightSignalFor(')
    expect(call).not.toContain('isLocked ? false')
  })

  it('the page builds the day summary from the engine legs, not from the engine total', () => {
    // The card says "on the road". The engine's total also counts the air
    // sector, so the page must read the ground legs instead.
    const call = page.match(/summariseDayFromLegs\([\s\S]*?\)\n/)?.[0] ?? ''
    expect(call).toContain('sim.legs')
    expect(call).toContain('flightSignalFor(')
    expect(call).not.toContain('sim.totalTravelMinutes')
  })

  it('the page skips the storefront section when the plan has no days', () => {
    expect(page).toContain('storefront.cards.length > 0')
  })

  it('the hero photo hides itself when its source fails', () => {
    const heroImg = page.match(/<img[^>]*pub-hero-photo[^>]*>/)?.[0] ?? ''
    expect(heroImg).toContain('onError=')
  })
})

/** A day with no stored stops. The flight lives on the trip, not in the day. */
const flightDay: ItineraryDay = { id: 'day0', index: 0, title: 'Travel day', stops: [] }

/** A flight-mode trip: Delhi to Mumbai, one stored flight on day 0. */
const flightTrip = {
  id: 'trip-1',
  name: 'Delhi to Mumbai',
  startLocation: 'Delhi',
  startLocationCoords: { lat: 28.6139, lng: 77.209 },
  destinations: ['Mumbai'],
  destinationCoords: [{ lat: 19.0896, lng: 72.8656 }],
  startDate: '2026-11-01',
  endDate: '2026-11-01',
  travellers: 2,
  transportMode: 'flight',
  budgetPerPersonInr: 20000,
  travelStyle: 'balanced',
  fixedCommitments: [],
  days: [flightDay],
  expenses: [],
  coverEmoji: 'x',
  visibility: 'private',
  createdAt: 1,
  updatedAt: 1,
  flights: [{ id: 'f1', dayIndex: 0, fromAirport: 'DEL', toAirport: 'BOM', departAt: '06:00', arriveAt: '08:15' }],
} as unknown as Trip

describe('road minutes (F1)', () => {
  const sim = simulateDay(flightDay, flightTrip, originOf(flightTrip, 0), 0)
  const airMinutes = sim.legs.filter((l) => l.kind === 'air').reduce((sum, l) => sum + l.durationMinutes, 0)
  const groundMinutes = sim.legs.filter((l) => l.kind !== 'air').reduce((sum, l) => sum + l.durationMinutes, 0)

  it('the engine reports an air sector and a ground transfer for the same day', () => {
    // The premise of the defect. If the engine stopped reporting an air leg,
    // this whole block would be testing nothing.
    expect(airMinutes).toBe(135)
    expect(groundMinutes).toBeGreaterThan(0)
    expect(sim.totalTravelMinutes).toBeCloseTo(airMinutes + groundMinutes, 6)
  })

  it('counts the ground legs only', () => {
    expect(roadMinutesOf(sim.legs)).toBeCloseTo(groundMinutes, 6)
    expect(roadMinutesOf(sim.legs)).toBeLessThan(sim.totalTravelMinutes)
    // The air leg is excluded, and the total is not.
    expect(roadMinutesOf(sim.legs)).not.toBeCloseTo(sim.totalTravelMinutes, 6)
  })

  it('treats a leg with no kind as ground', () => {
    expect(roadMinutesOf([{ kind: 'road', durationMinutes: 30 }, { durationMinutes: 12 }])).toBe(42)
  })

  it('builds the day summary from the engine legs, not from the engine total', () => {
    // The page's own dataflow: the engine's legs in, the summary out.
    const summary = summariseDayFromLegs(flightDay, sim.legs, flightSignalFor(true, true))
    expect(summary.travelMinutes).toBe(Math.round(groundMinutes))
    expect(summary.travelMinutes).toBe(32)
    // The flight is still withheld on a locked day, so no pace word appears.
    expect(summary.hasFlight).toBe(false)
    expect(summary.pace).toBeNull()
  })

  it('a locked card never presents the air minutes as road time', () => {
    const summary = summariseDayFromLegs(flightDay, sim.legs, flightSignalFor(true, true))
    const html = renderToStaticMarkup(createElement(DayCard, { state: 'locked', summary }))
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    // The old defect: the engine total counted the 135-minute air sector and
    // the card read it as "2 h 47 m on the road".
    expect(text).not.toContain('2 h 47 m on the road')
    expect(text).not.toContain('167 m on the road')
    // The real ground transfer time is still there.
    expect(text).toContain('32 m on the road')
  })

  it('a readable card keeps the flight pace and still shows the ground time', () => {
    const summary = summariseDayFromLegs(flightDay, sim.legs, flightSignalFor(true, false))
    const html = renderToStaticMarkup(createElement(DayCard, { state: 'free', summary, places: [] }))
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    expect(summary.pace).toEqual({ key: 'flight', label: 'Flight day' })
    expect(text).toContain('Flight day')
    expect(text).not.toContain('2 h 47 m on the road')
    expect(text).toContain('32 m on the road')
  })

  it('a day without a flight keeps every minute on the road', () => {
    // A driving day has no air leg, so the ground minutes are the whole total.
    const roadTrip = { ...flightTrip, transportMode: 'car', flights: [] } as unknown as Trip
    const roadSim = simulateDay(flightDay, roadTrip, originOf(roadTrip, 0), 0)
    const summary = summariseDayFromLegs(flightDay, roadSim.legs, flightSignalFor(false, false))
    expect(summary.travelMinutes).toBe(Math.round(roadSim.totalTravelMinutes))
  })
})

describe('unbroken text (F2)', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  it('lets the day title break inside the card', () => {
    expect(css).toMatch(/\.sf-day > \.sf-day-title \{[^}]*overflow-wrap: anywhere;/)
  })

  it('lets the readable place name break inside its column', () => {
    expect(css).toMatch(/\.sf-day-place > span \{[^}]*overflow-wrap: anywhere;/)
  })

  it('keeps the ticket grid item inside the cover', () => {
    // The cover's grid track must not grow to the ticket's longest line.
    expect(css).toMatch(/\.sf-cover:has\(> \.sf-cover-ticket\) \{[^}]*grid-template-columns: minmax\(0, 1fr\);/)
    expect(css).toMatch(/\.sf-cover > \.sf-cover-ticket \{[^}]*min-width: 0;/)
  })

  it('lets the ticket route break inside the ticket', () => {
    expect(css).toMatch(/\.sf-cover > \.sf-cover-ticket > \.sf-cover-ticket-route \{[^}]*overflow-wrap: anywhere;/)
  })

  it('adds the new rules at the end of the stylesheet and leaves the base block alone', () => {
    // END-only for this section. Later sections may follow it.
    const marker = 'storefront: an unbroken run stays inside its card'
    expect(css).toContain(marker)
    const at = css.indexOf(marker)
    expect(at).toBeGreaterThan(0)
    // Later sections follow this one, so the slice stops at this section's own last rule.
    const ruleAt = css.indexOf('.sf-cover > .sf-cover-ticket > .sf-cover-ticket-route {', at)
    expect(ruleAt).toBeGreaterThan(at)
    const tail = css.slice(at + marker.length, css.indexOf('\n}', ruleAt) + 2)
    expect(tail.trim().startsWith('----------')).toBe(true)
    expect(tail).not.toMatch(/\n[^\n]*\{[^\n]*\n\s*\}\s*\n\s*@media/)
    // The rules are additive. The base block keeps its own values.
    expect(css).toMatch(/\.sf-day \{[^}]*overflow: hidden;/)
  })
})

/**
 * The page's own storefront memo, extracted from the page source with the
 * TypeScript parser and executed unchanged.
 *
 * No page formula is written out here. The callback below IS the page's, so a
 * change in the page changes what this test exercises, and a helper unit test
 * cannot pass while the page still does the wrong thing. The scope holds the
 * page's dependencies only: the real engine, the real storefront helpers and
 * the page's own closure variables.
 */
function pageStorefrontCallback(source: string): string {
  const ast = ts.createSourceFile('PublicItinerary.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found: string | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'storefront') {
      const init = node.initializer
      if (init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'useMemo') {
        found = init.arguments[0]?.getText(ast)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (!found) throw new Error('the page storefront useMemo callback was not found')
  return (
    ts.transpileModule(`const extracted = ${found}`, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
    }).outputText + '\nreturn extracted();'
  )
}

interface StorefrontCard {
  state: 'free' | 'locked' | 'yours'
  summary: DaySummary
  places?: unknown
}

interface StorefrontResult {
  cards: StorefrontCard[]
  lede: string | null
  lockedLine: string
}

describe('page storefront dataflow (the actual page callback)', () => {
  const pageSource = readFileSync(new URL('../src/pages/PublicItinerary.tsx', import.meta.url), 'utf8')
  const callback = pageStorefrontCallback(pageSource)

  /** Runs the page's own callback and renders the cards it returns. */
  function runStorefront(trip: Trip, freeDayIndexes: number[], unlocked = false): StorefrontResult {
    const pub = {
      freeDayIndexes,
      premiumPriceInr: 499,
      routeSummary: ['Delhi', 'Mumbai'],
      durationDays: trip.days.length,
    }
    const scope: Record<string, unknown> = {
      // The page's dependencies. The real ones, not copies.
      simulateDay, originOf,
      summariseDayFromLegs, flightSignalFor, kindOfCategory, countKinds, planLede,
      lockedRunLine, chooseCover, foldWeeks, truncatePitch, hasAirLeg,
      cap,
      // The page's closure variables.
      trip, pub, orderedDays: trip.days, unlocked, mayShowPriceCta: true,
    }
    const names = Object.keys(scope)
    const run = new Function(...names, callback) as (...args: unknown[]) => StorefrontResult
    return run(...names.map((n) => scope[n]))
  }

  const textOf = (card: StorefrontCard): string =>
    renderToStaticMarkup(createElement(DayCard, card as never))
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  /** The same route with no flight entered: the engine plans the air leg. */
  const synthTrip = { ...flightTrip, flights: [] } as unknown as Trip

  it('the page callback is found and runs', () => {
    // If the page stopped building the storefront, this whole block would be
    // testing nothing. So the harness is checked first.
    const result = runStorefront(synthTrip, [0])
    expect(result.cards.length).toBe(1)
    expect(result.cards[0].state).toBe('free')
  })

  it('a free estimated-flight day says "Flight day", not "Nothing planned"', () => {
    // The defect: the page read the flight only from the stored flight rows,
    // so a flight trip the traveller has not detailed yet called a planned
    // journey an empty day.
    const result = runStorefront(synthTrip, [0])
    const card = result.cards[0]
    expect(card.summary.pace).toEqual({ key: 'flight', label: 'Flight day' })
    expect(textOf(card)).toBe('Day 1 Free Travel day Flight day 32 m on the road')
    expect(textOf(card)).not.toContain('Nothing planned')
  })

  it('a yours estimated-flight day says "Flight day", not "Nothing planned"', () => {
    // The same trip, unlocked rather than free. The page's own `unlocked`
    // flag picks the state; the flight signal is the same.
    const result = runStorefront(synthTrip, [], true)
    const card = result.cards[0]
    expect(card.state).toBe('yours')
    expect(card.summary.pace).toEqual({ key: 'flight', label: 'Flight day' })
    expect(textOf(card)).toBe('Day 1 Yours Travel day Flight day 32 m on the road')
    expect(textOf(card)).not.toContain('Nothing planned')
  })

  it('a stored flight still says "Flight day" and keeps the same ground minutes', () => {
    // The control that must not move.
    const result = runStorefront(flightTrip as unknown as Trip, [0])
    const card = result.cards[0]
    expect(card.summary.pace).toEqual({ key: 'flight', label: 'Flight day' })
    expect(card.summary.travelMinutes).toBe(32)
  })

  it('a locked flight day discloses no flight, whichever signal carries it', () => {
    // Locked privacy. The stored flight, the estimated flight and a road trip
    // with no flight at all must all produce the same locked card, because a
    // locked card may not disclose a flight.
    const locked = [synthTrip, flightTrip as unknown as Trip].map((t) => runStorefront(t, []).cards[0])
    for (const card of locked) {
      expect(card.state).toBe('locked')
      expect(card.summary.pace).toBeNull()
      expect(card.summary.hasFlight).toBe(false)
      expect(card.summary.travelMinutes).toBe(32)
      // No places key, no names, no coordinates, no flight word.
      expect(Object.hasOwn(card, 'places')).toBe(false)
      const text = textOf(card)
      expect(text).toBe('Day 1 Locked Travel day 32 m on the road')
      expect(text).not.toContain('Flight day')
      expect(text).not.toContain('Nothing planned')
    }
    // The two locked cards are identical, so the underlying signal changed
    // nothing the reader can see.
    expect(textOf(locked[0])).toBe(textOf(locked[1]))
  })

  it('a locked road day with no flight discloses no flight either', () => {
    // The control the Gate asked for: air against no air, on a locked card.
    // The two journeys are not the same journey — a drive from Delhi to
    // Mumbai is a real long drive, and those minutes are honest. What must
    // not differ is what the card discloses: neither card may name a flight
    // or claim a pace.
    const roadTrip = { ...flightTrip, transportMode: 'car', flights: [] } as unknown as Trip
    const road = runStorefront(roadTrip, []).cards[0]
    const air = runStorefront(synthTrip, []).cards[0]
    for (const card of [road, air]) {
      expect(card.state).toBe('locked')
      expect(card.summary.pace).toBeNull()
      expect(card.summary.hasFlight).toBe(false)
      expect(Object.hasOwn(card, 'places')).toBe(false)
      expect(textOf(card)).not.toContain('Flight day')
      expect(textOf(card)).not.toContain('Nothing planned')
    }
  })

  it('an actual empty stay day still says "Nothing planned"', () => {
    // A three-day trip: day 0 flies, days 1 and 2 are stay days with no stops.
    // The engine puts no air leg on a stay day, so those days are honestly
    // empty and must not borrow the travel day's flight.
    const stayDay: ItineraryDay = { id: 'day1', index: 1, title: 'Stay day', stops: [] }
    const stayDay2: ItineraryDay = { id: 'day2', index: 2, title: 'Stay day 2', stops: [] }
    const stayTrip = {
      ...synthTrip,
      endDate: '2026-11-03',
      days: [flightDay, stayDay, stayDay2],
    } as unknown as Trip
    const result = runStorefront(stayTrip, [0, 1, 2])
    expect(result.cards.length).toBe(3)
    // The travel day flies and keeps its real ground transfer time.
    expect(result.cards[0].summary.pace).toEqual({ key: 'flight', label: 'Flight day' })
    expect(result.cards[0].summary.travelMinutes).toBe(32)
    // The stay days are empty and say so.
    expect(result.cards[1].summary.pace).toEqual({ key: 'empty', label: 'Nothing planned' })
    expect(result.cards[1].summary.travelMinutes).toBe(0)
    expect(result.cards[2].summary.pace).toEqual({ key: 'empty', label: 'Nothing planned' })
    expect(result.cards[2].summary.travelMinutes).toBe(0)
  })

  it('a plan with no days shows no lede', () => {
    // The zero-day control. The page's own lede, from the page's own callback.
    const emptyTrip = { ...synthTrip, days: [] } as unknown as Trip
    const result = runStorefront(emptyTrip, [])
    expect(result.lede).toBeNull()
    expect(result.cards.length).toBe(0)
  })

  it('a readable day with places and no flight keeps its honest pace', () => {
    // The fix must not make every day a flight day. A road trip with a real
    // drive keeps the drive pace; the day is not a flight day.
    const withPlaces: ItineraryDay = {
      id: 'day0', index: 0, title: 'Mumbai', stops: [secretStop('sightseeing')],
    }
    const roadTrip = {
      ...flightTrip, transportMode: 'car', flights: [], days: [withPlaces],
    } as unknown as Trip
    const result = runStorefront(roadTrip, [0])
    expect(result.cards[0].summary.pace).toEqual({ key: 'drive', label: 'Long drive' })
    expect(result.cards[0].summary.hasFlight).toBe(false)
  })
})
