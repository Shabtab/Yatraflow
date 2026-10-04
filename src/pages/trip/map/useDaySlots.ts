// #420 slice 14: the day's plan derivations — the slots the rail renders.
//
// The shared deps, the day's stops, the slots, the readiness count, the
// whole-trip rows, the DNA hints, the shape blocks and the slot pins move
// together. All of them are data: memos over the corridor plan and the day
// the rail reads. The hook returns values only, never callbacks. The rail's
// render helpers (`slotPattern`, labels, row renderers) stay with the page.
import { useMemo } from 'react'
import type { Trip, ItineraryDay, TripDecision } from '../../../data/types'
import type { PlaceHit, SegmentHit } from '../../../lib/geocode'
import {
  daySlots, tripReadiness, tripDayAttribution,
  type DaySlot, type DaySlotsDeps,
} from '../../../lib/daySlots'
import type { PlaceIdentity } from '../../../lib/placeIdentity'
import { buildDnaVectorAcrossTrips, loadDnaLog, crewSeedEvents, slotPatternHint, type CrewSeed } from '../../../lib/tripDna'
import { slotPinsFor } from './railLabels'
import type { LatLng } from './weatherGeometry'

export type DaySlotsArgs = {
  pois: SegmentHit[]
  anchors: { lat: number; lng: number }[]
  routePolyline: LatLng[] | null
  transportMode: Trip['transportMode']
  travelStyle: Trip['travelStyle']
  existingNames: ReadonlySet<string>
  identity: PlaceIdentity
  altPool: { all: Array<{ h: PlaceHit }> }
  dayAttribution: Pick<ReturnType<typeof tripDayAttribution>, 'dayOfSegment' | 'daySpanKm'>
  decisions: TripDecision[] | undefined
  members: Trip['members']
  travellers: Trip['travellers']
  startLocationCoords: Trip['startLocationCoords']
  tripId: string
  crewSeeds: CrewSeed[]
  dnaTick: number
  addedIds: Set<string>
  dismissedIds: Set<string>
  days: ItineraryDay[]
  activeDayIndex: number
  daySlotSig: string
}

export function useDaySlots({
  pois, anchors, routePolyline, transportMode, travelStyle, existingNames,
  identity, altPool, dayAttribution, decisions, travellers, startLocationCoords,
  tripId, crewSeeds, dnaTick, addedIds, dismissedIds, days, activeDayIndex,
  daySlotSig, members,
}: DaySlotsArgs) {
  // One derivation feeds the rail, the meter and the fill flow: slots derive
  // from engine output alone (src/lib/daySlots.ts), so the view can never
  // drift from the engine. stopSig/refreshTick keep the memo honest against
  // store writes; the deps memo carries the expensive shared inputs.
  const daySlotDeps = useMemo<Omit<DaySlotsDeps, 'dayStops'>>(() => ({
    haltSegments: pois,
    anchors,
    routePolyline: routePolyline ?? null,
    transportMode,
    travelStyle,
    existingNames,
    identity,
    altPool: altPool.all.map(e => e.h),
    decisions,
    memberCount: (members ?? []).length,
    // #344: the slot re-scores its pool with the same extras the corridor
    // ranked by — DNA (per-trip learning + crew seeds) and the home point —
    // and reads the session add/dismiss bags so a just-added or just-
    // dismissed hit leaves the open slot with the pool cards. plannedStops
    // is derived per day inside candidatesFor from `dayStops` (a single
    // shared count here would charge every day the ACTIVE day's density,
    // including tripReadiness's matrix).
    dnaVector: buildDnaVectorAcrossTrips(loadDnaLog(), crewSeedEvents(tripId, crewSeeds)),
    homeCenter: startLocationCoords ?? null,
    addedIds,
    dismissedIds,
    // The shared attribution object - the same shape the Overview matrix feeds
    // its own deps, so the two surfaces cannot attribute a halt to two days.
    dayOfSegment: dayAttribution.dayOfSegment,
    // P2: the rail always renders the day's grammar - the skeleton supplies
    // the parts the corridor plan did not halt for, positioned on the day's
    // own road-km span (the same road-true km dayForKm trusts).
    fillSkeleton: true,
    daySpanKm: dayAttribution.daySpanKm,
  }), [pois, anchors, routePolyline, transportMode, travelStyle, existingNames, identity, altPool, dayAttribution, decisions, members, travellers, startLocationCoords, tripId, crewSeeds, dnaTick, addedIds, dismissedIds]) // eslint-disable-line react-hooks/exhaustive-deps -- refresh tokens: dnaTick re-reads the DNA log, travellers re-runs the cadence
  /** This day's stops - one lookup, shared by the slots, the shape and the fills. */
  const activeDayStops = useMemo(
    () => days.find(d => d.index === activeDayIndex)?.stops ?? [],
    [days, activeDayIndex],
  )
  const activeDaySlots = useMemo<DaySlot[]>(
    () => daySlots(activeDayIndex, { ...daySlotDeps, dayStops: activeDayStops }),
    [activeDayIndex, daySlotDeps, activeDayStops, daySlotSig], // eslint-disable-line react-hooks/exhaustive-deps -- refresh token: re-runs after store writes the inputs miss
  )
  /** Counted off the very slots the rail renders, not re-derived: a second
   *  `daySlots` call here was a whole extra derivation of the same day, and a
   *  meter that could in principle disagree with the list beside it. */
  const activeDayReadiness = useMemo(() => {
    const auto = activeDaySlots.filter(s => s.auto).length
    return {
      dayIndex: activeDayIndex,
      filled: activeDaySlots.filter(s => s.state === 'filled').length,
      total: activeDaySlots.length,
      auto,
      required: activeDaySlots.length - auto,
    }
  }, [activeDaySlots, activeDayIndex])
  /** S2: the whole day-chip row in ONE pass. The chips used to call
   *  `dayReadiness` per day inline in the render body, so every keystroke in
   *  the search box re-derived every day's slots - and each empty slot scores
   *  the entire corridor pool through `scoreHitForSegment`, two geometry
   *  projections per hit. */
  const tripReadinessRows = useMemo(
    () => tripReadiness(pois, days.map(d => ({ index: d.index, stops: d.stops })), daySlotDeps),
    [pois, days, daySlotDeps, daySlotSig], // eslint-disable-line react-hooks/exhaustive-deps -- refresh token: re-runs after store writes the inputs miss
  )
  /** P7.2: what the log has learned about each KIND of part - shown on an open
   *  part as context, never as a claim (silent until 3+ accepts). */
  const dnaSlotHints = useMemo(() => {
    const log = loadDnaLog()
    return {
      meal: slotPatternHint(log, 'meal'),
      fuel: slotPatternHint(log, 'fuel'),
      overnight: slotPatternHint(log, 'overnight'),
      stretch: slotPatternHint(log, 'stretch'),
    }
  }, [dnaTick]) // eslint-disable-line react-hooks/exhaustive-deps -- refresh token: re-reads the DNA log after each accept or decline
  // #420 slice 4: the pin's label is the same sentence a corridor row prints, from
  // the same helper — the two used to assemble it separately.
  const slotPins = useMemo(() => slotPinsFor(activeDaySlots), [activeDaySlots])

  return {
    daySlotDeps, activeDayStops, activeDaySlots, activeDayReadiness,
    tripReadinessRows, dnaSlotHints, slotPins,
  }
}
