// ============ My trips redesign — pure helpers and source shape ============
// Greeting and counts line, Soonest-first sort, the coming-up / past split, the
// per-day strip labels, the "Ready to go" rule and the draft dismiss undo path.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { ItineraryDay, ItineraryStop, Trip } from '../src/data/types'
import type { ScheduleWarning } from '../src/lib/engine'
import {
  cardStatusLine, compareSoonest, countsLine, dateStamp, firstNameOf, greetingCounts, greetingDateLabel,
  greetingHeadline, greetingWord, splitByMemory, travelSoFar,
} from '../src/lib/tripsPage'
import { dayStrip, isReadyToGo, openChecks } from '../src/lib/tripDayStrip'
import { activityStopCount, plannedDayFlags } from '../src/lib/tripNextStep'
import { kmText, stopCountText } from '../src/lib/tripsCard'
import { countdownTiles, ringLabel, ringTone, startsSubtitle } from '../src/lib/tripCountdown'
import { clearDraft, loadDraft, saveDraft, type DraftStore } from '../src/lib/createDraft'

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// A fixed "today": Wednesday 28 October 2026, 09:30 local time.
const TODAY = new Date(2026, 9, 28, 9, 30)

function stop(id: string, order: number, auto = false): ItineraryStop {
  return { id, orderInDay: order, status: 'planned', auto } as unknown as ItineraryStop
}
function day(index: number, stops: ItineraryStop[]): ItineraryDay {
  return { id: `d${index}`, index, stops } as unknown as ItineraryDay
}
function trip(over: Partial<Trip> & { id: string }): Trip {
  return { name: over.id, startDate: '', endDate: '', days: [], updatedAt: 0, members: [], destinations: [], startLocation: 'A', ...over } as unknown as Trip
}
function warning(dayIndex: number | null, severity: ScheduleWarning['severity']): ScheduleWarning {
  return { code: 'x', severity, title: 't', detail: 'd', fix: 'f', dayIndex }
}

describe('greeting', () => {
  it('picks the time-of-day word', () => {
    expect(greetingWord(new Date(2026, 9, 28, 6))).toBe('morning')
    expect(greetingWord(new Date(2026, 9, 28, 12))).toBe('afternoon')
    expect(greetingWord(new Date(2026, 9, 28, 16, 59))).toBe('afternoon')
    expect(greetingWord(new Date(2026, 9, 28, 17))).toBe('evening')
  })

  it('names the viewer by first name, or greets alone with no name', () => {
    expect(greetingHeadline('Hasnain Ahmed', TODAY)).toBe('Good morning, Hasnain')
    expect(greetingHeadline('  ', TODAY)).toBe('Good morning')
    expect(greetingHeadline(undefined, new Date(2026, 9, 28, 20))).toBe('Good evening')
    expect(firstNameOf(null)).toBe('')
  })

  it('writes the date label', () => {
    expect(greetingDateLabel(TODAY)).toBe('Wednesday, 28 October')
  })
})

describe('counts line', () => {
  const trips = [
    trip({ id: 'up1', startDate: '2026-11-14', endDate: '2026-11-17' }),
    trip({ id: 'up2', startDate: '2026-12-20', endDate: '2026-12-26' }),
    trip({ id: 'live', startDate: '2026-10-27', endDate: '2026-10-30' }),
    trip({ id: 'idea' }),
    trip({ id: 'old', startDate: '2026-03-01', endDate: '2026-03-03' }),
  ]

  it('counts from statusOf and the create draft', () => {
    const counts = greetingCounts({ trips, today: TODAY, hasCreateDraft: true })
    expect(counts).toEqual({ comingUp: 3, drafts: 2, memories: 1 })
    expect(countsLine(counts)).toBe('3 trips coming up · 2 drafts · 1 memory')
  })

  it('leaves out every part that is zero', () => {
    expect(countsLine({ comingUp: 1, drafts: 0, memories: 0 })).toBe('1 trip coming up')
    expect(countsLine({ comingUp: 0, drafts: 1, memories: 2 })).toBe('1 draft · 2 memories')
    expect(countsLine({ comingUp: 0, drafts: 0, memories: 0 })).toBe('')
  })
})

