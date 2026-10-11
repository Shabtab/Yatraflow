// ============ My trips page — pure logic ============
import { describe, expect, it } from 'vitest'
import { countdownText, heroHeadline, heroNote, heroPostcards, heroStats, nextStep, otherTripsEmptyKind, pickUpNext, planning, rangeText, regionFor, statusOf, whenBucket, type HeroTrip } from '../src/lib/tripsPage'
import { routeLine } from '../src/lib/tripsCard'
import type { ItineraryDay, StopStatus } from '../src/data/types'

// Local noon on 2026-10-10: far from any day boundary.
const TODAY = new Date(2026, 9, 10, 12, 0, 0)

type StopSpec = [title: string, status: StopStatus]
let dayCounter = 0
function day(...stops: StopSpec[]): ItineraryDay {
  dayCounter += 1
  return {
    id: `d${dayCounter}`,
    index: 0,
    stops: stops.map(([title, status]) => ({ title, status })),
  } as unknown as ItineraryDay
}
const emptyDays = (n: number) => Array.from({ length: n }, () => day())

function trip(startDate: string, endDate: string, days: ItineraryDay[] = emptyDays(3), updatedAt = 0) {
  return { startDate, endDate, days, updatedAt, destinations: [] as string[] }
}

describe('whenBucket (behaviour kept from TripsList)', () => {
  it('calls a trip past only after its end day', () => {
    expect(whenBucket(trip('2026-10-05', '2026-10-09'), TODAY)).toBe('past')
    expect(whenBucket(trip('2026-10-05', '2026-10-10'), TODAY)).toBe('upcoming')
    expect(whenBucket(trip('2026-10-08', '2026-10-12'), TODAY)).toBe('upcoming')
  })
  it('treats invalid or empty dates as draft', () => {
    expect(whenBucket(trip('', ''), TODAY)).toBe('draft')
    expect(whenBucket(trip('2026-10-05', 'soon'), TODAY)).toBe('draft')
  })
  it('lets the end date decide, even when the end is before the start', () => {
    expect(whenBucket(trip('2026-11-05', '2026-10-01'), TODAY)).toBe('past')
  })
  it('treats an impossible calendar date as draft, not as a rolled-over day', () => {
    expect(whenBucket(trip('2026-02-31', '2026-03-02'), TODAY)).toBe('draft')
    expect(whenBucket(trip('2026-10-05', '2026-02-30'), TODAY)).toBe('draft')
  })
})

describe('statusOf', () => {
  it('is live on the first day', () => {
    expect(statusOf(trip('2026-10-10', '2026-10-13'), TODAY)).toBe('live')
  })
  it('is live on the last day, even late in the day', () => {
    const lateEvening = new Date(2026, 9, 13, 23, 59, 59)
    expect(statusOf(trip('2026-10-10', '2026-10-13'), lateEvening)).toBe('live')
  })
  it('is live for a one-day trip today', () => {
    expect(statusOf(trip('2026-10-10', '2026-10-10'), TODAY)).toBe('live')
  })
  it('is upcoming when the start is after today', () => {
    expect(statusOf(trip('2026-10-11', '2026-10-13'), TODAY)).toBe('upcoming')
  })
  it('is past the day after the end', () => {
    expect(statusOf(trip('2026-10-05', '2026-10-09'), TODAY)).toBe('past')
    expect(statusOf(trip('2026-10-05', '2026-10-09'), new Date(2026, 9, 9, 0, 0, 1))).toBe('live')
  })
  it('is draft for empty, malformed or impossible dates', () => {
    expect(statusOf(trip('', ''), TODAY)).toBe('draft')
    expect(statusOf(trip('2026-10-10', ''), TODAY)).toBe('draft')
    expect(statusOf(trip('10/10/2026', '2026-10-12'), TODAY)).toBe('draft')
    expect(statusOf(trip('2026-02-31', '2026-03-02'), TODAY)).toBe('draft')
  })
  it('agrees with whenBucket on every status, including impossible dates', () => {
    const samples = [
      trip('2026-10-05', '2026-10-09'),
      trip('', ''),
      trip('2026-10-10', '2026-10-12'),
      trip('2026-12-01', '2026-12-03'),
      trip('2026-02-31', '2026-03-02'),
      trip('2026-10-05', '2026-02-30'),
      trip('2026-10-09', '2026-10-12'),
    ]
    const expectedBucket = { live: 'upcoming', upcoming: 'upcoming', past: 'past', draft: 'draft' } as const
    for (const sample of samples) {
      const status = statusOf(sample, TODAY)
      expect(whenBucket(sample, TODAY)).toBe(expectedBucket[status])
    }
  })
  it('does not shift the day with the time of day', () => {
    const justAfterMidnight = new Date(2026, 9, 10, 0, 0, 1)
    expect(statusOf(trip('2026-10-10', '2026-10-12'), justAfterMidnight)).toBe('live')
    expect(statusOf(trip('2026-10-11', '2026-10-12'), justAfterMidnight)).toBe('upcoming')
  })
  it('treats a reversed range by its end date', () => {
    expect(statusOf(trip('2026-11-05', '2026-10-01'), TODAY)).toBe('past')
    expect(statusOf(trip('2026-11-05', '2026-10-20'), TODAY)).toBe('upcoming')
  })
})

