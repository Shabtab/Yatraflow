// ============ Road retry — the surfaces that say "failed" offer the retry ============
// `TripRoadView.retry` has existed at the source since #188 (TripWorkspace's
// useTripRoad bumps an attempt counter that re-runs the measurement effect),
// but no surface consumed it: the two places that say the road failed — the
// Board's estimate note and the Map tab's travel-day banner — offered no way
// back. These are SOURCE bindings (the wiring has no DOM-free seam): the note
// survives the retry's pending, the latch holds the banner open through a
// re-measure, and the in-flight state is said out loud instead of blinking.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const board = read('../src/components/BoardView.tsx')
const mapTab = read('../src/pages/trip/MapTab.tsx')
const workspace = read('../src/pages/TripWorkspace.tsx')

describe('the source still wires the retry into the measurement (#188)', () => {
  it('useTripRoad keeps attempt in the effect deps and hands retry out on the view', () => {
    expect(workspace).toMatch(/const retry = useCallback\(\(\) => setAttempt\(a => a \+ 1\), \[\]\)/)
    expect(workspace).toMatch(/\}, \[chainSig, chain, attempt\]\)/)
    expect(workspace).toMatch(/status: state\.status, retry \}/)
  })
})

describe('BoardView — the failed note carries its retry', () => {
  it('keeps the honest note up through a retry flight (failed OR pending)', () => {
    // a gate keyed on `failed` alone would blink the note off the moment the
    // retry flipped status to pending — and nothing else on this surface says
    // the figures are estimates
    expect(board).toMatch(/&& \(road\?\.status === 'failed' \|\| road\?\.status === 'pending'\)/)
    expect(board).toMatch(/const roadRetrying = road\?\.status === 'pending'/)
    expect(board).toMatch(/Measuring the road…/)
  })

  it('offers the button only while not already measuring', () => {
    expect(board).toMatch(/roadUnmeasured && !roadRetrying && road && \(/)
    expect(board).toMatch(/onClick=\{road\.retry\}/)
    expect(board).toMatch(/Retry road measurement/)
    // the reason a retry can help is stated, not implied
    expect(board).toMatch(/may have been rate-limited/)
  })
})

describe('MapTab — the travel-day banner carries its retry', () => {
  it('latches the failure through the retry flight, clears on resolve or rebuild', () => {
    expect(mapTab).toMatch(/if \(road\?\.status === 'failed'\) roadFailedEverRef\.current = true/)
    expect(mapTab).toMatch(/if \(road\?\.status === 'ok'\) roadFailedEverRef\.current = false/)
    expect(mapTab).toMatch(/const roadNeedsRetry = routeFailed \|\| !!roadRetryUnderway/)
    // the banner gate accepts the latched failure, not just the live one
    expect(mapTab).toMatch(/\(routeTotalKm != null \|\| roadNeedsRetry\)/)
    expect(mapTab).not.toMatch(/\(routeTotalKm != null \|\| routeFailed\)/)
    // the "rough estimate" sentence keys on the LIVE failure — the latch holds
    // the banner open without claiming a failure that is being re-measured
    expect(mapTab).toMatch(/routeFailed && 'Rough estimate/)
  })

  it('says the in-flight state and offers the button from the banner', () => {
    expect(mapTab).toMatch(/Measuring the road again — the estimates hold until it resolves\./)
    expect(mapTab).toMatch(/onClick=\{road\.retry\}/)
    expect(mapTab).toMatch(/Retry road measurement/)
    // the button hides while the re-measure is in flight
    expect(mapTab).toMatch(/roadNeedsRetry && road && !roadRetryUnderway && \(/)
  })

  it('clears the latch only on a resolve — no effect-based reaper', () => {
    const writes = mapTab.match(/roadFailedEverRef\.current = (?:true|false)/g) ?? []
    expect(writes.length).toBe(2)
    expect(mapTab).not.toMatch(/useEffect\(\(\) => \{ roadFailedEverRef\.current/)
  })
})
