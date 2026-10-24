import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveDrivingPlan, planRideSegments } from '../src/lib/ridePlan'
import { planJourneyHalts } from '../src/lib/geocode'
import { computeImpact } from '../src/lib/impact'
import { removeStopWithUndo } from '../src/lib/mutationLifecycle'
import { workspacePreviewActions, type PendingChange } from '../src/pages/TripWorkspace'
import { seedData } from '../src/data/seed'
import { duplicateTrip, tripById, updateTrip, _setTripWriteDebounceMs } from '../src/store/store'
import type { Trip } from '../src/data/types'

const providers = vi.hoisted(() => ({
  googleEnabled: vi.fn(() => false),
  searchNearbyPoisMultiFree: vi.fn(async () => []),
  searchCitiesAlong: vi.fn(async () => []),
  googleCitiesAlong: vi.fn(async () => []),
  googleNearbyAlongRoute: vi.fn(async () => []),
}))

vi.mock('../src/lib/providers/free', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/providers/free')>(),
  searchNearbyPoisMultiFree: providers.searchNearbyPoisMultiFree,
  searchCitiesAlong: providers.searchCitiesAlong,
}))
vi.mock('../src/lib/providers/google', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/providers/google')>(),
  googleEnabled: providers.googleEnabled,
  googleCitiesAlong: providers.googleCitiesAlong,
  googleNearbyAlongRoute: providers.googleNearbyAlongRoute,
}))
vi.mock('../src/lib/ridePlan', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/lib/ridePlan')>()
  return { ...actual, planRideSegments: vi.fn(actual.planRideSegments) }
})

