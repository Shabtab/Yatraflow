// ============ One mutation lifecycle: staged · kept · discarded · undone ============
//
// #424. Timeline, Map, Board and the helper paths had converged on the same
// *behaviour* (a delete stages an impact preview, Keep leaves an Undo) without
// ever sharing a *contract*: the delete-and-undo sequence was copy-pasted into
// three surfaces with three wordings, the direct-write refusal was pasted into
// five more, and nothing said which destructive actions owe the user a way back.
// So "the same action behaves the same way everywhere" was true by coincidence
// of copies — and the next surface could quietly skip it.
//
// This module is the contract's home. It owns:
//
//   1. the four phases, as data, so a caller names them instead of re-deriving
//      them from a `pending` object;
//   2. `blocksDirectWrite` — ONE rule for "a staged change exists, so a write
//      that skips the preview must wait", replacing five pasted guards;
//   3. `removeStopWithUndo` — ONE destructive-stop path, so the pin, the day row
//      and the Board card cannot diverge again ("do not create two pending
//      mutation systems");
//   4. `MUTATION_RECOVERY` — the declared way back for every destructive action,
//      with `DIRECT_WRITE_ALLOWLIST` naming the few that legitimately reach the
//      store directly. Both are pinned by tests, so a new deletion has to
//      declare itself rather than inherit a habit.
//
// What the lifecycle does NOT do: it never decides *what* a change means. The
// staged proposal, the impact numbers and the chain rule live in
// `lib/previewChain.ts` and the workspace; this file is vocabulary and routing.
import type { Trip } from '../data/types'
import type { ImpactResult } from './impact'
import { removeStopFromDay, stopById } from './stopOrder'
import { restoreStop } from '../store/store'
import { toast, undoToast } from '../components/ui'
import { PREVIEW_BUSY } from './previewChain'

/** The four phases a mutation can be in. Named here because every surface was
 *  re-deriving them: `staged` = proposed in the impact sheet, `kept` = written
 *  to the row, `discarded` = the sheet was dismissed, `undone` = a post-Keep
 *  Undo walked it back. */
export type MutationPhase = 'staged' | 'kept' | 'discarded' | 'undone'

export const MUTATION_PHASES: readonly MutationPhase[] = ['staged', 'kept', 'discarded', 'undone'] as const

/** What each phase promises the user, in the words the surfaces use. The value
 *  of naming them is that "is this recoverable?" has an answer per phase rather
 *  than per surface. */
export const PHASE_MEANING: Record<MutationPhase, string> = {
  staged: 'Proposed, measured, and reversible until you decide — Remove discards it without writing.',
  kept: 'Written to the trip. Every destructive keep leaves an Undo.',
  discarded: 'Never written. The proposal is gone and the row is untouched.',
  undone: 'Walked back after a keep. Identity, day and order are restored.',
}

/** The shape a mutation is applied to — the workspace's `pending`, the tab's
 *  `previewOpen` prop, the suggestion cache's staged ids. All of them answer one
 *  question, so this predicate is deliberately total: anything truthy means a
 *  staged change exists and a direct cache write must wait. Never throws, and
 *  never guesses from content (#334/#372). */
export function blocksDirectWrite(staged: unknown): boolean {
  // A collection means "the staged ids", and an EMPTY one means nothing is
  // staged — reading it as blocked would refuse a write for no reason, which is
  // a trap the map's stagedId set would have walked into.
  if (staged instanceof Set) return staged.size > 0
  if (Array.isArray(staged)) return staged.length > 0
  return Boolean(staged)
}

/** The one refusal a blocked direct write speaks — re-exported so a caller needs
 *  one import for the rule and its message, and so the wording cannot drift. */
export const DIRECT_WRITE_MESSAGE = PREVIEW_BUSY

/** Refuse a direct write while a staged change exists, saying why in the one
 *  wording. This was pasted into five surfaces (and re-invented as a local
 *  helper in a sixth) before it lived here; callers now read
 *  `if (refuseWhileStaged(previewOpen)) return`. */
