// ============ Invite recipient copy ============
// The builder behind /join/<code>. The reader was told by a friend to tap a
// link, so the screen removes doubt instead of selling. These rules are the
// contract: an absent fact is dropped, never printed as "0 stops", "₹0",
// "undefined" or a raw id, and the quiet read-only path is always there.
import { describe, expect, it } from 'vitest'
import {
  INVITE_LOOK_FIRST, alreadyMemberCopy, expiredInviteCopy, inviteConfirmCopy,
  inviteDateRange, inviteFirstName, inviteFactParts, inviteReadOnlyFacts,
  invitesStopCount, paidGuidePriceFor, recipientInviteCopy,
} from '../src/lib/inviteLandingCopy'
import type { PublishedItinerary } from '../src/data/types'

const FULL = {
  tripTitle: 'Goa with the gang',
  inviterFirstName: 'Riya',
  route: 'Pune → Goa',
  crew: 4,
  startDate: '2026-12-12',
  endDate: '2026-12-17',
  days: 6,
  stops: 11,
  perPersonBudget: 18400,
  role: 'editor' as const,
  paidGuidePrice: 199,
}

describe('recipient copy with every fact', () => {
  const copy = recipientInviteCopy(FULL)

  it('names the inviter and the trip in the headline', () => {
    expect(copy.headline).toBe('Riya added you to Goa with the gang.')
  })

  it('lists the facts the trip has, in order', () => {
    expect(copy.facts).toBe('12 – 17 Dec · 6 days · 11 stops · ₹18,400 per person budget')
  })

  it('adds the paid-guide note only when a guide is priced', () => {
    expect(copy.paidGuideNote).toBe('Part of this plan is a paid guide (₹199). Joining the crew is free; you only pay if you want the locked days.')
  })

  it('speaks to an editor about voting', () => {
    expect(copy.roleLine).toContain('you can vote on the open decisions')
  })

  it('keeps the quiet read-only path and the three next steps', () => {
    expect(copy.lookFirst).toBe(INVITE_LOOK_FIRST)
    expect(copy.nextSteps).toHaveLength(3)
  })
})

describe('recipient copy with no facts', () => {
  const copy = recipientInviteCopy({ tripTitle: 'Goa with the gang' })

  it('degrades the headline instead of leaving a hole', () => {
    expect(copy.headline).toBe('You were added to Goa with the gang.')
  })

  it('says what the trip is when nothing else is known', () => {
    expect(copy.facts).toBe('A group trip on YatraFlow.')
    expect(copy.paidGuideNote).toBeNull()
  })

  it('says only what both roles share when the role is unknown', () => {
    expect(copy.roleLine).toBe('You’ll see the whole plan: days, stops, drive times and the ₹ split.')
  })
})

describe('role wording', () => {
  it('promises no editing or notifications to a viewer', () => {
    const copy = recipientInviteCopy({ tripTitle: 'Goa', role: 'viewer' })
    expect(copy.roleLine).toContain('No editing, no notifications.')
    expect(copy.roleLine).not.toContain('vote')
  })
})

describe('the signed-in confirm', () => {
  it('asks the question with the facts it has', () => {
    const copy = inviteConfirmCopy({ tripTitle: 'Goa with the gang', inviterFirstName: 'Riya', days: 6, stops: 11 })
    expect(copy.headline).toBe('Join Goa with the gang?')
    expect(copy.sub).toBe('Riya invited you. 6 days · 11 stops.')
    expect(copy.primary).toBe('Join the trip')
    expect(copy.quiet).toBe('Not now')
  })

  it('drops absent counts without leaving a dangling separator', () => {
    const copy = inviteConfirmCopy({ tripTitle: 'Goa', inviterFirstName: 'Riya', days: null, stops: null })
    expect(copy.sub).toBe('Riya invited you.')
  })
})

