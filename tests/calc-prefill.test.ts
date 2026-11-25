// ============ Calculator → trip hand-off ============
// The static destination calculators hand a visitor to /new with one query
// (src/lib/calcPrefill.ts): the whole contract between a page this app does
// not render and the form it does. Node env — no DOM. These tests pin the
// reader (nothing invented, everything unusable dropped), the stash's
// read-don't-clear behaviour, and the two copy builders byte for byte.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CALC_PREFILL_KEY, CALC_PREFILL_TTL_MS, CALC_PEOPLE_MAX,
  parseCalcPrefill, prefillFromSearch, stashCalcPrefill, stashCalcPrefillFromSearch,
  readCalcPrefill, clearCalcPrefill, calcPrefillBannerText, calcPrefillTripName, calcPartyLimitText,
  type CalcPrefill,
} from '../src/lib/calcPrefill'
import { CREW_MAX } from '../src/lib/crew'
import { sanitizeCreateMeta } from '../src/lib/createEvents'
import { readFileSync } from 'node:fs'

const NOW = Date.parse('2026-11-25T10:00:00Z')

/** The documented CTA, verbatim — the byte-for-byte contract with the
 *  calculator pages. */
const CALC_QUERY = '?ref=calculator&calc=goa&dest=Goa&days=4&people=4&mode=train&stay=comfort&budget=18400'

const row = (over: Partial<CalcPrefill> = {}): CalcPrefill => ({
  v: 1, at: NOW, calc: 'goa', dest: 'Goa', days: 4, people: 4, peopleOverLimit: null,
  mode: 'train', stay: 'comfort', budget: 18400, ...over,
})

/** A stand-in sessionStorage that survives for one test only. */
function installStorage() {
  const store = new Map<string, string>()
  const shim = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  }
  vi.stubGlobal('sessionStorage', shim)
  return store
}

describe('prefillFromSearch — the calculator’s own query', () => {
  it('round-trips the documented CTA into the exact field values', () => {
    expect(prefillFromSearch(CALC_QUERY, NOW)).toEqual({
      v: 1, at: NOW, calc: 'goa', dest: 'Goa', days: 4, people: 4, peopleOverLimit: null,
      mode: 'train', stay: 'comfort', budget: 18400,
    })
  })

  it('needs the `calculator` ref — any other query is somebody else’s', () => {
    expect(prefillFromSearch('?ref=copy&calc=goa&dest=Goa', NOW)).toBeNull()
    expect(prefillFromSearch('?calc=goa&dest=Goa', NOW)).toBeNull()
    expect(prefillFromSearch('?ref=Calculator', NOW)).toBeNull()
    expect(prefillFromSearch('', NOW)).toBeNull()
  })

  it('tolerates a slice with the hash still attached', () => {
    const p = prefillFromSearch(`${CALC_QUERY}#/new`, NOW)
    expect(p?.calc).toBe('goa')
    expect(p?.days).toBe(4)
    expect(p?.budget).toBe(18400)
  })

  it.each([
    ['an unknown mode', 'mode', 'teleport'],
    ['an unknown stay tier', 'stay', 'hostel'],
    ['an unknown slug', 'calc', 'andaman'],
    ['a fractional day count', 'days', '4.5'],
    ['zero days', 'days', '0'],
    ['days past the band', 'days', '91'],
    ['zero people', 'people', '0'],
    ['a party past the calculator ceiling', 'people', String(CALC_PEOPLE_MAX + 1)],
    ['a non-numeric budget', 'budget', 'a-lot'],
    ['a negative budget', 'budget', '-100'],
    ['a blank destination', 'dest', '   '],
  ])('drops %s to null and keeps the rest of the row', (_label, field, value) => {
    const params = new URLSearchParams(CALC_QUERY)
    params.set(field, value)
    const p = prefillFromSearch(`?${params.toString()}`, NOW)
    expect(p, 'the row still parses').not.toBeNull()
    expect(p![field as keyof CalcPrefill]).toBeNull()
    // The neighbours survive: a bad field is never a bad row.
    if (field !== 'calc') expect(p!.calc).toBe('goa')
    if (field !== 'days') expect(p!.days).toBe(4)
    if (field !== 'people') expect(p!.people).toBe(4)
    if (field !== 'budget') expect(p!.budget).toBe(18400)
  })

  it('accepts a missing calc slug — the row exists, the slug is null', () => {
    const p = prefillFromSearch('?ref=calculator&dest=Goa&days=3', NOW)
    expect(p?.calc).toBeNull()
    expect(p?.dest).toBe('Goa')
  })

  it('accepts an empty query under the right ref without inventing values', () => {
    expect(prefillFromSearch('?ref=calculator', NOW)).toEqual({
      v: 1, at: NOW, calc: null, dest: null, days: null, people: null, peopleOverLimit: null,
      mode: null, stay: null, budget: null,
    })
  })
})

