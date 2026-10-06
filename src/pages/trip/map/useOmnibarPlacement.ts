/**
 * #420, slice 7 — the omnibar's placement wiring as a hook.
 *
 * The map's own search finds a place; this is the explicit step after it:
 * the choices for the picked hit, and where each choice routes. It moved out
 * of `MapTab` verbatim — this is a refactor, so the memo and the router below
 * are the same code with their closures named through `OmnibarPlacementDeps`
 * instead of being captured from a 2,700-line component.
 *
 * #I-41 lives here too: the placement day resolved through the same road
 * lookup the editor uses, so the label and the editor cannot name two
 * different days.
 *
 * Two things a reviewer should be able to check here and could not before:
 *
 *  - **what the placement step needs.** `OmnibarPlacementDeps` is the complete
 *    list, so "which parts of the map page does filing a found place actually
 *    touch?" is a question with a written answer;
 *  - **that the list stays pure.** The choices still come from
 *    `../mapPlacement` — this hook only hands it the facts — so the
 *    no-implicit-write contract keeps its unit tests, not a DOM.
 */
import { useMemo } from 'react'
import type { PlaceHit } from '../../../lib/geocode'
import { isAlreadyAdded, type PlaceIdentity } from '../../../lib/placeIdentity'
import type { DaySlot } from '../../../lib/daySlots'
import type { Trip } from '../../../data/types'
import { placementOptions, type PlacementOption } from '../mapPlacement'
import { filingOptionsFor } from './slotFiling'

/** The omnibar's selected row: the hit plus the road position the shared
 *  search runner already measured for it (null when it could not). */
export type OmnibarPick = { h: PlaceHit; km: number | null; off: number | null }

export type OmnibarPlacementDeps = {
  /** the omnibar's selected row, or null when nothing is selected */
  picked: OmnibarPick | null
  /** the day the map is planning (the rail's active day) */
  activeDayIndex: number
  /** the trip's days, for the placement day's title and first-day fallback */
  days: Trip['days']
  /** which day an along-route km belongs to (null when unknown) */
  dayForKm: (km: number | null | undefined) => number | null
  /** the active day's slots — the filing options and the slot lookup */
  activeDaySlots: DaySlot[]
  /** every shortlisted hit, for the shortlist toggle label */
  shortlist: PlaceHit[]
  /** the shortlist minus what is already in the plan, for the vote count */
  trayShortlist: PlaceHit[]
  /** the shared presence identity — one answer to "is this already mine?" */
  identity: PlaceIdentity
  /** a day opens the stop editor (which asks for the day and owns the write) */
  openAddModal: (hit: PlaceHit, km?: number | null, day?: number | null) => void
  /** a part fills through the manual-candidate path the rail uses */
  addManualCandidate: (slot: DaySlot, hit: PlaceHit) => void
  /** the shortlist collects without touching the plan */
  toggleShortlist: (hit: PlaceHit) => void
  /** the vote is the tray's own decision */
  raiseShortlistVote: () => void
}

export function useOmnibarPlacement({
  picked,
  activeDayIndex,
  days,
  dayForKm,
  activeDaySlots,
  shortlist,
  trayShortlist,
  identity,
  openAddModal,
  addManualCandidate,
  toggleShortlist,
  raiseShortlistVote,
}: OmnibarPlacementDeps): {
  omniPlacement: PlacementOption[]
  placeOmnibarHit: (option: PlacementOption) => void
} {
  // #I-41: the day the stop editor will open on for the selected hit. One
  // lookup feeds the placement label and the click, so the label and the
  // editor cannot name two different days. An unknown road position falls back
  // to the trip's first day — the same fallback the editor applies.
  const omniPlaceKm = picked ? (picked.km ?? picked.h.cumKm ?? null) : null
  const omniPlaceDay = useMemo(
    () => dayForKm(omniPlaceKm) ?? days[0]?.index ?? 0,
    [omniPlaceKm, dayForKm, days],
  )

  // #418: the omnibar's choices for the place it just found. The list itself is
  // pure (`mapPlacement.ts` decides what may be filed where, and why not); this
  // only hands it the facts, so the same rules are unit-testable without a DOM.
  const omniPlacement = useMemo<PlacementOption[]>(
    () => placementOptions({
      hit: picked?.h ?? null,
      dayIndex: activeDayIndex,
      placeDayIndex: omniPlaceDay,
      placeDayLabel: days.find(d => d.index === omniPlaceDay)?.title ?? null,
      km: omniPlaceKm,
      // The parts this place's own category could serve on the day the rail is
      // planning — the same helper the corridor rows already file through.
      filingOptions: picked ? filingOptionsFor(picked.h, activeDaySlots) : [],
      alreadyAdded: picked ? isAlreadyAdded(picked.h, identity) : false,
      shortlisted: picked ? shortlist.some(h => h.id === picked.h.id) : false,
      shortlistCount: trayShortlist.length,
    }),
    [picked, activeDayIndex, omniPlaceDay, omniPlaceKm, days, activeDaySlots, shortlist, trayShortlist, identity],
  )

  /** #418: every placement routes into a path that already existed and nothing is
   *  re-implemented here — a day opens the stop editor (which asks for the day and
   *  owns the write), a part fills through the same manual-candidate path the rail
   *  uses, the shortlist collects without touching the plan, and the vote is the
   *  tray's own decision. Nothing happens until the user clicks one. */
  function placeOmnibarHit(option: PlacementOption) {
    if (!picked) return
    if (option.kind === 'day') { openAddModal(picked.h, picked.km, omniPlaceDay); return }
    if (option.kind === 'slot') {
      const slot = activeDaySlots.find(s => s.key === option.slotKey)
      if (slot) addManualCandidate(slot, picked.h)
      return
    }
    if (option.kind === 'shortlist') { toggleShortlist(picked.h); return }
    if (option.kind === 'vote') { void raiseShortlistVote(); return }
  }

  return { omniPlacement, placeOmnibarHit }
}
