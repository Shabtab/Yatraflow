// The Look Inside page sells a plan in counts and plain words. A locked day
// keeps its own title and its derived road minutes, and it carries no stop
// title, no location name and no coordinate. Pace word and cover rules follow
// the prototype: p7-look-inside (NOTES.md).
import type { ItineraryDay, PublishedItinerary } from '../data/types'

export type StorefrontKind =
  'sight' | 'nature' | 'food' | 'temple' | 'museum' | 'beach' | 'market' | 'outdoors' | 'evening' | 'stay' | 'travel'

export const KIND_LABEL: Record<StorefrontKind, { one: string; many: string }> = {
  sight: { one: 'sight', many: 'sights' },
  nature: { one: 'nature stop', many: 'nature stops' },
  food: { one: 'food stop', many: 'food stops' },
  temple: { one: 'temple', many: 'temples' },
  museum: { one: 'museum', many: 'museums' },
  beach: { one: 'beach', many: 'beaches' },
  market: { one: 'market', many: 'markets' },
  outdoors: { one: 'outdoor stop', many: 'outdoor stops' },
  evening: { one: 'evening out', many: 'evenings out' },
  stay: { one: 'stay', many: 'stays' },
  travel: { one: 'transfer', many: 'transfers' },
}

const CATEGORY_TO_KIND: Record<string, StorefrontKind> = {
  sightseeing: 'sight',
  food: 'food',
  nature: 'nature',
  beach: 'beach',
  temple: 'temple',
  adventure: 'outdoors',
  shopping: 'market',
  museum: 'museum',
  event: 'evening',
  hotel: 'stay',
  rest: 'stay',
  travel: 'travel',
  'transport-hub': 'travel',
}

export function kindOfCategory(category: string | undefined): StorefrontKind {
  return CATEGORY_TO_KIND[category ?? ''] ?? 'sight'
}

/** `stay` and `travel` are not places. Kind counts ignore them. */
function isPlaceKind(kind: StorefrontKind): boolean {
  return kind !== 'stay' && kind !== 'travel'
}

export interface KindCount {
  kind: StorefrontKind
  count: number
}

export function countKinds(stops: ReadonlyArray<{ category?: string }>): KindCount[] {
  const tally = new Map<StorefrontKind, number>()
  for (const stop of stops) {
    const kind = kindOfCategory(stop?.category)
    if (!isPlaceKind(kind)) continue
    tally.set(kind, (tally.get(kind) ?? 0) + 1)
  }
  return [...tally.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
}

/** "4 nature stops, 3 sights and 2 temples". Returns "" when nothing is listed. */
export function describeKinds(counts: KindCount[]): string {
  const words = counts
    .filter((k) => k.count > 0)
    .map((k) => `${k.count} ${k.count === 1 ? KIND_LABEL[k.kind].one : KIND_LABEL[k.kind].many}`)
  if (words.length === 0) return ''
  if (words.length === 1) return words[0]
  return words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1]
}

/** The one-sentence plan summary, for example "A 5-day plan with 4 nature stops."
 *  Returns null for a plan with no days: "A 0-day plan" describes nothing, so
 *  the page shows no lede at all. */
export function planLede(dayCount: number, kinds: KindCount[]): string | null {
  if (dayCount <= 0) return null
  const list = describeKinds(kinds)
  return list ? `A ${dayCount}-day plan with ${list}.` : `A ${dayCount}-day plan.`
}

export type PaceKey = 'empty' | 'flight' | 'easy' | 'full' | 'drive'

export interface Pace {
  key: PaceKey
  label: string
}

const PACE: Record<PaceKey, string> = {
  empty: 'Nothing planned',
  flight: 'Flight day',
  easy: 'Easy day',
  full: 'Full day',
  drive: 'Long drive',
}

/** Prototype pace(): a flight wins. 180 min on the road means Long drive.
 *  4 stops or a 10-hour span means Full day. The rest is an easy day. */
export function paceOf(input: {
  placeCount: number
  travelMinutes: number
  hasFlight: boolean
  visitMinutes: number
}): Pace {
  const { placeCount, travelMinutes, hasFlight, visitMinutes } = input
  if (!placeCount && !hasFlight) return { key: 'empty', label: PACE.empty }
  if (hasFlight) return { key: 'flight', label: PACE.flight }
  if (travelMinutes >= 180) return { key: 'drive', label: PACE.drive }
  if (placeCount >= 4 || visitMinutes >= 600) return { key: 'full', label: PACE.full }
  return { key: 'easy', label: PACE.easy }
}

/** A schedule leg, as the engine reports it. Only the kind and the minutes
 *  matter here, so the helper stays independent of the engine's own types. */
export interface LegMinutes {
  /** 'air' for a flight sector. 'road' or absent for a ground leg. */
  kind?: string
  durationMinutes: number
}

/** The minutes a traveller spends on the ground. A flight sector is not road
 *  time, so its minutes never count here. The engine's own total includes
 *  every leg, and a card that says "on the road" must not present a flight
 *  as a drive. */
export function roadMinutesOf(legs: ReadonlyArray<LegMinutes>): number {
  let total = 0
  for (const leg of legs) {
    if (leg.kind === 'air') continue
    total += leg.durationMinutes
  }
  return total
}

/** True when the schedule carries an air sector. The engine plans an estimated
 *  air leg for a flight trip before the traveller enters a flight, so the
 *  stored flight rows are not the only source of the signal. A leg with no
 *  kind is ground travel, and a stay day of a flight trip carries no air leg
 *  at all. */
export function hasAirLeg(legs: ReadonlyArray<LegMinutes>): boolean {
  return legs.some((leg) => leg.kind === 'air')
}

