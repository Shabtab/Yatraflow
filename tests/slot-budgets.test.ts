// ============ #344 slot budgets + #346 halt-plan persistence ============
// #344: slot and rail budget from the SAME per-day base; the engine score
// ranks the budget walk (stay-proximity is a tie-break, never a re-sort);
// ONE fit floor for pool, scorer and leads; the pool is re-scored with the
// same DNA/home inputs the corridor used. #346: the halt plan persists its
// pins, `searched` follows completed searches only, plan order has ONE
// canonical form, and a superseded search says so instead of dying quietly.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { daySlots, type DaySlotsDeps } from '../src/lib/daySlots'
import { dayDetourBudgetMin, splitByDetourBudget } from '../src/lib/detourBudget'
import { MIN_PURPOSE_FIT } from '../src/lib/haltFit'
import type { RideSegment, SegmentHit } from '../src/lib/ridePlan'
import type { PlaceHit } from '../src/lib/providers/hits'
import type { ItineraryStop } from '../src/data/types'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const travelPanel = read('../src/pages/trip/timeline/TravelPanel.tsx')
const mapTab = read('../src/pages/trip/MapTab.tsx')
const writersSrc = read('../src/pages/trip/map/useMapWriters.ts')
const daySlotsSrc = read('../src/lib/daySlots.ts')
const cacheSrc = read('../src/hooks/useSuggestionCache.ts')

function seg(purpose: RideSegment['purpose'], over: Partial<RideSegment> = {}): RideSegment {
  return { index: 0, purpose, label: purpose, targetKm: 100, minKm: 80, maxKm: 130, kmFromPrev: 100, minutesFromPrev: 120, hint: '', ...over }
}
function hit(id: string, name: string, over: Partial<PlaceHit> = {}): PlaceHit {
  return { id, name, latitude: 10, longitude: 76, kind: 'poi', category: 'food', offRouteKm: 12, alongRouteKm: 100, ...over }
}
function stop(id: string, title: string, over: Partial<ItineraryStop> = {}): ItineraryStop {
  return { id, title, category: 'food', locationName: title, lat: 10, lng: 76, visitMinutes: 45, entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'nice-to-have', status: 'confirmed', orderInDay: 0, ...over }
}
const ANCHORS = [{ lat: 10, lng: 76 }]
const base = (over: Partial<DaySlotsDeps> = {}): DaySlotsDeps => ({ haltSegments: [], dayStops: [], anchors: ANCHORS, ...over })

describe('#344 — slot and rail budget from the same base', () => {
  it('candidatesFor derives the per-day stop count from dayStops when plannedStops is not passed', () => {
    // 4 active stops → density 2 × 5 = 10 → 45 − 10 = 35 budget, not the
    // empty-day 45 the slot used to budget while the rail read 35.
    const slots = daySlots(0, base({
      haltSegments: [shMeal()],
      dayStops: [
        stop('s1', 'A'), stop('s2', 'B'), stop('s3', 'C'), stop('s4', 'D'),
        stop('s5', 'rejected one', { status: 'rejected' }),
      ],
      altPool: [hit('p1', 'Far eatery', { offRouteKm: 30, alongRouteKm: 100 })],
    }))
    // A 30 km detour costs 45 min — over the 35-min budget, so it is culled.
    expect(slots[0].candidates).toHaveLength(0)
  })

  it('an explicit plannedStops still wins (the caller-computed override)', () => {
    expect(dayDetourBudgetMin({ travelStyle: 'balanced', plannedStops: 0 })).toBe(45)
    expect(dayDetourBudgetMin({ travelStyle: 'balanced', plannedStops: 4 })).toBe(35)
    expect(dayDetourBudgetMin({ travelStyle: 'balanced', plannedStops: 4, })).toBe(35)
  })

  it('MapTab does not pass a single shared plannedStops into daySlotDeps (per-day derivation instead)', () => {
    // A single shared count would charge every day of tripReadiness' matrix
    // the ACTIVE day's density; the per-day derivation in candidatesFor is
    // the fix, so the deps must not carry the prop at all.
    expect(mapTab).toMatch(/const daySlotDeps = useMemo<Omit<DaySlotsDeps, 'dayStops'>/)
    expect(mapTab).not.toMatch(/plannedStops: /)
  })

  it('daySlots.ts derives plannedStops from dayStops beside the budget', () => {
    expect(daySlotsSrc).toMatch(/deps\.plannedStops\s*\?\?\s*deps\.dayStops\.filter/)
  })
})

function shMeal(): SegmentHit {
  return { segment: seg('meal', { etaMinutes: 735 }), hit: null, score: 12 }
}

