// #544 — the Nearby-ideas rail's loading latch must die with the run that owns it.
//
// The corridor scan effect raises `loadingPois` for its async run; its cleanup
// cancels a superseded run (the route's real geometry arriving mid-scan is the
// normal trigger, not an edge case). Before the fix the cleanup cancelled
// WITHOUT releasing the flag, and when the re-run then early-returned on the
// fresh persisted cache the rail read "searching…" forever — disabling Refresh
// and the detour-scope slider until a full reload.
//
// Node env has no DOM, so this pins the wiring as source invariants, the way
// trip-road / route-integrity do. Negative assertions run against a
// comment-stripped copy — a guard must judge code, never prose (§6x).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// #420 slice 11: the scan effect lives in the corridor hook now.
const src = readFileSync(new URL('../src/pages/trip/map/useCorridorCache.ts', import.meta.url), 'utf8')

// The scan effect's own slice: from the call that raises the flag to the
// effect's dependency line.
const runStart = src.indexOf('setLoadingPois(true)')
const effectEnd = src.indexOf('}, [anchors, nearbyOpts', runStart)
const scanEffect = src.slice(runStart, effectEnd)
const scanCode = scanEffect.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('#544 — the corridor scan releases its loading latch', () => {
  it('this slice really is the corridor scan effect', () => {
    expect(runStart).toBeGreaterThan(-1)
    expect(effectEnd).toBeGreaterThan(runStart)
    expect(scanEffect).toContain('planJourneyHalts(')
  })

  it('the happy path still clears the flag', () => {
    expect(scanCode).toContain('.finally(() => { if (!cancelled) setLoadingPois(false) })')
  })

  it('a cancelled run clears it too — the cleanup releases what the run set', () => {
    // Without this, a re-run that early-returns on the fresh suggestion cache
    // inherits a phantom in-flight flag, and the rail's controls stay disabled.
    const cleanup = scanCode.slice(scanCode.indexOf('return () =>'))
    expect(cleanup).toContain('cancelled = true')
    expect(cleanup).toContain('controller.abort()')
    expect(cleanup).toContain('setLoadingPois(false)')
  })

  it('the flag has exactly one writer — the scan effect alone', () => {
    // A second component path writing this flag is how the latch re-enters.
    // (The useState destructure does not call the setter, so the call sites
    // are: raise, the finally clear, the cleanup release.)
    const calls = src.match(/setLoadingPois\(/g) ?? []
    expect(calls.length).toBe(3)
  })
})
