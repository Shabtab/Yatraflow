// ============ Trip workspace — Map tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
import React, { useEffect, useMemo, useState } from 'react'
import { CircleCheck, Clock, Fuel, Lightbulb, MapPin, RotateCcw } from 'lucide-react'
import { MetaIcon } from '../../components/icons'
import type { Trip, ItineraryStop } from '../../data/types'
import type { ImpactResult } from '../../lib/impact'
import { routePath } from '../../lib/routing'
import { getAssumptions, buildJourney, minutesToHM, computeCategoryBias, MODE_SPEED } from '../../lib/engine'
import { useTimeFormat, formatHMRange } from '../../lib/timefmt'
import { Modal, Field, toast } from '../../components/ui'
import { useSuggestionCache } from '../../hooks/useSuggestionCache'
import { corridorAnchors, detourKm, googleEnabled, planJourneyHalts, reasonForSegmentHit, type NearbyOpts } from '../../lib/geocode'
import type { PlaceHit, SegmentHit } from '../../lib/geocode'
import { anchorHash } from '../../lib/providers/hits'
import { fetchDailyWeather, forecastAvailable, isoAddDays } from '../../lib/weather'
// MapLibre is heavy (~1MB) — load it only when the Map tab is actually opened.
const TripMap = React.lazy(() => import('../../components/TripMap').then(m => ({ default: m.TripMap })))

// ================= Map tab =================

/** Wikipedia thumbnail URLs are hotlink-friendly but huge; ask for a small one. */
function smallThumb(url: string): string {
  return url.replace(/\/(\d+)px-/, '/120px-')
}

/** Detour-scope presets for nearby suggestions (km off the route). */
const SCOPE_KM_STEPS = [10, 20, 30, 50, 80, 100]
const SCOPE_STORAGE_KEY = 'yf_nearby_scope_km'

/** Sensible visit durations per suggestion category (tourist pacing). */
function poiVisitMinutes(cat?: string): number {
  switch (cat) {
    case 'food': return 45
    case 'hotel': return 0        // overnight stay — consumes no daylight
    case 'transport-hub': return 20 // petrol-pump pit stop
    case 'museum': case 'temple': case 'nature': case 'beach': return 90
    default: return 60
  }
}

