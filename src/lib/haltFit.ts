// ============ Purpose fit: the engine's category scoring table ============
// Lives in its own leaf module because `ridePlan` imports `tripDna` (for the
// DNA boost), so a module that ridePlan's own consumer needs cannot live in
// ridePlan without a cycle. `ridePlan` re-exports both tables, so every
// existing importer is unaffected.
import type { HaltPurpose } from './providers/hits'

/** How well a place category serves each purpose (0-3). The engine's single
 *  source of truth for "can this kind of place be this kind of stop". */
export const PURPOSE_FIT: Record<string, Partial<Record<HaltPurpose, number>>> = {
  food: { meal: 3, stretch: 2, rest: 2 },
  'transport-hub': { fuel: 3, stretch: 2, meal: 1, rest: 1 },
  hotel: { overnight: 3, rest: 1 },
  cafe: { stretch: 3, meal: 1 },
  rest: { stretch: 2, rest: 3, meal: 1 },
  sightseeing: { sight: 3 },
}

/** Fit for a category the table does not name. */
export const DEFAULT_FIT: Partial<Record<HaltPurpose, number>> = { stretch: 1, rest: 1, sight: 2 }

/** The ONE purpose-fit floor shared by the corridor scorer, the slot rail's
 *  pool and its segment leads (#344). A need-purpose place (meal/fuel/
 *  overnight) is admissible at fit >= 1 — the scorer's own rule, so a cafe IS
 *  a meal when nothing better exists. The slot pool used to demand 2 while
 *  the scorer admitted 1 and segment leads passed ungated: the same hit was
 *  rejected from the pool and displayed as a segment lead at once. */
export const MIN_PURPOSE_FIT = 1

/** The four kinds of part the day plan names, and the engine purposes each one
 *  covers. `stretch` covers `rest` too — `draftForSegment` routes both to the
 *  one stretch slot, so a recovery break is a stretch accept. */
export const SLOT_KIND_PURPOSES = {
  meal: ['meal'],
  fuel: ['fuel'],
  overnight: ['overnight'],
  stretch: ['stretch', 'rest'],
} as const

export type SlotKind = keyof typeof SLOT_KIND_PURPOSES

/**
 * Which categories the engine will actually offer for each kind of part.
 *
 * **Derived from `PURPOSE_FIT`, never restated.** The hand-written lists this
 * replaces had drifted from the engine already — `cafe` was listed under `meal`
 * though its fit is 1 and `candidatesFor` gates the pool at 2, so the hint
 * counted picks the engine cannot make.
 *
 * `rest` legitimately appears under more than one kind: it is the category both
 * providers tag a POPULATED PLACE with (towns — restaurants are `food`), and
 * `fitScoreForPurpose` adds a populated-place bonus for meal / fuel /
 * overnight, which is exactly why a town can serve as lunch or a night halt.
 * That ambiguity is why a DNA event also records its own `haltKind` — category
 * alone cannot tell a town accepted as a night halt from one accepted as lunch.
 *
 * `GATE = 2` is `candidatesFor`'s pool gate: the number that decides what the
 * rail can actually offer.
 */
export const SLOT_KIND_CATEGORIES: Record<SlotKind, string[]> = (() => {
  // Same floor the pool and the scorer share (#344) — the hint counts picks
  // that CAN exist, and a fit-1 cafe can now exist as a meal.
  const GATE = MIN_PURPOSE_FIT
  const out: Record<SlotKind, string[]> = { meal: [], fuel: [], overnight: [], stretch: [] }
  for (const cat of Object.keys(PURPOSE_FIT)) {
    for (const kind of Object.keys(out) as SlotKind[]) {
      for (const purpose of SLOT_KIND_PURPOSES[kind]) {
        const base = PURPOSE_FIT[cat]?.[purpose] ?? 0
        // The populated-place bonus `fitScoreForPurpose` grants for these three.
        const bonus = cat === 'rest' && purpose !== 'stretch' ? 2 : 0
        if (base + bonus >= GATE) {
          out[kind].push(cat)
          break
        }
      }
    }
  }
  return out
})()
