// ============ Trip workspace ============
// Shell: hero header, tab list, pending-change plumbing, applyChange, and
// routing to the tab components in pages/trip/* (M3.4 split). Tabs:
// Overview / Timeline / Map / Group input / Budget / Share. The former
// Suggestions and Decisions tabs merged into `group` (old slugs redirect).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Trip } from '../data/types'
import { useDb, tripById, currentUser, roleOf, canEdit, trackTripPreview, tripPreviewPending, observeTripPreview, userById, readSharedTrip, useIdentityGeneration, admitTripPreview } from '../store/store'
import { SegmentedTabs } from '../components/page/SegmentedTabs'
import { StateBlock } from '../components/page/StateBlock'
import { authNext } from '../lib/authNext'
import { computeHealth, computeTotals, getAssumptions, isRoadMeasuredMode } from '../lib/engine'
import { carryStopLinkedRecords, moveStopToDay } from '../lib/stopOrder'
import type { LegEstimate } from '../lib/engine'
import { buildRoadChain, measureRoadChain, correctionsFromLegs, mapRoadViewFromLegs, type RoadStatus, type TripRoadView } from '../lib/tripRoad'
import { computeImpact, type ImpactResult } from '../lib/impact'
import { routeParts } from '../lib/pageTitle'
import { currentQuery, currentRoute, replaceRoute } from '../lib/router'
import { scrollBehavior } from '../lib/motion'
import { Avatar, toast, undoToast, useMedia } from '../components/ui'
import { assignAvatarTones } from '../lib/avatarTone'
import { useTripPresence } from '../hooks/useTripPresence'
import { presenceView } from '../lib/presence'
import { Mascot } from '../components/mascot/Mascot'
import { ImpactPreviewPanel } from '../components/ImpactPreview'
import { useSuggestionCache } from '../hooks/useSuggestionCache'
import { buildDnaVectorAcrossTrips, loadDnaLog, crewSeedEvents, crewSeedsFromSuggestions, recordDnaEvent } from '../lib/tripDna'
import { placeIdentity } from '../lib/placeIdentity'
import type { PlaceHit } from '../lib/providers/hits'
import { useJourneyDays } from './trip/journey/useJourneyDays'
import type { JourneyNetAddedRoad, WorkspaceJourneyDays } from './trip/journey/journeyDays'
import { corridorSnapshotKey, type CorridorSnapshot } from './trip/map/corridorSnapshot'
// Board also embeds TripMap (so it pulls the same lazy map chunk) — load the whole
// view lazily so the Board tab never adds app-start cost either. TripMap itself
// is lazily imported inside MapTab.
const BoardView = React.lazy(() => import('../components/BoardView').then(m => ({ default: m.BoardView })))
import { AiDrawer } from '../components/AiDrawer'
import { AI_COMPANION_ENABLED } from '../lib/featureFlags'
import { OverviewTab } from './trip/OverviewTab'
import { TimelineTab } from './trip/TimelineTab'
import { MapTabSkeleton } from './trip/MapTabSkeleton'
import { TripArtSprite } from '../components/trips/TripArt'
import { CoverMedia } from '../components/CoverMedia'
import { coverPlanFor } from '../lib/regionArt'
import { sizedCoverUrl } from '../lib/tripThumb'
import { regionFor } from '../lib/tripsPage'
import type { MapTarget } from '../lib/mapTarget'
import {
  WORKSPACE_TABS,
  foldWorkspaceHeader,
  resolveMapFocus,
  resolveTimelineFocus,
  workspacePanelId,
  workspaceTabId,
  type TimelineFocusTarget,
  type WorkspaceTabKey,
} from '../lib/workspaceHeader'
// #332 R4: the Map TAB is lazy, not just the renderer inside it. MapTab statically
// imports the whole suggestion stack (geocode, engine, daySlots, tripDna,
// storyArcs, slackPrompts…), so a static import here put all of it in the
// workspace chunk whether or not the tab was ever opened. The skeleton stays a
// static, dependency-free module so the Suspense fallback cannot suspend itself.
const MapTab = React.lazy(() => import('./trip/MapTab').then(m => ({ default: m.MapTab })))
import { GroupInputTab } from './trip/GroupInputTab'
import { slotResolutionRoadFor, type SlotResolutionContext } from './trip/slotResolutionAdapter'
import { BudgetTab } from './trip/BudgetTab'
import { ShareTab } from './trip/ShareTab'
import { TripSettingsForm } from './trip/TripSettingsForm'
import { cap } from './trip/shared'
import { roadChainSig } from '../lib/tripRoad'
import { routePolylineFrom } from './trip/map/weatherGeometry'
import { projectOntoPolyline } from '../lib/providers/hits'
import { acknowledgedStopsFrom, guardedUndo, type WriterCompletion } from './trip/map/mapWriterActions'
import type { WriterRoadBinding } from './trip/map/writerRoadBinding'
import { buildTimelineRoadBinding } from './trip/timeline/timelineRoadBinding'
import { timelineAddAvailability, type TimelineAddAvailability } from './trip/timeline/timelineAddAvailability'
import { measuredRoadFacts } from './trip/map/mapTabPipeline'
import { createTimelineWriterController } from './trip/timeline/timelineWriterController'
import { applyVerifiedPlacement, undoRefusalMessage } from './trip/map/verifiedPlacementEffects'
import { mapManualSlotStore } from './trip/map/manualSlotContexts'
import { visitMinutesForCategory } from '../lib/slackPrompts'
import { normalizeFocus, canFocusDay, focusDayRequest, dayFromFocus, focusForDay, type TripFocus } from '../lib/tripFocus'
import {
  KEEP_CLOSED_UNCERTAIN, KEEP_IN_FLIGHT, KEEP_LEFT_BEHIND, KEEP_LEFT_UNSAVED, KEEP_REFUSAL, LEAVE_UNCERTAIN, KEEP_UNCERTAIN, KEEP_UNCERTAIN_HOLD, KEEP_UNCERTAIN_RESOLVED, REMOVE_PREVIEW_CHANGED,
  acknowledgedReceiptOf, composeOperations, createPreviewGate, discardOperations, keepIsStale, keepOutcomeOf, markAttempted, markUnadmitted, notifyUncertain, pendingVerdict, releaseWatch, runOperations, settleStoreDiscardedWatch, settleWatch,
  stagedChange, withoutOperations,
  type AcknowledgedReceipt, type KeepOutcome, type KeptCallback, type OperationMeta, type PreviewGate, type PreviewOperation, type PreviewWatch,
} from '../lib/previewChain'
import type { ApplyChange } from '../lib/mutationLifecycle'
import type { TripPreviewObservation, TripPreviewOperation, TripPreviewPending } from '../store/tripPreviewRecovery'

/** A staged change: the proposed shape, its impact against the committed trip,
 *  the detached complete base it was built on, and the completion records of
 *  every operation chained into it. `gate` is shared by the whole chain, so a
 *  Keep in flight stays visible after a newer staged edit replaces this object. */
export type PendingChange = {
  proposed: Trip
  result: ImpactResult
  base: Trip
  operations: readonly PreviewOperation[]
  gate: PreviewGate
  revision: number
  busy?: boolean
  /** The last Keep was not confirmed and the change may already be on this
   *  device. The sheet says so, and Remove refuses until Saved edits decides. */
  uncertain?: boolean
}

type PreviewState = {
  pendingRef: { current: PendingChange | null }
  baseRef: { current: Trip | null }
  setPending: (next: PendingChange | null) => void
}

let nextRevision = 1

function stageWorkspacePreview({ pendingRef, baseRef, setPending }: PreviewState, next: PendingChange | null) {
  pendingRef.current = next
  if (!next) baseRef.current = null
  setPending(next)
}