describe('pickUpNext', () => {
  it('picks the live or earliest upcoming trip', () => {
    const live = trip('2026-10-09', '2026-10-12')
    const soon = trip('2026-10-20', '2026-10-22')
    const later = trip('2026-12-01', '2026-12-05')
    expect(pickUpNext([later, soon, live], TODAY)).toBe(live)
    expect(pickUpNext([later, soon], TODAY)).toBe(soon)
  })
  it('skips past, draft and reversed trips', () => {
    const past = trip('2026-09-01', '2026-09-03')
    const draft = trip('', '')
    const reversed = trip('2026-11-05', '2026-11-01')
    const good = trip('2026-12-01', '2026-12-03')
    expect(pickUpNext([past, draft, reversed, good], TODAY)).toBe(good)
  })
  it('includes a trip that ends today', () => {
    const endsToday = trip('2026-10-08', '2026-10-10')
    expect(pickUpNext([endsToday], TODAY)).toBe(endsToday)
  })
  it('breaks a start-date tie with the most recently updated trip', () => {
    const older = trip('2026-10-20', '2026-10-22', emptyDays(3), 100)
    const newer = trip('2026-10-20', '2026-10-25', emptyDays(3), 200)
    expect(pickUpNext([older, newer], TODAY)).toBe(newer)
    expect(pickUpNext([newer, older], TODAY)).toBe(newer)
  })
  it('keeps input order on a full tie', () => {
    const first = trip('2026-10-20', '2026-10-22', emptyDays(3), 100)
    const second = trip('2026-10-20', '2026-10-22', emptyDays(3), 100)
    expect(pickUpNext([first, second], TODAY)).toBe(first)
  })
  it('returns null when nothing qualifies', () => {
    expect(pickUpNext([], TODAY)).toBeNull()
    expect(pickUpNext([trip('2026-09-01', '2026-09-03'), trip('', '')], TODAY)).toBeNull()
  })
})

describe('countdownText', () => {
  it('says "Day 1 of M" on the first day', () => {
    expect(countdownText(trip('2026-10-10', '2026-10-13', emptyDays(4)), TODAY)).toBe('Day 1 of 4')
  })
  it('says "Day N of M" on the last day', () => {
    expect(countdownText(trip('2026-10-07', '2026-10-10', emptyDays(4)), TODAY)).toBe('Day 4 of 4')
  })
  it('drops " of M" when N is more than M', () => {
    expect(countdownText(trip('2026-10-07', '2026-10-12', emptyDays(2)), TODAY)).toBe('Day 4')
  })
  it('drops " of M" when the trip has no days', () => {
    expect(countdownText(trip('2026-10-09', '2026-10-12', []), TODAY)).toBe('Day 2')
  })
  it('says "Starts tomorrow" for a start one day away', () => {
    expect(countdownText(trip('2026-10-11', '2026-10-13'), TODAY)).toBe('Starts tomorrow')
  })
  it('says "Starts in N days" otherwise', () => {
    expect(countdownText(trip('2026-10-12', '2026-10-13'), TODAY)).toBe('Starts in 2 days')
    expect(countdownText(trip('2026-11-10', '2026-11-13'), TODAY)).toBe('Starts in 31 days')
  })
  it('counts calendar days across a month and year end', () => {
    const lateDecember = new Date(2026, 11, 30, 23, 30, 0)
    expect(countdownText(trip('2027-01-01', '2027-01-03'), lateDecember)).toBe('Starts in 2 days')
  })
  it('returns null for past and draft trips', () => {
    expect(countdownText(trip('2026-09-01', '2026-09-03'), TODAY)).toBeNull()
    expect(countdownText(trip('', ''), TODAY)).toBeNull()
  })
})

