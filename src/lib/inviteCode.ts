// ============ Invite codes ============
// Human-usable invite codes: shorter and more meaningful than the raw trip
// UUID. Shape: <SLUG>-<4 unambiguous chars> — the slug comes from the trip's
// name/start city (e.g. "GOA-K7QF", "RAJASTHAN-X2M9"), the 4-char tail is
// drawn from an unambiguous alphabet (no 0/O/1/I/S/5) so codes can be read
// out over a call without confusion. Pure module: no supabase/react imports,
// node-testable.
import type { Trip } from '../data/types'

/** Unambiguous uppercase alphabet for the random tail: no 0/O, 1/I, 5/S, 2/Z. */
const TAIL_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXY346789'
const TAIL_LENGTH = 4

/** Characters that never appear in a slug, and therefore safely separate it
 *  from the tail. */
export const INVITE_SEPARATOR = '-'

/**
 * Slugify a trip name (or start city) into the code's readable head: letters
 * and digits only (no separators — the single dash in a code is reserved as
 * the head/tail divider), uppercase, trimmed to 10 chars. Multi-word names
 * collapse: "Goa Beach Week" → "GOABEACHWE".
 */
function slugifyHead(text: string): string {
  const slug = text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '') // drop separators entirely — see docblock
  return slug.slice(0, 10)
}

/** Random 4-char tail from the unambiguous alphabet. */
function randomTail(): string {
  let out = ''
  for (let i = 0; i < TAIL_LENGTH; i++) {
    out += TAIL_ALPHABET[Math.floor(Math.random() * TAIL_ALPHABET.length)]
  }
  return out
}

/**
 * Build a fresh invite code for a trip. Head from the trip's name, falling
 * back to the start location, falling back to YATRA. Pure of side effects:
 * the caller owns persistence and collision handling.
 */
export function makeInviteCode(trip: Pick<Trip, 'name' | 'startLocation'>): string {
  const head = slugifyHead(trip.name) || slugifyHead(trip.startLocation) || 'YATRA'
  return `${head}${INVITE_SEPARATOR}${randomTail()}`
}

/**
 * Normalise whatever a user typed / a URL carried into the canonical stored
 * form: trimmed, uppercase, spaces around the separator removed, inner
 * whitespace collapsed to the separator. Lowercase input is accepted so codes
 * can be typed casually; the stored/compared form is always uppercase.
 */
export function normalizeInviteCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, INVITE_SEPARATOR)
    .replace(new RegExp(`${INVITE_SEPARATOR}{2,}`, 'g'), INVITE_SEPARATOR)
    .replace(new RegExp(`^${INVITE_SEPARATOR}+|${INVITE_SEPARATOR}+$`, 'g'), '')
}

/** Is this string shaped like an invite code (a head, one separator, a tail)? */
export function looksLikeInviteCode(raw: string): boolean {
  const code = normalizeInviteCode(raw)
  const parts = code.split(INVITE_SEPARATOR)
  if (parts.length !== 2) return false
  const [head, tail] = parts
  return /^[A-Z0-9]{1,10}$/.test(head) && new RegExp(`^[${TAIL_ALPHABET}]{${TAIL_LENGTH}}$`).test(tail)
}

/**
 * The route segment for an invite: `#/join/<code>`. Central so the Share tab
 * and any future surfaces can't drift.
 */
export function inviteRoute(code: string): string {
  return `/join/${normalizeInviteCode(code)}`
}
