// ============ Map view modes (2D · Terrain · 3D hero) ============
// Pure logic + MapLibre layer/source specs for the three map view modes —
// the imperative application lives in TripMap; everything testable in node
// lives here. Spec: docs/FEATURE-REQUEST-MAP-VIEWS.md.
import type { HillshadeLayerSpecification, RasterDEMSourceSpecification } from 'maplibre-gl'

export type MapViewMode = '2d' | 'terrain' | '3d'

export const MAP_VIEW_MODES: readonly MapViewMode[] = ['2d', 'terrain', '3d'] as const

/** Short toolbar label + the long form screen readers announce. */
export const MAP_VIEW_MODE_META: Record<MapViewMode, { label: string; aria: string }> = {
  '2d': { label: '2D', aria: 'Flat map' },
  terrain: { label: 'Terrain', aria: 'Terrain relief' },
  '3d': { label: '3D', aria: '3D terrain' },
}

/** Missing or corrupt storage degrades to the flat map, never throws. */
export function parseMapViewMode(raw: string | null | undefined): MapViewMode {
  return raw === 'terrain' || raw === '3d' ? raw : '2d'
}

export const YF_DEM_SOURCE_ID = 'yf-dem'
export const YF_HILLSHADE_LAYER_ID = 'yf-hillshade'

// Keyless, CORS-enabled AWS elevation tiles (terrarium encoding — MapLibre
// reads it natively, no custom decoder). The source ships its own attribution
// so the credit only renders while a terrain mode has it on the map (§2.5).
export const TERRARIUM_DEM_SOURCE: RasterDEMSourceSpecification = {
  type: 'raster-dem',
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium',
  tileSize: 256,
  maxzoom: 14,
  attribution: 'Terrain: AWS Terrain Tiles / ETOPO1',
}

// Prototype panel 6's paint — teal-family shadow/accent so the relief reads
// with the brand palette on both Liberty and the dark style.
export const HILLSHADE_LAYER: HillshadeLayerSpecification = {
  id: YF_HILLSHADE_LAYER_ID,
  type: 'hillshade',
  source: YF_DEM_SOURCE_ID,
  paint: {
    'hillshade-exaggeration': 0.6,
    'hillshade-shadow-color': '#3E5560',
    'hillshade-highlight-color': '#FFFFFF',
    'hillshade-accent-color': '#3D6B70',
  },
}

/** The shading must stop above water — `water` and every `waterway*` variant. */
export function isWaterishLayerId(id: string): boolean {
  return id === 'water' || id.startsWith('waterway')
}

/**
 * First water-ish layer of the loaded style — the hillshade's insertion point.
 * The order differs per style and is the trap: positron has `water` early, but
 * Liberty's `waterway_*` lines (idx 14–16) sit ABOVE `water` (idx 17), so
 * matching `water` alone would insert under the river lines and bury them.
 * Returns null when the style has no water at all (caller must not pass a
 * non-existent beforeId — MapLibre throws).
 */
export function resolveHillshadeBeforeId(layers: readonly { id?: string }[] | undefined): string | null {
  if (!layers) return null
  for (const layer of layers) {
    if (layer.id && isWaterishLayerId(layer.id)) return layer.id
  }
  return null
}

/** 3D hero camera (prototype panel 7). The BEARING is a fallback only — the
 *  camera frames the trip's own road via heroBearingForRoute, so every trip
 *  gets its own hero shot instead of the mockup's fixed ghat climb. */
export const HERO_3D_CAMERA = { pitch: 70, bearing: 235 }
export const HERO_3D_EXAGGERATION = 1.8

/**
 * Initial compass bearing (degrees, 0–360) of the trip's road — the first
 * segment long enough to be a real direction, not coordinate jitter. The 3D
 * hero camera looks ALONG the road the way the driver will, wherever the trip
 * runs. Null (no usable geometry) → the caller keeps the prototype fallback.
 */
export function heroBearingForRoute(coords: { lat: number; lng: number }[] | undefined): number | null {
  if (!coords || coords.length < 2) return null
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]
    const b = coords[i]
    if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) continue
    const dLat = b.lat - a.lat
    const dLng = b.lng - a.lng
    if (Math.abs(dLat) + Math.abs(dLng) < 0.02) continue // < ~2 km of drift
    const rad = Math.PI / 180
    const y = Math.sin(dLng * rad) * Math.cos(b.lat * rad)
    const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
      Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dLng * rad)
    return (Math.atan2(y, x) / rad + 360) % 360
  }
  return null
}

