import { beforeEach, describe, expect, it, vi } from 'vitest'
import { seedData } from '../src/data/seed'
import type { PublishedItinerary } from '../src/data/types'
const mocks = vi.hoisted(() => ({
  duplicate: vi.fn(), publicDuplicate: vi.fn(), register: vi.fn(), fetch: vi.fn(), cache: vi.fn(), toast: vi.fn(),
}))
vi.mock('../src/store/store', () => ({
  duplicateTripPersisted: mocks.duplicate, duplicateTripPublicPersisted: mocks.publicDuplicate,
  registerPubCopy: mocks.register, fetchPublicTrip: mocks.fetch, tripById: mocks.cache,
}))
vi.mock('../src/lib/unlock', () => ({ fetchMyEntitlements: async () => [] }))
vi.mock('../src/components/ui', () => ({ toast: mocks.toast }))
import { forkPublication } from '../src/lib/forkPub'
import { finishPendingFork, takeForkAttribution } from '../src/lib/growthAttribution'

const source = structuredClone(seedData.trips[0])
const pub = { id: 'pub_growth', title: 'Public fixture', tripId: source.id, creatorId: 'creator', freeDayIndexes: source.days.map(day => day.index) } as PublishedItinerary
beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetch.mockResolvedValue(source)
  mocks.cache.mockReturnValue(undefined)
  mocks.publicDuplicate.mockResolvedValue({ trip: source, persisted: true })
  mocks.duplicate.mockResolvedValue({ trip: source, persisted: true })
  finishPendingFork('growth-owner', pub.id)
})

describe('persisted fork activation', () => {
  it('shares one operation across concurrent clicks and records only after success', async () => {
    let resolve!: (value: unknown) => void
    mocks.publicDuplicate.mockImplementation(() => new Promise(done => { resolve = done }))
    const navigate = vi.fn()
    const first = forkPublication(pub, 'growth-owner', navigate, false, 'wa', 'p_a7c1d9e4b206')
    const second = forkPublication(pub, 'growth-owner', navigate, false, 'wa', 'p_a7c1d9e4b206')
    await vi.waitFor(() => expect(mocks.publicDuplicate).toHaveBeenCalledTimes(1))
    expect(mocks.register).not.toHaveBeenCalled()
    resolve({ trip: source, persisted: true })
    expect(await Promise.all([first, second])).toEqual([true, true])
    expect(mocks.register).toHaveBeenCalledExactlyOnceWith(pub.id, 'wa', 'p_a7c1d9e4b206')
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/trips')
  })

  it('keeps the same trip ID for a failed action retry', async () => {
    mocks.publicDuplicate.mockResolvedValueOnce({ trip: source, persisted: false })
    const navigate = vi.fn()
    expect(await forkPublication(pub, 'growth-owner', navigate, false, 'creator')).toBe(false)
    expect(mocks.register).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(await forkPublication(pub, 'growth-owner', navigate, false, 'creator')).toBe(true)
    const firstOrigin = mocks.publicDuplicate.mock.calls[0][4]
    const retryOrigin = mocks.publicDuplicate.mock.calls[1][4]
    expect(retryOrigin.requestId).toBe(firstOrigin.requestId)
    expect(retryOrigin.publicationId).toBe(pub.id)
    expect(mocks.register).toHaveBeenCalledTimes(1)
  })

  it('does not count failed reads and does not let analytics undo a saved trip', async () => {
    mocks.fetch.mockResolvedValueOnce(null)
    const navigate = vi.fn()
    expect(await forkPublication(pub, 'growth-owner', navigate)).toBe(false)
    expect(mocks.register).not.toHaveBeenCalled()
    mocks.register.mockImplementationOnce(() => { throw new Error('analytics failure') })
    expect(await forkPublication(pub, 'growth-owner', navigate)).toBe(true)
    expect(navigate).toHaveBeenCalledWith('/trips')
  })

  it('returns to the selected publication after sign-in and keeps only public context', async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    })
    try {
      const navigate = vi.fn()
      expect(await forkPublication(pub, null, navigate, false, 'wa', 'p_a7c1d9e4b206')).toBe(false)
      expect(navigate).toHaveBeenCalledWith('/auth?next=%2Fpub%2Fpub_growth')
      expect(takeForkAttribution(pub.id)).toEqual({ source: 'wa', campaign: 'p_a7c1d9e4b206' })
      expect(mocks.publicDuplicate).not.toHaveBeenCalled()
      expect(mocks.register).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })
})