describe('planning', () => {
  it('counts days that have a stop that is not rejected', () => {
    const days = [
      day(['A', 'confirmed']),
      day(['B', 'rejected']),
      day(['C', 'rejected'], ['D', 'maybe']),
      day(),
    ]
    expect(planning({ days })).toEqual({ planned: 2, total: 4 })
  })
  it('handles a trip with no days', () => {
    expect(planning({ days: [] })).toEqual({ planned: 0, total: 0 })
  })
})

describe('nextStep', () => {
  const days = [
    day(['Early', 'needs-booking']),
    day(['Fine', 'confirmed']),
    day(['Boat safari', 'needs-booking'], ['Other', 'needs-booking']),
  ]
  it('skips days that are already past', () => {
    expect(nextStep(trip('2026-10-09', '2026-10-11', days), TODAY)).toEqual({ day: 3, title: 'Boat safari' })
  })
  it('starts at day 1 for a trip that has not started', () => {
    expect(nextStep(trip('2026-10-20', '2026-10-22', days), TODAY)).toEqual({ day: 1, title: 'Early' })
  })
  it('starts at day 1 when the start date is invalid', () => {
    expect(nextStep(trip('', '', days), TODAY)).toEqual({ day: 1, title: 'Early' })
  })
  it('returns null when nothing needs booking from today on', () => {
    expect(nextStep(trip('2026-10-05', '2026-10-12', days), TODAY)).toBeNull()
    expect(nextStep(trip('2026-10-10', '2026-10-12', []), TODAY)).toBeNull()
  })
})

describe('rangeText', () => {
  it('shortens a range in one month', () => {
    expect(rangeText(trip('2026-10-12', '2026-10-15'), TODAY)).toBe('12–15 Oct')
  })
  it('names both months across a month end', () => {
    expect(rangeText(trip('2026-10-28', '2026-11-02'), TODAY)).toBe('28 Oct – 2 Nov')
  })
  it('shows a single day once', () => {
    expect(rangeText(trip('2026-10-12', '2026-10-12'), TODAY)).toBe('12 Oct')
  })
  it('adds the year when a date is outside this year', () => {
    expect(rangeText(trip('2026-12-28', '2027-01-03'), TODAY)).toBe('28 Dec – 3 Jan 2027')
    expect(rangeText(trip('2027-03-12', '2027-03-15'), TODAY)).toBe('12–15 Mar 2027')
  })
  it('says "No dates yet" for missing or invalid dates', () => {
    expect(rangeText(trip('', ''), TODAY)).toBe('No dates yet')
    expect(rangeText(trip('2026-10-12', 'x'), TODAY)).toBe('No dates yet')
  })
  it('shows a reversed range in date order', () => {
    expect(rangeText(trip('2026-10-15', '2026-10-12'), TODAY)).toBe('12–15 Oct')
  })
})

