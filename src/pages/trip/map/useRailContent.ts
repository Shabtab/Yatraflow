// #420 slice 13: the rail content — split, engine, costs, pool, arcs.
//
// The needs/sights split, the live filter, the per-hit engine map, the popup
// cost lines, the alternative pool, the story arcs and the slot pins move
// together. All of them are data: plain filters and memos over the corridor
// plan. The hook returns values only, never callbacks. Render-called helpers
// (`detourMinFor`, `chipsFor`, the row renderers) stay with the page — a later
// slice moves them with the rails they serve.
import { useMemo } from 'react'
import type { Trip, ItineraryDay } from '../../../data/types'
import { MODE_SPEED } from '../../../lib/engine'
import type { PlaceHit, SegmentHit } from '../../../lib/geocode'
import { asymmetricDetourMinutes, detourKm } from '../../../lib/providers/hits'
import { NEED_PURPOSES } from './pageHelpers'
import { hitCostLabels } from './railLabels'
import { dayDetourBudgetMin } from '../../../lib/detourBudget'
import { isAlreadyAdded, type PlaceIdentity } from '../../../lib/placeIdentity'
import { clusterStoryArcs } from '../../../lib/storyArcs'
import type { LatLng } from './weatherGeometry'

export type RailContentArgs = {
  pois: SegmentHit[]
  anchors: { lat: number; lng: number }[]
  routePolyline: LatLng[] | null
  transportMode: Trip['transportMode']
  travelStyle: Trip['travelStyle']
  days: ItineraryDay[]
  dayForKm: (km: number | null | undefined) => number | null
  identity: PlaceIdentity
}

export function useRailContent({
  pois, anchors, routePolyline, transportMode, travelStyle, days, dayForKm,
  identity,
}: RailContentArgs) {
  // Split corridor suggestions into two curated columns: need-based halts
  // (fuel/food/rest/stretch/overnight/stay) on the LEFT in teal-amber, and
  // see-&-do / sightseeing + detours on the RIGHT in scenic purple — so the
  // map tab needs no scrolling to reach either kind (§6.10 CTI tone coding).
  const needs = pois.filter(sh => sh.segment && NEED_PURPOSES.has(sh.segment.purpose))
  const seeAndDo = pois.filter(sh => sh.segment && !NEED_PURPOSES.has(sh.segment.purpose))
  // Rail derivations for the V2 pass: one chip filter narrows both rails, and the
  // ruler marks reuse each card's own cumulative km so a dot never disagrees with
  // #178: per-hit engine math in ONE memo keyed by hit id. Every card's
  // detour minutes used to re-run the anchor-list projection per card per
  // render — a shortlist toggle or keystroke re-did hundreds of walks. Chips,
  // the budget walk, whiskers and vote contexts all read this map now.
  const hitEngine = useMemo(() => {
    const speedK = MODE_SPEED[transportMode] ?? 40
    const m = new Map<string, { detourMin: number | null }>()
    for (const sh of pois) {
      if (!sh.hit) continue
      m.set(String(sh.hit.id), { detourMin: asymmetricDetourMinutes(sh.hit, anchors, routePolyline ?? null, speedK) })
    }
    return m
  }, [pois, anchors, routePolyline, transportMode])
  /** P5.2: the cost line a suggestion's map popup shows - arrive, detour and
   *  the day's detour-budget share, from numbers the corridor already computed.
   *  The budget is the hit's OWN day's, the same one `chipsFor` and the rail
   *  read: charging every hit against Day 1's stop count made the popup and the
   *  card disagree about the same place. */
  const hitCosts = useMemo(() => hitCostLabels({
    // #420 slice 4: the label assembly (and the per-day budget cache) lives in
    // ./map/railLabels with its tests; this only supplies the trip-aware inputs.
    hits: pois.flatMap(sh => (sh.hit ? [{
      id: String(sh.hit.id),
      cumKm: sh.hit.cumKm,
      detourMin: hitEngine.get(String(sh.hit.id))?.detourMin ?? null,
      etaMinutes: sh.segment.etaMinutes,
    }] : [])),
    dayForKm,
    detourBudgetMin: dayIndex => dayDetourBudgetMin({
      travelStyle,
      plannedStops: (days.find(d => d.index === dayIndex)?.stops ?? []).filter(x => x.status !== 'rejected').length,
    }),
  }), [pois, hitEngine, travelStyle, days, dayForKm])
  // the number printed on its card.
  // A resolved group vote lands its winner on the timeline; those stops then
  // drop out of the see-&-do rail entirely (count included), same as the
  // “Added” state does for need halts. Name-match matches the rail's dedupe.
  const voteResolvedOut = (sh: { hit?: PlaceHit | null }) =>
    !!sh.hit && isAlreadyAdded(sh.hit, identity)
  const seeAndDoLive = seeAndDo.filter(sh => !voteResolvedOut(sh))
  // Story arcs: themed bundles from live, not-yet-added sights. Memoised so
  // the clustering pass (#166) only re-runs when membership actually changes.
  const arcHits = useMemo(() => seeAndDoLive.flatMap(sh => {
    const h = sh.hit
    // #345: arcs advertise "live, not-yet-added sights" — so they read the
    // SAME predicate as the rails. They used to skip the trip-presence half
    // and push places you already own.
    if (!h || isAlreadyAdded(h, identity)) return []
    return [h]
  }), [seeAndDoLive, identity])
  // #166: clustering walks the whole sight pool per render — memo it so a
  // search keystroke or shortlist toggle doesn't re-cluster 200 sights. The
  // labels are pre-split once here too (title/body were parsed twice per arc
  // per render in JSX).
  const arcs = useMemo(() => clusterStoryArcs(arcHits).map(a => {
    const sep = a.label.indexOf(':')
    return { ...a, theme: sep >= 0 ? a.label.slice(0, sep) : a.label, arcBody: sep >= 0 ? a.label.slice(sep + 1).trim() : '' }
  }), [arcHits])

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
      if (isAlreadyAdded(h, identity)) continue
      const e: AltEntry = { h, dKm: detourKm(h, anchors) }
      all.push(e)
      if (h.haltPurpose) push(byPurpose, h.haltPurpose, e)
      if (h.category) push(byCategory, h.category, e)
    }
    return { all, byPurpose, byCategory }
  }, [pois, identity, anchors])

  return { needs, seeAndDoLive, hitEngine, hitCosts, altPool, arcHits, arcs }
}
