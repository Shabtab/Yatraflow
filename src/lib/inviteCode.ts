// ============ Invite codes ============
// Human-usable invite codes: shorter and more meaningful than the raw trip
// UUID. Shape: <SLUG>-<8 unambiguous chars> — the slug comes from the trip's
// name/start city (e.g. "GOA-K7QFH3WT", "RAJASTHAN-XM9P4KTN"). The 8-char tail
// is drawn from an unambiguous 28-character alphabet (no 0/O, 1/I, 2/Z, 5/S),
// so codes can be read out over a call without confusion. Codes made before
// the tail grew to 8 characters have a 4-char tail, and they still work.
// Pure module: no supabase/react imports, node-testable.
import type { Trip } from '../data/types'

/** Unambiguous uppercase alphabet for the random tail: no 0/O, 1/I, 5/S, 2/Z. 28 characters. */
const TAIL_ALPHABET = 'ABCDEFGHJKLMNPQRTUVWXY346789'
/** Tail length of every code made now. 28^8 is about 3.8e11 possible tails. */
const TAIL_LENGTH = 8
/** Tail length of codes made before TAIL_LENGTH was 8. Still accepted. */
const LEGACY_TAIL_LENGTH = 4
let tailLastResortSeq = 0

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

/** Random tail of TAIL_LENGTH characters from the unambiguous alphabet, drawn
 *  from the platform CSPRNG — an invite code is a join credential, so generator
 *  predictability is a security property, not a style choice (the same fix class
 *  as presence.ts's session key). Rejection sampling keeps the 28-character
 *  alphabet unbiased: bytes >= 252 (= floor(256/28)*28) are redrawn. */
function randomTail(): string {
  const size = TAIL_ALPHABET.length
  const maxUnbiased = Math.floor(256 / size) * size
  let out = ''
  while (out.length < TAIL_LENGTH) {
    const c = globalThis.crypto as Crypto | undefined
    if (c?.getRandomValues) {
      const bytes = new Uint8Array(TAIL_LENGTH)
      c.getRandomValues(bytes)
      for (const byte of bytes) {
        if (byte >= maxUnbiased) continue
        out += TAIL_ALPHABET[byte % size]
        if (out.length === TAIL_LENGTH) break
      }
    } else {
      // Unreachable on every platform this app ships on: a clock-plus-counter
      // stand-in that only has to differ between calls in a no-crypto env.
      tailLastResortSeq += 1
      const clock = typeof performance === 'undefined' ? Date.now() : performance.now()
      const n = Math.abs(Math.trunc(Date.now() * 31 + clock * 7 + tailLastResortSeq))
      out += TAIL_ALPHABET[n % size]
    }
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

/** Is this string shaped like an invite code (a head, one separator, a tail)?
 *  The tail has the current length, or the legacy length from before it grew. */
export function looksLikeInviteCode(raw: string): boolean {
  const code = normalizeInviteCode(raw)
  const parts = code.split(INVITE_SEPARATOR)
  if (parts.length !== 2) return false
  const [head, tail] = parts
  const tailShape = new RegExp(`^(?:[${TAIL_ALPHABET}]{${TAIL_LENGTH}}|[${TAIL_ALPHABET}]{${LEGACY_TAIL_LENGTH}})$`)
  return /^[A-Z0-9]{1,10}$/.test(head) && tailShape.test(tail)
}

/**
 * The route segment for an invite: `#/join/<code>`. Central so the Share tab
 * and any future surfaces can't drift.
 */
export function inviteRoute(code: string): string {
  return `/join/${normalizeInviteCode(code)}`
}
