// ============ #364 — "nothing here" must never be printed over a failed read ============
// The conflation, in one sentence: a page that reads from the store's hydrate
// sees an empty array both when there is genuinely nothing and when the request
// failed, and the friendly empty copy is a lie in the second case. This has
// already cost one incident on the earnings ledger (fixed in c460159) and the
// same shape was about to reach two more surfaces.
//
// The rule the resolver encodes: a settled read is not a successful read, so
// only an explicit success may reach 'ready'. Everything else is 'reading' or
// 'failed', and 'failed' is the only state that offers a way back.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { readState, sliceState, emptyCopyFor, figureOrUnavailable } from '../src/lib/readState'
import { sliceReadReport, READ_SLICES } from '../src/store/store'

describe('#364 — a read has three states, and only a success may say "empty"', () => {
  it('reports a failure as failed, whatever else is true', () => {
    expect(readState({ settled: true, failed: true })).toBe('failed')
    // Even alongside a "success" — the failure is the more specific claim.
    expect(readState({ settled: true, failed: true, read: true })).toBe('failed')
  })

  it('reports a successful EMPTY read as ready, not as reading', () => {
    // The case a genuine new creator is in. Hiding it would fix the lie by
    // replacing it with a worse one.
    expect(readState({ settled: true, read: true })).toBe('ready')
  })

  it('never reaches ready without an explicit success', () => {
    // The whole trap: `settled` means the hydrate finished, not that it worked.
    expect(readState({ settled: true })).toBe('reading')
    expect(readState({ settled: false })).toBe('reading')
    expect(readState({ settled: false, failed: false, read: false })).toBe('reading')
  })

  it('treats an absent verdict as unread rather than as empty', () => {
    // Before the first hydrate settles there is no record at all, and an
    // unreported read is an unread one.
    expect(sliceState(undefined, 'profiles')).toBe('reading')
    expect(sliceState({}, 'profiles')).toBe('reading')
  })

  it('reads the store\'s own per-slice record', () => {
    const reads = { profiles: 'ok' as const, 'suggested itineraries': 'failed' as const }
    expect(sliceState(reads, 'profiles')).toBe('ready')
    expect(sliceState(reads, 'suggested itineraries')).toBe('failed')
  })
})

describe('#364 — the hydrate publishes what it actually managed to read', () => {
  it('marks a named slice failed and the rest ok', () => {
    // `partial` is the hydrate's own failure list; this must not invent a second
    // opinion about which reads succeeded.
    const report = sliceReadReport(['suggested itineraries'])
    expect(report['suggested itineraries']).toBe('failed')
    expect(report['profiles']).toBe('ok')
  })

  it('uses the exact names the hydrate pushes, not invented ones', () => {
    // The published slice is pushed as 'suggested itineraries'. A mapping that
    // renamed it to 'published' would report a real failure as a success — the
    // one mistake this change exists to prevent.
    const source = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8')
    for (const slice of READ_SLICES) {
      expect(source, `the hydrate never pushes '${slice}'`).toContain(`partial.push('${slice}')`)
    }
  })

  it('reports every slice ok when nothing failed', () => {
    const report = sliceReadReport([])
    for (const slice of READ_SLICES) expect(report[slice]).toBe('ok')
  })
})

describe('#364 — the copy a state is allowed to print', () => {
  const retry = () => {}

  it('offers a way back only from the failed state', () => {
    // A retry on a successful-but-empty screen would be offering to fix nothing.
    expect(emptyCopyFor('failed', 'catalog', retry).retry).toBe(retry)
    expect(emptyCopyFor('reading', 'catalog', retry).retry).toBeUndefined()
    expect(emptyCopyFor('ready', 'catalog', retry).retry).toBeUndefined()
  })

  it('never tells a reader a failed read was empty', () => {
    const failed = emptyCopyFor('failed', 'catalog', retry)
    expect(failed.title).toMatch(/Couldn’t load/)
    // The sentence that does the real work: it separates the two truths.
    expect(failed.body).toMatch(/not the same as/)
    expect(failed.body).not.toMatch(/just getting started/i)
  })

  it('keeps the friendly empty copy for a genuine empty', () => {
    const ready = emptyCopyFor('ready', 'catalog', retry)
    expect(ready.title).toMatch(/^No catalog yet$/)
  })

  it('shows no figure it could not read, rather than a zero', () => {
    // Creator stats used to hide at zero, which made a failed funnel read
    // indistinguishable from a brand-new creator.
    expect(figureOrUnavailable(0, 'ready')).toBe(0)
    expect(figureOrUnavailable(12, 'failed')).toBeNull()
    expect(figureOrUnavailable(12, 'reading')).toBeNull()
    expect(figureOrUnavailable(null, 'ready')).toBeNull()
    expect(figureOrUnavailable(Number.NaN, 'ready')).toBeNull()
  })
})

// The pages themselves are node-env untestable, so their render ORDER is pinned
// by source. The bug was an ordering bug: the empty branch was reachable while
// the failure branch was not.
describe('#364 — the pages check the failure before the empty copy', () => {
  const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

  it('CreatorPage never reaches "Creator not found" on an unread slice', () => {
    const page = src('../src/pages/CreatorPage.tsx')
    const guard = page.indexOf("if (profileRead !== 'ready')")
    const notFound = page.indexOf('title="Creator not found"')
    expect(guard).toBeGreaterThan(-1)
    expect(notFound).toBeGreaterThan(-1)
    expect(guard, 'the not-found copy precedes the read-state guard').toBeLessThan(notFound)
  })

  it('Explore never reaches the catalog copy on an unread slice', () => {
    const page = src('../src/pages/Explore.tsx')
    const guard = page.indexOf("pubsRead !== 'ready'")
    const friendly = page.indexOf('just getting started')
    expect(guard).toBeGreaterThan(-1)
    expect(friendly).toBeGreaterThan(-1)
    expect(guard, 'the read-state guard precedes the friendly empty copy').toBeLessThan(friendly)
  })

  it('both pages retry by re-issuing the read, not by re-rendering', () => {
    for (const rel of ['../src/pages/CreatorPage.tsx', '../src/pages/Explore.tsx']) {
      expect(src(rel)).toContain('rereadPublicSlices()')
    }
    // And the re-read replaces rows only on success, so a failed retry cannot
    // turn "still broken" into "now empty as well".
    const store = src('../src/store/store.ts')
    expect(store).toMatch(/if \(!profRes\.error\) patch\(\{ users:/)
    expect(store).toMatch(/if \(!pubRes\.error\) patch\(\{ published:/)
  })
})
