import { describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Trip } from '../src/data/types'
import type { QueuedWrite } from '../src/lib/writeQueue'

// This file RENDERS the real OfflineBanner with synthetic recovery states and
// writes a static HTML page that carries the real stylesheet. A browser then
// reads that page for the geometry, the target sizes and the clipping.
//
// It is a scratch evidence generator, not a product test. It asserts that the
// states render, and it writes the page for the browser pass.

const fixture = vi.hoisted(() => ({
  userId: 'editor-one' as string | null,
  identity: { userId: 'editor-one' as string | null },
  savedIdentity: null as { userId: string | null } | null,
  online: true,
  writes: [] as QueuedWrite[],
  trips: [] as Trip[],
  slot: 0,
}))

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
    trip: { id: 'shared-trip', name: 'Queued title', days: [] },
    ...overrides,
  }
}

function visibleTrip(role: 'owner' | 'editor' | 'viewer' = 'editor'): Trip {
  return {
    id: 'shared-trip', name: 'Authorized shared plan',
    members: [{ userId: 'editor-one', role, joinedAt: 1 }],
  } as Trip
}

function render(): string {
  fixture.slot = 0
  return renderToStaticMarkup(createElement(OfflineBanner))
}

const CASES: { name: string; html: string }[] = []

function capture(name: string) {
  CASES.push({ name, html: render() })
}

describe('recovery state gallery', () => {
  it('renders every synthetic recovery state', () => {
    fixture.userId = 'editor-one'
    fixture.identity = { userId: 'editor-one' }
    fixture.online = true

    // 1. A demoted editor. The copy is kept and the download stays.
    fixture.writes = [write({ state: 'failed', reason: 'access-revoked' })]
    fixture.trips = [visibleTrip('viewer')]
    capture('demoted')

    // 2. A removed member. The copy is kept and the download stays.
    fixture.writes = [write({ state: 'failed', reason: 'access-removed' })]
    fixture.trips = []
    capture('removed')

    // 3. A trip the server no longer has.
    fixture.writes = [write({ state: 'failed', reason: 'trip-unavailable' })]
    fixture.trips = []
    capture('unavailable')

    // 4. A copy that cannot be exported. No download is promised.
    fixture.writes = [write({ state: 'failed', reason: 'access-revoked', trip: { id: 'shared-trip' } })]
    fixture.trips = []
    capture('not-exportable')

    // 5. A conflict with a readable trip. The full choice set.
    fixture.writes = [write({ state: 'conflict' })]
    fixture.trips = [visibleTrip('editor')]
    capture('conflict')

    // 6. A waiting edit, online.
    fixture.writes = [write()]
    fixture.trips = [visibleTrip('editor')]
    capture('waiting')

    // 7. Offline, with a waiting edit.
    fixture.online = false
    capture('offline')

    expect(CASES).toHaveLength(7)
    for (const item of CASES) expect(item.html.length).toBeGreaterThan(50)
  })

  it('writes the gallery page with the real stylesheet', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
    const page = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline recovery states</title>
<style>${css}</style>
<style>
  body { margin: 0; background: var(--bg); }
  .gallery { padding: 16px; display: grid; gap: 28px; }
  .gallery figure { margin: 0; display: grid; gap: 6px; }
  .gallery figcaption { font: 600 13px/1.4 system-ui, sans-serif; color: var(--text-2); }
  .gallery .frame { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
</style>
</head>
<body>
<div class="gallery">
${CASES.map(item => `  <figure>
    <figcaption>${item.name}</figcaption>
    <div class="frame">${item.html}</div>
  </figure>`).join('\n')}
</div>
</body>
</html>`
    // The evidence directory is git-ignored, so the page never pollutes the repo.
    const dir = new URL('../.verify-evidence/', import.meta.url)
    mkdirSync(dir, { recursive: true })
    const out = new URL('recovery-gallery.html', dir)
    writeFileSync(out, page, 'utf8')
    expect(readFileSync(out, 'utf8').length).toBeGreaterThan(1000)
  })
})
