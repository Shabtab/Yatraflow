// ============ Detour budget (Horizon 3.2) ============
// Pure, provider-agnostic. Each day earns a finite detour budget in minutes:
// suggestions spend it visibly ("uses ~30% of today's detour budget") and the
// planner stops offering beyond it. This turns endless suggestion lists into
// a finite, honest menu.
export const BASE_DAY_DETOUR_MIN = 45
/** Relaxed crews get more slack; packed crews get less. */
const STYLE_DELTA: Record<string, number> = { relaxed: 15, packed: -15 }
/** Stops beyond this many start eating the budget (dense days). */
const FREE_STOPS = 2
/** Each extra planned stop costs this many budget minutes. */
const MIN_PER_EXTRA_STOP = 5
/** The budget never drops below this — always room for one honest detour. */
export const MIN_DAY_DETOUR_MIN = 15

export function dayDetourBudgetMin(
  opts: { travelStyle?: string; plannedStops?: number } = {},
): number {
  const style = STYLE_DELTA[opts.travelStyle ?? ''] ?? 0
  const stops = Number.isFinite(opts.plannedStops) ? Math.max(0, opts.plannedStops as number) : 0
  const density = Math.max(0, stops - FREE_STOPS) * MIN_PER_EXTRA_STOP
  return Math.max(MIN_DAY_DETOUR_MIN, BASE_DAY_DETOUR_MIN + style - density)
}

/** Spend as a whole-percent share of budget (for "uses ~X%" labels). */
export function budgetSharePct(spendMin: number, budgetMin: number): number {
  if (!(budgetMin > 0)) return 0
  return Math.round((Math.max(0, spendMin) / budgetMin) * 100)
}

/**
 * Split journey-ordered items into within-budget and deferred. Zero-detour
 * items (on-route) never spend and always stay; anything that would push
 * cumulative spend past the budget is deferred, INCLUDING unknown/garbage
 * detours (#327): they are charged the full budget so a broken-geometry hit
 * can never ride for free — the deferral is the honest "wait for manual
 * review". (An earlier revision cost them 0 here, which was the leak #327
 * closed; the comment still said so until #344 swept it.)
 */
export function splitByDetourBudget<T extends { detourMin: number | null }>(
  items: T[],
  budgetMin: number,
): { within: T[]; deferred: T[] } {
  const within: T[] = []
  const deferred: T[] = []
  let spent = 0
  for (const item of items) {
    // Unknown covers null/undefined AND non-finite numbers (#344): a NaN
    // detour must not price as affordable on a technicality — 0 + budget
    // > budget is false, so the old NaN path landed WITHIN on a full-budget
    // charge. Unknown-cost waits for manual review, per #327's rule.
    const unknown = item.detourMin == null || (typeof item.detourMin === 'number' && !Number.isFinite(item.detourMin))
    const cost = unknown ? budgetMin : Math.max(0, item.detourMin as number)
    if (unknown || spent + cost > budgetMin) {
      deferred.push(item)
      continue
    }
    if (cost <= 0) {
      within.push(item)
      continue
    }
    spent += cost
    within.push(item)
  }
  return { within, deferred }
}