describe('the party size — the trip limit, and a stated count above it', () => {
  const withPeople = (n: string) => prefillFromSearch(`?ref=calculator&dest=Goa&people=${n}`, NOW)

  it.each([1, 21, 25, CREW_MAX])('takes a party of %i into the form', n => {
    const p = withPeople(String(n))
    expect(p?.people).toBe(n)
    expect(p?.peopleOverLimit).toBeNull()
  })

  it.each([CREW_MAX + 1, CALC_PEOPLE_MAX])('reports a stated party of %i as over the trip limit, and never applies it', n => {
    const p = withPeople(String(n))
    expect(p?.people).toBeNull()
    expect(p?.peopleOverLimit).toBe(n)
  })

  it.each(['0', '-3', 'many', '4.5', '', String(CALC_PEOPLE_MAX + 1)])('drops the party %j from both fields', raw => {
    const p = withPeople(raw)
    expect(p?.people).toBeNull()
    expect(p?.peopleOverLimit).toBeNull()
  })

  it('keeps a stored over-limit party through the stash round trip', () => {
    const stored = JSON.stringify(row({ people: null, peopleOverLimit: 35 }))
    const p = parseCalcPrefill(stored, NOW)
    expect(p?.people).toBeNull()
    expect(p?.peopleOverLimit).toBe(35)
  })

  it('says the stated count and the limit, and says nothing when the party fits', () => {
    expect(calcPartyLimitText(row({ people: null, peopleOverLimit: 35 }))).toBe(
      `Your estimate was for 35 people. A trip holds up to ${CREW_MAX} people, so set the party size yourself.`,
    )
    expect(calcPartyLimitText(row())).toBeNull()
  })

  it('names the stated count in the sign-up banner, because that is the estimate the visitor priced', () => {
    expect(calcPrefillBannerText(row({ people: null, peopleOverLimit: 35 }))).toBe(
      'Your 4-day Goa estimate for 35 people is ready. Sign up free to open your group plan.',
    )
  })

  it('the calculator ceiling is the calculators own MAX_PEOPLE', () => {
    const engine = readFileSync(new URL('../calculators/engine.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    const declared = /^const MAX_PEOPLE = (\d+);?$/m.exec(engine)
    expect(declared, 'MAX_PEOPLE is declared in calculators/engine.mjs').not.toBeNull()
    expect(CALC_PEOPLE_MAX).toBe(Number(declared![1]))
  })
})

describe('parseCalcPrefill — the stashed row', () => {
  it('accepts a fresh row and normalises it', () => {
    const p = parseCalcPrefill(JSON.stringify(row()), NOW + 1000)
    expect(p).toEqual(row())
  })

  it('drops an unusable field instead of rejecting the row', () => {
    const p = parseCalcPrefill(JSON.stringify(row({ mode: 'hovercraft' as never, stay: 'sofa' as never })), NOW)
    expect(p).not.toBeNull()
    expect(p!.mode).toBeNull()
    expect(p!.stay).toBeNull()
    expect(p!.dest).toBe('Goa')
  })

  it.each([
    ['expired (older than the TTL)', JSON.stringify(row({ at: NOW - CALC_PREFILL_TTL_MS - 1 }))],
    ['missing its stamp', JSON.stringify({ v: 1, calc: 'goa' })],
    ['a non-finite stamp', JSON.stringify({ v: 1, at: 'yesterday', calc: 'goa' })],
    ['the wrong version', JSON.stringify({ ...row(), v: 2 })],
    ['junk JSON', '{not json'],
    ['null', null],
    ['an empty string', ''],
  ])('rejects %s', (_label, raw) => {
    expect(parseCalcPrefill(raw, NOW)).toBeNull()
  })

  it('rejects a stamp from the future beyond the skew tolerance', () => {
    expect(parseCalcPrefill(JSON.stringify(row({ at: NOW + 61_000 })), NOW)).toBeNull()
    // A minute of drift is a fast phone, not a forged row.
    expect(parseCalcPrefill(JSON.stringify(row({ at: NOW + 30_000 })), NOW)).not.toBeNull()
  })

  it('accepts a row right at the TTL edge and one stamp older is dead', () => {
    expect(parseCalcPrefill(JSON.stringify(row({ at: NOW - CALC_PREFILL_TTL_MS })), NOW)).not.toBeNull()
    expect(parseCalcPrefill(JSON.stringify(row({ at: NOW - CALC_PREFILL_TTL_MS - 1 })), NOW)).toBeNull()
  })
})

describe('the copy builders', () => {
  it('names the days, the people and the destination when it has all three', () => {
    expect(calcPrefillBannerText(row())).toBe(
      'Your 4-day Goa estimate for 4 people is ready. Sign up free to open your group plan.',
    )
  })

  it('drops the day count when the row has none', () => {
    expect(calcPrefillBannerText(row({ days: null }))).toBe(
      'Your Goa estimate for 4 people is ready. Sign up free to open your group plan.',
    )
  })

  it('says just the destination when that is all it knows', () => {
    expect(calcPrefillBannerText(row({ days: null, people: null }))).toBe(
      'Your Goa estimate is ready. Sign up free to open your group plan.',
    )
  })

  it('gets the singular right', () => {
    expect(calcPrefillBannerText(row({ days: 1, people: 1 }))).toBe(
      'Your 1-day Goa estimate for 1 person is ready. Sign up free to open your group plan.',
    )
  })

  it('says nothing when there is no destination to name', () => {
    expect(calcPrefillBannerText(row({ dest: null }))).toBeNull()
  })

  it('names the trip the way the form does', () => {
    expect(calcPrefillTripName(row())).toBe('4-day Goa trip')
    expect(calcPrefillTripName(row({ days: null }))).toBe('Goa trip')
    expect(calcPrefillTripName(row({ dest: null }))).toBe('')
  })
})

describe('the stash — stored once, read twice', () => {
  beforeEach(() => { installStorage() })
  afterEach(() => vi.unstubAllGlobals())

  it('writes the row under its own key', () => {
    stashCalcPrefill(row())
    expect(sessionStorage.getItem(CALC_PREFILL_KEY)).toContain('"calc":"goa"')
  })

  it('stashes from a query and reports whether it did', () => {
    expect(stashCalcPrefillFromSearch(CALC_QUERY, NOW)).toBe(true)
    expect(readCalcPrefill(NOW + 1)?.dest).toBe('Goa')
    expect(stashCalcPrefillFromSearch('?ref=copy', NOW)).toBe(false)
  })

  it('is idempotent — the same query twice leaves one identical row', () => {
    stashCalcPrefillFromSearch(CALC_QUERY, NOW)
    stashCalcPrefillFromSearch(CALC_QUERY, NOW)
    expect(readCalcPrefill(NOW)?.budget).toBe(18400)
  })

  it('read does NOT clear — Auth reads it, then CreateTrip reads it again', () => {
    stashCalcPrefill(row())
    expect(readCalcPrefill(NOW)?.calc).toBe('goa')
    expect(readCalcPrefill(NOW)?.calc).toBe('goa')
  })

  it('clear removes it', () => {
    stashCalcPrefill(row())
    clearCalcPrefill()
    expect(readCalcPrefill(NOW)).toBeNull()
  })

  it('reads nothing after the TTL, with the clock injected', () => {
    stashCalcPrefill(row({ at: NOW }))
    expect(readCalcPrefill(NOW + CALC_PREFILL_TTL_MS + 1)).toBeNull()
  })

  it('degrades silently when storage is missing or throws', () => {
    vi.unstubAllGlobals()
    expect(readCalcPrefill(NOW)).toBeNull()
    expect(() => stashCalcPrefill(row())).not.toThrow()
    expect(() => clearCalcPrefill()).not.toThrow()
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => { throw new Error('SecurityError') },
      removeItem: () => { throw new Error('SecurityError') },
    })
    expect(readCalcPrefill(NOW)).toBeNull()
    expect(() => stashCalcPrefill(row())).not.toThrow()
    expect(() => clearCalcPrefill()).not.toThrow()
  })
})

