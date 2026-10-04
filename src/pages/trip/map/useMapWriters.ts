/**
 * #420, slice 10 — the map's plan writers as a hook.
 *
 * Adding a place to a day, filling one part, filling the whole day, and
 * raising a part vote lived as closures in `MapTab`. They are a hook now.
 * Behaviour is unchanged.
 *
 * What this hook owns: the four writes and nothing else. It keeps no state —
 * the busy flags, the day, and the slots stay in the page with the rails that
 * render them. Every output runs from an event handler, never during render.
 */
import { toast, undoToast } from '../../../components/ui'
import {
  asymmetricDetourMinutes,
  type PlaceHit,
  type SegmentHit,
} from '../../../lib/geocode'
import { MODE_SPEED } from '../../../lib/engine'
import type { ImpactResult } from '../../../lib/impact'
import { visitMinutesForCategory } from '../../../lib/slackPrompts'
import { newStopId, poiVisitMinutes } from './pageHelpers'
import { saveHaltPin } from '../../../lib/uiPrefs'
import { recordDnaEvent } from '../../../lib/tripDna'
import { addDecision, deleteStop } from '../../../store/store'
import type { DaySlot } from '../../../lib/daySlots'
import type { ItineraryStop, Trip } from '../../../data/types'

/** Every page value the four writes touch. */
export type UseMapWritersDeps = {
  /** the shared resolve-or-prompt guard — every write pins first */
  resolvePick: (hit: PlaceHit) => Promise<PlaceHit | null>
  /** the workspace write, with its staged-preview contract */
  applyChange: (mutator: (d: Trip) => void, kind: ImpactResult['kind'], dayIndex: number, onKept?: () => void) => void
  /** the trip — ids, modes, styles and days feed the writes */
  trip: Trip
  /** the corridor plan — overnight segments name the halt pins */
  pois: SegmentHit[]
  /** along-route km for a point (null off-polyline) */
  routeKmOf: (lat: number, lng: number) => number | null
  /** corridor anchors for the detour math */
  anchors: { lat: number; lng: number }[]
  /** drawn-road polyline for the detour math */
  routePolyline: { lat: number; lng: number }[] | null
  /** the day the rail is planning */
  activeDayIndex: number
  /** the active day's slots — the batch fill reads their candidates */
  activeDaySlots: DaySlot[]
  /** marks staged ids at stage time, so a place cannot slip in twice */
  markStaged: (hits: Array<Pick<PlaceHit, 'id' | 'name'>>) => void
  /** true while any write is in flight — a second one waits */
  addingAny: boolean
  /** in-flight ids, so the same place cannot be written twice */
  addingIdsRef: { current: Set<string> }
  /** publishes the in-flight ids */
  setAddingIds: (ids: Set<string>) => void
  /** publishes the busy flag */
  setAddingAny: (busy: boolean) => void
  /** true while the batch fill runs */
  fillingDay: boolean
  /** publishes the batch-fill flag */
  setFillingDay: (filling: boolean) => void
  /** DNA freshness — bumped on every accept so scoring re-reads the log */
  setDnaTick: (fn: (t: number) => number) => void
  /** closes the open part after its write lands */
  setOpenSlotKey: (key: string | null) => void
  /** the part's live vote opens the crew's Group input (P4) */
  onOpenGroupInput?: () => void
}

