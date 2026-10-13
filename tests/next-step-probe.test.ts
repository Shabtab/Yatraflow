// #652 — the probe's own guarantees: it must read the WHOLE collection, page
// by page (its header promises every publication), and it must report the
// access state it RECEIVED from the returned shape, not infer it from the
// price. Both helpers are pure, so they live here as unit tests rather than
// behind credentials.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCKED_STOP_MARKER, PAGE_SIZE, readAccessState, readAllPages, SURFACES } from '../scripts/next-step-probe.mjs'

const page = (n: number, prefix = 'r') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }))

describe('readAllPages — the probe reads the whole collection (#652)', () => {
  it('asks for one page and stops when the page comes back short', async () => {
    const calls: Array<[number, number]> = []
    const rows = await readAllPages(async (limit: number, offset: number) => {
      calls.push([limit, offset])
      return [{ id: 'only' }]
    })
    expect(rows).toEqual([{ id: 'only' }])
    expect(calls).toEqual([[PAGE_SIZE, 0]])
  })

  it('keeps asking with a rising offset until the last row', async () => {
    const pages = [page(500, 'a'), page(500, 'b'), page(3, 'c')]
    const offsets: number[] = []
    const rows = await readAllPages(async (_limit: number, offset: number) => {
      offsets.push(offset)
      return pages[offsets.length - 1] ?? []
    })
    expect(offsets).toEqual([0, 500, 1000])
    expect(rows).toHaveLength(1003)
    expect(rows[0].id).toBe('a0')
    expect(rows[1002].id).toBe('c2')
  })

  it('returns nothing for an empty collection', async () => {
    const rows = await readAllPages(async () => [])
    expect(rows).toEqual([])
  })

  it('aborts instead of looping when the server ignores the offset', async () => {
    const repeat = () => [page(500, 'x')[0]]
    const rest = page(500, 'x')
    await expect(readAllPages(async (_limit: number, offset: number) => (offset === 0 ? rest : repeat())))
      .rejects.toThrow(/ignored offset/)
  })

  it('rejects a page that is not an array', async () => {
    await expect(readAllPages(async () => ({ error: 'nope' }))).rejects.toThrow(/not an array/)
  })
})

// The shape get_public_trip returns for an ANON viewer (the probe's only
// mode): locked stops carry LOCKED_STOP_MARKER, and the priced branch always
// strips both money fields (#352).
const pub = (price: number | null) => ({ premium_price_inr: price })
const realStop = { description: 'Fort Kochi walk', notes: 'start here' }
const lockedStop = { description: LOCKED_STOP_MARKER, notes: '' }
const trip = (stopsPerDay: unknown[][], extra: Record<string, unknown> = {}) => ({
  days: stopsPerDay.map((stops, i) => ({ index: i, stops })),
  expenses: [],
  fixed_commitments: [],
  ...extra,
})

describe('readAccessState — the access state comes from the shape (#652)', () => {
  it('reports no-row when the RPC returned nothing', () => {
    expect(readAccessState(pub(199), null)).toBe('no-row')
  })

  it('reports whole when no stop carries the stub marker', () => {
    expect(readAccessState(pub(null), trip([[realStop]]))).toBe('whole')
    expect(readAccessState(pub(null), trip([[]]))).toBe('whole')
  })

  it('reports locked when every stop carries the marker', () => {
    expect(readAccessState(pub(199), trip([[lockedStop], [lockedStop, lockedStop]]))).toBe('locked')
  })

  it('reports partly-locked for a free day beside a stubbed day', () => {
    expect(readAccessState(pub(199), trip([[realStop], [lockedStop]]))).toBe('partly-locked')
  })

  it('uses the money strip only when the price is set and no stop proves it', () => {
    // Priced, no stops to stamp, both money fields stripped → locked preview.
    expect(readAccessState(pub(199), { days: [], expenses: [], fixed_commitments: [] })).toBe('locked')
    // Unpriced: empty money is just an empty trip, not a paywall.
    expect(readAccessState(pub(null), { days: [], expenses: [], fixed_commitments: [] })).toBe('whole')
    // Priced, but money still present → nothing in this shape says locked.
    expect(readAccessState(pub(199), {
      days: [],
      expenses: [{ amount: 500 }],
      fixed_commitments: [],
    })).toBe('whole')
  })

  it('tolerates a corrupt days column (fails closed, never throws)', () => {
    expect(readAccessState(pub(199), { days: null, expenses: [], fixed_commitments: [] })).toBe('locked')
    expect(readAccessState(pub(null), { days: 'not-an-array', expenses: [], fixed_commitments: [] })).toBe('whole')
  })
})

describe('both output formats name the collection and the surfaces (#652)', () => {
  const src = readFileSync(new URL('../scripts/next-step-probe.mjs', import.meta.url), 'utf8')

  it('the JSON output names the collection and carries the access state', () => {
    expect(src).toContain("collection: 'published_itineraries'")
    expect(src).toContain('access: r.access')
  })

  it('the table output names the collection and prints the surfaces', () => {
    expect(src).toContain('published_itineraries: ${rows.length} publications')
    expect(src).toContain('SURFACES.covered.join')
    expect(src).toContain('SURFACES.notCovered.join')
  })

  it('surfaces list what the probe checks and what it does not', () => {
    expect(SURFACES.covered.join(' ')).toContain('published_itineraries')
    expect(SURFACES.notCovered.join(' ')).toContain('My Trips')
  })
})