const { undoToasts, messages } = vi.hoisted(() => ({
  undoToasts: [] as Array<{ run: () => void }>,
  messages: [] as string[],
}))
vi.mock('../src/components/ui', async importOriginal => ({
  ...await importOriginal<typeof import('../src/components/ui')>(),
  toast: (message: string) => { messages.push(message) },
  undoToast: (_message: string, run: () => void) => { undoToasts.push({ run }) },
}))
vi.mock('../src/lib/supabase', () => {
  function from() {
    const builder = {
      update: () => builder, insert: () => builder, delete: () => builder,
      select: () => builder, eq: () => builder, in: () => builder,
      order: () => builder, limit: () => builder, lt: () => builder,
      maybeSingle: () => builder, single: () => builder,
      setHeader: () => builder, is: () => builder,
      then: (resolve: (result: { data: null; error: null }) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    }
    return builder
  }
  return { isSupabaseConfigured: false, supabase: { from } }
})

beforeEach(() => {
  vi.clearAllMocks()
  undoToasts.length = 0
  messages.length = 0
  _setTripWriteDebounceMs(0)
})

describe('the journey consumer forwards the shared driving plan', () => {
  it.each([false, true])('uses the plan boundaries and saved clocks with Google enabled = %s', async googleMode => {
    providers.googleEnabled.mockReturnValue(googleMode)
    const plan = deriveDrivingPlan({
      totalKm: 1400, driveMinutes: 1500, transportMode: 'car',
      travelStyle: 'relaxed', driverCount: 1, hasVulnerable: true,
      dayStart: '08:30', dayStartTimes: ['08:30', '14:15', '09:45', '10:10'],
      anchors: { dinnerStartMin: 19 * 60, dinnerEndMin: 20 * 60 },
    })
    expect(plan.verdict).toBe('ok')
    expect(plan.outbound.length).toBeGreaterThan(2)
    expect(plan.outbound[1].startMin).toBe(14 * 60 + 15)
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network access is forbidden'))
    try {
      const hits = await planJourneyHalts(
        [{ lat: 20, lng: 73 }, { lat: 28, lng: 82 }], 1400, 1500,
        {
          plan, transportMode: 'car', travelStyle: 'packed',
          dayStartTimes: ['06:00', '06:00'],
          routeCoords: [[73, 20], [82, 28]],
        },
      )
      expect(planRideSegments).toHaveBeenCalledTimes(1)
      const call = vi.mocked(planRideSegments).mock.calls[0][0]
      expect(call.dayBoundaries).toBe(plan.outbound)
      expect(call.dayStartTimes).toEqual(plan.outbound.map(day =>
        `${String(Math.floor(day.startMin / 60)).padStart(2, '0')}:${String(day.startMin % 60).padStart(2, '0')}`,
      ))
      const planned = vi.mocked(planRideSegments).mock.results[0].value
      expect(planned.filter(segment => segment.dayEnd).map(segment => segment.targetKm))
        .toEqual(plan.outbound.slice(0, -1).map(day => day.endKm))
      expect(hits.filter(hit => hit.segment.purpose === 'overnight').map(hit => hit.segment.targetKm))
        .toEqual(plan.outbound.slice(0, -1).map(day => day.endKm))
      expect(providers.searchCitiesAlong).toHaveBeenCalledTimes(1)
      expect(googleMode ? providers.googleNearbyAlongRoute : providers.searchNearbyPoisMultiFree).toHaveBeenCalledTimes(1)
      expect(providers.googleCitiesAlong).toHaveBeenCalledTimes(googleMode ? 1 : 0)
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })
})

describe('the workspace uses its production preview handlers', () => {
  it('discards, chains, keeps the displayed proposal, and restores the removed stop with Undo', () => {
    const source = readFileSync(new URL('../src/pages/TripWorkspace.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    expect(source).toContain('() => workspacePreviewActions({ trip, pendingRef, baseRef, legCorrRef, setPending })')
    expect(source).toContain('(...args) => previewActions().applyChange(...args)')
    expect(source).toContain('const keepPending = () => previewActions().keepPending()')
    expect(source).toContain('const removePending = () => previewActions().removePending()')
    const trip = duplicateTrip(seedData.trips[0], 'wiring-owner')
    const day = trip.days.find(candidate => candidate.stops.length >= 2)!
    const victim = day.stops[1]
    const before = structuredClone(trip)
    const pendingRef: { current: PendingChange | null } = { current: null }
    const baseRef: { current: Trip | null } = { current: null }
    const setPending = vi.fn()
    const actions = workspacePreviewActions({ trip, pendingRef, baseRef, legCorrRef: { current: undefined }, setPending })
    const remove = () => removeStopWithUndo({ trip, stopId: victim.id, dayIndex: day.index, applyChange: actions.applyChange })
    expect(remove()).toBe('staged-undo')
    expect(tripById(trip.id)).toEqual(before)
    expect(baseRef.current).toBe(trip)
    expect(setPending).toHaveBeenLastCalledWith(pendingRef.current)
    actions.removePending()
    expect(pendingRef.current).toBeNull()
    expect(baseRef.current).toBeNull()
    expect(tripById(trip.id)).toEqual(before)
    expect(undoToasts).toEqual([])

    remove()
    actions.applyChange(draft => { draft.name = 'Kept plan' }, 'edit', day.index)
    const displayed = pendingRef.current!
    const displayedStops = displayed.proposed.days.find(candidate => candidate.index === day.index)!.stops
    expect(displayedStops.map(stop => stop.id)).toEqual(day.stops.filter(stop => stop.id !== victim.id).map(stop => stop.id))
    expect(displayedStops.map(stop => stop.orderInDay)).toEqual(displayedStops.map((_, index) => index + 1))
    expect(displayed.result).toEqual(computeImpact(trip, displayed.proposed, 'edit', day.index))
    expect(tripById(trip.id)).toEqual(before)
    actions.keepPending()
    expect(tripById(trip.id)).toEqual({ ...displayed.proposed, updatedAt: expect.any(Number) })
    expect(pendingRef.current).toBeNull()
    expect(baseRef.current).toBeNull()
    expect(undoToasts).toHaveLength(1)
    undoToasts[0].run()
    expect(tripById(trip.id)!.days.find(candidate => candidate.index === day.index)!.stops).toEqual(day.stops)
  })

  it('refuses Keep after a direct write changes the preview base', () => {
    const trip = duplicateTrip(seedData.trips[0], 'wiring-stale-owner')
    const pendingRef: { current: PendingChange | null } = { current: null }
    const baseRef: { current: Trip | null } = { current: null }
    const args = { trip, pendingRef, baseRef, legCorrRef: { current: undefined }, setPending: vi.fn() }
    workspacePreviewActions(args).applyChange(draft => { draft.name = 'Staged name' }, 'edit', 0)
    updateTrip(trip.id, { name: 'Direct write' })
    const current = tripById(trip.id)!
    workspacePreviewActions({ ...args, trip: current }).keepPending()
    expect(tripById(trip.id)).toBe(current)
    expect(pendingRef.current?.proposed.name).toBe('Staged name')
    expect(messages).toEqual([expect.stringContaining('plan changed while you were reviewing')])
    expect(undoToasts).toEqual([])
  })
})
