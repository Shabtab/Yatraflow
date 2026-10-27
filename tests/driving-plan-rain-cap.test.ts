// ============ #855 — a storm on day 0 must cap day 0 only ============
//
// The travel clock's day count used to grow against day 0's rain-dampened
// cap, so one storm at the start of a trip shortened every later dry day
// (1400 km / 1500 wheel minutes walked as seven ~195 km days instead of
// five). Day i's forecast caps only day i (#127): the count now grows against
// the LATER days' own budgets — min(their rain cap, the dry rhythm the split
// planned) — so a day-0 storm shortens day 0 alone and dry days keep the
// split's pace.
//
// These tests drive the public planner end to end (deriveDrivingPlan plus the
// corridor's halt targets) so they pin what every consumer reads, not the
// walk's private arithmetic.
import { describe, expect, it } from 'vitest'
import { deriveDrivingPlan, planRideSegments } from '../src/lib/ridePlan'

/** The #855 fixture: 1400 km, 1500 wheel minutes, car, relaxed pace, one
 *  driver, a vulnerable crew (dinner 19:00–20:00), 08:30 start. */
const FIXTURE = {
  totalKm: 1400,
  driveMinutes: 1500,
  transportMode: 'car',
  travelStyle: 'relaxed',
  driverCount: 1,
  hasVulnerable: true,
  dayStart: '08:30',
  anchors: { dinnerStartMin: 19 * 60, dinnerEndMin: 20 * 60 },
} as const

/** The day boundaries the banner counts and the corridor's overnight halt
 *  targets — rounded, one per walked day (targets omit the final day). */
function walked(dayRainPct?: number[]) {
  const facts = dayRainPct ? { ...FIXTURE, dayRainPct } : { ...FIXTURE }
  const plan = deriveDrivingPlan(facts)
  const endKms = plan.outbound.map(d => Math.round(d.endKm))
  const targets = planRideSegments({ ...facts, dayBoundaries: plan.outbound })
    .filter(s => s.dayEnd)
    .map(s => Math.round(s.targetKm!))
  return { plan, endKms, targets }
}

describe('#855 the day-0 rain cap', () => {
  it('a storm on day 0 shortens day 0 only: five days, dry days inside the 350 km rhythm', () => {
    const { plan, endKms, targets } = walked([90, 10, 10, 10, 10, 10])
    expect(plan.verdict).toBe('ok')
    // Five days, not seven: the count grows on the dry days' own budgets.
    expect(plan.dayCount).toBe(5)
    expect(endKms).toEqual([231, 523, 816, 1108, 1400])
    // Day 0 walks the storm's own cap…
    expect(endKms[0]).toBeCloseTo(231, 0)
    // …and every later dry day stays inside the 350 km dry rhythm, near 292.
    for (let i = 1; i < endKms.length; i++) {
      const span = endKms[i] - endKms[i - 1]
      expect(span).toBeLessThanOrEqual(350)
      expect(span).toBeGreaterThanOrEqual(290)
    }
    // The corridor lands its halts on those same boundaries.
    expect(targets).toEqual(endKms.slice(0, -1))
  })

  it('the no-rain relaxed/vulnerable walk does not move', () => {
    const dry = walked()
    expect(dry.plan.dayCount).toBe(4)
    expect(dry.endKms).toEqual([350, 700, 1050, 1400])
    expect(dry.targets).toEqual([350, 700, 1050])
    // Uniform drizzle-grade rain keeps the same walk: 10% damps nothing here.
    const drizzle = walked([10, 10, 10, 10, 10, 10])
    expect(drizzle.endKms).toEqual(dry.endKms)
  })

  it('a storm on day 1 changes day 1 only', () => {
    const { plan, endKms, targets } = walked([10, 90, 10, 10, 10, 10])
    expect(plan.verdict).toBe('ok')
    // Day 0 keeps the no-rain boundary exactly…
    expect(endKms[0]).toBe(350)
    // …day 1 walks its own storm cap (a 231 km span)…
    expect(endKms[1] - endKms[0]).toBeCloseTo(231, 0)
    // …and the dry days after it stay inside the rhythm and reach the end.
    for (let i = 2; i < endKms.length; i++) {
      expect(endKms[i] - endKms[i - 1]).toBeLessThanOrEqual(350)
    }
    expect(endKms.at(-1)).toBe(1400)
    expect(targets).toEqual(endKms.slice(0, -1))
  })
})