export function refuseWhileStaged(staged: unknown): boolean {
  if (!blocksDirectWrite(staged)) return false
  toast(DIRECT_WRITE_MESSAGE, 'err')
  return true
}

/** A staged-change submitter: the workspace's `applyChange`. Every mutation that
 *  the user should see measured goes through it. */
export type ApplyChange = (
  mutator: (draft: Trip) => void,
  kind: ImpactResult['kind'],
  dayIndex: number,
  onKept?: () => void,
) => void

/** How a destructive action gives the user a way back. `undo` = a toast with
 *  Undo (and, where it applies, restored order/day), `confirm` = an explicit
 *  are-you-sure step because Undo cannot honestly restore it, `marker` = the row
 *  survives and is restorable, so "gone" would be a lie, `regenerated` = the
 *  thing removed describes facts that no longer exist and is rebuilt from the new
 *  ones, so restoring the old value would be restoring a falsehood.
 *
 *  The fourth value is not a bucket for "we did not bother": a row may only use
 *  it if it names what re-derives the thing (pinned by a test), because otherwise
 *  it is exactly the silent catch-all this table exists to prevent. */
export type MutationRecovery = 'undo' | 'confirm' | 'marker' | 'regenerated'

/** What each recovery promises, in one line — so "is this recoverable?" has an
 *  answer per value rather than per surface, and the vocabulary is data. */
export const RECOVERY_MEANING: Record<MutationRecovery, string> = {
  undo: 'A toast carries Undo: the removed thing comes back where it was.',
  confirm: 'The action asks first, because Undo could not honestly cover it.',
  marker: 'Nothing is destroyed — the row survives with its new state visible.',
  regenerated: 'Rebuilt from the new facts; the removed value would now be false.',
}

export interface DestructiveAction {
  /** Stable id for the action, `<noun>.<verb>` — the kind of thing, not the
   *  surface, so the same action from three surfaces is one row. */
  action: string
  recovery: MutationRecovery
  /** Where it can be triggered from, in the user's vocabulary. */
  surfaces: readonly string[]
  /** Why this recovery is the honest one. */
  why: string
  /** The store function this action reaches, when it has one. The audit test
   *  reads these to prove every destructive export in `store.ts` is classified:
   *  declared here, excused as non-destructive, or recorded as superseded. */
  storeCall?: string
}

/** Every destructive action this app performs, and its declared way back.
 *  `tests/mutation-lifecycle.test.ts` pins the rows against the source: the
 *  stop-removal rows must route through `removeStopWithUndo`, and any file that
 *  writes destructively outside it must appear in DIRECT_WRITE_ALLOWLIST. */
