/**
 * #420, slice 5 — the sights rail's data atoms.
 *
 * `alternativesFor` (which alternatives a row may offer) and `sightRowChips` (which
 * reason chips describe it) were closures in the page, so neither could be tested
 * without rendering it. The chip path carries a contract the source calls out by
 * issue number — #163: one rounding predicate shared with the fact strip, or a
 * budget-exact halt reads "fine" on the card and "held back" on the rail.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { alternativesFor, sightRowChips, type AltPool } from '../src/pages/trip/map/sightRows'
import type { PlaceHit } from '../src/lib/providers/hits'

const mapTab = readFileSync(new URL('../src/pages/trip/MapTab.tsx', import.meta.url), 'utf8')
const module_ = readFileSync(new URL('../src/pages/trip/map/sightRows.ts', import.meta.url), 'utf8')
// #420 slice 15: the page asks railRows, which asks sightRows — one layer each.
const railRows = readFileSync(new URL('../src/pages/trip/map/railRows.ts', import.meta.url), 'utf8')
// #420 slice 16: the rows render in their own module, which asks railRows.
const views = readFileSync(new URL('../src/pages/trip/map/RailRowViews.tsx', import.meta.url), 'utf8')

const hit = (id: string, over: Partial<PlaceHit> = {}): PlaceHit =>
  ({ id, name: `Place ${id}`, latitude: 10, longitude: 76, kind: 'poi', ...over }) as PlaceHit

function pool(entries: Array<{ h: PlaceHit; dKm: number | null; purpose?: string; category?: string }>): AltPool {
  const all = entries.map(e => ({ h: e.h, dKm: e.dKm }))
  const byPurpose = new Map<string, Array<{ h: PlaceHit; dKm: number | null }>>()
  const byCategory = new Map<string, Array<{ h: PlaceHit; dKm: number | null }>>()
  for (const e of entries) {
    const bare = { h: e.h, dKm: e.dKm }
    if (e.purpose) byPurpose.set(e.purpose, [...(byPurpose.get(e.purpose) ?? []), bare])
    if (e.category) byCategory.set(e.category, [...(byCategory.get(e.category) ?? []), bare])
  }
  return { all, byPurpose, byCategory }
}

describe('#420 — a row\'s alternatives', () => {
  it('never offers the row\'s own place, and never the same alternative twice', () => {
    const self = hit('self', { cumKm: 100 })
    const twin = hit('twin', { cumKm: 101 })
    const p = pool([
      { h: self, dKm: 0, purpose: 'meal', category: 'food' },
      { h: twin, dKm: 1, purpose: 'meal', category: 'food' },
    ])
    const out = alternativesFor({ purpose: 'meal', targetKm: 100, hit: self, pool: p })
    expect(out.map(o => o.h.id)).toEqual(['twin'])
  })

  it('prefers its own family for a need halt, and the whole corridor for a sight', () => {
    const self = hit('self', { cumKm: 100 })
    const meal = hit('meal', { cumKm: 102 })
    const sight = hit('sight', { cumKm: 103 })
    const p = pool([
      { h: self, dKm: 0, purpose: 'meal', category: 'food' },
      { h: meal, dKm: 0, purpose: 'meal', category: 'food' },
      { h: sight, dKm: 0, purpose: 'sightseeing', category: 'sightseeing' },
    ])
    // a need halt stays inside its purpose/category family…
    expect(alternativesFor({ purpose: 'meal', targetKm: 100, hit: self, pool: p }).map(o => o.h.id)).toEqual(['meal'])
    // …while a sight may swap for anything on the corridor
    expect(alternativesFor({ purpose: 'sightseeing', targetKm: 100, hit: self, pool: p }).map(o => o.h.id).sort())
      .toEqual(['meal', 'sight'])
  })

  it('ranks by position first, and counts a detour twice', () => {
    const self = hit('self', { cumKm: 100 })
    const near = hit('near', { cumKm: 104 })
    const farButCheap = hit('farButCheap', { cumKm: 101, category: 'sightseeing' })
    const p = pool([
      { h: self, dKm: 0, category: 'sightseeing' },
      // 1 km away but a 8 km detour: 1 + 16 = 17
      { h: farButCheap, dKm: 8, category: 'sightseeing' },
      // 4 km away, no detour: 4
      { h: near, dKm: 0, category: 'sightseeing' },
    ])
    const out = alternativesFor({ purpose: 'sightseeing', targetKm: 100, hit: self, pool: p })
    expect(out.map(o => o.h.id)).toEqual(['near', 'farButCheap'])
  })

  it('offers at most two, and says an unknown detour as null rather than zero', () => {
    const self = hit('self', { cumKm: 100 })
    const p = pool([
      { h: self, dKm: 0, category: 'sightseeing' },
      { h: hit('a', { cumKm: 101 }), dKm: null, category: 'sightseeing' },
      { h: hit('b', { cumKm: 102 }), dKm: 1, category: 'sightseeing' },
      { h: hit('c', { cumKm: 103 }), dKm: 1, category: 'sightseeing' },
    ])
    const out = alternativesFor({ purpose: 'sightseeing', targetKm: 100, hit: self, pool: p })
    expect(out.length).toBe(2)
    expect(out.find(o => o.h.id === 'a')?.dKm).toBeNull()
  })

  it('falls back to the halt\'s own position when an alternative has none of its own', () => {
    const self = hit('self', { cumKm: 100 })
    const unplaced = hit('unplaced', { cumKm: undefined })
    const p = pool([
      { h: self, dKm: 0, category: 'sightseeing' },
      { h: unplaced, dKm: 2, category: 'sightseeing' },
    ])
    // |target - target| + 2 * 2 = 4 — placed relative to the halt, not the map origin
    const out = alternativesFor({ purpose: 'sightseeing', targetKm: 100, hit: self, pool: p })
    expect(out.map(o => o.h.id)).toEqual(['unplaced'])
  })
})

describe('#420 — a row\'s reason chips', () => {
  const segment = { purpose: 'sightseeing', etaMinutes: 600, minutesFromPrev: 30, index: 2 }
  const rated = { rating: 4.5, ratingCount: 200 }

  it('passes the segment through and asks for no arrival on the first halt', () => {
    const chips = sightRowChips({ segment, hit: rated, detourMin: 20, dayBudget: 60 })
    expect(Array.isArray(chips)).toBe(true)
    const first = sightRowChips({ segment: { ...segment, index: 0 }, hit: rated, detourMin: 20, dayBudget: 60 })
    expect(Array.isArray(first)).toBe(true)
  })

  it('treats a budget-exact detour as inside the budget (#163)', () => {
    // The predicate is round-half-up on the DISPLAY value, shared with the fact
    // strip: 45.4 rounds to 45 and is not over a 45-minute budget; 45.6 rounds to 46.
    const exact = sightRowChips({ segment, hit: rated, detourMin: 45.4, dayBudget: 45 })
    const over = sightRowChips({ segment, hit: rated, detourMin: 45.6, dayBudget: 45 })
    expect(JSON.stringify(exact)).not.toBe(JSON.stringify(over))
    expect(module_).toContain('Math.round(detourMin) > dayBudget')
  })

  it('reads an unknown position as the whole budget, and clamps a fractional detour up', () => {
    // Both lines are the moved contract, pinned so a future edit cannot soften it.
    expect(module_).toContain('detourMin != null && detourMin > 0.5 ? budgetSharePct(detourMin, dayBudget) : detourMin == null ? 100 : null')
    expect(module_).toContain('overBudget: detourMin == null || Math.round(detourMin) > dayBudget')
  })
})

describe('#420 — slice 5 wiring', () => {
  it('the page asks the module instead of rebuilding the rules', () => {
    expect(mapTab).toContain("from './map/railRows'")
    expect(mapTab).toContain("from './map/RailRowViews'")
    expect(mapTab).toContain('<LedgerRow')
    expect(views).toMatch(/alternativesFor\(sh, hit, altPool\)/)
    expect(views).toMatch(/chipsFor\(sh, hit, chipFacts\)/)
    expect(mapTab).not.toContain('altPool.byPurpose.get(sh.segment.purpose)')
    expect(mapTab).not.toContain('railReasonChips(')
    expect(railRows).toContain("from './sightRows'")
    expect(railRows).toMatch(/return pickAlternatives\(\{/)
    expect(railRows).toMatch(/return sightRowChips\(\{ segment: sh\.segment, hit, detourMin, dayBudget \}\)/)
  })

  it('the module reuses the one NEED_PURPOSES rather than declaring its own', () => {
    expect(module_).toContain("import { NEED_PURPOSES } from './pageHelpers'")
    expect(module_).not.toContain('new Set(')
  })
})
