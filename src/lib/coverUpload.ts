// ============ coverUpload — creator-uploaded cover images ============
// A cover is what a shared link previews with (api/i.js serves the stored URL
// as og:image), so this path deliberately produces something the preview can
// use as-is: an https URL on our own public bucket, ~150-250 KB, no larger than
// the width the app already asks Wikimedia for. That last part is the whole
// cost story — storage and egress are both proportional to bytes, and a
// creator's phone original is 20-50x the bytes for no visible gain at the
// sizes we render (a trip card, a 1200px link card).
//
// The rules live here, apart from the DOM work, because the node test suite has
// no canvas: `coverFileError` / `fitCoverSize` / `coverObjectPath` /
// `coverRandomName` / `isSuggestedCover` are pure and pinned by tests, and only
// `downscaleCover` / `uploadCover` / `ownSuggestedCover` touch the browser and
// the network.
import { supabase, isSupabaseConfigured } from './supabase'
import { MISSING_BACKEND_MESSAGE } from './authErrors'
import { wikimediaFileName } from './tripThumb'

/** Bucket created by supabase/migrations/20260919_covers_bucket.sql. */
export const COVER_BUCKET = 'covers'
/** Long-edge cap. Equal to `COVER_WIDTH` in tripThumb.ts (what we ask Wikimedia
 *  for) and to the width the OG card declares, so a picked cover and an
 *  uploaded one are the same weight class. */
export const COVER_MAX_EDGE = 1200
/** What the bucket will actually accept: `file_size_limit = 5242880` in
 *  20260919_covers_bucket.sql. This is the limit on what we UPLOAD, and the
 *  pipeline re-encodes to 1200px / quality 0.82 before the bucket sees it
 *  (~78 KB out of a 6 MB original), so it is enforced there — after the resize,
 *  in `uploadCover` — and not against the picked file. The client is not a
 *  boundary; the constant exists so a failure arrives as a sentence a creator
 *  can act on, and the two are pinned to each other by
 *  `tests/cover-upload.test.ts` (read out of the migration, not restated). */
export const COVER_MAX_INPUT_BYTES = 5 * 1024 * 1024
/** The largest PICKED file we will decode and re-encode. Deliberately a
 *  different job from the bucket's limit above: a 5–8 MB phone photo is over
 *  that limit and accepted here, because `downscaleCover` turns it into ~78 KB
 *  that fits. This ceiling is about the browser, not the bucket — a 12 MP
 *  phone photo measures 4–6 MB and a 48 MP one 10–15 MB, so 12 MB admits every
 *  camera the app supports, while a larger file is a decode-memory risk on a
 *  mid-range Android and is refused with the number named. */
export const COVER_MAX_PICK_BYTES = 12 * 1024 * 1024
/** Accepted input types. Everything is re-encoded to JPEG on the way out. */
export const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const COVER_JPEG_QUALITY = 0.82
/** The only extension we ever write, since we always re-encode. */
export const COVER_EXT = 'jpg'

/** Why a picked file cannot be used, in the creator's words. null = accepted.
 *
 *  The size in the sentence is derived from the constant rather than written
 *  out, because a hardcoded "8 MB" beside a 5 MB limit is exactly the drift
 *  that produced the original mismatch. */
export function coverFileError(file: { type: string; size: number }): string | null {
  if (!COVER_TYPES.includes(file.type)) return 'Covers must be a JPEG, PNG or WebP image.'
  if (file.size > COVER_MAX_PICK_BYTES) {
    return `That image is ${(file.size / (1024 * 1024)).toFixed(1)} MB — too large to resize here. Please pick one under ${COVER_MAX_PICK_BYTES / (1024 * 1024)} MB.`
  }
  return null
}

/** The largest box that fits `max` on the LONG edge. Never upscales: a small
 *  image stays its own size rather than being blown up and re-blurred. */
