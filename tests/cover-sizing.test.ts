// ============ Stored covers get sized too (web critique, 2026-09-17) ============
// The v0.58.0 sizing fix ran only inside the *auto* Wikipedia extraction path,
// so an explicit `cover_image_url` was rendered raw. A live publication shipped
// its hero at 1,305 KB (Chandratal, 2496×1664) while the same page load sized
// the auto picks — measured in a real browser, and invisible to tsc, the tests
// and the build, exactly like the duplicated-measurement bug #184.
//
// The pure behaviour is covered in tripThumb.test.ts. What this file pins is the
// WIRING: every surface that renders or writes a stored cover has to route it
// through `sizedCoverUrl`, or the fix only reaches one of them.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { sizedCoverUrl } from '../src/lib/tripThumb'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

/** The exact row the live page served: a REST original with its tracking query. */
const LIVE_STORED =
  'https://upload.wikimedia.org/wikipedia/commons/3/3a/Chandratal_1.JPG' +
  '?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail_unscaled'

describe('sizedCoverUrl on a stored cover', () => {
  it('transforms the 1,305 KB stored original the live publication served', () => {
    expect(sizedCoverUrl(LIVE_STORED)).toBe(
      'https://commons.wikimedia.org/wiki/Special:Redirect/file/Chandratal_1.JPG?width=1200',
    )
  })

  it('is idempotent, because sizing now runs at write time AND at render time', () => {
    const once = sizedCoverUrl(LIVE_STORED)
    expect(sizedCoverUrl(once)).toBe(once)
    // A width-varied thumb of the same file also settles on one URL.
    const thumb = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/b9/Munnar_Overview.jpg/3840px-Munnar_Overview.jpg'
    const sized = sizedCoverUrl(thumb)
    expect(sizedCoverUrl(sized)).toBe(sized)
  })

  it('still leaves an owner-pasted non-Wikimedia URL exactly as given', () => {
    const custom = 'https://images.example.test/my-cover.jpg?w=2000'
    expect(sizedCoverUrl(custom)).toBe(custom)
  })
})

describe('every stored-cover surface is wired to the sizer', () => {
  it('the public itinerary hero sizes the stored cover', () => {
    const page = read('../src/pages/PublicItinerary.tsx')
    // #914 — a photo cover goes through the sizer. A stored artwork cover is
    // drawn by RegionArt instead, so its WebP never becomes the hero photo.
    expect(page).toMatch(/const heroSrc = pub\.coverImageUrl && !artIdFromCoverUrl\(pub\.coverImageUrl\) \? sizedCoverUrl\(pub\.coverImageUrl\) : undefined/)
    expect(page).toMatch(/artIdFromCoverUrl\(pub\.coverImageUrl\) \? <RegionArt/)
    expect(page).not.toMatch(/useDestinationCover|heroAuto/)
    // the hero must render the sized value, never the raw column
    expect(page).toMatch(/src=\{heroSrc\}/)
    expect(page).not.toMatch(/src=\{pub\.coverImageUrl/)
  })

  it('the shared card sizes an explicit cover', () => {
    const card = read('../src/components/CoverThumb.tsx')
    // The explicit URL is the first candidate, sized on the way in.
    expect(card).toMatch(/const userCover = explicitUrl \? sizedCoverUrl\(explicitUrl\) : ''/)
    expect(card).toMatch(/userCover,/)
    // …and it reaches the renderer through the shared plan, never as a raw src.
    expect(card).toContain('coverPlanFor({')
    expect(card).toContain('<CoverMedia')
  })

  it('the owner control sizes a cover on the way into the row', () => {
    const picker = read('../src/components/CoverImagePicker.tsx')
    expect(picker).toMatch(/coverImageUrl: url \? sizedCoverUrl\(url\) : undefined/)
    // and previews it sized, so the control itself is not the heavy view
    expect(picker).toMatch(/const previewCover = trip\.coverImageUrl\s*\? sizedCoverUrl\(trip\.coverImageUrl\)/)
  })

  // The plan is built from the cover URL, so a surface that hands it a RAW
  // stored address re-introduces the 1.3 MB original the sizer exists to stop.
  // Each adapter below passes the sizer's own output, never the column.
  it.each([
    ['../src/components/trips/TripCover.tsx', 'trip.coverImageUrl'],
    ['../src/pages/TripWorkspace.tsx', 'trip.coverImageUrl'],
    ['../src/pages/CreateTrip.tsx', 'f.coverImageUrl'],
  ])('%s sizes the stored cover before building the plan', (path, field) => {
    const source = read(path)
    expect(source).toContain(`sizedCoverUrl(${field})`)
    // The raw column must never be handed straight to the resolver.
    expect(source).not.toMatch(new RegExp(`userCover: ${field.replace('.', '\\.')}[,\\n]`))
  })
})
