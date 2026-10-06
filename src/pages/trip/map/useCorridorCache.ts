// #420 slice 11: the corridor cache owns the plan freshness and the scans.
//
// The inputs hash, its publish, the fraction fallback and the main corridor
// scan move together. They share one hash value. They share one loading
// latch. Splitting them would hide the latch contract (#544).
//
// The hook takes data and returns data. It returns no callbacks. The render
// must never call a function that a hook returns, so all four returns are
// values the render reads directly. `pois` stays with the caller: the render reads
// it before the inputs this hook needs exist.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Trip } from '../../../data/types'
import { MODE_SPEED } from '../../../lib/engine'
import {
  planJourneyHalts, searchNearbyPoisMulti, routeHash,
  type NearbyOpts, type PlaceHit, type SegmentHit, type TravelClockVerdict,
} from '../../../lib/geocode'
import { anchorHash } from '../../../lib/providers/hits'
import { QuotaExhaustedError } from '../../../lib/providers/google'
import { planInputsHash, isMapCacheFresh, useSuggestionCache } from '../../../hooks/useSuggestionCache'
import { loadHaltPinsForTrip } from '../../../lib/uiPrefs'
import { buildDnaVectorAcrossTrips, loadDnaLog, crewSeedEvents, type CrewSeed } from '../../../lib/tripDna'
import type { MapRoadView } from '../../../lib/tripRoad'

export type CorridorCacheArgs = {
  trip: Trip
  anchors: { lat: number; lng: number }[]
  routeGeometry: MapRoadView['geometry']
  scopeKm: number
  dayRainPct: (number | null)[] | null
  dayWeatherCode: (number | null)[] | null
  crewSeeds: CrewSeed[]
  dnaTick: number
  onInputsHash?: (inputsHash: string, scopeKm: number) => void
  /** The live plan rows. Owned by the caller, written by the scan below. */
  pois: SegmentHit[]
  setPois: React.Dispatch<React.SetStateAction<SegmentHit[]>>
  nearbyOpts: NearbyOpts
  planKm: number
  wholeTripMin: number
  travelDayNeed: number
  clockVerdict: TravelClockVerdict['verdict']
  /** `splitVerdict?.driveDayCount`: undefined means the split stays silent. */
  splitDriveDayCount: number | undefined
  refreshTick: number
  suggestionCache: ReturnType<typeof useSuggestionCache>
}

