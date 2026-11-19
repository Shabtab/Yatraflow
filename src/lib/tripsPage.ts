// ============ My trips page — pure logic ============
// Status, "Up next" pick, countdown, planning progress, next step, date range
// text and the destination-to-region lookup. No clock reads: every function
// takes `today`. Dates compare as calendar days (yyyy-mm-dd), never as
// timestamps, so a time zone cannot move a trip to another day.
import type { Trip, TripMember } from '../data/types'
import { lastStop } from './tripsCard'
import { nextTripStep, plannedDayRatio, type NextStep, type NextStepKind } from './tripNextStep'

export type WhenKey = 'all' | 'upcoming' | 'past' | 'draft'
export type TripStatus = 'live' | 'upcoming' | 'past' | 'draft'

/** The parts of a Trip these functions read. A full Trip fits. */
export type TripDates = Pick<Trip, 'startDate' | 'endDate'>
export type TripPlan = TripDates & Pick<Trip, 'days'>

interface CalendarDay { year: number; month: number; day: number }

/** Parse a strict ISO "yyyy-mm-dd" string. Returns null for anything else,
 *  including impossible dates such as 2026-02-31. */
function parseYmd(value: string | undefined | null): CalendarDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '')
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const probe = new Date(Date.UTC(year, month - 1, day))
  const isRealDate = probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
  return isRealDate ? { year, month, day } : null
}

/** The local calendar day of a Date. */
function localDay(date: Date): CalendarDay {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() }
}

/** Whole days from `from` to `to`. DST-safe: it counts UTC midnights. */
function diffDays(from: CalendarDay, to: CalendarDay): number {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.round((Date.UTC(to.year, to.month - 1, to.day) - Date.UTC(from.year, from.month - 1, from.day)) / msPerDay)
}

/** Order two calendar days: negative when a is before b. */
function compareDays(a: CalendarDay, b: CalendarDay): number {
  return diffDays(b, a)
}

/**
 * Date-bucket rule used by the My trips filter. It reads statusOf, so the filter
 * and the card tag never disagree. "upcoming" covers live and upcoming trips,
 * "past" ended before today, and "draft" has a missing or impossible date. The
 * END date decides, so a trip in progress counts as upcoming.
 */
export function whenBucket(t: TripDates, today: Date): WhenKey {
  const status = statusOf(t, today)
  if (status === 'draft') return 'draft'
  return status === 'past' ? 'past' : 'upcoming'
}

/**
 * Card status. Draft and past follow the end-date rule. A trip that is not past
 * and has started (start day on or before today) is "live". Otherwise it is
 * "upcoming".
 */
export function statusOf(t: TripDates, today: Date): TripStatus {
  const start = parseYmd(t.startDate)
  const end = parseYmd(t.endDate)
  if (!start || !end) return 'draft'
  const todayDay = localDay(today)
  if (compareDays(end, todayDay) < 0) return 'past'
  return compareDays(start, todayDay) <= 0 ? 'live' : 'upcoming'
}

/**
 * The trip to feature as "Up next". Candidates have valid dates, a start that
 * is not after the end, and an end on or after today. The earliest start wins.
 * A tie goes to the trip updated most recently. A tie after that keeps the
 * input order. Returns null when no trip qualifies.
 */
export function pickUpNext<T extends TripDates & Pick<Trip, 'updatedAt'>>(trips: readonly T[], today: Date): T | null {
  const todayDay = localDay(today)
  let best: T | null = null
  let bestStart: CalendarDay | null = null
  for (const trip of trips) {
    const start = parseYmd(trip.startDate)
    const end = parseYmd(trip.endDate)
    const isCandidate = start !== null && end !== null && compareDays(start, end) <= 0 && compareDays(end, todayDay) >= 0
    if (!isCandidate || !start) continue
    if (best === null || bestStart === null) {
      best = trip
      bestStart = start
      continue
    }
    const startOrder = compareDays(start, bestStart)
    const isEarlier = startOrder < 0
    const isTieAndNewer = startOrder === 0 && (trip.updatedAt ?? 0) > (best.updatedAt ?? 0)
    if (isEarlier || isTieAndNewer) {
      best = trip
      bestStart = start
    }
  }
  return best
}

/**
 * Countdown text for a live or upcoming trip: "Day N of M", "Day N",
 * "Starts tomorrow" or "Starts in N days". Returns null for past and draft
 * trips. " of M" shows only when M (days.length) is at least 1 and N <= M.
 */
