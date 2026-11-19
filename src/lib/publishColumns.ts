/** The optional published_itineraries columns a publish may name, and the patch
 *  it sends. A database without the new SQL rejects a write that names a missing
 *  column, so the capability probe decides which keys go out. */

/** One payload per column. Null clears the column. */
export interface PublishColumnValues {
  plannedKm?: number
  bestMonths?: number
  reviewedScope?: string
  stateCodes?: string[]
}

/** The keys the publish path may add when the probe finds them. */
export interface PublishColumnPatch {
  planned_km?: number | null
  best_months?: number | null
  reviewed_scope?: string | null
  state_codes?: string[] | null
}

export const PUBLISH_OPTIONAL_COLUMNS = ['planned_km', 'best_months', 'reviewed_scope', 'state_codes'] as const

/** The patch for the columns that exist. A missing column is left out, so the
 *  publish still succeeds on an un-migrated database. */
export function publishColumnPatch(available: ReadonlySet<string>, values: PublishColumnValues): PublishColumnPatch {
  const patch: PublishColumnPatch = {}
  if (available.has('planned_km')) patch.planned_km = values.plannedKm ?? null
  if (available.has('best_months') && values.bestMonths !== undefined) patch.best_months = values.bestMonths
  if (available.has('reviewed_scope') && values.reviewedScope !== undefined) patch.reviewed_scope = values.reviewedScope
  if (available.has('state_codes')) patch.state_codes = values.stateCodes ?? null
  return patch
}
