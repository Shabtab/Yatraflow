// ============ Trip-scoped suggestion cache ============
// Persists suggestion results across tab switches in TripWorkspace.
// Hydration never refetches — only explicit user actions (↻ Refresh, the
// detour-scope slider, 📍 Suggest) re-run the expensive corridor searches.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SegmentHit, HaltPlanItem } from '../lib/ridePlan'
import type { PlaceHit } from '../lib/providers/hits'
import type { VehicleProfile } from '../data/types'

export interface SuggestionCache {
  map: { segments: SegmentHit[]; inputsHash: string; scopeKm: number; ts: number } | null
  /** fraction fallback pool cached under the same map TTL */
  fraction: { hits: PlaceHit[]; inputsHash: string; scopeKm: number; ts: number } | null
  /** per-day manual halt planner: the user's {km, minutes, purpose} list + best real spots */
  halts: Record<number, { segments: SegmentHit[]; plan: HaltPlanItem[]; inputsHash: string; ts: number }>
}

const CACHE_TTL_MS = 1000 * 60 * 60 * 4 // 4 hours
/**
 * Cache schema/provider version. Bumped with the 2026-09-07 Google-only
 * directive (Wikipedia/Mappls results must not survive the provider switch) —
 * a bump invalidates every previously persisted cache in one shot. Bumped
 * again the same day: Google hits now carry real categories (was: purpose
 * strings), so cached 'meal'/'fuel'/'overnight' categories are junk.
 *
 * Bumped to 5 on 2026-09-25 (#331): the map plan hash now also covers day
 * start/weather inputs, accepted halt pins, DNA preferences and speed, and the
 * light fraction pool shares the same TTL. The shape bump evicts old entries.
 *
 * Bumped to 6 on 2026-09-27 (#346): the halt-plan cache carries `pin` per
 * item (the user's "use the real spot" tick used to be session-only), so old
 * payloads evict rather than hydrate into the new shape.
 *
 * Bumped to 7 on 2026-09-29 (#414): halt entries carry `inputsHash` — the
 * planInputsHash the entry was authored against. A halt plan tuned for a
 * 3-day bus trip used to be served verbatim against a 4-day private car,
 * because nothing recorded what the km points meant. Un-stamped v6 payloads
 * evict with the version bump rather than hydrating as "always fresh".
 */
const CACHE_VERSION = 7

/**
 * Build the cache key from every input the corridor search reads. Kept here
 * as a pure function so the same signature is computed the same way whether
 * the Map tab is checking freshness, persisting, or tests are pinning the
 * shape. Order matters — the join is the hash.
 */
export function planInputsHash(input: {
  anchorsHash: string
  routeHash: string
  travelStyle: string
  transportMode: string
  scopeKm: number
  travellers: number
  driverCount?: number | undefined
  hasVulnerable?: boolean | undefined
  driveAfterDinnerMin?: number | undefined
  dayStartTimes?: string[]
  dayRainPct?: (number | null)[] | null | undefined
  dayWeatherCode?: (number | null)[] | null | undefined
  haltPins?: Record<number, number> | null | undefined
  dnaVector?: unknown
  speedKmph?: number
  budgetPerPersonInr: number
  fuelEconomyKmL?: number | undefined
  fuelPricePerL?: number | undefined
  roundTrip?: boolean | undefined
  vehicleProfile?: VehicleProfile | undefined
}): string {
  return [
    input.anchorsHash,
    input.routeHash,
    input.travelStyle,
    input.transportMode,
    input.scopeKm,
    input.travellers,
    input.driverCount ?? '-',
    input.hasVulnerable === true ? '1' : '-',
    input.driveAfterDinnerMin ?? '-',
    input.budgetPerPersonInr,
    (input.dayStartTimes ?? []).join(','),
    input.dayRainPct ? input.dayRainPct.map(v => v ?? '-').join(',') : '-',
    input.dayWeatherCode ? input.dayWeatherCode.map(v => v ?? '-').join(',') : '-',
    input.haltPins ? JSON.stringify(Object.entries(input.haltPins).sort(([a], [b]) => Number(a) - Number(b))) : '-',
    input.dnaVector ? JSON.stringify(input.dnaVector) : '-',
    input.speedKmph,
    input.fuelEconomyKmL ?? '-',
    input.fuelPricePerL ?? '-',
    input.roundTrip === true ? 'rt' : input.roundTrip === false ? 'ow' : '-',
    input.vehicleProfile ? JSON.stringify(input.vehicleProfile) : '-',
  ].join('|')
}

/**
 * A cached map plan is reusable only when scope, the input hash, and the
 * route/ scope inputs match — not when the user just changed the crew, fuel
 * price or vehicle profile (v3 used to silently serve the old plan).
 */
export function isMapCacheFresh(
  cached: { scopeKm: number; inputsHash: string } | null,
  scopeKm: number,
  inputsHash: string,
): boolean {
  return !!cached && cached.scopeKm === scopeKm && cached.inputsHash === inputsHash
}