export interface DaySummary {
  index: number
  title: string
  placeCount: number
  kinds: KindCount[]
  /** Null when the card shows no pace word. A locked day with no counted place
   *  cannot claim a pace, because the flight signal is withheld from it. */
  pace: Pace | null
  travelMinutes: number
  /** True only when the card is allowed to disclose a flight. */
  hasFlight: boolean
}

/** The flight signal a card may show. `'withheld'` is not `false`: a card that
 *  hides a flight cannot read the day as empty in its place. */
export type FlightSignal = boolean | 'withheld'

/** The flight signal for one day. A locked card withholds it, so the card never
 *  discloses a flight and never infers an empty day from the hidden flight. */
export function flightSignalFor(hasFlight: boolean, locked: boolean): FlightSignal {
  return locked ? 'withheld' : hasFlight
}

/** Reads only each stop's category and visit minutes. Never a name or a coordinate.
 *  `flight` is a three-way signal: `'withheld'` drops the pace word instead of
 *  turning a hidden flight into an "empty day" claim. */
export function summariseDay(day: ItineraryDay, travelMinutes: number, flight: FlightSignal): DaySummary {
  const categories = (day.stops ?? []).map((s) => ({ category: s?.category }))
  const kinds = countKinds(categories)
  const placeCount = kinds.reduce((sum, k) => sum + k.count, 0)
  const visitMinutes = (day.stops ?? []).reduce((sum, s) => sum + (s?.visitMinutes ?? 0), 0)
  const hasFlight = flight === true
  const pace = paceOf({ placeCount, travelMinutes, hasFlight, visitMinutes })
  return {
    index: day.index,
    title: day.title && day.title.trim() ? day.title : `Day ${day.index + 1}`,
    placeCount,
    kinds,
    // A withheld flight leaves no evidence either way, so a day with no counted
    // place shows no pace word at all.
    pace: flight === 'withheld' && placeCount === 0 ? null : pace,
    travelMinutes,
    hasFlight,
  }
}

/** The day summary the page builds from one simulated day.
 *
 *  The card says "on the road", so the minutes come from the ground legs only.
 *  The engine's own total also counts the air sector, and a flight is not a
 *  drive. The legs are the engine's own output, so this is a read of the
 *  schedule and not a second formula for it.
 *
 *  A withheld flight still reaches the summary as `'withheld'`, so a locked
 *  card never discloses a flight and never reads one as an empty day. */
export function summariseDayFromLegs(
  day: ItineraryDay,
  legs: ReadonlyArray<LegMinutes>,
  flight: FlightSignal,
): DaySummary {
  return summariseDay(day, Math.round(roadMinutesOf(legs)), flight)
}

export interface WeekGroup {
  label: string
  days: number[]
}

/** A fold longer than the threshold groups its rows one week at a time.
 *  A fold at or under the threshold stays flat: the group list is then null. */
export function foldWeeks(dayCount: number, threshold = 7): WeekGroup[] | null {
  if (dayCount <= threshold) return null
  const groups: WeekGroup[] = []
  for (let i = 0; i < dayCount; i++) {
    const week = Math.floor(i / 7)
    const last = groups[groups.length - 1]
    if (last && Math.floor(last.days[0] / 7) === week) last.days.push(i)
    else groups.push({ label: `Week ${week + 1}`, days: [i] })
  }
  return groups
}

export type CoverPlan =
  | { kind: 'photo'; src: string }
  | { kind: 'ticket'; routeLine: string; days: number; mode: string; kinds: KindCount[] }

/** The prototype routeBits(): "Round trip from A", "A to B", or one place. */
function routeLineOf(routeSummary: readonly string[]): string {
  if (!routeSummary?.length) return ''
  const first = routeSummary[0]
  const last = routeSummary[routeSummary.length - 1]
  if (routeSummary.length === 1) return first
  if (first === last) return `Round trip from ${first}`
  return `${first} to ${last}`
}

/** A photo covers when it exists. Otherwise a ticket with the top three kinds. */
export function chooseCover(
  pub: Pick<PublishedItinerary, 'coverImageUrl' | 'routeSummary' | 'durationDays'>,
  kinds: KindCount[],
  mode: string,
): CoverPlan {
  if (pub.coverImageUrl) return { kind: 'photo', src: pub.coverImageUrl }
  return {
    kind: 'ticket',
    routeLine: routeLineOf(pub.routeSummary),
    days: pub.durationDays,
    mode,
    kinds: kinds.slice(0, 3),
  }
}

/** Says what a locked run holds in counts: "Inside days 5 to 8: 4 nature stops,
 *  3 sights and 2 temples. Their names open when you buy the plan." */
export function lockedRunLine(
  fromDay: number,
  toDay: number,
  kinds: KindCount[],
  /** The last sentence. The default promises a purchase. Pass a neutral one when no purchase is on offer. */
  closing = 'Their names open when you buy the plan.',
): string {
  const list = describeKinds(kinds)
  if (!list) return ''
  const span = toDay - fromDay
  let days: string
  if (span <= 0) days = `day ${fromDay}`
  else if (span === 1) days = `days ${fromDay} and ${toDay}`
  else days = `days ${fromDay} to ${toDay}`
  return `Inside ${days}: ${list}. ${closing}`
}

/** Cuts the pitch to its limit. An ellipsis marks a cut. */
export function truncatePitch(text: string, max = 140): string {
  // Count code points, so an emoji is never split in half. Trim before the ellipsis.
  const points = Array.from(text)
  if (points.length <= max) return text
  return points.slice(0, Math.max(max - 1, 1)).join('').trimEnd() + '…'
}
