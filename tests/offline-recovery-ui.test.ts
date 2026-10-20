import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Trip } from '../src/data/types'
import type { QueuedWrite } from '../src/lib/writeQueue'

const fixture = vi.hoisted(() => ({
  userId: 'editor-one' as string | null,
  identity: { userId: 'editor-one' as string | null },
  savedIdentity: null as { userId: string | null } | null,
  online: true,
  writes: [] as QueuedWrite[],
  trips: [] as Trip[],
  slot: 0,
}))

// Supply initial recovery state. Server rendering then checks the real component markup.
// These checks do not exercise browser effects or replace the store integration tests.
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useMemo: () => fixture.identity,
    useState: (initial: unknown) => {
      const slot = fixture.slot++
      if (slot === 0) return [fixture.online, vi.fn()]
      if (slot === 1) return [{
        identity: fixture.savedIdentity ?? fixture.identity,
        writes: fixture.writes,
        error: null,
      }, vi.fn()]
      return [typeof initial === 'function' ? initial() : initial, vi.fn()]
    },
  }
})

vi.mock('../src/store/store', () => ({
  useDb: () => ({ sessionUserId: fixture.userId, trips: fixture.trips, cachedAt: null }),
  getSnapshot: () => ({ sessionUserId: fixture.userId, trips: fixture.trips }),
  resumeSync: vi.fn(async () => {}),
  resolveQueuedTripWrite: vi.fn(async () => true),
}))
vi.mock('../src/lib/timefmt', () => ({ useTimeFormat: () => '24h', formatHM: (value: string) => value }))
vi.mock('../src/lib/writeQueue', () => ({
  pendingWrites: vi.fn(async () => fixture.writes),
  subscribePendingWrites: vi.fn(() => () => {}),
}))
vi.mock('../src/lib/snapshot', () => ({ downloadTripJson: vi.fn() }))

import { OfflineBanner } from '../src/components/OfflineBanner'

function write(overrides: Partial<QueuedWrite> = {}): QueuedWrite {
  return {
    tripId: 'shared-trip', ownerId: 'editor-one', capturedAt: 1_000, attempts: 0,
    trip: { id: 'shared-trip', name: 'PRIVATE_QUEUED_TITLE', days: [] },
    ...overrides,
  }
}

function visibleTrip(userId = 'editor-one'): Trip {
  return {
    id: 'shared-trip', name: 'Authorized shared plan',
    members: [{ userId, role: 'editor', joinedAt: 1 }],
  } as Trip
}

function render() {
  fixture.slot = 0
  return renderToStaticMarkup(createElement(OfflineBanner))
}

beforeEach(() => {
  fixture.userId = 'editor-one'
  fixture.identity = { userId: fixture.userId }
  fixture.savedIdentity = null
  fixture.online = true
  fixture.writes = []
  fixture.trips = []
})

