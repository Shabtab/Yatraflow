/**
 * #420, slice 2 — the shortlist feature as a hook.
 *
 * The rail collects places, the tray decides what happens to them, and this hook is
 * that whole feature: the collection, the shared "is it already mine?" filter, the
 * two writers, and the two guards that keep them from double-firing. It moved out of
 * `MapTab` verbatim — this is a refactor, so the bodies below are the same code with
 * their closures named through `ShortlistDeps` instead of being captured from a
 * 2,700-line component.
 *
 * Two things a reviewer should be able to check here and could not before:
 *
 *  - **what the feature needs.** `ShortlistDeps` is the complete list, so "which
 *    parts of the map page does the shortlist actually touch?" is a question with a
 *    written answer;
 *  - **that both writers compose before they write.** Each resolves every pick
 *    through `resolvePick` FIRST and refuses when nothing usable came back — the
 *    contract `tests/vote-path-composition.test.ts` guards by scanning this file.
 */
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { PlaceHit } from '../../../lib/geocode'
import { isAlreadyAdded, type PlaceIdentity } from '../../../lib/placeIdentity'
import type { Trip, ItineraryStop } from '../../../data/types'
import type { ImpactResult } from '../../../lib/impact'
import { toast } from '../../../components/ui'
import { addDecision } from '../../../store/store'
import { orderByRoad } from './roadOrder'

export type ShortlistDeps = {
  tripId: string
  /** the shared presence identity — one answer to "is this already mine?" */
  identity: PlaceIdentity
  /** the shared resolve-or-prompt guard every unknown-position pick goes through */
  resolvePick: (hit: PlaceHit) => Promise<PlaceHit | null>
  applyChange: (mutator: (d: Trip) => void, kind: ImpactResult['kind'], dayIndex: number, onKept?: () => void) => void
  setAddedIds: Dispatch<SetStateAction<Set<string>>>
  newStopId: () => string
  dayForKm: (km: number | null | undefined) => number | null
  poiVisitMinutes: (category?: string) => number
  routeKmOf: (lat: number, lng: number) => number | null
  detourMinFor: (hit: PlaceHit) => number | null
  /** the page's shared batch-busy flag: every batch writer disables together */
  busy: boolean
  setBusy: (busy: boolean) => void
}