export function fitCoverSize(width: number, height: number, max: number = COVER_MAX_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (!Number.isFinite(longest) || longest <= 0) return { width: 0, height: 0 }
  if (longest <= max) return { width, height }
  const scale = max / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** A random, unguessable object name. Public-read buckets are world-readable,
 *  so the path is the only thing keeping one creator's upload from being
 *  trivially enumerable — always random, never derived from the trip or title. */
export function coverRandomName(rand: () => number = Math.random): string {
  const a = Math.floor(rand() * 0xffffffff).toString(36)
  const b = Math.floor(rand() * 0xffffffff).toString(36)
  return `${a}${b}.${COVER_EXT}`
}

/** `<uid>/<name>` — the exact shape the bucket's policies require: the first
 *  path segment must be the uploader's id, and the name may not escape it. */
export function coverObjectPath(userId: string, name: string): string | null {
  const id = userId.trim()
  const file = name.trim()
  if (!id || !file) return null
  if (file.includes('/') || file.includes('..') || id.includes('/')) return null
  return `${id}/${file}`
}

/** How long a suggestion may take to copy before publishing falls back to the
 *  third-party URL. Publishing must never hang on someone else's CDN. */
export const COVER_COPY_TIMEOUT_MS = 8000

/** The one Wikimedia host a browser is allowed to read bytes from directly.
 *  `Special:Redirect/file/…` answers a 301 here, and that **redirect** response
 *  carries no `access-control-allow-origin` — only the final 200 does. A
 *  cross-origin fetch must clear every hop, so fetching the stored URL fails
 *  with `TypeError: Failed to fetch` while the same request from curl succeeds.
 *  That is why the copy resolves a direct address first instead of trusting the
 *  URL it was handed. */
const DIRECT_FILE_HOST = 'upload.wikimedia.org'

/** The API addresses a file by its DECODED name (the query string encodes it
 *  again), but a name read out of a URL arrives percent-encoded — so it is
 *  decoded exactly once here. Decoding twice would turn `%252C` into `,`. */
export function apiFileTitle(encoded: string): string {
  try {
    return decodeURIComponent(encoded)
  } catch {
    return encoded
  }
}

/** Pull the direct file URL out of a MediaWiki `imageinfo` response.
 *
 *  Pure, and deliberately strict about the host: the copy only ever follows
 *  this to `upload.wikimedia.org`, so a response that names anything else (or
 *  nothing) is treated as a failure and the caller keeps the original URL. The
 *  API appends `?utm_*` bookkeeping — dropped here, because the query would
 *  otherwise ride along into the object we store. */
export function directFileUrlFromApi(data: unknown): string | null {
  const pages = (data as { query?: { pages?: Record<string, { imageinfo?: { url?: unknown }[] }> } })?.query?.pages
  if (!pages || typeof pages !== 'object') return null
  for (const page of Object.values(pages)) {
    const url = page?.imageinfo?.[0]?.url
    if (typeof url === 'string' && url.startsWith(`https://${DIRECT_FILE_HOST}/`)) {
      return url.split('?')[0]
    }
  }
  return null
}

/** A Wikimedia address whose bytes a browser can actually read: the direct file
 *  URL when the suggestion already is one, otherwise the same file resolved
 *  through the wiki's own API (`origin=*`, which is CORS-enabled). Null when it
 *  cannot be established, which sends the caller down the fallback path. */
async function resolveReadableWikimediaUrl(url: string, signal: AbortSignal): Promise<string | null> {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
  if (host === DIRECT_FILE_HOST) return url.split('?')[0]
  const file = wikimediaFileName(url)
  if (!file) return null
  const params = new URLSearchParams({
    action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url',
    titles: `File:${apiFileTitle(file)}`, origin: '*',
  })
  const res = await fetch(`https://${host}/w/api.php?${params.toString()}`, { signal })
  if (!res.ok) return null
  return directFileUrlFromApi(await res.json())
}

/** True when a cover URL is the app's own Wikimedia suggestion rather than a
 *  photo a creator chose or uploaded.
 *
 *  This decides what may be copied into our bucket, and it is worth being
 *  precise about why: Wikimedia serves only the thumbnail buckets it has
 *  generated, so asking for 1200 can return a 1280px image at 587 KB — measured
 *  on a live publication, which is 98% of the 600 KB ceiling WhatsApp documents
 *  for og:image. Re-encoding the same photo ourselves measured 78 KB at the same
 *  width, so owning the suggestion fixes the dependency and the size together.
 *
 *  Our bucket, a pasted address, an upload and anything else are left alone:
 *  those are deliberate choices, and a pasted Wikimedia address is
 *  indistinguishable from a suggestion — copying it is harmless anyway (same
 *  picture, our host, smaller). */
export function isSuggestedCover(url: string | undefined | null): boolean {
  if (!url || !/^https:\/\//i.test(url)) return false
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return host === 'wikimedia.org' || host.endsWith('.wikimedia.org')
    || host === 'wikipedia.org' || host.endsWith('.wikipedia.org')
}


/** Which of `pubs` still hand a link preview a third-party image that this
 *  session could take ownership of.
 *
 *  Only the caller's OWN publications qualify, and that is not a filter of
 *  taste: the bucket's write policies confine every object to `<auth.uid()>/…`,
 *  so a creator cannot take ownership of another creator's cover and an admin
 *  cannot either (the client holds no service key). A publication that already
 *  points into our bucket, or at an address someone pasted, is left alone for
 *  the same reason `ownSuggestedCover` leaves one alone — it is a choice.
 *
 *  Pure and derived from the data, which is what makes the collection
 *  idempotent: run it again after a pass and it returns nothing, because those
 *  rows now point at us. */
export function unclaimedCovers<T extends { creatorId?: string; coverImageUrl?: string }>(
  pubs: T[], userId: string | undefined | null,
): T[] {
  if (!userId) return []
  return pubs.filter(p => p.creatorId === userId && isSuggestedCover(p.coverImageUrl))
}

/** Which of `pubs` are MINE and have no stored cover at all (#360).
 *
 *  A null `cover_image_url` predates the cover requirement: the page renders a
 *  live Wikipedia suggestion in its hero while every crawler is served the
 *  brand card — the disagreement this selector starts fixing. `unclaimedCovers`
 *  cannot see these rows (`isSuggestedCover(null)` is false), so the owner-side
 *  sweep ignored them and the split persisted for as long as the row lived.
 *
 *  Same ownership rule as `unclaimedCovers` — the bucket confines writes to
 *  `<auth.uid()>/`, so only the creator can converge their own row. Pure and
 *  derived from the data, so the sweep over collected rows finds nothing to do
 *  and costs nothing. */
export function coverlessPublications<T extends { creatorId?: string; coverImageUrl?: string | null }>(
  pubs: T[], userId: string | undefined | null,
): T[] {
  if (!userId) return []
  return pubs.filter(p => p.creatorId === userId && !p.coverImageUrl)
}

export async function downscaleCover(file: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot resize images.')
  const bitmap = await createImageBitmap(file)
  try {
    const { width, height } = fitCoverSize(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot resize images.')
    ctx.drawImage(bitmap, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('Could not re-encode that image.'))),
        'image/jpeg',
        COVER_JPEG_QUALITY,
      )
    })
  } finally {
    bitmap.close()
  }
}

