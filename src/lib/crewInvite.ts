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
  /** A display label for an entry resumed from a draft whose number could not be
   *  restored, such as "••• 234". It names the person on screen and is never a
   *  link target: `phone` stays null, so no channel can message it. */
  label?: string
}

/** The only display label this module accepts: the three-digit mask. A full
 *  number is refused, so a label can never become a hidden copy of one. */
const MASKED_LABEL = /^\u2022\u2022\u2022 \d{3}$/

export function isMaskedLabel(value: unknown): value is string {
  return typeof value === 'string' && MASKED_LABEL.test(value)
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

/** A candidate number: an Indian mobile, with an optional Indian prefix, and
 *  separators allowed anywhere inside it. The leading `\+?` and the `91`/`0`
 *  alternatives are the only prefixes the normalizer accepts, so the match is
 *  the whole number the planner typed, not a tail of it. */
const NUMBER_CANDIDATE = /\(?\+?(?:91[\s\-()]*|0[\s\-()]*)?[6-9](?:[\s\-()]*\d){9}\)?/g

const SEPARATOR = /[\s\-()]/
const isDigit = (c: string | undefined) => !!c && c >= '0' && c <= '9'

/** True when a run's parentheses are one pair, opened before it closes. A run
 *  that carries a stray bracket is not a number shape we accept. */
function bracketsMatch(run: string): boolean {
  const open = run.indexOf('(')
  const close = run.indexOf(')')
  if (open === -1 && close === -1) return true
  if (open === -1 || close < open) return false
  return run.indexOf('(', open + 1) === -1 && run.indexOf(')', close + 1) === -1
}

/** True when the text just before `at` is the end of a country code or of a
 *  longer number, so this candidate is only a suffix of something we do not
 *  accept.
 *
 *  A digit directly against the candidate means the candidate is a tail of one
 *  longer number ("98450212345"). A separated token of two or more digits is a
 *  country code ("971 …", "44 …"), and so is a single digit after a plus
 *  ("+1 …"). A separated single digit is a name digit ("Team 2 98450 21234"),
 *  so it leaves the candidate alone. */
function suffixOfLongerNumber(text: string, at: number): boolean {
  if (at === 0) return false
  if (isDigit(text[at - 1])) return true
  let q = at - 1
  while (q >= 0 && SEPARATOR.test(text[q])) q--
  if (q < 0) return false
  if (text[q] === '+') return true
  if (!isDigit(text[q])) return false
  let start = q
  while (start >= 0 && isDigit(text[start])) start--
  if (q - start >= 2) return true
  let before = start
  while (before >= 0 && SEPARATOR.test(text[before])) before--
  return before >= 0 && text[before] === '+'
}

/** True when a digit follows the match, so the match is the head of a longer
 *  number ("9845021234 999", "98450212345"). */
function prefixOfLongerNumber(text: string, end: number): boolean {
  let q = end
  while (q < text.length && SEPARATOR.test(text[q])) q++
  return q < text.length && isDigit(text[q])
}

/** Split a free-form entry into a name and a number. "Ammu 98450 21234" gives
 * both; a bare number gives a number; a bare name gives a name.
 *
 * The number is lifted out BEFORE the name is read. A pass over the whole
 * string folds the name's own digits into the number, so "Team 2
 * 98450 21234" fails the 10-digit test and the number is silently swallowed
 * into the name — the entry then looks complete but carries no way to reach
 * the person.
 *
 * The candidate is the WHOLE number, prefix included, and it goes through the
 * same normalizer as a typed field. So a foreign country code or an overlong
 * string fails as a whole instead of handing back its last ten
 * digits. The forms accepted here are the forms the normalizer accepts:
 * brackets, spaces, hyphens, "+91", "91" and a leading "0". */
export function parseCrewEntry(raw: string): CrewEntry {
  const trimmed = (raw ?? '').trim()
  for (const run of trimmed.matchAll(NUMBER_CANDIDATE)) {
    const at = run.index ?? 0
    const text = run[0]
    if (!bracketsMatch(text)) continue
    if (suffixOfLongerNumber(trimmed, at)) continue
    if (prefixOfLongerNumber(trimmed, at + text.length)) continue
    const phone = normalizeIndianMobile(text)
    if (!phone) continue
    const name = (trimmed.slice(0, at) + trimmed.slice(at + text.length))
      .replace(/[\s\-()]+/g, ' ')
      .trim()
    return { raw: trimmed, name, phone }
  }
  return { raw: trimmed, name: trimmed, phone: null }
}

/** One rule for both input paths.
 *
 *  Two numbers settle it: the same number twice is the same person, and two
 *  different numbers are two different people even when the names match. A
 *  name match is a duplicate only when there is no pair of numbers to compare,
 *  so "Ammu" then "Ammu 9845021234" stays one row while two colleagues both
 *  called Ammu keep their own chips. */
function isSameCrewMember(a: { name: string; phone: string | null }, b: { name: string; phone: string | null }): boolean {
  if (a.phone && b.phone) return a.phone === b.phone
  const name = a.name.trim().toLowerCase()
  return !!name && name === b.name.trim().toLowerCase()
}

/** Add an entry to a crew list without duplicates or blanks. Returns a new list,
 *  so callers can keep state updates pure. */
export function addCrewEntry(list: CrewEntry[], raw: string, limit: number): CrewEntry[] {
  const entry = parseCrewEntry(raw)
  if (!entry.raw) return list
  if (list.length >= Math.max(0, limit)) return list
  const dupe = list.some(existing => isSameCrewMember(existing, entry))
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
  const entry = { name, phone }
  if (list.some(existing => isSameCrewMember(existing, entry))) return { kind: 'unchanged', message: 'This crew member is already on the list.' }
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
