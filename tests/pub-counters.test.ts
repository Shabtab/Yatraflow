// ============ Publication counters and the catalog's read state (#363, #395) =
//
// Two issues from the same family: a number that was counted in the wrong unit
// and could never be taken back, and a surface that claimed a failed read was
// an empty catalog.
//
// The counter half runs for REAL here against a stubbed client, because the
// behaviour under test is the optimistic bump and its rollback — a source
// assertion could not tell a working rollback from a comment describing one.
// The Explore half is pinned at the source: a node suite has no DOM, so the
// rendered three-state branch is checked by the shape of the JSX that owns it.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { supabase } from '../src/lib/supabase'
import type { PublishedItinerary } from '../src/data/types'

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
const codeOf = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(line => !/^\s*(\/\/|--|\*)/.test(line))
  .join('\n')

/** A publication payload that satisfies the writer. */
const pubPayload = (tripId: string, creatorId: string): Omit<PublishedItinerary, 'id' | 'publishedAt' | 'views' | 'copies'> => ({
  tripId, creatorId, title: 'Kerala', tagline: 'x',
  coverImageUrl: 'https://images.example.test/kerala.jpg',
  routeSummary: ['Kochi'], durationDays: 3, estimatedBudgetPerPersonInr: 5000,
  travelStyle: 'balanced', bestSeason: 'winter', travelTips: [],
  warningsAndAssumptions: [], freeDayIndexes: [0],
})

/** A session-scoped storage double, so "one per session" is testable at all.
 *  `removeItem` is included because the fix RELEASES the mark on a failed
 *  write — a double without it would hide that half. */
function fakeSessionStorage(): Map<string, string> {
  const backing = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => { backing.set(k, v) },
    removeItem: (k: string) => { backing.delete(k) },
  })
  return backing
}

/** Stub the client: `from` for the publication upsert/flip, `rpc` for the bump
 *  itself. The bump is the one that decides success or failure here. */
function stubClient(opts: { rpcError?: { message: string } | null; rpcRejects?: boolean } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }))
  const bumps: Array<{ p_id: string; p_kind: string }> = []
  const fromSpy = vi.spyOn(supabase, 'from').mockImplementation(() => ({ upsert, update }) as never)
  const rpcSpy = vi.spyOn(supabase, 'rpc').mockImplementation(((fn: string, args: { p_id: string; p_kind: string }) => {
    bumps.push(args)
    if (opts.rpcRejects) return Promise.reject(new Error('offline'))
    return Promise.resolve({ data: null, error: opts.rpcError ?? null })
  }) as never)
  return { bumps, restore: () => { rpcSpy.mockRestore(); fromSpy.mockRestore() } }
}

