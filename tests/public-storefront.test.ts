import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import type { ItineraryDay, ItineraryStop } from '../src/data/types'
import { chooseCover, countKinds, describeKinds, foldWeeks, kindOfCategory, lockedRunLine, paceOf, summariseDay, truncatePitch } from '../src/lib/publicStorefront'

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

  it('a locked day is summarised without flight data', () => {
    expect(page).toMatch(/summariseDay\([^\n]*isLocked \? false : flightDays\.has\(day\.index\)\)/)
  })

  it('the hero photo hides itself when its source fails', () => {
    const heroImg = page.match(/<img[^>]*pub-hero-photo[^>]*>/)?.[0] ?? ''
    expect(heroImg).toContain('onError=')
  })
})
