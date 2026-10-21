import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ responses: [] as any[], ranges: [] as number[][], orders: [] as string[] }))
vi.mock('../src/lib/supabase', () => ({ supabase: { from: () => {
  const q: any = {}
  q.select = () => q
  q.gte = () => q
  q.lte = () => q
  q.order = (field: string) => { state.orders.push(field); return q }
  q.range = (start: number, end: number) => { state.ranges.push([start, end]); return Promise.resolve(state.responses.shift()) }
  return q
} } }))
import { fetchCreateFunnelEvents } from '../src/lib/createFunnelRead'
beforeEach(() => { state.responses = []; state.ranges = []; state.orders = [] })
describe('complete admin create-log reads', () => {
  it('advances by actual page length when the server cap is smaller than requested', async () => {
    state.responses = [
      { data: [{ event: 'started' }, { event: 'started' }], error: null, count: 3 },
      { data: [{ event: 'submitted' }], error: null, count: 3 },
    ]
    expect(await fetchCreateFunnelEvents()).toHaveLength(3)
    expect(state.ranges).toEqual([[0, 999], [2, 1001]])
    expect(state.orders).toEqual(['at', 'id', 'at', 'id'])
  })
  it('rejects a failed later page instead of returning a partial total', async () => {
    state.responses = [
      { data: [{ event: 'started' }], error: null, count: 2 },
      { data: null, error: new Error('read failed'), count: null },
    ]
    await expect(fetchCreateFunnelEvents()).rejects.toThrow('read failed')
  })
  it('reports a changed or incomplete snapshot as a failed read', async () => {
    state.responses = [{ data: [{ event: 'started' }], error: null, count: 2 }, { data: [], error: null, count: 2 }]
    await expect(fetchCreateFunnelEvents()).rejects.toThrow('incomplete')
    state.responses = [{ data: [{ event: 'started' }], error: null, count: 2 }, { data: [{ event: 'submitted' }], error: null, count: 3 }]
    await expect(fetchCreateFunnelEvents()).rejects.toThrow('changed')
  })
  it('keeps a confirmed empty result distinct from a failed count', async () => {
    state.responses = [{ data: [], error: null, count: 0 }]
    expect(await fetchCreateFunnelEvents()).toEqual([])
    state.responses = [{ data: [], error: null, count: null }]
    await expect(fetchCreateFunnelEvents()).rejects.toThrow()
  })
})
