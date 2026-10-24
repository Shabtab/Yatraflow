import type { Trip } from '../data/types'
import { computeHealth, type LegEstimate } from './engine'
import { roadChainSig } from './tripRoad'

/** Reuse measured roads only while their route and day assignment still match. */
export function settingsPreview(trip: Trip, patch: Partial<Trip>, days: Trip['days'], corrections?: Record<string, LegEstimate>) {
  const drafted: Trip = { ...trip, ...patch, days }
  const key = (t: Trip) => JSON.stringify([
    roadChainSig(t), t.flights,
    t.days.map(d => [d.index, d.stops.filter(s => s.status !== 'rejected').map(s => s.id)]),
  ])
  const measured = key(trip) === key(drafted) ? corrections : undefined
  return { health: computeHealth(drafted, measured), estimated: !measured || Object.keys(measured).length === 0 }
}
