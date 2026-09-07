// ============ Trip workspace — Map tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
import React, { useEffect, useMemo, useState } from 'react'
import { CircleCheck, Clock, ExternalLink, Fuel, Lightbulb, MapPin, RotateCcw } from 'lucide-react'
import { MetaIcon } from '../../components/icons'
import type { Trip, ItineraryStop } from '../../data/types'
import type { ImpactResult } from '../../lib/impact'
import { routePath } from '../../lib/routing'
import { getAssumptions, buildJourney, minutesToHM, computeCategoryBias, MODE_SPEED } from '../../lib/engine'
import { useTimeFormat, formatHMRange } from '../../lib/timefmt'
import { Modal, Field, toast } from '../../components/ui'
import { useSuggestionCache, isMapCacheFresh } from '../../hooks/useSuggestionCache'
import { corridorAnchors, detourKm, detourMinutes, asymmetricDetourMinutes, googleEnabled, planJourneyHalts, reasonForSegmentHit, type NearbyOpts, routeHash } from '../../lib/geocode'
import { dayDetourBudgetMin, budgetSharePct, splitByDetourBudget } from '../../lib/detourBudget'
import { quotaUsed, SOFT_CAPS } from '../../lib/providers/quota'
import { buildDnaVectorAcrossTrips, loadDnaLog, recordDnaEvent, dnaNoteForHit, crewSeedsFromSuggestions, crewSeedsToPlannedStops, crewSeedEvents, crewNoteForHit } from '../../lib/tripDna'
import { clusterStoryArcs } from '../../lib/storyArcs'
import { visitMinutesForCategory } from '../../lib/slackPrompts'
import type { PlaceHit, SegmentHit } from '../../lib/geocode'
import { anchorHash } from '../../lib/providers/hits'
import { fetchDailyWeather, forecastAvailable, isoAddDays } from '../../lib/weather'
// MapLibre is heavy (~1MB) — load it only when the Map tab is actually opened.
const TripMap = React.lazy(() => import('../../components/TripMap').then(m => ({ default: m.TripMap })))

/**
 * Purposes that are finite by construction — their halts are needs, not sights.
 * Module scope: this is a constant, so it must not be rebuilt on every render.
 */
const NEED_PURPOSES = new Set(['fuel', 'meal', 'food', 'rest', 'stretch', 'overnight', 'stay'])

// ================= Map tab =================

/** Wikipedia thumbnail URLs are hotlink-friendly but huge; ask for a small one. */
function smallThumb(url: string): string {
  return url.replace(/\/(\d+)px-/, '/120px-')
}