export function countdownText(t: TripPlan, today: Date): string | null {
  const status = statusOf(t, today)
  const start = parseYmd(t.startDate)
  if (!start || (status !== 'live' && status !== 'upcoming')) return null
  const todayDay = localDay(today)
  if (status === 'live') {
    const dayNumber = diffDays(start, todayDay) + 1
    const totalDays = t.days.length
    const totalIsSensible = totalDays >= 1 && dayNumber <= totalDays
    return totalIsSensible ? `Day ${dayNumber} of ${totalDays}` : `Day ${dayNumber}`
  }
  const daysAway = diffDays(todayDay, start)
  return daysAway === 1 ? 'Starts tomorrow' : `Starts in ${daysAway} days`
}

/**
 * Days with activities against the day count. It is the same measure as the
 * card's next step and the planning bar (`plannedDayRatio`), so an automatic
 * route anchor does not count as a planned day (#647).
 */
export function planning(t: Pick<Trip, 'days'>): { planned: number; total: number } {
  const { planned, total } = plannedDayRatio(t)
  return { planned, total }
}

/**
 * The next-step line a trip card shows. A past trip shows none: the step
 * derivation does not read dates, so a booking left on a trip that already
 * ended would read as a to-do. Every other trip gets what `nextTripStep` returns.
 */