describe('#344 — the engine score ranks; stay-proximity is a tie-break', () => {
  it('a stay-close off-route meal no longer outranks the on-route engine-best', () => {
    // Both are food. ON-ROUTE engine-best scores better (≈0 detour); the
    // STAY-CLOSE one is 20 km off-route but 0.5 km from the hotel.
    const onRoute = hit('on', 'On-route dhaba', { offRouteKm: 0.5, alongRouteKm: 100 })
    const offRoute = hit('off', 'Hotel-adjacent diner', { offRouteKm: 20, alongRouteKm: 140, latitude: 10.004, longitude: 76.004 })
    const slots = daySlots(0, base({
      haltSegments: [shMeal()],
      dayStops: [stop('hotel', 'The hotel', { category: 'hotel', lat: 10.004, lng: 76.004 })],
      altPool: [onRoute, offRoute],
    }))
    expect(slots[0].candidates.length).toBeGreaterThanOrEqual(1)
    // The on-route pick leads: it costs ~nothing from the budget, so the
    // budget walk cannot have been re-ordered by stay proximity.
    expect(slots[0].candidates[0].hit.id).toBe('on')
    // The stay-close one still surfaces — with the honest straight-line label.
    const second = slots[0].candidates.find(c => c.hit.id === 'off')
    if (second) expect(second.reason).toContain('from your stay (straight line)')
  })

  it('the old haversine-first sort is gone from candidatesFor', () => {
    expect(daySlotsSrc).not.toMatch(/rows\.sort\(\(a, b\) => \{\s*\r?\n\s*if \(nearStay\)/)
    expect(daySlotsSrc).toMatch(/STAY_BONUS_KM/)
    expect(daySlotsSrc).toMatch(/STAY_BONUS_SEC/)
  })
})

describe('#344 — ONE fit floor across pool, scorer and leads', () => {
  it('exports the shared floor and uses it for the pool gate', () => {
    expect(MIN_PURPOSE_FIT).toBe(1)
    expect(daySlotsSrc).toMatch(/fitScoreForPurpose\(h, purpose\) < MIN_PURPOSE_FIT/)
    expect(daySlotsSrc).not.toMatch(/fitScoreForPurpose\(h, purpose\) < 2/)
  })

  it('a fit-1 cafe is treated identically by pool and scorer', () => {
    // cafe: meal fit 1. Under the old gate-2 the pool refused it; the scorer
    // admitted it. Now both admit (or both would refuse) — one verdict.
    const slots = daySlots(0, base({
      haltSegments: [shMeal()],
      dayStops: [],
      altPool: [hit('cafe1', 'Roadside cafe', { category: 'cafe', offRouteKm: 1, alongRouteKm: 100 })],
    }))
    expect(slots[0].candidates.map(c => c.hit.id)).toContain('cafe1')
  })

  it('haltFit derives SLOT_KIND_CATEGORIES from the shared floor too', () => {
    expect(read('../src/lib/haltFit.ts')).toMatch(/const GATE = MIN_PURPOSE_FIT/)
  })
})

describe('#344 — non-finite detours defer, never ride free', () => {
  it('splitByDetourBudget defers NaN detours (the old NaN path landed within)', () => {
    const items = [{ id: 'nan', detourMin: Number.NaN }, { id: 'ok', detourMin: 10 }]
    const { within, deferred } = splitByDetourBudget(items as never, 45)
    expect(deferred.map(i => (i as { id: string }).id)).toEqual(['nan'])
    expect(within.map(i => (i as { id: string }).id)).toEqual(['ok'])
  })

  it('candidatesFor skips non-finite detours explicitly', () => {
    expect(daySlotsSrc).toMatch(/!Number\.isFinite\(dMin\)\) continue/)
  })
})

describe('#344 — the pool is re-scored with the inputs the corridor used', () => {
  it('DaySlotsDeps carries dnaVector and homeCenter, and candidatesFor threads them', () => {
    expect(daySlotsSrc).toMatch(/dnaVector\?: DnaVector/)
    expect(daySlotsSrc).toMatch(/homeCenter\?: \{ lat: number; lng: number \} \| null/)
    expect(daySlotsSrc).toMatch(/const scoreOpts: AssignOpts/)
    expect(daySlotsSrc).toMatch(/deps\.dnaVector \? \{ dnaVector: deps\.dnaVector \}/)
    expect(daySlotsSrc).toMatch(/deps\.homeCenter \? \{ homeCenter: deps\.homeCenter \}/)
  })

  it('MapTab passes the corridor DNA and home centre into daySlotDeps', () => {
    expect(mapTab).toMatch(/dnaVector: buildDnaVectorAcrossTrips\(loadDnaLog\(\), crewSeedEvents\(trip\.id, crewSeeds\)\),/)
    expect(mapTab).toMatch(/homeCenter: trip\.startLocationCoords \?\? null,\n\s*addedIds,/)
  })
})

describe('#344 — seg-hits filter by the session bags like altPool', () => {
  it('DaySlotsDeps declares addedIds/dismissedIds and the seg-hit loop consumes them', () => {
    expect(daySlotsSrc).toMatch(/addedIds\?: ReadonlySet<string>/)
    expect(daySlotsSrc).toMatch(/dismissedIds\?: ReadonlySet<string>/)
    expect(daySlotsSrc).toMatch(/deps\.addedIds\?\.has\(id\) \|\| deps\.dismissedIds\?\.has\(id\)/)
  })

  it('a dismissed segment lead leaves the open slot (pool and lead, one rule)', () => {
    const lead = hit('lead1', 'Dismissal victim', { offRouteKm: 2 })
    const slots = daySlots(0, base({
      haltSegments: [{ segment: seg('meal', { etaMinutes: 735 }), hit: lead, score: 12 }],
      dayStops: [],
      dismissedIds: new Set(['lead1']),
    }))
    expect(slots[0].candidates).toHaveLength(0)
  })
})

describe('#346 — the halt plan persists its pins', () => {
  it('HaltPlanItem carries pin and the cache writes it', () => {
    expect(read('../src/lib/ridePlan.ts')).toMatch(/pin\?: boolean/)
    expect(travelPanel).toMatch(/pin: s\.pin \}/)
    expect(travelPanel).not.toMatch(/pin: false,\n\s*\}\)\)\n\s*\}\)\n\s*if \(cached\) setSearched/)
  })

  it('hydration reads the persisted pin defensively (old payloads hydrate unpinned)', () => {
    expect(travelPanel).toMatch(/pin: p\.pin === true/)
  })

  it('the cache version bumped so old shapes evict', () => {
    // #414 (2026-09-29): the halt entries gained `inputsHash` — the plan-input
    // stamp a cached plan is checked against — so the version moved 6 → 7 and
    // un-stamped payloads evict rather than hydrating as "always fresh".
    expect(cacheSrc).toMatch(/const CACHE_VERSION = 7/)
    expect(cacheSrc).toMatch(/#346/)
    expect(cacheSrc).toMatch(/#414/)
  })
})

