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
 * cumulative spend past the budget is deferred. Garbage detours count as 0.
 */
export function splitByDetourBudget<T extends { detourMin: number }>(
  items: T[],
  budgetMin: number,
): { within: T[]; deferred: T[] } {
  const within: T[] = []
  const deferred: T[] = []
  let spent = 0
  for (const item of items) {
    const cost = Number.isFinite(item.detourMin) ? Math.max(0, item.detourMin) : 0
    if (cost <= 0) {
      within.push(item)
      continue
    }
    if (spent + cost <= budgetMin) {
      spent += cost
      within.push(item)
    } else {
      deferred.push(item)
    }
  }
  return { within, deferred }
}