export function useCorridorCache({
  trip, anchors, routeGeometry, scopeKm, dayRainPct, dayWeatherCode, crewSeeds,
  dnaTick, onInputsHash, pois, setPois, nearbyOpts, planKm, wholeTripMin,
  travelDayNeed, clockVerdict, splitDriveDayCount, refreshTick, suggestionCache,
}: CorridorCacheArgs) {
  const [loadingPois, setLoadingPois] = useState(false)

  // #331: one hash is shared by the main plan and the light fraction fallback.
  // Missing fields stay optional for older callers/tests; the Map tab passes all
  // current engine inputs explicitly.
  const mapInputsHash = useMemo(() => planInputsHash({
    anchorsHash: anchorHash(anchors),
    routeHash: routeHash(routeGeometry),
    travelStyle: trip.travelStyle,
    transportMode: trip.transportMode,
    scopeKm,
    // #335: planInputsHash keys the suggestion cache on the same cadence crew
    // the nearby fetch above reads — `travellers`, never the member list.
    travellers: trip.travellers,
    driverCount: trip.driverCount,
    hasVulnerable: trip.hasVulnerable,
    driveAfterDinnerMin: trip.driveAfterDinnerMin,
    dayStartTimes: trip.days.map(d => d.startTime ?? '08:30'),
    dayRainPct,
    dayWeatherCode,
    haltPins: loadHaltPinsForTrip(trip.id),
    dnaVector: buildDnaVectorAcrossTrips(loadDnaLog(), crewSeedEvents(trip.id, crewSeeds)),
    speedKmph: MODE_SPEED[trip.transportMode] ?? 40,
    budgetPerPersonInr: trip.budgetPerPersonInr,
    fuelEconomyKmL: trip.fuelEconomyKmL,
    fuelPricePerL: trip.fuelPricePerL,
    roundTrip: trip.roundTrip,
    vehicleProfile: trip.vehicleProfile,
  }), [anchors, routeGeometry, trip, scopeKm, dayRainPct, dayWeatherCode, crewSeeds, dnaTick]) // eslint-disable-line react-hooks/exhaustive-deps -- dnaTick re-reads the DNA log after each accept or decline

  // #404: the Overview's slot matrix gates on the SAME freshness this tab's cache
  // was written with — `isMapCacheFresh(cache.map, scopeKm, mapInputsHash)` — and
  // it cannot recompute the hash: `routeHash(routeGeometry)` needs the measured
  // road, and the rain/code arrays are this tab's state. A partial hash computed
  // workspace-side would never equal this one, so its comparison would report
  // "stale" forever — worse than today's silence. Publishing the pair is the fix.
  // The ref makes the call idempotent per VALUE: a parent re-rendering with a
  // fresh callback identity must not be re-notified, or the two tabs ping-pong
  // state at each other.
  const publishedInputsRef = useRef('')
  useEffect(() => {
    if (!onInputsHash) return
    const key = `${mapInputsHash}|${scopeKm}`
    if (publishedInputsRef.current === key) return
    publishedInputsRef.current = key
    onInputsHash(mapInputsHash, scopeKm)
  }, [mapInputsHash, scopeKm, onInputsHash])

  // Fraction fallback pool (P1-C): below the fatigue floor the planner is
  // honestly silent, but the strip must never read as "nothing around" —
  // one light corridor fetch feeds the ¼/½/¾ rows.
  const [fractionPois, setFractionPois] = useState<PlaceHit[] | null>(null)
  const [corridorQuotaOut, setCorridorQuotaOut] = useState(false)
  const corridorAbort = useRef<AbortController | null>(null)
  useEffect(() => {
    if (loadingPois || pois.length > 0 || anchors.length < 2) { setFractionPois(null); return } // eslint-disable-line react-hooks/set-state-in-effect -- the guard clears stale fallback rows before the fetch below runs
    const cached = suggestionCache.cache.fraction
    if (cached && isMapCacheFresh(cached, scopeKm, mapInputsHash)) {
      setFractionPois(cached.hits)
      return
    }
    const controller = new AbortController()
    corridorAbort.current?.abort()
    corridorAbort.current = controller
    let cancelled = false
    searchNearbyPoisMulti(anchors, scopeKm * 1000, 12, { ...nearbyOpts, purposes: ['sight' as const, 'meal' as const], signal: controller.signal })
      .then(hits => {
        if (cancelled) return
        setFractionPois(hits)
        if (hits.length > 0) suggestionCache.setFractionCache(hits, mapInputsHash, scopeKm)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (err instanceof QuotaExhaustedError) { setCorridorQuotaOut(true); setFractionPois(null) }
        else if (!controller.signal.aborted) setFractionPois([])
      })
    return () => { cancelled = true; controller.abort() }
  }, [loadingPois, pois, anchors, nearbyOpts, scopeKm, refreshTick, mapInputsHash, suggestionCache])

  useEffect(() => {
    if (anchors.length === 0) return
    const cached = suggestionCache.cache.map
    // #331: the shared hash covers route shape, weather/time cadence, pinned
    // halts, DNA preferences, speed, crew/fuel/budget and scope. Cache hits
    // therefore survive tab switches but never serve a stale engine plan.
    const inputsHash = mapInputsHash
    // Persisted results win across tab switches and unrelated saves. When the
    // route resolves after mount, the effect intentionally re-runs once through
    // the degraded-scan path so a starved pre-geometry plan is replaced by the
    // real road corridor; only ↻ Refresh, a scope change, new anchors, or an
    // empty cache starts another paid scan.
    if (cached && isMapCacheFresh(cached, scopeKm, inputsHash)) {
      setCorridorQuotaOut(false) // eslint-disable-line react-hooks/set-state-in-effect -- a fresh cache answers at once: publish it instead of starting a paid scan
      setPois(cached.segments)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    setLoadingPois(true)
    // Day Planner arming (P1-B/#121): the ROUTE arms the split — the clock
    // walk when it speaks ('ok' → its day count), the drive-day split when the
    // clock defers, tonight's hop otherwise. NEVER the planned day count: a
    // 700 km 1-day plan still needs its night halt; a 3-day 200 km trip none.
    const derivedMultiDay = clockVerdict === 'ok'
      ? travelDayNeed > 1
      : splitDriveDayCount != null
        ? splitDriveDayCount > 1
        : clockVerdict === 'hop'
    planJourneyHalts(anchors, planKm, wholeTripMin, { ...nearbyOpts, multiDay: derivedMultiDay, signal: controller.signal }, scopeKm * 1000)
      .then(plan => {
        if (!cancelled) {
          setCorridorQuotaOut(false)
          setPois(plan)
          // Never cache an empty plan: the first search can run before the
          // route resolves, and a persisted [] would stick until Refresh.
          // #185: also never cache a DEGRADED plan — when the road hasn't
          // resolved for a multi-anchor trip, the scan ran start-area point
          // searches only; persisting it would serve the starved corridor for
          // the full 4 h TTL. The scan effect re-fires when geometry arrives
          // (nearbyOpts depends on it), and the fresh plan then caches.
          const degradedScan = routeGeometry == null && anchors.length >= 2
          if (plan.length > 0 && !degradedScan) suggestionCache.setMapCache(plan, inputsHash, scopeKm)
        }
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted) return
        if (err instanceof QuotaExhaustedError) { setCorridorQuotaOut(true); setPois([]) }
      })
      .finally(() => { if (!cancelled) setLoadingPois(false) })
    return () => {
      cancelled = true
      controller.abort()
      // #544: the cancelled run was the flag's owner, so the cleanup releases
      // it. The re-run re-raises it only when it truly starts a new scan; a
      // fresh-cache early return must not inherit a phantom in-flight flag —
      // that latch read as a permanent "searching…" and disabled Refresh and
      // the detour-scope slider until a full reload.
      setLoadingPois(false)
    }
  }, [anchors, nearbyOpts, scopeKm, mapInputsHash, planKm, wholeTripMin, travelDayNeed, clockVerdict, refreshTick, splitDriveDayCount]) // eslint-disable-line react-hooks/exhaustive-deps -- the scan reads the split count through its dep; the cache identity and the raw geometry stay out (nearbyOpts covers geometry, the cache would loop)

  return { mapInputsHash, fractionPois, corridorQuotaOut, loadingPois }
}
