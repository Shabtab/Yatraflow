// ============ Public itinerary page — editorial story + practical evidence (CTI §6.11) ============
// A shareable travel document, not the private workspace: destination-led hero,
// creator attribution, "why this route works" story, a practical stat cluster,
// and curated day highlights ahead of the detailed (and premium-gated) plan.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Calendar, Camera, Car, Clock, Flag, GitFork, Heart, Link2, Lock, MapPin,
  MessageCircle, Route, Sparkles, Ticket, TriangleAlert,
} from 'lucide-react'
import { InlineIcon, MetaIcon, modeIcon } from '../components/icons'
import { openExternal } from '../lib/native'
import type { Trip, PublishedItinerary } from '../data/types'
import type { Entitlement } from '../lib/payments'
import { useDb, currentUser, tripById, userById, registerPubView, fetchPublicTrip } from '../store/store'
import { forkPublication } from '../lib/forkPub'
import { describePreviewSplit } from '../lib/previewSplit'
import { simulateDay, scheduleRowsById, originOf, minutesToHM, formatInr, getAssumptions, computeTotals, isRoundTrip } from '../lib/engine'
import { cap, titleCase } from '../lib/labels'
import { useTimeFormat, formatHM, formatHMRange } from '../lib/timefmt'
import { stopKindOf, STOP_KIND_LABELS } from '../lib/stopKind'
import { useSavedPubs } from '../lib/savedPubs'
import { fetchMyEntitlements, fetchCreatorSales, fetchCreatorFunnel, purchaseUnlock, type FunnelDailyRow } from '../lib/unlock'
import { UnlockReveal } from '../components/UnlockReveal'
import { hasUnlock } from '../lib/payments'
import { buildPubFunnels, describePreLog, funnelGlance, type FunnelSale } from '../lib/pubFunnel'
import { currentPublicShareUrl, shareRefFromSearch, withShareRef } from '../lib/shareUrl'
import { sharePublicationOnWhatsApp } from '../lib/whatsAppShare'
import { appLink } from '../lib/appLink'
import { pageTitle } from '../lib/pageTitle'
import { sizedCoverUrl } from '../lib/tripThumb'
import { Avatar, Chip, EmptyState, toast, CopyButton, RouteSnapshot } from '../components/ui'

/** How long the buyer's entitlement read may take before the page stops
 *  waiting and says so. Mirrors the hub's ledger timeout: far longer than the
 *  select takes, far shorter than a buyer's patience. */
const ENTITLEMENT_READ_TIMEOUT_MS = 10_000

/**
 * What the locked gate shows while it does not know whether this viewer owns
 * the plan — and, on a FAILED read, the way back.
 *
 * The two states are different sentences on purpose. 'reading' is quiet: it is
 * a normal moment and an error there would cry wolf on every slow connection.
 * 'failed' is loud and offers Retry, because the alternative this replaced was
 * worse than silence — a price button on a plan the reader may already own.
 *
 * It renders NO price in either state. A CTA is a claim about ownership, and
 * ownership is exactly what could not be established.
 */
function UnlockCheckState({ read, onRetry, centered }: {
  read: 'ready' | 'reading' | 'failed'
  onRetry: () => void
  centered?: boolean
}) {
  if (read === 'reading') {
    return <p className="small muted" style={{ marginTop: 8, textAlign: centered ? 'center' : undefined }}>Checking your access…</p>
  }
  return (
    <div className="hub-note is-failure" role="alert" style={{ marginTop: 8, textAlign: centered ? 'center' : undefined }}>
      <b>Couldn&apos;t check your access.</b> We couldn&apos;t read what you own, so this plan stays locked
      rather than guess. If you have already paid for it, try again — nothing is charged twice.
      <button className="btn btn-outline btn-sm hub-note-action" onClick={onRetry}>Retry</button>
    </div>
  )
}

