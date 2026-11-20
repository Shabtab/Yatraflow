import { afterAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TripCard } from '../src/components/trips/TripCard'
import { UpNextCard } from '../src/components/trips/UpNextCard'
import { seedData } from '../src/data/seed'

describe('owner-only trash controls on both trip cards', () => {
  vi.stubGlobal('location', { protocol: 'http:' })
  afterAll(() => vi.unstubAllGlobals())
  for (const role of ['owner', 'editor', 'viewer', 'commenter'] as const) {
    it(`both cards check trash access for ${role}`, () => {
      const trip = { ...seedData.trips[0], members: [{ userId: 'caller', role, joinedAt: 1 }] }
      const common = { trip, today: new Date('2026-11-16'), budget: 'Budget', users: [], meId: 'caller', onDelete: () => {} }
      const cards = [
        ['TripCard', createElement(TripCard, { ...common, readyToGo: true, toFix: 0, enterIndex: 0 })],
        ['UpNextCard', createElement(UpNextCard, { ...common, distanceKm: 0, dayCells: [], health: { score: 90, band: 'Comfortable' } })],
      ] as const
      for (const [name, card] of cards) {
        const html = renderToStaticMarkup(card)
        expect(html.includes('aria-label="Delete '), `${name} trash control for ${role}`).toBe(role === 'owner')
      }
    })
  }
})
