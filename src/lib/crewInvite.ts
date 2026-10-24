// ============ Crew invites - the growth loop, honestly staged ============
// A trip gets better the moment the crew is in it, and the create page is the
// peak of that motivation. This module holds the parts that must be right
// before anything is sent to anyone: number normalising, the message itself,
// and the WhatsApp link.
//
// CONTRACT:
//  - Nothing here sends anything. It composes; the caller decides.
//  - India-first number handling: +91 / 0 prefixes accepted, 10 digits, first
//    digit 6-9. Anything else is honestly "not a number we can message" rather
//    than a plausible-looking guess.
//  - The message says what the trip is and what the person is being asked to
//    do. No marketing, no fake urgency, no "you have been invited by an
//    exciting app".
//
// Pure module: no react/supabase imports, node-testable.

export interface CrewEntry {
  /** What the planner typed, kept verbatim for the UI. */
  raw: string
  /** A name, when the entry had one. */
  name: string
  /** A 10-digit Indian mobile, or null when the entry had no usable number. */
  phone: string | null
}

/** Normalise an Indian mobile number to its 10 digits, or null.
 *  Accepts "+91 98450 21234", "098450 21234", "919845021234", "98450-21234". */
export function normalizeIndianMobile(raw: string): string | null {
  const digits = (raw ?? '').replace(/\D+/g, '')
  if (!digits) return null
  let d = digits
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  if (d.length !== 10) return null
  // Indian mobiles begin 6-9. A 10-digit string starting 0-5 is not a mobile.
  if (!/^[6-9]/.test(d)) return null
  return d
}

/** Split a free-form entry into a name and a number. "Ammu 98450 21234" gives
 * both; a bare number gives a number; a bare name gives a name.
 *
 * The number is lifted out BEFORE the name is read. A pass over the whole
 * string folds the name's own digits into the number, so "Team 2
 * 98450 21234" fails the 10-digit test and the number is silently swallowed
 * into the name — the entry then looks complete but carries no way to reach
 * the person. */