describe('Soonest first', () => {
  it('sorts by start day and puts dateless trips last', () => {
    const list = [
      trip({ id: 'none', updatedAt: 9 }),
      trip({ id: 'dec', startDate: '2026-12-20', endDate: '2026-12-26' }),
      trip({ id: 'nov', startDate: '2026-11-14', endDate: '2026-11-17' }),
      trip({ id: 'bad', startDate: '2026-02-31', endDate: '2026-03-01', updatedAt: 1 }),
    ]
    expect([...list].sort(compareSoonest).map(t => t.id)).toEqual(['nov', 'dec', 'none', 'bad'])
  })

  it('breaks a tie with the most recent edit', () => {
    const a = trip({ id: 'a', startDate: '2026-11-14', endDate: '2026-11-15', updatedAt: 1 })
    const b = trip({ id: 'b', startDate: '2026-11-14', endDate: '2026-11-15', updatedAt: 5 })
    expect([a, b].sort(compareSoonest).map(t => t.id)).toEqual(['b', 'a'])
  })

  it('wires the sort key into the page', () => {
    const page = src('../src/pages/TripsList.tsx')
    expect(page).toContain("'soonest'")
    expect(page).toContain('compareSoonest')
    expect(page).toContain('<option value="soonest">Soonest first</option>')
  })
})

describe('coming-up and past split', () => {
  it('moves trips that ended out of the grid and keeps dateless trips in it', () => {
    const list = [
      trip({ id: 'old', startDate: '2026-03-01', endDate: '2026-03-03' }),
      trip({ id: 'idea' }),
      trip({ id: 'live', startDate: '2026-10-27', endDate: '2026-10-30' }),
    ]
    const { comingUp, past } = splitByMemory(list, TODAY)
    expect(comingUp.map(t => t.id)).toEqual(['idea', 'live'])
    expect(past.map(t => t.id)).toEqual(['old'])
  })

  it('gives travel so far from planned km and trips with friends only', () => {
    const withFriend = trip({ id: 'f', members: [{ userId: 'me', role: 'owner' }, { userId: 'pal', role: 'editor' }] as Trip['members'] })
    const viewerOnly = trip({ id: 'v', members: [{ userId: 'me', role: 'owner' }, { userId: 'fan', role: 'viewer' }] as Trip['members'] })
    const result = travelSoFar({ trips: [withFriend, viewerOnly], meId: 'me', kmOf: t => (t === withFriend ? 120.4 : 80) })
    expect(result).toEqual({ kmPlanned: 200.4, withFriends: 1 })
    expect(kmText(2511.4)).toBe('2,511 km')
    expect(stopCountText(1)).toBe('1 stop')
  })
})

describe('card status line, stamp and the Ready to go rule', () => {
  const planned = (n: number) => Array.from({ length: n }, (_, i) => day(i, [stop(`s${i}`, 0)]))

  it('says Idea for a trip without dates', () => {
    expect(cardStatusLine(trip({ id: 'x' }), TODAY, false)).toBe('Idea · no dates yet')
    expect(dateStamp(trip({ id: 'x' }))).toBeNull()
  })

  it('counts planned days, ignoring an automatic route anchor', () => {
    const t = trip({ id: 'p', startDate: '2026-12-20', endDate: '2026-12-22', days: [day(0, [stop('a', 0)]), day(1, [stop('anchor', 0, true)]), day(2, [])] })
    expect(cardStatusLine(t, TODAY, false)).toBe('Planning · 1 of 3 days')
    expect(plannedDayFlags(t)).toEqual([true, false, false])
    expect(activityStopCount(t)).toBe(1)
  })

  it('reads the stamp from the start day', () => {
    expect(dateStamp(trip({ id: 's', startDate: '2026-11-14' }))).toEqual({ weekday: 'SAT', day: 14, month: 'Nov' })
  })

  it('is ready only when every day is planned, dates exist and the day strip has nothing to fix', () => {
    const t = trip({ id: 'r', startDate: '2026-12-20', endDate: '2026-12-22', days: planned(3) })
    expect(isReadyToGo(t, TODAY, [])).toBe(true)
    // A medium warning on a day shows "1 to fix" in the strip, so the card must not say ready.
    expect(isReadyToGo(t, TODAY, [warning(1, 'medium')])).toBe(false)
    expect(openChecks(t, [warning(1, 'medium'), warning(2, 'low'), warning(2, 'medium')])).toBe(3)
    expect(cardStatusLine(t, TODAY, false, 3)).toBe('Planning · 3 to fix')
    expect(cardStatusLine(t, TODAY, false, 0)).toBe('Planning · 3 of 3 days')
    // A trip-wide high warning has no day cell, but still blocks "Ready to go".
    expect(isReadyToGo(t, TODAY, [warning(null, 'high')])).toBe(false)
    expect(isReadyToGo(t, TODAY, [warning(1, 'high')])).toBe(false)
    expect(cardStatusLine(t, TODAY, true)).toBe('Ready to go')
    const partly = { ...t, days: [...planned(2), day(2, [])] } as Trip
    expect(isReadyToGo(partly, TODAY, [])).toBe(false)
    expect(isReadyToGo({ ...t, startDate: '', endDate: '' } as Trip, TODAY, [])).toBe(false)
    expect(isReadyToGo(trip({ id: 'e', startDate: '2026-12-20', endDate: '2026-12-22' }), TODAY, [])).toBe(false)
  })
})

