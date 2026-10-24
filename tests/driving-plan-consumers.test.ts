// ============ #846 Stage D — consumer wiring regression suite (lane 3) ============
//
// Stage D's contract: ONE immutable driving plan, derived once from the full
// facts, feeds every surface — the banner's travel-day count, the corridor's
// halt targets, the readiness/attribution projections and the preview
// lifecycle. These tests drive the real consumer pipeline the way the Map tab
// wires it (`MapTab.tsx` derives the plan; `useCorridorCache`/`planJourneyHalts`
// hand `plan.outbound` to `planRideSegments`; attribution and the slots read
// `effectiveDrivingDays`), so a consumer that re-splits, re-derives or
// diverges from the shared boundaries fails here.
//
// The preview lifecycle case runs against the REAL store, the real preview
// chain and the real undo, following tests/mutation-lifecycle-store.test.ts.
//
// Lanes 1 (ridePlan clock) and 2 (daySlots readiness) own the boundary and
// attribution defects this checkout still carries. A failure below that
// traces to those files is THEIR deliverable, not a weakened assertion here.
import { describe, expect, it, vi } from 'vitest'
import {
  assignSegmentHits, deriveDrivingPlan, effectiveDrivingDays, isSelfDrivenMode,
  planRideSegments, type DrivingPlan,
} from '../src/lib/ridePlan'
import { tripDayAttribution } from '../src/lib/daySlots'
import { plannerDrives } from '../src/lib/transportPolicy'
import type { ApplyChange } from '../src/lib/mutationLifecycle'
import type { Trip } from '../src/data/types'

/** The relaxed/vulnerable fixture Stage D names: 1400 km, 1500 wheel minutes,
 *  one driver, a vulnerable crew member (dinner 19:00–20:00), 08:30 start. */
const RELAXED_VULNERABLE = {
  totalKm: 1400,
  driveMinutes: 1500,
  transportMode: 'car',
  travelStyle: 'relaxed',
  driverCount: 1,
  hasVulnerable: true,
  dayStart: '08:30',
  anchors: { dinnerStartMin: 19 * 60, dinnerEndMin: 20 * 60 },
} as const

/** The corridor call `planJourneyHalts` makes with the shared plan: the pure
 *  segment planner over the plan's OWN outbound projection — never a second
 *  split, never a partial fact set. */
function corridor(facts: Record<string, unknown>, plan: DrivingPlan, extra: Record<string, unknown> = {}) {
  return planRideSegments({
    ...facts, ...extra, dayBoundaries: plan.outbound,
  } as Parameters<typeof planRideSegments>[0])
}

const overnightTargets = (segments: ReturnType<typeof planRideSegments>) =>
  segments.filter(s => s.dayEnd).map(s => s.targetKm)

describe('case 1 — the relaxed/vulnerable fixture carries one set of four-day boundaries', () => {
  it('the banner input and the halt targets are the same four boundaries', () => {
    const plan = deriveDrivingPlan(RELAXED_VULNERABLE)
    // The banner's travel-day need and its split verdict agree…
    expect(plan.verdict).toBe('ok')
    expect(plan.dayCount).toBe(4)
    expect(plan.split?.driveDayCount).toBe(4)
    // …and the banner input's boundaries are the four-day walk.
    expect(plan.outbound.map(d => Math.round(d.endKm))).toEqual([350, 700, 1050, 1400])
    expect(plan.outbound.every(d => d.startMin === 8 * 60 + 30)).toBe(true)
    // The corridor's overnight halt targets ARE those boundaries — no second
    // split, no drift between what the banner counts and where halts land.
    const targets = overnightTargets(corridor(RELAXED_VULNERABLE, plan))
    expect(targets.map(t => Math.round(t!))).toEqual([350, 700, 1050])
  })
})

