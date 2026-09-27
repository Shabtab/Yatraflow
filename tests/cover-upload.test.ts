import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COVER_COPY_TIMEOUT_MS, COVER_MAX_EDGE, COVER_MAX_INPUT_BYTES, COVER_TYPES,
  apiFileTitle, coverFileError, coverObjectPath, coverRandomName, directFileUrlFromApi,
  fitCoverSize, isSuggestedCover, ownSuggestedCover, unclaimedCovers,
} from '../src/lib/coverUpload'
import { wikimediaFileName } from '../src/lib/tripThumb'

// Uploaded covers are the first bytes in this repo that live on a meter we pay
// for, and the size we store is the whole cost argument: the object is fetched
// by crawlers we never see, so the client shrinks it to the width the app
// already asks Wikimedia for. These pin the rules that decide that size, the
// path shape the bucket's policies are written against, and the agreement
// between the client's allowlist and the bucket's — none of which the canvas or
// the network lets this node suite reach.

const BUCKET_SQL = readFileSync(
  new URL('../supabase/migrations/20260919_covers_bucket.sql', import.meta.url), 'utf8',
)

describe('cover upload rules', () => {
  it('accepts the image types the bucket is willing to hold', () => {
    for (const type of COVER_TYPES) {
      expect(coverFileError({ type, size: 1024 }), type).toBeNull()
    }
  })

  it('refuses a non-image, an unlisted image type and an oversized original', () => {
    expect(coverFileError({ type: 'application/pdf', size: 1024 })).toMatch(/JPEG, PNG or WebP/)
    expect(coverFileError({ type: 'image/gif', size: 1024 })).toMatch(/JPEG, PNG or WebP/)
    // The refusal names the real weight, so the creator knows what to pick —
    // and the limit it names is the one actually enforced, derived from the
    // constant rather than written out beside it (#360).
    const big = coverFileError({ type: 'image/jpeg', size: 12 * 1024 * 1024 })
    expect(big).toContain('12.0 MB')
    expect(big).toContain(`under ${COVER_MAX_INPUT_BYTES / (1024 * 1024)} MB`)
  })

  it('caps the input at the boundary it reports', () => {
    expect(coverFileError({ type: 'image/jpeg', size: COVER_MAX_INPUT_BYTES })).toBeNull()
    expect(coverFileError({ type: 'image/jpeg', size: COVER_MAX_INPUT_BYTES + 1 })).not.toBeNull()
  })

  it('fits the long edge to 1200px without ever upscaling', () => {
    // The two shapes a phone actually produces.
    expect(fitCoverSize(4032, 3024)).toEqual({ width: 1200, height: 900 })
    expect(fitCoverSize(3024, 4032)).toEqual({ width: 900, height: 1200 })
    // Already small: untouched, so a 600px image is not enlarged and re-blurred.
    expect(fitCoverSize(600, 400)).toEqual({ width: 600, height: 400 })
    expect(fitCoverSize(COVER_MAX_EDGE, 500)).toEqual({ width: COVER_MAX_EDGE, height: 500 })
  })

  it('survives degenerate dimensions without producing a zero-sized canvas', () => {
    expect(fitCoverSize(0, 0)).toEqual({ width: 0, height: 0 })
    expect(fitCoverSize(Number.NaN, 10)).toEqual({ width: 0, height: 0 })
    expect(fitCoverSize(3000, 1).height).toBe(1)
  })

  it('never exceeds the cap on either edge, whatever the aspect ratio', () => {
    for (const [w, h] of [[9000, 10], [10, 9000], [5000, 4000], [1201, 1199]]) {
      const out = fitCoverSize(w, h)
      expect(Math.max(out.width, out.height), `${w}x${h}`).toBeLessThanOrEqual(COVER_MAX_EDGE)
    }
  })

  it('names uploads <uploader-id>/<random>.jpg, which is what the policies check', () => {
    const uid = 'd507b604-1f89-46bd-b793-3d0bd67bbd2f'
    const path = coverObjectPath(uid, 'k3j9x2a.jpg')
    expect(path).toBe(`${uid}/k3j9x2a.jpg`)
    // The bucket's insert/delete policies scope on this first segment.
    expect(path!.split('/')[0]).toBe(uid)
  })

  it('refuses a name that could escape the uploader folder', () => {
    const uid = 'd507b604-1f89-46bd-b793-3d0bd67bbd2f'
    expect(coverObjectPath(uid, '../other.jpg')).toBeNull()
    expect(coverObjectPath(uid, 'nested/other.jpg')).toBeNull()
    expect(coverObjectPath('', 'a.jpg')).toBeNull()
    expect(coverObjectPath(uid, '')).toBeNull()
  })

  it('mints an unpredictable name, never one derived from the trip', () => {
    const names = new Set(Array.from({ length: 50 }, () => coverRandomName()))
    expect(names.size).toBe(50)
    expect([...names].every(n => /^[a-z0-9]+\.jpg$/.test(n))).toBe(true)
    // Deterministic given a generated value — the shape, not the entropy, is the pin.
    expect(coverRandomName(() => 0)).toBe('00.jpg')
  })

  it('never deletes the object it supersedes', () => {
    // Not a style preference. A cover URL escapes the trip that owns it:
    // `duplicateTrip`/`importTrip` copy it onto every fork and publishing stamps
    // it onto `published_itineraries.cover_image_url`, which `api/i.js` serves as
    // og:image. A fork belongs to someone else, so a delete here cannot know what
    // still points at the object — and the replacing creator's screen keeps
    // working while every fork and share card 404s. Orphans cost ~$0.02/GB-month.
    const src = readFileSync(new URL('../src/lib/coverUpload.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/\.remove\(/)
    expect(src).not.toMatch(/previousUrl/)
  })
})

// Normalized to LF: the sources are CRLF on Windows checkouts, and these pins
// are written with \n anchors so they cannot quietly stop matching on one OS.
const readSrc = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const STORE_SRC = readSrc('src/store/store.ts')
const OUR_BUCKET_URL = 'https://project.supabase.co/storage/v1/object/public/covers/d507b604-1f89-46bd-b793-3d0bd67bbd2f/d2g9huw8g9dp.jpg'

describe('telling the app\'s own suggestion from a deliberate choice', () => {
  it.each([
    ['https://upload.wikimedia.org/wikipedia/commons/3/3a/Chandratal_1.JPG', 'the raw upload host'],
    ['https://upload.wikimedia.org/wikipedia/commons/3/3a/Chandratal_1.JPG?utm_content=thumbnail_unscaled', 'the unscaled thumbnail query'],
    ['https://commons.wikimedia.org/wiki/Special:Redirect/file/Kochi_Skyline.jpg?width=1200', 'the sized redirect the picker writes'],
    ['https://en.wikipedia.org/wiki/Special:Redirect/file/Foo.png?width=1200', 'a language subdomain'],
    ['https://UPLOAD.WIKIMEDIA.ORG/x.jpg', 'case in the host'],
  ])('reads %s as a suggestion (%s)', url => {
    expect(isSuggestedCover(url)).toBe(true)
  })

  it.each([
    [OUR_BUCKET_URL, 'our own upload — already owned'],
    ['https://images.example.test/cover.jpg', 'a pasted address'],
    ['http://upload.wikimedia.org/x.jpg', 'http, which the preview handler rejects anyway'],
    ['https://evil-wikimedia.org/x.jpg', 'a lookalike host'],
    ['https://wikimedia.org.evil.test/x.jpg', 'wikimedia.org used as a prefix'],
    ['not a url', 'junk'],
    ['', 'empty'],
    [undefined, 'absent'],
    [null, 'null'],
  ])('leaves %s alone (%s)', url => {
    expect(isSuggestedCover(url as string | undefined)).toBe(false)
  })
})

describe('collecting the covers a publication still links to a third party', () => {
  const pub = (id: string, creatorId: string, coverImageUrl?: string) => ({ id, creatorId, coverImageUrl })
  const MINE = 'uid-me'
  const SUGGESTION = 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Kochi_Skyline.jpg?width=1200'

  it('selects my own third-party covers and nothing else', () => {
    const mine = pub('p1', MINE, SUGGESTION)
    const theirs = pub('p2', 'uid-other', SUGGESTION)
    const ours = pub('p3', MINE, OUR_BUCKET_URL)
    const pasted = pub('p4', MINE, 'https://images.example.test/cover.jpg')
    const none = pub('p5', MINE, undefined)
    // Another creator's row is not a matter of preference: the bucket confines
    // every write to `<auth.uid()>/`, so it could not be collected anyway.
    expect(unclaimedCovers([mine, theirs, ours, pasted, none], MINE)).toEqual([mine])
  })

  it('has nothing to do without a session', () => {
    expect(unclaimedCovers([pub('p1', MINE, SUGGESTION)], undefined)).toEqual([])
    expect(unclaimedCovers([pub('p1', MINE, SUGGESTION)], null)).toEqual([])
  })

  it('finds nothing on the second pass, which is what makes the re-run safe', () => {
    // Idempotence is a property of the SELECTOR, not of a flag somewhere: after
    // a pass the rows point at our bucket, so the same call is a no-op.
    const pubs = [pub('p1', MINE, SUGGESTION), pub('p2', MINE, SUGGESTION)]
    const collected = unclaimedCovers(pubs, MINE)
    const after = pubs.map(p => collected.some(c => c.id === p.id) ? { ...p, coverImageUrl: OUR_BUCKET_URL } : p)
    expect(unclaimedCovers(after, MINE)).toEqual([])
  })
})

describe('turning a Wikimedia suggestion into an address a browser may read', () => {
  const upload = 'https://upload.wikimedia.org/wikipedia/commons/8/8f/Kochi_Skyline.jpg'

  it('reads the file name out of both shapes this app stores', () => {
    // The direct upload shape (what the Wikipedia API hands back)…
    expect(wikimediaFileName(`${upload}?utm_source=commons.wikimedia.org`)).toBe('Kochi_Skyline.jpg')
    expect(wikimediaFileName('https://upload.wikimedia.org/wikipedia/commons/thumb/1/23/Foo.png/800px-Foo.png')).toBe('Foo.png')
    // …and the Special:Redirect shape sizedCoverUrl writes, which is what the
    // picker actually stores.
    expect(wikimediaFileName('https://commons.wikimedia.org/wiki/Special:Redirect/file/Kochi_Skyline.jpg?width=1200')).toBe('Kochi_Skyline.jpg')
    expect(wikimediaFileName('https://en.wikipedia.org/wiki/Special:Redirect/file/Foo.png?width=1200')).toBe('Foo.png')
    // Percent-encoded names come back untouched — decoding here is what would
    // double-escape them once the API encodes them again.
    expect(wikimediaFileName('https://commons.wikimedia.org/wiki/Special:Redirect/file/Telkupi%2C_Purulia.jpg?width=1200')).toBe('Telkupi%2C_Purulia.jpg')
  })

  it('refuses anything that is not a Wikimedia file', () => {
    for (const url of [OUR_BUCKET_URL, 'https://images.example.test/cover.jpg', 'https://evil-wikimedia.org/wiki/Special:Redirect/file/X.jpg', '', 'nonsense']) {
      expect(wikimediaFileName(url), url).toBeNull()
    }
  })

  it('decodes an API title exactly once', () => {
    expect(apiFileTitle('Telkupi%2C_Purulia.jpg')).toBe('Telkupi,_Purulia.jpg')
    expect(apiFileTitle('Kochi_Skyline.jpg')).toBe('Kochi_Skyline.jpg')
    // A stray percent cannot throw out of the copy path.
    expect(apiFileTitle('100%_done.jpg')).toBe('100%_done.jpg')
  })

  it('takes the direct URL from an API response, and only from upload.wikimedia.org', () => {
    const ok = (url: string) => ({ query: { pages: { '1': { imageinfo: [{ url }] } } } })
    // The API appends its own bookkeeping query; keeping it would ride into the
    // object we store.
    expect(directFileUrlFromApi(ok(`${upload}?utm_source=commons.wikimedia.org&utm_content=original`))).toBe(upload)
    // A response naming anything else is treated as a failure, so the copy can
    // never be pointed at a host we did not choose.
    expect(directFileUrlFromApi(ok('https://evil.test/X.jpg'))).toBeNull()
    expect(directFileUrlFromApi(ok('http://upload.wikimedia.org/X.jpg'))).toBeNull()
    expect(directFileUrlFromApi(ok('https://upload.wikimedia.org.evil.test/X.jpg'))).toBeNull()
  })

  it('survives every malformed API shape', () => {
    for (const bad of [null, undefined, {}, { query: {} }, { query: { pages: {} } }, { query: { pages: { '1': {} } } }, { query: { pages: { '1': { imageinfo: [] } } } }, { query: { pages: { '1': { imageinfo: [{ url: 42 }] } } } }, 'nonsense']) {
      expect(directFileUrlFromApi(bad)).toBeNull()
    }
  })

  it('finds the file across API pages when the first one has no imageinfo', () => {
    expect(directFileUrlFromApi({ query: { pages: { '-1': {}, '7': { imageinfo: [{ url: upload }] } } } })).toBe(upload)
  })
})

describe('owning an auto-suggested cover', () => {
  const fetchSpy = vi.fn()
  beforeEach(() => { fetchSpy.mockReset(); fetchSpy.mockRejectedValue(new Error('must not fetch')); vi.stubGlobal('fetch', fetchSpy) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns a non-suggestion untouched and never fetches it', async () => {
    // The guard order matters: a cover we already own, or one a creator pasted,
    // must not be re-downloaded and re-uploaded on every publish.
    for (const url of [OUR_BUCKET_URL, 'https://images.example.test/cover.jpg', 'http://upload.wikimedia.org/x.jpg']) {
      await expect(ownSuggestedCover('uid-1', url)).resolves.toEqual({ url, owned: false })
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns nothing for an absent cover', async () => {
    await expect(ownSuggestedCover('uid-1', undefined)).resolves.toEqual({ url: undefined, owned: false })
    await expect(ownSuggestedCover('uid-1', '')).resolves.toEqual({ url: undefined, owned: false })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is timeout-bounded, and clears its timer on every path', () => {
    // Publishing must never hang on someone else's CDN, and a leaked timer
    // keeps the page awake after the copy is abandoned.
    expect(COVER_COPY_TIMEOUT_MS).toBeGreaterThan(0)
    expect(COVER_COPY_TIMEOUT_MS).toBeLessThanOrEqual(15000)
    const src = readSrc('src/lib/coverUpload.ts')
    expect(src).toMatch(/setTimeout\(\(\) => abort\.abort\(\), COVER_COPY_TIMEOUT_MS\)/)
    expect(src).toMatch(/signal: abort\.signal/)
    expect(src).toMatch(/finally \{\s*clearTimeout\(timer\)/)
  })
})

describe('publishing takes ownership of the suggestion it would otherwise link to', () => {
  it('copies before the row is written, so the stored og:image is never third-party', () => {
    const copyAt = STORE_SRC.indexOf('await ownSuggestedCover(p.creatorId, p.coverImageUrl)')
    const upsertAt = STORE_SRC.indexOf("from('published_itineraries').upsert")
    expect(copyAt).toBeGreaterThan(-1)
    expect(upsertAt).toBeGreaterThan(-1)
    expect(copyAt).toBeLessThan(upsertAt)
  })

  it('runs after the optimistic commit, so the copy never delays the UI', () => {
    const commitAt = STORE_SRC.indexOf('  commit()\n  // Take ownership of an auto-suggested cover')
    const copyAt = STORE_SRC.indexOf('await ownSuggestedCover(p.creatorId, p.coverImageUrl)')
    expect(commitAt).toBeGreaterThan(-1)
    expect(commitAt).toBeLessThan(copyAt)
  })

  it('writes the owned URL back to the trip, so re-publishing cannot re-copy it', () => {
    // Publishing copies `trip.coverImageUrl`. Without this the trip keeps the
    // Wikimedia URL, every Update publication mints another object, and the
    // trip's own card keeps loading from Wikimedia.
    expect(STORE_SRC).toMatch(/updateTrip\(p\.tripId, \{ coverImageUrl: owned\.url \}\)/)
  })

  it('publishes the fallback URL when the copy did not happen', () => {
    // The whole feature is an improvement, never a new failure mode: the upsert
    // must still receive a cover when `owned` is false.
    expect(STORE_SRC).toMatch(/cover_image_url: p\.coverImageUrl/)
    expect(STORE_SRC).toMatch(/if \(owned\.owned && owned\.url\)/)
  })
})

describe('the re-run that collects rows published before the copy shipped', () => {
  const body = () => {
    const at = STORE_SRC.indexOf('export async function collectUnclaimedCovers')
    expect(at).toBeGreaterThan(-1)
    return STORE_SRC.slice(at, STORE_SRC.indexOf('\n}\n', at))
  }

  it('takes its work list from the data, so a second run is free', () => {
    expect(body()).toMatch(/for \(const pub of unclaimedCovers\(cache\.published, userId\)\)/)
  })

  it('shares one pass between callers', () => {
    // Two sweeps racing would copy and upload the same image twice, minting an
    // object neither of them can prove is unreferenced.
    expect(STORE_SRC).toMatch(/let coverSweep: Promise<number> \| null = null/)
    expect(body()).toMatch(/if \(coverSweep\) return coverSweep/)
    expect(body()).toMatch(/try \{ return await coverSweep \} finally \{ coverSweep = null \}/)
  })

  it('persists the collected URL to the publication ROW before the cache agrees', () => {
    // A collected cover that only reached the cache is back on Wikimedia after a
    // reload — the failure the cover column itself shipped with, which is why
    // the row write comes first and a rejected write skips the cache patch.
    const b = body()
    const update = b.indexOf('.update({ cover_image_url: owned.url }).eq(\'id\', pub.id)')
    const patch = b.indexOf('cache.published = cache.published.map')
    const bail = b.indexOf('if (!owned.owned || !owned.url) continue')
    expect(bail).toBeGreaterThan(-1)
    expect(update).toBeGreaterThan(bail)
    expect(patch).toBeGreaterThan(update)
    expect(b).toMatch(/if \(error\) \{\s*console\.error\('\[yatraflow\] cover collection failed', error\)\s*continue\s*\}/)
  })

  it('follows the publication onto a trip that still carries that same suggestion', () => {
    // Publishing copies the trip's cover, so rewriting the trip is what keeps a
    // later re-publish from re-copying the same image — but a trip whose creator
    // has since chosen a different cover must keep that newer choice.
    expect(body()).toMatch(/if \(tripById\(pub\.tripId\)\?\.coverImageUrl === suggestion\) \{\s*updateTrip\(pub\.tripId, \{ coverImageUrl: owned\.url \}\)/)
  })

  it('stays silent: housekeeping behind the scenes never speaks up', () => {
    expect(body()).not.toMatch(/toast\(/)
  })

  it('runs itself once the session has hydrated, so nobody has to ask for it', () => {
    expect(readSrc('src/App.tsx')).toMatch(/if \(!ready \|\| !sessionUserId\) return[\s\S]{0,80}collectUnclaimedCovers\(\)/)
  })
})

describe('the bucket and the uploader agree on what an upload may be', () => {
  it('allows exactly the types the picker offers', () => {
    const declared = /array\[([^\]]+)\]/.exec(BUCKET_SQL)?.[1] ?? ''
    const bucketTypes = [...declared.matchAll(/'([^']+)'/g)].map(m => m[1])
    // The client is not a boundary: a bucket that refuses a type the picker
    // offers fails as an opaque upload error after the creator has waited
    // through a resize, so the two lists are pinned to each other.
    expect(bucketTypes.length).toBeGreaterThan(0)
    expect([...bucketTypes].sort()).toEqual([...COVER_TYPES].sort())
  })

  it('scopes writes to the uploader folder and reads to the public', () => {
    // The three properties the client's path builder and delete-on-replace
    // depend on. Restated here because a migration is applied by hand, and a
    // hand-applied edit is exactly what slips a policy.
    // Public + a size cap on the bucket row itself.
    expect(BUCKET_SQL).toMatch(/file_size_limit/)
    expect(BUCKET_SQL).toMatch(/true,\s+5242880,/)
    expect(BUCKET_SQL).toContain("(storage.foldername(name))[1] = auth.uid()::text")
    expect(BUCKET_SQL).toMatch(/for select using \(bucket_id = 'covers'\)/)
    // Delete is what keeps storage proportional to publications rather than to
    // uploads ever made — without it every replacement leaks its predecessor.
    expect(BUCKET_SQL).toMatch(/for delete to authenticated/)
  })

  // The client's cap is not a boundary — the bucket's is — so the two must not
  // drift apart silently. They had: the client allowed 8 MB against the
  // bucket's 5 MB, so the picker accepted originals the storage layer would
  // never have been handed (it is sent the DOWNSIZED ~78 KB file, not the
  // original). The bucket's own limit was already pinned here; what was missing
  // was the link between the two numbers, so a future migration bump could move
  // one without the other. The limit is now READ OUT of the migration rather
  // than restated, which is what makes that drift impossible (#360).
  it('accepts exactly what the bucket accepts, never more', () => {
    // Equality, not merely "smaller": a client cap well under the bucket's would
    // refuse photos the bucket would have taken, which is the same mismatch in
    // reverse.
    const declared = BUCKET_SQL.match(/true,\s*(\d+),\s*array\[/)
    expect(declared, 'the bucket row no longer declares its size limit').not.toBeNull()
    expect(COVER_MAX_INPUT_BYTES).toBe(Number(declared![1]))
  })

  it('accepts a photo at the cap and refuses one a byte over it', () => {
    // The boundary itself, so a future edit to the comparison cannot pass by
    // accident on one side of it.
    expect(coverFileError({ type: 'image/jpeg', size: COVER_MAX_INPUT_BYTES })).toBeNull()
    expect(coverFileError({ type: 'image/jpeg', size: COVER_MAX_INPUT_BYTES + 1 })).not.toBeNull()
  })

  it('states the real limit in the refusal, rather than a stale one', () => {
    // The sentence used to hardcode "under 8 MB" beside a 5 MB constant. It is
    // derived now, so the two cannot disagree.
    const message = coverFileError({ type: 'image/jpeg', size: COVER_MAX_INPUT_BYTES + 1024 })!
    expect(message).toContain('under 5 MB')
    expect(message).not.toContain('8 MB')
  })

  it('refuses a photo the bucket could not take, not one it could', () => {
    // Worth being precise about, because the report's premise was that a 5–8 MB
    // photo "passes the app's check then fails at upload" — and the UPLOADED
    // bytes are never the original. `uploadCover` downscales to 1200px /
    // quality 0.82 BEFORE calling the bucket, which measures ~78 KB, so a large
    // original never reaches the 5 MB limit and the 8 MB client cap was never
    // the cause of a bucket rejection. What the cap genuinely decided was which
    // originals the creator was allowed to pick at all: a 7 MB photo was decoded
    // and shrunk in the browser to produce a 78 KB file, which is minutes of
    // work on a phone for bytes that were then discarded. Aligning the two is
    // still right — a client cap above a server limit is a lie either way — but
    // the honest justification is refusing work whose result is thrown away, not
    // fixing a failed upload.
    //
    // 6 MB: over the bucket's 5 MB, under the old 8 MB client cap.
    expect(coverFileError({ type: 'image/jpeg', size: 6 * 1024 * 1024 })).not.toBeNull()
    // 4 MB is under both limits, and is the ordinary modern phone photo.
    expect(coverFileError({ type: 'image/jpeg', size: 4 * 1024 * 1024 })).toBeNull()
  })
})
