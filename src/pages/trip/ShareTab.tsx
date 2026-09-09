// ============ Trip workspace — Share tab ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
// Includes SnapshotCard — ShareTab is its only consumer.
import React, { useEffect, useRef, useState } from 'react'
import { CalendarDays, Download, Link2, Lock, Upload } from 'lucide-react'
import type { Trip, PublishedItinerary } from '../../data/types'
import { useDb, userById, setMemberRole, removeMember, restoreMember, publishItinerary, unpublishItinerary, duplicateTrip, ensureInviteCode } from '../../store/store'
import { encodeTripSnapshot, snapshotUrl, downloadTripJson } from '../../lib/snapshot'
import { downloadTripIcs } from '../../lib/ics'
import type { LegEstimate } from '../../lib/engine'
import { Avatar, Chip, ConfirmDialog, CopyButton, Field, toast, undoToast } from '../../components/ui'
import { PrintExport } from '../../components/PrintExport'
import { TripSettingsForm } from './TripSettingsForm'
import { timeAgo } from './shared'

// ================= Snapshot (export / import / URL share) =================

function SnapshotCard({ trip, me, onNavigate, legCorrections }: {
  trip: Trip
  me: { id: string }
  onNavigate: (r: string) => void
  legCorrections?: Record<string, LegEstimate>
}) {
  const [link, setLink] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function makeLink() {
    const payload = await encodeTripSnapshot(trip)
    const url = snapshotUrl(trip, payload)
    setLink(url)
    navigator.clipboard?.writeText(url).catch(() => {})
    toast('Snapshot link copied — anyone can open it, no account needed')
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const imported = JSON.parse(await file.text()) as Trip
      if (!imported || !Array.isArray(imported.days)) throw new Error('bad shape')
      duplicateTrip(imported, me!.id)
      toast(`Imported “${imported.name}” into your trips`)
      onNavigate('/trips')
    } catch {
      toast('That file is not a valid YatraFlow trip export', 'err')
    }
    e.target.value = ''
  }

  return (
    <div className="card">
      <span className="share-intent share-intent--info">3 · Keep a record</span>
      <h3>Export & snapshot sharing</h3>
      <p className="hint-text" style={{ margin: '6px 0 12px' }}>
        Take the whole plan anywhere — no server stores it. Snapshot links embed the trip in the URL itself.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}><Upload size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Import JSON</button>
                  <button className="btn btn-outline btn-sm" onClick={() => downloadTripJson(trip)}><Download size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Download JSON</button>
                  <PrintExport trip={trip} legCorrections={legCorrections} />
                  <button className="btn btn-outline btn-sm" onClick={() => downloadTripIcs(trip, legCorrections)} title="One calendar event per day plus timed events for fixed commitments — imports into Google/Apple/Outlook calendars"><CalendarDays size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Add to calendar</button>
                  <button className="btn btn-saffron btn-sm" onClick={makeLink}><Link2 size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />Create snapshot link</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
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
function PublicationForm({ trip, pub, isOwner, creatorId, onDone }: {
  trip: Trip
  pub: PublishedItinerary | undefined
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

  function submit() {
    if (!Number.isFinite(priceNum) || priceNum < 0) { setErr('Price must be a number of rupees, 0 or more.'); return }
    // Price > 0 with every day free would publish a premium price over fully
    // viewable content — a "Unlock Premium" CTA that unlocks nothing. Block it.
    if (!entirelyFree && free.size >= trip.days.length) { setErr('Every day is free — clear the price or lock a day.'); return }
    if (hasPremiumDay && !cta.trim()) { setErr('Premium days need a call-to-action — tell readers what they get when they unlock.'); return }
    setErr(null)
    publishItinerary({
      tripId: trip.id, creatorId,
      title: trip.name,
      coverImageUrl: trip.coverImageUrl,
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
    onDone(Boolean(pub))
  }

  return (
    <div className="ts-form">
      <Field label="Tagline" hint="One line that sells the route on Explore and the public page.">
        <input className="input" value={tagline} onChange={e => setTagline(e.target.value)} maxLength={140} />
      </Field>
      <div className="form-row">
        <Field label="Premium price (₹)" hint="Leave empty or 0 for an entirely free itinerary.">
          <input className="input" type="number" min={0} inputMode="numeric" placeholder="e.g. 199"
            value={price} onChange={e => { setPrice(e.target.value); setErr(null) }} />
        </Field>
        <Field label="Best season" hint="Optional — shown as practical guidance.">
          <input className="input" value={bestSeason} onChange={e => setBestSeason(e.target.value)} placeholder="e.g. Sep–Mar" />
        </Field>
      </div>
      <Field label="Travel tips" hint="One per line.">
        <textarea className="textarea" rows={3} value={tips} onChange={e => setTips(e.target.value)} />
      </Field>
      <Field label="Subscriber call-to-action" hint={hasPremiumDay ? 'Required while any day is premium.' : 'Used on premium days — add one before charging.'}>
        <input className="input" value={cta} onChange={e => setCta(e.target.value)} placeholder="e.g. Full checklist + stay contacts." />
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
                aria-label={`Day ${d.index + 1}${d.title ? ` — ${d.title}` : ''} lock`}
                onClick={() => toggleDay(d.index)}>
                {isFree ? <>Free</> : <><Lock size={11} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />Premium</>}
              </button>
            </div>
          )
        })}
      </div>

      {err && <p className="err-text ts-warn-note" role="alert">{err}</p>}
      <button className="btn btn-saffron" disabled={!isOwner} onClick={submit}>
        {pub ? 'Update publication' : 'Publish to Explore'}
      </button>
      {!isOwner && <p className="hint-text ts-note">Only the trip owner can publish.</p>}
    </div>
  )
}

