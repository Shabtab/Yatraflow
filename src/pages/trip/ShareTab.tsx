// ============ Trip workspace — Share tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
// Includes SnapshotCard — ShareTab is its only consumer.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { InlineIcon } from '../../components/icons'
import { CalendarDays, ChevronRight, Download, Link2, Lock } from 'lucide-react'
import type { Trip, PublishedItinerary } from '../../data/types'
import { useDb, userById, setMemberRole, removeMember, restoreMember, readMemberAccess, publishItinerary, unpublishItinerary, ensureInviteCode, rereadPublicSlices, setInviteRole, resetInviteLink, type InviteLinkOutcome } from '../../store/store'
import type { AccessMember, MemberAccessState } from '../../lib/memberAccess'
import { encodeTripSnapshot, snapshotUrl, downloadTripJson } from '../../lib/snapshot'
import { ImportTripButton } from '../../components/ImportTripButton'
import { CoverImagePicker } from '../../components/CoverImagePicker'
import { currentPublicShareUrl, withShareRef } from '../../lib/shareUrl'
import { downloadTripIcs } from '../../lib/ics'
import { nativeCopyText, openExternal } from '../../lib/native'
import { whatsAppSendUrl } from '../../lib/whatsAppShare'
import { tripInviteMessage } from '../../lib/inviteShareText'
import { computeTotals, formatInr, type LegEstimate } from '../../lib/engine'
import { publishablePlannedKm } from '../../lib/creatorFacts'
import { publishableStateCodes } from '../../lib/routeStates'
import { netOfFeeInr, PLATFORM_FEE_SUMMARY } from '../../lib/earnings'
import {
  publishValidation, PUBLISH_FIELD_ORDER, PUBLISH_FIELD_LABELS, PublishRejected, type PublishField,
} from '../../lib/publishRules'
import { takePublishDraft } from '../../lib/publishDraft'
import { publishFormKey, publishFormMount } from '../../lib/publishFormKey'
import { Mascot } from '../../components/mascot/Mascot'
import { pubArtId } from '../../lib/pubDayArt'
import { artCoverOrigin, artCoverUrl } from '../../lib/artCover'
import { sliceState, rowsView, type ReadState, type RowsView } from '../../lib/readState'
import type { PublicationDraft } from '../../lib/itinerarySpec'
import { Avatar, Chip, ConfirmDialog, CopyButton, Field, FormErrorSummary, Modal, toast, undoToast, useMedia } from '../../components/ui'
import { StateBlock } from '../../components/page/StateBlock'
import { Surface } from '../../components/page/Surface'
import { PrintExport } from '../../components/PrintExport'
import { SegmentedTabs } from '../../components/page/SegmentedTabs'
import { presenceAttrs, usePresenceList } from '../../lib/usePresenceList'
import { cap, timeAgo } from './shared'

// The three-column layout starts here (#1012). The same width is written in
// src/styles/legacy/05-share-and-trip-ticket.css; tests pin both values.
const SHARE_WIDE_QUERY = '(min-width: 1100px)'
// The link role, as the Joins as control and the read-only line name it (#1012).
const ROLE_LABEL = { editor: 'Editor', viewer: 'Viewer' } as const
const ROLE_ITEMS = [{ key: 'editor', label: 'Editor' }, { key: 'viewer', label: 'Viewer' }] as const