function cacheKey(tripId: string) {
  return `yatraflow_suggestions_v${CACHE_VERSION}_${tripId}`
}

/**
 * A cached halt plan is reusable only when it was authored against the same
 * plan inputs the ride reads now (#414). The stamp is the SAME
 * `planInputsHash` the Map freshness gate uses — one hash, never two.
 */
export function isHaltCacheFresh(
  cached: { inputsHash: string } | null,
  inputsHash: string,
): boolean {
  return !!cached && cached.inputsHash === inputsHash
}

/**
 * Drop halt keys that name a day index the trip no longer has (#414). Keys
 * are POSITIONAL day indexes, so a shortened grid leaves tail keys pointing
 * at days that were never re-used — the old zombie behaviour served Day 4's
 * halts on Day 2. The hook owns the keys, so this runs on every shrink path
 * by construction (settings save, a direct reconcile caller, a reload).
 */
export function pruneHaltKeys(
  halts: SuggestionCache['halts'] | undefined,
  dayCount: number,
): SuggestionCache['halts'] {
  if (!halts) return {}
  const next: SuggestionCache['halts'] = {}
  for (const [k, v] of Object.entries(halts)) {
    if (Number(k) < dayCount) next[Number(k)] = v
  }
  return next
}

function load(tripId: string, dayCount: number): SuggestionCache {
  try {
    const raw = localStorage.getItem(cacheKey(tripId))
    if (!raw) return { map: null, fraction: null, halts: {} }
    const parsed = JSON.parse(raw) as Partial<SuggestionCache>
    const now = Date.now()
    // evict stale entries on load
    const halts: SuggestionCache['halts'] = {}
    for (const [k, v] of Object.entries(parsed.halts ?? {})) {
      if (now - v.ts < CACHE_TTL_MS) halts[Number(k)] = v
    }
    const map = parsed.map && (now - parsed.map.ts < CACHE_TTL_MS) ? parsed.map : null
    const fraction = parsed.fraction && (now - parsed.fraction.ts < CACHE_TTL_MS) ? parsed.fraction : null
    return { map, fraction, halts: pruneHaltKeys(halts, dayCount) }
  } catch {
    return { map: null, fraction: null, halts: {} }
  }
}

function save(tripId: string, cache: SuggestionCache) {
  try {
    localStorage.setItem(cacheKey(tripId), JSON.stringify(cache))
  } catch { /* quota or private mode — silently drop */ }
}

export function useSuggestionCache(tripId: string, dayCount: number) {
  const [cache, setCache] = useState<SuggestionCache>(() => load(tripId, dayCount))

  // #414: any shrink of the day grid (settings save, a direct reconcile
  // caller, a remote edit) prunes the tail keys here — one eviction point the
  // hook owns, rather than a prune sprinkled at every caller, so no new
  // caller can reintroduce zombie days.
  useEffect(() => {
    setCache(prev => {
      const halts = pruneHaltKeys(prev.halts, dayCount)
      if (Object.keys(halts).length === Object.keys(prev.halts).length) return prev
      const next: SuggestionCache = { ...prev, halts }
      save(tripId, next)
      return next
    })
  }, [tripId, dayCount])

  const setMapCache = useCallback((segments: SegmentHit[], inputsHash: string, scopeKm: number) => {
    setCache(prev => {
      const next: SuggestionCache = {
        ...prev,
        map: { segments, inputsHash, scopeKm, ts: Date.now() },
      }
      save(tripId, next)
      return next
    })
  }, [tripId])

  const setHaltCache = useCallback((dayIndex: number, segments: SegmentHit[], plan: HaltPlanItem[], inputsHash: string) => {
    setCache(prev => {
      const next: SuggestionCache = {
        ...prev,
        halts: { ...prev.halts, [dayIndex]: { segments, plan, inputsHash, ts: Date.now() } },
      }
      save(tripId, next)
      return next
    })
  }, [tripId])

  const setFractionCache = useCallback((hits: PlaceHit[], inputsHash: string, scopeKm: number) => {
    setCache(prev => {
      const next: SuggestionCache = { ...prev, fraction: { hits, inputsHash, scopeKm, ts: Date.now() } }
      save(tripId, next)
      return next
    })
  }, [tripId])

  const clearMap = useCallback(() => {
    setCache(prev => {
      const next: SuggestionCache = { ...prev, map: null, fraction: null }
      save(tripId, next)
      return next
    })
  }, [tripId])

  // Memoized so consumers (TimelineTab → memoized DaySection, MapTab) can take
  // this object as a prop without re-rendering on every parent render — the
  // reference only changes when the cache contents (or tripId) actually do.
  return useMemo(() => ({ cache, setMapCache, setFractionCache, setHaltCache, clearMap }),
    [cache, setMapCache, setFractionCache, setHaltCache, clearMap])
}