function googleMapsUrl(hit: PlaceHit): string {
  // Real Place page when Google gave us a place_id (reviews, hours, directions)
  if (hit.placeId) return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(hit.placeId)}`
  // Free-stack hits have no place_id — Google's documented pin URL by coords
  // (hand-building /place/<name>/@lat,lng broke on encoded names)
  if (Number.isFinite(hit.latitude) && Number.isFinite(hit.longitude)) {
    return `https://www.google.com/maps/search/?api=1&query=${hit.latitude},${hit.longitude}`
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hit.name)}`
}

/** Detour-scope presets for nearby suggestions (km off the route). */
const SCOPE_KM_STEPS = [10, 20, 30, 50, 80, 100]
const SCOPE_STORAGE_KEY = 'yf_nearby_scope_km'

/** Sensible visit durations per suggestion category (tourist pacing). */
const poiVisitMinutes = visitMinutesForCategory

export function MapTab({ trip, editable, applyChange, suggestionCache, crewSuggestions }: {
  trip: Trip
  editable: boolean
  applyChange: (mutator: (d: Trip) => void, kind: ImpactResult['kind'], dayIndex: number) => void
  suggestionCache: ReturnType<typeof useSuggestionCache>
  crewSuggestions?: { status: string; title: string; category?: string; lat: number; lng: number }[]
}) {
  const [pois, setPois] = useState<SegmentHit[]>([])
  const timeFormat = useTimeFormat()
  const [loadingPois, setLoadingPois] = useState(false)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set())
  // dismissed suggestion ids — logged as DNA declines, hidden for the session
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  // DNA freshness: bumped on every accept/decline so scoring + notes re-read
  // the log instead of serving the memoised vector
  const [dnaTick, setDnaTick] = useState(0)
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

  // Route polyline in {lat,lng} form (from the OSRM route geometry) — feeds the
  // asymmetric detour measure so on-the-way hits cost ~0 and spurs pay round trip.
  const routePolyline = useMemo<{ lat: number; lng: number }[] | null>(() => {
    if (!routeGeometry) return null
    const pts = routeGeometry
      .filter(c => Number.isFinite(c[0]) && Number.isFinite(c[1]))
      .map(c => ({ lat: c[1], lng: c[0] }))
    return pts.length >= 2 ? pts : null
  }, [routeGeometry])

  // Crew seeds: open group-input ideas suppress near-duplicates and bias the
  // corridor toward crew-proposed kinds.
  const crewSeeds = useMemo(() => crewSeedsFromSuggestions(crewSuggestions ?? []), [crewSuggestions])

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
    // Trip DNA: EVERY trip on the device leans corridor ties toward kinds the
    // user keeps picking (cross-trip learning) — scoped per-trip would forget a
    // waterfall hire on a past journey.
    // dnaTick re-reads the log after every accept/decline on this tab.
    dnaVector: buildDnaVectorAcrossTrips(loadDnaLog(), crewSeedEvents(trip.id, crewSeeds)),
    plannedStops: [
      ...trip.days.flatMap(d => d.stops)
        .filter(s => s.status !== 'rejected' && Number.isFinite(s.lat) && Number.isFinite(s.lng))
        .map(s => ({ lat: s.lat, lng: s.lng, name: s.title })),
      // crew-proposed ideas suppress duplicate corridor suggestions near them
      ...crewSeedsToPlannedStops(crewSeeds),
    ],
    dayStartTimes: trip.days.map(d => d.startTime ?? '08:30'),
    dayRainPct: dayRainPct ?? undefined,
  }), [trip, routeGeometry, routeTotalKm, dayRainPct, crewSeeds, dnaTick])

  useEffect(() => {
    if (anchors.length === 0) return
    const cached = suggestionCache.cache.map
    const hash = anchorHash(anchors) + '|' + routeHash(routeGeometry)
    // Persisted results always win: returning to this tab, editing the trip, or
    // OSRM resolving after mount must NOT silently re-run the expensive corridor
    // search. Only ↻ Refresh, a detour-scope change, new anchors, or an empty
    // cache does.
    if (cached && isMapCacheFresh(cached, scopeKm, hash)) {
      setPois(cached.segments)
      return
    }
    let cancelled = false
    setLoadingPois(true)
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
  const needs = pois.filter(sh => sh.segment && NEED_PURPOSES.has(sh.segment.purpose))
  const seeAndDo = pois.filter(sh => sh.segment && !NEED_PURPOSES.has(sh.segment.purpose))
  // Detour-budget enforcement (Horizon 3.2's "finite, honest menu"): the
  // see-&-do list is the endless one — need halts are finite by construction,
  // so the budget gates only sights. Per day: walk the journey-ordered sight
  // hits, spend each one's detour minutes against that day's budget, and mark
  // whatever no longer fits as HELD BACK — counted and shown as a line, never
  // offered as an addable card.
  const budgetHeldIds = new Set<string>()
  let budgetHeldCount = 0
  {
    const speedK = MODE_SPEED[trip.transportMode] ?? 40
    const byDay = new Map<number, SegmentHit[]>()
    for (const sh of seeAndDo) {
      if (!sh.hit) continue
      const d = dayForKm(sh.hit.cumKm) ?? 0
      const list = byDay.get(d) ?? []
      list.push(sh)
      byDay.set(d, list)
    }
    for (const [d, rows] of byDay) {
      const budget = dayDetourBudgetMin({
        travelStyle: trip.travelStyle,
        plannedStops: (trip.days.find(x => x.index === d)?.stops ?? []).filter(s => s.status !== 'rejected').length,
      })
      const { deferred } = splitByDetourBudget(
        rows.map(sh => ({ sh, detourMin: asymmetricDetourMinutes(sh.hit!, anchors, routePolyline ?? null, speedK) })),
        budget,
      )
      for (const { sh } of deferred) {
        budgetHeldIds.add(sh.hit!.id as string)
        budgetHeldCount += 1
      }
    }
  }
  // Quota honesty (Google-only directive): when the textSearchPro soft cap is
  // hit, every Google-mode corridor scan returns [] — say why instead of
  // rendering an empty state that reads like "nothing around".
  const quotaOut = googleEnabled() && quotaUsed('textSearchPro') >= SOFT_CAPS.textSearchPro
  // Story arcs: themed bundles from live, not-yet-added sights.
  const arcHits = seeAndDo.flatMap(sh => {
    const h = sh.hit
    if (!h || addedIds.has(h.id as string) || dismissedIds.has(h.id as string)) return []
    return [h]
  })
  const arcs = clusterStoryArcs(arcHits)

  /**
   * "Also nearby" candidates, pre-grouped once per render instead of per row.
   * Detour distance is the expensive part (it walks the anchor list), so it is
   * computed once per hit here; rows only rank the already-filtered pool.
   */
  const altPool = useMemo(() => {
    type AltEntry = { h: PlaceHit; dKm: number | null }
    const all: AltEntry[] = []
    const byPurpose = new Map<string, AltEntry[]>()
    const byCategory = new Map<string, AltEntry[]>()
    const push = (map: Map<string, AltEntry[]>, key: string, e: AltEntry) => {
      const list = map.get(key)
      if (list) list.push(e)
      else map.set(key, [e])
    }
    for (const r of pois) {
      const h = r.hit
      if (!h) continue
      const id = h.id as string
      if (dismissedIds.has(id) || addedIds.has(id) || existingNames.has(h.name.toLowerCase())) continue
      const e: AltEntry = { h, dKm: detourKm(h, anchors) }
      all.push(e)
      if (h.haltPurpose) push(byPurpose, h.haltPurpose, e)
      if (h.category) push(byCategory, h.category, e)
    }
    return { all, byPurpose, byCategory }
  }, [pois, dismissedIds, addedIds, existingNames, anchors])

  /** One corridor-suggestion row (gap or hit). Shared by both split columns. */
  function renderPoi(sh: SegmentHit) {
    const hit = sh.hit
    // dismissed stays hidden for the session (logged as a DNA decline)
    if (hit && dismissedIds.has(hit.id as string)) return null
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
    const detourMin = asymmetricDetourMinutes(hit, anchors, routePolyline ?? null, MODE_SPEED[trip.transportMode] ?? 40)
    // per-day budget: the hit's own day sets the density, not the whole trip
    const hitDay = trip.days.find(d => d.index === dayForKm(hit.cumKm))
    const dayBudget = dayDetourBudgetMin({
      travelStyle: trip.travelStyle,
      plannedStops: (hitDay?.stops ?? []).filter(s => s.status !== 'rejected').length,
    })
    // Trip DNA is already built once per render in nearbyOpts (it reads and
    // parses the localStorage log) — never rebuild it per row.
    const dnaNote = (nearbyOpts.dnaVector ? dnaNoteForHit(hit, nearbyOpts.dnaVector) : null)
      ?? crewNoteForHit(hit, crewSeeds)
    // Over the day's detour budget: shown as a counted line, not an offer.
    if (budgetHeldIds.has(hit.id as string)) {
      return (
        <div key={hit.id} className="poi-plan-row poi-plan-gap">
          <span className={`ride-purpose ride-purpose-${sh.segment.purpose} ride-purpose-muted`}>{sh.segment.label}</span>
          <span className="muted small">{hit.name} — held back: its ≈{Math.round(detourMin)} min detour exceeds what&apos;s left of Day {(dayForKm(hit.cumKm) ?? 0) + 1}&apos;s detour budget. Add it from the map pin if it is worth it.</span>
        </div>
      )
    }
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
        {detourMin > 0.5 && (
          <div className="poi-desc small muted">
            uses ~{budgetSharePct(detourMin, dayBudget)}% of today&apos;s detour budget
            {detourMin > dayBudget ? ' — over budget, pick it only if it is worth it' : ''}
          </div>
        )}
        {dnaNote && (
          <div className="poi-desc small">♥ {dnaNote}</div>
        )}
        {/* Closest alternatives for this halt: next 2 by road position + detour */}
        {(() => {
          // keep same family: need halts prefer same purpose, sights accept any sight
          const family = NEED_PURPOSES.has(sh.segment.purpose)
            ? [...(altPool.byPurpose.get(sh.segment.purpose) ?? []), ...(altPool.byCategory.get(hit.category ?? '') ?? [])]
            : altPool.all
          const seen = new Set<string>()
          const alts = family
            .filter(e => {
              const id = e.h.id as string
              if (id === hit.id || seen.has(id)) return false
              seen.add(id)
              return true
            })
            .map(e => {
              const pos = e.h.cumKm ?? sh.segment.targetKm
              return { h: e.h, dKm: e.dKm, dist: Math.abs(pos - sh.segment.targetKm) + (e.dKm ?? 0) * 2 }
            })
            .sort((a, b) => a.dist - b.dist)
            .slice(0, 2)
          if (alts.length === 0) return null
          return (
            <div className="poi-desc small muted" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
              <span>Also nearby:</span>
              {alts.map(({ h, dKm }) => (
                <span key={h.id as string} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  <button className="chip chip-sm" onClick={() => openAddModal(h)} title={h.name} style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.name}{dKm != null ? ` · ${dKm.toFixed(1)} km off` : ''}
                  </button>
                </span>
              ))}
            </div>
          )
        })()}
        {hit.description && <div className="poi-desc small muted">{hit.description}</div>}
        {(hit.openTime || hit.closeTime) && (
          <div className="poi-desc small muted"><MetaIcon icon={ Clock } tone="time" />{formatHMRange(hit.openTime, hit.closeTime, timeFormat)} (reported)</div>
        )}
        <div>
          {editable && (
            added
              ? <span className="chip chip-teal"><CircleCheck size={11} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />Added</span>
              : <>
                  <button className="btn btn-primary btn-sm" onClick={() => openAddModal(hit)}>+ Add</button>
                  {' '}
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Not interested — hide this and teach the engine"
                    onClick={() => {
                      recordDnaEvent({ tripId: trip.id, action: 'decline', category: hit.category, detourMin })
                      suggestionCache.clearMap()
                      setDnaTick(t => t + 1)
                      // House rule: a cache clear must pair with a tick that is
                      // IN the fetch effect's dep array, or nothing refills it.
                      setRefreshTick(t => t + 1)
                      setDismissedIds(prev => new Set(prev).add(hit.id as string))
                    }}
                  >Not for us</button>
                  {' '}
                  <a href={googleMapsUrl(hit)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" title="Open in Google Maps">
                    <ExternalLink size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />Maps
                  </a>
                </>
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
              {arcs.slice(0, 2).map(arc => (
                <div key={arc.theme} className="poi-plan-row poi-plan-arc">
                  <div className="ride-spot-title">
                    <span className="ride-purpose ride-purpose-sight">{arc.label.split(':')[0]}</span>
                    <b>{arc.label.split(':').slice(1).join(':').trim()}</b>
                  </div>
                  <div>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => {
                        let n = 0
                        const toAdd: { hit: PlaceHit; dayIndex: number }[] = []
                        for (const id of arc.hitIds) {
                          const m = arcHits.find(h => (h.id as string) === (id as string))
                          if (!m || addedIds.has(m.id as string)) continue
                          recordDnaEvent({ tripId: trip.id, action: 'accept', category: m.category, detourMin: asymmetricDetourMinutes(m, anchors, routePolyline ?? null, MODE_SPEED[trip.transportMode] ?? 40), visitMin: visitMinutesForCategory(m.category) })
                          const mDay = dayForKm(m.cumKm)
                          toAdd.push({ hit: m, dayIndex: mDay })
                          n += 1
                        }
                        suggestionCache.clearMap()
                        // Batch apply all stops in a single change
                        if (n > 0) {
                          applyChange(draft => {
                            const byDay = new Map<number, { hit: PlaceHit }[]>()
                            for (const item of toAdd) {
                              const list = byDay.get(item.dayIndex) ?? []
                              list.push(item)
                              byDay.set(item.dayIndex, list)
                            }
                            for (const [dayIndex, items] of byDay) {
                              const day = draft.days.find(d => d.index === dayIndex)!
                              for (const { hit } of items) {
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
                                  openTime: hit.openTime ?? '', closeTime: hit.closeTime ?? '',
                                  entryFeeInrPerPerson: 0,
                                  transportCostInrTotal: 0,
                                  priority: 'nice-to-have',
                                  sourceUrl: '',
                                  status: 'suggested',
                                  orderInDay: day.stops.length + 1,
                                } as unknown as ItineraryStop)
                              }
                            }
                          }, 'add', toAdd[0].dayIndex)
                        }
                        setAddedIds(prev => {
                          const next = new Set(prev)
                          for (const id of arc.hitIds) next.add(id as string)
                          return next
                        })
                        toast(n > 0 ? `“${arc.label.split(':')[0]}” added (${n} stops)` : 'All of those are already added')
                      }}
                    >Add all ({arc.hitIds.length})</button>
                  </div>
                </div>
              ))}
              {quotaOut && (
                <p className="hint-text" role="status">⚠ Google search quota reached for this month — corridor suggestions are paused until the counter rolls over. Removing the key from settings serves the free stack instead.</p>
              )}
              {seeAndDo.length === 0
                ? <p className="muted small">Sightseeing &amp; detour stops will appear here along the corridor.</p>
                : seeAndDo.map(renderPoi)}
              {budgetHeldCount > 0 && (
                <p className="hint-text">{budgetHeldCount} idea{budgetHeldCount === 1 ? '' : 's'} held back — beyond the day&apos;s detour budget. Add fewer stops, or raise the scope, and the engine will offer them again.</p>
              )}
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
              <button className="btn btn-primary" onClick={() => { recordDnaEvent({ tripId: trip.id, action: 'accept', category: poiDraft.hit.category, detourMin: asymmetricDetourMinutes(poiDraft.hit, anchors, routePolyline ?? null, MODE_SPEED[trip.transportMode] ?? 40), visitMin: visitMinutesForCategory(poiDraft.hit.category) }); suggestionCache.clearMap(); setDnaTick(t => t + 1); addPoiToDay(poiDraft.hit, pickDay); setPoiDraft(null) }}>
                Add to timeline
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