export function cardNextStep(t: Trip, today: Date): NextStep | null {
  if (statusOf(t, today) === 'past') return null
  return nextTripStep(t)
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Short date range, for example "12–15 Mar" or "28 Feb – 2 Mar". The year shows
 * only when a date is outside the year of `today`. Returns "No dates yet" for
 * a missing or invalid date. A reversed range shows in date order.
 */
export function rangeText(t: TripDates, today: Date): string {
  const first = parseYmd(t.startDate)
  const second = parseYmd(t.endDate)
  if (!first || !second) return 'No dates yet'
  const [start, end] = compareDays(first, second) <= 0 ? [first, second] : [second, first]
  const thisYear = today.getFullYear()
  const yearSuffix = start.year !== thisYear || end.year !== thisYear ? ` ${end.year}` : ''
  if (compareDays(start, end) === 0) return `${start.day} ${MONTH_NAMES[start.month - 1]}${yearSuffix}`
  if (start.month === end.month && start.year === end.year) return `${start.day}–${end.day} ${MONTH_NAMES[end.month - 1]}${yearSuffix}`
  return `${start.day} ${MONTH_NAMES[start.month - 1]} – ${end.day} ${MONTH_NAMES[end.month - 1]}${yearSuffix}`
}

export type TripRegion = 'kerala' | 'goa' | 'rajasthan' | 'coorg' | 'meghalaya' | 'kashmir' | 'generic'

const REGION_KEYWORDS: ReadonlyArray<readonly [Exclude<TripRegion, 'generic'>, readonly string[]]> = [
  ['kerala', ['kochi', 'munnar', 'thekkady', 'alleppey', 'kerala']],
  ['goa', ['goa']],
  ['rajasthan', ['jaipur', 'jodhpur', 'udaipur', 'jaisalmer', 'rajasthan']],
  ['coorg', ['coorg', 'madikeri', 'kushalnagar']],
  ['meghalaya', ['shillong', 'cherrapunji', 'dawki', 'meghalaya']],
  ['kashmir', ['srinagar', 'gulmarg', 'pahalgam', 'kashmir']],
]

/** Pick the papercut art region from the destination names. The first region
 *  with a keyword match wins. A keyword matches a whole word only, so "Goalpara"
 *  does not take Goa art. No match returns the neutral "generic" art. */
export function regionFor(t: Pick<Trip, 'destinations'>): TripRegion {
  const words = (t.destinations ?? []).flatMap(name => name.toLowerCase().split(/[^\p{L}]+/u))
  for (const [region, keywords] of REGION_KEYWORDS) {
    const hasMatch = words.some(word => keywords.includes(word))
    if (hasMatch) return region
  }
  return 'generic'
}

export type OtherTripsEmptyKind = 'none' | 'none-other' | 'no-match' | 'no-trips'

/**
 * Which empty state the list under the pinned Up next card shows.
 * `matchCount` counts every trip that passes the filters, the pinned card
 * included. `otherCount` counts the rows under the pinned card.
 *  - 'none': rows exist, so the grid shows.
 *  - 'none-other': only the pinned card matches. No filter hides other trips,
 *    so the copy says there are no other trips yet and offers no Clear button.
 *  - 'no-match': filters hide every trip. Offer Clear filters.
 *  - 'no-trips': no trip matches and no filter is set. The page shows its
 *    first-run copy before this list is reached.
 */
export function otherTripsEmptyKind({ matchCount, otherCount, hasFilters }: {
  matchCount: number
  otherCount: number
  hasFilters: boolean
}): OtherTripsEmptyKind {
  if (otherCount > 0) return 'none'
  if (matchCount > 0) return 'none-other'
  return hasFilters ? 'no-match' : 'no-trips'
}

// ============ The My trips hero ============
// The headline, the stat row, the postcards and the handwritten note all read
// the user's own trips. Each helper takes `today` and the trip list, so none of
// them reads the clock. Trips in the trash never reach these helpers.

/** The parts of a Trip the hero reads. A full Trip fits. */
export type HeroTrip = TripPlan
  & Pick<Trip, 'id' | 'name' | 'startLocation' | 'destinations' | 'updatedAt'>
  & Partial<Pick<Trip, 'members' | 'coverImageUrl' | 'coverEmoji'>>

/** The part of a place name before the first comma: "Kolkata, India" gives
 *  "Kolkata". Empty when the name is blank. */
function shortPlace(name: string): string {
  return name.split(',')[0].trim()
}

/** The key two spellings of one place share: short, trimmed, lower case. */
function placeKey(name: string): string {
  return shortPlace(name).toLowerCase()
}

/**
 * The place the hero names for a trip: the place the Up next card ends at (see
 * lastStop and routeLine), cut at its first comma. A trip with no destination
 * uses its name, then its start place. Returns an empty string when all three
 * are blank.
 */
export function heroPlace(t: Pick<Trip, 'name' | 'startLocation' | 'destinations'>): string {
  const hasDestination = (t.destinations ?? []).some(destination => shortPlace(destination) !== '')
  const candidates = hasDestination ? [lastStop(t), t.name, t.startLocation] : [t.name, t.startLocation]
  for (const candidate of candidates) {
    const place = shortPlace(candidate ?? '')
    if (place) return place
  }
  return ''
}

export interface HeroHeadline {
  /** The plain part of the headline, before the accent. */
  lead: string
  /** The accent: set in italic, with its end stop. */
  accent: string
}

/**
 * The hero headline.
 *  - A trip is up next (see pickUpNext): "Next stop, <heroPlace>.", the same
 *    place its Up next card ends at.
 *  - Trips exist and none is up next: "Plan your next journey."
 *  - Every trip is a draft: "Pick up where you left off."
 *  - No trips: "Your first trip starts here."
 * While the trips read is not settled (`ready` is false) the list may be
 * empty only because it has not arrived, so the headline stays neutral.
 */
export function heroHeadline({ trips, today, ready }: {
  trips: readonly HeroTrip[]
  today: Date
  ready: boolean
}): HeroHeadline {
  if (!ready) return { lead: 'Plan your', accent: 'next journey.' }
  if (trips.length === 0) return { lead: 'Your first trip', accent: 'starts here.' }
  const upNext = pickUpNext(trips, today)
  if (upNext) return { lead: 'Next stop,', accent: `${heroPlace(upNext) || 'your trip'}.` }
  const allAreDrafts = trips.every(t => statusOf(t, today) === 'draft')
  if (allAreDrafts) return { lead: 'Pick up', accent: 'where you left off.' }
  return { lead: 'Plan your', accent: 'next journey.' }
}

export interface HeroStat { label: string; value: number }

/** Roles that can change the plan. A viewer or a commenter is not a co-planner. */
const PLANNER_ROLES: readonly TripMember['role'][] = ['owner', 'editor']

/**
 * The stat row under the hero text: trips, upcoming & live, places and
 * co-planners. Every figure counts real data. A stat that is zero is left out.
 * The list is empty until the trips read has settled, so a loading or failed
 * read never shows a row of zeros.
 *  - "upcoming & live" uses the rule of the "Upcoming & live" filter
 *    (whenBucket), so a trip in progress counts.
 *  - "places" counts unique place names: the part before the first comma,
 *    trimmed and lower case, so "Kochi" and "Kochi, Kerala" count once.
 *  - "co-planners" counts the other people who can edit these trips. A viewer
 *    or a commenter does not count, you do not count, and a person on two
 *    trips counts once.
 */
export function heroStats({ trips, today, meId, ready }: {
  trips: readonly HeroTrip[]
  today: Date
  meId: string | null
  ready: boolean
}): HeroStat[] {
  if (!ready) return []
  const places = new Set<string>()
  const coPlanners = new Set<string>()
  let upcomingAndLive = 0
  for (const t of trips) {
    if (whenBucket(t, today) === 'upcoming') upcomingAndLive += 1
    for (const destination of t.destinations ?? []) {
      const key = placeKey(destination)
      if (key) places.add(key)
    }
    for (const member of t.members ?? []) {
      const canPlan = PLANNER_ROLES.includes(member.role)
      if (canPlan && member.userId !== meId) coPlanners.add(member.userId)
    }
  }
  const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)
  const stats: HeroStat[] = [
    { label: plural(trips.length, 'trip', 'trips'), value: trips.length },
    { label: 'upcoming & live', value: upcomingAndLive },
    { label: plural(places.size, 'place', 'places'), value: places.size },
    { label: plural(coPlanners.size, 'co-planner', 'co-planners'), value: coPlanners.size },
  ]
  return stats.filter(stat => stat.value > 0)
}

