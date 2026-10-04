/**
 * #420, slice 9 — the "add from map / nearby" draft as a hook.
 *
 * Picking a day for a found place lived as state plus an opener in `MapTab`.
 * It is a hook now. Behaviour is unchanged.
 *
 * What this hook owns: the pending draft, the picked day, and whether that
 * day is a guess. What it does not own: the modal itself or the confirm
 * write — the page keeps that JSX, reading this hook's state.
 */
import { useState } from 'react'
import { toast } from '../../../components/ui'
import type { PlaceHit } from '../../../lib/geocode'
import { isAlreadyAdded, type PlaceIdentity } from '../../../lib/placeIdentity'
import type { Trip } from '../../../data/types'

/** Every page value the day default reads. */
export type UseAddModalDeps = {
  /** The shared presence identity — one answer to "is this already mine?" */
  identity: PlaceIdentity
  /** Which day an along-route km belongs to (null when unknown). */
  dayForKm: (km: number | null | undefined) => number | null
  /** The trip's days, for the first-day fallback. */
  days: Trip['days']
}

export function useAddModal({ identity, dayForKm, days }: UseAddModalDeps): {
  poiDraft: { hit: PlaceHit } | null
  setPoiDraft: (draft: { hit: PlaceHit } | null) => void
  pickDay: number
  setPickDay: (day: number) => void
  pickDayGuessed: boolean
  setPickDayGuessed: (guessed: boolean) => void
  openAddModal: (hit: PlaceHit, kmOverride?: number | null, dayOverride?: number | null) => void
} {
  // pending "add from map / nearby" — pick a day, then confirm
  const [poiDraft, setPoiDraft] = useState<{ hit: PlaceHit } | null>(null)
  const [pickDay, setPickDay] = useState<number>(0)
  const [pickDayGuessed, setPickDayGuessed] = useState(false)

  function openAddModal(hit: PlaceHit, kmOverride?: number | null, dayOverride?: number | null) {
    // Duplicate guard (#179 family): a place already in the plan (matched by
    // title) can't be added again from ANY path — the map-pin "+", a search
    // row, or the shortlist tray — so the modal never opens for a repeat.
    if (isAlreadyAdded(hit, identity)) { toast(`“${hit.name}” is already in your trip.`); return }
    // Pick-day default: prefer the caller's road position (search rows pass the
    // along-route km they already measured — searchPlacesText hits carry NO
    // cumKm, so reading hit.cumKm alone always defaulted to Day 1), else the
    // hit's own ride-plan cumKm (corridor pins). An unknown position can't
    // preselect honestly, so fall back to the first day — the picker is
    // user-adjustable, so nothing is attributed silently.
    const kmForPick = kmOverride ?? hit.cumKm
    // #I-41: the omnibar passes the day its placement label already named.
    // The label and this editor then open on one day, never two.
    const derivedDay = dayOverride ?? dayForKm(kmForPick)
    setPickDay(derivedDay ?? days[0]?.index ?? 0)
    // #333 A9: an unknown position still cannot preselect honestly — but the
    // fallback to Day 1 used to happen in silence, with the reasoning living
    // only in this comment. The modal discloses the guess now, and it stops
    // being a guess the moment the user picks a day themselves.
    setPickDayGuessed(kmForPick == null)
    setPoiDraft({ hit })
  }

  return {
    poiDraft,
    setPoiDraft,
    pickDay,
    setPickDay,
    pickDayGuessed,
    setPickDayGuessed,
    openAddModal,
  }
}
