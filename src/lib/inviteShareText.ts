// ============ The pre-filled invite message ============
// The Share tab puts a link in a friend's hand. The sentences beside that link
// are the reason a group taps it: a stranger's "Join my trip" reads as spam,
// while a trip's own numbers read as the plan. This module owns the words.
//
// Pure and argument-taking, so the templates are pinned by tests instead of
// eyeballed in a component. Every fact is optional: a trip that has no days,
// no stops and no budget must never print "0 stops" or "₹0/person".

import { formatInr } from './engine'

/** The link role the server confirmed, or null while it is unknown. */
export type InviteShareRole = 'editor' | 'viewer' | null

export interface InviteShareFacts {
  /** The trip's name. It is absent on a brand-new trip. */
  title: string | null
  /** The day count. Zero and below is left out. */
  days: number
  /** The planned stop count. Zero and below is left out. */
  stops: number
  /** The per-person estimate in rupees. Zero and below is left out. */
  perPersonInr: number
  /** The invite address. */
  url: string
  /** The short join code. */
  code: string
  role: InviteShareRole
}

/** The facts a message may print, in reading order. Each one appears only
 *  when it has a real value, so an empty trip prints no zeros. */
export function inviteFactsLine(facts: Pick<InviteShareFacts, 'days' | 'stops' | 'perPersonInr'>): string[] {
  const parts: string[] = []
  if (Number.isFinite(facts.days) && facts.days > 0) parts.push(`${Math.round(facts.days)} ${Math.round(facts.days) === 1 ? 'day' : 'days'}`)
  if (Number.isFinite(facts.stops) && facts.stops > 0) parts.push(`${Math.round(facts.stops)} ${Math.round(facts.stops) === 1 ? 'stop' : 'stops'}`)
  if (Number.isFinite(facts.perPersonInr) && facts.perPersonInr > 0) parts.push(`~${formatInr(facts.perPersonInr)}/person est.`)
  return parts
}

/** The editor's invite: the plan, its size, and the two decisions it settles.
 *  A link the server marked read-only never gets this text. */
function editorMessage(facts: InviteShareFacts, factsLine: string[]): string {
  const lines: string[] = [
    facts.title
      ? `Moving our ${facts.title} plan out of chat chaos so we actually agree on stops and budget.`
      : 'Moving our trip plan out of chat chaos so we actually agree on stops and budget.',
  ]
  if (factsLine.length) lines.push('', factsLine.join(' · '))
  lines.push('', 'Open the plan, vote on the open decisions, or drop your own stops here:', facts.url)
  if (facts.code) lines.push('', `(Join code if needed: ${facts.code})`)
  return lines.join('\n')
}

/** The read-only invite: a day-by-day plan with no voting promise. */
function viewerMessage(facts: InviteShareFacts, factsLine: string[]): string {
  const head = facts.title ? `Here's our live day-by-day plan for ${facts.title}` : 'Here is our live day-by-day plan'
  const size = factsLine.length ? ` (${factsLine.join(', ')})` : ''
  return `${head}${size}:\n${facts.url}`
}

/** The message for a role the server has not confirmed yet. It promises only
 *  what both roles can do. */
function neutralMessage(facts: InviteShareFacts, factsLine: string[]): string {
  const head = facts.title ? `Here's our ${facts.title} plan` : 'Here is our trip plan'
  const size = factsLine.length ? ` (${factsLine.join(' · ')})` : ''
  return `${head}${size}:\nOpen the plan here:\n${facts.url}${facts.code ? `\n\n(Join code if needed: ${facts.code})` : ''}`
}

/** The whole WhatsApp invite body, chosen by the link's role. */
export function tripInviteMessage(facts: InviteShareFacts): string {
  const factsLine = inviteFactsLine(facts)
  if (facts.role === 'editor') return editorMessage(facts, factsLine)
  if (facts.role === 'viewer') return viewerMessage(facts, factsLine)
  return neutralMessage(facts, factsLine)
}