export function PublicItineraryPage({ slug, onNavigate }: { slug: string; onNavigate: (r: string) => void }) {
  const db = useDb()
  const timeFormat = useTimeFormat()
  const me = currentUser(db)
  const pub: PublishedItinerary | undefined = db.published.find(p => p.id === slug)
  // The membership-scoped hydration keeps other people's trips out of the
  // cache, so a public page's backing trip is usually NOT in `trips` — and
  // deliberately so: the CACHE carries unstubbed days only for the owner's
  // own session. A public viewer must read through fetchPublicTrip (the
  // get_public_trip RPC stubs locked days at the wire), never through a
  // cached row they didn't fetch themselves.
  const cachedTrip = pub ? tripById(pub.tripId) : undefined
  const [fetched, setFetched] = useState<Trip | null>(null)
  const [miss, setMiss] = useState(false)
  // Paid-unlock state (M7): entitlements are read on demand (RLS: own rows),
  // not carried in the hydrate cache. Re-read after a purchase resolves.
  const [entitlements, setEntitlements] = useState<Entitlement[]>([])
  // WHICH publication that read answered for. Needed by the soft-unpublish
  // branch below (#350): an entitlement list that is merely still empty cannot
  // tell "not a buyer" apart from "not read yet", and only one of those may be
  // told that the plan is gone. Held as the publication's id rather than a
  // boolean so a second publication on the same mounted page cannot inherit the
  // first one's read.
  const [entitlementsReadFor, setEntitlementsReadFor] = useState<string | null>(null)
  // #359 — the read's OUTCOME, which is a third fact and not a derivable one.
  // A failed read used to be caught into `[]`, so a paying buyer on a flaky
  // connection saw locked days and an "Unlock full plan · ₹499" button for a
  // plan they already owned. These two flags make the failure SAYABLE, which is
  // what the copy and the CTA gate on: the content stays locked (fail CLOSED)
  // while the page fails LOUD.
  const [entitlementsError, setEntitlementsError] = useState(false)
  const [entitlementsRetry, setEntitlementsRetry] = useState(0)
  // An attempt in flight, DERIVED from the retry/settled pair rather than
  // stored: storing it would need a setState in the effect body.
  const [entitlementsSettled, setEntitlementsSettled] = useState(-1)
  const entitlementsReading = entitlementsRetry !== entitlementsSettled
  const [buying, setBuying] = useState(false)
  // F3 (#227) — the WhatsApp send in flight, held so a double-tap cannot
  // fire two sheets or open two chat tabs. The §6a guard on an async path:
  // disabled while it runs, and the button says so.
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false)
  // The itinerary the unlock moment is showing, held separately from `fetched`:
  // it is only ever the copy the server served AFTER the entitlement existed
  // (see unlockThis), and it doubles as the reveal's open/closed state.
  const [revealTrip, setRevealTrip] = useState<Trip | null>(null)
  // #349 — which of the two wins is settled in the STORE, not here: every
  // fetchPublicTrip REPLACES the cached row for that id, so `cachedTrip` is the
  // wire's row for this viewer as of the last read and cannot shadow a fresher
  // one. Rendering the cached copy first is therefore not a preference between
  // stale and fresh — after a paid unlock both are the real days. (Preferring
  // `fetched` here as well would be a second mechanism for one question.)
  const trip: Trip | undefined = cachedTrip ?? fetched ?? undefined
  const { isSaved, toggleSaved } = useSavedPubs()
  // #360 — there is deliberately NO live-suggestion fallback for the hero.
  // It used to read the destination-cover hook over the shared candidates,
  // which put a Wikipedia photo of a guessed destination on the page while
  // `api/i.js` served `og-default.png` to every crawler — a
  // pre-cover-requirement row showed a picture to a human and a generic card
  // to an unfurl, indefinitely, and the picture was one the creator never
  // chose. The rule the two sides obey is "the crawler and the hero never
  // disagree", and the hero is the side that had to move. The photo comes
  // back the honest way: the cover sweep writes an OWNED, resized suggestion
  // into the row, after which `coverImageUrl` is set and both sides serve
  // the same stored URL.
  useEffect(() => {
    // #230 — the view carries its route in: the `ref` the shared link brought
    // (query, so it survives the redirect and address promotion), or null for a
    // visitor who arrived some other way — which is recorded as "direct".
    if (pub) registerPubView(pub.id, shareRefFromSearch(window.location.search))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // This page owns the publication record, so it is the only place that can put
  // the itinerary's own name in the tab. App titles every other route; for
  // `/pub/…` it can only say "Itinerary" without subscribing to this table.
  useEffect(() => {
    document.title = pageTitle(['pub'], pub?.title)
  }, [pub?.title])
  // Entitlements ride the session: read them when the viewer (or the
  // publication) becomes known, and never for the creator — hasUnlock
  // short-circuits creators anyway.
  const meId = me?.id ?? null
  useEffect(() => {
    if (!pub) return
    let alive = true
    const attempt = entitlementsRetry
    // Bounded, for the same reason the hub's reads are: "Checking your access…"
    // is an unfalsifiable claim unless every attempt resolves into a figure or
    // into a failure that still offers a way to ask again. The reason is
    // load-bearing — `unlock.ts` tells a cancellation from a timeout by it.
    const ac = new AbortController()
    const timer = setTimeout(
      () => ac.abort(new DOMException('the entitlements read timed out', 'TimeoutError')),
      ENTITLEMENT_READ_TIMEOUT_MS,
    )
    // REJECTS now, so this needs both arms. A success clears the failure flag;
    // a failure sets it WITHOUT clearing the entitlements, so a refresh that
    // could not be replaced keeps the access it already proved.
    void fetchMyEntitlements(meId)
      .then(rows => {
        if (!alive) return
        setEntitlements(rows)
        setEntitlementsReadFor(pub.id)
        setEntitlementsError(false)
      })
      .catch(() => { if (alive) setEntitlementsError(true) })
      .finally(() => { clearTimeout(timer); if (alive) setEntitlementsSettled(attempt) })
    return () => { alive = false; clearTimeout(timer); ac.abort() }
  }, [pub?.id, meId, entitlementsRetry])
  // ---- The creator's own glance (I-22 follow-up): the page's creator reads
  // how THIS link converts without opening the hub. Same RPC, same derivation
  // and same window rule as the hub (buildPubFunnels + funnelGlance), so a
  // number cannot differ between the two surfaces. A visitor's session never
  // runs these reads — isMyPub gates them, and the strip mounts for nobody
  // else. Sales ride along because the unlock stage comes from the ledger,
  // never from a re-recording of it.
  const isMyPub = !!(meId && pub && pub.creatorId === meId)
  const [myDaily, setMyDaily] = useState<FunnelDailyRow[] | null>(null)
  const [mySales, setMySales] = useState<FunnelSale[] | null>(null)
  const [myFunnelError, setMyFunnelError] = useState(false)
  const [mySalesError, setMySalesError] = useState(false)
  useEffect(() => {
    if (!isMyPub) return
    let alive = true
    setMyFunnelError(false)
    void fetchCreatorFunnel()
      .then(rows => { if (alive) setMyDaily(rows) })
      .catch(() => { if (alive) { setMyFunnelError(true); setMyDaily(null) } })
    void fetchCreatorSales()
      .then(rows => { if (alive) { setMySales(rows); setMySalesError(false) } })
      .catch(() => { if (alive) { setMySalesError(true); setMySales(null) } })
    return () => { alive = false }
  }, [isMyPub, pub?.id, meId])
  // Above the early return with every other hook (the #310 rule). A failed
  // funnel read surfaces as myFunnelError — the strip then says it failed
  // rather than rendering a measurement it does not have.
  const myGlance = useMemo(() => {
    if (!isMyPub || !pub || !myDaily || !mySales) return null
    const [f] = buildPubFunnels({
      daily: myDaily,
      sales: mySales,
      pubs: [{
        id: pub.id, title: pub.title, priceInr: pub.premiumPriceInr ?? null,
        lifetimeViews: pub.views, lifetimeForks: pub.copies,
      }],
      days: 7,
      now: Date.now(),
    })
    return { glance: funnelGlance(f), preLog: describePreLog(f) }
  }, [isMyPub, pub, myDaily, mySales])
  // A failed SALES read is a failed read too — the strip's unlock step would
  // otherwise render a zero that is a measurement of nothing.
  const myReadFailed = myFunnelError || mySalesError
  const myReadPending = !myFunnelError && myDaily === null
  useEffect(() => {
    if (!pub || fetched || miss) return
    let alive = true
    // Reads through get_public_trip: the SERVER decides what this viewer sees
    // (real days for the creator/an entitled buyer, stubbed locked days for
    // everyone else) — the paywall is at the wire, not in React. An unlock
    // re-runs this fetch: the same RPC now serves real days because the
    // entitlement row exists.
    void fetchPublicTrip(pub.id).then(t => {
      if (!alive) return
      if (t) setFetched(t)
      else setMiss(true)
    })
    return () => { alive = false }
  }, [pub, fetched, miss])

  // ---- practical evidence, computed from the real trip (no schema fields).
  // Every hook lives ABOVE the early return: the on-demand fetch means the
  // first render can legitimately lack the trip, and hooks after a
  // conditional return crash React (#310 "rendered more hooks") the moment
  // the fetch resolves.
  const totals = useMemo(() => (trip ? computeTotals(trip) : null), [trip])
  const orderedDays = useMemo(
    () => (trip ? [...trip.days].sort((a, b) => a.index - b.index) : []),
    [trip],
  )
  const routePoints = useMemo(() => {
    if (!trip) return undefined
    const pts: Array<{ lat: number; lng: number; day: number }> = []
    if (trip.startLocationCoords) pts.push({ lat: trip.startLocationCoords.lat, lng: trip.startLocationCoords.lng, day: 0 })
    for (const day of orderedDays) {
      for (const s of [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay)) {
        if (s.status !== 'rejected' && Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
          pts.push({ lat: s.lat, lng: s.lng, day: day.index })
        }
      }
    }
    return pts.length >= 2 ? pts : undefined
  }, [trip, orderedDays])

  // Curated highlights: the three meatiest days, back in trip order.
  const highlights = useMemo(() => {
    if (!trip) return []
    const scored = orderedDays.map(day => {
      const stops = [...day.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)
      const sim = simulateDay(day, trip, originOf(trip, day.index), day.index)
      const lead = stops.find(s => s.auto !== true) ?? stops[0]
      return {
        day,
        stops,
        score: stops.length + (sim.totalDistanceKm > 1 ? 1 : 0),
        kind: lead ? stopKindOf(lead) : 'drive' as const,
        meta: `${stops.length} stop${stops.length === 1 ? '' : 's'} · ~${minutesToHM(sim.totalTravelMinutes)} travel${sim.totalDistanceKm > 1 ? ` · ${sim.totalDistanceKm.toFixed(0)} km` : ''}`,
      }
    })
    return [...scored].sort((a, b) => b.score - a.score).slice(0, 3).sort((a, b) => a.day.index - b.day.index)
  }, [trip, orderedDays])

  // True when this viewer may read the locked days: the creator, or a buyer
  // with a paid entitlement. Gating here is presentation; the fork path and
  // RLS re-derive the same rule server-side. Computed ABOVE the render gates
  // because the soft-unpublish branch below needs exactly this question
  // answered: who may still open a publication that has come down. (Empty
  // strings while the row is missing — hasUnlock can match neither a creator id
  // nor an entitlement against those, so "no publication" reads as not
  // unlocked, which is what the loading/error branches below then say.)
  const unlocked = hasUnlock(entitlements, meId, pub?.id ?? '', pub?.creatorId ?? '')
  /** The entitlement read has landed FOR THIS publication. */
  const entitlementsRead = !!pub && entitlementsReadFor === pub.id
  // #359 — which of the three truths the gate is looking at. Ordered the way
  // `deriveLedgerRead` orders the hub's, and for the same reasons: a read that
  // already proved access stays 'ready' through a failed refresh, an in-flight
  // attempt is 'reading' so Retry cannot render as a dead button, and 'failed'
  // is reachable only when there is nothing to show and nothing in flight.
  //
  // The price CTA is gated on this, and that is the whole point: 'failed' must
  // never render "Unlock full plan · ₹499" over a read that might have found the
  // buyer's own entitlement. Fail CLOSED on the content, fail LOUD in the UI.
  const entitlementRead: 'ready' | 'reading' | 'failed' = entitlementsRead
    ? 'ready'
    : entitlementsReading
      ? 'reading'
      : entitlementsError
        ? 'failed'
        : 'reading'
  /** A logged-out visitor has nothing to check, so the CTA is honest for them. */
  const mayShowPriceCta = !meId || entitlementRead === 'ready'
  // #359 — asking again is a NEW question, so it takes a new attempt number; the
  // derived `entitlementsReading` flips true on its own and the button's own
  // label says "Checking…" rather than re-rendering the alert it was pressed
  // against (a dead button, per the hub's retry rule).
  const retryEntitlements = useCallback(() => { setEntitlementsRetry(n => n + 1) }, [])

  // ---- Soft-unpublish (#350). The row survives — that is what keeps buyers
  // whole — but the page is no longer public. The creator and anyone holding an
  // entitlement keep reading the real plan (the wire agrees: get_public_trip
  // serves them and refuses everyone else), and everyone else is told plainly
  // that it came down. Deliberately NOT the paywall: there is nothing left to
  // buy, so a preview, locked placeholders and an Unlock button would all be
  // lies about a plan that is off sale.
  if (pub && pub.unpublishedAt && !unlocked) {
    // An empty entitlement list is only evidence of "not a buyer" once the read
    // has landed; until then the honest state is the loading one, so a buyer is
    // never shown "no longer published" for the plan they paid for.
    if (!entitlementsRead) {
      return (
        <div className="container">
          <div className="container loading-block"><div className="spinner" />Loading itinerary…</div>
        </div>
      )
    }
    return (
      <div className="container">
        <EmptyState icon={<TriangleAlert size={38} aria-hidden />} title="This itinerary is no longer published"
          body="The creator took it off Explore, so it is no longer on sale. If you unlocked it, sign in with the account that bought it and the full plan is still yours — otherwise browse what’s published now."
          action={<button className="btn btn-primary" onClick={() => onNavigate('/explore')}>Back to Explore</button>} />
      </div>
    )
  }

  if (!pub || !trip) {
    return (
      <div className="container">
        {pub && !miss
          ? <div className="container loading-block"><div className="spinner" />Loading itinerary…</div>
          : /* The fetch returns null for a missing row AND for a failed select, so
               this copy must not pick one cause: it names the real possibilities
               and says plainly that the page cannot tell them apart. */
            <EmptyState icon={<Link2 size={38} aria-hidden />} title="This itinerary didn’t load"
              body="Unpublished, mistyped, or a dropped connection — we can’t tell which from here. Ask whoever shared it for a fresh link, or browse what’s published now."
              action={<button className="btn btn-primary" onClick={() => onNavigate('/explore')}>Back to Explore</button>} />}
      </div>
    )
  }
  // Past the gate every memo is fully computed — narrowed aliases keep the
  // rest of the body honest without re-checking `trip` everywhere.
  const totalsN = totals!
  const routePointsN = routePoints
  const highlightsN = highlights

  const creator = userById(pub.creatorId)
  // The stored cover is not necessarily sized: a row written before the sizing
  // fix holds the raw Wikimedia upload (a live publication shipped 1,305 KB as
  // its hero). Sized at render, so existing rows are fixed without a backfill.
  // #360 — a row with NO stored cover renders the branded background, and that
  // is the point rather than a gap: it is what `api/i.js` already serves such
  // a row as its card, so the two agree. `undefined` rather than a suggestion.
  const heroSrc = pub.coverImageUrl ? sizedCoverUrl(pub.coverImageUrl) : undefined
  // #230 — what leaves through the copy button names the button it left
  // through. Display and copy are the same string: the code box shows exactly
  // what lands on the clipboard.
  const shareLink = withShareRef(currentPublicShareUrl(pub.id), 'copy')
  // F7 (#228): the channel this visitor arrived through. A second hop inside
  // the same community keeps the post's reference — a link that travelled
  // through a community post does not forget where it came from — while a
  // fresh arrival stamps the send unit's own channel. It rides the link,
  // never the sentence. Vocabulary-checked: only a ShareSource survives the
  // read, so an unknown ref falls back to the default rather than travelling
  // onward.
  const arrivalRef = shareRefFromSearch(location.search)
  // F3 (#227): send this plan to a WhatsApp group. The sheet first (a phone
  // lists WhatsApp directly), click-to-chat otherwise — the fallback chain
  // lives in the helper; this holds the in-flight guard so a double-tap
  // cannot fire both. Nothing reads a window handle (§6e).
  async function sendOnWhatsApp() {
    if (sendingWhatsApp || !pub) return
    setSendingWhatsApp(true)
    try { await sharePublicationOnWhatsApp(pub, arrivalRef ?? 'wa') } finally { setSendingWhatsApp(false) }
  }
  // Undefined when the creator published the itinerary as entirely free —
  // the Unlock buttons below are hidden rather than inventing a ₹199 fallback.
  const price = pub.premiumPriceInr
  // Which days this publication withholds comes from its own freeDayIndexes —
  // never from an assumed tail. A live Spiti row (₹500) locks days 5–8 and
  // leaves 9–10 free, so "the later days stay preview-only" was false there.
  // Undefined when nothing is withheld: the price shows without a claim.
  const previewSplit = describePreviewSplit(pub.freeDayIndexes, trip.days.length)
  const savedFlag = isSaved(pub.id)

  function copyThis() {
    // The fork honors what the SERVER served this viewer: a buyer/creator's
    // session fetched real days through the RPC, a visitor's session got
    // stubs — forkPublication re-stubs from whatever arrived, so the fork can
    // never contain more than the server showed. The `unlocked` flag here is
    // presentation-only now; the wire already decided.
    void forkPublication(pub!, me?.id ?? null, onNavigate, unlocked, shareRefFromSearch(window.location.search))
  }

  function unlockThis() {
    if (buying) return // async purchase — no double modal (the #36-6 rule)
    setBuying(true)
    void purchaseUnlock({
      pubId: pub!.id,
      title: pub!.title,
      onUnlocked: () => {
        // #359 — this read REJECTS now, so a failure here must not be a
        // rejection nobody catches. It is routed through the same error flag the
        // first read uses, which is the honest outcome: the purchase succeeded
        // (the wire now serves real days) but the buyer's own shelf could not be
        // re-read, so the page says so rather than showing a stale access list.
        void fetchMyEntitlements(meId)
          .then(rows => { setEntitlements(rows); setEntitlementsError(false) })
          .catch(() => { setEntitlementsError(true) })
      },
    }).then(async outcome => {
      // Both a completed purchase and a 409 mean the days are readable now (the
      // 409 path can have just self-healed the grant), but only a purchase
      // earns the ceremony.
      if (outcome !== 'unlocked' && outcome !== 'already') return
      // This page holds the copy the server served BEFORE the purchase, and
      // that copy is wire-stubbed: the stub keeps stop titles and coordinates
      // while emptying descriptions, notes, timings and costs. Rendering it
      // with the lock lifted shows a full-looking plan that is still
      // placeholder text. Re-read through the same RPC — the entitlement now
      // exists, so it answers with real days — rather than clearing `fetched`,
      // which would flash the loading state mid-ceremony.
      const fresh = await fetchPublicTrip(pub!.id)
      if (fresh) setFetched(fresh)
      // The reveal opens only on a real trip: its numbers ARE the point, and
      // stats read from the stubbed copy would describe an empty plan.
      if (outcome === 'unlocked' && fresh) setRevealTrip(fresh)
    }).finally(() => setBuying(false))
  }

  function saveThis() {
    const nowSaved = toggleSaved(pub!.id)
    toast(nowSaved ? 'Saved to this browser.' : 'Removed from saved itineraries.')
  }

  // (totals/routePoints/highlights are computed by the guarded hooks above the
  //  gate — totalsN/routePointsN/highlightsN.)

  return (
    <div>
      {/* ---- Editorial hero: destination-led, creator-attributed (§6.11) ---- */}
      <section className="pub-hero">
        {heroSrc
          ? <img className="pub-hero-photo" src={heroSrc} alt="" aria-hidden="true" width={1600} height={900} loading="eager" decoding="async" />
          : null}
        <div className="pub-hero-bg" aria-hidden="true" />
        <div className="container pub-hero-inner">
          <button className="btn btn-sm btn-ghost pub-hero-back" onClick={() => onNavigate('/explore')}>← Explore</button>
          <span className="pub-hero-badge">{cap(pub.travelStyle)} itinerary</span>
          <p className="pub-hero-kicker">
            {trip.startLocation} → {trip.destinations.join(' → ')}
            {isRoundTrip(trip) && <> → {trip.startLocation}</>}
          </p>
          <h1 className="pub-hero-title">{pub.title}</h1>
          <p className="pub-hero-story">{pub.tagline}</p>
          <p className="pub-hero-byline">
            By {creator?.profile.name ?? 'a YatraFlow traveller'} · {pub.durationDays} days · {trip.travellers} travellers · {cap(trip.transportMode)}
            {creator?.profile.isCreator && <> · <InlineIcon icon={Sparkles} size={12} gap={2} vAlign="-1px" style={{ marginLeft: 2 }} />Creator</>}
          </p>
        </div>
        {/* "The practical bit" — the evidence cluster, floating over the hero */}
        <aside className="pub-hero-stats">
          <span className="pub-stats-label">The practical bit</span>
          <b className="pub-stats-figure">{formatInr(pub.estimatedBudgetPerPersonInr)}</b>
          <span className="pub-stats-sub">estimated per traveller</span>
          <hr className="pub-stats-divider" />
          <div className="pub-stats-row">
            <span><MetaIcon icon={ MapPin } tone="place" />{pub.routeSummary.length} place{pub.routeSummary.length === 1 ? '' : 's'}</span>
            <span><InlineIcon icon={Route} size={12} gap={3} />{totalsN.totalDistanceKm.toFixed(0)} km</span>
            <span><MetaIcon icon={ Clock } tone="time" />{minutesToHM(totalsN.totalTravelMinutes)} on the road</span>
            <span><MetaIcon icon={ Calendar } tone="time" />{pub.durationDays} days</span>
          </div>
        </aside>
      </section>

      <div className="container pub-body">
        {/* ---- Paper sheet: the editorial layer over the hero ---- */}
        <div className="paper-sheet">
          <div className="pub-actions">
            <b>Made to be copied, adjusted and made your own.</b>
            <div className="pub-actions-btns">
              <button className="btn save-btn" onClick={saveThis} aria-pressed={savedFlag}>
                <InlineIcon icon={Heart} size={13} gap={4} fill={savedFlag ? 'currentColor' : 'none'} />
                {savedFlag ? 'Saved' : 'Save itinerary'}
              </button>
              <button className="btn fork-btn" onClick={copyThis}><InlineIcon icon={GitFork} size={14} gap={4} />{me ? 'Fork this trip' : 'Log in to fork'}</button>
            </div>
          </div>

          <div className="two-col pub-editorial">
            <div>
              <span className="editorial-kicker">The journey</span>
              <h2 className="editorial-title">Why this route works</h2>
              <p className="editorial-body">
                Built around {minutesToHM(totalsN.totalTravelMinutes)} of real road time across {pub.durationDays} days —
                pacing, breaks and costs are all in the plan below.
              </p>
            </div>
            {/* Double-Bezel: this wrapper is the TRAY, the .card inside it is the
                PLATE. Same pair Explore uses, so there is one bezel recipe. */}
            <div className="bezel">
              <aside className="card route-snap route-glance">
                <span className="route-glance-label">The route at a glance</span>
                <RouteSnapshot
                  count={trip.days.length}
                  startLabel={trip.startLocation}
                  endLabel={trip.destinations[trip.destinations.length - 1]}
                  roundTripNote={isRoundTrip(trip) ? `↩ returns to ${trip.startLocation}` : undefined}
                  points={routePointsN}
                />
                <div className="route-glance-list">{pub.routeSummary.join(' · ')}</div>
                <span className="route-glance-meta">{totalsN.stopCount} stops in the plan</span>
              </aside>
            </div>
          </div>

          {highlightsN.length > 0 && (
            <div className="pub-highlights">
              <span className="editorial-kicker">Trip highlights</span>
              <h2 className="editorial-title">The rhythm of {pub.durationDays} days</h2>
              <div className="day-highlight-row">
                {highlightsN.map(h => (
                  <div key={h.day.id} className="day-highlight-card">
                    <div className="day-highlight-top">
                      <span className="editorial-kicker">Day {String(h.day.index + 1).padStart(2, '0')} · {STOP_KIND_LABELS[h.kind]}</span>
                      <span className={`stop-kind-tag kind-${h.kind}`}>{STOP_KIND_LABELS[h.kind]}</span>
                    </div>
                    <b className="day-highlight-title">{h.day.title ?? `Day ${h.day.index + 1}`}</b>
                    <span className="day-highlight-meta">{h.meta}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="two-col">
          <div>
            {/* ---- Creator ---- */}
            <div className="bezel">
              <div className="card">
                <div className="creator-line">
                  <Avatar user={creator} size="lg" />
                  <div>
                    <b>{creator?.profile.name ?? 'Creator'}</b>{creator?.profile.isCreator && <span className="chip chip-saffron" style={{ marginLeft: 8 }}><InlineIcon icon={Sparkles} size={12} gap={3} />Creator</span>}
                    {creator?.profile.creatorBio && <p className="small muted" style={{ margin: '5px 0 0' }}>{creator.profile.creatorBio}</p>}
                    {isMyPub && (
                      <div className="pub-funnel-glance" role="note" aria-label="How this plan converts, last 7 days">
                        <b className="pub-fg-title">This link, last 7 days</b>
                        <span className="pub-fg-line num">
                          {myReadFailed
                            ? 'Recorded traffic could not be read just now — the creator hub shows the same numbers when it can.'
                            : myReadPending
                            ? 'Reading this link’s traffic…'
                            : myGlance?.glance
                            ? myGlance.glance
                            : 'No recorded traffic for this plan yet.'}
                        </span>
                        {myGlance?.preLog && <span className="pub-fg-prelog muted">{myGlance.preLog}</span>}
                        {/* In-app navigation (onNavigate), not a new appLink anchor —
                            the anchor-count pin in tests/app-link.test.ts exists so
                            new route anchors get reviewed, and this one is internal. */}
                        <button className="btn btn-outline btn-sm" style={{ marginTop: 6, alignSelf: 'flex-start' }} onClick={() => onNavigate('/creator-hub')}>
                          Open the creator hub →
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {creator?.profile.socialLinks && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    {creator.profile.socialLinks.youtube && <a className="chip chip-info" href={creator.profile.socialLinks.youtube} target="_blank" rel="noreferrer" onClick={e => { e.preventDefault(); openExternal(creator.profile.socialLinks!.youtube!) }}>▶ YouTube</a>}
                    {creator.profile.socialLinks.instagram && <a className="chip chip-info" href={creator.profile.socialLinks.instagram} target="_blank" rel="noreferrer" onClick={e => { e.preventDefault(); openExternal(creator.profile.socialLinks!.instagram!) }}><InlineIcon icon={Camera} size={12} gap={3} />Instagram</a>}
                  </div>
                )}
                {creator && (
                  <a className="btn btn-outline btn-sm" style={{ marginTop: 12 }} {...appLink(`/creator/${creator.id}`)}>
                    More from {creator.profile.name} →
                  </a>
                )}
              </div>
            </div>

            {/* ---- Day-by-day (free vs premium) ---- */}
            {trip.days.map(day => {
              const isFree = pub.freeDayIndexes.includes(day.index)
              const sim = simulateDay(day, trip, originOf(trip, day.index), day.index)
              const A = getAssumptions(trip)
              const stops = [...day.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)
              return (
                <div key={day.id} className="day-section" style={{ position: 'relative', overflow: 'hidden' }}>
                  <div className="day-header">
                    <div className="day-badge"><small>Day</small><b>{day.index + 1}</b></div>
                    <div>
                      <h2>{day.title ?? `Day ${day.index + 1}`}</h2>
                      <div className="small muted">
                        {sim.activeStops.length <= 1 && sim.totalDistanceKm < 0.5
                          ? 'Local day — no drive planned'
                          : `${stops.length} stops · ~${minutesToHM(sim.totalTravelMinutes)} travel`}
                      </div>
                    </div>
                    {!isFree && <Chip tone="saffron"><InlineIcon icon={Lock} size={12} gap={3} vAlign="-1px" />Premium</Chip>}
                  </div>

                  {(isFree || unlocked) ? (
                    <DayStops stops={stops} sim={sim} assumptions={A} timeFormat={timeFormat} stayDay={sim.activeStops.length <= 1 && sim.totalDistanceKm < 0.5} mode={trip.transportMode} />
                  ) : (
                    <>
                      <div className="locked-overlay">
                        <div style={{ filter: 'blur(5px)', pointerEvents: 'none', userSelect: 'none' }} aria-hidden="true">
                          {stops.slice(0, 3).map((s, i) => (
                            <div key={s.id} className="stop-card"><div className="stop-num">{i + 1}</div><div className="stop-main"><div className="stop-title">{s.title}</div></div></div>
                          ))}
                        </div>
                        <div className="locked-cta">
                          <b><InlineIcon icon={Lock} size={13} gap={4} />{stops.length} more stops on this day</b>
                          <p className="small">Stay contacts, timings and the budget breakdown are in the full plan.</p>
                          {/* #359 — the price CTA is a CLAIM about what this viewer
                              does not own, so it may only render on a read that
                              actually answered. Over a failed read it would be a
                              price tag on a plan the buyer already paid for. */}
                          {price !== undefined && mayShowPriceCta && <button className="btn btn-saffron" disabled={buying} onClick={unlockThis}>{buying ? 'Opening payments…' : <>Unlock full plan · {formatInr(price)}</>}</button>}
                          {price !== undefined && !mayShowPriceCta && <UnlockCheckState read={entitlementRead} onRetry={retryEntitlements} />}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )
            })}

            {/* ---- Tips & warnings ---- */}
            <div className="two-col two-col--even" style={{ marginTop: 16 }}>
              <div className="bezel">
                <div className="card">
                  <h2>Travel tips</h2>
                  <hr className="divider" />
                  <ul style={{ paddingLeft: 18, lineHeight: 1.9, margin: 0 }}>
                    {pub.travelTips.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </div>
              </div>
              <div className="bezel">
                <div className="card">
                  <h2>Warnings & assumptions</h2>
                  <hr className="divider" />
                  <ul style={{ paddingLeft: 18, lineHeight: 1.9, margin: 0 }}>
                    {pub.warningsAndAssumptions.map((t, i) => <li key={i}><InlineIcon icon={TriangleAlert} size={12} gap={3} />{t}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* ---- Sidebar ---- */}
          <div>
            {/* Sticky lives on the TRAY, not the plate. A sticky element sticks
                within its containing block, so leaving it on the inner card - now
                the tray's only child, and exactly as tall as the tray - would give
                it no room to move. */}
            <div className="bezel" style={{ position: 'sticky', top: 80 }}>
              <div className="card">
                <h2>Take this trip with you</h2>
                <p className="hint-text" style={{ margin: '8px 0 14px' }}>
                  Forks the free preview into your YatraFlow account — locked days come over as placeholders you can fill in yourself.
                </p>
                <button className="btn fork-btn btn-lg" style={{ width: '100%' }} onClick={copyThis}>
                  <InlineIcon icon={GitFork} size={15} gap={5} />{me ? 'Fork this trip' : 'Log in to fork'}
                </button>
                {price !== undefined && !unlocked && mayShowPriceCta && <button className="btn btn-saffron btn-lg" style={{ width: '100%', marginTop: 10 }}
                  disabled={buying} onClick={unlockThis}>
                  <InlineIcon icon={Lock} size={15} gap={5} />{buying ? 'Opening payments…' : <>Unlock full plan · {formatInr(price)}</>}
                </button>}
                {/* #359 — the failed/in-flight read replaces the price button
                    rather than sitting under it. Both placements are covered,
                    because one is in a day card and one in the sticky sidebar:
                    a buyer must not meet "Unlock for ₹499" for their own plan
                    in either. */}
                {price !== undefined && !unlocked && !mayShowPriceCta && <UnlockCheckState read={entitlementRead} onRetry={retryEntitlements} centered />}
                {price !== undefined && unlocked && <p className="hint-text" style={{ textAlign: 'center', marginTop: 10 }}>
                  ✓ Full plan unlocked — forking carries every day as a real, editable plan.
                </p>}
                {/* Which days stay back is read from the publication's own freeDayIndexes
                    rather than assumed to be the tail — a live ₹500 publication kept days
                    9–10 free, so the older sentence contradicted the page. The clause is
                    appended as the module writes it; capitalising belongs to CSS, not here. */}
                {previewSplit && !unlocked && <p className="hint-text" style={{ textAlign: 'center', marginTop: 8 }}>
                  Preview: {previewSplit.claim}.
                </p>}
                {pub.subscriberCta && <p className="hint-text" style={{ textAlign: 'center', marginTop: 8 }}>{pub.subscriberCta}</p>}
                <hr className="divider" />
                <div className="share-link-box"><code>{shareLink}</code><CopyButton text={shareLink} label="Copy page link" /></div>
          <div className="share-link-box">
            <button className="btn btn-outline btn-sm" disabled={sendingWhatsApp}
              onClick={() => void sendOnWhatsApp()}>
              {sendingWhatsApp
                ? <><span className="spinner" aria-hidden /> Opening WhatsApp…</>
                : <><MessageCircle size={14} aria-hidden /> Send on WhatsApp</>}
            </button>
            <span className="hint-text">Opens the app with the link ready to paste</span>
          </div>
                {!me && <p className="hint-text" style={{ marginTop: 10 }}>You’ll need a free account to fork trips.</p>}
              </div>
            </div>
          </div>
        </div>

        {/* ROADMAP I-20: the purchase stops being a toast. Mounted only while a
            just-bought, freshly-read itinerary is in hand, so a returning owner
            never sees "you now own" for a plan they already had. */}
        {revealTrip && (
          <UnlockReveal
            open
            pub={pub}
            trip={revealTrip}
            creator={creator}
            amountPaidInr={pub.premiumPriceInr}
            // The grant itself, for the reveal's share card (I-21) — read from the
            // entitlement list the purchase refreshed, so it arrives with the read
            // that followed the unlock.
            entitlementId={entitlements.find(e => e.pubId === pub.id)?.id}
            onFork={() => { setRevealTrip(null); copyThis() }}
            onClose={() => setRevealTrip(null)}
          />
        )}

        <p className="pub-footer-line">Published with YatraFlow · Plan real trips, together</p>
      </div>
    </div>
  )
}

/** The day's stop list, shared by free days and unlocked (paid/creator)
 *  views — one renderer so an unlocked day shows EXACTLY what a free day
 *  shows, including the travelling strips (departure/arrival, distance,
 *  cost) the first cut of the unlock flow silently dropped. */
function DayStops({ stops, sim, assumptions, timeFormat, stayDay, mode }: {
  stops: ReturnType<typeof simulateDay>['activeStops'] extends never ? never : Array<{
    id: string
    auto?: boolean
    title: string
    locationName: string
    category: string
    openTime?: string
    closeTime?: string
    visitMinutes: number
    entryFeeInrPerPerson: number
    description?: string
  }>
  sim: ReturnType<typeof simulateDay>
  assumptions: ReturnType<typeof getAssumptions>
  timeFormat: '12h' | '24h'
  stayDay: boolean
  /** the trip's transport mode — the travelling strip's glyph follows it. */
  mode: string
}) {
  // #555: the schedule keyed by stop id — sim's legs are INTO legs (legIn of
  // each active stop) and its arrays are per-active-stop, so the strip below
  // reads this row's own facts instead of a neighbour's position.
  const simRows = scheduleRowsById(sim)
  return (
    <>
      {stops.map((s, i) => {
        // Auto anchors are pure travel, not activities — show the
        // drive (times, duration, distance, cost) as a travelling
        // strip instead of an empty stop-card.
        if (s.auto === true) {
          const cleanName = (s.locationName || s.title).replace(/ \((start|end)\)$/, '')
          // Stay day: the journey never leaves this place — a
          // plain base marker, not a travelling strip.
          if (stayDay) {
            return (
              <div key={s.id} className="travel-anchor">
                <div className="travel-anchor-title">
                  <span className="travel-anchor-ico"><MapPin size={13} aria-hidden /></span>
                  <span>Based in {cleanName}</span>
                </div>
              </div>
            )
          }
          // The drive that brought you TO this anchor: its own inbound leg
          // (the old read handed the strip the leg into the row above — one
          // drive stale). Departure is the previous row's clock, arrival this
          // row's — both id-keyed so nothing shifts when a row is skipped.
          const row = simRows.get(s.id)
          const prevRow = i > 0 ? simRows.get(stops[i - 1].id) : null
          const inbound = i > 0 ? row?.legIn ?? null : null
          const dep = inbound ? (prevRow?.depart ?? '--:--') : (row?.depart ?? '--:--')
          const arr = row?.arrive ?? dep
          const cost = inbound ? Math.round(inbound.distanceKm * (assumptions.inrPerKm ?? 8)) : 0
          const depHM = dep !== '--:--' ? formatHM(dep, timeFormat) : dep
          const arrHM = arr !== '--:--' ? formatHM(arr, timeFormat) : arr
          return (
            <div key={s.id} className="travel-anchor">
              <div className="travel-anchor-title">
                <span className="travel-anchor-ico">{i === 0 ? <Flag size={13} aria-hidden /> : modeIcon(mode, 13)}</span>
                <span>{i === 0 ? `Start · ${cleanName}` : `Travelling to ${cleanName}`}</span>
              </div>
              <div className="travel-anchor-meta">
                {inbound ? (
                  <>
                    <span><MetaIcon icon={ Clock } tone="time" />Depart {depHM} → arrive {arrHM}</span>
                    <span><MetaIcon icon={ Clock } tone="time" />{minutesToHM(inbound.durationMinutes)}</span>
                    <span><MetaIcon icon={ MapPin } tone="place" />{inbound.distanceKm.toFixed(0)} km</span>
                    <span><MetaIcon icon={ Car } tone="money" />est {formatInr(cost)} ({assumptions.mode})</span>
                  </>
                ) : (
                  <span>Departure {depHM}</span>
                )}
              </div>
            </div>
          )
        }
        return (
          <div key={s.id} className="stop-card">
            <div className={`stop-num cat-${s.category}`}>{i + 1}</div>
            <div className="stop-main">
              <div className="stop-toprow">
                <span className="stop-title">{s.title}</span>
                <Chip tone="info">{titleCase(s.category)}</Chip>
                {s.openTime && <span className="small muted"><MetaIcon icon={ Clock } tone="time" />{formatHMRange(s.openTime, s.closeTime, timeFormat)}</span>}
              </div>
              <div className="stop-meta">
                <span><MetaIcon icon={ MapPin } tone="place" />{s.locationName}</span>
                <span><MetaIcon icon={ Clock } tone="time" />{minutesToHM(s.visitMinutes)}</span>
                {s.entryFeeInrPerPerson > 0 && <span><MetaIcon icon={ Ticket } tone="ticket" />₹{s.entryFeeInrPerPerson}/person</span>}
              </div>
              {s.description && <div className="stop-desc">{s.description}</div>}
            </div>
          </div>
        )
      })}
    </>
  )
}