describe('regionFor', () => {
  it('maps destination names to a region, ignoring case', () => {
    expect(regionFor({ destinations: ['Munnar', 'Thekkady'] })).toBe('kerala')
    expect(regionFor({ destinations: ['NORTH GOA'] })).toBe('goa')
    expect(regionFor({ destinations: ['Jodhpur'] })).toBe('rajasthan')
    expect(regionFor({ destinations: ['Madikeri'] })).toBe('coorg')
    expect(regionFor({ destinations: ['Cherrapunji'] })).toBe('meghalaya')
    expect(regionFor({ destinations: ['Srinagar'] })).toBe('kashmir')
  })
  it('matches a keyword inside a longer name', () => {
    expect(regionFor({ destinations: ['Old Goa Heritage Walk'] })).toBe('goa')
  })
  it('falls back to neutral art', () => {
    expect(regionFor({ destinations: ['Hampi', 'Gokarna'] })).toBe('generic')
    expect(regionFor({ destinations: [] })).toBe('generic')
  })
  it('matches Goa only as a whole word, so Goalpara gets neutral art', () => {
    expect(regionFor({ destinations: ['Goalpara'] })).toBe('generic')
    expect(regionFor({ destinations: ['Goalpara', 'Goa'] })).toBe('goa')
    expect(regionFor({ destinations: ['Panjim, Goa'] })).toBe('goa')
    expect(regionFor({ destinations: ['Goa-Kerala loop'] })).toBe('kerala')
  })
})

describe('otherTripsEmptyKind', () => {
  it('shows the grid when rows sit under the pinned card, filters or not', () => {
    expect(otherTripsEmptyKind({ matchCount: 3, otherCount: 2, hasFilters: false })).toBe('none')
    expect(otherTripsEmptyKind({ matchCount: 3, otherCount: 2, hasFilters: true })).toBe('none')
  })
  it('says there are no other trips when only the pinned Up next matches, with no filter', () => {
    expect(otherTripsEmptyKind({ matchCount: 1, otherCount: 0, hasFilters: false })).toBe('none-other')
  })
  it('says there are no other trips when the one Up next trip still matches a sort or style filter', () => {
    expect(otherTripsEmptyKind({ matchCount: 1, otherCount: 0, hasFilters: true })).toBe('none-other')
  })
  it('offers Clear filters when a search or filter hides every trip', () => {
    expect(otherTripsEmptyKind({ matchCount: 0, otherCount: 0, hasFilters: true })).toBe('no-match')
  })
  it('reports no trips at all when nothing matches and no filter is set', () => {
    expect(otherTripsEmptyKind({ matchCount: 0, otherCount: 0, hasFilters: false })).toBe('no-trips')
  })
})

// ---- The hero ----------------------------------------------------------------

let heroCounter = 0
function heroTrip(over: Partial<HeroTrip> & { startDate: string; endDate: string }): HeroTrip {
  heroCounter += 1
  return {
    id: `t${heroCounter}`,
    name: `Trip ${heroCounter}`,
    startLocation: 'Pune',
    destinations: [],
    days: emptyDays(3),
    updatedAt: heroCounter,
    ...over,
  }
}
const goa = heroTrip({ id: 'goa', name: 'Goa break', destinations: ['Goa', 'Panjim'], startDate: '2026-10-20', endDate: '2026-10-23' })
const kerala = heroTrip({ id: 'kerala', name: 'Backwaters', destinations: ['Kochi'], startDate: '2026-12-01', endDate: '2026-12-05' })
const pastTrip = heroTrip({ id: 'past', name: 'Old loop', destinations: ['Jaipur'], startDate: '2026-01-02', endDate: '2026-01-05' })
const draftTrip = heroTrip({ id: 'draft', name: 'Someday', destinations: ['Hampi'], startDate: '', endDate: '', days: [day(['Temple', 'planned']), day(), day()] })