export interface HeroPostcard {
  key: string
  /** The caption: the place the trip ends at (see heroPlace). */
  place: string
  region: TripRegion
  /** Original place names for destination and jurisdiction art selection. */
  destinations?: readonly string[]
  /** The trip's start place. It is art evidence only when the stops name nothing. */
  startLocation?: string
  /** Number of distinct stops. It picks road art over city art when the region has no scene. */
  placeCount: number
  /** The trip's own cover image, when it has one. */
  coverImageUrl?: string
  /** The traveller's saved emoji. It is the cover's LAST resort, shown only
   *  when every image is gone — never the compass default in its place. */
  coverEmoji?: string
  /** True for the empty "your next trip" postcard. */
  blank?: boolean
}

export const HERO_POSTCARD_LIMIT = 3

const STATUS_RANK: Record<TripStatus, number> = { live: 0, upcoming: 1, past: 2, draft: 3 }

/**
 * The postcards on the hero, up to three, from the trips that matter most:
 * live trips first, then upcoming ones by start day, then past trips, then
 * drafts, newest edit first. Two trips with the same place give one postcard.
 * With no trips the hero shows one blank "Your next trip" postcard. Until the
 * trips read has settled (`ready` is false) it shows none, so a user who has
 * trips never sees the blank postcard while they load.
 */
export function heroPostcards({ trips, today, ready }: {
  trips: readonly HeroTrip[]
  today: Date
  ready: boolean
}): HeroPostcard[] {
  if (!ready) return []
  if (trips.length === 0) return [{ key: 'blank', place: 'Your next trip', region: 'generic', placeCount: 0, blank: true }]
  const ranked = trips
    .map((t, order) => ({ t, order, status: statusOf(t, today) }))
    .sort((a, b) => {
      if (STATUS_RANK[a.status] !== STATUS_RANK[b.status]) return STATUS_RANK[a.status] - STATUS_RANK[b.status]
      const isDated = a.status === 'live' || a.status === 'upcoming'
      const startOrder = isDated ? a.t.startDate.localeCompare(b.t.startDate) : 0
      if (startOrder !== 0) return startOrder
      return (b.t.updatedAt ?? 0) - (a.t.updatedAt ?? 0) || a.order - b.order
    })
  const cards: HeroPostcard[] = []
  const seenPlaces = new Set<string>()
  for (const { t } of ranked) {
    const place = heroPlace(t)
    const key = place.toLowerCase()
    if (!place || seenPlaces.has(key)) continue
    seenPlaces.add(key)
    cards.push({
      key: t.id,
      place,
      region: regionFor(t),
      destinations: t.destinations,
      startLocation: t.startLocation,
      placeCount: t.destinations?.length ?? 0,
      coverImageUrl: t.coverImageUrl || undefined,
      coverEmoji: t.coverEmoji || undefined,
    })
    if (cards.length === HERO_POSTCARD_LIMIT) break
  }
  return cards
}

/**
 * The handwritten note by the postcards, or null when there is nothing true to
 * say. A trip up next gives its countdown ("12 days to go!" or "Day 2 of 5!").
 * When only drafts exist, the draft you edited last gives "3 of 5 days planned".
 * It is null until the trips read has settled.
 */
