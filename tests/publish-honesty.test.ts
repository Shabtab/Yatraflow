// ============ #388 — the publish button stops lying ============
// Three failures in one gesture, all of which read as "it worked":
//
//   1. `publishItinerary` was called WITHOUT `await`, so `onDone` — and with it
//      the "Published to Explore" toast — fired while the write was still in
//      flight. A later failure rolled the cache back underneath a success
//      message, so the user's trust was the thing that broke.
//   2. There was no busy state, so a double-click fired two publishes. The
//      duplicate was only collapsed by accidental id-reuse in the store, which
//      is a side effect and not a guard.
//   3. The ≥1-free-day rule lived ONLY in the toggle handler, so a `free` set
//      that arrived empty (a publication hydrated with `freeDayIndexes: []`)
//      never met it: `0 >= trip.days.length` is false, the day buttons render
//      `disabled` because every day reads as free, and the plan published
//      priced with zero free days.
//
// `tests/` is node-env with no DOM, so the render half is pinned by source
// guards. `codeOf` strips comments first: every file in this repo explains
// itself at length, and a guard must not be satisfiable by a sentence that
// merely NAMES the thing it is checking for.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** Code only — comments removed, so prose cannot satisfy an assertion. */
const codeOf = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(line => !/^\s*(\/\/|--|\*)/.test(line))
  .join('\n')

const shareTab = codeOf(src('../src/pages/trip/ShareTab.tsx'))

/** One function's own text: from its signature to the next top-level one. */
function fnBody(source: string, signature: string): string {
  const start = source.indexOf(signature)
  expect(start, `${signature} not found`).toBeGreaterThan(-1)
  const next = source.indexOf('\nfunction ', start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

describe('#388 — a publish is awaited, so the toast is a statement about an outcome', () => {
  it('awaits the store write instead of firing and forgetting', () => {
    const submit = fnBody(shareTab, 'async function submit()')
    expect(submit).toContain('await publishItinerary(')
  })

  it('reports success only after the write resolves, never before it', () => {
    const submit = fnBody(shareTab, 'async function submit()')
    // The ordering IS the fix: the success callback has to come after the
    // await, or the toast is a statement about a call rather than a result.
    const awaited = submit.indexOf('await publishItinerary(')
    const reported = submit.indexOf('onDone(')
    expect(awaited).toBeGreaterThan(-1)
    expect(reported).toBeGreaterThan(awaited)
  })

  it('surfaces a failure as a failure, and never as a success', () => {
    const submit = fnBody(shareTab, 'async function submit()')
    expect(submit).toContain('catch')
    // onDone must be reachable ONLY from the success path — inside the try,
    // after the await — so a rejected write cannot report a publication.
    const tryIdx = submit.indexOf('try {')
    const onDoneIdx = submit.indexOf('onDone(')
    expect(tryIdx).toBeGreaterThan(-1)
    expect(onDoneIdx).toBeGreaterThan(tryIdx)
  })
})

describe('#388 — a second click cannot become a second publish', () => {
  it('guards the handler on the busy state, not only the button', () => {
    // A disabled button is a UI affordance; the state check is the guard. Both
    // are needed: the state check is what makes a queued click a no-op.
    const submit = fnBody(shareTab, 'async function submit()')
    expect(submit).toMatch(/if \(busy\) return/)
  })

  it('disables the button while the write is in flight', () => {
    expect(shareTab).toMatch(/disabled=\{!isOwner \|\| busy\}/)
  })

  it('says what the button is doing while it is busy', () => {
    // The guard should match the visual feedback state (AGENTS §2.6a) — a
    // disabled button with an unchanged label is a silent freeze.
    expect(shareTab).toContain('Publishing…')
  })

  it('always releases the busy state, so a failed publish cannot lock the form', () => {
    const submit = fnBody(shareTab, 'async function submit()')
    expect(submit).toMatch(/finally \{[\s\S]*setBusy\(false\)/)
  })
})

describe('#388 — every invariant the writer depends on is re-asserted at submit', () => {
  it('re-checks the free-day rule instead of trusting the toggle guard', () => {
    // The exact hole: an empty `free` set never reaches `toggleDay`, and
    // `0 >= trip.days.length` is false, so nothing else caught it.
    const submit = fnBody(shareTab, 'async function submit()')
    expect(submit).toMatch(/free\.size < 1/)
    expect(submit).toContain('At least one day must stay free')
  })

  it('does not let an entirely-free plan be blocked by the free-day rule', () => {
    // `entirelyFree` publishes every day as free, which satisfies the rule by
    // construction — asserting it unconditionally would refuse a free plan.
    const submit = fnBody(shareTab, 'async function submit()')
    expect(submit).toMatch(/!entirelyFree && free\.size < 1/)
  })

  it('still writes the publication BEFORE onDone can report it', () => {
    // Ordering guard on the payload itself: the trimmed cover is what the
    // handler's `^https://\S+$` test will re-check, so storing the raw padded
    // field would ship a link that previews as the brand card.
    const submit = fnBody(shareTab, 'async function submit()')
    expect(submit).toMatch(/coverImageUrl: cover,/)
    expect(submit).not.toMatch(/coverImageUrl: trip\.coverImageUrl,/)
  })
})

describe('#388 — a stale error never sits beside a field the user just fixed', () => {
  it('clears the error on every field edit, not only on price', () => {
    // Price already did this; the tagline, season, tips and CTA did not, so a
    // message about a field the creator had already corrected kept standing.
    const setters = ['setTagline(', 'setBestSeason(', 'setTips(', 'setCta(', 'setPrice(']
    for (const setter of setters) {
      const idx = shareTab.indexOf(setter)
      expect(idx, `${setter} not found`).toBeGreaterThan(-1)
      const line = shareTab.slice(idx, shareTab.indexOf('\n', idx))
      expect(line, `${setter} does not clear the error`).toContain('setErr(null)')
    }
  })
})
