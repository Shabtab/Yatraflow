// ============ The publish-draft stash (#368) ============
// The stash is the handoff between the import offer and the publish form:
// one trip, one draft, consumed on the first read. Node has no sessionStorage,
// so these run the in-memory path; the session path shares the same guards.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { stashPublishDraft, takePublishDraft } from '../src/lib/publishDraft'
import type { PublicationDraft } from '../src/lib/itinerarySpec'

const draft: PublicationDraft = {
  id: 'goa-north-to-south', title: 'Goa, North to the Quiet South',
  coverImageUrl: 'https://x/y.jpg', premiumPriceInr: 199,
  freeDayIndexes: [1], subscriberCta: 'Unlock the quiet south.',
}

describe('publishDraft — consume-once semantics (#368)', () => {
  it('answers null when nothing was stashed for the trip', () => {
    expect(takePublishDraft('trip-none')).toBeNull()
  })

  it('hands the draft back once, then nothing', () => {
    stashPublishDraft('trip-once', draft)
    expect(takePublishDraft('trip-once')).toEqual(draft)
    expect(takePublishDraft('trip-once')).toBeNull()
  })

  it('keeps trips apart', () => {
    stashPublishDraft('trip-a', { ...draft, title: 'A' })
    stashPublishDraft('trip-b', { ...draft, title: 'B' })
    expect(takePublishDraft('trip-a')?.title).toBe('A')
    expect(takePublishDraft('trip-b')?.title).toBe('B')
    expect(takePublishDraft('trip-a')).toBeNull()
  })

  it('a second stash for the same trip replaces the first', () => {
    stashPublishDraft('trip-re', { ...draft, title: 'First' })
    stashPublishDraft('trip-re', { ...draft, title: 'Second' })
    expect(takePublishDraft('trip-re')?.title).toBe('Second')
  })
})

describe('publishDraft — the wiring pins (#368)', () => {
  // A source pin judges code, not prose — strip comment lines first.
  const strip = (src: string) => src
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*\*.*$/gm, '')
    .replace(/^\s*\/\*+.*$/gm, '')
  const form = strip(readFileSync('src/pages/trip/ShareTab.tsx', 'utf8'))
  const button = strip(readFileSync('src/components/ImportTripButton.tsx', 'utf8'))

  it('the publish form consumes takePublishDraft and seeds the form with it', () => {
    expect(form).toContain('takePublishDraft(trip.id)')
    expect(form).toContain('draft={draft}')
  })

  it('the import button offers the stash and no longer announces data loss', () => {
    expect(button).toContain('stashPublishDraft(')
    expect(button).toContain('Publish details found')
    expect(button).not.toContain('were not applied')
  })
})