export function heroNote({ trips, today, ready }: {
  trips: readonly HeroTrip[]
  today: Date
  ready: boolean
}): string | null {
  if (!ready) return null
  const upNext = pickUpNext(trips, today)
  if (upNext) {
    const start = parseYmd(upNext.startDate)
    if (statusOf(upNext, today) === 'live') {
      const countdown = countdownText(upNext, today)
      return countdown ? `${countdown}!` : null
    }
    if (!start) return null
    const daysAway = diffDays(localDay(today), start)
    return `${daysAway} ${daysAway === 1 ? 'day' : 'days'} to go!`
  }
  const drafts = trips
    .filter(t => statusOf(t, today) === 'draft')
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  if (drafts.length === 0 || drafts.length !== trips.length) return null
  const { planned, total } = planning(drafts[0])
  return planned > 0 && total > 0 ? `${planned} of ${total} days planned` : null
}

// ============ The My trips greeting, soonest sort and Memories ============
// The header greets the viewer and counts their trips. The grid sorts by start
// day. Trips that ended move out of the grid into Memories. Each helper takes
// `today`, so none of them reads the clock.

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_LONG_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The time-of-day word of the greeting: before noon, before 17:00, then evening. */
export function greetingWord(now: Date): 'morning' | 'afternoon' | 'evening' {
  const hour = now.getHours()
  if (hour < 12) return 'morning'
  return hour < 17 ? 'afternoon' : 'evening'
}

/** The date label above the greeting: "Wednesday, 28 October". */
export function greetingDateLabel(now: Date): string {
  return `${WEEKDAY_NAMES[now.getDay()]}, ${now.getDate()} ${MONTH_LONG_NAMES[now.getMonth()]}`
}

/** The first word of a profile name, or an empty string when there is none. */
export function firstNameOf(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? ''
}

/** "Good morning, Asha", or "Good morning" alone when the viewer has no name. */
export function greetingHeadline(name: string | null | undefined, now: Date): string {
  const first = firstNameOf(name)
  const lead = `Good ${greetingWord(now)}`
  return first ? `${lead}, ${first}` : lead
}

export interface GreetingCounts {
  comingUp: number
  drafts: number
  memories: number
}

/**
 * The counts behind the greeting line, from the viewer's own trips.
 *  - comingUp: trips that are live or upcoming (the "Upcoming & live" filter).
 *  - drafts: trips with no usable dates, plus the unfinished trip in the
 *    create form when `hasCreateDraft` is true.
 *  - memories: trips that have ended.
 */
export function greetingCounts({ trips, today, hasCreateDraft }: {
  trips: readonly TripDates[]
  today: Date
  hasCreateDraft: boolean
}): GreetingCounts {
  let comingUp = 0
  let drafts = hasCreateDraft ? 1 : 0
  let memories = 0
  for (const t of trips) {
    const status = statusOf(t, today)
    if (status === 'past') memories += 1
    else if (status === 'draft') drafts += 1
    else comingUp += 1
  }
  return { comingUp, drafts, memories }
}

/**
 * The line under the greeting: "3 trips coming up · 1 draft · 2 memories". A
 * part with a zero count is left out. All zero gives an empty string.
 */
export function countsLine(counts: GreetingCounts): string {
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  const parts: string[] = []
  if (counts.comingUp > 0) parts.push(`${plural(counts.comingUp, 'trip', 'trips')} coming up`)
  if (counts.drafts > 0) parts.push(plural(counts.drafts, 'draft', 'drafts'))
  if (counts.memories > 0) parts.push(plural(counts.memories, 'memory', 'memories'))
  return parts.join(' · ')
}

/**
 * Split trips into those still ahead (live, upcoming, or without dates) and
 * those that ended. Each group keeps the input order.
 */
export function splitByMemory<T extends TripDates>(trips: readonly T[], today: Date): { comingUp: T[]; past: T[] } {
  const comingUp: T[] = []
  const past: T[] = []
  for (const t of trips) (statusOf(t, today) === 'past' ? past : comingUp).push(t)
  return { comingUp, past }
}

/**
 * "Soonest first" order: the earliest start day first. A trip without a usable
 * start day goes last. Two trips on one day, or two without a day, put the
 * trip edited most recently first.
 */