describe('heroHeadline', () => {
  it('names the place the Up next card ends at, not the first destination', () => {
    // goa runs Pune -> Goa -> Panjim, so its card reads "Pune → Panjim".
    expect(routeLine(goa)).toBe('Pune → Panjim · 3 days')
    expect(heroHeadline({ trips: [kerala, goa], today: TODAY, ready: true })).toEqual({ lead: 'Next stop,', accent: 'Panjim.' })
  })
  it('cuts the place at its first comma', () => {
    const abroad = heroTrip({ destinations: ['Delhi', 'Kolkata, India'], startDate: '2026-10-20', endDate: '2026-10-21' })
    expect(heroHeadline({ trips: [abroad], today: TODAY, ready: true }).accent).toBe('Kolkata.')
  })
  it('names the same place as the card for a trip with several destinations', () => {
    const route = heroTrip({ startLocation: 'Mumbai', destinations: ['Old Goa', 'North Goa'], startDate: '2026-10-20', endDate: '2026-10-21' })
    expect(routeLine(route)).toContain('→ North Goa')
    expect(heroHeadline({ trips: [route], today: TODAY, ready: true }).accent).toBe('North Goa.')
  })
  it('keeps a long place name whole so the headline can wrap it', () => {
    const long = heroTrip({ destinations: ['Thiruvananthapuram International Airport Road'], startDate: '2026-10-20', endDate: '2026-10-21' })
    expect(heroHeadline({ trips: [long], today: TODAY, ready: true }).accent).toBe('Thiruvananthapuram International Airport Road.')
  })
  it('falls back to the trip name when the up next trip has no destination', () => {
    const bare = heroTrip({ name: '  Weekend away ', startDate: '2026-10-20', endDate: '2026-10-21' })
    expect(heroHeadline({ trips: [bare], today: TODAY, ready: true }).accent).toBe('Weekend away.')
  })
  it('skips a blank last destination', () => {
    const blankLast = heroTrip({ destinations: ['Udaipur', '  '], startDate: '2026-10-20', endDate: '2026-10-21' })
    expect(heroHeadline({ trips: [blankLast], today: TODAY, ready: true }).accent).toBe('Udaipur.')
    expect(routeLine(blankLast)).toContain('→ Udaipur')
  })
  it('asks for the next journey when trips exist and none is up next', () => {
    expect(heroHeadline({ trips: [pastTrip], today: TODAY, ready: true })).toEqual({ lead: 'Plan your', accent: 'next journey.' })
    expect(heroHeadline({ trips: [pastTrip, draftTrip], today: TODAY, ready: true }).accent).toBe('next journey.')
  })
  it('asks the user to pick up where they left off when every trip is a draft', () => {
    expect(heroHeadline({ trips: [draftTrip], today: TODAY, ready: true })).toEqual({ lead: 'Pick up', accent: 'where you left off.' })
  })
  it('says the first trip starts here when there are no trips', () => {
    expect(heroHeadline({ trips: [], today: TODAY, ready: true })).toEqual({ lead: 'Your first trip', accent: 'starts here.' })
  })
  it('stays neutral until the trips read has settled', () => {
    expect(heroHeadline({ trips: [], today: TODAY, ready: false }).accent).toBe('next journey.')
    expect(heroHeadline({ trips: [goa], today: TODAY, ready: false }).accent).toBe('next journey.')
  })
})