describe('day strip labels', () => {
  const t = trip({ id: 'strip', days: [day(0, [stop('a', 0)]), day(1, [stop('b', 0)]), day(2, [stop('c', 0)]), day(3, [])] })

  it('labels each day from the engine warnings grouped by day', () => {
    const cells = dayStrip(t, [warning(1, 'medium'), warning(1, 'low'), warning(2, 'high'), warning(null, 'high')])
    expect(cells).toEqual([
      { dayNumber: 1, tone: 'clear', label: 'All clear' },
      { dayNumber: 2, tone: 'fix', label: '2 to fix' },
      { dayNumber: 3, tone: 'risk', label: '1 to fix' },
      { dayNumber: 4, tone: 'empty', label: 'Not planned' },
    ])
  })

  it('draws no cell for a trip without days', () => {
    expect(dayStrip(trip({ id: 'z' }), [])).toEqual([])
  })
})

describe('draft dismiss undo path', () => {
  function memoryStore(): DraftStore {
    const data = new Map<string, string>()
    return {
      getItem: key => data.get(key) ?? null,
      setItem: (key, value) => { data.set(key, value) },
      removeItem: key => { data.delete(key) },
    }
  }

  it('removes the draft on dismiss and writes it back on undo', () => {
    const store = memoryStore()
    saveDraft({ form: { name: 'Goa weekend' }, dests: [{ name: 'Goa' } as never], returnCount: 0, step: 'stay' }, { store })
    const kept = loadDraft({ store })
    expect(kept?.form.name).toBe('Goa weekend')
    clearDraft({ store })
    expect(loadDraft({ store })).toBeNull()
    if (!kept) throw new Error('draft missing')
    saveDraft({ form: kept.form, dests: kept.dests, returnCount: kept.returnCount, crew: kept.crew, step: kept.step }, { store })
    expect(loadDraft({ store })?.form.name).toBe('Goa weekend')
  })

  it('wires dismiss to clearDraft with an undo toast that saves it again', () => {
    const page = src('../src/pages/TripsList.tsx')
    const at = page.indexOf('function dismissDraft()')
    expect(at, 'dismissDraft is missing').toBeGreaterThan(-1)
    const body = page.slice(at, page.indexOf('\n  }\n', at))
    expect(body).toContain('clearDraft()')
    expect(body).toContain('undoToast(')
    expect(body).toContain('saveDraft(')
  })
})