describe('#346 — searched follows completed searches only', () => {
  it('the hydrate effect no longer sets searched', () => {
    expect(travelPanel).not.toMatch(/if \(cached\) setSearched\(true\)/)
    expect(travelPanel).toMatch(/searched && !plan\.some\(p => p\.hit\)/)
  })
  it('appending a halt keeps the honest-empty path reachable', () => {
    // addPlanHalt sets searched=false AFTER commitPlan (which no longer
    // resurrects it through the hydrate effect).
    expect(travelPanel).toMatch(/commitPlan\(\[\.\.\.plan, \{ id: `pl-\$\{Date\.now\(\)\}-\$\{plan\.length\}`/)
    expect(travelPanel).toMatch(/setSearched\(false\)/)
  })
})

describe('#346 — ONE canonical plan order, both sides', () => {
  it('hydration re-sorts the cached plan by km (commitPlan caches sorted)', () => {
    expect(travelPanel).toMatch(/\.sort\(\(a, b\) => a\.p\.km - b\.p\.km\)/)
  })
})

describe('#346 — a superseded search says so', () => {
  it('commitPlan toasts when it cancels an in-flight search, and the search write is exempt', () => {
    expect(travelPanel).toMatch(/Plan changed — the spot search was restarted/)
    expect(travelPanel).toMatch(/searchCommitting/)
  })
})

describe('#346 — fills and deletes filter locally', () => {
  it('fillSlot / fillTheDay / removeStopFromMap no longer force a re-search', () => {
    // #420 slice 10: the fills moved with the writers into ./map — the guard
    // follows them, while the delete path never left the page.
    const fillSlot = travelPanelSection(writersSrc, 'async function fillSlot')
    const fillTheDay = travelPanelSection(writersSrc, 'async function fillTheDay')
    const removeStop = travelPanelSection(mapTab, 'function removeStopFromMap')
    for (const section of [fillSlot, fillTheDay, removeStop]) {
      expect(section).not.toContain('suggestionCache.clearMap()')
      expect(section).not.toContain('setRefreshTick(')
    }
    // The undo paths inside fillSlot/fillTheDay keep blocks too — the whole
    // function bodies were checked above.
  })

  it('the two-call protocol survives only where it is legitimate', () => {
    // Refresh button + endpoint-change are input changes, not local filters.
    const clears = [...mapTab.matchAll(/suggestionCache\.clearMap\(\)/g)].length
    expect(clears).toBe(2)
    expect(mapTab).toMatch(/onClick=\{\(\) => \{ suggestionCache\.clearMap\(\); setRefreshTick\(t => t \+ 1\) \}\}/)
  })

  it('dismiss relies on the same render filtering it always did — no refreshTick', () => {
    const dismiss = travelPanelSection(mapTab, 'setDismissedIds(prev => new Set(prev).add(hit.id as string))')
    expect(dismiss).not.toContain('setRefreshTick(')
  })
})

/** Slice a source file from a marker to the function's closing brace-ish next marker. */
function travelPanelSection(src: string, marker: string): string {
  const start = src.indexOf(marker)
  if (start < 0) return ''
  const next = src.slice(start).search(/\n  (async function|function|const|\/\*\*) /m)
  return next < 0 ? src.slice(start) : src.slice(start, start + next)
}
