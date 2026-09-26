// ============ Trip workspace — Timeline TravelPanel (extracted from TimelineTab.tsx,
// restructure Phase 3) — the unified travel card: mode/distance/fuel stats,
// departure→ETA, the halt planner (HaltPlanDraft/HaltPlanRow) and corridor search.
// ============ Trip workspace — Timeline tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
// Includes DaySection, DayWeatherChip, TravelPanel, HaltPlanRow, DaySpark,
// MoveStopModal and ClampedText — the whole timeline hot path.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {

  BedDouble, Coffee, Eye, ExternalLink, Fuel, MapPin,
  Plus, RotateCcw, Route as RouteIcon, Search,
  TriangleAlert, Utensils, X,
} from 'lucide-react'
import type { Trip, ItineraryStop } from '../../../data/types'
import {
  getAssumptions, minutesToHM, hmToMinutes, formatInr,
  addMinutesToClock, FUEL_PRICE_INR_PER_L, dayRoadPolyline,
} from '../../../lib/engine'
import { MODE_SPEED } from '../../../lib/engine'
import type { Journey, LegEstimate } from '../../../lib/engine'
import { openExternal } from '../../../lib/native'
import { googleMapsDirectionsUrl } from '../../../lib/externalMaps'
import { useTimeFormat, formatHM } from '../../../lib/timefmt'
import { toast } from '../../../components/ui'
import { Select } from '../../../components/Select'
import { useSuggestionCache } from '../../../hooks/useSuggestionCache'
import { searchNearbyPoisMulti, searchCitiesAlong, corridorAnchors, reasonForHit, filterPlannedNearby, asymmetricDetourMinutes, googleEnabled, googleCitiesAlong } from '../../../lib/geocode'
import type { PlaceHit, SegmentHit } from '../../../lib/geocode'
import { kmFromStartForHit, type HaltPurpose } from '../../../lib/providers/hits'
import { segmentsFromPlan, assignSegmentHits, annotateSegmentHits, type HaltPlanItem } from '../../../lib/ridePlan'
import { daySlackMin, slackPrompt, pickSlackHit, visitMinutesForCategory } from '../../../lib/slackPrompts'
import { pointAtKm } from '../../../lib/geo'
import type { LucideIcon } from 'lucide-react'
import { InlineIcon, MetaIcon } from '../../../components/icons'
import { cap } from '../shared'
function modeLabelMode(m: string): string {
  const map: Record<string, string> = {
    car: 'Car', motorcycle: 'Motorcycle', taxi: 'Taxi', bus: 'Bus',
    train: 'Train', flight: 'Flight', mixed: 'Mixed',
  }
  return map[m] ?? cap(m)
}

/**
 * The one travel panel — every day, any distance, any mode. Shows the day's
 * journey (mode, distance, drive time, fuel), the departure → arrival clocks,
 * planned halts, and lets you add halts manually or from real spots along the
 * route corridor. Replaces the old split where long rides got a completely
 * different "LongRidePanel" with its own ride-style options.
 */