export function MapTab({ trip, editable, applyChange, suggestionCache }: {
  trip: Trip
  editable: boolean
  applyChange: (mutator: (d: Trip) => void, kind: ImpactResult['kind'], dayIndex: number) => void
  suggestionCache: ReturnType<typeof useSuggestionCache>
}) {
  const [pois, setPois] = useState<SegmentHit[]>([])
  const timeFormat = useTimeFormat()
  const [loadingPois, setLoadingPois] = useState(false)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  // bump to force a corridor re-search — the only refetch path besides a
  // detour-scope change or a first-ever load (empty cache)
  const [refreshTick, setRefreshTick] = useState(0)
  // detour-scope control — how far off the route suggestions may sit
  const [scopeIdx, setScopeIdx] = useState(() => {
    const saved = Number(localStorage.getItem(SCOPE_STORAGE_KEY))
    const i = SCOPE_KM_STEPS.indexOf(saved)
    return i >= 0 ? i : 1 // default 20 km
  })
  const scopeKm = SCOPE_KM_STEPS[scopeIdx]
  function changeScope(i: number) {
    setScopeIdx(i)
    localStorage.setItem(SCOPE_STORAGE_KEY, String(SCOPE_KM_STEPS[i]))
  }
  // pending "add from map / nearby" — pick a day, then confirm
  const [poiDraft, setPoiDraft] = useState<{ hit: PlaceHit } | null>(null)
  const [pickDay, setPickDay] = useState<number>(0)

  const existingNames = useMemo(() => {
    const names = new Set<string>()
    for (const d of trip.days) for (const s of d.stops) names.add(s.title.toLowerCase())
    return names
  }, [trip])

  // whole-trip wheel distance & time (journey sums) — the plan budget for the
  // fatigue math; OSRM's road total wins when it's available (more accurate).
  const wholeTrip = useMemo(() => {
    let km = 0
    let min = 0
    for (const d of trip.days) {
      const j = buildJourney(trip, d)
      km += j.distanceKm
      min += j.driveMinutes
    }
    return { km, min }
  }, [trip])

  /** Which day's cumulative drive covers a given along-route km (for pick-a-day defaults). */
  function dayForKm(km: number | undefined): number {
    if (km == null) return trip.days[0]?.index ?? 0
    let covered = 0
    for (const d of trip.days) {
      covered += buildJourney(trip, d).distanceKm
      if (km <= covered) return d.index
    }
    return trip.days[trip.days.length - 1]?.index ?? 0
  }

  // search the WHOLE route corridor (start → stops → destination); the home
  // zone around the starting point is excluded inside the engine
  const anchors = useMemo(() => {
    const pts = trip.days
      .flatMap(d => d.stops)
      .filter(s => s.status !== 'rejected')
      .map(s => ({ lat: s.lat, lng: s.lng }))
    return corridorAnchors(pts, trip.startLocationCoords ?? null, scopeKm * 1000)
  }, [trip, scopeKm])

  // OSRM road geometry of the whole route — feeds Google Search-Along-Route
  // (the report's killer feature); the free stack ignores it. TripMap draws
  // the same legs independently, so this is one extra free OSRM call per route.
  const [routeGeometry, setRouteGeometry] = useState<[number, number][] | null>(null)
  const [routeTotalKm, setRouteTotalKm] = useState<number | null>(null)
  // Per-day rain chance for the weather join — best-effort, null until loaded.
  const [dayRainPct, setDayRainPct] = useState<(number | null)[] | null>(null)
  useEffect(() => {
    const stops = trip.days.flatMap(d => d.stops).filter(s => s.status !== 'rejected' && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    if (stops.length === 0 || !forecastAvailable(trip.startDate)) { setDayRainPct(null); return }
    let cancelled = false
    const anchor = {
      lat: stops.reduce((a, s) => a + s.lat, 0) / stops.length,
      lng: stops.reduce((a, s) => a + s.lng, 0) / stops.length,
    }
    fetchDailyWeather(anchor.lat, anchor.lng, trip.startDate, trip.days.length || 1)
      .then(w => {
        if (cancelled) return
        setDayRainPct(trip.days.map((_, i) => w[isoAddDays(trip.startDate, i)]?.rainChancePct ?? null))
      })
      .catch(() => { if (!cancelled) setDayRainPct(null) })
    return () => { cancelled = true }
  }, [trip])
  // OSRM's road total (when resolved) is the most accurate journey budget for
  // the fatigue math; until then use the journey-summed estimate.
  const planKm = routeTotalKm && routeTotalKm >= 90 ? routeTotalKm : wholeTrip.km
  useEffect(() => {
    let cancelled = false
    const pts = [
      ...(trip.startLocationCoords ? [trip.startLocationCoords] : []),
      ...trip.days.flatMap(d => d.stops).filter(s => s.status !== 'rejected').map(s => ({ lat: s.lat, lng: s.lng })),
    ]
    if (pts.length < 2) { setRouteGeometry(null); setRouteTotalKm(null); return }
    routePath(pts, getAssumptions(trip))
      .then(legs => {
        if (cancelled) return
        setRouteGeometry(legs.flatMap(l => l.geometry))
        // Google's routingSummaries legs are origin→place and place→destination,
        // so the real detour per hit is (leg0 + leg1) − this total.
        setRouteTotalKm(legs.reduce((sum, l) => sum + l.distanceKm, 0))
      })
      .catch(() => { if (!cancelled) { setRouteGeometry(null); setRouteTotalKm(null) } })
    return () => { cancelled = true }
  }, [trip])

  const nearbyOpts: NearbyOpts = useMemo(() => ({
    includeFuel: trip.transportMode === 'car' || trip.transportMode === 'motorcycle',
    homeCenter: trip.startLocationCoords ?? null,
    // fill what the itinerary lacks, demote what it already covers
    categoryBias: computeCategoryBias(trip),
    // Google mode: bias the search along the real road polyline; free mode ignores it
    routeCoords: routeGeometry,
    routeTotalKm,
    travellers: trip.travellers,
    travelStyle: trip.travelStyle,
    speedKmph: MODE_SPEED[trip.transportMode] ?? 40,
    plannedStops: trip.days.flatMap(d => d.stops)
      .filter(s => s.status !== 'rejected' && Number.isFinite(s.lat) && Number.isFinite(s.lng))
      .map(s => ({ lat: s.lat, lng: s.lng, name: s.title })),
    dayStartTimes: trip.days.map(d => d.startTime ?? '08:30'),
    dayRainPct: dayRainPct ?? undefined,
  }), [trip, routeGeometry, routeTotalKm, dayRainPct])

  useEffect(() => {
    if (anchors.length === 0) return
    const cached = suggestionCache.cache.map
    // Persisted results always win: returning to this tab, editing the trip, or
    // OSRM resolving after mount must NOT silently re-run the expensive corridor
    // search. Only ↻ Refresh, a detour-scope change, or an empty cache does.
    if (cached && cached.scopeKm === scopeKm) {
      setPois(cached.segments)
      return
    }
    let cancelled = false
    setLoadingPois(true)
    const hash = anchorHash(anchors)
    planJourneyHalts(anchors, planKm, wholeTrip.min, { ...nearbyOpts, multiDay: trip.days.length > 1 }, scopeKm * 1000)
      .then(plan => {
        if (!cancelled) {
          setPois(plan)
          // Never cache an empty plan: the first search can run before the
          // route resolves, and a persisted [] would stick until Refresh.
          if (plan.length > 0) suggestionCache.setMapCache(plan, hash, scopeKm)
        }
      })
      .catch(() => { /* suggestions are best-effort */ })
      .finally(() => { if (!cancelled) setLoadingPois(false) })
    return () => { cancelled = true }
  }, [anchors, nearbyOpts, scopeKm, planKm, wholeTrip.min, trip.days.length, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  function addPoiToDay(hit: PlaceHit, dayIndex: number) {
    applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIndex)!
      day.stops.push({
        id: 'pending_' + Math.random().toString(36).slice(2),
        title: hit.name,
        category: (hit.category as ItineraryStop['category']) ?? 'sightseeing',
        locationName: hit.description ?? hit.name,
        lat: hit.latitude,
        lng: hit.longitude,
        description: hit.description ?? '',
        notes: hit.haltPurpose ? 'Added from the ride plan' : 'Added from nearby suggestions',
        visitMinutes: poiVisitMinutes(hit.category),
        // reported hours arrive on Google suggestion hits; free hits stay blank
        openTime: hit.openTime ?? '', closeTime: hit.closeTime ?? '',
        entryFeeInrPerPerson: 0,
        transportCostInrTotal: 0,
        priority: 'nice-to-have',
        sourceUrl: '',
        status: 'suggested',
        orderInDay: day.stops.length + 1,
      } as unknown as ItineraryStop)
    }, 'add', dayIndex)
    setAddedIds(prev => new Set(prev).add(hit.id as string))
    toast(`“${hit.name}” added to Day ${dayIndex + 1}`)
  }

  function openAddModal(hit: PlaceHit) {
    setPickDay(dayForKm(hit.cumKm))
    setPoiDraft({ hit })
  }

  const dayOptions = trip.days.map(d => ({ index: d.index }))

  // Split corridor suggestions into two curated columns: need-based halts
  // (fuel/food/rest/stretch/overnight/stay) on the LEFT in teal-amber, and
  // see-&-do / sightseeing + detours on the RIGHT in scenic purple — so the
  // map tab needs no scrolling to reach either kind (§6.10 CTI tone coding).
  const NEED_PURPOSES = new Set(['fuel', 'meal', 'food', 'rest', 'stretch', 'overnight', 'stay'])
  const needs = pois.filter(sh => sh.segment && NEED_PURPOSES.has(sh.segment.purpose))
  const seeAndDo = pois.filter(sh => sh.segment && !NEED_PURPOSES.has(sh.segment.purpose))

  /** One corridor-suggestion row (gap or hit). Shared by both split columns. */
  function renderPoi(sh: SegmentHit) {
    const hit = sh.hit
    if (!hit) {
      return (
        <div key={`gap-${sh.segment.index}`} className="poi-plan-row poi-plan-gap">
          <span className={`ride-purpose ride-purpose-${sh.segment.purpose} ride-purpose-muted`}>{sh.segment.label}</span>
          <span className="muted small">no good match around ~{sh.segment.targetKm.toFixed(0)} km — add a stop on the Timeline and it will pin itself here.</span>
        </div>
      )
    }
    const added = addedIds.has(hit.id as string) || existingNames.has(hit.name.toLowerCase())
    const offRoute = detourKm(hit, anchors)
    return (
      <div key={hit.id} className="poi-plan-row">
        <div className="ride-spot-title">
          <span className={`ride-purpose ride-purpose-${sh.segment.purpose}`}>{sh.segment.label}</span>
          {hit.thumb && <img className="poi-thumb" src={smallThumb(hit.thumb)} alt="" loading="lazy" />}
          <b>{hit.name}</b>
        </div>
        <div className="poi-desc small muted">
          ~{hit.cumKm ?? sh.segment.targetKm.toFixed(0)} km into the trip{sh.segment.purpose === 'sight' ? '' : ` · ≈${sh.segment.kmFromPrev.toFixed(0)} km / ${minutesToHM(sh.segment.minutesFromPrev)} since the last stop`}
        </div>
        <div className="poi-desc small">Why: {reasonForSegmentHit(sh, offRoute)}</div>
        {sh.segment.roadWarning && (
          <div className="poi-desc small">⚠ {sh.segment.roadWarning}</div>
        )}
        {hit.description && <div className="poi-desc small muted">{hit.description}</div>}
        {(hit.openTime || hit.closeTime) && (
          <div className="poi-desc small muted"><MetaIcon icon={ Clock } tone="time" />{formatHMRange(hit.openTime, hit.closeTime, timeFormat)} (reported)</div>
        )}
        <div>
          {editable && (
            added
              ? <span className="chip chip-teal"><CircleCheck size={11} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />Added</span>
              : <button className="btn btn-primary btn-sm" onClick={() => openAddModal(hit)}>+ Add</button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="card">
        <div className="row-between">
          <h3 style={{ margin: 0 }}><Lightbulb size={16} aria-hidden style={{ verticalAlign: '-3px', marginRight: 4 }} />Nearby ideas</h3>
          <div className="row-between" style={{ gap: 10 }}>
            <span className="small muted">{loadingPois ? 'searching…' : `${pois.filter(p => p.hit).length} suggested stops — spaced for fatigue & anchored on cities`}</span>
            <button
              className="btn btn-outline btn-sm suggestion-refresh-btn"
              title="Refresh suggestions"
              onClick={() => { suggestionCache.clearMap(); setRefreshTick(t => t + 1) }}
              disabled={loadingPois}
            >
              <RotateCcw size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />Refresh
            </button>
          </div>
        </div>
        <p className="hint-text" style={{ margin: '4px 0 6px' }}>
          Live data from {googleEnabled() ? 'Google Places' : 'OpenStreetMap, Wikipedia & Mappls'}: lunch ~ every 300 km, stretch & fuel breaks in between, and for long trips an overnight stop in a key city at the end of each day’s drive. Never around your starting point.
        </p>
        <div className="row-between" style={{ gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
          <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 230 }}>
            <span className="muted" style={{ whiteSpace: 'nowrap' }}>Detour scope</span>
            <input
              type="range"
              min={0}
              max={SCOPE_KM_STEPS.length - 1}
              step={1}
              value={scopeIdx}
              onChange={e => changeScope(Number(e.target.value))}
              style={{ flex: 1 }}
              aria-label="How far from the route to search suggestions"
            />
            <b style={{ whiteSpace: 'nowrap', minWidth: 46, textAlign: 'right' }}>{scopeKm} km</b>
          </label>
        </div>
        {!loadingPois && pois.length === 0 && (
          <p className="muted small">Not enough driving distance yet for a fatigue plan — add a longer route (90+ km) in the Timeline and segmented stop suggestions will appear here.</p>
        )}
      </div>
      <div className="map-ideas-grid">
        <div className="poi-col poi-col--needs">
            <div className="poi-col-head">
              <span className="poi-col-head-ico"><Fuel size={13} aria-hidden /></span>
              <div>
                <b>Need-based halts</b>
                <span className="small muted">fuel · food · rest · stretch · overnight</span>
              </div>
            </div>
            <div className="poi-plan-list">
              {needs.length === 0
                ? <p className="muted small">No need-based halts surfaced yet — they appear as you add driving days.</p>
                : needs.map(renderPoi)}
            </div>
          </div>
          <div className="map-ideas-map">
            <TripMap trip={trip} nearbyPois={pois.flatMap(p => p.hit ? [p.hit] : [])} onAddNearby={editable ? (hit) => openAddModal(hit) : undefined} />
          </div>
          <div className="poi-col poi-col--see">
            <div className="poi-col-head">
              <span className="poi-col-head-ico"><MapPin size={13} aria-hidden /></span>
              <div>
                <b>See &amp; do</b>
                <span className="small muted">sightseeing · detours · scenic stops</span>
              </div>
            </div>
            <div className="poi-plan-list">
              {seeAndDo.length === 0
                ? <p className="muted small">Sightseeing &amp; detour stops will appear here along the corridor.</p>
                : seeAndDo.map(renderPoi)}
            </div>
          </div>
      </div>
      {/* pick-a-day modal for adding a suggested POI — explicit confirm */}
      <Modal open={!!poiDraft} onClose={() => setPoiDraft(null)} title={`Add “${poiDraft?.hit.name ?? ''}”`}>
        {poiDraft && (
          <div>
            {poiDraft.hit.description && <p className="small muted" style={{ marginTop: 0 }}>{poiDraft.hit.description}</p>}
            <Field label="Add to which day?">
              <select
                className="select"
                value={pickDay}
                onChange={e => setPickDay(Number(e.target.value))}
              >
                {dayOptions.map(d => <option key={d.index} value={d.index}>Day {d.index + 1}</option>)}
              </select>
            </Field>
            <p className="hint-text">You can fine-tune duration, fees and timings in the Timeline afterwards.</p>
            <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 8 }}>
              <button className="btn btn-outline" onClick={() => setPoiDraft(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => { addPoiToDay(poiDraft.hit, pickDay); setPoiDraft(null) }}>
                Add to timeline
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
