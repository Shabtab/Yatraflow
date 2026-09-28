// ============ #376 — one day-count, parsed as local midnight ============
// Three copies of the same day-span math (the create form, the starter bill,
// the store) could disagree about one bad date range: the store guaranteed a
// trip ≥ 1 day while the bill printed 0, and the dock and the ticket answered
// differently on the same screen. Every copy also parsed `yyyy-mm-dd` with a
// bare `new Date(str)` — UTC midnight, 05:30 in IST — so any local-midnight
// writer (DateRangeCalendar.isoDay) drifts a day against it on an IST evening.
//
// These tests pin the shared helper's contract, the bill's 0 semantics, the
// store's ≥ 1 guarantee at ITS boundary, and a source ratchet so the second
// copy cannot come back.
import { readdirSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { dayCountForRange, localMidnightMs } from '../src/lib/dayCount'
import { isoDay } from '../src/components/DateRangeCalendar'
import { estimateTripStarter } from '../src/lib/tripStarter'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('dayCountForRange', () => {
  it('counts an inclusive span', () => {
    expect(dayCountForRange('2026-09-28', '2026-09-28')).toBe(1)
    expect(dayCountForRange('2026-09-28', '2026-09-30')).toBe(3)
    expect(dayCountForRange('2026-02-27', '2026-03-02')).toBe(4) // 2026 is not a leap year
  })

  it('answers 0 for missing, garbage, impossible or inverted ranges (bill semantics)', () => {
    expect(dayCountForRange('', '')).toBe(0)
    expect(dayCountForRange(undefined, '2026-09-28')).toBe(0)
    expect(dayCountForRange('garbage', '2026-09-28')).toBe(0)
    expect(dayCountForRange('2026-02-30', '2026-03-02')).toBe(0) // a rolled-over date is not a date
    expect(dayCountForRange('2026-13-01', '2026-12-31')).toBe(0)
    expect(dayCountForRange('2026-10-01', '2026-09-28')).toBe(0) // inverted
    expect(dayCountForRange('2026-10-01', null)).toBe(0)
  })

  it('parses yyyy-mm-dd as LOCAL midnight — the bare-Date trap, pinned', () => {
    // On a UTC host this is a contract statement; on this box (IST) it has
    // real teeth: a bare `new Date('2026-09-28')` is 05:30 local, so the old
    // parse fails this by exactly 5.5 h.
    expect(localMidnightMs('2026-09-28')).toBe(new Date(2026, 8, 28).getTime())
    expect(localMidnightMs('2026-02-30')).toBeNull()
    expect(localMidnightMs('2026-13-01')).toBeNull()
  })

  it('round-trips the writer: every local Date’s isoDay spans the right count', () => {
    // The IST-evening shape the old parse drifted on: 21:30 local on the 28th.
    const evening = new Date(2026, 8, 28, 21, 30)
    const nextDawn = new Date(2026, 8, 29, 5, 0)
    expect(dayCountForRange(isoDay(evening), isoDay(evening))).toBe(1)
    expect(dayCountForRange(isoDay(evening), isoDay(nextDawn))).toBe(2)
  })

  it('ignores a trailing time on a date-only field (the calendar day wins)', () => {
    expect(dayCountForRange('2026-09-28T18:30:00.000Z', '2026-09-29T04:00:00.000Z')).toBe(2)
  })
})

describe('the bill reads the one helper (0 semantics)', () => {
  const starterInput = (startDate: string, endDate: string) => ({
    startDate,
    endDate,
    travellers: 2,
    mode: 'car' as const,
    orderedPoints: [],
    returnCount: 0,
    roundTrip: false,
    stayStyle: 'comfort' as const,
  })

  it('reports 0 days and 0 nights on bad dates, never a phantom day', () => {
    const bill = estimateTripStarter(starterInput('2026-10-01', '2026-09-28'))
    expect(bill.days).toBe(0)
    expect(bill.nights).toBe(0)
    expect(estimateTripStarter(starterInput('', '')).days).toBe(0)
  })

  it('still counts a valid span inclusively', () => {
    const bill = estimateTripStarter(starterInput('2026-09-28', '2026-09-30'))
    expect(bill.days).toBe(3)
    expect(bill.nights).toBe(2)
  })
})

// ---- The store boundary: the ≥ 1 creation guarantee, applied visibly ----

vi.mock('../src/components/ui', () => ({ toast: vi.fn() }))

vi.mock('../src/lib/supabase', () => {
  function query() {
    const qb: any = {}
    qb.select = () => qb
    qb.eq = () => qb
    qb.in = () => qb
    qb.order = () => qb
    qb.limit = () => qb
    qb.then = (res: (v: { data: unknown; error: null }) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(res, rej)
    qb.maybeSingle = () => ({
      then: (res: (v: { data: unknown; error: null }) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(res, rej),
    })
    return qb
  }
  function write() {
    const qb: any = {}
    qb.eq = () => qb
    qb.in = () => qb
    qb.select = () => qb
    // Both handlers: a thenable that only accepts `res` hangs the awaiting
    // caller forever when it means to reject (the #374 test-mock trap).
    qb.then = (res: (v: { data: unknown; error: unknown }) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(res, rej)
    return qb
  }
  return {
    isSupabaseConfigured: () => true,
    supabase: {
      from: (table: string) => {
        const qb = query()
        qb.insert = () => write()
        qb.update = () => write()
        qb.upsert = () => write()
        qb.delete = () => write()
        return qb
      },
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      channel: () => ({ on() { return this }, subscribe() { return this } }),
      removeChannel: () => {},
      rpc: async () => ({ data: null, error: null }),
    },
  }
})

import { createTrip } from '../src/store/store'
import type { NewTripInput } from '../src/store/store'

function input(over: Partial<NewTripInput> = {}): NewTripInput {
  return {
    name: 'Kerala in four days', startLocation: 'Kochi', destinations: ['Munnar'],
    startDate: '2026-10-01', endDate: '2026-10-04', travellers: 2,
    transportMode: 'car', budgetPerPersonInr: 22000, travelStyle: 'balanced',
    fixedCommitments: [],
    ...over,
  } as NewTripInput
}

describe('the store applies max(1, …) at its own boundary', () => {
  it('a garbage or inverted range still builds exactly one day', () => {
    // The guarantee, stated as behaviour: the shared helper answers 0, and the
    // store — and only the store — turns that into a trip with one day.
    expect(createTrip('owner-376', input({ startDate: 'garbage', endDate: '' })).days.length).toBe(1)
    expect(createTrip('owner-376', input({ startDate: '2026-10-05', endDate: '2026-10-01' })).days.length).toBe(1)
    expect(createTrip('owner-376', input({ startDate: '2026-02-30', endDate: '2026-03-02' })).days.length).toBe(1)
  })

  it('a valid range still builds the inclusive span', () => {
    expect(createTrip('owner-376', input()).days.length).toBe(4)
  })
})

// ---- The source ratchet: no second day-span copy ----

const DAY_SPAN_LITERAL = /86_?400_?000/

describe('the day-span math has one home', () => {
  it('the create-path trio carries no day-span literal any more', () => {
    for (const file of ['../src/lib/tripStarter.ts', '../src/pages/CreateTrip.tsx']) {
      expect(DAY_SPAN_LITERAL.test(read(file)), `${file} grew its own day-span copy again`).toBe(false)
    }
    // store.ts keeps exactly ONE — reconcileDays' settings path, which parses
    // local midnight already and is deliberately not entangled with create.
    const storeCopies = read('../src/store/store.ts').match(new RegExp(DAY_SPAN_LITERAL.source, 'g')) ?? []
    expect(storeCopies.length, 'store.ts must keep only the reconcileDays span').toBe(1)
    expect(read('../src/store/store.ts')).toContain('Math.max(1, dayCountForRange(')
  })

  it('every day-span literal in src/ sits in a named home (a new copy fails here)', async () => {
    // The residual list is the honest shape of this fix: these sites are other
    // lanes' files or epoch/week math that is not day-counting. When a lane
    // replaces its copy with the helper, it deletes its name from this list.
    const ALLOWED = [
      'src/lib/dayCount.ts', // the one home
      'src/store/store.ts', // reconcileDays — the settings path, local-midnight already
      'src/lib/engine.ts', // shared; day attribution over an ms span (lane-shared)
      'src/lib/itinerarySpec.ts', // import format, UTC-Z on purpose (lane F)
      'src/lib/weather.ts', // UTC forecast-day math (lane E)
      'src/lib/adminStats.ts', // week buckets / epoch math, not day-counting
      'src/lib/pubFunnel.ts', // UTC day keys / epoch math, not day-counting
      'src/data/seed.ts', // fixture timestamps, not day-counting
      'src/pages/NativeHome.tsx', // live-window check over an ms span
      'src/pages/trip/TripSettingsForm.tsx', // lane D
      'src/pages/trip/OverviewTab.tsx', // lane E
    ]
    const files: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
        if (e.isDirectory()) walk(`${dir}${e.name}/`)
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(`${dir}${e.name}`)
      }
    }
    walk('../src/')
    // Parallel reads on purpose: this box charges ~12 ms per sync read (AV).
    const texts = await Promise.all(files.map(f => readFile(new URL(f, import.meta.url), 'utf8')))
    const offenders = files
      .filter((f, i) => DAY_SPAN_LITERAL.test(texts[i]!))
      .map(f => f.replace(/^\.\.\//, ''))
      .filter(rel => !ALLOWED.includes(rel))
    expect(offenders).toEqual([])
  })
})
