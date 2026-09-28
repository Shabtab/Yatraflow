// ============ Filing a found place into a day's slot (pure) ============
// #420 slice 5. Three rules used to live inline in MapTab, where the only way to
// review them was to read a 2,723-line component and hold its closures in your
// head. They are small, they are rules, and every one of them has already been
// wrong once:
//
//  - WHICH slots a found place may be filed into. The providers tag a hit with a
//    category and only some categories have a slot kind that can hold one.
//  - WHAT a manual candidate is. The detour numbers are real, and every field the
//    search cannot know stays null: no fabricated arrival time, and the
//    provenance rides in the reason line so a card can say where it came from.
//  - WHEN the filing is refused. A place already on the plan, or already a
//    candidate for this slot, is refused with a REASON — never a silent no-op,
//    because a button that does nothing reads as a broken button.
//
// Pure and node-testable: the detour math and the budget share arrive as inputs,
// so this module never imports the engine, the store, or the map.
import type { DaySlot, DaySlotKind, SlotCandidate } from '../../../lib/daySlots'
import type { PlaceHit } from '../../../lib/providers/hits'

export type FilingOption = { key: string; label: string; noun: string }

/**
 * The slot kinds a provider category can fill.
 *
 * The three meal words are one kind on purpose: Google tags a restaurant `food`
 * and a cafe `cafe`, and it tags a POPULATED PLACE (a town) `rest` — and
 * `fitScoreForPurpose` treats a populated place as meal-capable, so `rest` files
 * as a meal too. Nothing else in the vocabulary has a slot to land in, and an
 * empty answer is the honest one: the caller then offers no filing action rather
 * than a slot that cannot hold the place.
 */
export function slotKindsForCategory(category: unknown): DaySlotKind[] {
  const cat = String(category ?? '')
  if (cat === 'food' || cat === 'cafe' || cat === 'rest') return ['meal']
  if (cat === 'transport-hub') return ['fuel']
  if (cat === 'hotel') return ['overnight']
  return []
}

/**
 * The empty slots of the day this hit can be filed into, in rail order.
 *
 * NO CAP, deliberately. `activeDaySlots` arrives in rail order (breakfast, lunch,
 * dinner), and the old `slice(0, 2)` therefore always dropped the LAST meal —
 * dinner, the one most often away from the hotel and the one most worth
 * sourcing. The rule is "every empty slot that can hold it", not "the first two".
 */
export function filingOptionsFor(
  hit: Pick<PlaceHit, 'category'>,
  slots: readonly Pick<DaySlot, 'key' | 'label' | 'kind' | 'state'>[],
): FilingOption[] {
  const kinds = slotKindsForCategory(hit.category)
  if (kinds.length === 0) return []
  return slots
    .filter(s => s.state === 'empty' && kinds.includes(s.kind))
    .map(s => ({ key: s.key, label: `Add as ${s.label}`, noun: s.label.toLowerCase() }))
}

export type ManualCandidateInput = {
  hit: PlaceHit
  /** door-to-door detour minutes at the trip's speed, or null when unknown */
  detourMin: number | null
  /** road detour km, or null when unknown */
  detourKm: number | null
  /** that day's detour budget, in minutes */
  budgetMin: number
  /** `budgetSharePct` from lib/detourBudget, injected so this module stays pure */
  sharePct: (detourMin: number, budgetMin: number) => number
}

/**
 * A search pick filed as a candidate for a slot: the shape the rail's cards read,
 * with every field the search genuinely cannot know left null.
 *
 * `budgetSharePct` is the one derived number, and an unknown detour reads as the
 * WHOLE budget (100) rather than a flattering zero — an unmeasured candidate has
 * no evidence that it is cheap.
 *
 * `score` is `MAX_SAFE_INTEGER` because this candidate was never scored by the
 * engine: it is the user's own pick, and the rail sorts manual picks first on
 * membership rather than on this number.
 */
export function manualCandidateFor(input: ManualCandidateInput): SlotCandidate {
  const { hit, detourMin, detourKm, budgetMin, sharePct } = input
  return {
    hit,
    detourMin,
    detourKm,
    budgetSharePct: detourMin == null ? 100 : sharePct(detourMin, budgetMin),
    posKm: null,
    arriveMin: null,
    arriveLabel: null,
    inWindow: false,
    score: Number.MAX_SAFE_INTEGER,
    reason: 'added from this slot’s search',
  }
}

/**
 * The slot's candidate list: the user's manual picks first (they are explicit
 * choices, not suggestions), then the engine's candidates minus any id a manual
 * pick already carries — so a place can never appear twice in one rail, once as
 * "you picked this" and once as "the engine suggests this".
 */
export function mergeSlotCandidates<T extends { hit: { id: unknown } }>(
  manual: readonly T[],
  engine: readonly T[],
): T[] {
  if (manual.length === 0) return [...engine]
  const manualIds = new Set(manual.map(m => String(m.hit.id)))
  return [...manual, ...engine.filter(c => !manualIds.has(String(c.hit.id)))]
}

export type SlotFileRefusal = {
  kind: 'added' | 'candidate'
  /** the toast the caller shows, verbatim */
  message: string
}

export type SlotFileInput = {
  hit: PlaceHit
  /** the slot's user-facing name ("Lunch", "Stay") — the copy lowercases it */
  slotLabel: string
  /** the slot's manual picks, as the rail stores them (raw hits) */
  manual: readonly PlaceHit[]
  /** the slot's engine candidates, already scored */
  candidates: readonly Pick<SlotCandidate, 'hit'>[]
  /** the plan-presence predicate the whole tab shares (#179's duplicate guard) */
  isAdded: (hit: PlaceHit) => boolean
}

/**
 * Why this place cannot be filed into this slot, or null when it can.
 *
 * Two refusals, checked in the order the user meets them: they already own the
 * place (it is in the plan, or it was dismissed), or it is already a candidate
 * for THIS slot — whether they filed it or the engine proposed it. The message
 * names the place and, for the second, the slot, because "already added" without
 * a noun sends the reader hunting for which list they are looking at.
 */
export function slotFileRefusal(input: SlotFileInput): SlotFileRefusal | null {
  const { hit, slotLabel, manual, candidates, isAdded } = input
  if (isAdded(hit)) {
    return { kind: 'added', message: `"${hit.name}" is already on the plan or was dismissed.` }
  }
  const id = String(hit.id)
  const already = manual.some(x => String(x.id) === id) || candidates.some(c => String(c.hit.id) === id)
  if (already) {
    return {
      kind: 'candidate',
      message: `"${hit.name}" is already a candidate for the ${slotLabel.toLowerCase()} slot.`,
    }
  }
  return null
}
