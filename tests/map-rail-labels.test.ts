/**
 * #420, slice 4 — the detour sentence, once.
 *
 * The corridor rows and the map's empty-part pins assembled the same three bits
 * separately ("arrive 11:24 · +26 min · 58% of the day's detour budget"). These tests
 * pin the shared helper, both callers, and the per-day budget cache that made the
 * corridor version cheap.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { detourBits, hitCostLabels, slotPinsFor } from '../src/pages/trip/map/railLabels'
import type { DaySlot } from '../src/lib/daySlots'

const mapTab = readFileSync(new URL('../src/pages/trip/MapTab.tsx', import.meta.url), 'utf8')
// #420 slice 13: the cost assembly lives in the rail-content hook.
const contentHook = readFileSync(new URL('../src/pages/trip/map/useRailContent.ts', import.meta.url), 'utf8')
// #420 slice 14: the slot pins live in the day-slots hook with their input.
const slotsHook = readFileSync(new URL('../src/pages/trip/map/useDaySlots.ts', import.meta.url), 'utf8')

describe('#420 — the three bits, in the order every surface prints them', () => {
  it('says an unmeasured position instead of a number', () => {
    expect(detourBits({ detourMin: null })).toEqual(['position unknown'])
  })

  it('calls a fraction of a minute on route, and rounds the rest up to a minute', () => {
    expect(detourBits({ detourMin: 0.5 })).toEqual(['on route'])
    expect(detourBits({ detourMin: 0.6 })).toEqual(['+1 min'])
    expect(detourBits({ detourMin: 26.4 })).toEqual(['+26 min'])
  })

  it('leads with the arrival, then the cost, then the budget share', () => {
    expect(detourBits({ arriveLabel: '11:24', detourMin: 26, budgetSharePct: 58 }))
      .toEqual(['arrive 11:24', '+26 min', "58% of the day's detour budget"])
  })

  it('prints no share when there is nothing to say', () => {
    expect(detourBits({ detourMin: 26, budgetSharePct: 0 })).toEqual(['+26 min'])
    expect(detourBits({ detourMin: 26, budgetSharePct: null })).toEqual(['+26 min'])
    expect(detourBits({ detourMin: 26 })).toEqual(['+26 min'])
  })
})

describe('#420 — the corridor cost chip', () => {
  const dayForKm = () => 0

  it('assembles the sentence from the segment clock and the measured detour', () => {
    const labels = hitCostLabels({
      hits: [{ id: 'a', cumKm: 73, detourMin: 26, etaMinutes: 658 }],
      dayForKm,
      detourBudgetMin: () => 45,
    })
    // 658 + 26 = 684 minutes = 11:24
    expect(labels.a).toBe("arrive 11:24 · +26 min · 58% of the day's detour budget")
  })

  it('drops the share when the day has no budget to spend', () => {
    const labels = hitCostLabels({
      hits: [{ id: 'a', cumKm: 10, detourMin: 20, etaMinutes: 600 }],
      dayForKm,
      detourBudgetMin: () => 0,
    })
    expect(labels.a).toBe('arrive 10:20 · +20 min')
  })

  it('reports an unknown position without inventing an arrival', () => {
    const labels = hitCostLabels({
      hits: [{ id: 'a', cumKm: null, detourMin: null, etaMinutes: 600 }],
      dayForKm,
      detourBudgetMin: () => 45,
    })
    expect(labels.a).toBe('position unknown')
  })

  it('looks a day\'s budget up once, however many hits fall on that day', () => {
    // The cache that made the chip cheap: the lookup is per DAY, not per hit.
    let calls = 0
    const labels = hitCostLabels({
      hits: [
        { id: 'a', cumKm: 10, detourMin: 20, etaMinutes: null },
        { id: 'b', cumKm: 20, detourMin: 20, etaMinutes: null },
        { id: 'c', cumKm: 30, detourMin: 20, etaMinutes: null },
        { id: 'd', cumKm: 90, detourMin: 20, etaMinutes: null },
      ],
      dayForKm: km => (km != null && km > 50 ? 1 : 0),
      detourBudgetMin: () => { calls += 1; return 45 },
    })
    expect(calls).toBe(2)
    expect(Object.keys(labels).sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('#420 — the empty-part pin says the same thing', () => {
  const slot = (over: Partial<DaySlot>): DaySlot => ({
    key: 'day1:lunch', kind: 'meal', label: 'Lunch', state: 'empty',
    windowMin: null, windowLabel: null, segment: null, candidates: [],
    ...over,
  } as unknown as DaySlot)

  it('pins only the empty slots that have somewhere to stand', () => {
    const pins = slotPinsFor([
      slot({ key: 'day1:lunch', candidates: [{ hit: { id: 'x', name: 'Cafe' }, arriveLabel: '13:00', detourMin: 12, budgetSharePct: 25 }] as never }),
      slot({ key: 'day1:dinner', candidates: [] }),
      slot({ key: 'day1:breakfast', state: 'filled' }),
    ])
    expect(pins.map(p => p.key)).toEqual(['day1:lunch'])
    expect(pins[0].name).toBe('Cafe')
    expect(pins[0].meta).toBe("arrive 13:00 · +12 min · 25% of the day's detour budget")
  })

  it('uses the top candidate, and says an unknown position', () => {
    const pins = slotPinsFor([
      slot({ candidates: [
        { hit: { id: 'x', name: 'First' }, arriveLabel: null, detourMin: null, budgetSharePct: 0 },
        { hit: { id: 'y', name: 'Second' }, arriveLabel: '13:00', detourMin: 5, budgetSharePct: 10 },
      ] as never }),
    ])
    expect(pins[0].name).toBe('First')
    expect(pins[0].meta).toBe('position unknown')
  })
})

describe('#420 — slice 4 wiring', () => {
  it('the shared sentence has one home now, and the page is not it', () => {
    expect(mapTab).not.toContain("from './map/railLabels'")
    // The chip and the pin both printed THIS sentence; it now comes from the module.
    expect(mapTab).not.toContain("of the day's detour budget")
    expect(contentHook).toMatch(/const hitCosts = useMemo\(\(\) => hitCostLabels\(\{/)
    expect(slotsHook).toMatch(/const slotPins = useMemo\(\(\) => slotPinsFor\(activeDaySlots\)/)
    expect(mapTab).toContain('} = useDaySlots(')
  })

  it('leaves the two denser variants alone, and pins how many there are', () => {
    // The page prints detour vocabulary in FOUR places, and only two of them were
    // the same sentence (the corridor chip and the empty-part pin — now shared here).
    // The other two are deliberately different, and folding them in would change
    // user-visible copy, which a refactor must not do:
    //   · the see-rail row says "+26 min detour" and carries its own chips;
    //   · the day-slot candidate row is shorter ("% of day detours") and interleaves
    //     the opening hours between the bits.
    // This count is what stops a FIFTH copy appearing unnoticed. If a future change
    // makes one of these identical to the shared sentence, move it in and lower the
    // number rather than relaxing the assertion.
    expect(mapTab).toContain('% of day detours')
    expect(mapTab).toContain('min detour`')
    expect((mapTab.match(/'position unknown'/g) ?? []).length).toBe(3)
  })

  it('the page still supplies the trip-aware inputs the module must not know', () => {
    const call = contentHook.slice(contentHook.indexOf('hitCostLabels({'), contentHook.indexOf('}), [pois, hitEngine'))
    expect(call).toContain('detourMin: hitEngine.get(String(sh.hit.id))?.detourMin ?? null')
    expect(call).toContain('etaMinutes: sh.segment.etaMinutes')
    expect(call).toContain('dayForKm,')
    expect(call).toContain('detourBudgetMin: dayIndex => dayDetourBudgetMin({')
  })
})