/** Upload a picked file and return the public URL to store as the cover.
 *
 *  A replacement uploads a NEW object and deliberately does NOT delete the one
 *  it supersedes. The reason is that a cover URL does not stay inside the trip
 *  that owns it: `duplicateTrip`/`importTrip` copy `coverImageUrl` onto every
 *  fork, and publishing stamps it onto `published_itineraries.cover_image_url`
 *  (`api/i.js` serves that column as `og:image`). A fork belongs to another
 *  user, so a delete here cannot know what still points at the object — and
 *  the failure mode is silent: the replacing creator sees a working cover while
 *  every forked trip and every live share card 404s until it is re-published.
 *  Orphans instead: ~100 KB per replacement, $0.0213/GB-month, so ten thousand
 *  replacements cost about two cents a month. Correctness is the cheap side of
 *  that trade; a future janitor that proves an object is unreferenced (it
 *  cannot be proven from one client) may collect them. */
export async function uploadCover(
  userId: string,
  file: Blob,
): Promise<{ url?: string; error?: string }> {
  if (!isSupabaseConfigured) return { error: MISSING_BACKEND_MESSAGE }
  const path = coverObjectPath(userId, coverRandomName())
  if (!path) return { error: 'Could not name the upload — try again.' }
  let blob: Blob
  try {
    blob = await downscaleCover(file)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not read that image.' }
  }
  // The bucket's limit governs what is UPLOADED, which is this re-encoded blob
  // and not the file that was picked: a 6 MB phone photo arrives here at ~78 KB.
  // This guard is the case where the resize could not get under the limit (an
  // already-optimised 1200px PNG, say), and it says so with both numbers rather
  // than letting the bucket refuse with a bare message.
  if (blob.size > COVER_MAX_INPUT_BYTES) {
    return {
      error: `That image is still ${(blob.size / (1024 * 1024)).toFixed(1)} MB after resizing — over the ${COVER_MAX_INPUT_BYTES / (1024 * 1024)} MB the server accepts. Try a smaller one.`,
    }
  }
  const { error } = await supabase.storage.from(COVER_BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
    // Immutable by construction: every upload gets a fresh name.
    cacheControl: '31536000',
  })
  if (error) return { error: `Upload failed: ${error.message}` }
  return { url: supabase.storage.from(COVER_BUCKET).getPublicUrl(path).data.publicUrl }
}