describe('heroStats', () => {
  const withCrew = heroTrip({
    destinations: ['Goa', 'Mumbai'], startDate: '2026-10-20', endDate: '2026-10-22',
    members: [
      { userId: 'me', role: 'owner', joinedAt: 1 },
      { userId: 'asha', role: 'editor', joinedAt: 2 },
    ],
  })
  const secondCrew = heroTrip({
    destinations: ['goa ', 'Pune'], startDate: '2026-01-02', endDate: '2026-01-04',
    members: [
      { userId: 'me', role: 'owner', joinedAt: 1 },
      { userId: 'asha', role: 'viewer', joinedAt: 2 },
      { userId: 'ravi', role: 'editor', joinedAt: 3 },
    ],
  })
  it('counts trips, upcoming and live trips, unique places and the other editors', () => {
    expect(heroStats({ trips: [withCrew, secondCrew], today: TODAY, meId: 'me', ready: true })).toEqual([
      { label: 'trips', value: 2 },
      { label: 'upcoming & live', value: 1 },
      { label: 'places', value: 3 },
      { label: 'co-planners', value: 2 },
    ])
  })
  it('counts a live trip in the upcoming & live stat, the rule the filter uses', () => {
    const live = heroTrip({ startDate: '2026-10-09', endDate: '2026-10-12' })
    expect(whenBucket(live, TODAY)).toBe('upcoming')
    expect(heroStats({ trips: [live], today: TODAY, meId: null, ready: true })).toEqual([
      { label: 'trip', value: 1 },
      { label: 'upcoming & live', value: 1 },
    ])
  })
  it('does not count past or draft trips as upcoming & live', () => {
    const stats = heroStats({ trips: [pastTrip, draftTrip], today: TODAY, meId: null, ready: true })
    expect(stats.find(stat => stat.label === 'upcoming & live')).toBeUndefined()
  })
  it('counts a place once however it is spelled', () => {
    const spellings = heroTrip({ destinations: ['Kochi', 'Kochi, Kerala', ' kochi ', 'Alleppey'], startDate: '2026-10-20', endDate: '2026-10-21' })
    const stats = heroStats({ trips: [spellings], today: TODAY, meId: null, ready: true })
    expect(stats.find(stat => stat.label === 'places')?.value).toBe(2)
  })
  it('does not count viewers or commenters as co-planners', () => {
    const crew = heroTrip({
      startDate: '2026-10-20', endDate: '2026-10-21',
      members: [
        { userId: 'me', role: 'owner', joinedAt: 1 },
        { userId: 'vik', role: 'viewer', joinedAt: 2 },
        { userId: 'cam', role: 'commenter', joinedAt: 3 },
      ],
    })
    const stats = heroStats({ trips: [crew], today: TODAY, meId: 'me', ready: true })
    expect(stats.find(stat => stat.label.startsWith('co-planner'))).toBeUndefined()
  })
  it('counts an owner who is not you, and a person on two trips once', () => {
    const first = heroTrip({ startDate: '2026-10-20', endDate: '2026-10-21', members: [
      { userId: 'me', role: 'editor', joinedAt: 1 }, { userId: 'asha', role: 'owner', joinedAt: 2 },
    ] })
    const second = heroTrip({ startDate: '2026-11-20', endDate: '2026-11-21', members: [
      { userId: 'asha', role: 'editor', joinedAt: 1 }, { userId: 'me', role: 'owner', joinedAt: 2 },
    ] })
    const stats = heroStats({ trips: [first, second], today: TODAY, meId: 'me', ready: true })
    expect(stats.find(stat => stat.label === 'co-planner')?.value).toBe(1)
  })
  it('hides every stat that is zero', () => {
    const stats = heroStats({ trips: [pastTrip], today: TODAY, meId: 'me', ready: true })
    expect(stats.map(stat => stat.label)).toEqual(['trip', 'place'])
    expect(stats.every(stat => stat.value > 0)).toBe(true)
  })
  it('uses singular labels for a count of one, all in lower case', () => {
    const one = heroTrip({
      destinations: ['Goa'], startDate: '2026-10-20', endDate: '2026-10-21',
      members: [{ userId: 'me', role: 'owner', joinedAt: 1 }, { userId: 'asha', role: 'editor', joinedAt: 2 }],
    })
    const labels = heroStats({ trips: [one], today: TODAY, meId: 'me', ready: true }).map(stat => stat.label)
    expect(labels).toEqual(['trip', 'upcoming & live', 'place', 'co-planner'])
    expect(labels.every(label => label === label.toLowerCase())).toBe(true)
  })
  it('returns no stats for zero trips', () => {
    expect(heroStats({ trips: [], today: TODAY, meId: 'me', ready: true })).toEqual([])
  })
  it('returns no stats while the trips read is loading or failed', () => {
    expect(heroStats({ trips: [withCrew], today: TODAY, meId: 'me', ready: false })).toEqual([])
  })
})

