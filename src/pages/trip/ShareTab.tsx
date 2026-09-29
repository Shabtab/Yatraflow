// ============ Trip workspace — Share tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
// Includes SnapshotCard — ShareTab is its only consumer.
import { useEffect, useRef, useState } from 'react'
import { InlineIcon } from '../../components/icons'
import { CalendarDays, Download, Link2, Lock } from 'lucide-react'
import type { Trip, PublishedItinerary } from '../../data/types'
import { useDb, userById, setMemberRole, removeMember, restoreMember, publishItinerary, unpublishItinerary, ensureInviteCode } from '../../store/store'
import { encodeTripSnapshot, snapshotUrl, downloadTripJson } from '../../lib/snapshot'
import { ImportTripButton } from '../../components/ImportTripButton'
import { CoverImagePicker } from '../../components/CoverImagePicker'
import { currentPublicShareUrl } from '../../lib/shareUrl'
import { downloadTripIcs } from '../../lib/ics'
import { nativeCopyText } from '../../lib/native'
import { useTablist } from '../../hooks/useTablist'
import { formatInr, type LegEstimate } from '../../lib/engine'
import { netOfFeeInr, PLATFORM_FEE_SUMMARY } from '../../lib/earnings'
import {
  publishValidation, PUBLISH_FIELD_ORDER, PUBLISH_FIELD_LABELS, PublishRejected, type PublishField,
} from '../../lib/publishRules'
import { Avatar, Chip, ConfirmDialog, CopyButton, Field, FormErrorSummary, toast, undoToast } from '../../components/ui'
import { PrintExport } from '../../components/PrintExport'
import { cap, timeAgo } from './shared'

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
      toast('Snapshot link copied — anyone can open it, no account needed')
    } catch (e) {
      console.error('[yatraflow] snapshot encode failed', e)
      // The raw failure names CompressionStream or a URL-length error; neither
      // is anything a reader can act on, so the message says what to do instead
      // and the cause stays in the console.
      toast('Couldn’t build a snapshot link for this trip — the plan may be too large for a URL. Download the JSON instead.', 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <span className="share-intent share-intent--info">3 · Keep a record</span>
      <h3>Export & snapshot sharing</h3>
      <p className="hint-text" style={{ margin: '6px 0 12px' }}>
        Take the whole plan anywhere — no server stores it. Snapshot links embed the trip in the URL itself.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <ImportTripButton ownerId={me.id} onNavigate={onNavigate} className="btn btn-outline btn-sm" />
                  <button className="btn btn-outline btn-sm" onClick={() => downloadTripJson(trip, publication)}><InlineIcon icon={Download} size={13} gap={4} />Download JSON</button>
                  <PrintExport trip={trip} legCorrections={legCorrections} />
                  <button className="btn btn-outline btn-sm" onClick={() => downloadTripIcs(trip, legCorrections)} title="One calendar event per day plus timed events for fixed commitments — imports into Google/Apple/Outlook calendars"><InlineIcon icon={CalendarDays} size={13} gap={4} />Add to calendar</button>
                   <button className="btn btn-saffron btn-sm" onClick={makeLink} disabled={busy} aria-busy={busy}>
                     <InlineIcon icon={Link2} size={13} gap={4} />{busy ? 'Building…' : 'Create snapshot link'}
                   </button>
      </div>
      {link && (
        <div className="share-link-box" style={{ marginTop: 10 }}>
          <code style={{ wordBreak: 'break-all' }} title={link}>{link}</code>
          <CopyButton text={link} label="Copy" />
        </div>
      )}
    </div>
  )
}

// ================= Publication editor (free/premium picker) =================