/** Build the workspace handlers without React. Tests use these same handlers. */
export function workspacePreviewActions({ trip, pendingRef, baseRef, legCorrRef, setPending }: PreviewState & {
  trip: Trip | undefined
  legCorrRef: { current: Parameters<typeof computeImpact>[4] }
}) {
  function stage(next: PendingChange | null) {
    stageWorkspacePreview({ pendingRef, baseRef, setPending }, next)
  }

  function applyChange(mutator: (draft: Trip) => void, kind: ImpactResult['kind'], dayIndex: number, onKept?: KeptCallback, operation?: OperationMeta) {
    if (!trip) return
    const staged = pendingRef.current
    const proposed = stagedChange(trip, staged?.proposed ?? null, mutator)
    const result = computeImpact(trip, proposed, kind, dayIndex, legCorrRef.current)
    if (!staged) baseRef.current = trip
    stage({
      proposed,
      result,
      // The complete base is captured once, when staging starts.
      base: staged?.base ?? structuredClone(trip),
      operations: composeOperations(staged?.operations ?? [], onKept, operation),
      gate: staged?.gate ?? createPreviewGate(),
      revision: nextRevision++,
      busy: staged?.busy,
      uncertain: staged?.uncertain,
    })
  }

  /** An acknowledgement for a Keep's exact write generation arrived (the first
   *  receipt, a late replay, or a Saved edits retry). It runs the records that
   *  Keep captured, once. It clears the preview only when that preview is still
   *  the same chain at the same revision; later edits in the chain stay, and a
   *  newer or different preview is never touched. When the preview is gone the
   *  records still run: the user left, and the save landed. */
  function settleAcknowledged(gate: PreviewGate, watch: PreviewWatch, receipt: AcknowledgedReceipt): number {
    const ran = settleWatch(watch, receipt)
    if (ran < 0) return ran
    if (gate.watch === watch) gate.watch = null
    gate.uncertain = null
    const current = pendingRef.current
    const sameChain = current?.gate === gate
    if (current && sameChain && current.revision === watch.revision) stage(null)
    else if (current && sameChain) stage({ ...current, operations: withoutOperations(current.operations, watch.records), busy: false, uncertain: false })
    if (ran === 0) toast('Change saved to your plan')
    return ran
  }

  /** The exact generation can no longer acknowledge: the store POSITIVELY
   *  proved it was discarded in Saved edits or is no longer this identity's.
   *  This is a proven-abandoned settlement, NOT a pre-admission discard and NOT
   *  an acknowledged success. It runs only the captured records' once-only
   *  proven-discard settlement, so each operation's owner can release its OWN
   *  reservation and settle truthfully. Unknown, pending and in-flight states
   *  never reach here and keep their reservations. */
  function settleUnacknowledged(gate: PreviewGate, watch: PreviewWatch) {
    if (watch.settled) return
    settleStoreDiscardedWatch(watch)
    if (gate.watch === watch) gate.watch = null
    if (gate.uncertain) gate.uncertain.resolved = true
    const current = pendingRef.current
    if (current?.gate === gate && current.revision === watch.revision && current.uncertain) stage({ ...current, uncertain: false })
  }

  /** Subscribe to the exact write generation BEFORE the first receipt is
   *  awaited, so an early or late acknowledgement cannot be missed. */
  function openWatch(gate: PreviewGate, operation: TripPreviewOperation, records: readonly PreviewOperation[], revision: number): PreviewWatch {
    const watch: PreviewWatch = { operation, records, revision, subscription: null, settled: false, receipt: null }
    gate.watch = watch
    const onObservation = (observation: TripPreviewObservation) => {
      if (watch.settled) return
      if (observation.kind === 'acknowledged') {
        const receipt = acknowledgedReceiptOf(observation.receipt)
        if (receipt) settleAcknowledged(gate, watch, receipt)
      } else if (observation.kind === 'discarded' || observation.kind === 'foreign') {
        settleUnacknowledged(gate, watch)
      }
    }
    watch.subscription = observeTripPreview(operation, onObservation)
    // A listener that ran during subscribe settled the watch before the handle existed.
    if (watch.settled) {
      watch.subscription.dispose()
      watch.subscription = null
    }
    return watch
  }

  /** A stored same-generation receipt, replayed. The store never lends a receipt
   *  from another generation, so this is the only way a late ack is read. */
  function replayedReceipt(gate: PreviewGate, watch: PreviewWatch): AcknowledgedReceipt | null {
    if (watch.receipt) return watch.receipt
    const replay = watch.subscription?.observation()
    const receipt = replay?.kind === 'acknowledged' ? acknowledgedReceiptOf(replay.receipt) : null
    if (receipt) settleAcknowledged(gate, watch, receipt)
    return receipt
  }

  async function pendingOf(watch: PreviewWatch): Promise<TripPreviewPending> {
    try {
      return await tripPreviewPending(watch.operation)
    } catch (err) {
      console.error('[yatraflow] preview pending read failed', err)
      return { state: 'unknown', reason: 'read-failed', sources: [] }
    }
  }

  /** Ask the store whether the exact write generation of this Keep is still
   *  held. `pending` and `unknown` keep the hold: a queue that cannot be read,
   *  or an in-memory write with no durable row, is never resolved. An exact
   *  acknowledgement runs the captured records and returns its receipt. A
   *  generation that is saved without a retained receipt, discarded, or foreign
   *  is resolved, and nothing here claims which. The read is async, so
   *  the caller names the exact revision it asked for. A newer proposal in the
   *  same chain is never flagged or cleared. */
  async function reconcileUncertain(gate: PreviewGate, revision: number): Promise<'held' | 'resolved' | AcknowledgedReceipt> {
    const uncertain = gate.uncertain
    if (!uncertain) return 'resolved'
    if (uncertain.resolved) return 'resolved'
    const watch = gate.watch
    // No store identity means nothing can prove the write is gone.
    if (!watch) return 'held'
    const early = replayedReceipt(gate, watch)
    if (early) return early
    const pending = await pendingOf(watch)
    const late = replayedReceipt(gate, watch)
    if (late) return late
    if (pendingVerdict(pending) === 'held') return 'held'
    // The pending read can itself be the positive proof. Only the two proven
    // abandoned states run the exact-operation settlement; a settled save with
    // no retained receipt stays a no-callback release. The watch's once-only
    // settled flag keeps this from firing a second time after the observer.
    if (pending.state === 'discarded' || pending.state === 'foreign') settleStoreDiscardedWatch(watch)
    else releaseWatch(watch)
    if (gate.watch === watch) gate.watch = null
    uncertain.resolved = true
    const current = pendingRef.current
    if (current?.gate === gate && current.revision === revision && current.uncertain) stage({ ...current, uncertain: false })
    return 'resolved'
  }

  /** Keep after an uncertain save never writes again. It reads the store and
   *  says what is true. */
  async function keepUncertain(gate: PreviewGate, revision: number): Promise<KeepOutcome> {
    const state = await reconcileUncertain(gate, revision)
    if (state === 'held') {
      toast(KEEP_UNCERTAIN_HOLD, 'err')
      return { kind: 'conflict', uncertain: true }
    }
    if (state !== 'resolved') return state
    toast(KEEP_UNCERTAIN_RESOLVED, 'err')
    return { kind: 'stale', uncertain: true }
  }

  /** Keep admits the staged proposal against its captured base. Only a validated
   *  acknowledgement clears the preview and runs the completion records. Every
   *  other outcome keeps the preview. A second Keep joins the one in flight. */
  function keepPending(): Promise<KeepOutcome> {
    const pending = pendingRef.current
    if (!pending || !trip) return Promise.resolve({ kind: 'none' })
    if (pending.gate.inFlight) return pending.gate.inFlight
    // An earlier save may already be on this device. Admitting again would be a
    // blind retry, so Keep reads Saved edits instead.
    if (pending.gate.uncertain) return keepUncertain(pending.gate, pending.revision)
    if (keepIsStale(baseRef.current, trip)) {
      toast(KEEP_REFUSAL.stale, 'err')
      return Promise.resolve({ kind: 'stale' })
    }
    const { gate, revision, operations, base } = pending
    const patch = structuredClone(pending.proposed)
    // These records are in the patch. A record chained after this point is not,
    // so a later close or leave may release it while these stay unclaimed.
    markAttempted(operations)
    const run = (async (): Promise<KeepOutcome> => {
      let outcome: KeepOutcome
      let watch: PreviewWatch | null = null
      // True only when this Keep admitted an exact generation and the store has
      // NOT proven it gone: its write is still pending or its outcome is
      // unknown. A pre-admission refusal, a thrown admission and a proven
      // discard leave it false, so no operation is told it may be saved.
      let admittedHeld = false
      try {
        const admission = await trackTripPreview({ tripId: base.id, expectedBase: base, patch })
        if (admission.kind === 'admitted' || admission.kind === 'superseded') {
          // The store admitted this exact generation. Subscribe before the
          // first receipt is awaited, so no acknowledgement can be missed.
          watch = openWatch(gate, admission.operation, operations, revision)
          if (admission.kind === 'admitted') {
            try {
              outcome = keepOutcomeOf(await admission.receipt)
            } catch (err) {
              console.error('[yatraflow] keep receipt threw', err)
              outcome = { kind: 'unavailable' }
            }
          } else {
            outcome = { kind: 'superseded' }
          }
        } else {
          // Refused before any cache write: nothing of this Keep exists, so
          // the never-admitted records may be discarded again.
          outcome = keepOutcomeOf({ kind: admission.kind })
          markUnadmitted(operations)
        }
      } catch (err) {
        // No store identity came back, so nothing can be queried or released.
        // The records stay captured; the preview stays and Keep may be tried again.
        console.error('[yatraflow] keep admission threw', err)
        outcome = { kind: 'unavailable' }
      }
      if (watch && outcome.kind !== 'acknowledged') {
        const arrived = watch.receipt
        if (arrived) {
          outcome = arrived
        } else {
          const pending = await pendingOf(watch)
          const replay = replayedReceipt(gate, watch)
          if (replay) {
            outcome = replay
          } else if (pending.state === 'discarded' || pending.state === 'foreign') {
            // Explicitly discarded, or no longer this identity's. Not uncertain.
            settleUnacknowledged(gate, watch)
          } else if (outcome.kind !== 'none') {
            // pending, unknown, or saved with no retained receipt: never a success.
            outcome = { kind: outcome.kind, uncertain: true }
            // Only a held generation (pending or unknown) is notified as
            // uncertain. A save the store already settled is not unconfirmed,
            // so it must not offer a retry.
            admittedHeld = pendingVerdict(pending) === 'held'
          }
        }
      }
      try {
        const current = pendingRef.current
        const sameChain = current?.gate === gate
        if (outcome.kind === 'acknowledged') {
          // The watch settles at most once, whichever of the first receipt or
          // the observer arrives first.
          if (watch) settleAcknowledged(gate, watch, outcome)
          else if (runOperations(operations, outcome) === 0) toast('Change saved to your plan')
        } else if (outcome.kind !== 'none') {
          // The records stay: no discard callback runs for a save that failed.
          const uncertain = outcome.uncertain === true
          if (uncertain) {
            gate.uncertain = { tripId: base.id, kind: outcome.kind, resolved: false }
            // The exact generation this Keep admitted is still held. Tell only
            // the records that Keep captured, once, so a writer can keep its
            // reservation and offer its own captured retry. This is neither an
            // acknowledgement nor a discard: no state changes, and a later
            // acknowledgement or proven discard still settles the record.
            if (admittedHeld) notifyUncertain(operations)
          }
          if (current && sameChain) {
            toast(uncertain ? KEEP_UNCERTAIN : KEEP_REFUSAL[outcome.kind], 'err')
            stage({ ...current, busy: false, uncertain })
          } else {
            toast(uncertain ? KEEP_LEFT_BEHIND : KEEP_LEFT_UNSAVED, 'err')
          }
        }
      } finally {
        gate.inFlight = null
      }
      return outcome
    })()
    gate.inFlight = run
    stage({ ...pending, busy: true })
    return run
  }

  /** Close a preview whose save was uncertain. The change may be admitted, so
   *  this is not a discard and no line says "discarded". Records a Keep captured
   *  stay unclaimed. Records chained later were never in the saved patch, so
   *  they release. It closes only the exact chain and revision the user asked
   *  to remove: a newer proposal, even in the same chain, stays open. */
  function closeUncertain(gate: PreviewGate, revision: number): boolean {
    const current = pendingRef.current
    if (!current) return false
    if (current.gate !== gate || current.revision !== revision) {
      if (current.gate === gate) toast(REMOVE_PREVIEW_CHANGED, 'err')
      return false
    }
    stage(null)
    discardOperations(current.operations)
    toast(KEEP_CLOSED_UNCERTAIN)
    return true
  }

  /** Remove discards only a proposal that was never admitted. While a Keep may
   *  be admitted it refuses. After an uncertain save it waits for Saved edits,
   *  and then closes the preview without a discard claim. */
  function removePending(): boolean | Promise<boolean> {
    const pending = pendingRef.current
    if (pending?.gate.inFlight) {
      toast(KEEP_IN_FLIGHT, 'err')
      return false
    }
    if (pending?.gate.uncertain) {
      const { gate, revision } = pending
      // Always a promise on this path: the store may have just told the gate the
      // write is resolved, and the caller waits for the same answer either way.
      if (gate.uncertain?.resolved) return Promise.resolve(closeUncertain(gate, revision))
      return reconcileUncertain(gate, revision).then(state => {
        // An exact acknowledgement arrived while the store was read: the
        // preview was already cleared and its records ran.
        if (typeof state === 'object') return true
        if (state === 'resolved') return closeUncertain(gate, revision)
        if (pendingRef.current?.gate === gate) toast(KEEP_UNCERTAIN_HOLD, 'err')
        return false
      })
    }
    stage(null)
    if (pending) discardOperations(pending.operations)
    toast('Change discarded')
    return true
  }

  return { applyChange, keepPending, removePending, stage }
}