export function useMapWriters({
  resolvePick,
  applyChange,
  trip,
  pois,
  routeKmOf,
  anchors,
  routePolyline,
  activeDayIndex,
  activeDaySlots,
  markStaged,
  addingAny,
  addingIdsRef,
  setAddingIds,
  setAddingAny,
  fillingDay,
  setFillingDay,
  setDnaTick,
  setOpenSlotKey,
  onOpenGroupInput,
}: UseMapWritersDeps): {
  addPoiToDay: (hit: PlaceHit, dayIndex: number) => Promise<void>
  fillSlot: (slot: DaySlot, hit: PlaceHit) => Promise<void>
  fillTheDay: () => Promise<void>
  raiseSlotVote: (slot: DaySlot) => Promise<void>
} {
  async function addPoiToDay(hit: PlaceHit, dayIndex: number) {
    const key = String(hit.id)
    if (addingIdsRef.current.has(key)) return
    addingIdsRef.current.add(key)
    setAddingIds(new Set(addingIdsRef.current))
    setAddingAny(true)
    try {
      const pinned = await resolvePick(hit)
      if (!pinned) {
        toast(`Could not pin “${hit.name}” on the map - not added. Try another suggestion.`)
        return
      }
      applyChange(draft => {
        const day = draft.days.find(d => d.index === dayIndex)
        if (!day) return
        const newStop = {
          id: newStopId(),
          title: hit.name,
          category: (hit.category as ItineraryStop['category']) ?? 'sightseeing',
          locationName: hit.description ?? hit.name,
          placeId: pinned.placeId,
          lat: pinned.latitude,
          lng: pinned.longitude,
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
        } as unknown as ItineraryStop
        const newKm = routeKmOf(pinned.latitude, pinned.longitude)
        let at = day.stops.length
        if (newKm != null) {
          at = day.stops.findIndex(s => {
            const km = routeKmOf(s.lat, s.lng)
            return km != null && km > newKm
          })
          if (at === -1) at = day.stops.length
          day.stops.splice(at, 0, newStop)
          day.stops.forEach((s, i) => { s.orderInDay = i + 1 })
        } else {
          day.stops.push(newStop)
        }
      }, 'add', dayIndex)
      markStaged([hit])
      if (hit.haltPurpose === 'overnight') {
        const seg = pois.find(p => p.hit?.id === hit.id)?.segment
        if (seg) {
          const ordinals = pois
            .filter(x => x.segment.purpose === 'overnight')
            .sort((a, b) => a.segment.targetKm - b.segment.targetKm)
            .findIndex(x => x.segment.index === seg.index)
          if (ordinals >= 0) {
            saveHaltPin(trip.id, ordinals, seg.targetKm)
            toast(`“${hit.name}” added to Day ${dayIndex + 1} - night halt pinned, it won't move unless the road does`)
            return
          }
        }
      }
      toast(`“${hit.name}” added to Day ${dayIndex + 1}`)
    } finally {
      addingIdsRef.current.delete(key)
      setAddingIds(new Set(addingIdsRef.current))
      if (addingIdsRef.current.size === 0) setAddingAny(false)
    }
  }

  /** P2: fill one empty part of the day with a candidate. The stop id is
   *  minted here so Undo can delete exactly what was added (addPoiToDay's
   *  own undo hooks into toasts we do not own). Coord resolution stays. */
  async function fillSlot(slot: DaySlot, hit: PlaceHit) {
    const key = String(hit.id)
    if (addingAny || addingIdsRef.current.has(key)) return
    addingIdsRef.current.add(key)
    setAddingIds(new Set(addingIdsRef.current))
    setAddingAny(true)
    try {
      const dayIdx = activeDayIndex
      const pinned = await resolvePick(hit)
      if (!pinned) { toast(`Could not pin "${hit.name}" on the map - not added. Try another suggestion.`); return }
      const stopId = newStopId()
    markStaged([hit])
    applyChange(draft => {
      const day = draft.days.find(d => d.index === dayIdx)
      if (!day) return
      const stop = {
        id: stopId,
        title: hit.name,
        category: (hit.category as ItineraryStop['category']) ?? 'sightseeing',
        locationName: hit.description ?? hit.name,
        placeId: pinned.placeId,
        lat: pinned.latitude,
        lng: pinned.longitude,
        description: hit.description ?? '',
        // The note stays human prose; `slotKey` below is the provenance the
        // rail actually reads back, so this line is free to be edited or
        // cleared without silently un-planning the day.
        notes: 'Filled from the day plan',
        slotKey: slot.key,
        visitMinutes: poiVisitMinutes(hit.category),
        openTime: hit.openTime ?? '', closeTime: hit.closeTime ?? '',
        entryFeeInrPerPerson: 0,
        transportCostInrTotal: 0,
        priority: 'nice-to-have',
        sourceUrl: '',
        status: 'suggested',
        // 1-based, contiguous (the spec's invariant, and every sibling's
        // `length + 1`): this one shipped without the +1 and duplicated the
        // last stop's order until V8's stable sort happened to save it (#337).
        orderInDay: day.stops.length + 1,
      } as ItineraryStop
      day.stops.push(stop)
    }, 'add', dayIdx, () => {
      // S6: the single Fill is the PRIMARY path, so it has to teach the engine
      // too. The batch fill did and this did not, which made one action's
      // consequence depend on which button was pressed - and starved the P7.2
      // hints, which stay silent below 3 accepts.
      recordDnaEvent({ tripId: trip.id, action: 'accept', haltKind: slot.kind, category: hit.category, detourMin: asymmetricDetourMinutes(hit, anchors, routePolyline ?? null, MODE_SPEED[trip.transportMode] ?? 40) ?? undefined, visitMin: visitMinutesForCategory(hit.category) })
      setDnaTick(t => t + 1)
      // #143: an overnight fill pins the halt, same as addPoiToDay's rule.
      if (hit.haltPurpose === 'overnight') {
        const ordinals = pois
          .filter(x => x.segment.purpose === 'overnight')
          .sort((a, b) => a.segment.targetKm - b.segment.targetKm)
          .findIndex(x => x.segment.index === slot.segment?.index)
        if (ordinals >= 0) saveHaltPin(trip.id, ordinals, slot.segment?.targetKm ?? 0)
      }
      // #346: no clearMap/refreshTick here — a fill hides its row LOCALLY
      // (identity/addedIds carry the id; stopSig re-derives the slots). The
      // DNA accept above stays the one legitimate engine re-plan input. The
      // old forced re-search billed a full scan and flashed the spinner for
      // every fill.
      undoToast(`"${hit.name}" fills ${slot.label} on Day ${dayIdx + 1}`, () => {
        deleteStop(trip.id, stopId)
        setDnaTick(t => t + 1)
      })
    })
      setOpenSlotKey(null)
    } finally {
      addingIdsRef.current.delete(key)
      setAddingIds(new Set(addingIdsRef.current))
      if (addingIdsRef.current.size === 0) setAddingAny(false)
    }
  }

  /** P3.1: fill every empty part of the day with its top candidate in ONE
   *  batched write. Undo removes exactly the stops the fill added; `deleteStop`
   *  renumbers the day, so the stops that were already there land back in their
   *  original sequence without needing a separate snapshot. */
  async function fillTheDay() {
    const dayIdx = activeDayIndex
    const targets = activeDaySlots
      .filter(s => s.state === 'empty' && s.candidates.length > 0)
      .map(s => ({ slot: s, hit: s.candidates[0].hit as PlaceHit }))
    if (targets.length === 0 || fillingDay) return
    setFillingDay(true)
    try {
      // Placeholder coords resolve BEFORE the write (the Null Island guard).
      const resolved: Array<{ slot: DaySlot; hit: PlaceHit }> = []
      for (const t of targets) {
        const pinned = await resolvePick(t.hit)
        if (pinned) resolved.push({ slot: t.slot, hit: pinned })
      }
      if (resolved.length === 0) {
        toast('Nothing could be pinned from the suggestions - try filling one at a time.')
        return
      }
      // Road order first, so sequential splices land in journey order.
      const ordered = [...resolved].sort((a, b) =>
        (routeKmOf(a.hit.latitude, a.hit.longitude) ?? Infinity) -
        (routeKmOf(b.hit.latitude, b.hit.longitude) ?? Infinity))
      const bytes = new Uint32Array(ordered.length * 2)
      crypto.getRandomValues(bytes)
      const newIds = ordered.map((_, i) => `pending_${bytes[i * 2].toString(36)}${bytes[i * 2 + 1].toString(36)}`)
      // Both the pre-resolve candidates (what the rails render) and the pinned
      // shapes are marked: on discard the effect releases the ones whose place
      // is not in the plan, so over-marking is self-healing.
      markStaged([...targets.map(t => t.hit), ...ordered.map(x => x.hit)])
      applyChange(draft => {
        const day = draft.days.find(d => d.index === dayIdx)
        if (!day) return
        ordered.forEach((item, i) => {
          const hit = item.hit
          const stop = {
            id: newIds[i],
            title: hit.name,
            category: (hit.category as ItineraryStop['category']) ?? 'sightseeing',
            locationName: hit.description ?? hit.name,
            placeId: hit.placeId,
            lat: hit.latitude,
            lng: hit.longitude,
            description: hit.description ?? '',
            notes: 'Filled from the day plan',
            slotKey: item.slot.key,
            visitMinutes: poiVisitMinutes(hit.category),
            openTime: hit.openTime ?? '', closeTime: hit.closeTime ?? '',
            entryFeeInrPerPerson: 0,
            transportCostInrTotal: 0,
            priority: 'nice-to-have',
            sourceUrl: '',
            status: 'suggested',
            orderInDay: day.stops.length + 1,
          } as ItineraryStop
          const newKm = routeKmOf(hit.latitude, hit.longitude)
          let at = day.stops.length
          if (newKm != null) {
            at = day.stops.findIndex(x => {
              const km = routeKmOf(x.lat, x.lng)
              return km != null && km > newKm
            })
            if (at === -1) at = day.stops.length
            day.stops.splice(at, 0, stop)
            day.stops.forEach((x, j) => { x.orderInDay = j + 1 })
          } else {
            day.stops.push(stop)
          }
        })
      }, 'add', dayIdx, () => {
        for (const { slot, hit } of ordered) {
          recordDnaEvent({ tripId: trip.id, action: 'accept', haltKind: slot.kind, category: hit.category, detourMin: asymmetricDetourMinutes(hit, anchors, routePolyline ?? null, MODE_SPEED[trip.transportMode] ?? 40) ?? undefined, visitMin: visitMinutesForCategory(hit.category) })
        }
        // #346: the batch fill re-plans through DNA only — the rows hide
        // locally (identity/addedIds), so no forced re-search or spinner.
        setDnaTick(t => t + 1)
        setOpenSlotKey(null)
        const n = ordered.length
        const left = targets.length - ordered.length
        undoToast(
          `Day ${dayIdx + 1} planned - ${n} stop${n === 1 ? '' : 's'} added${left > 0 ? ` · ${left} left for you` : ''}`,
          () => {
            // Removing exactly the stops the fill added is enough: deleteStop
            // renumbers the day, so the stops that were already there come back
            // to 1..n in their original sequence.
            for (const id of newIds) deleteStop(trip.id, id)
            setDnaTick(t => t + 1)
            toast('The planned fills were pulled back')
          },
        )
      })
    } finally {
      setFillingDay(false)
    }
  }

  /** P4: raise the crew's vote for this part - the candidates become the
   *  options (each carrying its place), and resolving it lands the winner. */
  async function raiseSlotVote(slot: DaySlot) {
    const picks = slot.candidates.slice(0, 3)
    if (picks.length < 2 || addingAny) return
    setAddingAny(true)
    try {
      const resolved = await Promise.all(picks.map(async c => ({ c, pinned: await resolvePick(c.hit) })))
      const usable = resolved.filter((x): x is { c: (typeof picks)[number]; pinned: PlaceHit } => !!x.pinned)
      if (usable.length < 2) { toast('Those places could not be pinned on the map - the vote was not created.'); return }
      addDecision(trip.id, {
        question: `Day ${activeDayIndex + 1} ${slot.label.toLowerCase()} - where?`,
        context: `Voting from the day plan (Day ${activeDayIndex + 1})`,
        options: usable.map(({ c, pinned }) => ({
          id: `slot:${slot.key}:${String(c.hit.id)}`, label: c.hit.name,
          timeImpactMin: c.detourMin == null ? undefined : Math.round(c.detourMin) || undefined,
          place: {
            title: c.hit.name, category: (c.hit.category as ItineraryStop['category']) ?? 'sightseeing',
            locationName: c.hit.description ?? c.hit.name, lat: pinned.latitude, lng: pinned.longitude,
            description: c.hit.description, visitMinutes: poiVisitMinutes(c.hit.category),
            openTime: c.hit.openTime, closeTime: c.hit.closeTime, dayIndex: activeDayIndex,
          },
        })),
      })
      toast(`The crew is voting on Day ${activeDayIndex + 1} ${slot.label.toLowerCase()} - resolve it in Group input`)
      setOpenSlotKey(null)
      onOpenGroupInput?.()
    } finally { setAddingAny(false) }
  }

  return { addPoiToDay, fillSlot, fillTheDay, raiseSlotVote }
}