export function compareSoonest(a: Pick<Trip, 'startDate' | 'updatedAt'>, b: Pick<Trip, 'startDate' | 'updatedAt'>): number {
  const first = parseYmd(a.startDate)
  const second = parseYmd(b.startDate)
  if (first && second) {
    const order = compareDays(first, second)
    if (order !== 0) return order
  } else if (first) {
    return -1
  } else if (second) {
    return 1
  }
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
}

export interface DateStamp {
  /** Upper-case weekday: "SAT". */
  weekday: string
  day: number
  /** Short month: "Nov". */
  month: string
}

/** The glass date stamp of a trip, from its start day. Null when there is no usable start day. */
export function dateStamp(t: Pick<Trip, 'startDate'>): DateStamp | null {
  const start = parseYmd(t.startDate)
  if (!start) return null
  const weekday = WEEKDAY_NAMES[new Date(Date.UTC(start.year, start.month - 1, start.day)).getUTCDay()]
  return { weekday: weekday.slice(0, 3).toUpperCase(), day: start.day, month: MONTH_NAMES[start.month - 1] }
}

/**
 * The status line on a trip card.
 *  - No usable dates: "Idea · no dates yet".
 *  - Live: "Live · Day 2 of 5".
 *  - Upcoming and ready to go (see isReadyToGo): "Ready to go".
 *  - Upcoming otherwise: "Planning · 5 of 7 days". When every day is planned
 *    but checks are open: "Planning · 4 to fix", so the line agrees with the
 *    Up next day strip.
 *  - Past: "Past".
 */
export function cardStatusLine(t: TripPlan, today: Date, readyToGo: boolean, toFix = 0): string {
  const status = statusOf(t, today)
  if (status === 'draft') return 'Idea · no dates yet'
  if (status === 'past') return 'Past'
  if (status === 'live') {
    const countdown = countdownText(t, today)
    return countdown ? `Live · ${countdown}` : 'Live'
  }
  if (readyToGo) return 'Ready to go'
  const { planned, total } = planning(t)
  if (total > 0 && planned === total && toFix > 0) return `Planning · ${toFix} to fix`
  return total > 0 ? `Planning · ${planned} of ${total} days` : 'Planning · no days yet'
}

/**
 * The "Your travel so far" figures, over the trips passed in (the past trips).
 * Both are plans, not tracked journeys, so the card labels them "planned".
 *  - kmPlanned: the sum of each trip's planned road distance (`kmOf`).
 *  - withFriends: trips where another person can edit the plan.
 */
export function travelSoFar({ trips, meId, kmOf }: {
  trips: readonly Pick<Trip, 'members'>[]
  meId: string | null
  kmOf: (t: Pick<Trip, 'members'>) => number
}): { kmPlanned: number; withFriends: number } {
  let kmPlanned = 0
  let withFriends = 0
  for (const t of trips) {
    const km = kmOf(t)
    if (Number.isFinite(km)) kmPlanned += km
    const hasFriend = (t.members ?? []).some(m => PLANNER_ROLES.includes(m.role) && m.userId !== meId)
    if (hasFriend) withFriends += 1
  }
  return { kmPlanned, withFriends }
}

/** The button label for a next step: "Plan day", "Book", "Confirm", "Add dates" or "Add cover". Null when the trip needs nothing. */
export function stepActionLabel(kind: NextStepKind): string | null {
  switch (kind) {
    case 'plan-day': return 'Plan day'
    case 'book-stop': return 'Book'
    case 'confirm-stop': return 'Confirm'
    case 'add-dates': return 'Add dates'
    case 'add-cover': return 'Add cover'
    default: return null
  }
}

/**
 * The postmark stamped on a Memories postcard: the place the trip ended at and
 * the month and year it ended, for example "LEH · SEP 26". The month part is
 * left out when the end day is not usable.
 */
export function postmark(t: Pick<Trip, 'name' | 'startLocation' | 'destinations' | 'endDate'>): string {
  const place = heroPlace(t).toUpperCase()
  const end = parseYmd(t.endDate)
  if (!end) return place
  const when = `${MONTH_NAMES[end.month - 1].toUpperCase()} ${String(end.year).slice(-2)}`
  return place ? `${place} · ${when}` : when
}

/** Whole calendar days from `today` to the start day of an upcoming trip. Null for a live, past or dateless trip. */
export function daysUntilStart(t: TripDates, today: Date): number | null {
  const start = parseYmd(t.startDate)
  if (!start || statusOf(t, today) !== 'upcoming') return null
  return diffDays(localDay(today), start)
}