export function useShortlist({
  tripId,
  identity,
  resolvePick,
  applyChange,
  setAddedIds,
  newStopId,
  dayForKm,
  poiVisitMinutes,
  routeKmOf,
  detourMinFor,
  busy,
  setBusy,
}: ShortlistDeps) {
  const [shortlist, setShortlist] = useState<PlaceHit[]>([])

  /** Shortlisting never edits the plan; it collects for the tray to act on. */
  function toggleShortlist(hit: PlaceHit) {
    setShortlist(prev => {
      if (prev.some(h => h.id === hit.id)) return prev.filter(h => h.id !== hit.id)
      // #179: membership systems must not fight — already-added (Timeline or
      // map) and dismissed hits can't re-enter the tray from any path. The
      // predicate is the SHARED one (session ids, provider keys and the
      // normalized-name fallback); re-deriving it here would be a second
      // membership rule, which is the bug #345 was about.
      if (isAlreadyAdded(hit, identity)) return prev
      return [...prev, hit]
    })
  }

  // #179: the tray re-validates at render — a hit shortlisted and THEN added on the
  // Timeline (or dismissed) must not sit in the tray as a stale double-add waiting
  // to happen. Derived, so every action below sees the same clean list.
  const trayShortlist = useMemo(
    () => shortlist.filter(h => !isAlreadyAdded(h, identity)),
    [shortlist, identity],
  )

  const isShortlisted = (hit: PlaceHit) => trayShortlist.some(h => h.id === hit.id)

  async function addShortlisted() {
    if (busy || trayShortlist.length === 0) return
    setBusy(true)
    try {
      // #420 slice 1: the ordering rule lives in map/roadOrder.ts, with its own
      // tests — same comparator, including its NaN-keeps-order subtlety.
      const ordered = orderByRoad(trayShortlist, routeKmOf)
      const resolved = await Promise.all(ordered.map(async hit => ({ hit, pinned: await resolvePick(hit) })))
      const usable = resolved.filter((x): x is { hit: PlaceHit; pinned: PlaceHit } => !!x.pinned)
      if (usable.length === 0) {
        toast('Nothing could be pinned from the shortlist - try another place.')
        return
      }
      applyChange(draft => {
        for (const { hit, pinned } of usable) {
          const dayIndex = dayForKm(hit.cumKm) ?? 0
          const day = draft.days.find(d => d.index === dayIndex)
          if (!day) continue
          const stop = {
            id: newStopId(), title: hit.name,
            category: (hit.category as ItineraryStop['category']) ?? 'sightseeing',
            locationName: hit.description ?? hit.name, placeId: pinned.placeId,
            lat: pinned.latitude, lng: pinned.longitude, description: hit.description ?? '',
            notes: 'Added from shortlist', visitMinutes: poiVisitMinutes(hit.category),
            openTime: hit.openTime ?? '', closeTime: hit.closeTime ?? '',
            entryFeeInrPerPerson: 0, transportCostInrTotal: 0, priority: 'nice-to-have',
            sourceUrl: '', status: 'suggested', orderInDay: day.stops.length + 1,
          } as unknown as ItineraryStop
          const newKm = routeKmOf(pinned.latitude, pinned.longitude)
          let at = day.stops.length
          if (newKm != null) {
            at = day.stops.findIndex(s => {
              const km = routeKmOf(s.lat, s.lng)
              return km != null && km > newKm
            })
            if (at === -1) at = day.stops.length
          }
          day.stops.splice(at, 0, stop)
          day.stops.forEach((s, i) => { s.orderInDay = i + 1 })
        }
      }, 'add', -1)
      setAddedIds(prev => {
        const next = new Set(prev)
        for (const { hit } of usable) next.add(hit.id as string)
        return next
      })
      setShortlist([])
      toast(`${usable.length} shortlist stop${usable.length === 1 ? '' : 's'} added in road order`)
    } finally {
      setBusy(false)
    }
  }

  /** Turn the shortlist into an open group decision, reusing the poll shape.
   *  Each option carries the place it stands for, so RESOLVING the decision
   *  lands the winner on the timeline as a confirmed stop (store's
   *  resolveDecision reads the payload) — shortlist → vote → resolved →
   *  on the board, timeline and map, with the rail's row dropping out. */
  async function raiseShortlistVote() {
    if (trayShortlist.length === 0 || busy) return
    setBusy(true)
    try {
      const resolved = await Promise.all(trayShortlist.map(async h => ({ h, pinned: await resolvePick(h) })))
      const usable = resolved.filter((x): x is { h: PlaceHit; pinned: PlaceHit } => !!x.pinned)
      if (usable.length === 0) { toast('Those places could not be pinned on the map - the vote was not created.'); return }
      addDecision(tripId, {
        question: usable.length === 1 ? `Should we add "${usable[0].h.name}"?` : 'Which of these should we add?',
        context: 'Shortlisted from the Map rail',
        options: usable.map(({ h, pinned }) => ({
          id: String(h.id), label: h.name, timeImpactMin: detourMinFor(h) == null ? undefined : Math.round(detourMinFor(h)!) || undefined,
          place: {
            title: h.name, category: (h.category as ItineraryStop['category']) ?? 'sightseeing',
            locationName: h.description ?? h.name, lat: pinned.latitude, lng: pinned.longitude,
            description: h.description, visitMinutes: poiVisitMinutes(h.category),
            ...(h.openTime ? { openTime: h.openTime } : {}), ...(h.closeTime ? { closeTime: h.closeTime } : {}),
            // Unknown route position: leave the day ABSENT (not Day 1 —
            // #336). Resolution then says it cannot place the winner instead
            // of dropping it on a day nobody chose.
            dayIndex: dayForKm(h.cumKm) ?? undefined,
          },
        })),
      })
      toast('Decision posted for the group - resolving it adds the winner to the plan')
      setShortlist([])
    } finally { setBusy(false) }
  }

  return {
    /** the raw collection, for the page's own signature/dirty checks */
    shortlist,
    /** the collection with everything already mine filtered out */
    trayShortlist,
    isShortlisted,
    toggleShortlist,
    addShortlisted,
    raiseShortlistVote,
    clearShortlist: () => setShortlist([]),
  }
}
