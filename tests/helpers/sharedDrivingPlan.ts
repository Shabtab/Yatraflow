import {
  deriveDrivingPlan,
  planRideSegments,
  type DrivingPlan,
  type DrivingPlanDay,
  type DrivingPlanInput,
  type RidePlanInput,
  type RideSegment,
} from '../../src/lib/ridePlan'

/** Test-only seam: the old `multiDay` fixtures keep their meaning, but the
 *  boundaries now come from the shared plan instead of a second split. */
export function planRide(
  input: Omit<RidePlanInput, 'dayBoundaries'> & {
    multiDay?: boolean
    dayBoundaries?: readonly DrivingPlanDay[]
  },
): RideSegment[] {
  const { multiDay, dayBoundaries, ...facts } = input
  return planRideSegments({
    ...facts,
    dayBoundaries: dayBoundaries ?? (multiDay ? deriveDrivingPlan(facts).outbound : []),
  })
}

export function sharedPlan(
  input: DrivingPlanInput & { multiDay?: boolean },
): DrivingPlan {
  const { multiDay: _multiDay, ...facts } = input
  return deriveDrivingPlan(facts)
}
