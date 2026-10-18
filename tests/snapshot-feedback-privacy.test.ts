// ============ Snapshot privacy in feedback drafts (#805) ============
// A support draft is a disclosure to a third party. The reporter may forward
// it, the mail provider logs it, and the reader never sees what a snapshot
// route resolved to. So the payload must not reach the draft body.
//
// These tests drive the real encoder to build a link, hand the address to the
// real feedback builder, then pull the token back out of the generated draft
// and run the real decoder on it. A canary trip name that comes back decoded
// means the trip travelled; a null answer means it did not.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { feedbackHref } from '../src/lib/feedback'
import { decodeTripSnapshot, encodeTripSnapshot, snapshotUrl } from '../src/lib/snapshot'
import { forceNativeRouting } from '../src/lib/router'
import { seedData } from '../src/data/seed'

const ORIGIN = 'https://app.example.test'
const CANARY = 'FEEDBACK-805-CANARY'

// The same source vite.config.ts reads for __APP_VERSION__, so the test follows
// every release and this branch's own version instead of naming one.
const APP_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version

function canaryTrip() {
  return { ...structuredClone(seedData.trips[0]), name: CANARY }
}

function stubAddress(url: string) {
  const address = new URL(url)
  vi.stubGlobal('location', address)
  return address
}

/** The `Page:` value the generated draft actually carries, decoded out of the
 *  mailto rather than reconstructed from the code that built it. */
function draftPage(href: string): string {
  const body = new URL(href).searchParams.get('body') ?? ''
  const line = body.split('\n').find(l => l.startsWith('Page: '))
  return line ? line.slice('Page: '.length).trim() : ''
}

/** Read the draft the way a holder of it would: take the token after the share
 *  segment and run the shipped decoder on it. Returns the trip name, or null
 *  when the draft carries no readable trip. */
async function tripNameRecoveredFrom(href: string): Promise<string | null> {
  const token = /\/share\/([^/?#\s]+)/.exec(draftPage(href))?.[1]
  if (!token) return null
  try {
    return (await decodeTripSnapshot(token)).name
  } catch {
    return null
  }
}

beforeEach(() => {
  forceNativeRouting(false)
  vi.stubGlobal('__APP_VERSION__', APP_VERSION)
})
afterEach(() => {
  forceNativeRouting(null)
  vi.unstubAllGlobals()
})

describe('a support draft never carries a snapshot payload', () => {
  it('does not leak a new fragment link, which the route reader now resolves', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    stubAddress(`${ORIGIN}/trips`)
    // The address a reader of a new link has, exactly as snapshotUrl built it.
    const address = new URL(snapshotUrl(trip, payload))
    stubAddress(address.href)
    const href = feedbackHref()
    expect(draftPage(href)).not.toContain(payload)
    expect(await tripNameRecoveredFrom(href)).toBeNull()
  })

  it('does not leak a legacy path link', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    stubAddress(`${ORIGIN}/share/${payload}`)
    const href = feedbackHref()
    expect(draftPage(href)).not.toContain(payload)
    expect(await tripNameRecoveredFrom(href)).toBeNull()
  })

  it('does not leak a native snapshot route', async () => {
    forceNativeRouting(true)
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    stubAddress(`https://localhost/index.html#/share/${payload}`)
    const href = feedbackHref()
    expect(draftPage(href)).not.toContain(payload)
    expect(await tripNameRecoveredFrom(href)).toBeNull()
  })

  it('keeps the whole trip out of the subject and the body', async () => {
    const trip = canaryTrip()
    const payload = await encodeTripSnapshot(trip)
    stubAddress(`${ORIGIN}/share/${payload}`)
    const href = feedbackHref()
    const decoded = decodeURIComponent(href)
    expect(decoded).not.toContain(payload)
    expect(decoded).not.toContain(CANARY)
  })
})

describe('the draft stays useful for a report', () => {
  it('names the route and the app version', async () => {
    stubAddress(`${ORIGIN}/share/yf1_payload`)
    const href = feedbackHref()
    // The route label survives redaction; only the token goes.
    expect(draftPage(href)).toBe('/share')
    const subject = new URL(href).searchParams.get('subject') ?? ''
    expect(subject).toContain(APP_VERSION)
    expect(new URL(href).searchParams.get('body')).toContain(`App version: ${APP_VERSION}`)
  })

  it.each(['/trips', '/explore?q=goa', '/pub/kerala-trip_1', '/join/GOA4X2', '/'])(
    'passes an ordinary route through unchanged: %s',
    route => {
      stubAddress(`${ORIGIN}${route}`)
      expect(draftPage(feedbackHref())).toBe(route)
    },
  )

  it('keeps the mailto shape the footer and the profile menu link on', () => {
    stubAddress(`${ORIGIN}/trips`)
    const href = feedbackHref()
    expect(href.startsWith('mailto:support@yatraflow.app?')).toBe(true)
    expect(href).toContain('subject=')
    expect(href).toContain('body=')
  })
})