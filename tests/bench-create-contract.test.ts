// ============ Bench → Create: the hand-off contract ============
// Two silent-breakage paths, pinned (#398). (1) The bench CTA navigated by a
// hardcoded hash: it once pointed at `#/create`, which no route handles, so the
// router's `default:` dropped the visitor on the landing page, the CTA looked
// alive, and the prefill the bench had just stashed was never read. (2) The
// stash is a key pair across two files whose shape only existed in prose — a
// rename on either side loses the hand-off with no error anywhere. Both are
// tested here because both fail silently: nothing throws, the trip form just
// comes up empty.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { CREATE_SEGMENT, CREATE_PATH, CREATE_ROUTE } from '../src/lib/routes'
import {
  BENCH_DEFAULTS, BENCH_PREFILL_KEY, computeBenchBill, parseBenchPrefill,
  readBenchPrefill, stashBenchPrefill, type BenchInputs,
} from '../src/lib/planBench'

/** The page/component source, for the markup-and-callsite half of the contract. */
function source(rel: string): string {
  return readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')
}

/** sessionStorage does not exist in the node env, and the stash wrappers degrade
 *  to no-ops without it — so the storage round-trip needs a stand-in. */
class MemoryStorage {
  private map = new Map<string, string>()
  get length() { return this.map.size }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null }
  setItem(k: string, v: string) { this.map.set(k, String(v)) }
  removeItem(k: string) { this.map.delete(k) }
  clear() { this.map.clear() }
  key(i: number) { return [...this.map.keys()][i] ?? null }
}

beforeEach(() => { vi.stubGlobal('sessionStorage', new MemoryStorage()) })
afterEach(() => { vi.unstubAllGlobals() })

describe('#398 — one route, three forms, no literal', () => {
  it('derives every form from the single segment', () => {
    expect(CREATE_SEGMENT).toBe('new')
    expect(CREATE_PATH).toBe('/' + CREATE_SEGMENT)
    expect(CREATE_ROUTE).toBe('#' + CREATE_PATH)
  })

  it('has the bench CTA and the router reading the same constant', () => {
    expect(source('components/PlanBench.tsx')).toContain('window.location.hash = CREATE_ROUTE')
    expect(source('App.tsx')).toContain('case CREATE_SEGMENT:')
  })

  it('leaves no hardcoded create route in the files that own one', () => {
    // The three call sites that must follow a rename. Comments that merely
    // mention the path are fine — these patterns require quotes.
    for (const rel of ['components/PlanBench.tsx', 'App.tsx', 'pages/Landing.tsx']) {
      const text = source(rel)
      expect(text, `${rel} still spells the hash route out`).not.toMatch(/['"]#\/new['"]/)
      expect(text, `${rel} still spells the path route out`).not.toMatch(/['"]\/new['"]/)
    }
  })
})

describe('#398 — the stash key pair', () => {
  it('is declared once, in the module both ends import', () => {
    const lib = source('lib/planBench.ts')
    expect(lib).toContain(`export const BENCH_PREFILL_KEY = '${BENCH_PREFILL_KEY}'`)
    // The reader page must not know the storage key at all, or renaming it in the
    // lib stops being enough.
    expect(source('pages/CreateTrip.tsx')).toContain('readBenchPrefill')
    expect(source('pages/CreateTrip.tsx')).not.toContain(BENCH_PREFILL_KEY)
  })
})

describe('#398 — the prefill shape', () => {
  const full = {
    travellers: 4, transportMode: 'car' as const, budgetPerPersonInr: 11542,
    travelStyle: 'comfort' as const, stayStyle: 'luxury' as const,
    roundTrip: true, kmPerL: 15, inrPerL: 105,
  }

  it('round-trips the whole shape', () => {
    expect(parseBenchPrefill(JSON.stringify(full))).toEqual(full)
  })

  it('accepts a stash with no stay tier — older sessions predate it', () => {
    const { stayStyle: _dropped, ...older } = full
    expect(parseBenchPrefill(JSON.stringify(older))).toEqual(older)
  })

  it('refuses a stray stay tier rather than indexing rates to undefined', () => {
    expect(parseBenchPrefill(JSON.stringify({ ...full, stayStyle: 'palace' }))).toBeNull()
  })

  it('refuses an unknown mode, non-numeric fields and a missing payload', () => {
    expect(parseBenchPrefill(JSON.stringify({ ...full, transportMode: 'helicopter' }))).toBeNull()
    expect(parseBenchPrefill(JSON.stringify({ ...full, travellers: 'four' }))).toBeNull()
    expect(parseBenchPrefill(JSON.stringify({ ...full, budgetPerPersonInr: null }))).toBeNull()
    expect(parseBenchPrefill(JSON.stringify({ travellers: 4 }))).toBeNull()
  })

  it('returns null for a corrupt or absent stash, and never throws', () => {
    expect(parseBenchPrefill('{not json')).toBeNull()
    expect(parseBenchPrefill('')).toBeNull()
    expect(parseBenchPrefill(null)).toBeNull()
    expect(parseBenchPrefill(undefined)).toBeNull()
  })
})

describe('#398 — the storage round-trip', () => {
  const input: BenchInputs = { ...BENCH_DEFAULTS, crew: 6, mode: 'car', stay: 'luxury', roundTrip: false }

  it('carries crew, mode, tier, budget and round-trip across', () => {
    stashBenchPrefill(computeBenchBill(input), input)
    const got = readBenchPrefill()
    expect(got).not.toBeNull()
    expect(got!.travellers).toBe(6)
    expect(got!.transportMode).toBe('car')
    expect(got!.roundTrip).toBe(false)
    expect(got!.budgetPerPersonInr).toBe(computeBenchBill(input).perHead)
    // The tier itself rides across. Carrying only `travelStyle` once made a
    // Luxury bench run create a trip that billed ₹3,200 instead of ₹8,000.
    expect(got!.stayStyle).toBe('luxury')
    expect(got!.kmPerL).toBe(input.kmPerL)
  })

  it('carries no fuel figures for a mode that does not burn any', () => {
    const bus: BenchInputs = { ...BENCH_DEFAULTS, mode: 'bus' }
    stashBenchPrefill(computeBenchBill(bus), bus)
    const got = readBenchPrefill()
    expect(got!.transportMode).toBe('bus')
    expect(got!.kmPerL).toBeUndefined()
    expect(got!.inrPerL).toBeUndefined()
  })

  it('is read-once — a refresh renders the plain form, not the same prefill', () => {
    stashBenchPrefill(computeBenchBill(input), input)
    expect(readBenchPrefill()).not.toBeNull()
    expect(readBenchPrefill()).toBeNull()
    expect(sessionStorage.getItem(BENCH_PREFILL_KEY)).toBeNull()
  })

  it('clears a corrupt stash instead of blocking every later visit', () => {
    sessionStorage.setItem(BENCH_PREFILL_KEY, '{not json')
    expect(readBenchPrefill()).toBeNull()
    expect(sessionStorage.getItem(BENCH_PREFILL_KEY)).toBeNull()
  })
})