/**
 * The slice of the MapLibre map the mode applier touches — structural typing
 * so node tests can drive it with a fake (and TripMap never imports
 * maplibre-gl directly, matching its other layers).
 */
export interface MapLike {
  getStyle(): { layers?: { id?: string }[] } | undefined
  getSource(id: string): unknown
  addSource(id: string, source: unknown): void
  removeSource(id: string): void
  getLayer(id: string): unknown
  addLayer(layer: unknown, beforeId?: string): void
  removeLayer(id: string): void
  getTerrain(): unknown
  setTerrain(terrain: unknown): void
}

/**
 * Reconcile the map's terrain stack to the mode. Idempotent — the caller
 * re-runs it after every style swap (a theme flip wipes sources, layers AND
 * terrain), so every step guards on current state. The DEM source exists only
 * while a terrain mode is active, which is what keeps its attribution credit
 * out of a 2D user's attribution bar (§2.5).
 */
export function applyViewModeOnMap(map: MapLike, mode: MapViewMode): void {
  if (mode === '2d') {
    if (map.getTerrain()) map.setTerrain(null)
    if (map.getLayer(YF_HILLSHADE_LAYER_ID)) map.removeLayer(YF_HILLSHADE_LAYER_ID)
    if (map.getSource(YF_DEM_SOURCE_ID)) map.removeSource(YF_DEM_SOURCE_ID)
    return
  }
  if (!map.getSource(YF_DEM_SOURCE_ID)) map.addSource(YF_DEM_SOURCE_ID, TERRARIUM_DEM_SOURCE)
  if (mode === 'terrain') {
    if (map.getTerrain()) map.setTerrain(null)
    if (!map.getLayer(YF_HILLSHADE_LAYER_ID)) {
      const beforeId = resolveHillshadeBeforeId(map.getStyle()?.layers)
      // No water in the style at all: append instead of throwing on a
      // non-existent beforeId (the shading lands on top — acceptable, and
      // never hit on the OpenFreeMap styles, which all ship water).
      if (beforeId) map.addLayer(HILLSHADE_LAYER, beforeId)
      else map.addLayer(HILLSHADE_LAYER)
    }
    return
  }
  // 3D hero: real elevation through the camera, not a shading layer.
  if (map.getLayer(YF_HILLSHADE_LAYER_ID)) map.removeLayer(YF_HILLSHADE_LAYER_ID)
  map.setTerrain({ source: YF_DEM_SOURCE_ID, exaggeration: HERO_3D_EXAGGERATION })
}

/** The four things the hero camera can be asked to do — see `heroCameraMove`. */
export type HeroCameraMove = 'enter' | 're-aim' | 'flatten' | 'none'

/**
 * Decide what the hero camera does on this render, as a pure function so the
 * rule that matters is testable without a map instance (#332 R1).
 *
 * The bug this exists to prevent: the effect fired on the 2d→3d EDGE only, while
 * `heroBearing` derives from the drawn geometry — so entering 3D before OSRM
 * resolved left the camera at `HERO_3D_CAMERA`'s prototype bearing and it never
 * corrected when the real road arrived. Depending on the bearing VALUE (not on
 * every render) is what lets a late resolve re-aim without the camera grinding:
 *
 * - `enter`   — the 2d→3d edge: pitch AND the hero bearing.
 * - `re-aim`  — already in 3D and the bearing value changed: bearing ONLY, so the
 *               pitch the user is looking at does not jump under them.
 * - `flatten` — left 3D: pitch and bearing back to flat.
 * - `none`    — nothing changed; easing here is exactly the grind to avoid.
 *
 * `prevBearing` is the value last eased to (null before the first 3D entry), so
 * a geometry-less trip easing the fallback then receiving real geometry reads as
 * `re-aim` — which is the whole point.
 */
export function heroCameraMove(
  mode: MapViewMode,
  prevMode: MapViewMode,
  bearing: number | null | undefined,
  prevBearing: number | null,
): { move: HeroCameraMove; bearing: number } {
  const heroBearing = bearing ?? HERO_3D_CAMERA.bearing
  if (mode === '3d') {
    if (prevMode !== '3d') return { move: 'enter', bearing: heroBearing }
    return { move: prevBearing === heroBearing ? 'none' : 're-aim', bearing: heroBearing }
  }
  return { move: prevMode === '3d' ? 'flatten' : 'none', bearing: heroBearing }
}