const DEFAULT_TRAVEL_TIPS = ['Start ghat-section drives early.', 'Carry cash in hill towns.']
const DEFAULT_WARNINGS = ['All costs are estimates based on typical prices — verify locally before booking.']

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
function PublicationForm({ trip, pub, live = true, isOwner, creatorId, onDone }: {
  trip: Trip
  pub: PublishedItinerary | undefined
  /** Whether that row is up on Explore right now (#350). False while it is
   *  soft-unpublished: the form keeps the row as its prefill — the creator
   *  should not retype their tagline — but its button offers publishing again
   *  rather than "update", because nothing is live to update. */
  live?: boolean
  isOwner: boolean
  creatorId: string
  onDone: (published: boolean) => void
}) {
  const defaultTagline = `${trip.days.length}-day ${trip.travelStyle} trip through ${trip.destinations.join(', ')}.`
  const [free, setFree] = useState<Set<number>>(() => new Set(pub?.freeDayIndexes ?? [0]))
  const [price, setPrice] = useState(pub?.premiumPriceInr != null ? String(pub.premiumPriceInr) : '')
  const [tagline, setTagline] = useState(pub?.tagline ?? defaultTagline)
  const [bestSeason, setBestSeason] = useState(pub?.bestSeason ?? '')
  const [tips, setTips] = useState(pub ? pub.travelTips.join('\n') : DEFAULT_TRAVEL_TIPS.join('\n'))
  const [cta, setCta] = useState(pub?.subscriberCta ?? '')
  // #389 — F-15, ported from CreateTrip rather than invented a second time.
  // The form had ONE `err: string` driving ONE `role="alert"` banner at the
  // bottom: a screen-reader user heard "Premium days need a call-to-action" and
  // a sighted user had to work out which of six fields it meant, with focus
  // left on the submit button. Six rules, four fields — so `errs` is keyed by
  // FIELD and the summary reads its first key. `saveErr` is deliberately NOT in
  // that map: a failed WRITE is not a field's fault, and pointing at the price
  // box for it would be a lie.
  const [errs, setErrs] = useState<Record<string, string>>({})
  const [saveErr, setSaveErr] = useState<string | null>(null)
  /** first-invalid focus targets (F-15) — plain inputs and the day picker only */
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({})
  // A publish is a network write, and this button was the only publish control
  // in the app without a busy state (#388). Two clicks fired two upserts, two
  // `refreshedAt` stamps and two toasts — the duplicate was only prevented by
  // accidental id-reuse in the store, which is not a guard. The cover picker's
  // `busy` is the pattern this copies.
  const [busy, setBusy] = useState(false)

  const priceNum = price.trim() === '' ? 0 : Number(price)
  const entirelyFree = price.trim() === '' || priceNum === 0
  const allIndexes = trip.days.map(d => d.index)
  const hasPremiumDay = !entirelyFree && free.size < trip.days.length

  /** #389 — one field's edit clears that field's message and nothing else, so
   *  fixing the price does not wipe a still-true complaint about the CTA. */
  const clearErr = (field: string) => setErrs(prev => {
    if (!(field in prev)) return prev
    const next = { ...prev }
    delete next[field]
    return next
  })

  function toggleDay(index: number) {
    if (free.has(index) && free.size <= 1) {
      // Tagged to the DAY PICKER, which is the control the message is about —
      // and it used to be a form-wide `err` the reader could not locate.
      setErrs(prev => ({ ...prev, freeDays: 'At least one day must stay free — it is the preview readers see.' }))
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
    // The publication's cover IS the link preview: api/i.js serves it as
    // og:image/twitter:image, and it is copied from the trip here. Publishing
    // without one — or with a URL the handler's `^https://\S+$` test rejects —
    // ships a link that silently previews as the brand card instead of this
    // trip, which is the one thing a creator cannot see from inside the app.
    const cover = trip.coverImageUrl?.trim()
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
      // F-15: move focus to the FIRST invalid field in the order the checks run
      // below, so a keyboard user is taken to the topmost thing needing a fix
      // rather than left on the submit button. A field with no focusable element
      // of its own falls back to its own message, made focusable for the
      // occasion — which is why the `.err-text` fallback exists at all.
      const first = PUBLISH_FIELD_ORDER.find(k => k in next)
      const target = first ? fieldRefs.current[first] : null
      if (target) target.focus()
      else {
        const firstErr = document.querySelector<HTMLElement>('.err-text')
        if (firstErr) { firstErr.setAttribute('tabindex', '-1'); firstErr.focus() }
      }
      return
    }
    setBusy(true)
    try {
      // AWAITED (#388). The old call was fire-and-forget, so `onDone` — and
      // with it the "Published to Explore" toast — fired while the write was
      // still in flight; a later failure then rolled back under a success
      // message. The toast is now a statement about a resolved outcome.
      await publishItinerary({
        tripId: trip.id, creatorId,
        title: trip.name,
        // The TRIMMED value the rule above validated, not the raw field. The
        // handler's `^https://\S+$` test never trims, so storing the padded
        // original shipped a link that previewed as the brand card (#360).
        coverImageUrl: cover,
        tagline: tagline.trim() || defaultTagline,
        routeSummary: [trip.startLocation, ...trip.destinations],
        durationDays: trip.days.length,
        estimatedBudgetPerPersonInr: trip.budgetPerPersonInr,
        travelStyle: trip.travelStyle,
        bestSeason: bestSeason.trim() || undefined,
        travelTips: tips.split('\n').map(s => s.trim()).filter(Boolean),
        warningsAndAssumptions: DEFAULT_WARNINGS,
        freeDayIndexes: entirelyFree ? allIndexes : [...free],
        premiumPriceInr: entirelyFree ? undefined : priceNum,
        subscriberCta: cta.trim() || undefined,
      })
      onDone(Boolean(pub) && live)
    } catch (e) {
      // #354/#389 — a REFUSAL is not a failed write. The writer raises it before
      // touching anything, so the form's own messages go back on their fields and
      // focus moves to the first of them; no banner, because nothing went wrong
      // and nothing was lost. A genuine write failure keeps the assertive banner,
      // since the reader does need to know the publication did not happen.
      if (e instanceof PublishRejected) {
        setErrs(e.errors)
        const first = PUBLISH_FIELD_ORDER.find(k => k in e.errors)
        const target = first ? fieldRefs.current[first] : null
        if (target) target.focus()
        else {
          const firstErr = document.querySelector<HTMLElement>('.err-text')
          if (firstErr) { firstErr.setAttribute('tabindex', '-1'); firstErr.focus() }
        }
        return
      }
      // The store already toasts its own failure and rolls the cache back; this
      // keeps the form honest about the fact that nothing was published, rather
      // than leaving the last validation error standing as if it were the reason.
      // `saveErr`, not `errs`: a write that failed is not a field's fault, and
      // pointing at the price box for a dropped connection would be a lie.
      setSaveErr('Could not save the publication — nothing was published. Try again.')
    } finally {
      setBusy(false)
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
        <b>Cover photo</b>
        <span className="small muted">Required — this is the picture every shared link previews with.</span>
      </div>
      {/* Two of the six rules are about this control, and it took no `error`
          prop — so a refused publish said "add a cover photo" with nothing
          marked on the control it was talking about. The wrapper carries the
          focus target: the picker is a group of buttons, and its own message
          node is the focusable fallback. */}
      <div ref={el => (fieldRefs.current.cover = el)} tabIndex={-1}
        aria-invalid={errs.cover ? true : undefined}
        aria-describedby={errs.cover ? 'pub-cover-err' : undefined}>
        <CoverImagePicker trip={trip} editable={isOwner} error={errs.cover ?? null} />
      </div>
      {!trip.coverImageUrl && (
        <p className="hint-text ts-note">
          That preview is a suggestion the app found — nothing is saved yet, and a link cannot show it.
          Use it or paste your own; publishing needs a saved cover.
        </p>
      )}
      {/* The picker's own message wins over the form's, so this is a fallback:
          it only shows when the picker has nothing of its own to say. */}
      {errs.cover && <p className="err-text" id="pub-cover-err" role="status" aria-live="polite">{errs.cover}</p>}
      <Field label="Tagline" hint="One line that sells the route on Explore and the public page.">
        <input className="input" value={tagline} onChange={e => { setTagline(e.target.value); setSaveErr(null) }} maxLength={140} />
      </Field>
      <div className="form-row">
        <Field label="Premium price (₹)" error={errs.price} hint={priceNum > 0
          // The floor, not the rate: the ladder charges 15% up to ₹25,000 of
          // LIFETIME gross and 10% after, so a price seen on its own can only
          // honestly promise the least a creator keeps. Pricing is the moment
          // this number matters, and the hub is too late to inform it.
          //
          // Floored, because `formatInr` rounds: a net of ₹172.55 must not be
          // promised as ₹173 — a figure you can *at least* count on is the only
          // one this sentence is allowed to state.
          ? `At ${formatInr(priceNum)} a sale nets you at least ${formatInr(Math.floor(netOfFeeInr(priceNum)))} — the platform fee is ${PLATFORM_FEE_SUMMARY}.`
          : 'Leave empty or 0 for an entirely free itinerary.'}>
          <input className="input" type="number" min={0} inputMode="numeric" placeholder="e.g. 199"
            ref={el => (fieldRefs.current.price = el)}
            value={price} onChange={e => { setPrice(e.target.value); clearErr('price'); setSaveErr(null) }} />
        </Field>
        <Field label="Best season" hint="Optional — shown as practical guidance.">
          <input className="input" value={bestSeason} onChange={e => { setBestSeason(e.target.value); setSaveErr(null) }} placeholder="e.g. Sep–Mar" />
        </Field>
      </div>
      <Field label="Travel tips" hint="One per line.">
        <textarea className="textarea" rows={3} value={tips} onChange={e => { setTips(e.target.value); setSaveErr(null) }} />
      </Field>
      <Field label="Subscriber call-to-action" error={errs.cta} hint={hasPremiumDay ? 'Required while any day is premium.' : 'Used on premium days — add one before charging.'}>
        <input className="input" value={cta} ref={el => (fieldRefs.current.cta = el)}
          onChange={e => { setCta(e.target.value); clearErr('cta'); setSaveErr(null) }} placeholder="e.g. Full checklist + stay contacts." />
      </Field>

      <div className="ts-subhead">
        <b>Free preview days</b>
        {entirelyFree && <span className="small muted">Entirely free — every day is viewable.</span>}
      </div>
      {/* The day picker's focus target: the group, not one button — moving focus
          to an arbitrary day would be worse than moving it to the group that
          owns the choice. `tabIndex={-1}` is the a11y-sanctioned way to make a
          non-interactive group focusable for exactly this. */}
      <div className="ts-dayrows" ref={el => (fieldRefs.current.freeDays = el)} tabIndex={-1}
        role="group" aria-label="Free preview days"
        aria-invalid={errs.freeDays ? true : undefined}
        aria-describedby={errs.freeDays ? 'pub-free-err' : undefined}>
        {trip.days.map(d => {
          const isFree = entirelyFree || free.has(d.index)
          return (
            <div key={d.id} className="row-between">
              <span className="small">Day {d.index + 1}{d.title ? ` — ${d.title}` : ''}</span>
              <button type="button" className={`btn btn-sm ${isFree ? 'btn-outline' : 'btn-saffron'}`}
                disabled={entirelyFree} aria-pressed={!isFree}
                aria-label={`Day ${d.index + 1}${d.title ? ` — ${d.title}` : ''}: ${isFree ? 'Free' : 'Premium'}`}
                onClick={() => toggleDay(d.index)}>
                {isFree ? <>Free</> : <><InlineIcon icon={Lock} size={11} gap={3} />Premium</>}
              </button>
            </div>
          )
        })}
      </div>
      {/* Field-tied, so POLITE — the summary above owns the one assertive beat. */}
      {errs.freeDays && <p className="err-text" id="pub-free-err" role="status" aria-live="polite">{errs.freeDays}</p>}

      {/* #389 — the ONE assertive banner stays, and it stays the SUMMARY. It is
          the failed-WRITE case only now: a validation failure speaks through
          FormErrorSummary plus the field messages, so this line is no longer the
          only way to hear about six different rules, which is what made it
          useless for locating one. */}
      {saveErr && <p className="err-text ts-warn-note" role="alert">{saveErr}</p>}
      <button className="btn btn-saffron" disabled={!isOwner || busy} onClick={() => void submit()}>
        {busy ? 'Publishing…' : pub && live ? 'Update publication' : 'Publish to Explore'}
      </button>
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

const SHARE_TABS = [
  { id: 'plan', label: '1 · Plan together' },
  { id: 'publish', label: '2 · Share publicly' },
  { id: 'record', label: '3 · Keep a record' },
] as const
type ShareTabId = (typeof SHARE_TABS)[number]['id']
const SHARE_TAB_IDS = SHARE_TABS.map(t => t.id)

export function ShareTab({ trip, me, onNavigate, legCorrections }: {
  trip: Trip
  me: { id: string; email: string }
  editable: boolean
  onNavigate: (route: string) => void
  legCorrections?: Record<string, LegEstimate>
}) {
  const db = useDb()
  // Short invite code link (#/join/GOA-K7QF): minted lazily on first share —
  // codes are meaningfully readable instead of a 36-char UUID. Falls back to
  // the legacy UUID link only while minting is impossible (no DB column yet).
  const [inviteCode, setInviteCode] = useState<string | null>(trip.inviteCode ?? null)
  useEffect(() => {
    if (inviteCode) return
    let alive = true
    void ensureInviteCode(trip.id).then(code => {
      if (alive && code) setInviteCode(code)
    })
    return () => { alive = false }
  }, [trip.id, inviteCode])
  const inviteLink = inviteCode
    ? `${location.origin}/#/join/${inviteCode}`
    : `${location.origin}/#/invite/${trip.id}`
  const pub = db.published.find(p => p.tripId === trip.id)
  // #350 — a soft-unpublished publication keeps its row (so buyers keep what
  // they paid for and the sales history stays whole) but it is NOT live. Every
  // affordance below that says "this is up" hangs off this flag: the live line,
  // the public link, the Unpublish action. The form keeps `pub` as its prefill
  // either way — re-publishing should not mean retyping the tagline.
  const pubLive = !!pub && !pub.unpublishedAt
  const pubLink = pubLive && pub ? currentPublicShareUrl(pub.id) : ''
  const isOwner = (trip.members ?? []).some(m => m.userId === me.id && m.role === 'owner')
  const [tab, setTab] = useState<ShareTabId>('plan')
  const [pendingRemove, setPendingRemove] = useState<NonNullable<Trip['members']>[number] | null>(null)
  const [pendingUnpublish, setPendingUnpublish] = useState(false)

  // #87: this implementation was extracted verbatim into the shared
  // useTablist hook so Auth, Admin and the workspace tab bar follow the
  // same APG contract — kept as the reference.
  const { refs: tabRefs, tabProps } = useTablist(SHARE_TAB_IDS, tab, setTab)

  function confirmRemoveMember() {
    if (!pendingRemove) return
    removeMember(trip.id, pendingRemove.userId)
    undoToast(`${userById(pendingRemove.userId)?.profile.name ?? 'Member'} removed`, () => {
      restoreMember(trip.id, pendingRemove)
      toast('Member restored')
    })
    setPendingRemove(null)
  }

  function confirmUnpublish() {
    // The store refuses a non-creator write anyway; without this guard the
    // refusal was swallowed and the success toast fired over it.
    if (!isOwner) { setPendingUnpublish(false); return }
    unpublishItinerary(trip.id)
    setPendingUnpublish(false)
    toast('Unpublished — removed from Explore')
  }

  return (
    <div className="share-tabbed">
      <div className="share-tablist" role="tablist" aria-label="Share and trip options">
        {SHARE_TABS.map((t, i) => (
          <button key={t.id} ref={tabRefs(i)} type="button" role="tab"
            id={`share-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`share-panel-${t.id}`}
            onClick={() => setTab(t.id)} {...tabProps(t.id, i)}
            className={`share-tab${tab === t.id ? ' is-active' : ''}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ---- Plan together ---- */}
      <section role="tabpanel" id="share-panel-plan" aria-labelledby="share-tab-plan"
        className="share-panel" hidden={tab !== 'plan'}>
        <h2 className="sr-only">Plan together</h2>
        <div className="card">
          <span className="share-intent share-intent--teal">1 · Plan together</span>
          <h3>Invite collaborators</h3>
          <p className="hint-text" style={{ margin: '6px 0 12px' }}>Anyone with this link joins as an editor after logging in.</p>
          {inviteCode && (
            <div className="invite-code-row" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <div className="invite-code-chip">
                <code className="invite-code-text" aria-label={`Trip code ${inviteCode}`}>{inviteCode}</code>
                <CopyButton text={inviteCode} />
              </div>
              <span className="small muted">read it out loud — friends type it on the home screen</span>
            </div>
          )}
          <div className="share-link-box"><code title={inviteLink}>{inviteLink}</code><CopyButton text={inviteLink} /></div>
          <hr className="divider" />
          <h3>Members & roles</h3>
          <div style={{ marginTop: 10 }}>
            {(trip.members ?? []).map(m => {
              const u = userById(m.userId)
              return (
                <div key={m.userId} className="feed-item" style={{ alignItems: 'center' }}>
                  <Avatar user={u} size="lg" />
                  <div style={{ flex: 1 }}>
                    <b>{u?.profile.name ?? 'Traveller'}</b> <span className="muted small">{u?.email}</span>
                    <div className="small muted">Joined {timeAgo(m.joinedAt)}</div>
                  </div>
                  {isOwner && m.role !== 'owner' ? (
                    <select className="role-select" value={m.role} onChange={e => setMemberRole(trip.id, m.userId, e.target.value as never)}
                      aria-label={`Role for ${u?.profile.name ?? 'Traveller'}`}>
                      {/* value stays the raw enum (the store writes it straight
                          through); only the visible label is capitalised, via the
                          shared helper the rest of the app uses for enum labels. */}
                      {['editor', 'commenter', 'viewer'].map(r => <option key={r} value={r}>{cap(r)}</option>)}
                    </select>
                  ) : (
                    <Chip tone={m.role === 'owner' ? 'teal' : 'info'}>{cap(m.role)}</Chip>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {isOwner && (trip.members ?? []).length > 1 && (
          <div className="card">
            <h3>Danger zone</h3>
            <p className="hint-text" style={{ margin: '6px 0' }}>Removing someone revokes their access immediately.</p>
            {(trip.members ?? []).filter(m => m.role !== 'owner').map(m => (
              <div key={m.userId} className="row-between" style={{ padding: '5px 0' }}>
                <span className="small">{userById(m.userId)?.profile.name}</span>
                <button className="btn btn-danger btn-sm" onClick={() => setPendingRemove(m)}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- Share publicly ---- */}
      <section role="tabpanel" id="share-panel-publish" aria-labelledby="share-tab-publish"
        className="share-panel" hidden={tab !== 'publish'}>
        <h2 className="sr-only">Share publicly</h2>
        <div className="card">
          <span className="share-intent share-intent--saffron">2 · Share publicly</span>
          <h3>Publish as public itinerary</h3>
          <p className="hint-text" style={{ margin: '6px 0 12px' }}>
            List this trip on Explore so anyone can discover and fork it. Choose which days are the free preview — the rest sit behind a premium placeholder (no real payments in this MVP).
          </p>
          {pub && (pubLive ? (
            <div className="row-between" style={{ marginBottom: 10 }}>
              <span className="small muted">Live on Explore · {pub.views} views · {pub.copies} forks</span>
              <button className="btn btn-outline btn-sm" onClick={() => onNavigate(`/pub/${pub.id}`)}>View public page</button>
            </div>
          ) : (
            // No "View public page" button and no copyable link here: nothing is
            // up to share. The form below is the way back.
            <p className="hint-text ts-note" style={{ marginBottom: 10 }}>
              Unpublished — it has left Explore and is no longer on sale. Anyone who already unlocked it keeps the full plan.
            </p>
          ))}
          <PublicationForm trip={trip} pub={pub} live={pubLive} isOwner={isOwner} creatorId={me.id}
            onDone={wasPublished => toast(wasPublished ? 'Publication updated' : 'Published to Explore')} />
          {pub && isOwner && pubLive && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setPendingUnpublish(true)}>Unpublish</button>
          )}
          {pubLink && <div className="share-link-box" style={{ marginTop: 10 }}><code title={pubLink}>{pubLink}</code><CopyButton text={pubLink} label="Copy" /></div>}
        </div>
      </section>

      {/* ---- Keep a record ---- */}
      <section role="tabpanel" id="share-panel-record" aria-labelledby="share-tab-record"
        className="share-panel" hidden={tab !== 'record'}>
        <h2 className="sr-only">Keep a record</h2>
        <SnapshotCard
          trip={trip}
          me={me}
          onNavigate={onNavigate}
          legCorrections={legCorrections}
          publication={pub ? { ...pub } as unknown as Record<string, unknown> : undefined}
        />
      </section>

      <ConfirmDialog
        open={!!pendingRemove}
        title={`Remove ${userById(pendingRemove?.userId)?.profile.name ?? 'this member'}?`}
        body="They lose access to this trip immediately. You can undo this from the toast for a few seconds."
        confirmLabel="Remove member"
        danger
        onConfirm={confirmRemoveMember}
        onClose={() => setPendingRemove(null)}
      />
      <ConfirmDialog
        open={pendingUnpublish}
        title="Unpublish this itinerary?"
        body="It leaves Explore immediately and stops selling. The trip itself is not touched, and anyone who already unlocked it keeps the full plan — you can publish it again anytime from this tab."
        confirmLabel="Unpublish"
        onConfirm={confirmUnpublish}
        onClose={() => setPendingUnpublish(false)}
      />
    </div>
  )
}