/** The preview is going away because the user left the trip or the workspace
 *  unmounted. A record a Keep captured may be admitted, so it keeps its state:
 *  a late acknowledgement still reaches it and nothing claims a discard. A
 *  record chained after that Keep was never in the saved patch, so it releases
 *  now, and an older acknowledgement cannot run its callbacks. It reads no trip, so the effect that calls it keeps
 *  a stable identity. */
export function abandonPendingPreview({ pendingRef, baseRef, setPending }: PreviewState): 'none' | 'discarded' | 'saving' | 'uncertain' {
  const pending = pendingRef.current
  if (!pending) return 'none'
  stageWorkspacePreview({ pendingRef, baseRef, setPending }, null)
  // Records a Keep captured are skipped inside discardOperations.
  discardOperations(pending.operations)
  if (pending.gate.inFlight) return 'saving'
  if (pending.gate.uncertain) return 'uncertain'
  return 'discarded'
}

type TabKey = WorkspaceTabKey

const TABS = WORKSPACE_TABS

/** Legacy tab slugs that now redirect to the merged Group input tab. */
const LEGACY_TAB_SLUGS = ['suggestions', 'decisions']

/** Runtime type guard over the TABS table — no `as TabKey` cast anywhere. */
function isTabKey(s: string | undefined): s is TabKey {
  return typeof s === 'string' && TABS.some(([k]) => k === s)
}

