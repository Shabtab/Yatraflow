// ============ Id tokens from the platform CSPRNG ============
// #267 fixed the presence key's weak generator; these two sites kept theirs
// because each looked like "not really identity" — the seed `uid()` mints an
// id SHAPE, and the toast's `Date.now() + Math.random()` is only a React key.
// Both are still the identity the app keys rows and peers on, and the static
// analyzer flags the generator wherever it appears (a temporary handle is
// still a handle). One implementation, so the next audit finds one home.
//
// `getRandomValues` (unlike `randomUUID`) also resolves outside a secure
// context, so a plain-http LAN session keeps working.

/** Lowercase hex token from the platform CSPRNG — 16 characters by default. */
export function randomToken(byteLength = 8): string {
  const bytes = new Uint8Array(byteLength)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