describe('Up next countdown row', () => {
  const t = (over: Partial<Trip>) => trip({ id: 'c', startDate: '2026-11-27', endDate: '2026-11-30', ...over })
  const stopAt = (id: string, order: number, title: string, extra: Record<string, unknown>) => ({ ...stop(id, order), title, ...extra }) as unknown as ItineraryStop

  it('gives one tile per digit for an upcoming trip', () => {
    expect(countdownTiles(t({ startDate: '2026-11-06', endDate: '2026-11-09' }), TODAY)).toEqual({ digits: ['9'], unit: 'Days to go', label: '9 days to go' })
    expect(countdownTiles(t({}), TODAY)?.label).toBe('30 days to go')
    expect(countdownTiles(t({ startDate: '2026-11-14', endDate: '2026-11-17' }), new Date(2026, 9, 28))?.label).toBe('17 days to go')
    expect(countdownTiles(t({ startDate: '2026-11-14', endDate: '2026-11-17' }), new Date(2026, 9, 28))?.digits).toEqual(['1', '7'])
    expect(countdownTiles(t({ startDate: '2026-10-29', endDate: '2026-10-30' }), TODAY)?.label).toBe('1 day to go')
  })

  it('gives no tiles for today, a live trip, a past trip or no dates', () => {
    expect(countdownTiles(t({ startDate: '2026-10-28', endDate: '2026-10-30' }), TODAY)).toBeNull()
    expect(countdownTiles(t({ startDate: '2026-10-20', endDate: '2026-10-30' }), TODAY)).toBeNull()
    expect(countdownTiles(t({ startDate: '2026-03-01', endDate: '2026-03-03' }), TODAY)).toBeNull()
    expect(countdownTiles(t({ startDate: '', endDate: '' }), TODAY)).toBeNull()
  })

  it('names the first timed stop of day 1 in the chosen clock', () => {
    const days = [day(0, [stopAt('a', 0, 'Kochi', { departTime: '08:00' }), stopAt('b', 1, 'Munnar', { departTime: '13:30' })])]
    expect(startsSubtitle(t({ days }), '24h')).toBe('Day 1 starts at 08:00 in Kochi')
    expect(startsSubtitle(t({ days }), '12h')).toBe('Day 1 starts at 8:00 AM in Kochi')
  })

  it('skips stops without a clock and falls back to the start date', () => {
    const untimed = [day(0, [stopAt('a', 0, 'Kochi', {}), stopAt('b', 1, 'Munnar', { arrivalTime: '11:15' })])]
    expect(startsSubtitle(t({ days: untimed }), '24h')).toBe('Day 1 starts at 11:15 in Munnar')
    const none = [day(0, [stopAt('a', 0, 'Kochi', {})])]
    expect(startsSubtitle(t({ days: none }), '24h')).toBe('Starts Fri 27 Nov')
    expect(startsSubtitle(t({ days: [stopAt('x', 0, 'Bad', { departTime: '25:99' })].length ? [day(0, [stopAt('x', 0, 'Bad', { departTime: '25:99' })])] : [] }), '24h')).toBe('Starts Fri 27 Nov')
    expect(startsSubtitle(t({ startDate: '', endDate: '', days: [] }), '24h')).toBeNull()
  })

  it('never invents a time for a rejected stop', () => {
    const rejected = { ...stopAt('r', 0, 'Kochi', { departTime: '06:00' }), status: 'rejected' } as unknown as ItineraryStop
    expect(startsSubtitle(t({ days: [day(0, [rejected])] }), '24h')).toBe('Starts Fri 27 Nov')
  })

  it('maps the health band to a ring tone and a label', () => {
    expect(ringTone('Comfortable')).toBe('teal')
    expect(ringTone('Manageable')).toBe('teal')
    expect(ringTone('Tight')).toBe('marigold')
    expect(ringTone('Unrealistic')).toBe('bloom')
    expect(ringLabel({ score: 74, band: 'Manageable' })).toBe('Estimated trip health 74, Manageable')
  })

  it('draws the ring from the same estimated warnings as the strip', () => {
    const page = src('../src/pages/TripsList.tsx')
    expect(page).toContain('health={scoreWarnings(tripChecks.get(upNext.id) ?? [])}')
    const css = src('../src/styles/legacy/09-trips-list.css')
    expect(css).toContain('.mt-ring-arc { animation: none; }')
  })
})

describe('Coming up toolbar row', () => {
  const page = () => src('../src/pages/TripsList.tsx')

  it('sorts Soonest first by default', () => {
    expect(page()).toContain("useState<SortKey>('soonest')")
  })

  it('has no When filter, and nothing imports one', () => {
    const p = page()
    expect(p).not.toContain('WhenKey')
    expect(p).not.toContain('aria-label="When"')
    expect(p).not.toContain('setWhen')
    expect(p).not.toContain("components/Select'")
    expect(p).not.toContain('Upcoming & live')
  })

  it('keeps Trash and Clear filters in the one row', () => {
    const p = page()
    const row = p.slice(p.indexOf('className="mt-listhead mt-block"'), p.indexOf('<p className="sr-only" role="status">'))
    expect(row).toContain('Trash</button>')
    expect(row).toContain('Clear filters')
    expect(row).toContain('onClick={toggleTrash}')
    expect(row).toContain('<ViewSwitch')
    expect(row).not.toContain('ex-filterbar')
  })
})
