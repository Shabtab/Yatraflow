import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Trip } from '../src/data/types'
import { BoardView } from '../src/components/BoardView'
import { computeHealth, computeTotals } from '../src/lib/engine'

vi.mock('../src/components/TripMap', () => ({ TripMap: () => null }))
vi.mock('../src/components/StopEditor', () => ({ StopEditor: () => null }))
vi.mock('../src/components/useStopConflict', () => ({ useStopConflict: () => ({}) }))
vi.mock('../src/store/store', async importOriginal => ({
  ...await importOriginal<typeof import('../src/store/store')>(),
  useDb: () => ({ decisions: [] }),
}))

function render(mode: Trip['transportMode']) {
  const trip: Trip = {
    id: 'trip', name: 'Flight trip', startLocation: 'Delhi', destinations: ['Mumbai'],
    startDate: '2026-11-01', endDate: '2026-11-01', travellers: 1,
    transportMode: mode, budgetPerPersonInr: 20000, travelStyle: 'balanced',
    days: [{ id: 'day', index: 0, stops: [{
      id: 'stop', title: 'Delhi to Mumbai', category: 'travel', locationName: 'Mumbai',
      lat: 19, lng: 73, visitMinutes: 135, entryFeeInrPerPerson: 0,
      transportCostInrTotal: 0, priority: 'must-do', status: 'confirmed', orderInDay: 0,
    }] }],
    fixedCommitments: [], expenses: [], coverEmoji: '', visibility: 'private', createdAt: 1, updatedAt: 1,
  }
  return renderToStaticMarkup(createElement(BoardView, {
    trip, editable: false, applyChange: () => {}, onOpenOverview: () => {},
    health: computeHealth(trip), totals: computeTotals(trip),
  }))
}

describe('Board transport rendering', () => {
  it.each([
    ['flight', 'Flight', 'plane'], ['train', 'Train', 'train-front'], ['bus', 'Bus', 'bus'],
    ['car', 'Drive', 'car'],
  ] as const)('renders the %s label and icon', (mode, label, icon) => {
    const html = render(mode)
    const kicker = html.match(/<span class="board-stop-kicker">(.*?)<\/span>/)?.[1]
    expect(kicker).toContain(`lucide-${icon}`)
    expect(kicker).toContain(`</svg>${label}`)
    if (mode === 'flight') expect(kicker).not.toContain('Drive')
  })
})