describe('case 2 — every transport mode keeps its own policy behaviour', () => {
  it('the wheel gate classifies car, motorcycle, public transport and Mixed', () => {
    expect(isSelfDrivenMode('car')).toBe(true)
    expect(isSelfDrivenMode('motorcycle')).toBe(true)
    expect(isSelfDrivenMode('train')).toBe(false)
    expect(isSelfDrivenMode('mixed', true)).toBe(true)
    expect(isSelfDrivenMode('mixed', false)).toBe(false)
    // The same gate the corridor's fuel cadence reads.
    expect(plannerDrives({ transportMode: 'car' })).toBe(true)
    expect(plannerDrives({ transportMode: 'train' })).toBe(false)
    expect(plannerDrives({ transportMode: 'mixed', drivesPart: false })).toBe(false)
  })

  it('a motorcycle caps lower than a car, and its halts follow its own plan', () => {
    const car = deriveDrivingPlan(RELAXED_VULNERABLE)
    const moto = deriveDrivingPlan({ ...RELAXED_VULNERABLE, transportMode: 'motorcycle' })
    expect(moto.verdict).toBe('ok')
    expect(moto.dayCount).toBeGreaterThan(car.dayCount)
    expect(overnightTargets(corridor({ ...RELAXED_VULNERABLE, transportMode: 'motorcycle' }, moto))
      .map(t => Math.round(t!))).toEqual(moto.outbound.slice(0, -1).map(d => Math.round(d.endKm)))
  })

  it('public transport plans no driving days: no split, no boundaries, no halts', () => {
    const train = deriveDrivingPlan({ ...RELAXED_VULNERABLE, transportMode: 'train' })
    // The banner's single quiet gate: the split verdict is null.
    expect(train.split).toBeNull()
    expect(train.outbound).toEqual([])
    expect(train.dayCount).toBe(0)
    const segments = corridor({ ...RELAXED_VULNERABLE, transportMode: 'train' }, train)
    expect(segments.every(s => !s.dayEnd)).toBe(true)
  })

  it('Mixed drives like a car when the traveller drives, and rides when not', () => {
    const mixedYes = deriveDrivingPlan({ ...RELAXED_VULNERABLE, transportMode: 'mixed', drivesPart: true })
    expect(mixedYes.dayCount).toBe(4)
    expect(mixedYes.outbound.map(d => Math.round(d.endKm))).toEqual([350, 700, 1050, 1400])
    const mixedNo = deriveDrivingPlan({ ...RELAXED_VULNERABLE, transportMode: 'mixed', drivesPart: false })
    expect(mixedNo.split).toBeNull()
    expect(mixedNo.outbound).toEqual([])
  })
})

describe('case 3 — driver count, rain and vulnerable crew move banner and halts together', () => {
  const variants: Array<[string, Record<string, unknown>]> = [
    ['a second driver lengthens the honest cap', { driverCount: 2 }],
    ['no vulnerable crew member lengthens the day', { hasVulnerable: false }],
    ['a storm on day one shortens every walked day', { dayRainPct: [90, 10, 10, 10] }],
  ]

  it('each variant changes the banner count from the 4-day baseline', () => {
    const baseline = deriveDrivingPlan(RELAXED_VULNERABLE)
    expect(baseline.dayCount).toBe(4)
    for (const [label, variant] of variants) {
      const plan = deriveDrivingPlan({ ...RELAXED_VULNERABLE, ...variant })
      expect(plan.dayCount, label).not.toBe(baseline.dayCount)
    }
  })

  it('every variant keeps the halt targets on the same derivation\'s boundaries', () => {
    for (const [, variant] of variants) {
      const facts = { ...RELAXED_VULNERABLE, ...variant }
      const plan = deriveDrivingPlan(facts)
      const targets = overnightTargets(corridor(facts, plan))
      // The Stage D invariant itself: the facts move the walk, but the
      // corridor lands its halts on the boundaries THIS plan walked.
      expect(plan.verdict).toBe('ok')
      expect(targets).toHaveLength(plan.dayCount - 1)
      expect(targets.map(t => Math.round(t!))).toEqual(plan.outbound.slice(0, -1).map(d => Math.round(d.endKm)))
    }
  })
})

