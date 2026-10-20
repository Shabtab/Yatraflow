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
    expect(html).not.toContain('Download my copy')
    expect(html).toContain('Discard saved edit')
    expect(html).toContain('Retry')
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

  it('checks current account and membership again before downloading', () => {
    const download = source.slice(source.indexOf('function download('), source.indexOf('if (online && writes.length'))
    expect(download).toContain('const current = getSnapshot()')
    expect(download).toContain('current.sessionUserId === userId')
    expect(download).toContain('member.userId === userId')
    expect(download).toContain('write.ownerId !== userId')
    expect(download.indexOf('!authorized')).toBeLessThan(download.indexOf('downloadTripJson(trip)'))
  })

  it('uses token-based motion with a reduced-motion opt-out', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.offline-recovery-row\s*\{[^}]*animation:\s*cardIn var\(--motion-slow\) var\(--ease-out\)/)
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.offline-recovery-row\s*\{\s*animation:\s*none/)
  })
})
