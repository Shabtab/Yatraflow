// Horizon 3 deferred: fuel-corridor advisory.
// A fuel segment about to cross a long gap to the next scheduled refuel (or
// the journey end) warns "fill the tank". Pure and geometry-free.
import { describe, it, expect } from 'vitest'
import { fuelGapWarnings } from '../src/lib/ridePlan'

function fuelSeg(i: number, targetKm: number): any {
  return { index: i, purpose: 'fuel', targetKm, roadWarning: null as string | null, hint: '' }
}
function mealSeg(i: number, targetKm: number): any {
  return { index: i, purpose: 'meal', targetKm, roadWarning: null as string | null, hint: '' }
}

describe('fuel-corridor advisory', () => {
  it('warns a fuel stop before a long no-fuel stretch', () => {
    // One fuel at 100 km, journey ends at 900 km with nothing in between:
    // a 800 km gap far beyond a 200 km stride → warns.
    const segs = [fuelSeg(0, 100)]
    fuelGapWarnings(segs, /*fuelStride*/ 200, /*cap*/ 900)
    expect(segs[0].roadWarning).toContain('No scheduled fuel')
    expect(segs[0].roadWarning).toContain('800')
  })

  it('stays quiet when the next fuel is within stride', () => {
    // Fuel at 100 and 350 with a 200 km stride → 250 km gap is under 1.4×200.
    const segs = [fuelSeg(0, 100), fuelSeg(1, 350)]
    fuelGapWarnings(segs, 200, 900)
    expect(segs[0].roadWarning).toBeNull()
  })

  it('ignores non-fuel segments entirely', () => {
    const segs = [mealSeg(0, 100)]
    fuelGapWarnings(segs, 200, 900)
    expect(segs[0].roadWarning).toBeNull()
  })
})