/** Take ownership of an app-suggested cover: fetch the suggestion, re-encode it
 *  at our own size and store it in our own bucket, so a published link's
 *  `og:image` does not depend on Wikimedia serving a file that can be renamed,
 *  re-compressed or deleted without notice.
 *
 *  NEVER fails the caller and never throws. Every problem — offline, no CORS,
 *  a decode failure, a rejected upload, the timeout — returns the original URL,
 *  which is exactly what publishing used before, so this can only ever improve
 *  a publication. `owned` is what tells the caller whether the URL changed,
 *  rather than comparing strings (the two can coincide if a copy somehow
 *  resolved to the same address).
 *
 *  One hop is needed to get there: the stored suggestion is usually the
 *  `Special:Redirect` shape, which cannot be fetched cross-origin at all (see
 *  DIRECT_FILE_HOST), so the file is first resolved to its direct
 *  `upload.` address. Both that host and the API send
 *  `access-control-allow-origin: *`, so the bytes are readable and the canvas
 *  stays untainted — both verified against the live project. */
export async function ownSuggestedCover(
  userId: string,
  url: string | undefined | null,
): Promise<{ url?: string; owned: boolean }> {
  // `|| undefined` rather than `?? undefined`: an empty string is a missing
  // cover, not a cover whose address is "".
  if (!url || !isSuggestedCover(url)) return { url: url || undefined, owned: false }
  // No backend, no point fetching: the upload could not be stored either.
  if (!isSupabaseConfigured) return { url, owned: false }
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), COVER_COPY_TIMEOUT_MS)
  try {
    const direct = await resolveReadableWikimediaUrl(url, abort.signal)
    if (!direct) return { url, owned: false }
    const res = await fetch(direct, { signal: abort.signal })
    if (!res.ok) return { url, owned: false }
    const source = await res.blob()
    // Bound the work before decoding it. A Wikimedia original can be 12 MB+, and
    // decoding one costs the creator a visible pause for an image we are about
    // to shrink by an order of magnitude anyway.
    if (source.size > COVER_MAX_INPUT_BYTES) return { url, owned: false }
    const { url: ours } = await uploadCover(userId, source)
    return ours ? { url: ours, owned: true } : { url, owned: false }
  } catch {
    return { url, owned: false }
  } finally {
    clearTimeout(timer)
  }
}