// ================= Share tab (tabbed) =================
// Reworked from the original .two-col grid into an ARIA tablist so each share
// concern (plan together / publish / keep a record / settings) gets its own
// focused surface instead of competing for space in a 340px sidebar. The
// Danger zone is re-homed under "Plan together" (matches the approved variant).
// Heading order is corrected (page h1 → panel h2 → card h3) via sr-only h2s.

const SHARE_TABS = [
  { id: 'plan', label: '1 · Plan together' },
  { id: 'publish', label: '2 · Share publicly' },
  { id: 'record', label: '3 · Keep a record' },
  { id: 'settings', label: 'Trip settings' },
] as const
type ShareTabId = (typeof SHARE_TABS)[number]['id']

export function ShareTab({ trip, me, editable, onNavigate, legCorrections }: {
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
    ? `${location.origin}${location.pathname}#/join/${inviteCode}`
    : `${location.origin}${location.pathname}#/invite/${trip.id}`
  const pub = db.published.find(p => p.tripId === trip.id)
  const pubLink = pub ? `${location.origin}${location.pathname}#/pub/${pub.id}` : ''
  const isOwner = (trip.members ?? []).some(m => m.userId === me.id && m.role === 'owner')
  const [tab, setTab] = useState<ShareTabId>('plan')
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [pendingRemove, setPendingRemove] = useState<NonNullable<Trip['members']>[number] | null>(null)
  const [pendingUnpublish, setPendingUnpublish] = useState(false)

  // Roving tabindex + arrow/Home/End navigation with automatic activation.
  function onTabKey(e: React.KeyboardEvent, idx: number) {
    let next = idx
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % SHARE_TABS.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + SHARE_TABS.length) % SHARE_TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = SHARE_TABS.length - 1
    else return
    e.preventDefault()
    setTab(SHARE_TABS[next].id)
    tabRefs.current[next]?.focus()
  }

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
    unpublishItinerary(trip.id)
    setPendingUnpublish(false)
    toast('Unpublished — removed from Explore')
  }

  return (
    <div className="share-tabbed">
      <div className="share-tablist" role="tablist" aria-label="Share and trip options">
        {SHARE_TABS.map((t, i) => (
          <button key={t.id} ref={el => { tabRefs.current[i] = el }} type="button" role="tab"
            id={`share-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`share-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1} onClick={() => setTab(t.id)} onKeyDown={e => onTabKey(e, i)}
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
                      aria-label={`Role for ${u?.profile.name}`}>
                      {['editor', 'commenter', 'viewer'].map(r => <option key={r}>{r}</option>)}
                    </select>
                  ) : (
                    <Chip tone={m.role === 'owner' ? 'teal' : 'info'}>{m.role}</Chip>
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
          {pub && (
            <div className="row-between" style={{ marginBottom: 10 }}>
              <span className="small muted">Live on Explore · {pub.views} views · {pub.copies} forks</span>
              <button className="btn btn-outline btn-sm" onClick={() => onNavigate(`/pub/${pub.id}`)}>View public page</button>
            </div>
          )}
          <PublicationForm trip={trip} pub={pub} isOwner={isOwner} creatorId={me.id}
            onDone={wasPublished => toast(wasPublished ? 'Publication updated' : 'Published to Explore')} />
          {pub && (
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setPendingUnpublish(true)}>Unpublish</button>
          )}
          {pubLink && <div className="share-link-box" style={{ marginTop: 10 }}><code title={pubLink}>{pubLink}</code><CopyButton text={pubLink} label="Copy" /></div>}
        </div>
      </section>

      {/* ---- Keep a record ---- */}
      <section role="tabpanel" id="share-panel-record" aria-labelledby="share-tab-record"
        className="share-panel" hidden={tab !== 'record'}>
        <h2 className="sr-only">Keep a record</h2>
        <SnapshotCard trip={trip} me={me} onNavigate={onNavigate} legCorrections={legCorrections} />
      </section>

      {/* ---- Trip settings ---- */}
      <section role="tabpanel" id="share-panel-settings" aria-labelledby="share-tab-settings"
        className="share-panel" hidden={tab !== 'settings'}>
        <h2 className="sr-only">Trip settings</h2>
        <div className="card">
          <TripSettingsForm trip={trip} editable={editable} />
        </div>
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
        body="It will be removed from Explore immediately. You can publish it again anytime from this tab."
        confirmLabel="Unpublish"
        onConfirm={confirmUnpublish}
        onClose={() => setPendingUnpublish(false)}
      />
    </div>
  )
}