export const MUTATION_RECOVERY: readonly DestructiveAction[] = [
  {
    action: 'stop.remove',
    recovery: 'undo',
    surfaces: ['Timeline day row', 'Board card', 'Map pin popup'],
    why: 'Same action, same path: staged as an impact preview, and Keep leaves an Undo that restores the stop on its day at its old order.',
  },
  {
    action: 'stop.remove-from-fill',
    recovery: 'undo',
    storeCall: 'deleteStop',
    surfaces: ['Map day plan (Fill, Fill the day)'],
    why: 'This removal is itself the Undo of an add, and it runs after the preview has closed — the compensation for stopping at a place that turned out to be wrong.',
  },
  {
    action: 'shortlist.clear',
    recovery: 'undo',
    surfaces: ['Map shortlist tray'],
    why: 'Emptying the tray throws away places collected one at a time, so it leaves an Undo that puts the collection back whole.',
  },
  {
    action: 'settings.clear-local',
    recovery: 'confirm',
    surfaces: ['Crash screen'],
    why: 'Clears everything this browser saved — preferences, caches and the offline copy — so it asks first, and it no longer removes a key nothing writes.',
  },
  {
    action: 'ai-config.clear',
    recovery: 'undo',
    surfaces: ['Profile · companion endpoint', 'Profile · Jev router'],
    why: 'A saved endpoint carries a key the user pasted in from elsewhere, not one they can retype from memory, so the clear leaves an Undo.',
  },
  {
    action: 'expense.remove',
    recovery: 'undo',
    storeCall: 'deleteExpense',
    surfaces: ['Budget expense row'],
    why: 'Writes straight to the row (a cost entry is not a schedule change) and offers Undo.',
  },
  {
    action: 'member.remove',
    recovery: 'undo',
    storeCall: 'removeMember',
    surfaces: ['Share crew list'],
    why: 'Undo re-adds the member; the toast names who left, since a member list is not always on screen.',
  },
  {
    action: 'trip.trash',
    recovery: 'undo',
    storeCall: 'trashTrip',
    surfaces: ['My Trips'],
    why: 'Soft delete — the trip survives in Trash, and Undo restores it immediately.',
  },
  {
    action: 'trip.purge',
    recovery: 'confirm',
    storeCall: 'permanentlyDeleteTrip',
    surfaces: ['Trash'],
    why: 'Permanent by definition; Undo cannot bring a purged row back, so it asks first.',
  },
  {
    action: 'halt.move-pin',
    recovery: 'undo',
    surfaces: ['Map day plan'],
    why: 'Moving a pinned rest changes where the night lands; Undo puts the pin back at the kilometre it came from.',
  },
  {
    action: 'halts.clear-on-reshape',
    recovery: 'regenerated',
    surfaces: ['Map day plan (endpoints edited)'],
    why: 'A halt pin is a promise about a specific road; when the endpoints move the plan is re-derived from the new road, so putting the old pins back would restore a claim that is no longer true — the toast says they were cleared.',
  },
  {
    action: 'suggestion-cache.rescan',
    recovery: 'regenerated',
    surfaces: ['Map day plan (Refresh, endpoints edited)'],
    why: 'The scan cache is a spend, not a document: clearing it makes the corridor re-scan and the rows re-derive from the results, which is the refresh the user asked for.',
  },
  {
    action: 'suggestion.decline',
    recovery: 'marker',
    storeCall: 'declineSuggestion',
    surfaces: ['Group input suggestion row'],
    why: 'The suggestion is not destroyed: its row survives with the declined status the whole crew can see, which is the record of the decision.',
  },
  {
    action: 'publication.unpublish',
    recovery: 'marker',
    storeCall: 'unpublishItinerary',
    surfaces: ['Creator hub publication row'],
    why: 'Not a delete: the row survives with an unpublished marker so buyers keep what they paid for, and republishing is the way back.',
  },
  {
    action: 'creator.disable-mode',
    recovery: 'confirm',
    surfaces: ['Creator hub profile'],
    why: 'Disabling the badge is confirmed and reversible; the publications stay live, which the dialog says before the button.',
  },
  {
    action: 'admin.user-disable',
    recovery: 'confirm',
    storeCall: 'adminSetDisabled',
    surfaces: ['Masteradmin · users'],
    why: 'Disabling an account is confirmed in the console; re-enabling is the way back and needs no confirmation of its own.',
  },
  {
    action: 'admin.user-delete',
    recovery: 'confirm',
    storeCall: 'adminDeleteUser',
    surfaces: ['Masteradmin · users'],
    why: 'Type-the-email confirmation, because the RPC is permanent and only an audit snapshot remains.',
  },
  {
    action: 'admin.trip-delete',
    recovery: 'confirm',
    storeCall: 'adminDeleteTrip',
    surfaces: ['Masteradmin · trips'],
    why: 'Type-the-trip-name confirmation: the FK cascades go with it and the audit log keeps the snapshot.',
  },
  {
    action: 'admin.member-remove',
    recovery: 'confirm',
    storeCall: 'adminRemoveMember',
    surfaces: ['Masteradmin · trip members'],
    why: 'Removing someone from a trip someone else owns is confirmed in the console.',
  },
  {
    action: 'admin.unpublish',
    recovery: 'confirm',
    storeCall: 'adminUnpublish',
    surfaces: ['Masteradmin · publications'],
    why: 'The console confirms it, and it leaves the same soft marker the creator-side unpublish leaves — buyers keep what they paid for.',
  },
] as const

