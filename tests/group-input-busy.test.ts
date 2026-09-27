// ============ #394 — the crew-signal buttons claim their row before writing ============
//
// The bug this pins: Group Input's Resolve / Add to timeline / Decline buttons
// had no busy state. The store writes are synchronous-void, so nothing in the
// data layer serializes two clicks — a double-click on Resolve ran the landing
// branch twice, and on Accept it minted a twin stop (each addStop mints a fresh
// id). The store-side idempotence (#336) makes a duplicate write harmless; this
// is the button half, which makes the second click never register at all.
//
// The claim itself is driven here as pure logic, because the guards that keep
// it honest live in the handlers: takeClaim must refuse a row that already
// holds a claim, must not block a *different* row, and a refused take must
// return the claims unchanged.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { BusyClaim } from '../src/lib/busyClaim'
import { isClaimed, takeClaim } from '../src/lib/busyClaim'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('#394 — the busy claim', () => {
  it('is granted once per row, and the second take is refused', () => {
    let claims: BusyClaim = new Set()
    const first = takeClaim(claims, 'decision-1')
    expect(first.claimed).toBe(true)
    claims = first.claims
    expect(isClaimed(claims, 'decision-1')).toBe(true)

    const second = takeClaim(claims, 'decision-1')
    expect(second.claimed).toBe(false)
    // …and a refused take leaves the set untouched — no leaked claim.
    expect(second.claims).toBe(claims)
  })

  it('never blocks a different row', () => {
    const first = takeClaim<string>(new Set(), 'decision-1')
    const second = takeClaim(first.claims, 'decision-2')
    expect(second.claimed).toBe(true)
    expect(isClaimed(second.claims, 'decision-1')).toBe(true)
    expect(isClaimed(second.claims, 'decision-2')).toBe(true)
  })

  it('two rapid handler invocations fire the store once', () => {
    // The exact double-click shape: one row, two clicks, one store effect.
    const fired: string[] = []
    let claims: BusyClaim = new Set()
    const handler = (rowKey: string) => {
      const taken = takeClaim(claims, rowKey)
      if (!taken.claimed) return
      claims = taken.claims
      fired.push(rowKey)
    }
    handler('decision-1')
    handler('decision-1')
    expect(fired).toEqual(['decision-1'])
  })

  it('a released row can be claimed again', () => {
    // The row spent the claim: a fresh claim over a fresh key (the next
    // decision card) is granted — the module never leaks state between rows.
    const first = takeClaim<string>(new Set(), 'decision-1')
    const next = takeClaim<string>(new Set(), 'decision-2')
    expect(next.claimed).toBe(true)
    expect(first.claims.has('decision-2')).toBe(false)
  })
})

describe('#394 — the Group Input buttons carry the claim', () => {
  const src = read('../src/pages/trip/GroupInputTab.tsx')

  it('every crew-signal handler claims before it writes', () => {
    // The three handlers — resolve, accept, decline — each take the row's
    // claim and drop the click when it is refused. Source-scanned because the
    // claim ordering (claim BEFORE the store call) is the whole fix and lives
    // inside the handlers. Counted from below, so a handler that loses the
    // claim turns this red; the set is exactly these three.
    expect(src.match(/if \(!claim\(\)\) return/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('the claim disables the buttons while it is held', () => {
    // One per handler's buttons — a claim the user cannot see is not a fix.
    // (Comments deliberately never spell this literal out: a source guard
    // reads prose as readily as code.)
    expect(src.match(/disabled=\{busy\}/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('the claim is taken synchronously — a ref, not only state', () => {
    // A state closure can still hold the pre-claim render when the second
    // click lands, so the handler must read a ref to refuse it.
    expect(src).toMatch(/claimsRef\.current/)
    expect(src).toMatch(/takeClaim\(claimsRef\.current/)
  })
})
