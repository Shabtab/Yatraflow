// ============ Invite recipient copy ============
// The words on /join/<code>. The reader was told by a friend to tap a link, is
// probably on a phone, and has never heard of YatraFlow. Every state is one
// screen: headline, facts, one primary action, one reassurance.
//
// The builder is pure so the rules are testable without a router or a store:
//   - An optional fact that the trip does not have is dropped, never printed as
//     "0 stops", "₹0", "undefined" or a raw id.
//   - A missing inviter name degrades the sentence instead of leaving a hole.
//   - The invite's role decides the two role lines. The preview read carries no
//     role, so a role it does not know says what both roles share.
import type { PublishedItinerary } from '../data/types'
import { formatInr } from './engine'

/** The role the invite link admits. Null means the read did not carry it. */
export type InviteRole = 'editor' | 'viewer' | null

/** What the invite screen knows about the trip. Every field but the title is optional. */
export interface InviteFacts {
  tripTitle?: string | null
  /** The route line, already joined ("Goa → Coorg"). */
  route?: string | null
  /** How many people plan it. Absent when the read did not carry a crew. */
  crew?: number | null
  inviterFirstName?: string | null
  startDate?: string | null
  endDate?: string | null
  days?: number | null
  stops?: number | null
  perPersonEst?: number | null
  role?: InviteRole
  /** A paid guide's price, in rupees. Absent means no locked days. */
  paidGuidePrice?: number | null
}

export interface InviteRecipientCopy {
  headline: string
  /** The facts line. Never empty: a trip with no facts says what it is. */
  facts: string
  roleLine: string
  primary: string
  underPrimary: string
  lookFirst: string
  nextSteps: string[]
  /** The paid-guide note, or null when no guide is priced. */
  paidGuideNote: string | null
}

export interface InviteConfirmCopy {
  headline: string
  sub: string
  primary: string
  quiet: string
}

export interface InviteExpiredCopy {
  headline: string
  body: string
  codeLabel: string
  codePlaceholder: string
  codeAction: string
  helpLabel: string
  helpHref: `/${string}`
}

export interface InviteMemberCopy {
  headline: string
  action: string
}

/** The read-only rows behind "Just look at it first": what the invite knows,
 *  with every absent row dropped. */
export function inviteReadOnlyFacts(facts: InviteFacts): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = []
  const route = typeof facts.route === 'string' ? facts.route.trim() : ''
  if (route) rows.push({ label: 'Route', value: route })
  const dates = inviteDateRange(facts.startDate, facts.endDate)
  if (dates) rows.push({ label: 'Dates', value: dates })
  const days = dayNumber(facts.days)
  if (days) rows.push({ label: 'Days', value: String(days) })
  const stops = dayNumber(facts.stops)
  if (stops) rows.push({ label: 'Stops', value: String(stops) })
  const crew = dayNumber(facts.crew)
  if (crew) rows.push({ label: 'Crew', value: `${crew} ${crew === 1 ? 'planner' : 'planners'}` })
  const perPerson = typeof facts.perPersonEst === 'number' && Number.isFinite(facts.perPersonEst) && facts.perPersonEst > 0
    ? Math.round(facts.perPersonEst)
    : null
  if (perPerson) rows.push({ label: 'Estimate', value: `About ${formatInr(perPerson)} per person` })
  return rows
}

/** The quiet secondary path. It is always present and always quieter than joining. */
export const INVITE_LOOK_FIRST = 'Just look at it first'

/** Only the head of a name reaches this screen: first name or handle, never a full name. */
export function inviteFirstName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null
  const first = name.trim().split(/\s+/)[0]
  if (!first) return null
  return first.length > 24 ? `${first.slice(0, 24)}…` : first
}

function dayNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

function parseDay(iso: string | null | undefined): Date | null {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const date = new Date(`${iso}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

function shortDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/** "12–17 Dec", "28 Dec – 3 Jan", or "28 Dec 2026 – 3 Jan 2027" across years. */
export function inviteDateRange(startDate: string | null | undefined, endDate: string | null | undefined): string | null {
  const start = parseDay(startDate)
  if (!start) return null
  const end = parseDay(endDate)
  if (!end || end.getTime() === start.getTime()) return shortDate(start)
  const acrossYears = start.getFullYear() !== end.getFullYear()
  if (!acrossYears && start.getMonth() === end.getMonth()) return `${start.getDate()} – ${shortDate(end)}`
  const left = acrossYears
    ? start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : shortDate(start)
  return `${left} – ${shortDate(end)}`
}

/** The facts parts, in the order the copy lists them. Missing facts are absent here. */
export function inviteFactParts(facts: InviteFacts): string[] {
  const parts: string[] = []
  const dates = inviteDateRange(facts.startDate, facts.endDate)
  if (dates) parts.push(dates)
  const days = dayNumber(facts.days)
  if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`)
  const stops = dayNumber(facts.stops)
  if (stops) parts.push(`${stops} ${stops === 1 ? 'stop' : 'stops'}`)
  const perPerson = typeof facts.perPersonEst === 'number' && Number.isFinite(facts.perPersonEst) && facts.perPersonEst > 0
    ? Math.round(facts.perPersonEst)
    : null
  if (perPerson) parts.push(`about ${formatInr(perPerson)} per person (estimate)`)
  return parts
}