describe('the expired link', () => {
  const copy = expiredInviteCopy()

  it('offers the code box and the FAQ section that explains codes', () => {
    expect(copy.headline).toBe('This invite link has expired.')
    expect(copy.codeLabel).toBe('Trip code')
    expect(copy.codePlaceholder).toBe('GOA-K7QF')
    expect(copy.codeAction).toBe('Open the trip')
    // A query, not a fragment: the native shell routes on the hash.
    expect(copy.helpHref).toBe('/faq?section=codes')
  })

  it('names the owner only when the name is known', () => {
    expect(copy.body).toBe('Links can be reset by whoever owns the trip. Ask whoever shared it for a fresh one, or enter the code they shared.')
    expect(expiredInviteCopy({ ownerFirstName: 'Riya Sharma' }).body).toContain('Ask Riya for a fresh one')
  })
})

describe('the already-member state', () => {
  it('is not an error and offers the plan', () => {
    expect(alreadyMemberCopy()).toEqual({ headline: 'You’re already on this trip.', action: 'Open the plan' })
  })
})

describe('no blank field reaches the screen', () => {
  const forbidden = ['undefined', '₹0', '0 stops', '0 days', 'NaN', 'null']
  const copies = [
    recipientInviteCopy({}),
    recipientInviteCopy({ tripTitle: '   ', days: 0, stops: 0, perPersonBudget: 0 }),
    recipientInviteCopy({ tripTitle: 'Goa', days: null, stops: null, perPersonBudget: Number.NaN }),
    recipientInviteCopy({ tripTitle: 'Goa', perPersonBudget: -400, days: -1 }),
  ]

  it.each(copies.map((copy, index) => [index, copy] as const))('copy %i reads clean', (_index, copy) => {
    const text = [copy.headline, copy.facts, copy.roleLine, copy.underPrimary, copy.lookFirst, ...copy.nextSteps, copy.paidGuideNote ?? ''].join(' ')
    for (const token of forbidden) expect(text).not.toContain(token)
  })

  it('never prints a zero-count fact', () => {
    expect(inviteFactParts({ days: 0, stops: 0, perPersonBudget: 0 })).toEqual([])
  })
})

describe('the read-only rows', () => {
  it('drops every row it does not have', () => {
    expect(inviteReadOnlyFacts({})).toEqual([])
    const rows = inviteReadOnlyFacts(FULL)
    expect(rows.map(row => row.label)).toEqual(['Route', 'Dates', 'Days', 'Stops', 'Crew', 'Budget'])
  })
})

describe('counting and lookup helpers', () => {
  it('counts stops across days and skips a day the server withheld', () => {
    expect(invitesStopCount([
      { stops: [1, 2, 3] },
      { stops: [1] },
    ])).toBe(4)
    expect(invitesStopCount([{ stops: [1, 2] }, { stops: null }, { stops: [1], locked: true }])).toBe(2)
    expect(invitesStopCount(null)).toBe(0)
  })

  it('takes the first name only', () => {
    expect(inviteFirstName('Riya Sharma')).toBe('Riya')
    expect(inviteFirstName('   ')).toBeNull()
    expect(inviteFirstName(undefined)).toBeNull()
  })

  it('formats a range without inventing a second date', () => {
    expect(inviteDateRange('2026-12-12', '2026-12-17')).toBe('12 – 17 Dec')
    expect(inviteDateRange('2026-12-12', '2026-12-12')).toBe('12 Dec')
    expect(inviteDateRange('2026-12-28', '2027-01-03')).toBe('28 Dec 2026 – 3 Jan')
    expect(inviteDateRange(null, null)).toBeNull()
  })

  it('finds a live paid publication and ignores a free or unpublished one', () => {
    const pub = (over: Partial<PublishedItinerary>): PublishedItinerary => ({
      id: 'pub', tripId: 'trip-1', creatorId: 'c', title: 't', tagline: '', routeSummary: [], durationDays: 3,
      estimatedBudgetPerPersonInr: 1000, travelStyle: 'balanced', travelTips: [], warningsAndAssumptions: [],
      freeDayIndexes: [0], publishedAt: 1, views: 0, copies: 0, ...over,
    })
    expect(paidGuidePriceFor('trip-1', [pub({}), pub({ id: 'b', premiumPriceInr: 249 })])).toBe(249)
    expect(paidGuidePriceFor('trip-1', [pub({ premiumPriceInr: 249, unpublishedAt: 5 })])).toBeNull()
    expect(paidGuidePriceFor('trip-2', [pub({ premiumPriceInr: 249 })])).toBeNull()
  })
})
