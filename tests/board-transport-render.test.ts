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

function render(mode: Trip['transportMode'], patch: Partial<Trip> = {}) {
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
    ...patch,
  }
  return renderToStaticMarkup(createElement(BoardView, {
    trip, editable: false, applyChange: () => {}, onOpenOverview: () => {},
    health: computeHealth(trip), totals: computeTotals(trip),
  }))
}

describe('Board transport rendering', () => {
  it('shows the flight duration when the only saved stops are route anchors', () => {
    const html = render('flight', {
      startLocationCoords: { lat: 28.6139, lng: 77.209 },
      destinationCoords: [{ lat: 18.922, lng: 72.834 }],
      days: [{ id: 'day', index: 0, stops: [] }],
      flights: [{ id: 'flight', dayIndex: 0, fromAirport: 'DEL', toAirport: 'BOM', departAt: '06:00', arriveAt: '08:15' }],
    })
    expect(html).toContain('Flight time')
    expect(html).toContain('2h 15m')
    expect(html).toContain('Ground travel')
    expect(html).toContain('DEL')
    expect(html).toContain('BOM')
    expect(html).not.toContain('Estimated block time')
  })

  it('labels a flight estimate and leaves local days without a flight card', () => {
    const html = render('flight', {
      startLocationCoords: { lat: 28.6139, lng: 77.209 },
      destinationCoords: [{ lat: 18.922, lng: 72.834 }],
      days: [{ id: 'day', index: 0, stops: [] }, { id: 'local', index: 1, stops: [] }],
      flights: [{ id: 'flight', dayIndex: 0, fromAirport: 'DEL', toAirport: 'BOM' }],
    })
    expect(html.match(/aria-label="Flight journey"/g)).toHaveLength(1)
    expect(html).toContain('Estimated block time')
  })

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