function mailtoUrl(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

// ================= Snapshot (export / import / URL share) =================

function SnapshotCard({ trip, me, onNavigate, legCorrections, publication }: {
  trip: Trip
  me: { id: string }
  onNavigate: (r: string) => void
  legCorrections?: Record<string, LegEstimate>
  /** The trip's publication row, when it has one — carried in the exported
   *  file's `publication` block so a shared file keeps its shelf metadata. */
  publication?: Record<string, unknown>
}) {
  const [link, setLink] = useState('')
  // #391 — the encode is async and can reject (`CompressionStream` is
  // unavailable in some browsers, and a large trip can exceed the URL budget),
  // so this used to leave a button that did nothing at all: no link, no message,
  // no sign anything happened. `busy` also stops a rapid second click from
  // racing the first into a stale link (AGENTS §6a's input-guard rule).
  const [busy, setBusy] = useState(false)

  async function makeLink() {
    if (busy) return
    setBusy(true)
    try {
      const payload = await encodeTripSnapshot(trip)
      const url = snapshotUrl(trip, payload)
      setLink(url)
      void nativeCopyText(url)
      toast('Snapshot link copied. Anyone with the link can read the trip, and you cannot revoke it')
    } catch (e) {
      console.error('[yatraflow] snapshot encode failed', e)
      // The raw failure names CompressionStream or a URL-length error; neither
      // is anything a reader can act on, so the message says what to do instead
      // and the cause stays in the console.
      toast('Couldn’t build a snapshot link for this trip. The plan may be too large for a URL. Download the JSON instead.', 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Surface className="card shr-panel">
      <span className="share-intent share-intent--info">3 · Keep a record</span>
      <h3 className="shr-card-title">Take it with you</h3>
      <p className="hint-text shr-snapshot-description">
        Anyone with a snapshot link can read the whole trip, and you cannot take the link back. The trip sits inside
        the link, so no server keeps a copy.
      </p>
      <div className="shr-take-list">
        <button type="button" className="shr-take-row" title="One calendar event per day plus timed events for flights and fixed commitments. Imports into Google/Apple/Outlook calendars"
          onClick={() => downloadTripIcs(trip, legCorrections)}>
          <span className="shr-take-icon"><InlineIcon icon={CalendarDays} size={16} gap={0} /></span>
          <span className="shr-take-text"><b className="small">Add to calendar</b><span className="small muted">One event per day, plus timed events</span></span>
          <InlineIcon icon={ChevronRight} size={16} gap={0} />
        </button>
        <PrintExport trip={trip} legCorrections={legCorrections} variant="row" />
        <button type="button" className="shr-take-row" onClick={() => downloadTripJson(trip, publication)}>
          <span className="shr-take-icon"><InlineIcon icon={Download} size={16} gap={0} /></span>
          <span className="shr-take-text"><b className="small">Download JSON</b><span className="small muted">Everything, to keep or import later</span></span>
          <InlineIcon icon={ChevronRight} size={16} gap={0} />
        </button>
        <button type="button" className="shr-take-row" onClick={makeLink} disabled={busy} aria-busy={busy}>
          <span className="shr-take-icon"><InlineIcon icon={Link2} size={16} gap={0} /></span>
          <span className="shr-take-text"><b className="small">{busy ? 'Building…' : 'Create snapshot link'}</b><span className="small muted">One link holds the whole plan</span></span>
          <InlineIcon icon={ChevronRight} size={16} gap={0} />
        </button>
      </div>
      <ImportTripButton ownerId={me.id} onNavigate={onNavigate} className="btn btn-ghost btn-sm" />
      {link && (
        <div className="share-link-box shr-snapshot-link">
          <code className="shr-snapshot-url" title={link}>{link}</code>
          <CopyButton text={link} label="Copy" />
        </div>
      )}
    </Surface>
  )
}

// ================= Publication editor (free/premium picker) =================

const DEFAULT_TRAVEL_TIPS = ['Start ghat-section drives early.', 'Carry cash in hill towns.']
const DEFAULT_WARNINGS = ['All costs are estimates based on typical prices. Verify locally before booking.']

// The publish rules, the price ceiling, the field order and the refusal type all
// live in `lib/publishRules` (#354) because `publishItinerary` enforces the same
// ones — see that module for why one derivation beats two copies. This form is
// the surface that RENDERS them: it maps each field key to a control, a focus
// target and a polite message, and the summary turns the first key into the one
// assertive announcement.

/** Per-day free/premium picker + pricing/CTA form for the public itinerary.
 *  Replaces the hardcoded freeDayIndexes [0] / ₹199 publish payload: the owner
 *  now chooses which days are the free preview, whether the itinerary is
 *  premium at all (empty/₹0 price = entirely free), and the reader-facing
 *  copy — pre-filled from the live publication when updating. */
function PublicationForm({ trip, pub, draft, live = true, isOwner, creatorId, onDone, onWriting, saveErr, setSaveErr, publishRead, legCorrections, hiddenCard }: {
  legCorrections?: Record<string, LegEstimate>
  trip: Trip
  pub: PublishedItinerary | undefined
  /** An imported file's publish block, taken once from the stash. The draft
   *  is an offer the creator reviews, never a publish: the form's own rules
   *  and submit path still decide what may go live. */
  draft?: PublicationDraft | null
  /** Whether that row is up on Explore right now (#350). False while it is
   *  soft-unpublished: the form keeps the row as its prefill — the creator
   *  should not retype their tagline — but its button offers publishing again
   *  rather than "update", because nothing is live to update. */
  live?: boolean
  isOwner: boolean
  creatorId: string
  onDone: (published: boolean) => void
  /** Reports the start and the end of each write. The parent holds the form's
   *  key still while a write is in flight, so a write never remounts the form
   *  (#704). */
  onWriting: (writing: boolean) => void
  /** The inline write error, held by the parent so a remount cannot drop it (#704). */
  saveErr: string | null
  setSaveErr: (message: string | null) => void
  /** The publish status read. The form can stay open while it is pending or
   *  failed, but its submit waits for a read that succeeded (#704). */
  publishRead: ReadState
  /** The hidden-from-public card. It sits just above Publish, where the owner reads it last. */
  hiddenCard?: ReactNode
}) {
  const defaultTagline = `${trip.days.length}-day ${trip.travelStyle} trip through ${trip.destinations.join(', ')}.`
  // The draft wins over a live row: it is the freshest intent the creator
  // was just offered. Every field falls back to the row, then the default.
  const [free, setFree] = useState<Set<number>>(() => new Set(draft?.freeDayIndexes ?? pub?.freeDayIndexes ?? [0]))
  const [price, setPrice] = useState(() => {
    const priced = draft?.premiumPriceInr ?? pub?.premiumPriceInr
    return priced != null ? String(priced) : ''
  })
  const [tagline, setTagline] = useState(draft?.tagline ?? pub?.tagline ?? defaultTagline)
  const [bestSeason, setBestSeason] = useState(draft?.bestSeason ?? pub?.bestSeason ?? '')
  const [tips, setTips] = useState(() => (draft?.travelTips ?? pub?.travelTips ?? DEFAULT_TRAVEL_TIPS).join('\n'))
  const [cta, setCta] = useState(draft?.subscriberCta ?? pub?.subscriberCta ?? '')
  // #1012 R2: Free or Premium is a choice of its own. A saved price above zero opens on Premium.
  const [premium, setPremium] = useState(() => Number(price) > 0)
  // The reader-facing copy sits behind "More details". It opens when any of it differs from the default.
  const [moreOpen, setMoreOpen] = useState(() =>
    tagline !== defaultTagline || bestSeason !== '' || tips !== DEFAULT_TRAVEL_TIPS.join('\n') || cta !== '')
  // #389 — F-15, ported from CreateTrip rather than invented a second time.
  // The form had ONE `err: string` driving ONE `role="alert"` banner at the
  // bottom: a screen-reader user heard "Premium days need a call-to-action" and
  // a sighted user had to work out which of six fields it meant, with focus
  // left on the submit button. Six rules, four fields — so `errs` is keyed by
  // FIELD and the summary reads its first key. `saveErr` is deliberately NOT in
  // that map: a failed WRITE is not a field's fault, and pointing at the price
  // box for it would be a lie.
  const [errs, setErrs] = useState<Record<string, string>>({})
  /** first-invalid focus targets (F-15) — plain inputs and the day picker only */
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({})
  // #1012: the cover is compact until someone asks to change it, or until it
  // holds a message. The picker is mounted only while it is open, so a cover
  // error always opens it first and the focus target exists before focus moves.
  const [coverOpen, setCoverOpen] = useState(false)
  // A publish is a network write, and this button was the only publish control
  // in the app without a busy state (#388). Two clicks fired two upserts, two
  // `refreshedAt` stamps and two toasts — the duplicate was only prevented by
  // accidental id-reuse in the store, which is not a guard. The cover picker's
  // `busy` is the pattern this copies.
  const [busy, setBusy] = useState(false)
  // #704: a form can stay open while the status is pending or failed. An unread
  // status cannot say whether the trip already has a publication, so submit waits
  // for a read that succeeded. The reason is shown beside the button.
  const publishReady = publishRead === 'ready'
  const publishBlockedReason = publishRead === 'failed'
    ? 'Publishing is paused until this trip’s Explore status loads. Try again above.'
    : 'Publishing waits until this trip’s publish status has loaded.'

  const priceNum = price.trim() === '' ? 0 : Number(price)
  // Free means Premium is off. publishValidation refuses a Premium price of 0.
  const entirelyFree = !premium
  const allIndexes = trip.days.map(d => d.index)
  const hasPremiumDay = !entirelyFree && free.size < trip.days.length
  // The publication's cover defaults to the generated scene that fits the
  // plan, so a creator never ships a Wikipedia photo the app picked on its own.
  // The picker can replace this choice with an upload or a pasted URL.
  const planPlaces = [trip.startLocation, ...trip.destinations]
  const defaultArtId = pubArtId({ seed: `${trip.id}:cover`, slotPlaces: [], planPlaces })
  const defaultArtUrl = defaultArtId ? artCoverUrl(defaultArtId, artCoverOrigin()) : null
  const defaultArt = defaultArtId && defaultArtUrl ? { id: defaultArtId, url: defaultArtUrl } : null
  const coverSrc = trip.coverImageUrl?.trim() || defaultArt?.url || null
  const coverEditing = coverOpen || !!errs.cover
  // The details region stays open while its CTA holds an error, as the cover picker does.
  const moreEditing = moreOpen || !!errs.cta
  // The one-line preview under the day tiles, in words.
  const planLine = entirelyFree
    ? 'Entirely free. Every day is viewable.'
    : free.size >= trip.days.length
      ? 'Every day is free. Lock at least one day to charge.'
      : `${free.size} of ${trip.days.length} days free. The other ${trip.days.length - free.size} are premium${priceNum > 0 ? ` at ${formatInr(priceNum)}` : ''}.`

  /** #389 — one field's edit clears that field's message and nothing else, so
   *  fixing the price does not wipe a still-true complaint about the CTA. */
  const clearErr = (field: string) => setErrs(prev => {
    if (!(field in prev)) return prev
    const next = { ...prev }
    delete next[field]
    return next
  })

  /** Premium turns the price field on. That field takes focus once it mounts. */
  function choosePremium() {
    setPremium(true)
    setSaveErr(null)
    window.setTimeout(() => fieldRefs.current.price?.focus(), 0)
  }

  /** Free clears the price, and the price and free-day messages that no longer apply. */
  function chooseFree() {
    setPremium(false)
    setPrice('')
    setSaveErr(null)
    setErrs(prev => {
      const next = { ...prev }
      delete next.price
      delete next.freeDays
      return next
    })
  }

  /** F-15: focus the FIRST invalid field in the order the checks run, so a
   *  keyboard user is taken to the topmost thing needing a fix. A field with no
   *  focusable element of its own falls back to its own message. */
  function focusFirstInvalid(bad: Record<string, string>) {
    const first = PUBLISH_FIELD_ORDER.find(k => k in bad)
    const target = first ? fieldRefs.current[first] : null
    if (target) target.focus()
    else {
      const firstErr = document.querySelector<HTMLElement>('.err-text')
      if (firstErr) { firstErr.setAttribute('tabindex', '-1'); firstErr.focus() }
    }
  }

  /** A cover error opens the picker, and a CTA error opens More details. Either one
   *  mounts its focus target, so focus waits one tick for the DOM to show it. */
  function reportErrors(bad: Record<string, string>) {
    if (bad.cover) setCoverOpen(true)
    if (bad.cta) setMoreOpen(true)
    if (bad.cover || bad.cta) window.setTimeout(() => focusFirstInvalid(bad), 0)
    else focusFirstInvalid(bad)
  }

  function toggleDay(index: number) {
    if (free.has(index) && free.size <= 1) {
      // Tagged to the DAY PICKER, which is the control the message is about —
      // and it used to be a form-wide `err` the reader could not locate.
      setErrs(prev => ({ ...prev, freeDays: 'At least one day must stay free. It is the preview readers see.' }))
      return
    }
    setErrs(prev => {
      const next = { ...prev }
      // Both free-day rules are decided by the count this toggle changes, so
      // fixing the count legitimately clears both.
      delete next.freeDays
      delete next.allFree
      return next
    })
    setFree(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index); else next.add(index)
      return next
    })
  }

  async function submit() {
    // Guard first, and by STATE rather than by the button: a click that arrives
    // while a write is in flight is dropped, so a double-click cannot become two
    // publishes (AGENTS §2.6a — every async path needs an input guard, and the
    // guard must match the visual feedback state).
    if (busy) return
    // #704: the same rule as the disabled button, enforced again here.
    if (!publishReady) return
    // The publication's cover IS the link preview: api/i.js serves it as
    // og:image/twitter:image. A chosen photo wins; otherwise the generated
    // artwork for the plan is stored, so the link never falls to the brand card.
    // A URL the handler's `^https://\S+$` test rejects still refuses to publish.
    const cover = trip.coverImageUrl?.trim() || defaultArt?.url
    // #354 — these six rules are no longer the FORM's alone: `publishItinerary`
    // now refuses the same set, so a direct store caller cannot publish a row
    // the paywall would price but the preview shows fully. The MESSAGES live in
    // `publishValidation` (below) and this form renders whatever it returns, so
    // there is one message per rule rather than two that can drift — and the
    // writer's refusal and this form's are literally the same string.
    const next = publishValidation({
      coverImageUrl: cover,
      priceNum, entirelyFree,
      freeDayCount: free.size,
      totalDays: trip.days.length,
      cta: cta.trim(),
      hasPremiumDay,
    })
    setErrs(next)
    setSaveErr(null)
    if (Object.keys(next).length) {
      reportErrors(next)
      return
    }
    setBusy(true)
    onWriting(true)
    try {
      // AWAITED (#388). The old call was fire-and-forget, so `onDone` — and
      // with it the "Published to Explore" toast — fired while the write was
      // still in flight; a later failure then rolled back under a success
      // message. The toast is now a statement about a resolved outcome.
      const outcome = await publishItinerary({
        tripId: trip.id, creatorId,
        title: trip.name,
        // The TRIMMED value the rule above validated, not the raw field. The
        // handler's `^https://\S+$` test never trims, so storing the padded
        // original shipped a link that previewed as the brand card (#360).
        coverImageUrl: cover,
        tagline: tagline.trim() || defaultTagline,
        routeSummary: [trip.startLocation, ...trip.destinations],
        durationDays: trip.days.length,
        plannedKm: publishablePlannedKm(computeTotals(trip, legCorrections).totalDistanceKm),
        // G3b: the shape module loads here only, so the storefront never carries
        // it. A failed load sends undefined, and the publish still proceeds.
        stateCodes: await publishableStateCodes(trip),
        estimatedBudgetPerPersonInr: trip.budgetPerPersonInr,
        travelStyle: trip.travelStyle,
        bestSeason: bestSeason.trim() || undefined,
        travelTips: tips.split('\n').map(s => s.trim()).filter(Boolean),
        warningsAndAssumptions: DEFAULT_WARNINGS,
        freeDayIndexes: entirelyFree ? allIndexes : [...free],
        premiumPriceInr: entirelyFree ? undefined : priceNum,
        subscriberCta: cta.trim() || undefined,
      })
      // Only an accepted write reports success (#704). A refused one shows its
      // message beside the button, and the form keeps the user's edits.
      if (!outcome.ok) {
        setSaveErr(outcome.error ?? 'Could not save the publication. Nothing was published. Try again.')
        return
      }
      onDone(Boolean(pub) && live)
    } catch (e) {
      // #354/#389 — a REFUSAL is not a failed write. The writer raises it before
      // touching anything, so the form's own messages go back on their fields and
      // focus moves to the first of them; no banner, because nothing went wrong
      // and nothing was lost. A genuine write failure keeps the assertive banner,
      // since the reader does need to know the publication did not happen.
      if (e instanceof PublishRejected) {
        setErrs(e.errors)
        reportErrors(e.errors)
        return
      }
      // `saveErr`, not `errs`: a write that failed is not a field's fault, and
      // pointing at the price box for a dropped connection would be a lie.
      setSaveErr('Could not save the publication. Nothing was published. Try again.')
    } finally {
      setBusy(false)
      onWriting(false)
    }
  }

  return (
    <div className="ts-form">
      {/* #389 — the ONE assertive announcement for this form, naming the FIELD
          as well as the complaint. The messages below stay polite, so a
          three-field failure interrupts once rather than three times (the
          CreateTrip F-15 split, not a new system). Mounted at the top of the
          form so it is not below the fold of a long publication editor. */}
      <FormErrorSummary errors={errs} labels={PUBLISH_FIELD_LABELS} />
      <div className="ts-subhead">
        <b>Cover</b>
        <span className="small muted">Your artwork shows by default. Upload or paste a photo to replace it.</span>
      </div>
      {/* #1012 — the compact cover: the trip's own image, its chip and a Change
          action. The picker below is the same control as before; it opens on
          Change and stays open while it holds a message (#389). */}
      <div className="shr-cover">
        {coverSrc && <img src={coverSrc} alt="" />}
        <span className="shr-cover-chip">Cover · shows on every shared link</span>
        <button type="button" className="btn btn-outline btn-sm shr-cover-change" aria-expanded={coverEditing}
          disabled={!isOwner} onClick={() => setCoverOpen(open => !open)}>
          {coverEditing ? 'Done' : 'Change'}
        </button>
      </div>
      {/* The picker is mounted only while the cover is open. Two of the six rules
          are about this control, and it took no `error` prop — so the wrapper
          carries the focus target: the picker is a group of buttons, and its own
          message node is the focusable fallback. */}
      {coverEditing && (
        <div ref={el => { fieldRefs.current.cover = el }} tabIndex={-1}
          aria-invalid={errs.cover ? true : undefined}
          aria-describedby={errs.cover ? 'pub-cover-err' : undefined}>
          <CoverImagePicker trip={trip} editable={isOwner} error={errs.cover ?? null} defaultArt={defaultArt} />
        </div>
      )}
      {!trip.coverImageUrl && (
        <p className="hint-text ts-note">
          {defaultArt
            ? 'This publication will use the generated artwork for your route. Upload or paste a photo to replace it.'
            : 'The generated artwork for this route is not available here, so publish needs a photo.'}
        </p>
      )}
      {/* The picker's own message wins over the form's, so this is a fallback:
          it only shows when the picker has nothing of its own to say. */}
      {errs.cover && !coverEditing && <p className="err-text" id="pub-cover-err" role="status" aria-live="polite">{errs.cover}</p>}
      {/* Free or Premium. The control is two pressed buttons, so its glider moves
          between them. Premium opens the price field, and Free clears the price. */}
      <div className="ts-subhead"><b>Access</b></div>
      <SegmentedTabs semantics="toggle" className="shr-seg" label="Free or Premium"
        value={premium ? 'premium' : 'free'} onChange={key => (key === 'premium' ? choosePremium() : chooseFree())}
        items={[{ key: 'free', label: 'Free' }, { key: 'premium', label: premium && priceNum > 0 ? `Premium · ${formatInr(priceNum)}` : 'Premium' }]} />
      {premium && (
        <Field label="Premium price (₹)" error={errs.price} hint={priceNum > 0
          // The floor, not the rate: a price seen alone can only promise the least
          // a creator keeps. Floored, because formatInr rounds up.
          ? `At ${formatInr(priceNum)} a sale nets you at least ${formatInr(Math.floor(netOfFeeInr(priceNum)))}. The platform fee is ${PLATFORM_FEE_SUMMARY}.`
          : 'Enter the price readers pay to unlock the premium days.'}>
          <input className="input" type="number" min={0} inputMode="numeric" placeholder="e.g. 199"
            ref={el => { fieldRefs.current.price = el }}
            value={price} onChange={e => { setPrice(e.target.value); clearErr('price'); setSaveErr(null) }} />
        </Field>
      )}

      <div className="ts-subhead">
        <b>Free preview days</b>
        <span className="small muted">{planLine}</span>
      </div>
      {/* The group takes focus, not one day, because the choice belongs to the group. */}
      <div className="shr-day-grid" ref={el => { fieldRefs.current.freeDays = el }} tabIndex={-1}
        role="group" aria-label="Free preview days"
        aria-invalid={errs.freeDays ? true : undefined}
        aria-describedby={errs.freeDays ? 'pub-free-err' : undefined}>
        {trip.days.map(d => {
          const isFree = entirelyFree || free.has(d.index)
          const name = `Day ${d.index + 1}${d.title ? ` · ${d.title}` : ''}`
          return (
            // A small square tile. Its pressed state (premium) and its label are the same as the old row.
            <button key={d.id} type="button" className={`shr-day-tile${isFree ? ' is-free' : ''}`}
              disabled={entirelyFree} aria-pressed={!isFree} title={name}
              aria-label={`${name}: ${isFree ? 'Free' : 'Premium'}`}
              onClick={() => toggleDay(d.index)}>
              <span className="shr-day-tag">Day</span>
              <span className="shr-day-num">{d.index + 1}</span>
              {!isFree && <InlineIcon icon={Lock} size={10} gap={0} />}
            </button>
          )
        })}
      </div>
      {/* Field-tied, so the message is polite. The summary above carries the assertive announcement. */}
      {errs.freeDays && <p className="err-text" id="pub-free-err" role="status" aria-live="polite">{errs.freeDays}</p>}

      <button type="button" className="btn btn-ghost btn-sm shr-more-toggle" aria-expanded={moreEditing}
        aria-controls="pub-more-details" onClick={() => setMoreOpen(open => !open)}>
        More details
      </button>
      {/* The copy the reader sees. Hidden, not unmounted, so every field ref stays
          attached while the region is closed. */}
      <div id="pub-more-details" hidden={!moreEditing}>
        <Field label="Tagline" hint="One line that sells the route on Explore and the public page.">
          <input className="input" value={tagline} onChange={e => { setTagline(e.target.value); setSaveErr(null) }} maxLength={140} />
        </Field>
        <Field label="Best season" hint="Optional. Shown as practical guidance.">
          <input className="input" value={bestSeason} onChange={e => { setBestSeason(e.target.value); setSaveErr(null) }} placeholder="e.g. Sep–Mar" />
        </Field>
        <Field label="Travel tips" hint="One per line.">
          <textarea className="textarea" rows={3} value={tips} onChange={e => { setTips(e.target.value); setSaveErr(null) }} />
        </Field>
        <Field label="Subscriber call-to-action" error={errs.cta} hint={hasPremiumDay ? 'Required while any day is premium.' : 'Used on premium days. Add one before charging.'}>
          <input className="input" value={cta} ref={el => { fieldRefs.current.cta = el }}
            onChange={e => { setCta(e.target.value); clearErr('cta'); setSaveErr(null) }} placeholder="e.g. Full checklist + stay contacts." />
        </Field>
      </div>

      {/* #389 — the ONE assertive banner stays, and it stays the SUMMARY. It is
          the failed-WRITE case only now: a validation failure speaks through
          FormErrorSummary plus the field messages, so this line is no longer the
          only way to hear about six different rules, which is what made it
          useless for locating one. */}
      {hiddenCard}
      {saveErr && <p className="err-text ts-warn-note" role="alert">{saveErr}</p>}
      {/* The fieldset carries the publish-status gate (#704). A disabled fieldset
          disables the button inside it, and the button keeps its own owner and
          write rules. */}
      <fieldset className="ts-submit-gate" disabled={!publishReady}>
        <button className="btn btn-saffron" disabled={!isOwner || busy} onClick={() => void submit()}>
          {busy ? 'Publishing…' : pub && live ? 'Update publication' : 'Publish to Explore'}
        </button>
      </fieldset>
      {!publishReady && <p className="hint-text ts-note">{publishBlockedReason}</p>}
      {!isOwner && <p className="hint-text ts-note">Only the trip owner can publish.</p>}
    </div>
  )
}

// ================= Share tab (tabbed) =================
// Reworked from the original .two-col grid into an ARIA tablist so each share
// concern (plan together / publish / keep a record) gets its own
// focused surface instead of competing for space in a 340px sidebar. The
// Danger zone is re-homed under "Plan together" (matches the approved variant).
// Heading order is corrected (page h1 → panel h2 → card h3) via sr-only h2s.
// Trip settings moved to its own workspace tab (#213).
// #1012: from SHARE_WIDE_QUERY up, the three panels sit side by side with no
// tablist. Below it, the numbered tabs stay as they were.

const SHARE_TABS = [
  { id: 'plan', label: '1 · Plan together', short: '1 · Plan' },
  { id: 'publish', label: '2 · Share publicly', short: '2 · Publish' },
  { id: 'record', label: '3 · Keep a record', short: '3 · Keep' },
] as const
type ShareTabId = (typeof SHARE_TABS)[number]['id']
const SHARE_TAB_IDS = SHARE_TABS.map(t => t.id)
function isShareTabId(key: string): key is ShareTabId {
  return (SHARE_TAB_IDS as readonly string[]).includes(key)
}

export function ShareTab({ trip, me, onNavigate, legCorrections }: {
  trip: Trip
  me: { id: string; email: string }
  editable: boolean
  onNavigate: (route: string) => void
  legCorrections?: Record<string, LegEstimate>
}) {
  const db = useDb()
  // Short invite code link (#/join/GOA-K7QF): minted lazily on first share —
  // codes are meaningfully readable instead of a 36-char UUID. A trip id is
  // never offered as a link, because it no longer joins anyone. When minting
  // fails, the panel says so and offers another try.
  const [inviteReady, setInviteReady] = useState<string | null>(null)
  const [mintFailed, setMintFailed] = useState(false)
  const [mintTry, setMintTry] = useState(0)
  const inviteKey = `${trip.id}:${me.id}:${mintTry}`
  const inviteCode = inviteReady === inviteKey ? trip.inviteCode ?? null : null
  // A newer access version re-checks the code. A failed re-check never hides a link already on screen (#1012).
  useEffect(() => {
    let alive = true
    void ensureInviteCode(trip.id).then(code => {
      if (!alive) return
      setInviteReady(prev => (code ? inviteKey : prev === inviteKey ? prev : null))
      setMintFailed(!code)
    })
    return () => { alive = false }
  }, [trip.id, inviteKey, trip.accessVersion])
  const inviteLink = inviteCode ? `${location.origin}/join/${inviteCode}` : ''
  // #1012 — the QR code is drawn only when asked for, from a library loaded then.
  const [qrOpen, setQrOpen] = useState(false)
  const [qrSrc, setQrSrc] = useState<string | null>(null)
  const [qrFailed, setQrFailed] = useState(false)
  async function openQr() {
    if (!inviteLink) return
    setQrOpen(true)
    setQrSrc(null)
    setQrFailed(false)
    try {
      // Lazy: the QR library is fetched on the first press, never at page load (ROADMAP I-77).
      const QR = await import('qrcode')
      setQrSrc(await QR.toDataURL(inviteLink, { margin: 1, width: 240 }))
    } catch (e) {
      console.error('[yatraflow] invite QR failed', e)
      setQrFailed(true)
    }
  }
  const pub = db.published.find(p => p.tripId === trip.id)
  // #350 — a soft-unpublished publication keeps its row (so buyers keep what
  // they paid for and the sales history stays whole) but it is NOT live. Every
  // affordance below that says "this is up" hangs off this flag: the live line,
  // the public link, the Unpublish action. The form keeps `pub` as its prefill
  // either way — re-publishing should not mean retyping the tagline.
  const pubLive = !!pub && !pub.unpublishedAt
  // #704: "not published" is a claim, and it holds only after a read that
  // succeeded. A failed or pending read leaves `pub` empty without saying why.
  const publishRead = sliceState(db.sliceReads, 'suggested itineraries')
  const publishView: RowsView = rowsView(publishRead, pub ? 1 : 0)
  const [publishRetrying, setPublishRetrying] = useState(false)
  const retryPublish = () => {
    setPublishRetrying(true)
    void rereadPublicSlices().finally(() => { setPublishRetrying(false) })
  }
  // The inline write error. It lives here, not in the form, so a remount cannot drop it (#704).
  const [saveErr, setSaveErr] = useState<string | null>(null)
  // #704: the form is keyed by the publication it edits. A write changes that
  // publication twice (optimistically, then again on a rollback), so the key is
  // held at its pre-write value while a write is in flight.
  const [frozenKey, setFrozenKey] = useState<string | null>(null)
  const formKey = frozenKey ?? publishFormKey(pub)
  // #704: a form that has been shown stays shown for its record while a refresh is
  // pending or failed. The first showing waits for a read that succeeded.
  const [shownKey, setShownKey] = useState<string | null>(null)
  const mount = publishFormMount({ read: publishRead, formKey, shownKey })
  if (mount.shownKey !== shownKey) setShownKey(mount.shownKey)
  // #230 — the copy button's link names the button it left through (`ref=copy`).
  const pubLink = pubLive && pub ? withShareRef(currentPublicShareUrl(pub.id), 'copy') : ''
  const isOwner = (trip.members ?? []).some(m => m.userId === me.id && m.role === 'owner')
  // One read consumes the stash (#368): the import's offer lands here or
  // nowhere. Reviewing and publishing stay in the creator's hands.
  const [draft, setDraft] = useState(() => takePublishDraft(trip.id))
  const [tab, setTab] = useState<ShareTabId>('plan')
  // #1012 — three columns from SHARE_WIDE_QUERY. The first render reads the query
  // directly, so a wide screen never flashes the tabs before the columns.
  const wide = useMedia(SHARE_WIDE_QUERY, typeof window !== 'undefined' && window.matchMedia(SHARE_WIDE_QUERY).matches)
  const [pendingRemove, setPendingRemove] = useState<NonNullable<Trip['members']>[number] | null>(null)
  const [memberBusy, setMemberBusy] = useState(false)
  const [accessRead, setAccessRead] = useState<{ key: string; state: MemberAccessState | null } | null>(null)
  const [accessTry, setAccessTry] = useState(0)
  // The key holds the access version too. A newer version makes the read stale, so the page waits for a fresh one (#1012).
  const accessKeyAt = (version: number) => `${trip.id}:${me.id}:${accessTry}:${version}`
  const accessKey = accessKeyAt(trip.accessVersion ?? -1)
  const accessPending = accessRead?.key !== accessKey
  const accessFailed = !accessPending && !accessRead?.state
  const removedMembers = !accessPending ? accessRead?.state?.removed ?? [] : []
  // The role comes only from a read that succeeded for this version. The cached trip is never a source (#1012).
  const readRole = !accessPending ? accessRead?.state?.inviteRole ?? null : null
  // The invite and mail bodies. Every fact is read at press time, so a big
  // trip's simulation is never paid on render, and an empty trip prints no
  // zero facts. The role decides what the message may promise (#1012).
  function inviteText(): string {
    const totals = computeTotals(trip, legCorrections)
    return tripInviteMessage({
      title: trip.name?.trim() || null,
      days: trip.days.length,
      stops: totals.stopCount,
      perPersonInr: totals.costPerPersonInr,
      url: inviteLink,
      code: inviteCode ?? '',
      role: readRole,
    })
  }
  useEffect(() => {
    let alive = true
    void readMemberAccess(trip.id).then(state => {
      if (!alive) return
      setAccessRead({ key: accessKey, state })
    })
    return () => { alive = false }
  }, [trip.id, accessKey])
  const [pendingUnpublish, setPendingUnpublish] = useState(false)
  // Link role and reset (#1012). The page shows the role the server confirmed, never the one it asked for.
  const [roleAsk, setRoleAsk] = useState(false)
  const [resetAsk, setResetAsk] = useState(false)
  const [inviteBusy, setInviteBusy] = useState(false)

  // Settles one link change: a done outcome installs its read; the other two say what is still true.
  function settleInvite(outcome: InviteLinkOutcome, copy: { done: string; unchanged: string; unknown: string }) {
    if (outcome.status === 'done') {
      setAccessRead({ key: accessKeyAt(outcome.state.version), state: outcome.state })
      toast(copy.done)
    } else if (outcome.status === 'unchanged') {
      toast(copy.unchanged, 'err')
    } else if (outcome.status === 'unsent') {
      toast('We could not check the link. Nothing changed. Try again.', 'err')
    } else {
      toast(copy.unknown, 'err')
    }
  }
  async function applyInviteRole(role: 'editor' | 'viewer') {
    if (inviteBusy) return
    setInviteBusy(true)
    try {
      const outcome = await setInviteRole(trip.id, role)
      settleInvite(outcome, role === 'editor'
        ? { done: 'New link ready. The old link no longer works.', unchanged: 'Could not change the link. The old link still works.', unknown: 'We could not confirm the change. Check the link before you share it.' }
        : { done: 'New members join as viewers', unchanged: 'Could not change the link. The old link still works.', unknown: 'We could not confirm the change. Check the link before you share it.' })
    } finally { setInviteBusy(false) }
  }
  async function resetLink() {
    if (inviteBusy) return
    setInviteBusy(true)
    try {
      const outcome = await resetInviteLink(trip.id)
      settleInvite(outcome, { done: 'New link ready. The old link no longer works.', unchanged: 'Could not reset the link. The old link still works.', unknown: 'We could not confirm the reset. Check the link before you share it.' })
    } finally { setInviteBusy(false) }
  }
  // Viewer to Editor asks first, because the old link and code stop working. Editor to Viewer applies at once.
  function chooseRole(next: string) {
    if (inviteBusy || next === readRole) return
    if (next === 'editor') setRoleAsk(true)
    else if (next === 'viewer') void applyInviteRole('viewer')
  }

  async function restoreRemoved(member: AccessMember) {
    if (memberBusy) return
    setMemberBusy(true)
    try {
      if (await restoreMember(trip.id, member)) toast('Member restored')
    } finally {
      setMemberBusy(false)
      setAccessTry(n => n + 1)
    }
  }

  async function confirmRemoveMember() {
    if (!pendingRemove || memberBusy) return
    const name = userById(pendingRemove.userId)?.profile.name ?? 'Member'
    setMemberBusy(true)
    try {
      const removed = await removeMember(trip.id, pendingRemove.userId)
      if (removed) undoToast(`${name} removed`, () => { void restoreRemoved(removed) })
    } finally {
      setMemberBusy(false)
      setPendingRemove(null)
      setAccessTry(n => n + 1)
    }
  }

  async function changeRole(userId: string, role: string) {
    if (memberBusy || (role !== 'editor' && role !== 'commenter' && role !== 'viewer')) return
    setMemberBusy(true)
    try { await setMemberRole(trip.id, userId, role) }
    finally { setMemberBusy(false); setAccessTry(n => n + 1) }
  }

  function confirmUnpublish() {
    // The store refuses a non-creator write anyway; without this guard the
    // refusal was swallowed and the success toast fired over it.
    if (!isOwner) { setPendingUnpublish(false); return }
    unpublishItinerary(trip.id)
    setPendingUnpublish(false)
    toast('Unpublished. Removed from Explore')
  }

  // #1012 R2: the member list. usePresenceList plays a removed member's exit. A
  // joined member's entrance needs a baseline: the ids present at the first paint.
  const members = trip.members ?? []
  const { entries: memberEntries, attachList: attachMembers } = usePresenceList(members, m => m.userId)
  const [joinBaseline, setJoinBaseline] = useState<Set<string> | null>(() =>
    members.length > 0 ? new Set(members.map(m => m.userId)) : null)
  // Seed the baseline from the first list that has members. This guarded set during
  // render is React's pattern for state that follows a prop. An effect would cost a render.
  if (joinBaseline === null && members.length > 0) setJoinBaseline(new Set(members.map(m => m.userId)))

  // #1012: what the public copy leaves out. Only the two items the publish path
  // was checked against are listed (docs HIDDEN-AUDIT).
  const hiddenCard = (
    <div className="shr-hidden-card">
      <span className="shr-field-label">Hidden from the public copy</span>
      <span className="small">Crew names, and the booking reference on each flight.</span>
    </div>
  )

  // The body of each panel. Narrow screens wrap it in a tab panel; wide screens
  // place it in a column. The content is written once, so the two layouts
  // cannot drift apart.
  const panelBody: Record<ShareTabId, ReactNode> = {
    plan: (
      <>
        <h2 className="sr-only">Plan together</h2>
        <Surface className="card shr-panel">
          <span className="share-intent share-intent--teal">1 · Plan together</span>
          <h3 className="shr-card-title">Invite collaborators</h3>
          <p className="hint-text shr-invite-description">{readRole ? <span key={readRole} className="shr-role-fade">{`New members join as ${readRole}s. `}</span> : null}Returning members never get more than their last role. Removed members need an owner restore.</p>
          {/* #1012 — a labelled link, then the join code as its own tile. The link
              and the code are two different things, so they are two blocks. */}
          <div className="shr-invite-field" role="group" aria-labelledby="share-invite-label">
            <span className="shr-field-label" id="share-invite-label">Invite link</span>
            {inviteLink ? (
              <div className="share-link-box shr-invite-link"><InlineIcon icon={Link2} size={14} gap={0} /><code title={inviteLink}>{inviteLink}</code><CopyButton text={inviteLink} /></div>
            ) : mintFailed ? (
              // The code is a write, so its three outcomes are three
              // statements. The failed one used to be a polite hint line, which a
              // screen reader could sit through while the panel claimed nothing was
              // wrong; the shared block announces it.
              <div className="shr-state">
                <StateBlock kind="failed" size="compact" title="We could not make an invite link."
                  actions={<button type="button" className="btn btn-outline btn-sm" onClick={() => { setMintFailed(false); setMintTry(n => n + 1) }}>Try again</button>} />
              </div>
            ) : (
              <div className="shr-state">
                <StateBlock kind="loading" size="compact" title="Making your invite link…" />
              </div>
            )}
            {inviteLink && (
              <div className="shr-share-buttons">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => openExternal(whatsAppSendUrl(inviteText()))}>WhatsApp</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => openExternal(mailtoUrl('Join our YatraFlow trip', inviteText()))}>Email</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => { void openQr() }}>Show QR</button>
              </div>
            )}
            {/* Joins as (#1012). The owner changes it; everyone else reads it. It shows only from a read that succeeded. */}
            {accessPending ? (
              <div className="shr-state">
                <StateBlock kind="loading" size="compact" title="Checking who joins…" />
              </div>
            ) : accessFailed ? (
              <div className="shr-state">
                <StateBlock kind="failed" size="compact" title="We could not check who joins."
                  actions={<button type="button" className="btn btn-outline btn-sm" onClick={() => setAccessTry(n => n + 1)}>Try again</button>} />
              </div>
            ) : readRole ? (
              <div className="shr-role-row">
                <span className="shr-field-label">Joins as</span>
                {isOwner ? (
                  <div className="shr-role-control" data-busy={inviteBusy || undefined}>
                    <SegmentedTabs semantics="toggle" className="shr-seg" label="Joins as" items={ROLE_ITEMS} value={readRole} onChange={chooseRole} />
                  </div>
                ) : (
                  <span key={readRole} className="shr-role-value">{ROLE_LABEL[readRole]}</span>
                )}
              </div>
            ) : null}
            {isOwner && readRole && (
              <button type="button" className="btn btn-outline btn-sm shr-reset-link" disabled={inviteBusy} onClick={() => setResetAsk(true)}>Reset link</button>
            )}
          </div>
          {inviteCode && (
            <div className="shr-join-tile">
              {/* The label and Copy share the top line. The code is 14 characters, so it
                  needs the full tile width, and Copy beside it would not fit at 1100. */}
              <div className="shr-join-head">
                <span className="shr-join-label">Join code</span>
                <CopyButton text={inviteCode} label="Copy code" />
              </div>
              <code className="shr-join-code" aria-label={`Trip code ${inviteCode}`}>{inviteCode}</code>
              <span className="small muted shr-join-caption">Read it out loud. Friends type it on the home screen.</span>
            </div>
          )}
          <hr className="divider" />
          <h3 className="shr-card-title">Members and roles · {(trip.members ?? []).length}</h3>
          <div className="shr-members" ref={attachMembers}>
            {memberEntries.length === 0 ? (
              <div className="shr-state">
                <StateBlock kind="empty" size="compact" title="No one is on this trip yet."
                  body="Share the invite link above and the travellers who join appear here."
                  art={<Mascot pose="wave" size={96} />} />
              </div>
            ) : memberEntries.map(({ item: m, key, exiting }) => {
              const u = userById(m.userId)
              // A member who joined after the first paint rises in once. The baseline holds
              // the crew from that paint, so opening the tab never animates the existing rows.
              const entering = !exiting && joinBaseline !== null && !joinBaseline.has(m.userId)
              return (
                <div key={key} {...presenceAttrs({ exiting })} className={`feed-item shr-member-row${entering ? ' is-entering' : ''}`}>
                  <Avatar user={u} size="lg" />
                  <div className="shr-member-details">
                    {/* #800: a crew member's account email is PRIVATE. Being on the
                        same trip is not self or admin authority, so the address is
                        gone from this list — the name, the avatar and the role are
                        what a crew surface may show. */}
                    <b>{u?.profile.name ?? 'Traveller'}</b>
                    <div className="small muted">Joined {timeAgo(m.joinedAt)}</div>
                  </div>
                  {isOwner && m.role !== 'owner' ? (
                    <select className="role-select" value={m.role} disabled={memberBusy} onChange={e => { void changeRole(m.userId, e.target.value) }}
                      aria-label={`Role for ${u?.profile.name ?? 'Traveller'}`}>
                      {['editor', 'commenter', 'viewer'].map(r => <option key={r} value={r}>{cap(r)}</option>)}
                    </select>
                  ) : (
                    <Chip tone={m.role === 'owner' ? 'teal' : 'info'}>{cap(m.role)}</Chip>
                  )}
                </div>
              )
            })}
          </div>
        </Surface>

        {/* Danger zone: the app's own wording and its own rule (a removal needs
            another member to remove). The trip's delete lives in Settings as
            "Move to trash", so no delete action appears here (#1012). */}
        {isOwner && (trip.members ?? []).length > 1 && (
          <Surface className="card shr-panel">
            <h3 className="shr-card-title">Danger zone</h3>
            <p className="hint-text shr-removal-warning">Removal blocks private trip access and replaces the invite link. Public plans and paid unlocks keep their normal access.</p>
            {(trip.members ?? []).filter(m => m.role !== 'owner').map(m => (
              <div key={m.userId} className="row-between shr-removal-row">
                <span className="small">{userById(m.userId)?.profile.name}</span>
                <button className="btn btn-danger btn-sm" disabled={memberBusy} onClick={() => setPendingRemove(m)}>Remove</button>
              </div>
            ))}
          </Surface>
        )}
        {isOwner && (
          <Surface className="card shr-panel">
            <h3 className="shr-card-title">Removed members</h3>
            <p className="hint-text">Only an owner can restore access. A new invite does not restore it.</p>
            {accessPending ? <StateBlock kind="loading" size="compact" title="Checking removed members…" />
              : accessFailed ? <StateBlock kind="failed" size="compact" title="Could not check removed members."
              actions={<button className="btn btn-outline btn-sm" disabled={memberBusy} onClick={() => setAccessTry(n => n + 1)}>Try again</button>} />
              : removedMembers.length === 0 ? <p className="hint-text">No removed members.</p>
                : removedMembers.map(member => (
                  <div key={member.userId} className="row-between shr-removal-row">
                    <span className="small">{userById(member.userId)?.profile.name ?? 'Traveller'}</span>
                    <button className="btn btn-outline btn-sm" disabled={memberBusy} onClick={() => { void restoreRemoved(member) }}>Restore access</button>
                  </div>
                ))}
            {memberBusy && <p role="status" className="hint-text">Saving trip access…</p>}
          </Surface>
        )}
      </>
    ),
    publish: (
      <>
        <h2 className="sr-only">Share publicly</h2>
        <Surface className="card shr-panel">
          <span className="share-intent share-intent--info">2 · Share publicly</span>
          <h3 className="shr-card-title">Publish as public itinerary</h3>
          <p className="hint-text shr-publication-description">
            List this trip on Explore. Pick the free preview days. No real payments in this MVP.
          </p>
          {/* Loading, failed and "not published" are three different statements
              (#704). The last one is said only after a read that succeeded.
              Each is its own compact block, so the roles are the shared ones: a
              failed read is an alert, a pending one and a kept note are statuses. */}
          {publishView === 'reading' && (
            <div className="shr-state">
              <StateBlock kind="loading" size="compact" title="Checking whether this trip is on Explore…" />
            </div>
          )}
          {publishView === 'failed' && (
            <div className="shr-state">
              <StateBlock kind="failed" size="compact" title="Couldn’t check if this trip is on Explore."
                actions={<button className="btn btn-outline btn-sm" onClick={retryPublish} disabled={publishRetrying}>
                  {publishRetrying ? 'Trying…' : 'Try again'}
                </button>} />
            </div>
          )}
          {pub && (pubLive ? (
            <div className="row-between shr-publication-status">
              <span className="small muted">Live on Explore · {pub.views} views · {pub.copies} forks</span>
              <button className="btn btn-outline btn-sm" onClick={() => onNavigate(`/pub/${pub.id}`)}>View public page</button>
            </div>
          ) : (
            // No "View public page" button and no copyable link here: nothing is
            // up to share. The form below is the way back.
            <p className="hint-text ts-note shr-unpublished-note">
              Unpublished. It has left Explore and is no longer on sale. Anyone who already unlocked it keeps the full plan.
            </p>
          ))}
          {publishView === 'kept' && (
            <div className="shr-state">
              <StateBlock kind="kept" size="compact" title="Couldn’t refresh. Showing the last status that loaded."
                actions={<button className="btn btn-outline btn-sm" onClick={retryPublish} disabled={publishRetrying}>
                  {publishRetrying ? 'Trying…' : 'Try again'}
                </button>} />
            </div>
          )}
          {/* The form reads its fields when it mounts. It mounts only once the
              status has loaded, stays open through a later refresh, and remounts
              when the publication changes (#704). The hidden card sits inside the
              form, just above Publish. Until then it shows on its own. */}
          {mount.mounted ? (
            <PublicationForm key={formKey} legCorrections={legCorrections} trip={trip} pub={pub} draft={draft} live={pubLive} isOwner={isOwner} creatorId={me.id}
              hiddenCard={hiddenCard}
              publishRead={publishRead}
              onDone={wasPublished => {
                // A published draft is spent. A later remount must not seed the form from it again.
                setDraft(null)
                toast(wasPublished ? 'Publication updated' : 'Published to Explore')
              }}
              onWriting={writing => setFrozenKey(writing ? publishFormKey(pub) : null)}
              saveErr={saveErr} setSaveErr={setSaveErr} />
          ) : hiddenCard}
          {pub && isOwner && pubLive && (
            <button className="btn btn-ghost btn-sm shr-unpublish-action" onClick={() => setPendingUnpublish(true)}>Unpublish</button>
          )}
          {pubLink && <div className="share-link-box shr-publication-link"><code title={pubLink}>{pubLink}</code><CopyButton text={pubLink} label="Copy" /></div>}
        </Surface>
      </>
    ),
    record: (
      <>
        <h2 className="sr-only">Keep a record</h2>
        <SnapshotCard
          trip={trip}
          me={me}
          onNavigate={onNavigate}
          legCorrections={legCorrections}
          publication={pub ? { ...pub } as unknown as Record<string, unknown> : undefined}
        />
      </>
    ),
  }

  return (
    <div className="share-tabbed" data-layout={wide ? 'columns' : 'tabs'}>
      <header className="shr-page-head">
        <span className="shr-eyebrow">Share</span>
        <h2 className="shr-page-title">Share this trip</h2>
        <p className="shr-page-lede">Three different jobs, in the order people need them.</p>
      </header>

      {!wide && (
        <SegmentedTabs semantics="tablist" className="tabbar share-job-tabs" label="Share and trip options"
          items={SHARE_TABS.map(t => ({
            key: t.id,
            label: <>
              <span className="shr-tab-name">{t.label}</span>
              <span className="shr-tab-short" aria-hidden="true">{t.short}</span>
            </>,
            id: `share-tab-${t.id}`,
            controls: `share-panel-${t.id}`,
          }))}
          value={tab}
          onChange={key => { if (isShareTabId(key)) setTab(key) }} />
      )}

      {wide ? (
        <div className="shr-columns">
          {SHARE_TABS.map(t => (
            <section key={t.id} className="shr-column" data-share-column={t.id}>{panelBody[t.id]}</section>
          ))}
        </div>
      ) : (
        SHARE_TABS.map(t => (
          <section key={t.id} role="tabpanel" id={`share-panel-${t.id}`} aria-labelledby={`share-tab-${t.id}`}
            className="share-panel" hidden={tab !== t.id}>
            {panelBody[t.id]}
          </section>
        ))
      )}

      <Modal open={qrOpen} onClose={() => setQrOpen(false)} title="Invite QR code">
        <div className="shr-qr">
          {qrSrc ? (
            <img className="shr-qr-image" src={qrSrc} width={240} height={240} alt="QR code for the invite link" />
          ) : qrFailed ? (
            <StateBlock kind="failed" size="compact" title="Could not draw the QR code." body="The invite link still works. Copy it instead." />
          ) : (
            <StateBlock kind="loading" size="compact" title="Drawing the QR code…" />
          )}
          {inviteLink && <code className="shr-qr-link" title={inviteLink}>{inviteLink}</code>}
        </div>
      </Modal>
      <ConfirmDialog
        open={!!pendingRemove}
        title={`Remove ${userById(pendingRemove?.userId)?.profile.name ?? 'this member'}?`}
        body="This blocks private trip access and replaces the invite link. You can undo removal or restore access here later."
        confirmLabel="Remove member"
        danger
        onConfirm={confirmRemoveMember}
        onClose={() => setPendingRemove(null)}
      />
      <ConfirmDialog
        open={roleAsk}
        title="Make a new editor link?"
        body="The current link and code stop working. People on the trip keep their role."
        confirmLabel="Make new link"
        onConfirm={() => { void applyInviteRole('editor') }}
        onClose={() => setRoleAsk(false)}
      />
      <ConfirmDialog
        open={resetAsk}
        title="Reset the invite link?"
        body="The current link and code stop working at once. People on the trip keep their access. Send the new link to people who have not joined."
        confirmLabel="Reset link"
        danger
        onConfirm={() => { void resetLink() }}
        onClose={() => setResetAsk(false)}
      />
      <ConfirmDialog
        open={pendingUnpublish}
        title="Unpublish this itinerary?"
        body="It leaves Explore immediately and stops selling. The trip itself is not touched, and anyone who already unlocked it keeps the full plan. You can publish it again anytime from this tab."
        confirmLabel="Unpublish"
        onConfirm={confirmUnpublish}
        onClose={() => setPendingUnpublish(false)}
      />
    </div>
  )
}
