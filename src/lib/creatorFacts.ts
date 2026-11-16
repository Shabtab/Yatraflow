import type { PublishedItinerary } from '../data/types'
import { livePubs } from './livePubs'

export const ROUTE_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The short name of month index 0-11, or an empty string outside that range. */
export function routeMonthName(index: number): string {
  return Number.isInteger(index) && index >= 0 ? ROUTE_MONTHS.slice(index, index + 1).join('') : ''
}

export function bestMonthIndexes(mask: number | undefined): number[] {
  if (mask === undefined || !Number.isInteger(mask) || mask <= 0 || mask > 4095) return []
  return ROUTE_MONTHS.flatMap((_, index) => mask & (1 << index) ? [index] : [])
}

export function routesForMonth(pubs: PublishedItinerary[], month: number): PublishedItinerary[] {
  return livePubs(pubs).filter(pub => bestMonthIndexes(pub.bestMonths).includes(month))
}

export function validPlanningNotes(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 3
    && value.every((note: unknown) => typeof note === 'string' && /[^\t\n\v\f\r ]/u.test(note) && [...note].length <= 140)
}

export function planningNotes(value: unknown): string[] | undefined {
  if (value == null) return undefined
  if (!validPlanningNotes(value)) throw new Error('Planning notes are unavailable')
  return value
}

export function publicationFacts(row: { planned_km?: unknown; best_months?: unknown; reviewed_at?: unknown; reviewed_scope?: unknown }) {
  const km = row.planned_km
  const months = row.best_months
  const reviewed = row.reviewed_at
  if (km != null && (typeof km !== 'number' || !Number.isFinite(km) || km < 0 || km >= 20000)) throw new Error('Invalid planned distance')
  if (months != null && (typeof months !== 'number' || !Number.isInteger(months) || months < 0 || months > 4095)) throw new Error('Invalid route months')
  if (reviewed != null && (typeof reviewed !== 'string' || !Number.isFinite(Date.parse(reviewed)))) throw new Error('Invalid review date')
  if (row.reviewed_scope != null && (typeof row.reviewed_scope !== 'string' || [...row.reviewed_scope].length > 140)) throw new Error('Invalid review scope')
  return {
    plannedKm: typeof km === 'number' ? km : undefined,
    bestMonths: typeof months === 'number' ? months : undefined,
    reviewedAt: typeof reviewed === 'string' ? Date.parse(reviewed) : undefined,
    reviewedScope: typeof row.reviewed_scope === 'string' ? row.reviewed_scope : undefined,
  }
}

/** The distance a publish may send. The SQL check allows 0 to under 20000 km;
 *  any other value is sent as unknown, so the publish itself never fails. */
export function publishablePlannedKm(km: number): number | undefined {
  const rounded = Math.round(km)
  return Number.isFinite(km) && km >= 0 && rounded < 20000 ? rounded : undefined
}

export function creatorPick(pubs: PublishedItinerary[], creatorId: string, id: string | null | undefined) {
  return livePubs(pubs).find(pub => pub.id === id && pub.creatorId === creatorId)
}

export function plannedKilometres(pubs: PublishedItinerary[]): number | undefined {
  const known = livePubs(pubs).filter(pub => pub.plannedKm !== undefined)
  return known.length ? known.reduce((sum, pub) => sum + (pub.plannedKm ?? 0), 0) : undefined
}