describe('case 4 — pins, saved departures and route endpoints survive recalculation', () => {
  it('an accepted pin moves the halt and the readiness span, and the proposal stays visible', () => {
    const plan = deriveDrivingPlan(RELAXED_VULNERABLE)
    const pinned = corridor(RELAXED_VULNERABLE, plan, { haltPins: { 0: 390 } })
    const overnight = pinned.filter(s => s.dayEnd)
    // The halt snaps to the pin; the walked target survives as the drift
    // proposal, never a silent move.
    expect(overnight[0].targetKm).toBe(390)
    expect(overnight[0].haltDriftToKm).toBeCloseTo(350, 3)
    // The EFFECTIVE projection readiness reads: contiguous spans, the pinned
    // first boundary, and the route endpoint intact at 1400 km.
    const effective = effectiveDrivingDays(plan, assignSegmentHits([], pinned, []))
    expect(effective[0].endKm).toBe(390)
    expect(effective[0].proposedEndKm).toBeCloseTo(350, 3)
    for (let i = 1; i < effective.length; i++) {
      expect(effective[i].startKm).toBe(effective[i - 1].endKm)
    }
    expect(effective.at(-1)!.endKm).toBe(1400)
    // Attribution (the Overview/Slots seam) reads those EFFECTIVE spans.
    const trip = { days: [0, 1, 2, 3].map(index => ({ index })) } as unknown as Trip
    const attribution = tripDayAttribution(trip, [350, 350, 350, 350], effective)
    expect(attribution.daySpanKm(0)).toEqual({ fromKm: 0, toKm: 390 })
    expect(attribution.daySpanKm(1)).toEqual({ fromKm: 390, toKm: 700 })
    expect(attribution.dayForKm(395)).toBe(1)
    // A km past the plan is unassigned, not invented into a stored day.
    expect(attribution.dayForKm(1450)).toBeNull()
  })

  it('a saved later departure shortens its day and the corridor follows', () => {
    const dayStartTimes = ['08:30', '14:00', '08:30', '08:30']
    const facts = { ...RELAXED_VULNERABLE, dayStartTimes }
    const plan = deriveDrivingPlan(facts)
    const baseline = deriveDrivingPlan(RELAXED_VULNERABLE)
    // The saved 14:00 constraint is IN the walk…
    expect(plan.outbound[1].startMin).toBe(14 * 60)
    // …and it shortens that day's boundary against the 08:30 baseline.
    expect(plan.outbound[1].endKm).toBeLessThan(baseline.outbound[1].endKm)
    // The corridor recalculation keeps the constraint: its halt targets are
    // the walked boundaries, later days included.
    const targets = overnightTargets(corridor(facts, plan, { dayStartTimes }))
    expect(targets.map(t => Math.round(t!))).toEqual(plan.outbound.slice(0, -1).map(d => Math.round(d.endKm)))
  })

  it('a round trip keeps the route endpoints on both legs', () => {
    const plan = deriveDrivingPlan({ ...RELAXED_VULNERABLE, roundTrip: true })
    expect(plan.verdict).toBe('ok')
    expect(plan.return).not.toBeNull()
    expect(plan.outbound.at(-1)!.endKm).toBe(1400)
    expect(plan.return!.at(-1)!.endKm).toBe(1400)
    expect(plan.dayCount).toBe(plan.outbound.length + plan.return!.length)
  })
})

// ---- Case 5: the preview lifecycle against the real store ----

const { calls } = vi.hoisted(() => ({ calls: [] as Array<{ table: string; method: string }> }))

/** The Undo the Keep leaves is a TOAST BUTTON: capture it so the test can click
 *  it — asserting a toast was raised is not a recovery. */