/** Let the bump's promise chain settle — the rollback is deliberately async. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

const rowOf = (store: { getSnapshot: () => { published: PublishedItinerary[] } }, id: string) =>
  store.getSnapshot().published.find(x => x.id === id)!

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('#363 — forks are counted once per session, like views', () => {
  it('counts a rapid re-fork ONCE, in the counter and on the wire', async () => {
    // The unlike-unit half of the issue: every fork click was a raw event while
    // visits were session-deduped, so the funnel divided two different kinds of
    // count. Explore's card can fork a plan repeatedly in one visit.
    const { bumps, restore } = stubClient()
    fakeSessionStorage()
    try {
      const store = await import('../src/store/store')
      const p = await store.publishItinerary(pubPayload('t-fork', 'owner-1'))
      ;(store.getSnapshot() as unknown as { sessionUserId: string }).sessionUserId = 'viewer-1'

      store.registerPubCopy(p.id)
      store.registerPubCopy(p.id)
      store.registerPubCopy(p.id)

      expect(rowOf(store, p.id).copies).toBe(p.copies + 1)
      expect(bumps, 'three clicks must be one bump').toHaveLength(1)
      expect(bumps[0]).toEqual({ p_id: p.id, p_kind: 'copies' })
    } finally { restore() }
  })

  it('still counts a view AND a fork in the same session — they are different acts', async () => {
    // The guard is per-ACTION, not per-publication: someone who opens a plan and
    // then takes a copy of it has done two things, and sharing one key would
    // make the second invisible. This is the assertion that pins that choice.
    const { bumps, restore } = stubClient()
    fakeSessionStorage()
    try {
      const store = await import('../src/store/store')
      const p = await store.publishItinerary(pubPayload('t-both', 'owner-1'))
      ;(store.getSnapshot() as unknown as { sessionUserId: string }).sessionUserId = 'viewer-1'

      store.registerPubView(p.id)
      store.registerPubCopy(p.id)

      expect(rowOf(store, p.id).views).toBe(p.views + 1)
      expect(rowOf(store, p.id).copies).toBe(p.copies + 1)
      expect(bumps.map(b => b.p_kind).sort()).toEqual(['copies', 'views'])
    } finally { restore() }
  })

  it('never counts the creator’s own fork', async () => {
    const { bumps, restore } = stubClient()
    fakeSessionStorage()
    try {
      const store = await import('../src/store/store')
      const p = await store.publishItinerary(pubPayload('t-self', 'owner-9'))
      ;(store.getSnapshot() as unknown as { sessionUserId: string }).sessionUserId = 'owner-9'

      store.registerPubCopy(p.id)
      expect(rowOf(store, p.id).copies).toBe(p.copies)
      expect(bumps).toHaveLength(0)
    } finally { restore() }
  })

  it('counts even when session storage is unavailable (private mode)', async () => {
    // Storage being unusable is not a reason to record nothing — the view
    // counter already behaved this way and the fork counter now matches it.
    const { bumps, restore } = stubClient()
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    })
    try {
      const store = await import('../src/store/store')
      const p = await store.publishItinerary(pubPayload('t-private', 'owner-1'))
      ;(store.getSnapshot() as unknown as { sessionUserId: string }).sessionUserId = 'viewer-1'
      store.registerPubCopy(p.id)
      expect(rowOf(store, p.id).copies).toBe(p.copies + 1)
      expect(bumps).toHaveLength(1)
    } finally { restore() }
  })
})

describe('#363 — a bump that fails does not keep its +1', () => {
  it('rolls the counter back when the RPC reports an error', async () => {
    // The permanent-skew half: `views`/`copies` drive Explore's sort
    // (`views + copies * 5`) and its featured pick, so a failed bump used to
    // re-order the catalog for good — and the dated `pub_events` row is written
    // only on server success, so the counter and the log drifted apart.
    const { restore } = stubClient({ rpcError: { message: 'write refused' } })
    const backing = fakeSessionStorage()
    try {
      const store = await import('../src/store/store')
      const p = await store.publishItinerary(pubPayload('t-fail', 'owner-1'))
      ;(store.getSnapshot() as unknown as { sessionUserId: string }).sessionUserId = 'viewer-1'

      store.registerPubView(p.id)
      // The optimistic bump is visible immediately — the UI must feel instant.
      expect(rowOf(store, p.id).views).toBe(p.views + 1)

      await settle()
      expect(rowOf(store, p.id).views, 'a refused bump must not keep its +1').toBe(p.views)
      // …and the session mark is released, or the reader's one chance to be
      // counted was silently spent on a write that never landed.
      expect(backing.has(`yf-viewed-${p.id}`)).toBe(false)
    } finally { restore() }
  })

  it('rolls back on a REJECTED promise too, not only on `{ error }`', async () => {
    // A dropped fetch rejects where supabase-js usually answers `{error}`, which
    // is the case a single-arm handler misses — the same trap the create path
    // documents.
    const { restore } = stubClient({ rpcRejects: true })
    fakeSessionStorage()
    try {
      const store = await import('../src/store/store')
      const p = await store.publishItinerary(pubPayload('t-reject', 'owner-1'))
      ;(store.getSnapshot() as unknown as { sessionUserId: string }).sessionUserId = 'viewer-1'

      store.registerPubCopy(p.id)
      expect(rowOf(store, p.id).copies).toBe(p.copies + 1)
      await settle()
      expect(rowOf(store, p.id).copies).toBe(p.copies)
    } finally { restore() }
  })

  it('lets a LATER attempt count, because the failed one released its mark', async () => {
    // Releasing the claim is what makes the rollback more than cosmetic: if the
    // mark stayed, a reader whose first bump failed could never be counted in
    // that session at all — the fix would trade a phantom for a hole.
    let failNext = true
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }))
    const fromSpy = vi.spyOn(supabase, 'from').mockImplementation(() => ({ upsert, update }) as never)
    const bumps: string[] = []
    const rpcSpy = vi.spyOn(supabase, 'rpc').mockImplementation(((fn: string, args: { p_id: string }) => {
      bumps.push(args.p_id)
      if (failNext) { failNext = false; return Promise.resolve({ data: null, error: { message: 'refused' } }) }
      return Promise.resolve({ data: null, error: null })
    }) as never)
    fakeSessionStorage()
    try {
      const store = await import('../src/store/store')
      const p = await store.publishItinerary(pubPayload('t-retry', 'owner-1'))
      ;(store.getSnapshot() as unknown as { sessionUserId: string }).sessionUserId = 'viewer-1'

      store.registerPubView(p.id)
      await settle()
      expect(rowOf(store, p.id).views).toBe(p.views)
      // Second attempt in the SAME session: the mark was released, so it counts
      // and it sticks.
      store.registerPubView(p.id)
      await settle()
      expect(rowOf(store, p.id).views).toBe(p.views + 1)
      expect(bumps).toHaveLength(2)
    } finally { rpcSpy.mockRestore(); fromSpy.mockRestore() }
  })

  it('never drives a counter negative if two failures race', async () => {
    // `Math.max(0, …)` on the decrement: a snapshot-restore would be wrong here
    // in the other direction (it would discard unrelated movement), and an
    // unguarded decrement could go below zero on a double failure.
    const { restore } = stubClient({ rpcError: { message: 'refused' } })
    fakeSessionStorage()
    try {
      const store = await import('../src/store/store')
      const p = await store.publishItinerary(pubPayload('t-floor', 'owner-1'))
      ;(store.getSnapshot() as unknown as { sessionUserId: string }).sessionUserId = 'viewer-1'
      // Force two bumps past the session guard (different kinds), fail both.
      store.registerPubView(p.id)
      store.registerPubCopy(p.id)
      await settle()
      expect(rowOf(store, p.id).views).toBe(p.views)
      expect(rowOf(store, p.id).copies).toBe(p.copies)
    } finally { restore() }
  })
})

describe('#363 — the rates say which unit they divide', () => {
  const hub = readFileSync(new URL('../src/pages/CreatorHubPage.tsx', import.meta.url), 'utf8')
  const funnel = readFileSync(new URL('../src/lib/pubFunnel.ts', import.meta.url), 'utf8')

  it('names the denominator as visit-sessions, not bare "visits"', () => {
    // Both stages are one-per-session now, so the qualifier is exact. Before
    // #363 the numerator was raw clicks and the denominator session-deduped,
    // which is why "of visits" read as a conversion rate over unlike units.
    expect(hub).toContain('of visit-sessions')
    expect(hub).not.toContain('of visits</span>')
  })

  it('records WHY the two units now match, where the rate is computed', () => {
    // The module is where the next person looks, so the like-unit property is
    // documented at the derivation rather than only in the UI string.
    // Normalized over the comment prefix: the sentence wraps across two source
    // lines, and asserting the raw text would make this a test of the line
    // width rather than of what the file says.
    const prose = funnel.replace(/^\s*\/\/\s?/gm, '').replace(/\s+/g, ' ')
    expect(prose).toContain('one per browser session each')
    expect(funnel).toContain('yf-viewed-<id>')
    expect(funnel).toContain('yf-forked-<id>')
  })

  it('leaves the rate UNCLAMPED — #358 pinned that for a product reason', () => {
    // The counter-instance for this very file: the fix for a wrong unit must
    // never quietly become a clamp, which would hide the card-fork fact.
    expect(funnel).toMatch(/return \(to \/ from\) \* 100/)
  })
})

describe('#395 — the catalog read state owns the whole surface', () => {
  const explore = codeOf(src('../src/pages/Explore.tsx'))

  it('has all three states, with the retry re-issuing the read', () => {
    expect(explore).toContain("const pubsRead = sliceState(sliceReads, 'suggested itineraries')")
    expect(explore).toContain('rereadPublicSlices()')
    expect(explore).toContain("pubsRead !== 'ready'")
    expect(explore).toContain("pubsRead === 'reading'")
    expect(explore).toContain('emptyCopyFor(pubsRead, ')
  })

  it('gates the FEATURED card on the read, not only on a featured plan existing', () => {
    // The residual this fixes: a failed re-read KEEPS the rows it already had,
    // so `featured` can be truthy while the grid below says the catalog could
    // not be loaded — one card contradicting the sentence under it.
    expect(explore).toContain('{pubsRead === \'ready\' && featured && (')
    expect(explore).not.toMatch(/\{featured && \(/)
  })

  it('does not print a match count over a read that has not happened', () => {
    // "0 itineraries match" is a claim about the catalog. It is also the one
    // line a screen-reader user hears with no visual cue to contradict it.
    expect(explore).toContain("'The catalog could not be loaded'")
    expect(explore).toContain("'Loading the catalog'")
    expect(explore).toMatch(/pubsRead === 'ready'\s*\?\s*`\$\{pubs\.length\}/)
  })

  it('keeps the genuine empty copy, both variants', () => {
    // Hiding the friendly copy would fix the lie by replacing it with a worse
    // one: a new catalog and a filtered-to-nothing search are both real empties.
    expect(explore).toContain('Nothing matches those filters')
    expect(explore).toContain('pubs.length === 0')
    expect(explore).toContain('filtersActive')
  })

  it('still does not sync `savedOnly` into the URL', () => {
    // Device-local favourites must not leak into a shared link. Deliberate, and
    // the reason it must stay out of every URL writer.
    expect(explore).not.toContain('saved:')
    expect(explore).not.toMatch(/syncUrl\(\{[^}]*savedOnly/)
  })
})