describe('the create funnel records which calculator priced the trip', () => {
  it('keeps a calculator slug the platform publishes', () => {
    const meta = sanitizeCreateMeta('submitted', { days: 4, travellers: 4, mode: 'train', calcSlug: 'goa' })
    expect(meta).toEqual({ days: 4, travellers: 4, mode: 'train', calcSlug: 'goa' })
  })

  it('drops a slug that is not one of ours, and keeps the rest of the row', () => {
    const meta = sanitizeCreateMeta('submitted', { days: 4, travellers: 4, mode: 'train', calcSlug: 'not-a-page' })
    expect(meta).toEqual({ days: 4, travellers: 4, mode: 'train' })
  })

  it('leaves a plain submit exactly as it was', () => {
    expect(sanitizeCreateMeta('submitted', { days: 2, travellers: 2, mode: 'car' })).toEqual({ days: 2, travellers: 2, mode: 'car' })
  })
})

describe('the create page consumes the hand-off once', () => {
  const create = readFileSync(new URL('../src/pages/CreateTrip.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  it('reads the arriving query before the stashed row', () => {
    // A signed-in visitor never passes the signed-out gate in App.tsx, so the
    // query is still on the address bar when this page mounts. Reading only
    // sessionStorage lost every choice for the visitors most likely to convert.
    expect(create).toMatch(/prefillFromSearch\(search\)\s*\?\?\s*readCalcPrefill\(\)/)
  })

  it('clears the row once it has been applied', () => {
    // Without this the row outlived its arrival: a plain /new in the same tab
    // inside the TTL inherited a stranger's destination and budget, and the
    // submit was attributed to a calculator the visitor never used.
    expect(create).toContain('clearCalcPrefill()')
    const afterRead = create.slice(create.indexOf('const p = prefillFromSearch'), create.indexOf('calcSlugRef.current = p.calc'))
    expect(afterRead).toContain('clearCalcPrefill()')
  })
})
