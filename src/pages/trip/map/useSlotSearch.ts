/**
 * #420, slice 17 — the slot filing writer as a hook.
 *
 * Filing a found place into its day-part lived as a closure in `MapTab`.
 * It is a hook now. Behaviour is unchanged.
 *
 * What this hook owns: filing a found place into THIS slot as a candidate
 * (never straight into the plan — Fill stays the second, explicit act)
 * under the #179 guards. What it does not own: the query state, the manual
 * picks, the open part, or the slot runner — those stay in the page. The
 * runner keeps its quota-mapped catch in the page: moving it (or the cells
 * it writes) into this hook trips the render compiler with a file-wide
 * bail, so the split is deliberate — writer moves, runner stays. The
 * candidate merge stays a thin page local for the same reason: four render
 * sites call `slotCands` during render (rule 6ad).
 */
import type { Dispatch, SetStateAction } from 'react'
import { toast } from '../../../components/ui'
import type { DaySlot } from '../../../lib/daySlots'
import type { PlaceHit } from '../../../lib/geocode'
import { isAlreadyAdded, type PlaceIdentity } from '../../../lib/placeIdentity'
import { slotFileRefusal } from './slotFiling'

/** The open part's own search: keyed to the slot it was typed in. */
export type SlotSearchState = {
  key: string
  q: string
  busy: boolean
  hits: PlaceHit[]
  err: string | null
}

/** Every page value the filing writer reads. */
export type UseSlotSearchDeps = {
  /** The per-slot manual picks — owned by the page. */
  slotManual: Record<string, PlaceHit[]>
  setSlotManual: Dispatch<SetStateAction<Record<string, PlaceHit[]>>>
  /** The slot-keyed query state — owned by the page. */
  setSlotSearch: Dispatch<SetStateAction<SlotSearchState | null>>
  /** The shared presence identity — one answer to "is this already mine?" */
  identity: PlaceIdentity
}

export function useSlotSearch({
  slotManual,
  setSlotManual,
  setSlotSearch,
  identity,
}: UseSlotSearchDeps): {
  addManualCandidate: (slot: DaySlot, h: PlaceHit) => void
} {
  /** File a found place into THIS slot as a candidate (never straight into
   *  the plan — Fill stays the second, explicit act) under the #179 guards. */
  function addManualCandidate(slot: DaySlot, h: PlaceHit) {
    // #420 slice 5: the two refusals (and their copy) live in ./slotFiling,
    // checked in the order the user meets them.
    const refusal = slotFileRefusal({
      hit: h,
      slotLabel: slot.label,
      manual: slotManual[slot.key] ?? [],
      candidates: slot.candidates,
      isAdded: x => isAlreadyAdded(x, identity),
    })
    if (refusal) {
      toast(refusal.message)
      return
    }
    setSlotManual(prev => ({ ...prev, [slot.key]: [h, ...(prev[slot.key] ?? [])] }))
    setSlotSearch(s => (s && s.key === slot.key ? { ...s, q: '', hits: [], err: null } : s))
    toast(`"${h.name}" added as a candidate for the ${slot.label.toLowerCase()} slot.`)
  }

  return {
    addManualCandidate,
  }
}
