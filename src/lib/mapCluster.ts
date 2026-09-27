/**
 * #417 — which suggestion pins the map may group, and which keep a marker.
 *
 * The Map tab drew every corridor idea as its own DOM marker, so an overview zoom
 * of a long route stacked dozens of ~30px pins into an unreadable pile. MapLibre's
 * own clustering (the vendored `MapClusterLayer`) now draws those piles as count
 * badges, and this module owns the membership rules — because they are product
 * rules, not rendering ones:
 *
 *  - a pin the user is working with stays individually addressable. The rail's
 *    highlighted suggestion and a current search result are never handed to the
 *    clusterer: a GL badge has no DOM node, so grouping them would cost the
 *    tooltip, the `role="button"` and the Enter/Space handling they have;
 *  - a pin that cannot be placed is not a candidate at all — the same `hasCoords`
 *    rule the rails already use, so this is one definition rather than a second;
 *  - the geometry is MapLibre's. Supercluster decides what falls inside
 *    `clusterRadius` at the current zoom, so nothing here re-implements it.
 */
import type * as GeoJSON from 'geojson'
import type { PlaceHit } from './geocode'
import { hasCoords } from './providers/hits'

export type ClusterCandidate = {
  id: string
  lng: number
  lat: number
  /** Never handed to the clusterer — the map must keep it individually addressable. */
  exempt: boolean
}

export type ClusterExemptions = {
  /** the suggestion the rail currently highlights */
  activeId?: string | number | null
  /** the ids of the current text search's hits */
  searchIds?: ReadonlySet<string | number> | null
}

export type ClusterSplit = {
  /** handed to the clusterer and currently inside a badge */
  clustered: ClusterCandidate[]
  /** keeps its own DOM marker: exempt, or not grouped at this zoom */
  individual: ClusterCandidate[]
}

export type ClusterPointProperties = { id: string }

/**
 * The suggestions eligible for grouping, in the order given.
 *
 * Ids are compared as strings: a hit's id is a number for one provider and a
 * string for another, and the rail's active id arrives from whichever list
 * raised it, so `12` and `'12'` must mean the same place.
 */
export function clusterCandidates(
  hits: readonly PlaceHit[],
  { activeId = null, searchIds = null }: ClusterExemptions = {},
): ClusterCandidate[] {
  const active = activeId == null ? null : String(activeId)
  const search = searchIds ? new Set([...searchIds].map(String)) : null
  const out: ClusterCandidate[] = []
  for (const h of hits) {
    if (!hasCoords(h)) continue
    const id = String(h.id)
    out.push({
      id,
      lng: h.longitude,
      lat: h.latitude,
      exempt: search?.has(id) === true || (active != null && active === id),
    })
  }
  return out
}

/**
 * The GeoJSON the cluster layer may group. Exempt pins are left out entirely —
 * MapLibre clusters every point it is given, so "keep this one out of the pile"
 * can only be said by not handing it over.
 */
export function clusterFeatureCollection(
  candidates: readonly ClusterCandidate[],
): GeoJSON.FeatureCollection<GeoJSON.Point, ClusterPointProperties> {
  return {
    type: 'FeatureCollection',
    features: candidates
      .filter(c => !c.exempt)
      .map(c => ({
        type: 'Feature' as const,
        id: c.id,
        properties: { id: c.id },
        geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] as [number, number] },
      })),
  }
}

/** Split by what the map reported: `clusteredIds` are the pins now inside a badge. */
export function splitByCluster(
  candidates: readonly ClusterCandidate[],
  clusteredIds: ReadonlySet<string>,
): ClusterSplit {
  const clustered: ClusterCandidate[] = []
  const individual: ClusterCandidate[] = []
  for (const c of candidates) {
    if (!c.exempt && clusteredIds.has(c.id)) clustered.push(c)
    else individual.push(c)
  }
  return { clustered, individual }
}

/** "3 suggestions" / "1 suggestion" — one place, so the key and the status line
 *  can never disagree about the noun. */
export function clusterCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'suggestion' : 'suggestions'}`
}

/**
 * The one sentence a pointer-free reader gets: a GL badge has no DOM node, so
 * without it the grouped pins simply vanish from the page for them. Null when
 * nothing is grouped — no grouping, no line.
 */
export function clusterSummary(groupedCount: number): string | null {
  if (!Number.isFinite(groupedCount) || groupedCount <= 0) return null
  return `${clusterCountLabel(groupedCount)} grouped into map clusters at this zoom — zoom in to open them one by one.`
}
