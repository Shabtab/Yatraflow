/**
 * #420, slice 5 — the search → slot filing rules.
 *
 * Four rules were closures in MapTab, so none of them could be tested without
 * rendering a 2,723-line page: which slots a found place may be filed into, what
 * a manual candidate is, how manual picks merge with the engine's, and when a
 * filing is refused. Two of them have already been wrong once in the wild — the
 * `slice(0, 2)` that always dropped dinner, and a refusal that said nothing.
 *
 * The last describe block pins the WIRING by reading the page's source, the same
 * discipline `tests/map-sight-rows.test.ts` uses: a rule that drifts back into the
 * page, or a call that stops going through this module, has to fail something.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  filingOptionsFor,
  manualCandidateFor,
  mergeSlotCandidates,
  slotFileRefusal,
  slotKindsForCategory,
} from '../src/pages/trip/map/slotFiling'
import type { PlaceHit } from '../src/lib/providers/hits'
import type { DaySlotKind, SlotState } from '../src/lib/daySlots'

const mapTab = readFileSync(new URL('../src/pages/trip/MapTab.tsx', import.meta.url), 'utf8')
const module_ = readFileSync(new URL('../src/pages/trip/map/slotFiling.ts', import.meta.url), 'utf8')
// #420 slice 17: the filing writer lives in the hook with its refusal.
const slotHook = readFileSync(new URL('../src/pages/trip/map/useSlotSearch.ts', import.meta.url), 'utf8')

const hit = (id: string, over: Partial<PlaceHit> = {}): PlaceHit =>
  ({ id, name: `Place ${id}`, latitude: 10, longitude: 76, kind: 'poi', ...over }) as PlaceHit

type OfferedSlot = { key: string; label: string; kind: DaySlotKind; state: SlotState }
const slot = (key: string, label: string, kind: DaySlotKind, state: SlotState = 'empty'): OfferedSlot =>
  ({ key, label, kind, state })

describe('slotKindsForCategory — which kinds can hold a found place', () => {
  it('files the three meal words as one kind', () => {
    // `rest` is what both providers tag a POPULATED PLACE with, and
    // fitScoreForPurpose treats a populated place as meal-capable — so a town
    // found by search files as a meal, which is right.
    expect(slotKindsForCategory('food')).toEqual(['meal'])
    expect(slotKindsForCategory('cafe')).toEqual(['meal'])
    expect(slotKindsForCategory('rest')).toEqual(['meal'])
  })

  it('maps the two other fillable categories', () => {
    expect(slotKindsForCategory('transport-hub')).toEqual(['fuel'])
    expect(slotKindsForCategory('hotel')).toEqual(['overnight'])
  })

  it('answers empty for everything with no slot, and for a missing category', () => {
    // The honest empty answer means the caller offers no filing action at all,
    // rather than a slot that cannot hold the place.
    for (const cat of ['viewpoint', 'museum', undefined, null, '', 42]) {
      expect(slotKindsForCategory(cat), String(cat)).toEqual([])
    }
  })
})

describe('filingOptionsFor — the empty slots this hit may be filed into', () => {
  it('offers only empty slots of a matching kind, in rail order, with its own copy', () => {
    const opts = filingOptionsFor(hit('a', { category: 'food' }), [
      slot('lunch', 'Lunch', 'meal'),
      slot('fuel-1', 'Fuel', 'fuel'),
      slot('dinner', 'Dinner', 'meal', 'filled'),
      slot('breakfast', 'Breakfast', 'meal'),
    ])
    expect(opts).toEqual([
      { key: 'lunch', label: 'Add as Lunch', noun: 'lunch' },
      { key: 'breakfast', label: 'Add as Breakfast', noun: 'breakfast' },
    ])
  })

  it('does NOT cap the list — dinner used to be the casualty', () => {
    // The rule is "every empty slot that can hold it". The old `slice(0, 2)`
    // dropped the LAST meal, which is dinner: the one most often away from the
    // hotel and the one most worth sourcing.
    const opts = filingOptionsFor(hit('a', { category: 'food' }), [
      slot('breakfast', 'Breakfast', 'meal'),
      slot('lunch', 'Lunch', 'meal'),
      slot('dinner', 'Dinner', 'meal'),
    ])
    expect(opts.map(o => o.key)).toEqual(['breakfast', 'lunch', 'dinner'])
  })

  it('offers nothing for an unfillable category, even with empty slots aplenty', () => {
    expect(filingOptionsFor(hit('a', { category: 'viewpoint' }), [slot('lunch', 'Lunch', 'meal')])).toEqual([])
  })

  it('offers nothing when the day has no slot of that kind', () => {
    expect(filingOptionsFor(hit('a', { category: 'hotel' }), [slot('lunch', 'Lunch', 'meal')])).toEqual([])
  })
})

describe('manualCandidateFor — the user\'s own pick, with nothing invented', () => {
  const sharePct = (detourMin: number, budgetMin: number) => Math.round((detourMin / budgetMin) * 100)

  it('leaves every unknowable field null and says where it came from', () => {
    const c = manualCandidateFor({ hit: hit('a'), detourMin: 18, detourKm: 9, budgetMin: 60, sharePct })
    expect(c.arriveMin).toBeNull()
    expect(c.arriveLabel).toBeNull()
    expect(c.posKm).toBeNull()
    expect(c.inWindow).toBe(false)
    expect(c.score).toBe(Number.MAX_SAFE_INTEGER)
    expect(c.reason).toBe('added from this slot’s search')
  })

  it('reads an unknown detour as the whole budget, never as free', () => {
    // An unmeasured candidate has no evidence that it is cheap, so it cannot
    // present itself as a small share of the day's detour budget.
    const c = manualCandidateFor({ hit: hit('a'), detourMin: null, detourKm: null, budgetMin: 60, sharePct })
    expect(c.budgetSharePct).toBe(100)
  })

  it('asks the injected share for a measured detour', () => {
    const c = manualCandidateFor({ hit: hit('a'), detourMin: 15, detourKm: 7, budgetMin: 60, sharePct })
    expect(c.budgetSharePct).toBe(25)
    expect(c.detourMin).toBe(15)
    expect(c.detourKm).toBe(7)
  })
})

describe('mergeSlotCandidates — manual picks first, then the engine minus their ids', () => {
  const cand = (id: string) => ({ hit: hit(id) })

  it('keeps the engine order for the rest and never lists a place twice', () => {
    const merged = mergeSlotCandidates([cand('mine')], [cand('e1'), cand('mine'), cand('e2')])
    expect(merged.map(c => c.hit.id)).toEqual(['mine', 'e1', 'e2'])
  })

  it('returns the engine list untouched when nothing was picked by hand', () => {
    const engine = [cand('e1'), cand('e2')]
    expect(mergeSlotCandidates([], engine).map(c => c.hit.id)).toEqual(['e1', 'e2'])
    expect(mergeSlotCandidates([], engine)).toEqual(engine)
  })

  it('matches ids by value, so a numeric id and its string form are one place', () => {
    const merged = mergeSlotCandidates([{ hit: hit('7') }], [{ hit: hit('7') }, { hit: hit('8') }])
    expect(merged).toHaveLength(2)
  })
})

describe('slotFileRefusal — a refusal always has a reason', () => {
  const isAdded = (h: PlaceHit) => h.id === 'owned'
  const base = { slotLabel: 'Lunch', isAdded }

  it('refuses a place already on the plan, and names it', () => {
    const r = slotFileRefusal({ ...base, hit: hit('owned', { name: 'Kayees' }), manual: [], candidates: [] })
    expect(r?.kind).toBe('added')
    expect(r?.message).toBe('"Kayees" is already on the plan or was dismissed.')
  })

  it('refuses a place already filed by hand for this slot, and names the slot in lower case', () => {
    const r = slotFileRefusal({ ...base, hit: hit('m1', { name: 'Paragon' }), manual: [hit('m1')], candidates: [] })
    expect(r?.kind).toBe('candidate')
    expect(r?.message).toBe('"Paragon" is already a candidate for the lunch slot.')
  })

  it('refuses a place the engine already proposes for this slot', () => {
    const r = slotFileRefusal({
      ...base, slotLabel: 'Stay', hit: hit('e1', { name: 'Homestay' }),
      manual: [], candidates: [{ hit: hit('e1') }],
    })
    expect(r?.kind).toBe('candidate')
    expect(r?.message).toBe('"Homestay" is already a candidate for the stay slot.')
  })

  it('allows the filing when nothing stands in the way', () => {
    expect(slotFileRefusal({ ...base, hit: hit('fresh'), manual: [hit('other')], candidates: [{ hit: hit('else') }] })).toBeNull()
  })

  it('checks ownership before candidacy, so the stronger reason wins', () => {
    const r = slotFileRefusal({ ...base, hit: hit('owned'), manual: [hit('owned')], candidates: [] })
    expect(r?.kind).toBe('added')
  })
})

describe('MapTab goes THROUGH the module (wiring is part of the contract)', () => {
  it('imports the five rules from ./map/slotFiling', () => {
    // #420 slice 17: the refusal moved with its caller. The page keeps the
    // three render-side rules. The hook carries the fourth.
    expect(mapTab).toMatch(/from '\.\/map\/slotFiling'/)
    for (const name of ['filingOptionsFor', 'manualCandidateFor', 'mergeSlotCandidates']) {
      expect(mapTab, name).toContain(name)
    }
    expect(mapTab).not.toContain('slotFileRefusal')
    expect(slotHook).toMatch(/from '\.\/slotFiling'/)
    expect(slotHook).toContain('slotFileRefusal')
  })

  it('no longer carries the rules inline', () => {
    // The CATEGORY mapping and the refusal COPY must exist in exactly one place.
    // (`arcs.slice(0, 2)` in the page is unrelated: it caps the story-arc list,
    // not the filing options — so the assertion names the rule, not the idiom.)
    expect(mapTab).not.toContain('kinds.includes(')
    expect(mapTab).not.toContain('is already a candidate for the')
    expect(mapTab).not.toContain('is already on the plan or was dismissed')
    expect(module_).toContain('is already a candidate for the')
    expect(module_).toContain('is already on the plan or was dismissed')
  })

  it('carries no cap in the filing rule — the slice that dropped dinner', () => {
    expect(module_).not.toMatch(/\.slice\(0,\s*\d/)
  })

  it('asks the module for the offered slots rather than re-deriving them', () => {
    expect(mapTab).toMatch(/filingOptionsFor\([^)]*activeDaySlots\)/)
  })
})
