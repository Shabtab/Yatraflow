// ============ Trip created - the moment after ============
// Peak-end, taken seriously: the last thing the create flow says should be
// specific and true, not confetti. This screen promises only what the engine
// already knows (anticipation.ts), hands the planner the invites they collected,
// and gets out of the way.
//
// Everything shown is either the trip's own numbers, a fact from the weather
// fetch, or the engine's own warnings. Nothing is recomputed behind the user's
// back: the bill figures ride over from the create page verbatim.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useDb, currentUser, useTrips, tripById, ensureInviteCode, userById,
} from '../store/store'
import { collectWarnings } from '../lib/engine'
import { anticipate, type AnticipationItem } from '../lib/anticipation'
import { estimateLunchStop } from '../lib/routeIq'
import { planJourneyHalts } from '../lib/geocode'
import { MODE_SPEED, isRoadMeasuredMode } from '../lib/engine'
import { fetchDailyWeather, forecastAvailable, isoAddDays } from '../lib/weather'
import { readHandoff, clearHandoff, billTotal } from '../lib/createHandoff'
import { shareBillImage } from '../lib/billCapture'
import { crewInviteMessage, PLANNER_ROLE_LINE, CREW_CHANNELS, inviteChannelUrl, channelNeedsPhone, telegramShareUrl, addCrewEntry, parseCrewEntry, type CrewChannel, type CrewEntry } from '../lib/crewInvite'
import { recordCreateEvent } from '../lib/createEvents'
import { nativeCopyText, nativeShareText } from '../lib/native'
import { haptic, HAPTIC } from '../lib/haptics'
import { toast } from '../components/ui'
import { useReveal } from '../hooks/useReveal'

type InviteStatus = 'idle' | 'sent' | 'copied' | 'skipped'

/** The in-flow collector caps at 4 (P5's anti-spam call); the moment-after
 *  screen is a calmer moment, so it allows a few more - but never unbounded. */
const CREW_LIMIT = 8

/* A Map, not a Record. The label is read with a VARIABLE channel key, and
   Codacy's `security/detect-object-injection` treats computed member access on
   an object as a generic injection sink - which is what held #310 at UNSTABLE
   across five lines. `Map.get` is a method call rather than a sink, so the same
   four channels stay one source of truth with no bracket read anywhere. */
const CHANNEL_LABEL = new Map<CrewChannel, string>([
  ['whatsapp', 'WhatsApp'],
  ['telegram', 'Telegram'],
  ['sms', 'SMS'],
  ['insta', 'Insta'],
])

/** The label for a channel, falling back to the channel id itself. */
function channelLabel(ch: CrewChannel): string {
  return CHANNEL_LABEL.get(ch) ?? ch
}

/** The receipt capture inlines fonts and can stall on a cross-origin stylesheet
 *  (html-to-image retries such a fetch indefinitely - SecurityError on
 *  cssRules). A stuck button is worse than a plainer share, so the capture gets
 *  a deadline and the text fallback takes over. */
const SHARE_TIMEOUT_MS = 8000

