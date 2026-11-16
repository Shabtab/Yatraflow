// Account-wide Routes quota. reserveSharedQuota asks Supabase for one unit before
// each Google Routes request. The Supabase client is mocked, so these tests run
// without a network. Every failure must send the caller to OSRM, never to Google.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ rpc: vi.fn(), configured: true }))

vi.mock('../src/lib/supabase', () => ({
  get isSupabaseConfigured() {
    return h.configured
  },
  supabase: {
    rpc: (...args: unknown[]) => h.rpc(...args),
  },
}))

import { googleRoute, QuotaExhaustedError } from '../src/lib/providers/routes'
import {
  SOFT_CAPS, quotaCount, quotaResetForTests, quotaUsed, reserveSharedQuota,
} from '../src/lib/providers/quota'

/** Stands in for the PostgREST builder: awaitable, with abortSignal(). */
function answer(result: { data: unknown; error: unknown }) {
  const then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(ok, fail)
  const abortSignal = vi.fn()
  const builder = { abortSignal, then }
  abortSignal.mockReturnValue(builder)
  return builder
}

const A = { lat: 28.6139, lng: 77.209 }
const B = { lat: 27.1767, lng: 78.0081 }
const GOOGLE_OK = {
  ok: true,
  status: 200,
  json: async () => ({ routes: [{ distanceMeters: 1000, duration: '120s', polyline: { encodedPolyline: '' } }] }),
}
const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<unknown>>(async () => GOOGLE_OK)

beforeEach(() => {
  h.rpc.mockReset()
  h.configured = true
  quotaResetForTests()
  fetchMock.mockClear()
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-key')
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('reserveSharedQuota', () => {
  it('grants a unit when the RPC answers true, for the routes SKU', async () => {
    h.rpc.mockReturnValue(answer({ data: true, error: null }))
    await expect(reserveSharedQuota('routes')).resolves.toBe(true)
    expect(h.rpc).toHaveBeenCalledWith('consume_provider_quota', { p_sku: 'routes' })
  })

  it('denies when the RPC answers false, which means the cap is used up', async () => {
    h.rpc.mockReturnValue(answer({ data: false, error: null }))
    await expect(reserveSharedQuota('routes')).resolves.toBe(false)
  })

  it('fails closed on an RPC error', async () => {
    h.rpc.mockReturnValue(answer({ data: null, error: { message: 'boom' } }))
    await expect(reserveSharedQuota('routes')).resolves.toBe(false)
  })

  it('fails closed when the call itself throws', async () => {
    h.rpc.mockImplementation(() => { throw new Error('offline') })
    await expect(reserveSharedQuota('routes')).resolves.toBe(false)
  })

  it('fails closed on an answer that is not the boolean true', async () => {
    h.rpc.mockReturnValue(answer({ data: 'true', error: null }))
    await expect(reserveSharedQuota('routes')).resolves.toBe(false)
    h.rpc.mockReturnValue(answer({ data: null, error: null }))
    await expect(reserveSharedQuota('routes')).resolves.toBe(false)
  })

  it('fails closed without a configured client, and does not call the RPC', async () => {
    h.configured = false
    await expect(reserveSharedQuota('routes')).resolves.toBe(false)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('fails closed on an aborted signal, and does not call the RPC', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(reserveSharedQuota('routes', ac.signal)).resolves.toBe(false)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('passes the caller signal on to the RPC request', async () => {
    const builder = answer({ data: true, error: null })
    h.rpc.mockReturnValue(builder)
    const ac = new AbortController()
    await expect(reserveSharedQuota('routes', ac.signal)).resolves.toBe(true)
    expect(builder.abortSignal).toHaveBeenCalledWith(ac.signal)
  })

  it('leaves SKUs outside the shared set alone: no RPC, and true', async () => {
    await expect(reserveSharedQuota('autocomplete')).resolves.toBe(true)
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

describe('googleRoute and the shared cap', () => {
  it('calls the computeRoutes address on the directions path', async () => {
    h.rpc.mockReturnValue(answer({ data: true, error: null }))
    await googleRoute(A, B, 'car')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://routes.googleapis.com/directions/v2:computeRoutes')
  })

  it('sends travelMode DRIVE in the request body, even for a bus leg', async () => {
    h.rpc.mockReturnValue(answer({ data: true, error: null }))
    await googleRoute(A, B, 'bus')
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { travelMode?: string }
    expect(body.travelMode).toBe('DRIVE')
  })

  it('sends the Google request only after the shared cap grants a unit', async () => {
    h.rpc.mockReturnValue(answer({ data: true, error: null }))
    const r = await googleRoute(A, B, 'car')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ km: 1, min: 2 })
    expect(quotaUsed('routes')).toBe(1)
  })

  it('throws QuotaExhaustedError and sends no Google request when the cap is used up', async () => {
    h.rpc.mockReturnValue(answer({ data: false, error: null }))
    await expect(googleRoute(A, B, 'car')).rejects.toBeInstanceOf(QuotaExhaustedError)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(quotaUsed('routes')).toBe(0)
  })

  it('sends no Google request when the RPC fails', async () => {
    h.rpc.mockReturnValue(answer({ data: null, error: { message: 'boom' } }))
    await expect(googleRoute(A, B, 'car')).rejects.toBeInstanceOf(QuotaExhaustedError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends no Google request without a configured client', async () => {
    h.configured = false
    await expect(googleRoute(A, B, 'car')).rejects.toBeInstanceOf(QuotaExhaustedError)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('keeps the per-browser guard in front of the RPC', async () => {
    for (let i = 0; i < SOFT_CAPS.routes; i++) quotaCount('routes')
    await expect(googleRoute(A, B, 'car')).rejects.toBeInstanceOf(QuotaExhaustedError)
    expect(h.rpc).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
