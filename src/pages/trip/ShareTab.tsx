// ============ Trip workspace — Share tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
// Includes SnapshotCard — ShareTab is its only consumer.
import { useEffect, useState } from 'react'
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
import { Avatar, Chip, ConfirmDialog, CopyButton, Field, toast, undoToast } from '../../components/ui'
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

  async function makeLink() {
    const payload = await encodeTripSnapshot(trip)
    const url = snapshotUrl(trip, payload)
    setLink(url)
    void nativeCopyText(url)
    toast('Snapshot link copied — anyone can open it, no account needed')
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
                  <button className="btn btn-saffron btn-sm" onClick={makeLink}><InlineIcon icon={Link2} size={13} gap={4} />Create snapshot link</button>
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
  const [err, setErr] = useState<string | null>(null)
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

  function toggleDay(index: number) {
    if (free.has(index) && free.size <= 1) {
      setErr('At least one day must stay free — it is the preview readers see.')
      return
    }
    setErr(null)
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
    if (!cover) { setErr('Add a cover photo — it is the picture your share link previews with.'); return }
    if (!/^https:\/\/\S+$/.test(cover)) { setErr('The cover must be an https image URL — link previews ignore anything else.'); return }
    if (!Number.isFinite(priceNum) || priceNum < 0) { setErr('Price must be a number of rupees, 0 or more.'); return }
    // The purchase_orders table caps amount_inr at 100000 (the gateway's
    // sensible test-mode ceiling) — a publication priced above it would 503
    // at checkout with no visible cause. Fail here, at the source.
    if (!entirelyFree && priceNum > 100000) { setErr('The maximum premium price is ₹1,00,000.'); return }
    if (!Number.isInteger(priceNum)) { setErr('Price must be a whole number of rupees.'); return }
    // Price > 0 with every day free would publish a premium price over fully
    // viewable content — a "Unlock Premium" CTA that unlocks nothing. Block it.
    if (!entirelyFree && free.size >= trip.days.length) { setErr('Every day is free — clear the price or lock a day.'); return }
    // The ≥1-free-day rule lived ONLY in the toggle guard above, so it was
    // enforced by interaction rather than at the point of writing: a `free` set
    // that arrived empty (a publication hydrated with `freeDayIndexes: []`)
    // slipped past `toggleDay` entirely and published a premium plan with zero
    // free days — `0 >= trip.days.length` is false, and the day buttons render
    // `disabled` because every day reads as free. Re-assert every invariant the
    // writer depends on here; the toggle guard stays as the friendly version.
    if (!entirelyFree && free.size < 1) { setErr('At least one day must stay free — it is the preview readers see.'); return }
    if (hasPremiumDay && !cta.trim()) { setErr('Premium days need a call-to-action — tell readers what they get when they unlock.'); return }
    setErr(null)
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
    } catch {
      // The store already toasts its own failure and rolls the cache back; this
      // keeps the form honest about the fact that nothing was published, rather
      // than leaving the last validation error standing as if it were the reason.
      setErr('Could not save the publication — nothing was published. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ts-form">
      <div className="ts-subhead">
        <b>Cover photo</b>
        <span className="small muted">Required — this is the picture every shared link previews with.</span>
      </div>
      <CoverImagePicker trip={trip} editable={isOwner} />
      {!trip.coverImageUrl && (
        <p className="hint-text ts-note">
          That preview is a suggestion the app found — nothing is saved yet, and a link cannot show it.
          Use it or paste your own; publishing needs a saved cover.
        </p>
      )}
      <Field label="Tagline" hint="One line that sells the route on Explore and the public page.">
        <input className="input" value={tagline} onChange={e => { setTagline(e.target.value); setErr(null) }} maxLength={140} />
      </Field>
      <div className="form-row">
        <Field label="Premium price (₹)" hint={priceNum > 0
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
            value={price} onChange={e => { setPrice(e.target.value); setErr(null) }} />
        </Field>
        <Field label="Best season" hint="Optional — shown as practical guidance.">
          <input className="input" value={bestSeason} onChange={e => { setBestSeason(e.target.value); setErr(null) }} placeholder="e.g. Sep–Mar" />
        </Field>
      </div>
      <Field label="Travel tips" hint="One per line.">
        <textarea className="textarea" rows={3} value={tips} onChange={e => { setTips(e.target.value); setErr(null) }} />
      </Field>
      <Field label="Subscriber call-to-action" hint={hasPremiumDay ? 'Required while any day is premium.' : 'Used on premium days — add one before charging.'}>
        <input className="input" value={cta} onChange={e => { setCta(e.target.value); setErr(null) }} placeholder="e.g. Full checklist + stay contacts." />
      </Field>

      <div className="ts-subhead">
        <b>Free preview days</b>
        {entirelyFree && <span className="small muted">Entirely free — every day is viewable.</span>}
      </div>
      <div className="ts-dayrows">
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

      {err && <p className="err-text ts-warn-note" role="alert">{err}</p>}
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