/** URL tab segment → TabKey (F-21): junk falls back to Overview; the old
    `suggestions`/`decisions` slugs redirect to the merged `group` tab. */
function sanitizeTab(s: string | undefined): TabKey {
  if (s && LEGACY_TAB_SLUGS.includes(s)) return 'group'
  return isTabKey(s) ? s : 'overview'
}

export function TripWorkspace({ tripId, initialTab, onNavigate }: { tripId: string; initialTab?: string; onNavigate: (route: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const trip = tripById(tripId)
  // A cache miss can precede hydration. Read the row before showing a result.
  const identityGeneration = useIdentityGeneration()
  const [readResult, setReadResult] = useState<{ tripId: string; identityGeneration: number; kind: 'failed' | 'unavailable' } | null>(null)
  const readState = readResult?.tripId === tripId && readResult.identityGeneration === identityGeneration ? readResult.kind : null
  useEffect(() => {
    if (trip || readState || !me) return
    let cancelled = false
    void readSharedTrip(tripId).then(result => {
      if (!cancelled && (result.kind === 'failed' || result.kind === 'unavailable')) setReadResult({ tripId, identityGeneration, kind: result.kind })
    })
    return () => { cancelled = true }
  }, [trip, readState, tripId, me, identityGeneration])
  const [tab, setTabState] = useState<TabKey>(() => sanitizeTab(initialTab))
  // W10: the Map tab owns the whole phone screen. This attribute is the one
  // switch the stylesheet reads, and it is true only for map + phone.
  const phoneMapFullscreen = useMedia('(max-width: 760px)') && tab === 'map'
  // Normalize a legacy slug in the URL once on mount so existing
  // /trip/<id>/suggestions|decisions links keep working but self-heal to `group`.
  useEffect(() => {
    const seg = routeParts(currentRoute())
    if (seg[0] === 'trip' && LEGACY_TAB_SLUGS.includes(seg[2] ?? '')) {
      seg[2] = 'group'
      replaceRoute('/' + seg.join('/'))
    }
  }, [])
  /** F-21: the active tab rides the URL as /trip/<id>/<tab> (no segment =
      Overview). replaceRoute, not navigate, so switching tabs writes no extra
      history entry and doesn't trip App's scroll-reset; browser Back still
      leaves the trip rather than cycling tabs — a tab is a view preference,
      not a navigation step. */
  function setTab(t: TabKey) {
    setTabState(t)
    const seg = routeParts(currentRoute())
    if (t === 'overview') seg.splice(2)
    else if (seg.length >= 3) seg[2] = t
    else seg.push(t)
    replaceRoute('/' + seg.join('/'))
  }
  // #87: the tab bar had role="tab" + aria-selected but every tab stayed in
  // the tab order and arrows did nothing — now the shared roving-tabindex
  // primitive (Tab lands on the active tab only; arrows/Home/End move it).
  const [aiOpen, setAiOpen] = useState(false)

  const role = me && trip ? roleOf(trip, me.id) : null
  const editable = canEdit(role)

  // M6 B1 — who else is viewing this trip right now. Joins the presence
  // room only when a signed-in user has the trip open; anon/public views
  // stay out. Session-local state, never trip data.
  const presence = useTripPresence(trip?.id ?? null, me, me?.profile.name ?? '')
  // An empty room still says so — see presenceView().
  const presenceRow = presenceView(presence.peers, presence.connected)

  // ONE road measurement for the whole workspace (#188): the engine's leg
  // corrections and the Map tab's road view come from the same chain.
  const { corrections: legCorrections, road } = useTripRoad(trip)
  // #342: the preview must measure with the SAME road data the timeline
  // renders, but `applyChange`'s identity is a memo prop for DaySection — so
  // the corrections are read through a ref instead of entering its deps.
  const legCorrRef = useRef(legCorrections)
  legCorrRef.current = legCorrections
  // Group input grades the one workspace road measurement for slot votes.
  // The context holds the COMMITTED trip, never a staged preview draft.
  // The memo key names both inputs, so no decision input is hidden.
  const groupInputResolution = useMemo<SlotResolutionContext | null>(
    () => (trip ? { trip, road: slotResolutionRoadFor(trip, road) } : null),
    [trip, road],
  )

  // Suggestion cache: persists across tab switches, invalidated by anchor changes.
  // #414: the day count prunes zombie halt keys — tail keys naming day indexes
  // the grid no longer has after a shrink. While the trip is still loading
  // there is no grid to compare against, so pruning waits (Infinity never
  // outranks a real key); the count lands the moment the trip does.
  const suggestionCache = useSuggestionCache(tripId, trip ? trip.days.length : Number.POSITIVE_INFINITY)

  // Freshness the Map tab published for the scan it wrote (#404, lane A's
  // `onInputsHash`). Held here so the Overview's matrix can gate on it. Cleared
  // on trip switch like every other per-trip signal: this workspace outlives
  // trips (it is not keyed by trip id), and a previous trip's hash compared
  // against this trip's cache would brand the matrix stale forever.
  const [mapInputs, setMapInputs] = useState<{ hash: string; scopeKm: number } | null>(null)
  const mapInputsRef = useRef<{ hash: string; scopeKm: number } | null>(null)
  const [mapTarget, setMapTarget] = useState<MapTarget | null>(null)
  // S3: the Map publishes its corridor snapshot; the workspace keeps it across
  // tab switches. A foreign trip or an older query context is refused.
  const [corridorSnapshot, setCorridorSnapshot] = useState<CorridorSnapshot | null>(null)
  // Session identity lifted from MapTab: one owner for the producer and the Map.
  const [addedIds, setAddedIds] = useState<Set<string>>(() => new Set())
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set())
  const [stagedSnapshot, setStagedSnapshot] = useState<ReadonlyMap<string, string>>(() => new Map())
  const stagedIdsRef = useRef(new Map<string, string>())
  const [slotManual, setSlotManual] = useState<Record<string, PlaceHit[]>>({})
  const [dnaTick, setDnaTick] = useState(0)
  useEffect(() => {
    setMapInputs(null)
    mapInputsRef.current = null
    setMapTarget(null)
    setCorridorSnapshot(null)
    setAddedIds(new Set())
    setDismissedIds(new Set())
    setStagedSnapshot(new Map())
    stagedIdsRef.current = new Map()
    setSlotManual({})
    setDnaTick(0)
  }, [tripId])
  // Stable identity so the Map's publish effect fires on hash/scope changes,
  // never on our re-renders (their ref guard makes inline safe too; this is
  // the calmer form — it cannot ping-pong even if that guard ever goes).
  const publishMapInputs = useCallback((hash: string, scopeKm: number) => {
    const next = { hash, scopeKm }
    mapInputsRef.current = next
    setMapInputs(next)
  }, [])
  const publishCorridor = useCallback((incoming: CorridorSnapshot | null) => {
    if (!incoming) { setCorridorSnapshot(null); return }
    if (incoming.tripId !== tripId) return
    const current = mapInputsRef.current
    // A snapshot from another query/scope is not this workspace's context.
    if (current && (incoming.inputsHash !== current.hash || incoming.scopeKm !== current.scopeKm)) return
    setCorridorSnapshot(prev => {
      if (prev && prev.tripId === incoming.tripId && corridorSnapshotKey(prev) === corridorSnapshotKey(incoming)) return prev
      return incoming
    })
  }, [tripId])

  // Pending change: a proposed plan held until the user keeps or discards it.
  const [pending, setPending] = useState<PendingChange | null>(null)
  /** The staged change mirrored in a ref: (a) a mutation scheduled in the same
   *  tick as another, or from a stale closure, still CHAINS onto it (#334), and
   *  (b) `baseRef` remembers the committed row the preview was built on, so
   *  Keep can tell when a direct write landed underneath it. */
  const pendingRef = useRef<PendingChange | null>(null)
  const baseRef = useRef<Trip | null>(null)
  // The handlers read the same refs that back the rendered preview.
  const previewActions = useCallback(
    () => workspacePreviewActions({ trip, pendingRef, baseRef, legCorrRef, setPending }),
    [trip],
  )
  const applyChange = useCallback<ApplyChange>((...args) => previewActions().applyChange(...args), [previewActions])
  const keepPending = () => previewActions().keepPending()
  const removePending = () => previewActions().removePending()
  const abandonPreview = useCallback(() => abandonPendingPreview({ pendingRef, baseRef, setPending }), [])
  // An unmounted workspace cannot keep or discard on the user's behalf. A
  // proposal never admitted is discarded, so its operations release; a save in
  // flight or uncertain keeps its records.
  useEffect(() => () => { abandonPreview() }, [abandonPreview])

  // S3: one owner for the shared per-day model. The Map still scans; this
  // producer only reads the published snapshot and the committed/effective trip.
  const crewSuggestions = useMemo(() => db.suggestions.filter(s => s.tripId === trip?.id), [db.suggestions, trip?.id])
  const crewSeeds = useMemo(() => crewSeedsFromSuggestions(crewSuggestions), [crewSuggestions])
  const decisions = useMemo(() => db.decisions.filter(d => d.tripId === trip?.id), [db.decisions, trip?.id])
  const dnaVector = useMemo(() => {
    // dnaTick is a refresh token: the log is read here, not on every render.
    void dnaTick
    return trip ? buildDnaVectorAcrossTrips(loadDnaLog(), crewSeedEvents(trip.id, crewSeeds)) : null
  }, [trip, crewSeeds, dnaTick])
  const effectiveTrip = pending?.proposed ?? trip
  const journeyPresence = useMemo(
    () => (effectiveTrip ? placeIdentity(effectiveTrip, addedIds, dismissedIds, stagedSnapshot) : null),
    [effectiveTrip, addedIds, dismissedIds, stagedSnapshot],
  )
  // S4: the Timeline's covered Add reads the same workspace measurement as the
  // Map. It starts no routing call; a pending/failed/estimate-only/stale chain
  // grades unmeasured and the hop is absent, so Add refuses honestly.
  const timelineRoadView = useMemo(
    () => mapRoadViewFromLegs(road.chain, road.legs, trip ? trip.days.map(d => d.index) : []),
    [road, trip],
  )
  const timelineRoute = useMemo(() => routePolylineFrom(timelineRoadView.geometry) ?? [], [timelineRoadView])
  const roadBinding = useMemo<WriterRoadBinding | null>(() => {
    const committed = tripById(tripId)
    if (!committed) return null
    return buildTimelineRoadBinding({
      trip: committed,
      road,
      hasLine: timelineRoute.length > 1,
    })
  }, [road, tripId, timelineRoute])
  const roadBindingRef = useRef<WriterRoadBinding | null>(roadBinding)
  useEffect(() => { roadBindingRef.current = roadBinding }, [roadBinding])
  const currentRoadBinding = useCallback(() => roadBindingRef.current, [])
  /**
   * #08 AC2: the ONE measured road the writer and the preview already use, in
   * the shape the shared day projection needs for a row's net added minutes. A
   * line without a finished measurement leaves it null, so no row invents a
   * position or a duration from an unmeasured road.
   */
  const journeyNetAddedRoad = useMemo<JourneyNetAddedRoad | null>(() => {
    if (!roadBinding || timelineRoute.length < 2) return null
    return {
      routeKey: roadBinding.routeKey,
      routeKmOf: (lat: number, lng: number) => {
        const snap = projectOntoPolyline({ latitude: lat, longitude: lng }, timelineRoute)
        return snap?.km ?? null
      },
    }
  }, [roadBinding, timelineRoute])
  const journeyDays: WorkspaceJourneyDays = useJourneyDays({
    trip: effectiveTrip ?? null,
    committedTrip: trip ?? null,
    snapshot: corridorSnapshot,
    presence: journeyPresence,
    editable,
    decisions,
    dnaVector,
    legCorrections,
    slotManual,
    dnaTick,
    identityGeneration,
    netAddedRoad: journeyNetAddedRoad,
  })
  // One typed reason for a disabled covered Add. It comes from the canonical
  // measured road grade, so an unmeasured road never reads as a lost writer.
  const projectedAvailability = useMemo<TimelineAddAvailability>(() => {
    const committed = tripById(tripId)
    return timelineAddAvailability(
      committed ? measuredRoadFacts({ trip: committed, road, hasLine: timelineRoute.length > 1 }) : null,
    )
  }, [road, tripId, timelineRoute])
  // Workspace-owned so a conditional Timeline unmount cannot discard a held
  // operation's captured completion/recovery record.
  const timelineWriterController = useMemo(() => createTimelineWriterController(), [])
  const projectedWriterHop = useMemo(() => {
    const committed = trip
    if (!committed || !roadBinding || timelineRoute.length < 2) return undefined
    return {
      road: {
        routeKmOf: (lat: number, lng: number) => {
          const snap = projectOntoPolyline({ latitude: lat, longitude: lng }, timelineRoute)
          return snap?.km ?? null
        },
        road: roadBinding ? { routeKey: roadBinding.routeKey } : null,
        binding: roadBinding,
        currentRoad: currentRoadBinding,
      },
      currentTrip: () => tripById(committed.id),
      onAcknowledged: (completion: WriterCompletion) => {
        const applied = applyVerifiedPlacement(completion, {
          onDna: item => recordDnaEvent({
            tripId: committed.id,
            action: 'accept',
            haltKind: item.hit.haltPurpose,
            category: item.hit.category,
            detourMin: undefined,
            visitMin: visitMinutesForCategory(item.hit.category),
          }),
          onDrop: item => {
            const context = { tripId: committed.id, dayId: item.dayId, slotKey: item.slotKey ?? '' }
            if (context.slotKey) mapManualSlotStore.dropPlaced(context, [item.hit])
          },
          onPlaced: () => setDnaTick(t => t + 1),
        })
        const stops = acknowledgedStopsFrom(completion)
        if (applied === 0 || stops.length === 0) return
        const count = `${stops.length} ${stops.length === 1 ? 'place' : 'places'}`
        toast(`${count} added to the plan`)
        undoToast(`Added ${count}`, () => {
          void guardedUndo(
            { currentTrip: () => tripById(committed.id), admit: admitTripPreview },
            { tripId: committed.id, operationId: completion.operationId, stops },
          ).then(outcome => {
            const message = undoRefusalMessage(outcome)
            if (message) toast(message, 'err')
          })
        })
      },
    }
  }, [trip, timelineRoute, roadBinding, currentRoadBinding, setDnaTick])

  // Phase 3 (the living plan): a halt label on the map asks the timeline to open
  // that day. One-shot signal — TimelineTab consumes it on mount, then the
  // accordion is the user's again. The consumer clears it through the callback
  // below: an unconsumed value would re-fire on every later mount of the tab
  // (tab navigation) and leak into the NEXT trip's timeline, since this
  // workspace component is not keyed by trip id.
  const [timelineFocusDay, setTimelineFocusDay] = useState<number | null>(null)
  const [timelineFocusStop, setTimelineFocusStop] = useState<string | null>(null)
  const [timelineFocusBlock, setTimelineFocusBlock] = useState<'trip-wide' | null>(null)
  const clearTimelineFocus = useCallback(() => {
    setTimelineFocusDay(null)
    setTimelineFocusStop(null)
    setTimelineFocusBlock(null)
  }, [])
  // Deep link from the featured next step (?day=&stop=): a one-shot request,
  // armed only on a timeline address and validated against this trip before
  // it can open or scroll anything. A request for another trip reads as
  // nothing (this workspace outlives trips).
  const deepLinkRef = useRef<{ tripId: string; dayIndex: number; stopId: string | null } | null>(null)
  useEffect(() => {
    if (routeParts(currentRoute())[2] !== 'timeline') return
    const dayRaw = currentQuery().get('day')
    if (dayRaw == null) return
    const dayIndex = Number(dayRaw)
    if (!Number.isInteger(dayIndex) || dayIndex < 0) return
    deepLinkRef.current = { tripId, dayIndex, stopId: currentQuery().get('stop') }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- parse once on mount; tripId only stamps the guard
  }, [])
  useEffect(() => {
    const req = deepLinkRef.current
    if (!req || !trip) return
    deepLinkRef.current = null
    if (req.tripId !== trip.id) return
    if (!canFocusDay(focusDayRequest(req.dayIndex), trip)) return
    setTimelineFocusDay(req.dayIndex)
    setTimelineFocusBlock(null)
    // The stop scrolls only when it really sits on that day. A name the day
    // does not hold falls back to the day focus alone.
    const stopId = req.stopId
    if (stopId && trip.days.some(d => d.index === req.dayIndex && d.stops.some(s => s.id === stopId))) {
      setTimelineFocusStop(stopId)
    }
  }, [trip])
  // #425 PR 1: the shared focus contract lives in lib/tripFocus. The workspace
  // owns the CURRENT focus for the surfaces it hosts; raising a day focus
  // validates the request against THIS trip before it can open anything
  // (a stale/foreign value reads as nothing — the clock walk numbers its own
  // drive days, and this component outlives trips).
  const [focus, setFocus] = useState<TripFocus | null>(null)
  const setFocusedDay = useCallback((dayIndex: number) => {
    if (!trip) return
    if (!canFocusDay(focusDayRequest(dayIndex), trip)) return
    setFocus(normalizeFocus({ tripId: trip.id, dayIndex }))
  }, [trip])
  // #425 PR 2: the surfaces' day axis IS this focus — one selection, derived
  // where it is read. A foreign trip's focus (browser back/forward across
  // trips) reads as 'all', never as another trip's day. `setFocus` is also
  // the clear path: focusForDay(id, null) is the 'all' state.
  const sharedDay = trip ? dayFromFocus(focus, trip.id) : 'all'
  const consumeMapTarget = useCallback(() => setMapTarget(null), [])
  const headerExtraRef = useRef<HTMLDivElement | null>(null)
  const [headerExtraInert, setHeaderExtraInert] = useState(false)
  const headerFolded = foldWorkspaceHeader(tab)

  useEffect(() => {
    if (!headerFolded) {
      // Inertness depends on the live focus location, which render cannot read.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHeaderExtraInert(false)
      return
    }
    const extra = headerExtraRef.current
    const active = document.activeElement
    if (extra && active instanceof Node && extra.contains(active)) {
      document.getElementById(workspaceTabId(tab))?.focus()
    }
    setHeaderExtraInert(true)
  }, [headerFolded, tab])

  useEffect(() => {
    if (headerExtraRef.current) headerExtraRef.current.inert = headerExtraInert
  }, [headerExtraInert])

  // #334 pitfall: this workspace outlives trips (it is not keyed by trip id),
  // so a pending preview must not survive a trip switch — Keep would write one
  // trip's shape into another. Cleared on switch, and said out loud.
  useEffect(() => {
    const left = abandonPreview()
    if (left === 'none') return
    // A Keep in flight or uncertain may already be admitted, so "discarded"
    // would be untrue for it.
    if (left === 'saving') toast('Your last change is still saving on the trip you left.', 'err')
    else if (left === 'uncertain') toast(LEAVE_UNCERTAIN, 'err')
    else toast('Staged change discarded. You switched trips', 'err')
  }, [trip?.id, abandonPreview])

  // F-16: a reload or tab close while a proposed change is pending silently
  // discards the preview the user is studying — ask before leaving. (The soft
  // in-app hash-nav guard from the audit is deliberately skipped: intercepting
  // every hashchange in App would need pending state lifted app-wide, and the
  // beforeunload layer already covers the common accident — F5 / tab close.)
  useEffect(() => {
    if (!pending) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [pending])

  function scrollToDay(dayIndex: number) {
    const el = document.getElementById(`day-card-${dayIndex}`)
    if (!el) return
    const rect = el.getBoundingClientRect()
    const isVisible = rect.top >= 0 && rect.bottom <= window.innerHeight
    if (!isVisible) {
      el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' })
    }
  }

  function openTimeline(target?: TimelineFocusTarget) {
    if (!trip) return
    const next = resolveTimelineFocus(trip, target)
    setTimelineFocusDay(next.dayIndex)
    setTimelineFocusStop(next.stopId)
    setTimelineFocusBlock(next.block)
    if (next.dayIndex != null) setFocusedDay(next.dayIndex)
    setTab('timeline')
  }

  function openMap(target?: MapTarget) {
    if (!trip) return
    const next = resolveMapFocus(trip, target)
    setMapTarget(next.target)
    if (next.dayIndex != null) setFocusedDay(next.dayIndex)
    else setFocus(focusForDay(trip.id, null))
    setTab('map')
  }

  if (!me) return <div className="container page-enter"><StateBlock kind="empty" titleLevel="h1" title="Sign in to open this trip" actions={<button className="btn btn-primary" onClick={() => onNavigate(`/auth?next=${encodeURIComponent(authNext(`/trip/${tripId}`))}`)}>Sign in</button>} /></div>
  if (!trip && readState === 'failed') {
    return <div className="container page-enter"><StateBlock kind="failed" titleLevel="h1" title="Could not open this trip" actions={<button className="btn btn-outline btn-sm" onClick={() => setReadResult(null)}>Try again</button>} /></div>
  }
  if (!trip && readState === 'unavailable') {
    return <div className="container page-enter"><StateBlock kind="empty" titleLevel="h1" art={<Mascot pose="lost" size={140} />} title="Trip not found" body="This trip may be deleted or private, or the link may be wrong." actions={<button className="btn btn-outline btn-sm" onClick={() => onNavigate('trips')}>Back to my trips</button>} /></div>
  }
  if (!trip) {
    return <div className="container page-enter"><StateBlock kind="loading" titleLevel="h1" title="Loading trip" /></div>
  }

  const effective = effectiveTrip ?? trip
  const health = computeHealth(effective, legCorrections)
  const totals = computeTotals(effective, legCorrections)

  /** Move the previewed day's last stop to the day after it. #334: staged
   *  THROUGH applyChange so the sheet's numbers describe what Save will write
   *  (it used to commit on the spot while the pre-move preview was on screen). */
  function moveToAnotherDay() {
    if (!pending || !trip) return
    const dayIndex = pending.result.dayIndex
    const day = pending.proposed.days.find(d => d.index === dayIndex)
    const sorted = day ? [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay) : []
    const last = sorted[sorted.length - 1]
    if (!last || !pending.proposed.days.some(d => d.index === dayIndex + 1)) {
      toast('No later day available to move this stop to.', 'err')
      return
    }
    let carriedTitles: string[] = []
    applyChange(draft => {
      const from = draft.days.find(d => d.index === dayIndex)
      const to = draft.days.find(d => d.index === dayIndex + 1)
      if (!from || !to) return
      const ordered = [...from.stops].sort((a, b) => a.orderInDay - b.orderInDay)
      const moving = ordered[ordered.length - 1]
      if (!moving) return
      if (moveStopToDay(draft.days, moving.id, dayIndex + 1, null)) {
        carriedTitles = carryStopLinkedRecords(draft, moving.id, dayIndex + 1)
      }
    }, 'move-day', dayIndex)
    if (carriedTitles.length > 0) {
      toast(`${carriedTitles.join(', ')} moved to Day ${dayIndex + 2} with the stop — review and keep`)
    }
    toast(`Moved “${last.title}” to Day ${dayIndex + 2}. Review and keep`)
  }

  // The header's cover is the same plan every card draws: the traveller's
  // upload, else the scene that fits the trip's own places, else their emoji.
  const headerPlan = coverPlanFor({
    // Sized on the way in, like every other cover surface, so a Wikimedia
    // original stored before sizing existed is requested at 1200px here too.
    userCover: trip.coverImageUrl ? sizedCoverUrl(trip.coverImageUrl) : '',
    fallbackEmoji: trip.coverEmoji,
    region: regionFor(trip),
    seed: trip.id,
    placeCount: trip.destinations?.length ?? 0,
    destinations: trip.destinations,
    startLocation: trip.startLocation,
  })
  const members = trip.members ?? []
  // One string, so the cover can clamp the line and still offer the whole text
  // as the tooltip (the cover height is sized for a bounded line).
  const headerMeta = `${trip.startLocation} → ${trip.destinations.join(' → ')} · ${fmtDateRange(trip.startDate, trip.endDate)} · ${trip.travellers} travellers · ${cap(trip.transportMode)} · ${cap(trip.travelStyle)}`
  const viewingMemberIds = new Set(presenceRow.kind === 'peers'
    ? presenceRow.peers.map(peer => peer.userId)
    : [])

  return (
    <div className="container page-enter yf-workspace" data-wide={headerFolded ? 'true' : 'false'} data-map-active={tab === 'map' ? 'true' : undefined} data-canvas={headerFolded ? 'true' : undefined} data-map-fullscreen={phoneMapFullscreen ? 'true' : undefined}>
      <div className="yf-page" data-compact={headerFolded ? 'true' : 'false'}>
        <TripArtSprite />
        <header className="yf-trip-head">
          <div className="yf-cover-media" aria-hidden="true">
            <CoverMedia
              plan={headerPlan}
              ratio="16:9"
              sizes="100vw"
              eager
              className="yf-cover-img"
              emojiClassName="yf-cover-emoji"
            />
            {/* The veil sits INSIDE the media so the media's rounded clip owns it,
                exactly as it owns the image. As a sibling it had to round itself,
                and its own antialiased arc let the brighter band fill through as a
                1px line along the cover's left perimeter. */}
            <div className="yf-cover-veil" aria-hidden="true" />
          </div>
          <div className="yf-cover-content">
            <div className="yf-cover-top">
              <button type="button" className="yf-back" onClick={() => onNavigate('trips')}>← All trips</button>
              {editable && (
                <button type="button" className="btn btn-outline btn-sm yf-invite" onClick={() => setTab('share')}>Invite & share</button>
              )}
            </div>
            <div className="yf-head-row">
              <div className="yf-head-text">
                <h1 className="yf-header-title yf-trip-title" title={trip.name}>{trip.name}</h1>
                <div className="yf-fold">
                  <div className="yf-fold-in">
                    <p className="yf-head-meta yf-fade" title={headerMeta}>{headerMeta}</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="yf-extra" ref={headerExtraRef}>
              <div className="yf-fade">
                <div className="yf-members" aria-label="Members">
                  <span className="yf-avatars">
                    {(() => {
                      const tones = assignAvatarTones(members.map(member => member.userId))
                      return members.map((member, index) => {
                        const person = userById(member.userId)
                        const name = person?.profile.name ?? 'Member'
                        const viewing = viewingMemberIds.has(member.userId)
                        const state = viewing ? 'viewing now' : 'member'
                        return (
                          <span key={member.userId} className="yf-member" tabIndex={0}
                            aria-label={`${name}, ${state}`}>
                            <Avatar user={person} tone={tones[index]} />
                            {viewing && <span className="yf-member-dot" aria-hidden="true" />}
                            <span className="yf-tip" role="tooltip">{name} · {state}</span>
                          </span>
                        )
                      })
                    })()}
                  </span>
                  <span className="yf-member-note">
                    <b>{members.length} member{members.length === 1 ? '' : 's'}</b>{role ? ` · you are ${role}` : ''}
                  </span>
                  {presenceRow.kind === 'peers' ? (
                    <span className="yf-viewing" aria-label={`${presenceRow.peers.length} viewing now`}>
                      <i aria-hidden="true" />{presenceRow.peers.length} viewing now
                    </span>
                  ) : presenceRow.kind === 'solo' ? (
                    <span className="yf-viewing" aria-label="Only you are viewing this trip right now">
                      <i aria-hidden="true" />Just you viewing
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <SegmentedTabs className="tabbar yf-tabbar" semantics="tablist" label="Trip sections" value={tab} ink
              onChange={key => { if (isTabKey(key)) setTab(key) }}
              items={TABS.map(([key, label]) => ({
                key,
                label,
                id: workspaceTabId(key),
                controls: workspacePanelId(key),
                count: key === 'group' ? db.suggestions.filter(s => s.tripId === trip.id && s.status === 'open').length
                  + db.decisions.filter(d => d.tripId === trip.id && d.status === 'open').length : undefined,
              }))} />
          </div>
        </header>
      </div>

      {TABS.map(([key]) => <div className="tab-panel" key={key} role="tabpanel" id={workspacePanelId(key)} aria-labelledby={workspaceTabId(key)} hidden={tab !== key}>
      {tab === key && <>
      {/* The Overview matrix reads the SAME corridor halts and the SAME road
          measurement the Map tab does — taken from the suggestion cache, so it
          costs no fetch and the two surfaces cannot disagree about a day. */}
      {tab === 'overview' && <OverviewTab trip={effective} editable={editable} onOpenDecisions={() => setTab('group')} onOpenTimeline={openTimeline} onOpenMap={openMap} onInvite={() => setTab('share')} health={health} totals={totals} road={road} corridorSegments={suggestionCache.cache.map?.segments} mapInputs={mapInputs} mapCache={suggestionCache.cache.map} />}
      {/* key: the timeline holds per-trip view state (open-day accordion) —
          remount it when the workspace switches trips (e.g. browser back/forward). */}
      {tab === 'timeline' && <TimelineTab key={effective.id} trip={effective} editable={editable} applyChange={applyChange} previewOpen={!!pending} legCorrections={legCorrections} roadStatus={road.status} suggestionCache={suggestionCache} journeyDays={journeyDays} onOpenBoard={() => setTab('board')} focusDay={timelineFocusDay} focusStopId={timelineFocusStop} focusBlock={timelineFocusBlock} onFocusConsumed={clearTimelineFocus} projectedWriter={projectedWriterHop} identityGeneration={identityGeneration} ownerTripId={tripId} projectedController={timelineWriterController} projectedAvailability={projectedAvailability} />}
      {tab === 'board' && (
        <React.Suspense fallback={<StateBlock kind="loading" size="compact" title="Loading board" />}>
          <BoardView trip={effective} editable={editable} applyChange={applyChange} health={health} totals={totals} legCorrections={legCorrections} previewOpen={!!pending} road={road}
            onOpenOverview={() => setTab('overview')} onOpenTimeline={() => setTab('timeline')}
            dayFocus={sharedDay} onDayFocusChange={(day) => setFocus(focusForDay(trip!.id, day === 'all' ? null : day))} />
        </React.Suspense>
      )}
      {tab === 'map' && (
        <React.Suspense fallback={<MapTabSkeleton />}>
          <MapTab trip={effective} editable={editable} applyChange={applyChange}
            onBackToTrip={() => setTab('overview')}
            suggestionCache={suggestionCache} onInputsHash={publishMapInputs}
            onCorridorState={publishCorridor}
            journeyDays={journeyDays} presence={journeyDays.presence} crewSeeds={crewSeeds} roadBinding={roadBinding} currentRoad={currentRoadBinding}
            dnaVector={dnaVector ?? undefined} dnaTick={dnaTick} setDnaTick={setDnaTick}
            setAddedIds={setAddedIds}
            dismissedIds={dismissedIds} setDismissedIds={setDismissedIds}
            setStagedSnapshot={setStagedSnapshot} stagedIdsRef={stagedIdsRef}
            slotManual={slotManual} setSlotManual={setSlotManual}
            road={road}
            onOpenTimeline={stopId => openTimeline({ stopId })} onOpenBoard={() => setTab('board')}
            onOpenDay={dayIndex => openTimeline({ dayIndex })}
            onOpenGroupInput={() => setTab('group')} previewOpen={!!pending}
            dayFocus={sharedDay} legCorrections={legCorrections}
            mapTarget={mapTarget} onMapTargetConsumed={consumeMapTarget}
            onDayFocusChange={(day) => { setFocus(focusForDay(trip!.id, day === 'all' ? null : day)); if (day !== 'all') setTimelineFocusDay(day) }} />
        </React.Suspense>
      )}
      {tab === 'group' && <GroupInputTab trip={effective} editable={editable} me={me} previewOpen={!!pending} slotResolution={groupInputResolution} />}
      {tab === 'budget' && <BudgetTab key={editable ? 'budget-edit' : 'budget-view'} trip={effective} totals={totals} editable={editable} previewOpen={!!pending} stagedRef={pendingRef} onOpenSettings={() => setTab('settings')} />}
      {tab === 'share' && <ShareTab trip={trip} me={me} editable={editable} onNavigate={onNavigate} legCorrections={legCorrections} />}
      {/* key=trip.id: TripSettingsForm holds local draft state in useState
           seeded from the trip at mount and never re-syncs, so without the key
           a quick trip-switch keeps the previous trip's draft visible until a
           reload (#213). */}
      {tab === 'settings' && <TripSettingsForm key={trip.id} trip={trip} editable={editable} legCorrections={legCorrections} onOpenDay={dayIndex => openTimeline({ dayIndex })} onOpenShare={() => setTab('share')} />}
      </>}</div>)}

      {/* The impact sheet is position:fixed, so it paints in the same place either
          way — but it renders AFTER the tab panel so that Tab from the row just
          edited reaches Keep / Remove without first walking the whole workspace. */}
      {pending && (
        <ImpactPreviewPanel
          result={pending.result}
          busy={!!pending.busy}
          uncertain={!!pending.uncertain}
          onKeep={keepPending}
          onMoveDay={moveToAnotherDay}
          onRemove={removePending}
          onScrollToDay={scrollToDay}
        />
      )}

      {/* AI companion: locked for the premium milestone (M8) — the feature is
          complete but unmounted unless VITE_AI_COMPANION=on. See featureFlags. */}
      {AI_COMPANION_ENABLED && (
        <AiDrawer key={trip.id} trip={trip} open={aiOpen} onOpen={() => setAiOpen(true)} onClose={() => setAiOpen(false)} legCorrections={legCorrections} />
      )}
    </div>
  )
}

// ================= Real-road distance refinement (ONE measurement, #188) =================

/**
 * The trip's single road measurement. Owns the one `routePath` chain (with its
 * one retry) and hands out both consumers: the engine's leg corrections (budget,
 * fatigue, warnings — every tab) and the Map tab's road view (line, totals,
 * per-day km, suggestion corridor).
 *
 * Before #188 the workspace and the Map tab each measured the same chain, which
 * doubled the load on the shared OSRM demo server and let the map draw a road
 * the detour math could not see. The chain measured here is a superset of the
 * Map tab's points, so its legs are a strict prefix — see tripRoad.ts.
 */
function useTripRoad(trip: Trip | null | undefined): {
  corrections: Record<string, LegEstimate> | undefined
  road: TripRoadView
} {
  // #213 Phase 3: chain memo depends on roadChainSig(trip), NOT on trip itself.
  // `mutateTrip` clones the trip on every save, so the old `[trip]` dep re-built
  // the chain (and re-measured the OSRM chain, via the effect below) on every
  // fuel/crew/budget/dates tweak. roadChainSig hashes ONLY the geometry fields,
  // so a non-geometry save keeps the chain (and the existing legs) stable —
  // totals don't blink to haversine, the corridor search isn't re-planned, and
  // the split/clock verdicts keep their numbers.
  const chainSig = trip ? roadChainSig(trip) : ''
  const chain = useMemo(() => (trip ? buildRoadChain(trip) : null), [chainSig])
  const [state, setState] = useState<{ status: RoadStatus; legs: TripRoadView['legs'] }>({ status: 'pending', legs: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // Nothing to measure is not a failure: no trip, or a single point.
    if (!trip || !chain || chain.points.length < 2) {
      setState({ status: 'ok', legs: [] })
      return
    }
    // A mode the routing layer cannot describe must never be measured as a
    // road. Google Routes has no FLYING travelMode (the request errors) and
    // OSRM's endpoint is hardcoded to `/driving/`, so asking either for a
    // flight trip answers with ROAD directions — which is exactly what used to
    // get drawn as the map's line and read as the trip's travel time. Skip the
    // request entirely: the engine's air model owns those numbers, and the
    // quota that measurement would have spent is simply not spent.
    if (!isRoadMeasuredMode(trip.transportMode)) {
      setState({ status: 'ok', legs: [] })
      return
    }
    let cancelled = false
    // #325: two layers, two jobs. The flag guards `setState`; the controller stops
    // the network work. Without the abort the whole OSRM chain (and its parallel
    // per-leg fallbacks) ran to completion behind the flag — burning quota on a
    // trip the user had already left. And because a trip switch unmounts nothing
    // here, a late result could still land on the next trip's view.
    const controller = new AbortController()
    setState({ status: 'pending', legs: null })
    measureRoadChain(chain.points, getAssumptions(trip), { signal: controller.signal }).then(outcome => {
      if (cancelled) return
      setState(outcome.ok ? { status: 'ok', legs: outcome.legs } : { status: 'failed', legs: null })
    })
    return () => { cancelled = true; controller.abort() }
    // chain reflects chainSig; trip is read for assumptions only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainSig, chain, attempt])

  const retry = useCallback(() => setAttempt(a => a + 1), [])

  // The engine only takes road numbers for ground modes (OSRM is driving-only);
  // anything else — and a failed or still-pending measurement — leaves the
  // deterministic haversine engine in charge, exactly as before.
  const roadMode = !!trip?.transportMode && isRoadMeasuredMode(trip.transportMode)
  const corrections = useMemo(() => {
    if (!trip) return undefined
    if (!chain || !roadMode || chain.points.length < 2) return {}
    if (state.status === 'pending' || !state.legs) return undefined
    return correctionsFromLegs(chain, state.legs)
  }, [chain, roadMode, state])

  const road = useMemo<TripRoadView>(
    () => ({ chain, legs: state.legs, status: state.status, retry }),
    [chain, state, retry],
  )

  return { corrections, road }
}

function fmtDateRange(a: string, b: string): string {
  const opt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${new Date(a).toLocaleDateString('en-IN', opt)} – ${new Date(b).toLocaleDateString('en-IN', { ...opt, year: 'numeric' })}`
}
