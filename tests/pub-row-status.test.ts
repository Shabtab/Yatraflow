// ============ MR11 — the publication row's status ============
//
// The owner dashboard's publication rows state a status and offer an
// action. Both are read from one derivation (`lib/pubRowStatus.ts`),
// so the bug class this file kills is a row whose two halves
// disagree — a row labelled "Live" beside a "Publish again" button,
// or an "Update page" button on a page that is down. The rules are
// pure, so this suite pins them with no DOM.
import { describe, expect, it } from 'vitest'
import { pubRowStatus } from '../src/lib/pubRowStatus'

const pub = (over: { unpublishedAt?: number; refreshedAt?: number; publishedAt?: number } = {}) => ({
  publishedAt: 1000,
  ...over,
})

describe('pubRowStatus', () => {
  it('calls a page live when the itinerary has not moved since it was built', () => {
    const s = pubRowStatus(pub({ refreshedAt: 2000 }), { updatedAt: 1500 })
    expect(s.key).toBe('live')
    expect(s.label).toBe('Live')
    expect(s.action).toBe('edit')
  })

  it('calls a page live when the trip is not loaded at all', () => {
    expect(pubRowStatus(pub(), undefined).key).toBe('live')
  })

  it('calls a page behind when the itinerary changed after the page was built', () => {
    const s = pubRowStatus(pub({ refreshedAt: 1500 }), { updatedAt: 2000 })
    expect(s.key).toBe('behind')
    expect(s.label).toBe('Page behind itinerary')
    expect(s.action).toBe('update-page')
  })

  it('measures against publish time when the page never refreshed', () => {
    expect(pubRowStatus(pub({ publishedAt: 1000 }), { updatedAt: 1001 }).key).toBe('behind')
    expect(pubRowStatus(pub({ publishedAt: 1000 }), { updatedAt: 999 }).key).toBe('live')
  })

  it('reads a refresh as the build time, so a refreshed page is not behind', () => {
    // publishedAt is old, but the page was rebuilt after the edit.
    expect(pubRowStatus(pub({ publishedAt: 1000, refreshedAt: 3000 }), { updatedAt: 2000 }).key).toBe('live')
  })

  it('does not call an equal timestamp behind — a tie is not an edit', () => {
    expect(pubRowStatus(pub({ refreshedAt: 2000 }), { updatedAt: 2000 }).key).toBe('live')
  })

  it('keeps a withdrawn page unpublished, whatever the itinerary did after', () => {
    const s = pubRowStatus(pub({ unpublishedAt: 900, refreshedAt: 1000 }), { updatedAt: 9999 })
    expect(s.key).toBe('unpublished')
    expect(s.label).toBe('Unpublished')
    expect(s.action).toBe('publish-again')
  })

  it('never pairs a status with another status’s action', () => {
    const cases = [
      pubRowStatus(pub({ refreshedAt: 2000 }), { updatedAt: 1500 }),
      pubRowStatus(pub({ refreshedAt: 1500 }), { updatedAt: 2000 }),
      pubRowStatus(pub({ unpublishedAt: 900 }), { updatedAt: 9999 }),
    ]
    const pairs = [['live', 'edit'], ['behind', 'update-page'], ['unpublished', 'publish-again']]
    for (const s of cases) {
      expect(pairs).toContainEqual([s.key, s.action])
    }
  })
})