export function TravelPanel({ trip, day, editable, journey, onSetDayStart, onAddPlannedHalts, suggestionCache, legCorrections }: {
  trip: Trip
  day: Trip['days'][number]
  editable: boolean
  journey: Journey
  legCorrections?: Record<string, LegEstimate>
  onSetDayStart: (dayIndex: number, time: string) => void
  onAddPlannedHalts: (dayIndex: number, halts: { km: number; stop: Omit<ItineraryStop, 'id' | 'orderInDay'> }[]) => void
  suggestionCache: ReturnType<typeof useSuggestionCache>
}) {
  const A = getAssumptions(trip)
  const timeFormat = useTimeFormat()
  const { cache: sugCache, setHaltCache } = suggestionCache

  // The day's ride as one continuous ROAD polyline (assembled from the routing
  // provider's per-leg geometry). Planned halts are placed along it, so a halt
  // "after N km" lands N road-km in — on the road the map draws. Null while
  // the routing layer hasn't resolved (offline estimate) — placement then
  // falls back to the straight-line stop chain.
  const roadPolyline = useMemo(
    () => dayRoadPolyline(journey.points, legCorrections),
    [journey, legCorrections],
  )
  // Hand the day's ride to the traveller's own Google Maps for turn-by-turn
  // directions — the panel describes the ride, the app doesn't navigate it.
  // journey.points carries the synthesized legs (outbound continuation, ride
  // home), so anchor-only days get a full origin → destination URL too.
  const directionsUrl = useMemo(
    () => googleMapsDirectionsUrl(journey.points.map(p => ({ lat: p.lat, lng: p.lng }))),
    [journey],
  )

  // ---- Halt planner ----
  // The plan is user-authored: WHERE along the ride (km) and HOW LONG (minutes),
  // per halt, plus what kind of stop it is. `hit` is the best real place found
  // near that km (empty until 🔎 is pressed); `pin` picks the real spot over a
  // generic break stop pinned at the route km.
  const [plan, setPlan] = useState<HaltPlanDraft[]>([])
  const [draftKm, setDraftKm] = useState(100)
  const [draftMin, setDraftMin] = useState(20)
  const [draftPurpose, setDraftPurpose] = useState<HaltPurpose>('meal')
  const [resolving, setResolving] = useState(false)
  const [searched, setSearched] = useState(false)
  const spotRequest = useRef(0)
  useLayoutEffect(() => {
    ++spotRequest.current
    setResolving(false)
    return () => { ++spotRequest.current }
  }, [trip.id, day.index, editable])
  // nearby pool for slack prompts — refreshed on every spot search, picked
  // live against current slack so any itinerary change re-computes the nudge
  const [slackPool, setSlackPool] = useState<{ hit: PlaceHit; detourMin: number | null }[]>([])

  // Hydrate the persisted plan + resolved spots so tab switches don't lose work.
  // Only rehydrates while the plan is empty, so in-flight edits are never
  // clobbered by this component's own cache write coming back around.
  useEffect(() => {
    const cached = sugCache.halts[day.index]
    setPlan(prev => {
      if (prev.length > 0) return prev
      if (!cached) return []
      return (cached.plan ?? []).map((p, i) => ({
        id: `pl-${day.index}-${i}-${p.km}-${p.minutes}`,
        km: p.km, minutes: p.minutes, purpose: p.purpose,
        hit: cached.segments[i]?.hit ?? null,
        // Opt-in: a planned halt sits on the route unless the user explicitly
        // chooses the real place found near it.
        pin: false,
      }))
    })
    if (cached) setSearched(true)
  }, [day, sugCache])

  // No real drive — no travelling card at all. Stay days (parked at the base
  // with no chain) and local days (visits around one place) render nothing
  // here: with no ride on the road there is no drive to clock and no halt to
  // add. The full panel appears the moment the day actually drives — e.g. the
  // user adds a stop in another town via the day's "+ Add stop" or drags one
  // in — which revives the departure clocks, halts and corridor suggestions.
  const hasDrive = journey.distanceKm >= 0.5 || journey.driveMinutes > 0
  if (!hasDrive) return null

  const startMin = hmToMinutes(journey.startTime)
  const isReturn = journey.direction === 'return'
  const fuelPrice = A.fuelPricePerL ?? FUEL_PRICE_INR_PER_L
  const fuelCost = journey.fuelLitres != null ? journey.fuelLitres * fuelPrice : journey.transportCostInr

  // Live schedule preview for the planned (not yet added) halts: each one adds
  // its duration plus the engine's per-stop buffer to the day's end clock.
  // Finite-guarded (#343): a stored halt with a missing/NaN minutes value used
  // to turn the arrival preview into `NaNh NaNm` — the same class of hole the
  // visitMinutes guard closed in the engine.
  const planMinutes = plan.reduce((a, p) => a + (Number.isFinite(p.minutes) ? p.minutes : 0), 0)
  const planBuffer = plan.length * A.bufferMinutesPerStop
  const arrivalPreview = formatHM(
    addMinutesToClock(startMin, journey.driveMinutes + journey.dwellMinutes + planMinutes + planBuffer),
    timeFormat,
  )

  /** Persist the plan (and its best spots) so it survives tab switches. */
  function commitPlan(next: HaltPlanDraft[]) {
    ++spotRequest.current
    setResolving(false)
    setPlan(next)
    const sorted = [...next].sort((a, b) => a.km - b.km)
    const segments = segmentsFromPlan(sorted, journey.distanceKm || 0, journey.driveMinutes)
    const hits: SegmentHit[] = segments.map((seg, i) => ({ segment: seg, hit: sorted[i]?.hit ?? null, score: 0 }))
    setHaltCache(day.index, hits, sorted.map(s => ({ km: s.km, minutes: s.minutes, purpose: s.purpose })))
  }

  function addPlanHalt() {
    const total = journey.distanceKm || 0
    const km = Math.round(Math.max(1, Math.min(draftKm || 0, total > 0 ? total : draftKm)))
    const minutes = Math.max(5, Math.min(draftMin || 20, 480))
    if (!Number.isFinite(km) || km <= 0) { toast('Enter a km point along this ride first.', 'err'); return }
    commitPlan([...plan, { id: `pl-${Date.now()}-${plan.length}`, km, minutes, purpose: draftPurpose, hit: null, pin: false }])
    setSearched(false)
  }

  function removePlanHalt(id: string) {
    commitPlan(plan.filter(p => p.id !== id))
  }

  function togglePin(id: string) {
    commitPlan(plan.map(p => (p.id === id ? { ...p, pin: !p.pin } : p)))
  }

  /**
   * Find a real spot near each planned km point (restaurant / fuel / hotel,
   * matched to the halt's purpose) along the day's corridor. Runs only on this
   * explicit action — never on derived-state churn.
   */
  async function resolveSpots() {
    if (!editable || plan.length === 0) return
    const request = ++spotRequest.current
    const ownsRequest = () => request === spotRequest.current
    setResolving(true)
    try {
      const routePts = journey.points.map(p => ({ lat: p.lat, lng: p.lng }))
      // Sample the search anchors along the ROAD polyline when routing has
      // resolved — chord anchors sit off the highway on curvy rides and bias
      // which POIs the scan finds. Home-zone exclusion still applies inside.
      const anchors = corridorAnchors(roadPolyline ?? routePts, trip.startLocationCoords, 35000, 8)
      const purposes = [...new Set(plan.map(p => p.purpose))]
      // Provider directive (2026-09-07): Google-only in Google mode — POIs and
      // the city layer both come from Google; free stack only without a key.
      const [hits, cities] = await Promise.all([
        searchNearbyPoisMulti(anchors, 35000, 16, {
          purposes,
          includeFuel: trip.transportMode === 'car' || trip.transportMode === 'motorcycle',
          homeCenter: trip.startLocationCoords ?? null,
          // Google mode: scan as one road-true Search-Along-Route request;
          // detours are measured geometrically against this polyline. Free
          // mode ignores it.
          routeCoords: roadPolyline ? roadPolyline.map(p => [p.lng, p.lat] as [number, number]) : null,
        }).catch(() => [] as PlaceHit[]),
        (googleEnabled()
          ? googleCitiesAlong(anchors, 35000, 8)
          : searchCitiesAlong(anchors, 35000, 8)
        ).catch(() => [] as PlaceHit[]),
      ])
      if (!ownsRequest()) return
      const seen = new Set<string>()
      const candidates: PlaceHit[] = []
      for (const h of [...cities, ...hits]) {
        if (!h.name) continue
        const key = h.name.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        candidates.push(h)
      }
      const sorted = [...plan].sort((a, b) => a.km - b.km)
      const segments = segmentsFromPlan(sorted, journey.distanceKm || 0, journey.driveMinutes)
      const planned = trip.days.flatMap(d => d.stops)
        .filter(s => s.status !== 'rejected' && Number.isFinite(s.lat) && Number.isFinite(s.lng))
        .map(s => ({ lat: s.lat, lng: s.lng, name: s.title }))
      const unplanned = planned.length > 0 ? filterPlannedNearby(candidates, planned) : candidates
      // refresh the slack pool: cheapest-detour unplanned hits (cap 12) —
      // detours measured asymmetrically against the road polyline when
      // available (on-the-way hits cost ~0), matching the Map tab.
      const speed = MODE_SPEED[trip.transportMode] ?? 40
      setSlackPool(
        unplanned
          .map(h => ({ hit: h, detourMin: asymmetricDetourMinutes(h, anchors, roadPolyline, speed) }))
          .filter((o): o is { hit: PlaceHit; detourMin: number } => o.detourMin != null && Number.isFinite(o.detourMin) && o.detourMin >= 0)
          .sort((a, b) => a.detourMin - b.detourMin)
          .slice(0, 12),
      )
      const assigned = annotateSegmentHits(
        assignSegmentHits(unplanned, segments, anchors, { homeCenter: trip.startLocationCoords ?? null, routePolyline: roadPolyline ?? (routePts.length >= 2 ? routePts : null), speedKmph: MODE_SPEED[trip.transportMode] ?? 40 }),
        candidates,
      )
      const hitById = new Map<string, PlaceHit | null>()
      sorted.forEach((item, i) => hitById.set(item.id, assigned[i]?.hit ?? null))
      setSearched(true)
      commitPlan(plan.map(item => ({ ...item, hit: hitById.get(item.id) ?? null })))
    } catch {
      if (ownsRequest()) {
        toast('Could not find spots for your halts.', 'err')
        setSearched(true)
      }
    } finally {
      if (ownsRequest()) setResolving(false)
    }
  }

  /** Turn the planned halts into real day stops (pinned spot, else generic at the route km). */
  function addHaltsToDay() {
    if (plan.length === 0) return
    const genericTitle = (purpose: HaltPurpose) =>
      purpose === 'meal' ? 'Meal break' : purpose === 'fuel' ? 'Fuel stop' : purpose === 'overnight' ? 'Overnight stay' : 'Break — tea & stretch'
    const halts = plan.map(item => {
      const useSpot = item.pin && item.hit
      // Unpinned halts sit ON the road at the requested road-km: interpolate
      // along the routing provider's geometry when it has resolved, so the
      // point rides the actual highway rather than the stop-to-stop chord.
      const pt = useSpot
        ? { lat: item.hit!.latitude, lng: item.hit!.longitude }
        : (pointAtKm(roadPolyline ?? journey.points, item.km) ?? journey.points[0])
      const cat: ItineraryStop['category'] =
        item.purpose === 'meal' ? 'food' : item.purpose === 'fuel' ? 'transport-hub' : item.purpose === 'overnight' ? 'hotel' : 'rest'
      return {
        km: item.km,
        stop: {
          title: useSpot ? item.hit!.name : genericTitle(item.purpose),
          category: cat,
          locationName: useSpot ? (item.hit!.description || item.hit!.name) : 'Ride break en route',
          lat: pt.lat, lng: pt.lng,
          description: useSpot ? item.hit!.description ?? '' : '',
          notes: `Halt at ~${Math.round(item.km)} km (+${item.minutes} min)${useSpot ? ` · ${item.hit!.name}` : ''}`,
          visitMinutes: item.minutes, openTime: '', closeTime: '',
          entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
          priority: 'nice-to-have', sourceUrl: '', status: 'confirmed',
        } as Omit<ItineraryStop, 'id' | 'orderInDay'>,
      }
    })
    onAddPlannedHalts(day.index, halts)
  }

  const title = isReturn
    ? `Return drive · back to ${journey.endTitle}`
    : `Travelling · ${journey.startTitle} → ${journey.endTitle}`

  // Slack prompt: leftover day window plus the cheapest fitting nearby pick.
  // Recomputes live, so any itinerary change refreshes the nudge.
  const slackMin = daySlackMin({
    dayEndMin: hmToMinutes(A.dayEnd), startMin,
    driveMin: journey.driveMinutes, dwellMin: journey.dwellMinutes,
    planMin: planMinutes, bufferMin: planBuffer,
  })
  const slackCands = slackPool.map(o => ({ name: o.hit.name, detourMin: o.detourMin == null ? Number.POSITIVE_INFINITY : o.detourMin, category: o.hit.category }))
  const slackPickHit = (() => {
    const pick = pickSlackHit(slackMin, slackCands)
    if (!pick) return null
    return slackPool.find(o => o.hit.name === pick.name)?.hit ?? null
  })()
  const slackText = slackPrompt(slackMin, journey.startTitle, slackCands)

  return (
    <div className="travel-panel">
      <div className="travel-panel-head">
        <div className="travel-panel-toprow">
          <div className="travel-panel-title"><InlineIcon icon={RouteIcon} size={13} gap={4} />{title}</div>
          {directionsUrl && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 'auto', flex: 'none' }}
              onClick={() => openExternal(directionsUrl)}
              title="Open this ride with turn-by-turn directions in Google Maps"
            >
              <InlineIcon icon={ExternalLink} size={13} gap={4} />Directions
            </button>
          )}
        </div>
        <div className="small muted">
          {modeLabelMode(trip.transportMode)} · {journey.distanceKm.toFixed(0)} km · {minutesToHM(journey.driveMinutes)} wheel time
          {journey.halts.length > 0 && ` · ${journey.halts.length} halt${journey.halts.length !== 1 ? 's' : ''}`}
        </div>
      </div>

      <div className="travel-panel-stats">
        <div className="tps-stat"><div className="tps-label">Mode</div><b>{modeLabelMode(trip.transportMode)}</b></div>
        <div className="tps-stat"><div className="tps-label">Distance</div><b>{journey.distanceKm.toFixed(0)} km</b></div>
        <div className="tps-stat"><div className="tps-label">Drive time</div><b>{minutesToHM(journey.driveMinutes)}</b></div>
        <div className="tps-stat">
          <div className="tps-label">{journey.fuelLitres != null ? 'Fuel needed' : 'Est. transport'}</div>
          <b>{journey.fuelLitres != null ? `${journey.fuelLitres.toFixed(1)} L` : formatInr(Math.round(fuelCost))}</b>
        </div>
      </div>

      {journey.fuelLitres != null && (
        <div className="travel-panel-fuel">
          ≈ {journey.fuelLitres.toFixed(1)} L × ₹{fuelPrice}/L = <b>{formatInr(Math.round(fuelCost))}</b>
          {' '}<span className="small muted">{A.fuelPriceIsUserSet ? '(your pump price)' : '(indicative national rate)'}</span>
        </div>
      )}

      <div className="travel-panel-eta">
        {editable ? (
          <label className="tps-dep">
            <span className="tps-label">Departure</span>
            <input type="time" className="input input--compact" value={journey.startTime} onChange={e => onSetDayStart(day.index, e.target.value)} />
            <span className="time-preview">= {formatHM(journey.startTime, timeFormat)}</span>
          </label>
        ) : (
          <span className="tps-label">Departure {formatHM(journey.startTime, timeFormat)}</span>
        )}
        <span className="tps-arrow">→</span>
        <div className="tps-eta">
          <div className="tps-label">{isReturn ? 'Home by' : 'Arrival'}</div>
          <b>{formatHM(journey.arrivalTime, timeFormat)}</b>
        </div>
        {journey.dwellMinutes > 0 && <div className="small muted">includes {minutesToHM(journey.dwellMinutes)} of stops</div>}
      </div>

      {journey.driveMinutes >= 420 && journey.halts.length === 0 && (
        <div className="warn-item sev-medium" style={{ marginTop: 10 }}>
          <span className="warn-icon"><TriangleAlert size={13} aria-hidden /></span>
          <div>
            <div className="warn-title">~{minutesToHM(journey.driveMinutes)} behind the wheel with no halt</div>
            <div className="warn-fix">Riding more than ~6–7 h in one go is a fatigue risk — add a halt below or split the drive across two days.</div>
          </div>
        </div>
      )}

      {journey.halts.length > 0 && (
        <div className="travel-panel-halts">
          {journey.halts.map(h => (
            <span key={h.id} className="tp-halt-chip">{h.title} · {minutesToHM(h.visitMinutes || 0)}</span>
          ))}
        </div>
      )}

      {editable && (
        <div className="travel-panel-add halt-planner" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div className="small muted"><MetaIcon icon={ MapPin } tone="place" />Halt planner — you pick where along the ride and for how long. Halts sit on the route itself; tick a found spot to detour there instead.</div>
          <div className="halt-planner-inputs">
            <label className="hp-field">
              <span className="tps-label">after</span>
              <input
                type="number" min={1} step={10} value={draftKm} className="input input--compact"
                onChange={e => setDraftKm(Math.max(1, Number(e.target.value) || 0))}
                aria-label="Halt after how many km" style={{ width: 78 }}
              />
              <span className="tps-label">km</span>
            </label>
            <label className="hp-field">
              <span className="tps-label">for</span>
              <input
                type="number" min={5} max={480} step={5} value={draftMin} className="input input--compact"
                onChange={e => setDraftMin(Math.max(5, Math.min(480, Number(e.target.value) || 20)))}
                aria-label="Halt duration in minutes" style={{ width: 64 }}
              />
              <span className="tps-label">min</span>
            </label>
            <Select compact value={draftPurpose} onChange={v => setDraftPurpose(v as HaltPurpose)} aria-label="Halt type"
              options={[{ value: 'meal', label: 'Meal' }, { value: 'stretch', label: 'Stretch / rest' }, { value: 'fuel', label: 'Fuel' }, { value: 'overnight', label: 'Overnight' }]} />
            <button className="btn btn-outline btn-sm" onClick={addPlanHalt}>+ Add halt</button>
          </div>

          {plan.length > 0 && (
            <>
              <div className="halt-plan-list">
                {plan.map(item => (
                  <HaltPlanRow key={item.id} item={item}
                    onRemove={() => removePlanHalt(item.id)}
                    onTogglePin={() => togglePin(item.id)} />
                ))}
              </div>
              <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="small muted">
                  {plan.length} halt{plan.length !== 1 ? 's' : ''} · +{minutesToHM(planMinutes)} → arrival ≈ <b>{arrivalPreview}</b>
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-outline btn-sm" onClick={resolveSpots} disabled={resolving}>
                    {resolving ? 'Searching the route…'
                      : plan.some(p => p.hit) ? <><InlineIcon icon={RotateCcw} size={13} gap={4} />Re-find real spots</>
                      : <><InlineIcon icon={Search} size={13} gap={4} />Find real spots</>}
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={addHaltsToDay}><InlineIcon icon={Plus} size={13} gap={4} />Add {plan.length} to the day</button>
                </div>
              </div>
              {searched && !plan.some(p => p.hit) && (
                <span className="small muted">
                  No good spots found near your km points — the halts will be added as generic breaks on the route itself.
                </span>
              )}
            </>
          )}
          {editable && slackText && slackPickHit && (
            <div className="poi-desc small" style={{ marginTop: 6 }}>
              ☀ {slackText}
              {' '}
              <button
                className="btn btn-outline btn-sm"
                onClick={() => {
                  const h = slackPickHit
                  const km = kmFromStartForHit({ latitude: h.latitude, longitude: h.longitude }, roadPolyline ?? journey.points) ?? 0
                  onAddPlannedHalts(day.index, [{
                    km,
                    stop: {
                      title: h.name,
                      category: (h.category as ItineraryStop['category']) ?? 'sightseeing',
                      locationName: h.description || h.name,
                      lat: h.latitude, lng: h.longitude,
                      description: h.description ?? '',
                      notes: "Slack pick — fits the day's leftover time",
                      visitMinutes: visitMinutesForCategory(h.category),
                      openTime: '', closeTime: '',
                      entryFeeInrPerPerson: 0, transportCostInrTotal: 0,
                      priority: 'nice-to-have', sourceUrl: '', status: 'suggested',
                    },
                  }])
                  setSlackPool(prev => prev.filter(o => o.hit.name !== h.name))
                  toast(`“${h.name}” added to Day ${day.index + 1} as a suggestion`)
                }}
              >+ Add</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** One user-planned halt in the halt planner: km point + duration + purpose,
 *  plus the best real spot found near that km and whether to pin to it. */
interface HaltPlanDraft extends HaltPlanItem {
  id: string
  hit: PlaceHit | null
  pin: boolean
}

const HALT_PURPOSE_META: Record<HaltPurpose, { label: string; Icon: LucideIcon }> = {
  meal: { label: 'Meal', Icon: Utensils },
  stretch: { label: 'Break', Icon: Coffee },
  fuel: { label: 'Fuel', Icon: Fuel },
  overnight: { label: 'Overnight', Icon: BedDouble },
  rest: { label: 'Break', Icon: Coffee },
  sight: { label: 'Stop', Icon: Eye },
}

/** One planned halt: where along the ride, how long, and the real spot found near it (pinnable). */
function HaltPlanRow({ item, onRemove, onTogglePin }: {
  item: HaltPlanDraft
  onRemove: () => void
  onTogglePin: () => void
}) {
  const h = item.hit
  const usingSpot = item.pin && h
  return (
    <div className="ride-spot halt-plan-row">
      <div className="ride-spot-main">
        <div className="ride-spot-title">
          <span className={`ride-purpose ride-purpose-${item.purpose}`}>{(() => { const m = HALT_PURPOSE_META[item.purpose]; return <><InlineIcon icon={m.Icon} size={11} gap={3} />{m.label}</> })()}</span>
          <b>{usingSpot ? h!.name : 'On the route'}</b>
        </div>
        <span className="muted small">
          after ~{Math.round(item.km)} km · {item.minutes} min halt
          {usingSpot && h!.offRouteKm != null ? ` · ~${Math.round(h!.offRouteKm)} km off route` : ''}
        </span>
        {usingSpot && h && reasonForHit(h) && (
          <span className="muted small">Why: {reasonForHit(h)}</span>
        )}
        {h && (
          <label className="hp-pin muted small">
            <input type="checkbox" checked={item.pin} onChange={onTogglePin} aria-label={`Detour to ${h.name} instead of halting on the route`} />
            <span>detour to {h.name}{h.nearestCity ? ` (near ${h.nearestCity})` : ''} instead of the route point</span>
          </label>
        )}
      </div>
      <div className="ride-spot-actions">
        <button className="btn btn-ghost btn-sm" onClick={onRemove} title="Remove this planned halt"
          aria-label={`Remove the halt planned at ${Math.round(item.km)} km`}><X size={13} aria-hidden /></button>
      </div>
    </div>
  )
}