describe('heroPostcards', () => {
  it('shows one blank postcard when there are no trips', () => {
    const cards = heroPostcards({ trips: [], today: TODAY, ready: true })
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ blank: true, place: 'Your next trip', region: 'generic' })
  })
  it('shows no postcard, not even the blank one, until the trips read has settled', () => {
    expect(heroPostcards({ trips: [], today: TODAY, ready: false })).toEqual([])
    expect(heroPostcards({ trips: [goa], today: TODAY, ready: false })).toEqual([])
  })
  it('captions each postcard with the place the trip ends at and picks its art region', () => {
    const cards = heroPostcards({ trips: [goa], today: TODAY, ready: true })
    expect(cards).toEqual([{ key: 'goa', place: 'Panjim', region: 'goa', coverImageUrl: undefined }])
  })
  it('cuts a caption at its first comma', () => {
    const abroad = heroTrip({ id: 'k', destinations: ['Kolkata, India'], startDate: '2026-10-20', endDate: '2026-10-21' })
    expect(heroPostcards({ trips: [abroad], today: TODAY, ready: true })[0].place).toBe('Kolkata')
  })
  it('uses the trip cover image when it has one', () => {
    const withCover = heroTrip({ destinations: ['Goa'], startDate: '2026-10-20', endDate: '2026-10-21', coverImageUrl: 'https://example.test/c.jpg' })
    expect(heroPostcards({ trips: [withCover], today: TODAY, ready: true })[0].coverImageUrl).toBe('https://example.test/c.jpg')
  })
  it('orders live, then upcoming by start day, then past trips, then drafts', () => {
    const live = heroTrip({ id: 'live', destinations: ['Coorg'], startDate: '2026-10-09', endDate: '2026-10-12' })
    const cards = heroPostcards({ trips: [pastTrip, draftTrip, kerala, goa, live], today: TODAY, ready: true })
    expect(cards.map(card => card.key)).toEqual(['live', 'goa', 'kerala'])
    const fewer = heroPostcards({ trips: [draftTrip, pastTrip], today: TODAY, ready: true })
    expect(fewer.map(card => card.key)).toEqual(['past', 'draft'])
  })
  it('puts a past trip ahead of a draft when only one slot is left', () => {
    const live = heroTrip({ id: 'live', destinations: ['Coorg'], startDate: '2026-10-09', endDate: '2026-10-12' })
    const upcoming = heroTrip({ id: 'up', destinations: ['Goa'], startDate: '2026-10-20', endDate: '2026-10-21' })
    const cards = heroPostcards({ trips: [draftTrip, pastTrip, live, upcoming], today: TODAY, ready: true })
    expect(cards.map(card => card.key)).toEqual(['live', 'up', 'past'])
  })
  it('gives one postcard to two trips that end at the same place', () => {
    const goaAgain = heroTrip({ id: 'goa2', destinations: [' panjim, Goa'], startDate: '2026-11-01', endDate: '2026-11-03' })
    expect(heroPostcards({ trips: [goa, goaAgain], today: TODAY, ready: true }).map(card => card.key)).toEqual(['goa'])
  })
  it('never returns more than three', () => {
    const many = ['Goa', 'Kochi', 'Jaipur', 'Shillong', 'Srinagar'].map((place, i) =>
      heroTrip({ destinations: [place], startDate: `2026-11-0${i + 1}`, endDate: `2026-11-0${i + 2}` }))
    expect(heroPostcards({ trips: many, today: TODAY, ready: true })).toHaveLength(3)
  })
})

describe('heroNote', () => {
  it('counts the days to the trip that is up next', () => {
    expect(heroNote({ trips: [goa], today: TODAY, ready: true })).toBe('10 days to go!')
  })
  it('uses the singular for one day', () => {
    const tomorrow = heroTrip({ startDate: '2026-10-11', endDate: '2026-10-12' })
    expect(heroNote({ trips: [tomorrow], today: TODAY, ready: true })).toBe('1 day to go!')
  })
  it('names the day of a live trip', () => {
    const live = heroTrip({ startDate: '2026-10-09', endDate: '2026-10-12', days: emptyDays(4) })
    expect(heroNote({ trips: [live], today: TODAY, ready: true })).toBe('Day 2 of 4!')
  })
  it('reports how many days a draft has planned when only drafts exist', () => {
    expect(heroNote({ trips: [draftTrip], today: TODAY, ready: true })).toBe('1 of 3 days planned')
  })
  it('says nothing when there is nothing true to say', () => {
    expect(heroNote({ trips: [], today: TODAY, ready: true })).toBeNull()
    expect(heroNote({ trips: [pastTrip], today: TODAY, ready: true })).toBeNull()
    const emptyDraft = heroTrip({ startDate: '', endDate: '', days: emptyDays(3) })
    expect(heroNote({ trips: [emptyDraft], today: TODAY, ready: true })).toBeNull()
  })
  it('says nothing until the trips read has settled', () => {
    expect(heroNote({ trips: [goa], today: TODAY, ready: false })).toBeNull()
  })
})