function tripName(facts: InviteFacts): string {
  const name = typeof facts.tripTitle === 'string' ? facts.tripTitle.trim() : ''
  return name || 'a trip'
}

/** State A: a valid invite, signed out. The common case. */
export function recipientInviteCopy(facts: InviteFacts): InviteRecipientCopy {
  const inviter = inviteFirstName(facts.inviterFirstName)
  const name = tripName(facts)
  const parts = inviteFactParts(facts)
  const price = typeof facts.paidGuidePrice === 'number' && Number.isFinite(facts.paidGuidePrice) && facts.paidGuidePrice > 0
    ? facts.paidGuidePrice
    : null
  return {
    headline: inviter ? `${inviter} added you to ${name}.` : `You were added to ${name}.`,
    facts: parts.length ? parts.join(' · ') : 'A group trip on YatraFlow.',
    roleLine: facts.role === 'editor'
      ? 'You’ll see the whole plan: days, stops, drive times and the ₹ split, and you can vote on the open decisions.'
      : facts.role === 'viewer'
        ? 'You’ll see the whole plan: days, stops, drive times and the ₹ split. No editing, no notifications.'
        : 'You’ll see the whole plan: days, stops, drive times and the ₹ split.',
    primary: 'Join the plan',
    underPrimary: 'Free. We’ll ask you to sign in or create an account first. That’s how we tell your vote from someone else’s.',
    lookFirst: INVITE_LOOK_FIRST,
    nextSteps: [
      'You land on the plan your friend already started.',
      'Vote on whatever’s open. Your group sees the result.',
      'Everyone sees who paid what, settled at the end, in as few transfers as possible.',
    ],
    paidGuideNote: price
      ? `Part of this plan is a paid guide (${formatInr(price)}). Joining the crew is free; you only pay if you want the locked days.`
      : null,
  }
}

/** State B: a valid invite, signed in. One confirm, then the join. */
export function inviteConfirmCopy(facts: InviteFacts): InviteConfirmCopy {
  const inviter = inviteFirstName(facts.inviterFirstName)
  const tail: string[] = []
  const days = dayNumber(facts.days)
  if (days) tail.push(`${days} ${days === 1 ? 'day' : 'days'}`)
  const stops = dayNumber(facts.stops)
  if (stops) tail.push(`${stops} ${stops === 1 ? 'stop' : 'stops'}`)
  const lead = inviter ? `${inviter} invited you.` : 'You were invited.'
  return {
    headline: `Join ${tripName(facts)}?`,
    sub: tail.length ? `${lead} ${tail.join(' · ')}.` : lead,
    primary: 'Join the trip',
    quiet: 'Not now',
  }
}

/** State C: the link is dead, reset, or unknown. The code box is the way back in. */
export function expiredInviteCopy(input: { ownerFirstName?: string | null } = {}): InviteExpiredCopy {
  const owner = inviteFirstName(input.ownerFirstName)
  return {
    headline: 'This invite link has expired.',
    body: owner
      ? `Links can be reset by whoever owns the trip. Ask ${owner} for a fresh one, or enter the code they shared.`
      : 'Links can be reset by whoever owns the trip. Ask whoever shared it for a fresh one, or enter the code they shared.',
    codeLabel: 'Trip code',
    codePlaceholder: 'GOA-K7QF',
    codeAction: 'Open the trip',
    helpLabel: 'How trip codes work',
    helpHref: '/faq#codes',
  }
}

/** State D, first half: this account is already on the trip. */
export function alreadyMemberCopy(): InviteMemberCopy {
  return { headline: 'You’re already on this trip.', action: 'Open the plan' }
}

/** The price of the paid guide backing a trip, or null. A published price is
 *  the only source: an unpublished or free publication locks nothing. */
export function paidGuidePriceFor(tripId: string | null | undefined, publications: readonly PublishedItinerary[]): number | null {
  if (!tripId) return null
  for (const pub of publications) {
    if (pub.tripId !== tripId || pub.unpublishedAt) continue
    const price = typeof pub.premiumPriceInr === 'number' && Number.isFinite(pub.premiumPriceInr) && pub.premiumPriceInr > 0
      ? pub.premiumPriceInr
      : null
    if (price) return price
  }
  return null
}

/** How many stops the plan holds. A locked day contributes none: the server
 *  withheld them, so counting its preview would invent a number. */
export function invitesStopCount(days: readonly { stops?: unknown[] | null; locked?: boolean }[] | null | undefined): number {
  if (!Array.isArray(days)) return 0
  let total = 0
  for (const day of days) {
    if (!day || day.locked) continue
    if (Array.isArray(day.stops)) total += day.stops.length
  }
  return total
}