const { toasts } = vi.hoisted(() => ({ toasts: [] as Array<{ msg: string; run: () => void }> }))
vi.mock('../src/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/components/ui')>()
  return { ...actual, undoToast: (msg: string, run: () => void) => { toasts.push({ msg, run }) } }
})

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    let method: string | undefined
    const builder: Record<string, unknown> = {}
    const chain = (m: string) => { method = m; return builder }
    builder.update = () => chain('update')
    builder.insert = () => chain('insert')
    builder.delete = () => chain('delete')
    builder.select = () => builder
    builder.eq = () => builder
    builder.in = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.lt = () => builder
    builder.maybeSingle = () => builder
    builder.single = () => builder
    builder.setHeader = () => builder
    builder.is = () => builder
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      new Promise(resolve => { if (method) calls.push({ table, method }); resolve({ data: null, error: null }) }).then(res)
    return builder
  }
  return {
    isSupabaseConfigured: false,
    supabase: { from: (t: string) => makeBuilder(t) },
  }
})

describe('case 5 — rejected previews change nothing; Keep applies the proposal; Undo restores', () => {
  it('stages, discards, keeps and undoes a removal through the workspace\'s own wiring', async () => {
    const { seedData } = await import('../src/data/seed')
    const { duplicateTrip, tripById, updateTrip, _setTripWriteDebounceMs } = await import('../src/store/store')
    const { stagedChange, keepIsStale } = await import('../src/lib/previewChain')
    const { removeStopWithUndo } = await import('../src/lib/mutationLifecycle')
    _setTripWriteDebounceMs(0)
    calls.length = 0
    toasts.length = 0
    const seedTrip = seedData.trips[0]
    const trip = duplicateTrip(seedTrip, 'lane3-owner')
    const flush = () => new Promise(resolve => setTimeout(resolve, 0))

    /** The workspace's applyChange/keep/discard, reduced to the lifecycle: chain
     *  onto the staged proposal, remember the base the preview started from,
     *  Keep refuses a stale base, then writes the DISPLAYED proposal. */
    let staged: Trip | null = null
    let base: Trip | null = null
    let onKept: (() => void) | undefined
    const applyChange: ApplyChange = (mutator, _kind, _dayIndex, kept) => {
      const committed = tripById(trip.id)!
      staged = stagedChange(committed, staged, mutator)
      if (!base) base = committed
      onKept = kept
    }
    const discard = () => { staged = null }
    const keep = (): 'kept' | 'refused' => {
      if (keepIsStale(base, tripById(trip.id)!)) return 'refused'
      updateTrip(trip.id, staged!)
      staged = null
      onKept?.()
      return 'kept'
    }

    const day = trip.days.find(d => d.stops.length >= 2) ?? trip.days[0]
    const before = day.stops.map(s => s.id)
    const orders = day.stops.map(s => s.orderInDay)
    const victim = before[1]

    // A rejected preview changes no itinerary: the removal stages, the
    // committed row is untouched, and discarding leaves it untouched.
    const outcome = removeStopWithUndo({ trip: tripById(trip.id)!, stopId: victim, dayIndex: day.index, applyChange })
    expect(outcome).toBe('staged-undo')
    expect(tripById(trip.id)!.days[day.index].stops.map(s => s.id)).toEqual(before)
    discard()
    expect(tripById(trip.id)!.days[day.index].stops.map(s => s.id)).toEqual(before)

    // Keep applies the DISPLAYED proposal: re-stage, keep, and the committed
    // row becomes what the sheet showed — the stop gone, 1..n again.
    removeStopWithUndo({ trip: tripById(trip.id)!, stopId: victim, dayIndex: day.index, applyChange })
    const displayed = staged!
    expect(displayed.days[day.index].stops.map(s => s.id)).toEqual(before.filter(id => id !== victim))
    expect(keep()).toBe('kept')
    expect(tripById(trip.id)!.days[day.index].stops.map(s => s.id)).toEqual(before.filter(id => id !== victim))

    // Undo restores the prior one: the toast the Keep leaves puts the stop
    // back on its day at its old order.
    const undo = toasts[toasts.length - 1]
    expect(undo).toBeDefined()
    undo.run()
    await flush()
    expect(tripById(trip.id)!.days[day.index].stops.map(s => s.id)).toEqual(before)
    expect(tripById(trip.id)!.days[day.index].stops.map(s => s.orderInDay)).toEqual(orders)
  })
})