export function parseCrewEntry(raw: string): CrewEntry {
  const trimmed = (raw ?? '').trim()
  // Find a run of digits and separators that is a mobile number, then remove
  // exactly that run from the name. The run is matched with separators allowed
  // INSIDE it, because a number typed "98450 21234" is one number spread over
  // two tokens; and it is bounded on both sides by something that is not a
  // digit or separator, so an 11+ digit string cannot yield its last ten.
  const run = trimmed.match(/(?<![^\s(])(?:\+?91|0)?[\s-]*([6-9](?:[\s-]*\d){9})(?![\s-]*\d)/)
  const at = run?.index ?? -1
  if (run && at >= 0) {
    const phone = normalizeIndianMobile(run[1])
    // A country prefix that is not India's must not be peeled off to leave a
    // valid-looking Indian number behind: "+1 9845021234" is a US number with
    // an Indian subscriber part, and treating it as Indian would silently
    // mis-file the crew member.
    const prefix = trimmed.slice(Math.max(0, at - 4), at)
    const foreign = /\+/.test(prefix) && !/\+?\s*91\s*$/.test(prefix)
    if (phone && !foreign) {
      const name = (trimmed.slice(0, at) + trimmed.slice(at + run[0].length))
        .replace(/[+\-()]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      return { raw: trimmed, name, phone }
    }
  }
  return { raw: trimmed, name: trimmed, phone: null }
}

/** Add an entry to a crew list without duplicates or blanks. Returns a new list,
 *  so callers can keep state updates pure. */
export function addCrewEntry(list: CrewEntry[], raw: string, limit: number): CrewEntry[] {
  const entry = parseCrewEntry(raw)
  if (!entry.raw) return list
  if (list.length >= Math.max(0, limit)) return list
  // The same person on two chips sends two invitations. A number match is the
  // strong signal; a name match catches the case where the same name arrives
  // once with a number and once without, which would otherwise be two rows for
  // one traveller.
  const dupe = (!!entry.name && list.some(e => e.name.toLowerCase() === entry.name.toLowerCase())) ||
    (!!entry.phone && list.some(e => e.phone === entry.phone))
  return dupe ? list : [...list, entry]
}

/** Separate create fields retain the same normalization and duplicate rules. */
export function addCrewFields(list: CrewEntry[], fields: { name: string; mobile: string }, limit: number):
  | { kind: 'added'; crew: CrewEntry[] }
  | { kind: 'invalid'; field: 'name' | 'mobile'; message: string }
  | { kind: 'unchanged'; message: string } {
  const name = fields.name.trim()
  const mobile = fields.mobile.trim()
  if (!name && !mobile) return { kind: 'invalid', field: 'name', message: 'Enter a name or mobile number.' }
  const phone = mobile ? normalizeIndianMobile(mobile) : null
  if (mobile && !phone) return { kind: 'invalid', field: 'mobile', message: 'Enter a valid Indian mobile number, with 10 digits starting with 6 to 9.' }
  if (list.length >= Math.max(0, limit)) return { kind: 'unchanged', message: 'The crew list is full. Increase the party size or remove a member.' }
  const duplicate = (!!name && list.some(entry => entry.name.toLowerCase() === name.toLowerCase())) ||
    (!!phone && list.some(entry => entry.phone === phone))
  if (duplicate) return { kind: 'unchanged', message: 'This crew member is already on the list.' }
  return { kind: 'added', crew: [...list, { raw: [name, mobile].filter(Boolean).join(' '), name, phone }] }
}

/** A wa.me deep link. The number carries the country code; the text is encoded. */
export function whatsappInviteUrl(phone: string, text: string): string {
  return `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`
}

/** The channels a crew actually talks on, in tap order. */
export const CREW_CHANNELS = ['whatsapp', 'telegram', 'sms', 'insta'] as const
export type CrewChannel = (typeof CREW_CHANNELS)[number]

/** SMS with the invite prefilled - the fallback that reaches any phone. */
export function smsInviteUrl(phone: string, text: string): string {
  return `sms:+91${phone}?body=${encodeURIComponent(text)}`
}

/** Telegram has no per-number web scheme, but its own chooser is better than
 *  one: t.me/share opens Telegram's chat picker with the invite prefilled. */
export function telegramShareUrl(text: string, url: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
}

/** The deep link a channel opens directly, or null when it has no per-number
 *  scheme and must ride the OS share sheet / a copy instead (Instagram has no
 *  DM intent URL - pretending otherwise would dead-end the planner). */
export function inviteChannelUrl(
  channel: CrewChannel,
  phone: string | null,
  text: string,
  url: string,
): string | null {
  switch (channel) {
    case 'whatsapp': return phone ? whatsappInviteUrl(phone, text) : null
    case 'sms': return phone ? smsInviteUrl(phone, text) : null
    case 'telegram': return telegramShareUrl(text, url)
    case 'insta': return null
    default: return null
  }
}

/** Channels that need a number at all (Telegram's chooser needs none). */
export function channelNeedsPhone(channel: CrewChannel): boolean {
  return channel === 'whatsapp' || channel === 'sms'
}

/** The invite message. Short, specific, and honest about what joining does -
 *  it is the first thing this product ever says to someone. */
export function crewInviteMessage(opts: {
  tripName: string
  joinUrl: string
  plannerName?: string
}): string {
  const who = opts.plannerName?.trim() ? `${opts.plannerName.trim()} is planning` : "We're planning"
  return [
    `${who} "${opts.tripName}" on YatraFlow.`,
    `Join to vote on stops and keep the plan in one place: ${opts.joinUrl}`,
  ].join('\n')
}

/** The planner-role line the create page shows above the collector. Kept here
 *  so the promise and the invite cannot drift apart. */
export const PLANNER_ROLE_LINE = "You're the planner - the crew votes, you decide."
