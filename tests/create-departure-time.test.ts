// ============ Departure time in the plan-trip form ============
//
// The create form asked for dates but never for the clock, so every new trip
// silently started at the engine's 08:30 default until the user opened the
// workspace timeline and changed each day by hand.
//
// The fix is one trip-wide answer on the "When?" step, stamped onto each day's
// existing `startTime` (days are JSONB — no migration). The empty case is the
// contract that keeps this change honest: an untouched field must leave every
// day WITHOUT a startTime, so the engine default still governs and no trip
// gains a value the user never chose.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

type FakeError = { code?: string; message: string } | null

const { state } = vi.hoisted(() => ({
  state: {
    writes: [] as Array<{ table: string; method: string; payload: any }>,
  },
}))

vi.mock('../src/components/ui', () => ({ toast: vi.fn() }))

vi.mock('../src/lib/supabase', () => {
  function query() {
    const qb: any = {}
    qb.select = () => qb
    qb.eq = () => qb
    qb.in = () => qb
    qb.order = () => qb
    qb.limit = () => qb
    qb.then = (res: (v: { data: unknown; error: FakeError }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(res)
    qb.maybeSingle = () => ({
      then: (res: (v: { data: unknown; error: FakeError }) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(res),
    })
    return qb
  }
  function write(table: string, method: string, payload: any) {
    const qb: any = {}
    qb.eq = () => qb
    qb.in = () => qb
    qb.select = () => qb
    qb.then = (res: (v: { data: unknown; error: FakeError }) => unknown, rej?: (e: unknown) => unknown) => {
      state.writes.push({ table, method, payload })
      return Promise.resolve({ data: null, error: null }).then(res, rej)
    }
    return qb
  }
  return {
    isSupabaseConfigured: () => true,
    supabase: {
      from: (table: string) => {
        const qb = query()
        qb.insert = (p: any) => write(table, 'insert', p)
        qb.update = (p: any) => write(table, 'update', p)
        qb.upsert = (p: any) => write(table, 'upsert', p)
        qb.delete = () => write(table, 'delete', null)
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

import { createTripPersisted } from '../src/store/store'
import type { NewTripInput } from '../src/store/store'
import { validHM } from '../src/lib/timefmt'

const OWNER = 'creator-departure'

function input(over: Partial<NewTripInput> = {}): NewTripInput {
  return {
    name: 'Kerala in four days', startLocation: 'Kochi', destinations: ['Munnar'],
    startDate: '2026-10-01', endDate: '2026-10-04', travellers: 2,
    transportMode: 'car', budgetPerPersonInr: 22000, travelStyle: 'balanced',
    fixedCommitments: [],
    ...over,
  } as NewTripInput
}

function tripsInsert() {
  return state.writes.find(w => w.table === 'trips' && w.method === 'insert')
}

beforeEach(() => {
  state.writes.length = 0
})

describe('departure time - one answer for the whole trip', () => {
  it('stamps the chosen time on every day of the trip', async () => {
    const { trip } = await createTripPersisted(OWNER, input({ dayStartTime: '06:00' }))

    expect(trip.days).toHaveLength(4)
    expect(trip.days.map(d => d.startTime)).toEqual(['06:00', '06:00', '06:00', '06:00'])
  })

  it('leaves every day unset when the field was not touched', async () => {
    const { trip } = await createTripPersisted(OWNER, input())

    // undefined, not '08:30': the engine default keeps governing, so a trip
    // that never answered this question is identical to one created before it.
    expect(trip.days.map(d => d.startTime)).toEqual([undefined, undefined, undefined, undefined])
  })

  it('carries the time through the row that is written', async () => {
    await createTripPersisted(OWNER, input({ dayStartTime: '05:45' }))

    const row = tripsInsert()?.payload as { days: Array<{ startTime?: string }> }
    // days is the JSONB column — this is what survives a reload.
    expect(row.days.map(d => d.startTime)).toEqual(['05:45', '05:45', '05:45', '05:45'])
  })

  it('never leaks the form-only field onto the trip itself', async () => {
    const { trip } = await createTripPersisted(OWNER, input({ dayStartTime: '06:00' }))

    // NewTripInput is spread into Trip; the day stamp is where this belongs.
    expect((trip as unknown as Record<string, unknown>).dayStartTime).toBeUndefined()
  })

  it.each(['25:99', '9:5', 'abc', '', '   ', '24:00', '08:60'])(
    'refuses junk (%s) instead of writing a fake clock',
    async bad => {
      const { trip } = await createTripPersisted(OWNER, input({ dayStartTime: bad }))

      expect(trip.days.map(d => d.startTime)).toEqual([undefined, undefined, undefined, undefined])
    },
  )
})

describe('validHM - the one gate for a stored clock string', () => {
  it('keeps a real wall-clock time', () => {
    expect(validHM('00:00')).toBe('00:00')
    expect(validHM('06:00')).toBe('06:00')
    expect(validHM('23:59')).toBe('23:59')
  })

  it('rejects everything else', () => {
    for (const bad of ['', '   ', '24:00', '23:60', '9:5', '06:0', '6:00', 'abc', '::', undefined]) {
      expect(validHM(bad as string | undefined)).toBeUndefined()
    }
  })
})

describe('the create form - where the answer lives', () => {
  const page = readFileSync(new URL('../src/pages/CreateTrip.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  it('offers the control on the "When?" step, next to the dates', () => {
    const whenStart = page.indexOf('{/* ---- 3 - When ---- */}')
    const howStart = page.indexOf('{/* ---- 2 - How:')
    expect(whenStart).toBeGreaterThan(-1)
    expect(howStart).toBeGreaterThan(whenStart)
    const when = page.slice(whenStart, howStart)
    expect(when).toContain('id="ct-day-start"')
    expect(when).toContain('type="time"')
  })

  it('sends the validated value to the create call', () => {
    // The form field is free text from a native control; the store only ever
    // receives a value that passed validHM.
    expect(page).toContain('dayStartTime: validHM(f.dayStartTime)')
  })

  it('says the blank default honestly, so 08:30 is never a surprise', () => {
    expect(page).toContain('Leave blank to start each day at 08:30')
  })
})