describe('saved-edit recovery presentation', () => {
  it('keeps a clean online screen empty', () => {
    expect(render()).toBe('')
  })

  it('shows online conflicts with explicit choices and an authorized title', () => {
    fixture.writes = [write({ state: 'conflict' })]
    fixture.trips = [visibleTrip()]
    const html = render()
    expect(html).toContain('Authorized shared plan')
    expect(html).toContain('The shared plan has newer changes.')
    expect(html).toContain('Replace shared plan')
    expect(html).toContain('Use shared plan')
    expect(html).toContain('Download my copy')
    expect(html).not.toContain('PRIVATE_QUEUED_TITLE')
  })

  it('shows a generic label and no download for an unreadable trip', () => {
    fixture.writes = [write({ state: 'failed' })]
    fixture.trips = [visibleTrip('another-account')]
    const html = render()
    expect(html).toContain('Saved trip edit')
    expect(html).not.toContain('Authorized shared plan')
    expect(html).not.toContain('PRIVATE_QUEUED_TITLE')
    expect(html).toContain('Download my copy')
    expect(html).toContain('Discard saved edit')
    expect(html).toContain('Retry')
  })

  it('offers the download to a demoted editor, because the copy is on this device', () => {
    fixture.writes = [write({ state: 'failed', reason: 'access-revoked' })]
    // The account can still READ the trip, but it can no longer edit it.
    fixture.trips = [{ ...visibleTrip(), members: [{ userId: 'editor-one', role: 'viewer', joinedAt: 1 }] } as Trip]
    const html = render()
    expect(html).toContain('You can no longer edit this trip. Your saved copy stays on this device.')
    expect(html).toContain('Download my copy')
    expect(html).not.toContain('Retry')
    expect(html).not.toContain('Replace shared plan')
  })

  it('states the reason and offers only the removal for a trip the server no longer has', () => {
    fixture.writes = [write({ state: 'failed', reason: 'trip-unavailable' })]
    fixture.trips = []
    const html = render()
    expect(html).toContain('This trip is no longer on the server. Your saved copy stays on this device.')
    expect(html).toContain('Download my copy')
    expect(html).toContain('Remove saved copy')
    expect(html).not.toContain('Retry')
  })

  it('states the reason for a removed member', () => {
    fixture.writes = [write({ state: 'failed', reason: 'access-removed' })]
    fixture.trips = []
    const html = render()
    expect(html).toContain('You are no longer on this trip. Your saved copy stays on this device.')
    expect(html).toContain('Download my copy')
    expect(html).toContain('Remove saved copy')
  })

  it('never promises a download for a copy it cannot export', () => {
    fixture.writes = [write({ state: 'failed', reason: 'access-revoked', trip: { id: 'shared-trip' } })]
    fixture.trips = []
    const html = render()
    expect(html).toContain('This copy cannot be exported. It stays on this device.')
    expect(html).not.toContain('Download my copy')
  })

  it('hides saved entries immediately after sign-out, even before effects run', () => {
    fixture.writes = [write({ state: 'conflict' })]
    fixture.trips = [visibleTrip()]
    fixture.savedIdentity = fixture.identity
    fixture.userId = null
    fixture.identity = { userId: null }
    expect(render()).toBe('')
    fixture.online = false
    const html = render()
    expect(html).toContain('No connection')
    expect(html).not.toContain('Authorized shared plan')
    expect(html).not.toContain('Replace shared plan')
    expect(html).not.toContain('Check sync')
  })

  it('hides an older account read immediately during an account switch', () => {
    fixture.writes = [write({ state: 'failed' })]
    fixture.trips = [visibleTrip()]
    fixture.savedIdentity = fixture.identity
    fixture.userId = 'editor-two'
    fixture.identity = { userId: fixture.userId }
    expect(render()).toBe('')
  })

  it('keeps downloads available offline and disables all network choices', () => {
    fixture.online = false
    fixture.writes = [write({ state: 'conflict' })]
    fixture.trips = [visibleTrip()]
    const buttons = render().match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []
    expect(buttons).toHaveLength(4)
    const download = buttons.find(button => button.includes('Download my copy'))!
    expect(download).not.toContain('disabled')
    for (const button of buttons.filter(value => value !== download)) expect(button).toContain('disabled')
  })

  it('shows memory-only storage failure without claiming durable storage', () => {
    fixture.writes = [write({ state: 'failed', storageFailed: true })]
    fixture.trips = [visibleTrip()]
    const html = render()
    expect(html).toContain('Device storage is unavailable. Keep this tab open and download your copy.')
    expect(html).not.toContain('Your saved copy stays on this device.')
    expect(html).toContain('role="alert"')
  })

  it('offers a removal that works without a connection', () => {
    fixture.online = false
    fixture.writes = [write({ state: 'failed', reason: 'access-revoked' })]
    fixture.trips = [visibleTrip()]
    const buttons = render().match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []
    const removal = buttons.find(button => button.includes('Remove saved copy'))!
    // The removal is a local action, so it is not disabled offline.
    expect(removal).not.toContain('disabled')
    // The network choices still are.
    for (const button of buttons.filter(value => value !== removal)) {
      if (button.includes('Download my copy')) continue
      expect(button).toContain('disabled')
    }
  })

  it('names the cause when a removal is refused offline', () => {
    // The refusal only happens for a HELD overlay, and only when the server
    // could not be read. The notice must say so, because a retry only helps
    // once the device is back online.
    const source = readFileSync(new URL('../src/components/OfflineBanner.tsx', import.meta.url), 'utf8')
    expect(source).toContain('The shared plan could not be read. Try again when you are back online.')
    // The reason decides which notice is shown, so a reasoned copy never gets
    // the "shared plan" wording.
    expect(source).toContain('const overlayOnScreen = !write.reason')
  })
})

describe('recovery access and async guard wiring', () => {
  const source = readFileSync(new URL('../src/components/OfflineBanner.tsx', import.meta.url), 'utf8')

  it('scopes queued reads and rejects old results', () => {
    expect(source).toContain('writes.filter(write => write.ownerId === userId)')
    expect(source).toContain('currentRead !== readId')
    expect(source).toContain('identityRef.current !== identity')
    expect(source).toContain('subscribePendingWrites(refreshSoon)')
    expect(source).not.toContain('pendingWriteCount(')
  })

  it('checks the current account and the queued owner again before downloading', () => {
    const download = source.slice(source.indexOf('function download('), source.indexOf('if (online && writes.length'))
    expect(download).toContain('const current = getSnapshot()')
    expect(download).toContain('current.sessionUserId === userId')
    expect(download).toContain('write.ownerId !== userId')
    expect(download.indexOf('!owns')).toBeLessThan(download.indexOf('downloadTripJson(trip)'))
    // The export does not need a live edit role. The copy is on this device.
    expect(download).not.toContain("member.role === 'owner'")
  })

  it('gives the sync check a 44px target', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.offline-banner-summary \.btn\s*\{[^}]*min-height:\s*44px/)
  })

  it('uses token-based motion with a reduced-motion opt-out', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.offline-recovery-row\s*\{[^}]*animation:\s*cardIn var\(--motion-slow\) var\(--ease-out\)/)
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.offline-recovery-row\s*\{\s*animation:\s*none/)
  })

  it('wires the removal to a local handler, not the network one', () => {
    // The removal is a local action. It must not go through `recover`, which
    // refuses every offline call, or the button would be a no-op offline.
    expect(source).toContain('onClick={() => { void removeCopy(write) }}')
    const removal = source.slice(source.indexOf('function removeCopy('), source.indexOf('async function recover('))
    // The guard must not send the removal away when the device is offline.
    // The guard is the first line, and it checks the account, not the network.
    const guard = removal.slice(0, removal.indexOf('const runId'))
    expect(guard).not.toContain('!online')
    expect(guard).toContain('write.ownerId !== userId')
    expect(removal).toContain("resolveQueuedTripWrite(write.tripId, 'discard')")
  })
})