/** Store exports the destructive-name scan finds that deliberately destroy
 *  nothing. Declaring them is the point: the audit's rule is "every destructive
 *  write is classified", and "this one is not destructive, because…" is a
 *  classification — not an omission. */
export function nonDestructiveStoreWrites(): readonly { name: string; why: string }[] {
  return [
    { name: 'adminAuditRowToEntry', why: 'Maps an audit row into the console entry shape; reads only.' },
    { name: 'adminSetCreator', why: 'Grants the creator badge — a grant, not a removal, and reversible.' },
    { name: 'adminSetTripVisibility', why: 'Changes who can see a trip, not whether it exists; setting it back is the way back.' },
    { name: 'unpublishedTripIds', why: 'A reader: which of a creator\'s trips carry the unpublished marker.' },
  ]
}

/** Destructive writes that are SUPERSEDED: no surface reaches them, and leaving
 *  them unclassified would let a future caller mistake one for the product path.
 *  Each entry is a recorded removal, not an accepted state. */
export function supersededPaths(): readonly { name: string; why: string }[] {
  return [
    {
      name: 'deleteTrip',
      why: 'The pre-trash hard delete. `trashTrip` replaced it (v0.47.0) and nothing in the app calls this — only tests/undo-trip.test.ts does, along with the snapshot machinery (restoreTrip, snapshotTrip, lastDeletedTrip) that exists to undo it. Delete the cluster and that suite together; until then no new caller may reach for it, because it would skip the trash window entirely.',
    },
  ]
}

/** Files allowed to write a stop removal straight to the store, with the reason.
 *  Everything else must go through `removeStopWithUndo` (which only STAGES, so it
 *  is not on this list) — this is the only place a new direct writer can appear,
 *  so it shows up in review. */
export const DIRECT_WRITE_ALLOWLIST: readonly { file: string; why: string }[] = [
  {
    file: 'src/pages/trip/MapTab.tsx',
    why: 'The Undo of a fill (single or batch) removes the stops that fill just added, after its preview closed — direct by design, and declared as stop.remove-from-fill.',
  },
]

/** The words for a removal, built once. The Undo restores the stop *to a day*,
 *  so naming the day is what makes the offer honest — the same sentence works
 *  whether the stop was deleted from its day row or from a map pin. */
export function removalMessage(title: string, dayIndex: number): string {
  return `“${title}” removed from Day ${dayIndex + 1}`
}

/** THE destructive-stop path (#424). Stages the removal through the impact
 *  preview (so Keep/Remove *is* the confirmation) and hangs an Undo off the Keep
 *  moment that restores identity, day and order.
 *
 *  Returns what actually happened, so a caller can react (the map, for one, no
 *  longer refuses while a preview is open — it chains, like the Timeline and the
 *  Board already did):
 *
 *  - `'staged-undo'` — a preview is open with the removal, and Keep will leave an Undo;
 *  - `'staged'`      — the stop was not in the row (already gone); the removal is
 *                      still staged so the number stays honest, but there is
 *                      nothing to offer Undo for, and the caller is told.
 *
 *  It never writes the row itself: a direct write here is what made the map pin
 *  diverge in the first place. */
export function removeStopWithUndo(args: {
  trip: Trip
  stopId: string
  dayIndex: number
  applyChange: ApplyChange
}): 'staged-undo' | 'staged' {
  const { trip, stopId, dayIndex, applyChange } = args
  const victim = stopById(trip, stopId)
  applyChange(
    draft => {
      removeStopFromDay(draft, stopId)
    },
    'remove',
    dayIndex,
    victim ? () => undoToast(removalMessage(victim.title, dayIndex), () => restoreStop(trip.id, victim, dayIndex)) : undefined,
  )
  return victim ? 'staged-undo' : 'staged'
}
