// ============ Make it your weekend: answers, dates and ticket lines ============
// The storefront card (components/creator/StoreWeekend.tsx) asks for a start date
// and a party size. These helpers turn those answers into the dates a fork copies
// and into the ticket lines. Pure logic, no backend. The copy keeps the route's own
// length: the pick sets the start, and the end follows from the source trip's span.
import type { Trip } from '../data/types'
import { CREW_MIN } from './crew'
import { dayCountForRange, localMidnightMs } from './dayCount'

/** The most people the card's stepper offers. A trip itself allows more. */
export const PARTY_MAX = 20
/** The mockup's default party. */
export const PARTY_DEFAULT = 4

/** What a fork carries through sign-in. `startDate` is ISO yyyy-mm-dd. */
export interface ForkPlan {
  startDate: string
  travellers: number
  /** The route's start place (`routeSummary[0]`). The copy keeps its own start. */
  startTown: string | null
}

export type PlanLine = { kind: 'free' } | { kind: 'price'; inr: number }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SATURDAY = 6

/** Reads one entry by position, without a bracket lookup on a variable key. */
function nth(list: readonly string[], index: number): string {
  return list.slice(index, index + 1)[0] ?? ''
}

/** yyyy-mm-dd of a local date. Same format as DateRangeCalendar's isoDay. */
export function isoDayOf(d: Date): string {
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** `iso` moved by whole calendar days. Local arithmetic, so a DST change cannot shift it. Null for a bad date. */
export function addIsoDays(iso: string, days: number): string | null {
  const ms = localMidnightMs(iso)
  if (ms === null) return null
  const d = new Date(ms)
  d.setDate(d.getDate() + days)
  return isoDayOf(d)
}

/** The next two Saturdays on or after `today`, as ISO start dates. */
export function weekendStarts(today: Date): [string, string] {
  const first = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  first.setDate(first.getDate() + ((SATURDAY - first.getDay() + 7) % 7))
  const second = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 7)
  return [isoDayOf(first), isoDayOf(second)]
}

/** The last day of a trip that starts on `startIso` and lasts `spanDays` days, counting both ends. Null when unusable. */
export function endForSpan(startIso: string, spanDays: number): string | null {
  if (!Number.isInteger(spanDays) || spanDays < 1) return null
  return addIsoDays(startIso, spanDays - 1)
}

interface DayParts { weekday: string; day: number; month: string }

function dayParts(iso: string): DayParts | null {
  const ms = localMidnightMs(iso)
  if (ms === null) return null
  const d = new Date(ms)
  return { weekday: nth(WEEKDAYS, d.getDay()), day: d.getDate(), month: nth(MONTHS, d.getMonth()) }
}

/** Ticket dates: "21–23 Nov", or "30 Nov – 2 Dec" across a month end. Empty for a bad date. */
export function dateRangeLabel(startIso: string, endIso: string): string {
  const a = dayParts(startIso)
  const b = dayParts(endIso)
  if (!a || !b) return ''
  if (startIso === endIso) return `${a.day} ${a.month}`
  if (a.month === b.month) return `${a.day}–${b.day} ${b.month}`
  return `${a.day} ${a.month} – ${b.day} ${b.month}`
}

/** Quick-pick label: "Sat 21 – Mon 23 Nov", or "Sat 28 Nov – Wed 2 Dec" across a month end. Empty for a bad date. */
export function pickLabel(startIso: string, endIso: string): string {
  const a = dayParts(startIso)
  const b = dayParts(endIso)
  if (!a || !b) return ''
  if (startIso === endIso) return `${a.weekday} ${a.day} ${a.month}`
  if (a.month === b.month) return `${a.weekday} ${a.day} – ${b.weekday} ${b.day} ${b.month}`
  return `${a.weekday} ${a.day} ${a.month} – ${b.weekday} ${b.day} ${b.month}`
}

/** Whole people from CREW_MIN to PARTY_MAX. A value that is not finite becomes CREW_MIN. */
export function clampParty(value: number): number {
  if (!Number.isFinite(value)) return CREW_MIN
  return Math.min(PARTY_MAX, Math.max(CREW_MIN, Math.round(value)))
}

/** The paywall line. A free route stores no price, so undefined, null and 0 all read as Free.
 *  A finite price above 0 is the real unlock price. Anything else is unknown, so the line is omitted. */
export function planLine(premiumPriceInr: number | null | undefined): PlanLine | null {
  if (premiumPriceInr === undefined || premiumPriceInr === null || premiumPriceInr === 0) return { kind: 'free' }
  if (Number.isFinite(premiumPriceInr) && premiumPriceInr > 0) return { kind: 'price', inr: premiumPriceInr }
  return null
}

/** The route's stored estimate per person. It is already per head, so no party size divides it again.
 *  Null when the stored value is missing or not above 0. */
export function headEstimateInr(estimatedBudgetPerPersonInr: number | null | undefined): number | null {
  if (typeof estimatedBudgetPerPersonInr !== 'number' || !Number.isFinite(estimatedBudgetPerPersonInr)) return null
  return estimatedBudgetPerPersonInr > 0 ? estimatedBudgetPerPersonInr : null
}

/** A plan read back from storage is untrusted. Keep it only when the date and the party are usable. */
export function sanitizeForkPlan(raw: unknown): ForkPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const { startDate, travellers, startTown } = raw as { startDate?: unknown; travellers?: unknown; startTown?: unknown }
  if (typeof startDate !== 'string' || typeof travellers !== 'number' || !Number.isFinite(travellers)) return null
  const ms = localMidnightMs(startDate)
  if (ms === null) return null
  const town = typeof startTown === 'string' ? startTown.trim().slice(0, 80) : ''
  return { startDate: isoDayOf(new Date(ms)), travellers: clampParty(travellers), startTown: town || null }
}

/** The copy takes the chosen start and keeps the source trip's own length. Days are numbered from the start,
 *  so moving the start needs no day edits. A source with no usable span keeps its dates. The party always applies.
 *  The start town is not written: the copy already starts where the route does. */
export function applyForkPlan(trip: Trip, plan: ForkPlan): Trip {
  const span = dayCountForRange(trip.startDate, trip.endDate)
  const endDate = span >= 1 ? endForSpan(plan.startDate, span) : null
  return {
    ...trip,
    travellers: clampParty(plan.travellers),
    ...(endDate ? { startDate: plan.startDate, endDate } : {}),
  }
}
