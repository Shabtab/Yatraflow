import { afterAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TripCard } from '../src/components/trips/TripCard'
import { UpNextCard } from '../src/components/trips/UpNextCard'
import { seedData } from '../src/data/seed'

describe('owner-only trash controls on both trip cards', () => {
  vi.stubGlobal('location', { protocol: 'http:' })
  afterAll(() => vi.unstubAllGlobals())
  for (const Card of [TripCard, UpNextCard]) {
    for (const role of ['owner', 'editor', 'viewer', 'commenter'] as const) {
      it(`${Card.name} checks trash access for ${role}`, () => {
        const trip = { ...seedData.trips[0], members: [{ userId: 'caller', role, joinedAt: 1 }] }
        const html = renderToStaticMarkup(createElement(Card, {
          trip, today: new Date('2026-11-16'), budget: 'Budget', totalTravelMinutes: 0,
          users: [], meId: 'caller', enterIndex: 0, onDelete: () => {},
        }))
        expect(html.includes('aria-label="Delete ')).toBe(role === 'owner')
      })
    }
  }
})