export function TripCreatedPage({ tripId, onNavigate }: { tripId: string; onNavigate: (r: string) => void }) {
  const db = useDb()
  const trips = useTrips()
  const me = currentUser(db)
  const trip = useMemo(() => trips.find(t => t.id === tripId) ?? tripById(tripId) ?? null, [trips, tripId])
  const handoff = useMemo(() => readHandoff(tripId), [tripId])

  const [inviteCode, setInviteCode] = useState<string | null>(null)
  /* A Map, for the same reason as CHANNEL_LABEL: every read is keyed by a crew
     INDEX, and `statuses[i]` is the computed-member-access shape Codacy flags.
     The writes become `set`/`new Map(s)` below - one representation, no brackets. */
  const [statuses, setStatuses] = useState<Map<number, InviteStatus>>(() => new Map())
  /** P7 - the receipt node the shared image is captured from. It is rendered
   *  off-screen: the artifact is the dark till-roll the product prints
   *  elsewhere, which is not what this page should look like. */
  const receiptRef = useRef<HTMLDivElement>(null)
  const [sharing, setSharing] = useState(false)
  /** Crew added after creation - raw entries, merged into the list below. */
  const [extras, setExtras] = useState<string[]>([])
  const [crewInput, setCrewInput] = useState('')

  // the join link: the same short code the Share tab mints, lazily
  useEffect(() => {
    if (!trip) return
    let alive = true
    void ensureInviteCode(trip.id).then(code => { if (alive && code) setInviteCode(code) })
    return () => { alive = false }
  }, [trip?.id])

  const joinUrl = inviteCode
    ? `${typeof location !== 'undefined' ? location.origin : ''}/#/join/${inviteCode}`
    : ''

  // conflicts: the engine's own collector, read once for this trip
  const conflicts = useMemo(() => {
    if (!trip) return [] as { title: string; detail: string }[]
    try {
      return collectWarnings(trip)
        .filter(w => w.severity === 'high' || w.severity === 'medium')
        .slice(0, 2)
        .map(w => ({ title: w.title, detail: w.detail }))
    } catch {
      return []
    }
  }, [trip])

  // weather: only inside the honest forecast window
  const [rainyDays, setRainyDays] = useState<number[]>([])
  // The fuel line's source: the real halt plan over the trip's own corridor -
  // the same planner the workspace's day planner uses, asked here for one
  // number (how many fuel stops the drive implies) and their along-route
  // positions. Road-modes only: a flight's "fuel halts" is a category error,
  // and the planner's road math would say nothing honest about one. Degrades
  // silently - an empty list makes the anticipation skip the fuel line, the
  // same shape a failed weather fetch takes (a forecast we cannot get says
  // nothing).
  const [fuelHalts, setFuelHalts] = useState<{ title: string; cumKm: number }[]>([])
  useEffect(() => {
    if (!trip) return
    if (!isRoadMeasuredMode(trip.transportMode)) return
    const points = [
      ...(trip.startLocationCoords ? [{ lat: trip.startLocationCoords.lat, lng: trip.startLocationCoords.lng }] : []),
      ...(trip.destinationCoords ?? []).filter((c): c is { lat: number; lng: number } => !!c),
    ]
    if (points.length < 2) return
    const roadKm = handoff?.bill?.roadKm ?? handoff?.roadKm ?? null
    const totalKm = roadKm ?? 0
    if (totalKm <= 0) return
    const days = trip.days.length || 1
    const driveMinutes = Math.round((totalKm / (MODE_SPEED[trip.transportMode] ?? 42)) * 60)
    let alive = true
    planJourneyHalts(
      points, totalKm, driveMinutes,
      { includeFuel: true, travellers: trip.travellers, travelStyle: trip.travelStyle, transportMode: trip.transportMode, multiDay: days > 1 },
    )
      .then(hits => {
        if (!alive) return
        setFuelHalts(
          hits
            // A fuel tick folded into a meal/overnight (#144A - "refuel where
            // you eat or sleep") keeps its fuel service in the LABEL
            // ("Overnight + fuel"), not in `purpose`, and the corridor scan
            // often names no pump at all. Matching purpose alone while
            // requiring a name dropped every halt the planner made (measured
            // on a 1,421 km plan: 3 fuel ticks - one folded+named, one
            // folded+unnamed, one pure-fuel+unnamed - 0 surfaced). An unnamed
            // halt keeps the engine's own label as its title rather than
            // vanishing from the count.
            .filter(h => h.segment.purpose === 'fuel' || /fuel|charge/i.test(h.segment.label))
            .map(h => ({ title: h.hit?.name || h.segment.label, cumKm: h.segment.targetKm })),
        )
      })
      .catch(() => { /* the planner failing says nothing - the line just skips */ })
    /* The guard above needs this cleanup to mean anything. Without it `alive` is
       never set false, so `if (!alive) return` was dead code - which is precisely
       what Codacy reported, and it was right. The weather effect below already
       pairs guard and cleanup; this one had the guard and never the cleanup. */
    return () => { alive = false }
  }, [trip?.id, handoff])
  // weather: only inside the honest forecast window
  useEffect(() => {
    if (!trip) return
    if (!forecastAvailable(trip.startDate)) return
    const anchor = trip.startLocationCoords
    if (!anchor) return
    let alive = true
    fetchDailyWeather(anchor.lat, anchor.lng, trip.startDate, trip.days.length || 1)
      .then(w => {
        if (!alive) return
        const wet: number[] = []
        trip.days.forEach((_, i) => {
          const day = w[isoAddDays(trip.startDate, i)]
          if (day && day.rainChancePct >= 60) wet.push(i)
        })
        setRainyDays(wet)
      })
      .catch(() => { /* a forecast we could not get says nothing */ })
    return () => { alive = false }
  }, [trip?.id])

  const items: AnticipationItem[] = useMemo(() => {
    if (!trip) return []
    // the meal line's source: the trip's own coordinates and mode, measured the
    // same way routeIq does - the destination the clock lands on at lunchtime.
    const points = [
      ...(trip.startLocationCoords ? [{ name: trip.startLocation, lat: trip.startLocationCoords.lat, lng: trip.startLocationCoords.lng }] : []),
      ...(trip.destinations ?? []).map((d, i) => ({ name: d, lat: trip.destinationCoords?.[i]?.lat, lng: trip.destinationCoords?.[i]?.lng })),
    ]
    return anticipate({
      tripName: trip.name,
      days: trip.days.length,
      travellers: trip.travellers,
      roadKm: handoff?.bill?.roadKm ?? handoff?.roadKm ?? null,
      rangeKm: handoff?.rangeKm ?? null,
      fuelHalts,
      lunch: estimateLunchStop(points, trip.transportMode),
      rainyDays,
      conflicts,
    })
    // fuelHalts belongs in this deps list: the halt fetch resolves AFTER this
    // memo's first run, and without the dep the fetched halts sat in state
    // while the list kept rendering the memo's empty-closure shape — visible
    // only if rain or conflicts happened to change later (a race, live-caught
    // on a 1,421 km trip that planned fuel halts the list never showed).
  }, [trip?.id, handoff, rainyDays, conflicts, fuelHalts])

  // Crew composition is pure and hook-ordered: it lives ABOVE the `!trip`
  // early return so the render's hook count never changes (a conditional
  // useMemo here crashed the screen on first load - "Rendered more hooks
  // than during the previous render" - because trips hydrate after mount).
  const crew = useMemo(
    () =>
      extras.reduce<CrewEntry[]>(
        (acc, raw) => addCrewEntry(acc, raw, CREW_LIMIT),
        // handoff entries re-enter through the same parse/dedupe as new ones,
        // so a duplicate added here is refused no matter which side it came from
        (handoff?.crew ?? [])
          .map(m => (m.phone ? `${m.name} ${m.phone}` : m.name).trim())
          .map(parseCrewEntry),
      ),
    [handoff, extras],
  )

  /* Entry choreography. This page had none at all, and it is the one surface
     where motion earns its keep: a confirmation the user lands on exactly once,
     whose cards should arrive staggered rather than snap into place. Called
     above the early return so hook order stays unconditional. The shared hook
     also re-scans on mutation, which matters here because all three cards are
     conditional - a late-mounting one would otherwise be hidden by the armed
     body class and never observed. */
  useReveal()

  if (!trip) {
    return (
      <div className="container created-page">
        <p className="muted">That trip is not loaded on this device.</p>
        <button className="btn btn-primary" onClick={() => onNavigate('/trips')}>Go to my trips</button>
      </div>
    )
  }

  const bill = handoff?.bill ?? null

  function inviteText(): string {
    return crewInviteMessage({
      tripName: trip!.name,
      joinUrl: joinUrl || (typeof location !== 'undefined' ? location.origin : ''),
      plannerName: handoff?.plannerName || me?.profile.name || '',
    })
  }

  async function sendInvite(index: number, channel: CrewChannel) {
    /* A bounds check on the INDEX rather than `if (!member)`. TS types
       `crew[index]` as non-optional, so the old guard read as "always falsy" to
       Codacy - and it was equally a no-op at runtime. This actually bounds it. */
    if (index < 0 || index >= crew.length) return
    const member = crew[index]
    if (channelNeedsPhone(channel) && !member.phone) return
    haptic(HAPTIC.select)
    // #428: the channel enum only — never the recipient, never the message.
    recordCreateEvent('moment_invite_sent', { channel }, { tripId: trip?.id })
    setStatuses(s => new Map(s).set(index, 'sent'))
    const text = inviteText()
    const url = inviteChannelUrl(channel, member.phone, text, joinUrl || (typeof location !== 'undefined' ? location.origin : ''))
    if (url) {
      if (openExternal(url)) return
      toast('The browser blocked the link - the invite is on this page to copy.', 'err')
      return
    }
    // No direct scheme (Instagram has no DM intent URL): the OS share sheet
    // carries it - its picker includes DMs and everything else installed.
    const res = await nativeShareText({ text, title: trip!.name })
    if (res === 'unavailable') toast('No share sheet here - the invite link is on this page to copy.', 'err')
  }

  /** Add a crew member from this screen. Same parse/dedupe rules as the
   *  create-page collector, so the list stays clean wherever it is edited. */
  function addExtra() {
    const raw = crewInput.trim()
    if (raw.length < 2 || crew.length >= CREW_LIMIT) return
    const merged = addCrewEntry(crew, raw, CREW_LIMIT)
    if (merged.length === crew.length) {
      toast('That entry is already on the crew list')
      setCrewInput('')
      return
    }
    setExtras(x => [...x, raw])
    setCrewInput('')
    haptic(HAPTIC.tick)
  }

  /** Send the invite with no recipient chosen - WhatsApp/Telegram open their
   *  own chooser; SMS/Insta ride the OS share sheet (Android and iOS prefill
   *  the body there). Everything degrades to the copied link. */
  async function broadcastInvite(channel: CrewChannel) {
    haptic(HAPTIC.select)
    // #428: the no-recipient variant — same channel enum, same PII rule.
    recordCreateEvent('moment_invite_sent', { channel }, { tripId: trip?.id })
    const text = inviteText()
    const url = channel === 'whatsapp'
      ? `https://wa.me/?text=${encodeURIComponent(text)}`
      : channel === 'telegram'
        ? telegramShareUrl(text, joinUrl || (typeof location !== 'undefined' ? location.origin : ''))
        : null
    if (url) {
      if (openExternal(url)) return
      toast('The browser blocked the link - the invite is on this page to copy.', 'err')
      return
    }
    const res = await nativeShareText({ text, title: trip!.name })
    if (res === 'unavailable') {
      const copied = await nativeCopyText(text)
      toast(copied ? 'Invite copied - paste it into the chat' : 'No share sheet here - the invite link is on this page to copy.', copied ? undefined : 'err')
    }
  }

  async function copyAll() {
    haptic(HAPTIC.tick)
    const text = inviteText()
    const res = await nativeCopyText(text)
    setStatuses(s => {
      const next = new Map(s)
      crew.forEach((_, i) => { next.set(i, 'copied') })
      return next
    })
    toast(res ? 'Invite copied - paste it wherever the crew talks' : 'Copy it from the link on this page')
  }

  function finish() {
    haptic(HAPTIC.success)
    clearHandoff()
    onNavigate(`/trip/${trip!.id}`)
  }

  /** P7 - share the rough take as the product's own receipt image. Every exit
   *  is accounted for: a dismissed sheet is not an error, and anything else
   *  falls back to the numbers as text rather than a dead button. */
  async function shareTake() {
    haptic(HAPTIC.select)
    setSharing(true)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        shareBillImage(receiptRef.current),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('capture timed out')), SHARE_TIMEOUT_MS)
        }),
      ])
      toast(result === 'shared' ? 'Rough take shared' : result === 'copied' ? 'Receipt image copied' : 'Receipt image downloaded')
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return
      // image share unavailable or too slow - the numbers as text still travel
      const copied = await nativeCopyText(takeText())
      toast(copied ? 'Copied the rough take as text instead' : 'Could not share - the numbers are on this page')
    } finally {
      if (timer) clearTimeout(timer)
      setSharing(false)
    }
  }

  /** The text fallback - the same facts, readable anywhere. */
  function takeText(): string {
    const b = handoff?.bill
    const total = billTotal(b ?? null, trip!.travellers)
    const lines = [`${trip!.name} - ${trip!.days.length} days`]
    if (trip!.destinations.length) lines.push(trip!.destinations.join(' \u00b7 '))
    if (b?.perHead != null) lines.push(`\u20b9${b.perHead.toLocaleString('en-IN')} per head${total != null ? ` \u00b7 \u20b9${total.toLocaleString('en-IN')} for the group` : ''}`)
    lines.push('Rough take from YatraFlow - every number shows its math.')
    return lines.join('\n')
  }

  return (
    <div className="container created-page">
      {/* The mockup's moment-after composition: the celebration column beside
          the artifact column (the bill and where to go next). */}
      <div className="created-cols">
      <div className="created-celebrate">
      <header className="created-head reveal">
        <p className="eyebrow">Trip created</p>
        <h1><span className="created-name">{trip.name}</span> is live.</h1>
        <p className="muted small">Now the engine starts working for you.</p>
      </header>

      {items.length > 0 && (
        <div className="bezel reveal reveal-d1">
          <section className="created-card" aria-label="What the engine already knows">
            <h2 className="created-card-title">Watch for these - the engine already knows</h2>
            <ul className="created-list">
              {items.map(item => (
                <li key={item.key} className={`created-item kind-${item.kind}`}>
                  <span className="created-badge" aria-hidden>{badgeFor(item.kind)}</span>
                  <span className="created-item-body">
                    <b>{item.headline}</b>
                    <span className="created-detail">{item.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <div className="bezel reveal reveal-d2">
        <section className="created-card" aria-label="Bring the crew">
          <h2 className="created-card-title">The crew <span className="created-role">{PLANNER_ROLE_LINE}</span></h2>
          {crew.length === 0 && (
            <p className="created-detail">No one on the list yet - add them here; the invite is ready the moment you do.</p>
          )}
          <div className="created-crew">
            {crew.map((m, i) => (
              <div key={`${m.phone ?? m.name}-${i}`} className={`created-crew-row${statuses.get(i) === 'sent' || statuses.get(i) === 'copied' ? ' done' : ''}`}>
                <span className="created-dot" aria-hidden />
                <span className="created-crew-name">{m.name || `+91 ${m.phone}`}</span>
                <span className="created-channels" role="group" aria-label="Send the invite">
                  {CREW_CHANNELS.map(ch => {
                    const off = channelNeedsPhone(ch) && !m.phone
                    return (
                      <button key={ch} type="button" className="created-ch" disabled={off}
                        title={off ? 'needs a number - Telegram or the share sheet work without one' : `Send via ${channelLabel(ch)}`}
                        aria-label={`Send the invite via ${channelLabel(ch)}`}
                        onClick={() => void sendInvite(i, ch)}>
                        {channelLabel(ch)}
                      </button>
                    )
                  })}
                </span>
                {!m.phone && <span className="created-crew-hint">no number - Telegram or the share sheet still work</span>}
                <span className="created-crew-status">{statusLabel(statuses.get(i), m.phone)}</span>
              </div>
            ))}
          </div>
          <div className="created-crew-add">
            <input
              value={crewInput}
              onChange={e => { setCrewInput(e.target.value) }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExtra() } }}
              placeholder="Name or mobile - e.g. Ammu 98450 21234"
              aria-label="Add a crew member by name or mobile number"
              maxLength={40}
            />
            <button type="button" className="btn btn-outline btn-sm" onClick={addExtra}
              disabled={crewInput.trim().length < 2 || crew.length >= CREW_LIMIT}>
              Add to crew
            </button>
          </div>
          <div className="created-crew-acts">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void copyAll()}>Copy the invite</button>
            {joinUrl && <code className="created-link" title={joinUrl}>{joinUrl}</code>}
          </div>
          {joinUrl && (
            <p className="created-detail">They get: {crewInviteMessage({ tripName: trip.name, joinUrl, plannerName: handoff?.plannerName || me?.profile.name || '' })}</p>
          )}
        </section>
      </div>

      {/* The mockup's share row: the green action travels, the invite copies. */}
      {bill && bill.perHead != null && (
        <div className="created-share">
          <button type="button" className="share-main" onClick={() => void shareTake()} disabled={sharing}>
            {sharing ? 'Preparing\u2026' : 'Share the rough take'}
          </button>
          {joinUrl && <button type="button" className="share-ghost" onClick={() => void copyAll()}>Copy the invite</button>}
          <div className="created-broadcast" role="group" aria-label="Send the invite">
            <span className="created-broadcast-label">or send the invite on</span>
            {CREW_CHANNELS.map(ch => (
              <button key={ch} type="button" className="created-ch" aria-label={`Send the invite via ${channelLabel(ch)}`}
                onClick={() => void broadcastInvite(ch)}>
                {channelLabel(ch)}
              </button>
            ))}
          </div>
        </div>
      )}
      </div>

      <div className="created-side">
      {/* Reveal, but deliberately NOT a bezel: the bill card is a ticket artifact
          with its own language (zero padding, a .tk-head band), not one of the
          generic cards - wrapping a receipt in a glass tray muddies it. */}
      {bill && bill.perHead != null && (
        <section className="created-card created-billcard reveal reveal-d3" aria-label="The rough bill">
          <div className="tk-head"><span className="tk-brand">YatraFlow</span><span className="tk-kind">Rough bill</span></div>
          <div className="created-bill-body">
          <h2 className="created-card-title">{trip.name}</h2>
          <p className="created-bill-rt">{`${trip.destinations.length ? trip.destinations.join(' \u00b7 ') : trip.startLocation} \u00b7 ${trip.days.length} days \u00b7 ${trip.travellers} heads`}</p>
          <div className="created-bill-rows">
            <div className="created-bill-row">
              <span>Road{bill.roadKm != null ? ` \u00b7 ${Math.round(bill.roadKm)} km` : ''}</span>
              <b>{bill.transportCost != null ? `\u20b9${bill.transportCost.toLocaleString('en-IN')}` : '-'}</b>
            </div>
            {bill.transportFormula && <p className="created-bill-formula">{bill.transportFormula}</p>}
            <div className="created-bill-row"><span>Stays</span><b>&#8377;{bill.stayCost.toLocaleString('en-IN')}</b></div>
            {bill.stayFormula && <p className="created-bill-formula">{bill.stayFormula}</p>}
            <div className="created-bill-row"><span>Food</span><b>&#8377;{bill.mealCost.toLocaleString('en-IN')}</b></div>
            {bill.mealFormula && <p className="created-bill-formula">{bill.mealFormula}</p>}
          </div>
          <p className="created-bill">
            <span className="created-bill-perhead">&#8377;{bill.perHead.toLocaleString('en-IN')}</span>
            <span className="created-bill-unit">per head</span>
            {billTotal(bill, trip.travellers) != null && (
              <span className="created-bill-total">&#8377;{billTotal(bill, trip.travellers)!.toLocaleString('en-IN')} for the group</span>
            )}
          </p>
          <p className="created-detail">Same rows the ticket printed - the workspace refines them as the route resolves. Excludes tolls, parking and entry fees.</p>
          <p className="created-sig">every number shows its math - YatraFlow</p>
          </div>
        </section>
      )}

      {/* The artifact itself - off-screen, dark till-roll, captured on demand. */}
      {bill && (
        <div className="created-receipt-holder" aria-hidden="true">
          <div className="bench-receipt card" ref={receiptRef}>
            <span className="bench-barcode" />
            <span className="bench-stamp">Rough take</span>
            <div className="bench-receipt-head">
              <span className="bench-receipt-kicker">YatraFlow</span>
              <span className="bench-receipt-date">{trip.name}</span>
            </div>
            <div className="bench-meta-row"><span>{trip.days.length} days \u00b7 {trip.travellers} travellers</span></div>
            <div className="bench-total">
              <div className="bench-total-label">Per head</div>
              <div className="bench-total-main bench-total-perhead">
                <span>&#8377;{bill.perHead != null ? bill.perHead.toLocaleString('en-IN') : '-'}</span>
                <span className="bench-perhead-unit">/ head</span>
              </div>
              <span className="bench-total-sub">
                {billTotal(bill, trip.travellers) != null ? `\u20b9${billTotal(bill, trip.travellers)!.toLocaleString('en-IN')} total` : ''}
                {bill.roadKm != null ? ` \u00b7 ${Math.round(bill.roadKm)} km` : ''} \u00b7 {trip.days.length} days
              </span>
            </div>
            <div className="bench-receipt-lines">
              <div className="bench-line">
                <div className="bench-line-head"><span>Fuel</span><b>{bill.transportCost != null ? `\u20b9${bill.transportCost.toLocaleString('en-IN')}` : '-'}</b></div>
                <span className="bench-line-formula">{bill.transportFormula}</span>
              </div>
              <div className="bench-line">
                <div className="bench-line-head"><span>Stays</span><b>&#8377;{bill.stayCost.toLocaleString('en-IN')}</b></div>
                <span className="bench-line-formula">{bill.stayFormula}</span>
              </div>
              <div className="bench-line">
                <div className="bench-line-head"><span>Food</span><b>&#8377;{bill.mealCost.toLocaleString('en-IN')}</b></div>
                <span className="bench-line-formula">{bill.mealFormula}</span>
              </div>
            </div>
            <p className="bench-line-formula">every number shows its math \u00b7 YatraFlow</p>
          </div>
        </div>
      )}

      <div className="created-next">
        <button type="button" className="ns ns-primary ns-work" onClick={finish}>
          <span className="ns-ic" aria-hidden>M</span>
          <span className="ns-body"><b>Open the workspace</b><span>The map, slots and engine are already working on this plan.</span></span>
          <span className="ns-ar" aria-hidden>→</span>
        </button>
        {crew.length > 0 && (
          <button type="button" className="ns ns-crew" onClick={() => void copyAll()}>
            <span className="ns-ic" aria-hidden>C</span>
            <span className="ns-body"><b>Bring the crew</b><span>Copy the invite, or send it from each row above.</span></span>
            <span className="ns-ar" aria-hidden>→</span>
          </button>
        )}
        {conflicts.length > 0 && (
          <button type="button" className="ns ns-watch" onClick={finish}>
            <span className="ns-ic" aria-hidden>W</span>
            <span className="ns-body"><b>Watch {conflicts[0].title.split(' ').slice(0, 4).join(' ')}</b><span>Open the plan on that day before it gets tight.</span></span>
            <span className="ns-ar" aria-hidden>→</span>
          </button>
        )}
        <button type="button" className="ns ns-quiet" onClick={() => { clearHandoff(); onNavigate('/trips') }}>
          <span className="ns-body"><b>Back to my trips</b></span>
        </button>
      </div>
      </div>
      </div>
    </div>
  )
}

/** Open an external link without handing the tab back: `window.open(url,
 *  '_blank', 'noopener')` ALWAYS returns null (noopener implies no window
 *  handle), so "did it open" can never be read from the return value. The
 *  opener is detached instead - the popup-blocker toast only fires on a real
 *  throw (rare, and the invite is on the page to copy either way). */
function openExternal(url: string): boolean {
  try {
    const win = window.open(url, '_blank')
    if (win) { try { win.opener = null } catch { /* cross-origin refuse is fine */ } }
    return true
  } catch {
    return false
  }
}

function badgeFor(kind: AnticipationItem['kind']): string {
  switch (kind) {
    case 'conflict': return '\u26A0'
    case 'weather': return '\u2602'
    case 'meal': return '\u25CF'
    case 'fuel': return '\u26FD'
    default: return '\u25B8'
  }
}

function statusLabel(status: InviteStatus | undefined, phone: string | null): string {
  if (status === 'sent') return 'invite opened'
  if (status === 'copied') return 'copied'
  if (!phone) return ''
  return 'ready'
}
