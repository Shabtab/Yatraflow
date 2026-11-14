// ============ Public itinerary page — the trip kit (PW-11a Look inside, PW-11b Ride along) ============
// A shareable travel document, not the private workspace. One cover with the
// buy card, then two views of the same read model: Look inside (the plan in
// counts and day cards) and Ride along (one day at a time, with its clock).
// The views are presentation. Every gate below — who may read a day, which
// price shows, which notice shows — is computed once and handed down.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Camera, Car, Clock, Flag, GitFork, Heart, Link2, Lock, MapPin,
  MessageCircle, Sparkles, Ticket, TriangleAlert,
} from 'lucide-react'
import { InlineIcon, MetaIcon, modeIcon } from '../components/icons'
import { nativeCopyText, openExternal } from '../lib/native'
import type { Trip, PublishedItinerary } from '../data/types'
import type { Entitlement } from '../lib/payments'
import { useDb, currentUser, tripById, userById, registerPubView, fetchPublicTrip } from '../store/store'
import { forkPublication } from '../lib/forkPub'
import { emptyLockedDay, fullPlanRead, hasWireLockedDay, isWireLocked, lockedDayCounts, lockedDayTitle, numberedSummary, planStopCount, readableDayStart, wireLockedSummary } from '../lib/lockedDay'
import { describePreviewSplit } from '../lib/previewSplit'
import { buildJourney, simulateDay, scheduleRowsById, originOf, minutesToHM, formatInr, getAssumptions, computeTotals, isRoundTrip, hmToMinutes } from '../lib/engine'
import { cap, titleCase } from '../lib/labels'
import { useTimeFormat, formatHM, formatHMRange } from '../lib/timefmt'
import { scrollBehavior } from '../lib/motion'
import { useSavedPubs } from '../lib/savedPubs'
import { fetchMyEntitlements, fetchCreatorSales, fetchCreatorFunnel, purchaseUnlock, type FunnelDailyRow } from '../lib/unlock'
import { UnlockReveal } from '../components/UnlockReveal'
import { hasUnlock } from '../lib/payments'
import { buildPubFunnels, describePreLog, funnelGlance, type FunnelSale } from '../lib/pubFunnel'
import { clearShareRefFromLocation, currentPublicShareUrl, shareRefFromSearch, withShareRef } from '../lib/shareUrl'
import { campaignFromSearch, clearCampaignFromLocation, takeForkAttribution } from '../lib/growthAttribution'
import { currentQuery } from '../lib/router'
import { sharePublicationOnWhatsApp } from '../lib/whatsAppShare'
import { appLink } from '../lib/appLink'
import { pageTitle } from '../lib/pageTitle'
import { sizedCoverUrl } from '../lib/tripThumb'
import { Avatar, Chip, EmptyState, toast, CopyButton } from '../components/ui'
import { SegmentedTabs } from '../components/page/SegmentedTabs'
import {
  chooseCover, countKinds, flightSignalFor, foldWeeks, hasAirLeg, kindOfCategory, lockedRunLine, planLede, roadMinutesOf, summariseDayFromLegs, truncatePitch,
  type KindCount,
} from '../lib/publicStorefront'
import { WhatIsInside } from '../components/storefront/WhatIsInside'
import type { DayCardProps } from '../components/storefront/DayCard'
import { StickyPriceBar } from '../components/storefront/StickyPriceBar'
import { TripKitHero, BuyCard, updatedAgo } from '../components/storefront/TripKitHero'
import { DayRibbon, ribbonPlaceOf, type RibbonDay } from '../components/storefront/DayRibbon'
import { DayBudgetBar, type DayBudget } from '../components/storefront/DayBudgetBar'
import { KindTiles } from '../components/storefront/KindTiles'
import { KindChip } from '../components/storefront/KindChip'
import { RideDayPanel, RideOtherRow } from '../components/storefront/RidePanels'
import { SectionTabs, type SectionTab } from '../components/storefront/SectionTabs'
import { RegionArt } from '../components/RegionArt'
import { TripArt } from '../components/trips/TripArt'
import { regionFor } from '../lib/tripsPage'
import { pubArtFamily, pubArtId } from '../lib/pubDayArt'
import { pickMosaicPhotos } from '../lib/rideMosaic'
import { artIdFromCoverUrl } from '../lib/artCover'

/** The words of a day title that may name places: "Jaipur → Jodhpur" gives both. */
function titlePlaces(title: string): string[] {
  return title.split(/→|—|–|&|,|\bto\b|\bvia\b/u).map(s => s.trim()).filter(Boolean)
}
import { RideTimeline, rideNodeLabels } from '../components/storefront/ride/RideTimeline'
import { RideLockedPreview } from '../components/storefront/ride/RideLockedPreview'
import { RideProgress, RideReadMark } from '../components/storefront/ride/RideProgress'
import { freeDaysRead, useRideProgress } from '../lib/rideProgress'
import { RideElevation } from '../components/storefront/ride/RideElevation'
import { ChevronRight, Users } from 'lucide-react'

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
      rather than guess. If you have already paid for it, try again. Nothing is charged twice.
      <button className="btn btn-outline btn-sm hub-note-action" onClick={onRetry}>Retry</button>
    </div>
  )
}

/** #588 — the purchase SUCCEEDED and the access check agrees, but the re-read
 *  that should replace the pre-purchase stub with the real days came back
 *  empty. The pages stay locked (placeholder copy must never render as the
 *  plan the buyer owns) and this panel says what actually happened. */
function PurchaseLoadState({ onRetry, retrying, centered }: {
  onRetry: () => void
  retrying: boolean
  centered?: boolean
}) {
  return (
    <div className="hub-note is-failure" role="alert" style={{ marginTop: 8, textAlign: centered ? 'center' : undefined }}>
      <b>Your purchase went through.</b> The full plan could not load just now, so the pages stay
      locked rather than show placeholder text. Nothing was charged twice.
      <button className="btn btn-outline btn-sm hub-note-action" disabled={retrying} onClick={onRetry}>
        {retrying ? 'Loading…' : 'Retry'}
      </button>
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
  // #552 — the arrival ref is read ONCE, here at first render, and then taken
  // back out of the address bar (the effect below): with hash navigation
  // nothing else ever clears the query, and a sticky `ref` handed every later
  // view and fork in the tab to whatever link the tab first touched. The one
  // value serves this page instance's three uses — the view registration, the
  // re-share's second hop and the fork stamp; they are one arrival. A later
  // page reads a clean query and records "direct", which is the honest answer.
  const [arrival] = useState(() => {
    const query = currentQuery().toString()
    // Public context must survive while the account profile is still loading.
    const pending = takeForkAttribution(slug, false)
    return {
      source: shareRefFromSearch(query) ?? pending?.source ?? null,
      campaign: campaignFromSearch(query) ?? pending?.campaign ?? null,
    }
  })
  const arrivalRef = arrival.source
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
  // #588 — the post-purchase trip re-read failed: `fetchPublicTrip` answers
  // null on a dropped connection, and null must not read as "nothing to do".
  // Keyed by publication id like the entitlement read marker, so a second
  // publication on the same mounted page cannot inherit the flag.
  const [tripReReadFailedFor, setTripReReadFailedFor] = useState<string | null>(null)
  const [postPurchaseRetrying, setPostPurchaseRetrying] = useState(false)
  // F3 (#227) — the WhatsApp send in flight, held so a double-tap cannot
  // fire two sheets or open two chat tabs. The §6a guard on an async path:
  // disabled while it runs, and the button says so.
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false)
  // The itinerary the unlock moment is showing, held separately from `fetched`:
  // it is only ever the copy the server served AFTER the entitlement existed
  // (see unlockThis), and it doubles as the reveal's open/closed state.
  const [revealTrip, setRevealTrip] = useState<Trip | null>(null)
  // The sticky price bar shows once the first screen has scrolled away. The
  // hero is held in state (a callback ref) because it only mounts after the
  // trip has loaded, and the observer below must wait for it.
  const [heroEl, setHeroEl] = useState<HTMLElement | null>(null)
  const [priceVisibility, setPriceVisibility] = useState<{
    hero: HTMLElement
    view: 'inside' | 'ride'
    coverGone: boolean
    cardVisible: boolean
  } | null>(null)
  // The two views of one read model. `rideDay` is the day index on screen in
  // Ride along; null until the viewer picks one, which then means the first
  // day they may read. Neither value grants anything: the cards and the panel
  // are built from the same `unlocked` flag as before.
  const [view, setView] = useState<'inside' | 'ride'>('inside')
  const [rideDay, setRideDay] = useState<number | null>(null)
  // Free days this visitor opened in Ride along. `slug` is the publication id.
  const readDays = useRideProgress(slug)
  const panelEl = useRef<HTMLDivElement>(null)
  const [now] = useState(() => Date.now())
  // Keep one persistent price action. Each view observes its own in-page cards.
  useEffect(() => {
    if (!heroEl || typeof IntersectionObserver === 'undefined') return
    // Watch the price and the buttons that carry it, not the whole card. A card
    // can be on screen while its price sits below the fold.
    const cards = [...(heroEl.parentElement?.querySelectorAll('.pi-buy-price, .pi-buy-actions, .pi-take-actions') ?? [])]
    const visible = new Map<Element, boolean>([heroEl, ...cards].map(el => [el, true]))
    const io = new IntersectionObserver(entries => {
      if (!heroEl.isConnected) return
      for (const entry of entries) visible.set(entry.target, entry.isIntersecting)
      setPriceVisibility({
        hero: heroEl,
        view,
        coverGone: !visible.get(heroEl),
        cardVisible: cards.some(el => el.isConnected && visible.get(el)),
      })
    })
    for (const el of visible.keys()) io.observe(el)
    return () => io.disconnect()
  }, [heroEl, view])
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
  const viewedPubId = pub?.id
  useEffect(() => {
    // #230 — the view carries its route in: the `ref` the shared link brought
    // (consumed once at first render, #552), or null for a visitor who arrived
    // some other way — which is recorded as "direct".
    if (viewedPubId) registerPubView(viewedPubId, arrivalRef, arrival.campaign)
  }, [viewedPubId, arrivalRef, arrival.campaign])
  // #552 — the query's work is done once the arrival is read. Only a ref the
  // vocabulary knows is removed; everything else in the query stays.
  useEffect(() => { clearShareRefFromLocation(); clearCampaignFromLocation() }, [])
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
    // #587 — the signal is HANDED to the read: the timeout was aborting a
    // controller no request listened to, so a hung connection never settled
    // the promise and the page sat on "Checking your access…" forever.
    void fetchMyEntitlements(meId, { signal: ac.signal })
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

  // True when this viewer may read the locked days: the creator, or a buyer
  // with a paid entitlement. Gating here is presentation; the fork path and
  // RLS re-derive the same rule server-side. Computed ABOVE the render gates
  // because the soft-unpublish branch below needs exactly this question
  // answered: who may still open a publication that has come down. (Empty
  // strings while the row is missing — hasUnlock can match neither a creator id
  // nor an entitlement against those, so "no publication" reads as not
  // unlocked, which is what the loading/error branches below then say.)
  // #588 — while the post-purchase re-read is stuck, the page still holds the
  // PRE-purchase stub. Ungating the lock would lift the overlays over
  // placeholder copy, so the access stays visually locked until the real days
  // arrive (the retry panel says what is happening).
  const tripReReadFailed = !!pub && tripReReadFailedFor === pub.id
  const unlocked = tripReReadFailed ? false : hasUnlock(entitlements, meId, pub?.id ?? '', pub?.creatorId ?? '')
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
  /** A logged-out visitor has nothing to check, so the CTA is honest for them.
   *  #588 — a stuck post-purchase re-read silences it too: the buyer owns the
   *  plan, so a price tag over the locked pages would be the exact
   *  contradiction the gate exists to prevent. */
  const mayShowPriceCta = (!meId || entitlementRead === 'ready') && !tripReReadFailed
  // #359 — asking again is a NEW question, so it takes a new attempt number; the
  // derived `entitlementsReading` flips true on its own and the button's own
  // label says "Checking…" rather than re-rendering the alert it was pressed
  // against (a dead button, per the hub's retry rule).
  const retryEntitlements = useCallback(() => { setEntitlementsRetry(n => n + 1) }, [])

  // #588 — the two re-reads are two halves of one question (what did I just
  // buy), so one Retry asks both. The entitlement half reuses the same state
  // the gate derives from; the trip half clears the stuck flag only on a real
  // trip, never on another null. (Placed above the early returns with the
  // other hooks — a hook below a return crashes the page on a full reload.)
  const retryPostPurchaseReads = useCallback(() => {
    const id = pub?.id
    if (!id || !meId || postPurchaseRetrying) return
    setPostPurchaseRetrying(true)
    void fetchMyEntitlements(meId)
      .then(rows => { setEntitlements(rows); setEntitlementsError(false); setEntitlementsReadFor(id) })
      .catch(() => { setEntitlementsError(true); setEntitlementsReadFor(null) })
    void fetchPublicTrip(id).then(fresh => {
      if (fresh) {
        setFetched(fresh)
        setTripReReadFailedFor(null)
      }
    }).finally(() => setPostPurchaseRetrying(false))
  }, [pub?.id, meId, postPurchaseRetrying])

  // #774 — the viewer may read the plan and the page still holds locked days.
  // That happens when the first read ran before the session was known. The
  // loading line on a locked day is true only while a read is in flight, so
  // `ask` starts one here. The read ends in the full plan or in `failed`.
  // (Above the early returns with the other hooks, the #310 rule.)
  const [fullPlanFailedFor, setFullPlanFailedFor] = useState<string | null>(null)
  const pubId = pub?.id ?? null
  const fullPlan = fullPlanRead({
    mayRead: unlocked,
    holdsLockedCopy: !!trip && hasWireLockedDay(trip.days),
    firstReadSettled: fetched !== null || miss,
    purchaseInFlight: buying,
    failed: pubId !== null && fullPlanFailedFor === pubId,
  })
  useEffect(() => {
    if (fullPlan !== 'ask' || pubId === null) return
    let alive = true
    void fetchPublicTrip(pubId).then(fresh => {
      if (!alive) return
      // Locked days again, or no row: the full plan did not arrive.
      if (fresh && !hasWireLockedDay(fresh.days)) setFetched(fresh)
      else setFullPlanFailedFor(pubId)
    })
    return () => { alive = false }
  }, [fullPlan, pubId])

  // ---- "What is inside": the storefront view of the days. Presentation only.
  // The page's own `unlocked` flag and the publication's freeDayIndexes pick the
  // state of each card; nothing here asks a new entitlement question.
  // Locked cards use day numbers and category counts only.
  // The locked run line uses category counts alone.
  // Never pass a stop title, location name or coordinate into a locked card or line.
  const storefront = useMemo(() => {
    if (!pub || !trip) return null
    const free = new Set(pub.freeDayIndexes)
    const flightDays = new Set((trip.flights ?? []).map(f => f.dayIndex))
    const allCats: Array<{ category: string }> = []
    const lockedRuns: Array<{ first: number; last: number; cats: Array<{ category: string }> }> = []
    const cards: DayCardProps[] = orderedDays.map(day => {
      // Auto anchors are start, end and night markers. They are not places, so
      // the counts and the place lists both leave them out and always agree.
      const live = day.stops.filter(s => s.status !== 'rejected' && s.auto !== true)
      // Null means the server sent this day in full. A day the server locked
      // stays locked here, whatever this page believes about the viewer.
      const wire = lockedDayCounts(day)
      const isLocked = wire !== null || (!free.has(day.index) && !unlocked)
      // A locked card never says "Flight day": `flightSignalFor` withholds the
      // flight, and a withheld flight drops the pace word rather than reading as
      // an empty day.
      // The card says "on the road", so it gets the ground legs only. The
      // engine's total also counts the air sector, and a flight is not a
      // drive. The minutes come from the engine's own legs.
      // A readable card also has to know that the day flies. The traveller may
      // not have entered the flight yet, and the engine plans an estimated air
      // leg for a flight trip anyway. So the signal is the stored flight rows
      // OR the air leg the engine actually planned for this day. It still goes
      // through `flightSignalFor`, so a locked card discloses no flight.
      const sim = isLocked ? null : simulateDay(day, trip, readableDayStart(trip.days, day) ?? originOf(trip, day.index), day.index)
      const hasFlight = flightDays.has(day.index) || hasAirLeg(sim?.legs ?? [])
      const readSummary = summariseDayFromLegs({ ...day, stops: live }, sim?.legs ?? [], flightSignalFor(hasFlight, isLocked))
      // A locked card is named by its day number. A day the server locked is
      // built from the server's counts alone.
      const summary = wire ? wireLockedSummary(day, wire) : isLocked ? { ...numberedSummary(readSummary), pace: null, travelMinutes: 0, hasFlight: false } : readSummary
      const cats: Array<{ category: string }> = wire ? wire.categories : live.map(s => ({ category: s.category }))
      allCats.push(...cats)
      if (isLocked) {
        const run = lockedRuns[lockedRuns.length - 1]
        if (run && run.last === day.index - 1) { run.last = day.index; run.cats.push(...cats) }
        else lockedRuns.push({ first: day.index, last: day.index, cats: [...cats] })
        return { state: 'locked', summary }
      }
      const places = live
        .sort((a, b) => a.orderInDay - b.orderInDay)
        .map(s => ({ title: s.title, kind: kindOfCategory(s.category) }))
        .filter(p => p.kind !== 'stay' && p.kind !== 'travel')
      return { state: free.has(day.index) ? 'free' : 'yours', summary, places }
    })
    const kinds: KindCount[] = countKinds(allCats)
    // A plan with no days has no lede: "A 0-day plan" describes nothing. The
    // section that would hold it is skipped for the same reason.
    const lede = planLede(orderedDays.length, kinds)
    // The buy promise is made only where a purchase is on offer right now.
    const canBuy = !!pub.premiumPriceInr && mayShowPriceCta
    const closing = canBuy ? undefined : 'Their names stay hidden on this page.'
    const lockedLine = lockedRuns
      .map(r => lockedRunLine(r.first + 1, r.last + 1, countKinds(r.cats), closing))
      .filter(Boolean)
      .join(' ')
    const coverBase = { routeSummary: pub.routeSummary, durationDays: pub.durationDays }
    const cover = chooseCover(
      { ...coverBase, coverImageUrl: pub.coverImageUrl ? sizedCoverUrl(pub.coverImageUrl) : undefined },
      kinds,
      cap(trip.transportMode),
    )
    // The ticket the plate shows if the photo fails to load.
    const coverFallback = chooseCover({ ...coverBase, coverImageUrl: undefined }, kinds, cap(trip.transportMode))
    return { cards, kinds, lede, lockedLine, weeks: foldWeeks(cards.length, 14), cover, coverFallback: coverFallback.kind === 'ticket' ? coverFallback : undefined, allFree: orderedDays.every(d => free.has(d.index)) }
  }, [pub, trip, orderedDays, unlocked, mayShowPriceCta])

  // ---- Per-day facts for the trip-kit views. A second memo, so the storefront
  // memo above keeps the dependencies it is tested with. A day this viewer may
  // not read yields no distance, budget, photo, name or clock.
  const dayFacts = useMemo(() => {
    if (!pub || !trip) return []
    const free = new Set(pub.freeDayIndexes)
    const A = getAssumptions(trip)
    return orderedDays.map(day => {
      const readable = !isWireLocked(day) && (free.has(day.index) || unlocked)
      if (!readable) return { km: 0, budget: undefined, readable, photo: undefined, names: [] as string[], startsAt: undefined, endsAt: undefined }
      const sim = simulateDay(day, trip, readableDayStart(trip.days, day) ?? originOf(trip, day.index), day.index)
      const window = Math.max(1, hmToMinutes(A.dayEnd) - hmToMinutes(sim.startsAt))
      const budget: DayBudget = {
        drive: Math.round(roadMinutesOf(sim.legs)),
        places: Math.round(sim.dwellMinutes),
        window,
      }
      const km = sim.totalDistanceKm
      const names = day.stops
        .filter(s => s.status !== 'rejected' && s.auto !== true)
        .sort((a, b) => a.orderInDay - b.orderInDay)
        .filter(s => { const k = kindOfCategory(s.category); return k !== 'stay' && k !== 'travel' })
        .map(s => s.title)
      return {
        km, budget: { ...budget, from: formatHM(sim.startsAt, timeFormat), to: formatHM(A.dayEnd, timeFormat) }, readable,
        photo: day.coverImageUrl ? sizedCoverUrl(day.coverImageUrl) : undefined,
        names,
        startsAt: formatHM(sim.startsAt, timeFormat),
        endsAt: formatHM(sim.endsAt, timeFormat),
      }
    })
  }, [pub, trip, orderedDays, unlocked, timeFormat])

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
        <div className="container page-enter">
          <div className="container loading-block"><div className="spinner" />Loading itinerary…</div>
        </div>
      )
    }
    return (
      <div className="container page-enter">
        <EmptyState icon={<TriangleAlert size={38} aria-hidden />} title="This itinerary is no longer published"
          body="The creator took it off Explore, so it is no longer on sale. If you unlocked it, sign in with the account that bought it and the full plan is still yours. Otherwise browse what’s published now."
          action={<button className="btn btn-primary" onClick={() => onNavigate('/explore')}>Back to Explore</button>} />
      </div>
    )
  }

  if (!pub || !trip) {
    return (
      <div className="container page-enter">
        {pub && !miss
          ? <div className="container loading-block"><div className="spinner" />Loading itinerary…</div>
          : /* The fetch returns null for a missing row AND for a failed select, so
               this copy must not pick one cause: it names the real possibilities
               and says plainly that the page cannot tell them apart. */
            <EmptyState icon={<Link2 size={38} aria-hidden />} title="This itinerary didn’t load"
              body="Unpublished, mistyped, or a dropped connection. We can’t tell which from here. Ask whoever shared it for a fresh link, or browse what’s published now."
              action={<button className="btn btn-primary" onClick={() => onNavigate('/explore')}>Back to Explore</button>} />}
      </div>
    )
  }
  // Past the gate every memo is fully computed — narrowed aliases keep the
  // rest of the body honest without re-checking `trip` everywhere.
  const totalsN = totals!
  // #774 — a viewer with locked days holds the free days only. A road total
  // from them would be a figure for part of the plan, so the page shows none.
  // The stop count stays: the server counts the stops of each locked day.
  const hasLockedDays = hasWireLockedDay(trip.days) || orderedDays.some(day => !pub.freeDayIndexes.includes(day.index) && !unlocked)
  const stopsInPlan = hasLockedDays ? planStopCount(trip.days) : totalsN.stopCount

  const creator = userById(pub.creatorId)
  // The stored cover is not necessarily sized: a row written before the sizing
  // fix holds the raw Wikimedia upload (a live publication shipped 1,305 KB as
  // its hero). Sized at render, so existing rows are fixed without a backfill.
  // #360 — a row with NO stored cover renders the branded background, and that
  // is the point rather than a gap: it is what `api/i.js` already serves such
  // a row as its card, so the two agree. `undefined` rather than a suggestion.
  const heroSrc = pub.coverImageUrl && !artIdFromCoverUrl(pub.coverImageUrl) ? sizedCoverUrl(pub.coverImageUrl) : undefined
  // #230 — what leaves through the copy button names the button it left
  // through. Display and copy are the same string: the code box shows exactly
  // what lands on the clipboard.
  const shareLink = withShareRef(currentPublicShareUrl(pub.id), 'copy')
  // F7 (#228): the channel this visitor arrived through — consumed once at
  // first render (#552). A second hop inside the same community keeps the
  // post's reference — a link that travelled through a community post does not
  // forget where it came from — while a fresh arrival stamps the send unit's
  // own channel. It rides the link, never the sentence. Vocabulary-checked:
  // only a ShareSource survives the read, so an unknown ref falls back to the
  // default rather than travelling onward.
  async function sendOnWhatsApp() {
    if (sendingWhatsApp || !pub) return
    setSendingWhatsApp(true)
    try { await sharePublicationOnWhatsApp(pub, arrivalRef ?? 'wa') } finally { setSendingWhatsApp(false) }
  }
  // Undefined when the creator published the itinerary as entirely free —
  // the Unlock buttons below are hidden rather than inventing a ₹199 fallback.
  // Undefined when the creator published the itinerary as entirely free —
  // the Unlock buttons below are hidden rather than inventing a ₹199 fallback.
  // #592 — zero reads as free too: a ₹0 row that slipped past the writer must
  // render as a free plan, not as an unchargeable ₹0 CTA whose every click
  // answers with the checkout's "this itinerary is free" refusal.
  const price = pub.premiumPriceInr || undefined
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
    void forkPublication(pub!, me?.id ?? null, onNavigate, unlocked, arrivalRef, arrival.campaign)
  }

  function unlockThis() {
    if (buying) return // async purchase — no double modal (the #36-6 rule)
    setBuying(true)
    void purchaseUnlock({
      pubId: pub!.id,
      title: pub!.title,
      onUnlocked: () => {
        // #359 — this read REJECTS now, so a failure here must not be a
        // rejection nobody catches. #588 — and the catch must not stop at the
        // error flag: the derive keeps 'ready' while the read marker stands,
        // and that marker now proves NOT-owning (the pre-purchase read).
        // Clearing it drops the gate to 'failed', whose Retry re-asks.
        // #359's keep-proven-access rule is about a failed refresh behind
        // access already proven — this read was asking for NEW access.
        void fetchMyEntitlements(meId)
          .then(rows => { setEntitlements(rows); setEntitlementsError(false) })
          .catch(() => { setEntitlementsError(true); setEntitlementsReadFor(null) })
      },
    }).then(async outcome => {
      // Both a completed purchase and a 409 mean the days are readable now (the
      // 409 path can have just self-healed the grant), but only a purchase
      // earns the ceremony.
      if (outcome !== 'unlocked' && outcome !== 'already') return
      // This page holds the copy the server served BEFORE the purchase, and
      // that copy has locked days: each one is a day number and two counts,
      // with no stop (#774). Rendering it with the lock lifted would show
      // empty days. Re-read through the same RPC — the entitlement now
      // exists, so it answers with real days — rather than clearing `fetched`,
      // which would flash the loading state mid-ceremony.
      // #588 — null here is a dropped connection, not a missing row (the
      // purchase just succeeded, so the row exists). `if (fresh)` alone would
      // silently keep the stub and, with the entitlement re-read succeeded,
      // lift the lock over placeholder copy. The flag routes the page to the
      // post-purchase retry panel instead.
      const fresh = await fetchPublicTrip(pub!.id)
      if (fresh) {
        setFetched(fresh)
        setTripReReadFailedFor(null)
        // The reveal opens only on a real trip: its numbers ARE the point, and
        // stats read from the stubbed copy would describe an empty plan.
        if (outcome === 'unlocked') setRevealTrip(fresh)
      } else {
        setTripReReadFailedFor(pub!.id)
      }
    }).finally(() => setBuying(false))
  }

  function saveThis() {
    const nowSaved = toggleSaved(pub!.id)
    toast(nowSaved ? 'Saved to this browser.' : 'Removed from saved itineraries.')
  }

  // (totals/highlights are computed by the guarded hooks above the
  //  gate — totalsN/highlightsN.)

  // ---- First-screen buy card + sticky bar state. Every condition below is the
  // SAME one the locked days and the take-this-trip card use (price, unlocked,
  // mayShowPriceCta); the cover adds a placement, not a rule.
  const pitch = pub.subscriberCta ? truncatePitch(pub.subscriberCta, 140) : ''
  const showUnlockCta = price !== undefined && !unlocked && mayShowPriceCta
  const stickyMode: 'unlock' | 'fork' | null = showUnlockCta ? 'unlock' : (price === undefined || unlocked) ? 'fork' : null
  const heroShowsPitch = showUnlockCta || price === undefined || unlocked
  const forkLabel = me ? 'Fork to my trips' : 'Log in to fork'
  /** A priced plan the viewer does not own, while the access read has no answer. */
  const gateNotice = price !== undefined && !unlocked && !mayShowPriceCta
  const purchaseLoadNotice = <PurchaseLoadState onRetry={retryPostPurchaseReads} retrying={postPurchaseRetrying} />

  // ---- Trip-kit view state: plain derivations over the memos above. Nothing
  // here asks an entitlement question; the cards already carry the answer.
  const cards = storefront?.cards ?? []
  const openCount = cards.filter(c => c.state !== 'locked').length
  const firstOpenPos = cards.findIndex(c => c.state !== 'locked')
  const ridePos = (() => {
    const at = rideDay === null ? -1 : cards.findIndex(c => c.summary.index === rideDay)
    return at >= 0 ? at : Math.max(0, firstOpenPos)
  })()
  const placeTotal = storefront ? storefront.kinds.reduce((n, k) => n + k.count, 0) : 0
  const creatorLinkProps = creator ? appLink(`/creator/${creator.id}`) : undefined
  const plans = db.published.filter(x => x.creatorId === pub.creatorId && !x.unpublishedAt).length
  const updated = updatedAgo(pub.refreshedAt ?? pub.publishedAt, now)

  function changeView(next: 'inside' | 'ride') {
    setView(next)
    requestAnimationFrame(() => {
      panelEl.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
    })
  }

  function openDay(index: number) {
    setRideDay(index)
    setView('ride')
    requestAnimationFrame(() => {
      panelEl.current?.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus({ preventScroll: true })
      panelEl.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
    })
  }

  const rideIndex = cards[ridePos]?.summary.index ?? null
  const freeRead = freeDaysRead(readDays, pub.freeDayIndexes)
  const freeTotal = pub.freeDayIndexes.length
  const ribbonDays: RibbonDay[] = cards.map(c => {
    const i = c.summary.index
    const status = view !== 'ride' || c.state === 'locked' ? undefined
      : i === rideIndex ? 'now' as const
      : readDays.has(i) ? 'read' as const
      : undefined
    return { index: i, title: c.summary.title, state: c.state, placeCount: c.summary.placeCount, status, place: ribbonPlaceOf({ title: c.summary.title, state: c.state }, undefined) }
  })
  // Most plans have no photos. Every image slot then shows a generated scene
  // for its own places, so no slot is an empty box. Locked days use public
  // plan places only. Their titles never select a scene.
  const planPlaces = [trip.startLocation, ...trip.destinations]
  const artRegion = regionFor(trip)
  const artFor = (seed: string, slotPlaces: string[], sizes: string, eager = false, sceneId?: string) => (
    <RegionArt
      id={sceneId ?? pubArtId({ seed: `${pub.id}:${seed}`, slotPlaces, planPlaces })}
      ratio="16:10"
      sizes={sizes}
      eager={eager}
      fallback={<TripArt region={artRegion} />}
    />
  )
  const dayArt = (c: (typeof cards)[number]) =>
    artFor(`day:${c.summary.index}`, c.state === 'locked' ? [] : titlePlaces(c.summary.title), '(max-width: 720px) 100vw, 240px')
  // The ten-days grid. A readable day gets its photo (or its scene), its places
  // and an open button; a locked day gets its scene under a lock, and counts.
  const dayCards: DayCardProps[] = cards.map((c, i) => {
    const f = dayFacts[i]
    return c.state === 'locked'
      ? { ...c, art: dayArt(c), lockedWord: price !== undefined ? 'Paid plan' : 'Preview only', lockedNote: showUnlockCta ? 'Names, times and notes open when you buy' : 'Names, times and notes stay hidden on this page' }
      : { ...c, photo: f?.photo, art: f?.photo ? undefined : dayArt(c), budget: f?.budget, onOpen: () => openDay(c.summary.index) }
  })

  // Ride along mosaic. The first readable days, each with a different picture:
  // a shared first scene steps to the next day, then to another scene of its
  // family. A tile crops a 16:10 scene to about 400 px high, so it asks for a
  // cover-size file.
  const mosaicPhotos = pickMosaicPhotos(dayFacts.flatMap((f, i) => f.readable
    ? [{
        index: cards[i].summary.index,
        title: cards[i].summary.title,
        photo: f.photo,
        family: pubArtFamily({ seed: `${pub.id}:day:${cards[i].summary.index}`, slotPlaces: titlePlaces(cards[i].summary.title), planPlaces }),
      }]
    : []))

  const kmOf = (km: number) => `${Math.round(km).toLocaleString('en-IN')} km`
  const driveOf = (min: number) => (min < 5 ? 'no drive' : `${minutesToHM(min)} driving`)

  // ---- Ride along: the day on screen. A readable day carries its timeline,
  // built from the same simulated schedule the old stop list read; a locked
  // day carries counts and the way to buy, never a name.
  const rideCard = cards[ridePos]
  const rideFacts = dayFacts[ridePos]
  const rideDayRow = orderedDays[ridePos]
  const rideArt = (index: number, slotPlaces?: readonly string[]) => ({
    publicationId: pub.id, index, planPlaces: trip.destinations, slotPlaces,
  })
  const paidPreviewPos = rideCard?.state === 'locked' ? -1 : cards.findIndex((card, pos) => pos > ridePos && card.state === 'locked')
  const paidPreview = cards[paidPreviewPos]
  let paidRunEnd = paidPreviewPos
  while (cards[paidRunEnd + 1]?.state === 'locked') paidRunEnd += 1
  const paidRunLabel = paidPreview ? (paidRunEnd === paidPreviewPos
    ? `day ${paidPreview.summary.index + 1}`
    : `days ${paidPreview.summary.index + 1} to ${cards[paidRunEnd].summary.index + 1}`) : ''
  let ridePanel: ReactNode = null
  if (rideCard && rideFacts && rideDayRow) {
    const sum = rideCard.summary
    const placesText = `${sum.placeCount} ${sum.placeCount === 1 ? 'place' : 'places'}`
    const stay = sum.travelMinutes < 5 && rideFacts.km < 0.5
    const meta = [
      placesText,
      ...(rideCard.state === 'locked' ? [] : stay ? ['local day, no drive planned'] : [kmOf(rideFacts.km), driveOf(sum.travelMinutes)]),
      ...(rideCard.state !== 'locked' && rideFacts.startsAt && rideFacts.endsAt ? [`${rideFacts.startsAt} → ${rideFacts.endsAt}`] : []),
    ].join(' · ')
    let body: ReactNode
    let footer: ReactNode
    if (rideCard.state === 'locked') {
      body = (
        <div className="pi-lock">
          <div className="pi-lock-chips">{sum.kinds.map(k => <KindChip key={k.kind} kind={k.kind} count={k.count} />)}</div>
          <p className="pi-lock-title"><InlineIcon icon={Lock} size={13} gap={4} />{lockedDayCounts(rideDayRow)?.stopCount === null ? 'This day is locked' : `${lockedDayCounts(rideDayRow)?.stopCount ?? sum.placeCount} more stops on this day`}</p>
          <p className="small">Stay contacts, timings and the budget breakdown are in the full plan.</p>
        </div>
      )
      // #359 — the price CTA is a CLAIM about what this viewer does not own, so
      // it renders only on a read that actually answered.
      const awaitingFullPlan = unlocked && isWireLocked(rideDayRow)
      footer = awaitingFullPlan ? (
        <p className="small" role="status">{fullPlan === 'failed' ? 'The full plan did not load. Reload the page to try again.' : 'Loading the full plan…'}</p>
      ) : showUnlockCta ? (
        <>
          <button className="btn btn-saffron" disabled={buying} onClick={unlockThis}>{buying ? 'Opening payments…' : <>Unlock full plan · {formatInr(price)}</>}</button>
          <p className="hint-text">One-time payment. No subscription.</p>
        </>
      ) : gateNotice ? (
        tripReReadFailed
          ? <p className="small muted">Your purchase went through. The full plan could not load. Use Retry in the box at the top of the page.</p>
          : <UnlockCheckState read={entitlementRead} onRetry={retryEntitlements} />
      ) : undefined
    } else {
      const readableTrip = { ...trip, days: trip.days.map(day => cards.some(c => c.summary.index === day.index && c.state === 'locked') ? emptyLockedDay(day) : day) }
      const start = readableDayStart(trip.days, rideDayRow) ?? originOf(readableTrip, rideDayRow.index)
      const sim = simulateDay(rideDayRow, readableTrip, start, rideDayRow.index)
      const stops = [...rideDayRow.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)
      const journey = buildJourney(readableTrip, rideDayRow, undefined, start)
      // The engine names a neighbour place and skips days with no stops, so this
      // walks the same way. Outside the trip is the public origin or end.
      const lockedDay = (i: number) => cards.some(c => c.summary.index === i && c.state === 'locked')
      const hasStops = (i: number) => trip.days.some(d => d.index === i && d.stops.some(s => s.status !== 'rejected'))
      const lockedReach = (from: number, step: 1 | -1) => {
        for (let i = from; i >= 0 && i < trip.days.length; i += step) {
          if (lockedDay(i)) return true
          if (hasStops(i)) return false
        }
        return false
      }
      const lockedNames = trip.days.filter(d => lockedDay(d.index))
        .flatMap(d => [...titlePlaces(d.title ?? ''), ...d.stops.flatMap(s => [s.title, s.locationName ?? ''])])
      const labels = rideNodeLabels(journey, {
        dayNumber: rideDayRow.index + 1,
        ownStopIds: new Set(stops.filter(s => !s.auto).map(s => s.id)),
        prevLocked: lockedReach(rideDayRow.index - 1, -1),
        nextLocked: lockedReach(rideDayRow.index + 1, 1),
        lockedNames,
      })
      body = <RideTimeline journey={journey} labels={labels} creator={creator} timeFormat={timeFormat}>
        <DayStops stops={stops} sim={sim} assumptions={getAssumptions(trip)} timeFormat={timeFormat} stayDay={sim.activeStops.length <= 1 && sim.totalDistanceKm < 0.5} mode={trip.transportMode} />
      </RideTimeline>
    }
    ridePanel = (
      <RideDayPanel
        key={sum.index}
        {...rideArt(sum.index, rideFacts.names)}
        state={rideCard.state}
        photo={rideCard.state === 'locked' ? undefined : rideFacts.photo}
        badge={<div className="pi-badge"><small>Day</small><b>{sum.index + 1}</b></div>}
        title={rideCard.state === 'locked' ? lockedDayTitle(sum.index) : sum.title}
        pace={sum.pace?.label}
        meta={meta}
        placeCount={sum.placeCount}
        budget={rideFacts.budget ? <DayBudgetBar budget={rideFacts.budget} label={`Day ${sum.index + 1}`} legend /> : null}
        footer={footer}
      >{body}</RideDayPanel>
    )
  }

  const kitTabs = (
    <SegmentedTabs
      semantics="tablist"
      label="Plan views"
      value={view}
      onChange={k => changeView(k === 'ride' ? 'ride' : 'inside')}
      items={[
        { key: 'inside', label: 'Look inside', id: 'pi-tab-inside', controls: 'pi-panel-inside' },
        { key: 'ride', label: 'Ride along', id: 'pi-tab-ride', controls: 'pi-panel-ride' },
      ]}
    />
  )
  // The mockup's section links: Overview, What's inside, the days, the creator.
  // Look inside only; Ride along is one day at a time and has no such parts.
  const hasDays = !!storefront && storefront.cards.length > 0
  const sectionTabs: SectionTab[] = view === 'inside' ? [
    { id: 'pi-sec-overview', label: 'Overview' },
    ...(hasDays ? [
      { id: 'pi-sec-inside', label: 'What’s inside' },
      { id: 'pi-sec-days', label: `The ${cards.length} ${cards.length === 1 ? 'day' : 'days'}` },
    ] : []),
    { id: 'pi-sec-creator', label: 'The creator' },
  ] : []
  const showStickyPrice = heroEl !== null && heroEl.isConnected
    && priceVisibility?.hero === heroEl && priceVisibility.view === view
    && priceVisibility.coverGone && !priceVisibility.cardVisible

  const heroFacts = [
    previewSplit && price !== undefined && !unlocked ? `${pub.durationDays} days · ${previewSplit.freeCount} free to read` : `${pub.durationDays} days`,
    !hasLockedDays && totalsN.totalDistanceKm >= 1 ? `${kmOf(totalsN.totalDistanceKm)} by ${trip.transportMode === 'car' ? 'road' : trip.transportMode}` : '',
    pub.bestSeason ? `Best ${pub.bestSeason}` : '',
    stopsInPlan !== null && stopsInPlan > 0 ? `${stopsInPlan} stops` : '',
  ].filter(Boolean)

  const creatorName = creator?.profile.name ?? 'a YatraFlow traveller'
  const byline = (
    <a className="pi-creator-pill" {...creatorLinkProps}>
      <Avatar user={creator} />
      <span>Planned by <b>{creatorName}</b>{plans > 0 ? ` · ${plans} ${plans === 1 ? 'plan' : 'plans'}` : ''}{updated ? ` · ${updated}` : ''}</span>
    </a>
  )

  return (
    <div className="page-enter pi-page">
      <div className="container pi-wrap">
        <div className="pi-navigation" role="region" aria-label="Itinerary navigation">
          {kitTabs}
          {view === 'inside'
            ? <SectionTabs tabs={sectionTabs} label="Parts of this plan" />
            : <div className="pi-navigation-ride">
                {rideIndex !== null && <span className="pi-muted">Day {rideIndex + 1} of {cards.length}</span>}
                <button type="button" className="pi-section-tab" onClick={() => changeView('inside')}>Back to overview</button>
              </div>}
        </div>
        <TripKitHero
          onCover={setHeroEl}
          photo={heroSrc
            ? <img className="pub-hero-photo pi-hero-photo" src={heroSrc} alt="" aria-hidden="true" width={1600} height={900} loading="eager" decoding="async" onError={(e) => { e.currentTarget.hidden = true }} />
            : null}
          art={heroSrc ? undefined : artIdFromCoverUrl(pub.coverImageUrl) ? <RegionArt id={artIdFromCoverUrl(pub.coverImageUrl)!} ratio="16:10" sizes="100vw" eager fallback={<TripArt region={artRegion} />} /> : artFor('cover', [], '100vw', true)}
          back={<button className="btn btn-sm btn-ghost pi-hero-back" onClick={() => onNavigate('/explore')}>← Explore</button>}
          kicker={`${cap(pub.travelStyle)} itinerary`}
          title={pub.title}
          subtitle={pub.tagline}
          route={`${trip.startLocation} → ${trip.destinations.join(' → ')}${isRoundTrip(trip) ? ` → ${trip.startLocation}` : ''}`}
          facts={heroFacts}
          byline={byline}
          ride={view === 'ride' ? {
            facts: [
              { value: String(pub.durationDays), label: 'days' },
              ...(!hasLockedDays ? [{ value: kmOf(totalsN.totalDistanceKm), label: 'on the route' }] : []),
              { value: String(placeTotal), label: 'places' },
              ...(pub.bestSeason ? [{ value: pub.bestSeason, label: 'best season' }] : []),
            ],
            // The first three readable days, with three different pictures.
            photos: mosaicPhotos.map(p => ({
              index: p.index,
              src: p.photo,
              art: p.photo ? undefined : artFor(`day:${p.index}`, titlePlaces(p.title), '(max-width: 720px) 100vw, 640px', false, p.sceneId),
              title: p.title,
            })),
            notice: gateNotice ? (tripReReadFailed
              ? purchaseLoadNotice
              : <UnlockCheckState read={entitlementRead} onRetry={retryEntitlements} />) : undefined,
          } : undefined}
          asideLabel={price === undefined || unlocked ? 'Take this plan' : 'Buy this plan'}
          tabs={null}
          aside={
            <BuyCard
              price={showUnlockCta ? formatInr(price) : gateNotice ? undefined : unlocked && price !== undefined ? 'Yours' : 'Free'}
              note={showUnlockCta ? 'one payment · no subscription'
                : gateNotice ? ''
                : unlocked && price !== undefined ? (isMyPub ? 'your own plan' : 'full plan unlocked')
                : storefront?.allFree === false ? 'free to fork' : 'every day is open to read'}
              split={showUnlockCta ? orderedDays.map(d => (pub.freeDayIndexes.includes(d.index) ? 'open' : 'locked')) : undefined}
              splitLabel={previewSplit ? `${previewSplit.freeCount} of ${previewSplit.dayCount} days are free, ${previewSplit.lockedLabel} are in the paid plan` : undefined}
              splitNote={showUnlockCta && previewSplit
                ? `${previewSplit.freeCount} ${previewSplit.freeCount === 1 ? 'day opens' : 'days open'} free · ${previewSplit.lockedCount} ${previewSplit.lockedCount === 1 ? 'day opens' : 'days open'} when you buy`
                : undefined}
              quote={!gateNotice && pitch ? pitch : undefined}
              quoteBy={!gateNotice && pitch && creator ? `${creator.profile.name}, who made this plan` : undefined}
            >
              {showUnlockCta && <>
                <button className="btn btn-saffron btn-lg" disabled={buying} onClick={unlockThis}>
                  <InlineIcon icon={Lock} size={15} gap={5} />{buying ? 'Opening payments…' : <>Unlock full plan · {formatInr(price)}</>}
                </button>
                <button className="btn btn-outline" onClick={copyThis}>
                  <InlineIcon icon={GitFork} size={14} gap={4} />{me ? 'Fork the free preview' : 'Log in to fork'}
                </button>
                {firstOpenPos >= 0 && (
                  <button type="button" className="pi-link" onClick={() => openDay(cards[firstOpenPos].summary.index)}>
                    {openCount === 1 ? 'Read the free day first →' : `Read the ${openCount} free days first →`}
                  </button>
                )}
              </>}
              {gateNotice && (tripReReadFailed
                ? purchaseLoadNotice
                : <UnlockCheckState read={entitlementRead} onRetry={retryEntitlements} />)}
              {(price === undefined || unlocked) && (
                <button className="btn btn-primary btn-lg" onClick={copyThis}>
                  <InlineIcon icon={GitFork} size={15} gap={5} />{forkLabel}
                </button>
              )}
            </BuyCard>
          }
        />

        {stickyMode && (
          <StickyPriceBar
            visible={showStickyPrice}
            title={pub.title}
            sub={`by ${creatorName} · ${pub.durationDays} days`}
            priceLabel={stickyMode === 'unlock' ? formatInr(price ?? 0) : unlocked && price !== undefined ? 'Yours' : 'Free'}
            priceNote={stickyMode === 'unlock' ? 'one payment' : undefined}
            thumb={heroSrc ? <img src={heroSrc} alt="" decoding="async" /> : artFor('cover', [], '48px')}
            ctaLabel={stickyMode === 'unlock' ? (buying ? 'Opening payments…' : 'Unlock full plan') : forkLabel}
            mode={stickyMode}
            disabled={stickyMode === 'unlock' && buying}
            onCta={stickyMode === 'unlock' ? unlockThis : copyThis}
          />
        )}

        <div className="pi-body" ref={panelEl}>
          <div id="pi-sec-overview">
          {cards.length > 0 && (
            <DayRibbon
              label={view === 'ride' ? 'Choose a day' : 'Trip ribbon'}
              head={view === 'ride'
                ? freeTotal > 0
                  ? { kicker: 'Riding along', figure: `Day ${(rideIndex ?? 0) + 1} of ${cards.length}`, sub: `${freeRead} of ${freeTotal} free days read`, progress: freeRead / freeTotal }
                  : { kicker: 'Riding along', figure: `Day ${(rideIndex ?? 0) + 1} of ${cards.length}`, sub: `${openCount} of ${cards.length} days open to read` }
                : {
                  kicker: 'The plan',
                  figure: `${cards.length} days${!hasLockedDays && totalsN.totalDistanceKm >= 1 ? ` · ${kmOf(totalsN.totalDistanceKm)}` : ''}`,
                  sub: `${placeTotal} ${placeTotal === 1 ? 'place' : 'places'} · by ${trip.transportMode}`,
                  tag: previewSplit && !unlocked
                    ? <span className="pi-pill pi-pill--paid"><Lock size={12} aria-hidden />{cap(previewSplit.lockedLabel)} in the paid plan</span>
                    : undefined,
                }}
              days={ribbonDays}
              current={view === 'ride' ? rideCard?.summary.index ?? null : null}
              lockedWord={price !== undefined ? 'Paid' : 'Preview'}
              onPick={openDay}
            />
          )}
          </div>

          {view === 'inside' ? (
            <div key="inside" role="tabpanel" id="pi-panel-inside" aria-labelledby="pi-tab-inside" className="pi-panel">
              {/* ---- What is inside: counts for every day, names only where the
                  page already shows them. A locked day carries no place list. A
                  plan with no days has nothing to show, so the section is skipped. ---- */}
              {storefront && storefront.cards.length > 0 && (
                <section className="pi-inside" id="pi-sec-inside" aria-labelledby="pi-inside-title">
                  <div className="pi-card pi-inside-main">
                    <span className="pi-kicker">What’s inside</span>
                    <h2 className="pi-h2" id="pi-inside-title">{storefront.lede ?? pub.title}</h2>
                    <p className="pi-lede">By {creatorName}, for {trip.travellers} {trip.travellers === 1 ? 'traveller' : 'travellers'} by {trip.transportMode}.</p>
                    <b className="pi-sub-h">The {placeTotal} {placeTotal === 1 ? 'place' : 'places'}, by kind</b>
                    <KindTiles kinds={storefront.kinds} />
                    {storefront.lockedLine && (
                      <div className="pi-lock-band" role="note">
                        <Lock size={16} aria-hidden />
                        <span>{storefront.lockedLine}</span>
                        {showUnlockCta && (
                          <button className="btn btn-saffron btn-sm" disabled={buying} onClick={unlockThis}>
                            {buying ? 'Opening payments…' : <>Unlock full plan · {formatInr(price)}</>}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="pi-card pi-get">
                    <span className="pi-kicker">What you get</span>
                    <ul className="pi-get-list">
                      <li><span className="pi-get-icon"><Clock size={18} aria-hidden /></span>A clock time for each of the {placeTotal} places</li>
                      <li><span className="pi-get-icon"><Car size={18} aria-hidden /></span>Driving time between every place</li>
                      {pub.travelTips.length > 0 && <li><span className="pi-get-icon"><MessageCircle size={18} aria-hidden /></span>{pub.travelTips.length} {pub.travelTips.length === 1 ? 'tip' : 'tips'} before you go</li>}
                      <li><span className="pi-get-icon"><GitFork size={18} aria-hidden /></span>A copy in your trips that you can change</li>
                    </ul>
                    {showUnlockCta && <p className="pi-get-foot">One payment. The paid days open on this page, and the plan stays in your library.</p>}
                  </div>
                </section>
              )}

              {storefront && storefront.cards.length > 0 && (
                <section className="pi-days" id="pi-sec-days" aria-labelledby="pi-days-title">
                  <div className="pi-days-head">
                    <div>
                      <span className="pi-kicker">The {cards.length} days</span>
                      <h2 className="pi-h2" id="pi-days-title">
                        {previewSplit && !unlocked ? `${previewSplit.freeCount} to read now, ${previewSplit.lockedCount} in the paid plan` : 'Day by day'}
                      </h2>
                    </div>
                    <p className="pi-legend" aria-hidden="true">
                      <span><i className="pi-budget-dot pi-budget-drive" />Driving</span>
                      <span><i className="pi-budget-dot pi-budget-places" />At places</span>
                      <span><i className="pi-budget-dot pi-budget-free" />Free time</span>
                      <span className="pi-legend-note">Bars run from each day’s start to its planned end</span>
                    </p>
                  </div>
                  <WhatIsInside kinds={[]} days={dayCards} weeks={storefront.weeks} />
                </section>
              )}

              {/* ---- Before you go: the creator's tips and the plan's assumptions.
                  The road by height lives in the Ride along side column. An empty
                  list is left out, not drawn as an empty heading. ---- */}
              <section className="pi-before" aria-labelledby="pi-before-title">
                <span className="pi-kicker" id="pi-before-title">Before you go</span>
                <div className="pi-before-grid">
                  {(pub.travelTips.length > 0 || pub.warningsAndAssumptions.length > 0) && (
                    <div className="pi-card pi-before-notes">
                      {pub.travelTips.length > 0 && <>
                        <h2 className="pi-h2 pi-h2--s">Travel tips</h2>
                        <ul className="pi-notelist">
                          {pub.travelTips.map((t, i) => <li key={i}><MessageCircle size={15} aria-hidden />{t}</li>)}
                        </ul>
                      </>}
                      {pub.warningsAndAssumptions.length > 0 && <>
                        <h2 className="pi-h2 pi-h2--s">Warnings & assumptions</h2>
                        <ul className="pi-notelist pi-notelist--warn">
                          {pub.warningsAndAssumptions.map((t, i) => <li key={i}><TriangleAlert size={15} aria-hidden />{t}</li>)}
                        </ul>
                      </>}
                    </div>
                  )}
                </div>
              </section>

              <section className="pi-end" id="pi-sec-creator" aria-label="The creator and take this trip">
                <div className="pi-card pi-creator">
                  <div className="creator-line">
                    <Avatar user={creator} size="lg" />
                    <div>
                      <span className="pi-kicker">The creator</span>
                      <p className="pi-creator-name"><b>{creator?.profile.name ?? 'Creator'}</b>{creator?.profile.isCreator && <span className="chip chip-saffron"><InlineIcon icon={Sparkles} size={12} gap={3} />Creator</span>}</p>
                      {creator?.profile.creatorBio && <p className="small muted">{creator.profile.creatorBio}</p>}
                      {isMyPub && (
                        <div className="pub-funnel-glance" role="note" aria-label="How this plan converts, last 7 days">
                          <b className="pub-fg-title">This link, last 7 days</b>
                          <span className="pub-fg-line num">
                            {myReadFailed
                              ? 'Recorded traffic could not be read just now. The creator hub shows the same numbers when it can.'
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
                          <button className="btn btn-outline btn-sm pi-glance-btn" onClick={() => onNavigate('/creator-hub')}>
                            Open the creator hub →
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {creator?.profile.socialLinks && (
                    <div className="pi-socials">
                      {creator.profile.socialLinks.youtube && <a className="chip chip-info" href={creator.profile.socialLinks.youtube} target="_blank" rel="noreferrer" onClick={e => { e.preventDefault(); openExternal(creator.profile.socialLinks!.youtube!) }}>▶ YouTube</a>}
                      {creator.profile.socialLinks.instagram && <a className="chip chip-info" href={creator.profile.socialLinks.instagram} target="_blank" rel="noreferrer" onClick={e => { e.preventDefault(); openExternal(creator.profile.socialLinks!.instagram!) }}><InlineIcon icon={Camera} size={12} gap={3} />Instagram</a>}
                    </div>
                  )}
                  {creator && (
                    <a className="pi-link pi-more" {...appLink(`/creator/${creator.id}`)}>
                      {plans > 1 ? `See all ${plans} of ${creator.profile.name}’s plans →` : `More from ${creator.profile.name} →`}
                    </a>
                  )}
                </div>

                {/* One clear action, as in the mockup: buy when the plan is for sale,
                    fork when it is free or owned. Fork-the-preview, save and share
                    stay, as a quiet row of links under it. */}
                <div className="pi-card pi-take">
                  <span className="pi-kicker">Take this trip</span>
                  <h2 className="pi-h2">Make it yours. Change the dates, the people and the stops.</h2>
                  <div className="pi-take-actions">
                    {showUnlockCta ? <>
                      <button className="btn btn-saffron btn-lg" disabled={buying} onClick={unlockThis}>
                        <InlineIcon icon={Lock} size={15} gap={5} />{buying ? 'Opening payments…' : <>Unlock full plan · {formatInr(price)}</>}
                      </button>
                      {firstOpenPos >= 0 && (
                        <button type="button" className="pi-take-read" onClick={() => openDay(cards[firstOpenPos].summary.index)}>
                          Read the free {openCount === 1 ? 'day' : 'days'} first
                        </button>
                      )}
                    </> : !gateNotice && (
                      <button className="btn fork-btn btn-lg" onClick={copyThis}>
                        <InlineIcon icon={GitFork} size={15} gap={5} />{me ? 'Fork this trip' : 'Log in to fork'}
                      </button>
                    )}
                  </div>
                  {showUnlockCta && <p className="hint-text">One-time payment. No subscription.</p>}
                  {/* #359 — the failed/in-flight read replaces the price button
                      rather than sitting under it, here as in the buy card: a
                      buyer must not meet "Unlock for ₹499" for their own plan. */}
                  {gateNotice && (tripReReadFailed
                    ? <PurchaseLoadState onRetry={retryPostPurchaseReads} retrying={postPurchaseRetrying} centered />
                    : <UnlockCheckState read={entitlementRead} onRetry={retryEntitlements} centered />)}
                  {price !== undefined && unlocked && <p className="hint-text">
                    ✓ Full plan unlocked. Forking carries every day as a real, editable plan.
                  </p>}
                  {/* The first screen shows the pitch cut to 140 characters. Only a
                      pitch that was cut shows its full text here. Stored text is
                      never shortened. */}
                  {pub.subscriberCta && !(heroShowsPitch && pitch === pub.subscriberCta) && <p className="hint-text">{pub.subscriberCta}</p>}
                  <div className="pi-take-more">
                    {showUnlockCta && (
                      <button type="button" className="pi-take-link" onClick={copyThis}>
                        <GitFork size={14} aria-hidden />{me ? 'Fork the free preview' : 'Log in to fork the free preview'}
                      </button>
                    )}
                    <button type="button" className="pi-take-link" onClick={saveThis} aria-pressed={savedFlag}>
                      <Heart size={14} aria-hidden fill={savedFlag ? 'currentColor' : 'none'} />{savedFlag ? 'Saved' : 'Save itinerary'}
                    </button>
                    <button type="button" className="pi-take-link" onClick={() => { void nativeCopyText(shareLink); toast('Link copied') }}>
                      <Link2 size={14} aria-hidden />Copy link
                    </button>
                    <button type="button" className="pi-take-link" disabled={sendingWhatsApp} onClick={() => void sendOnWhatsApp()}>
                      <MessageCircle size={14} aria-hidden />{sendingWhatsApp ? 'Opening WhatsApp…' : 'Send on WhatsApp'}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <div key="ride" role="tabpanel" id="pi-panel-ride" aria-labelledby="pi-tab-ride" className="pi-panel pi-ride-grid">
              <div className="pi-ride-main">
                {rideCard && rideCard.state !== 'locked' && <RideReadMark publicationId={pub.id} freeIndexes={pub.freeDayIndexes} index={rideCard.summary.index} />}
                {ridePanel ?? (
                  <div className="pi-card"><p className="pi-muted">This plan has no days to ride along yet.</p></div>
                )}
                {paidPreview && <RideLockedPreview {...rideArt(paidPreview.summary.index)} card={paidPreview}
                  lastIndex={cards[paidRunEnd].summary.index}
                  action={showUnlockCta ? <button type="button" className="btn btn-saffron btn-sm" disabled={buying} onClick={unlockThis}>
                    <InlineIcon icon={Lock} size={13} gap={4} />{buying ? 'Opening payments…' : `Unlock ${paidRunLabel}`}
                  </button> : gateNotice && !tripReReadFailed ? <UnlockCheckState read={entitlementRead} onRetry={retryEntitlements} /> : null}
                />}
                {cards.length > 1 && (
                  <section className="pi-others" aria-labelledby="pi-others-title">
                    <div className="pi-others-head">
                      <h2 className="pi-h2 pi-h2--s" id="pi-others-title">The other days</h2>
                      <span className="pi-muted">Pick a day to ride along{previewSplit && !unlocked ? ' · marigold days are in the paid plan' : ''}</span>
                    </div>
                    <ol className="pi-others-list">
                      {cards.map((c, i) => {
                        if (i === ridePos || i === paidPreviewPos) return null
                        const f = dayFacts[i]
                        const km = c.state !== 'locked' && f ? kmOf(f.km) : ''
                        return (
                          <RideOtherRow
                            key={c.summary.index}
                            {...rideArt(c.summary.index, c.state === 'locked' ? undefined : f?.names)}
                            state={c.state}
                            index={c.summary.index}
                            title={c.summary.title}
                            placeCount={c.summary.placeCount}
                            photo={c.state === 'locked' ? undefined : f?.photo}
                            line={c.state === 'locked'
                              ? `${c.summary.placeCount} ${c.summary.placeCount === 1 ? 'place' : 'places'}`
                              : f && f.names.length > 0 ? f.names.join(' → ') : 'No places planned'}
                            km={km}
                            drive={c.state === 'locked' ? '' : driveOf(c.summary.travelMinutes)}
                            stagger={i}
                            onOpen={() => openDay(c.summary.index)}
                          />
                        )
                      })}
                    </ol>
                  </section>
                )}
              </div>
              <aside className="pi-ride-aside" aria-label="Take this plan">
                <div className="pi-card pi-aside-card">
                  {showUnlockCta && <>
                    <p className="pi-buy-price"><b>{formatInr(price)}</b><span>one payment · no subscription</span></p>
                    <div className="pi-split" role="img" aria-label={previewSplit ? `${previewSplit.freeCount} of ${previewSplit.dayCount} days are free` : undefined}>
                      {orderedDays.map(d => <span key={d.index} className={'pi-split-seg pi-split-' + (pub.freeDayIndexes.includes(d.index) ? 'open' : 'locked')} />)}
                    </div>
                    <RideProgress publicationId={pub.id} freeIndexes={pub.freeDayIndexes} />
                    <button className="btn btn-saffron btn-lg" disabled={buying} onClick={unlockThis}>
                      <InlineIcon icon={Lock} size={15} gap={5} />{buying ? 'Opening payments…' : <>Unlock all {cards.length} days</>}
                    </button>
                  </>}
                  <ul className="pi-aside-includes">
                    <li><Clock size={16} aria-hidden />A clock time for each place</li>
                    <li><Car size={16} aria-hidden />Driving time between places</li>
                    <li><GitFork size={16} aria-hidden />A copy in your trips to change</li>
                  </ul>
                  {gateNotice && !tripReReadFailed && <UnlockCheckState read={entitlementRead} onRetry={retryEntitlements} />}
                  {!showUnlockCta && <button className="btn fork-btn btn-lg" onClick={copyThis}>
                    <InlineIcon icon={GitFork} size={15} gap={5} />{me ? 'Fork this trip' : 'Log in to fork'}
                  </button>}
                </div>
                <RideElevation key={pub.id} trip={trip} freeIndexes={unlocked ? orderedDays.filter(day => !isWireLocked(day)).map(day => day.index) : pub.freeDayIndexes} />
                {creator && (
                  <a className="pi-card pi-aside-creator" {...creatorLinkProps}>
                    <Avatar user={creator} size="lg" />
                    <span><b>{creator.profile.name} · {plans} {plans === 1 ? 'route' : 'routes'}</b>{creator.profile.creatorBio && <span className="pi-muted">{creator.profile.creatorBio}</span>}</span>
                    <ChevronRight size={16} aria-hidden />
                  </a>
                )}
                <div className="pi-ride-group">
                  <Users size={19} aria-hidden />
                  <p><b>Going as a group?</b> Send the free days to your crew first.</p>
                  <CopyButton text={withShareRef(currentPublicShareUrl(pub.id), 'copy')} label="Copy link" />
                </div>
              </aside>
            </div>
          )}
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
            /* #591 — the receipt states what was PAID, which is the entitlement
               row's snapshot, not the catalog copy: a creator changing the price
               while this tab sat open would otherwise make the reveal contradict
               the shelf for the same purchase. Absent for a beat when the
               re-read has not landed — the component renders no figure rather
               than a wrong one. */
            amountPaidInr={entitlements.find(e => e.pubId === pub.id)?.amountPaidInr}
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

/** The day's timeline, shared by free days and unlocked (paid/creator)
 *  views — one renderer so an unlocked day shows EXACTLY what a free day
 *  shows, including the travelling rows (departure/arrival, distance,
 *  cost) the first cut of the unlock flow silently dropped. Each row is a
 *  clock, a rail dot and the row's own facts, read by stop id. */
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
  /** the trip's transport mode — the travelling row's glyph follows it. */
  mode: string
}) {
  // #555: the schedule keyed by stop id — sim's legs are INTO legs (legIn of
  // each active stop) and its arrays are per-active-stop, so the row below
  // reads its own facts instead of a neighbour's position.
  const simRows = scheduleRowsById(sim)
  return (
    <ol className="pi-tl">
      {stops.map((s, i) => {
        // Auto anchors are pure travel, not activities — show the
        // drive (times, duration, distance, cost) as a travelling
        // row instead of an empty stop row.
        if (s.auto === true) {
          const cleanName = (s.locationName || s.title).replace(/ \((start|end)\)$/, '')
          // Stay day: the journey never leaves this place — a
          // plain base marker, not a travelling row.
          if (stayDay) {
            return (
              <li key={s.id} className="pi-tl-row pi-tl-row--base">
                <span className="pi-tl-time" />
                <span className="pi-tl-rail"><i className="pi-tl-dot pi-tl-dot--ico"><MapPin size={11} aria-hidden /></i></span>
                <div className="pi-tl-body"><b>Based in {cleanName}</b></div>
              </li>
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
            <li key={s.id} className="pi-tl-row pi-tl-row--travel">
              <span className="pi-tl-time">{inbound ? arrHM : depHM}</span>
              <span className="pi-tl-rail"><i className="pi-tl-dot pi-tl-dot--ico">{i === 0 ? <Flag size={11} aria-hidden /> : modeIcon(mode, 11)}</i></span>
              <div className="pi-tl-body">
                <b>{i === 0 ? `Start · ${cleanName}` : `Travelling to ${cleanName}`}</b>
                <div className="pi-tl-meta">
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
            </li>
          )
        }
        const stopRow = simRows.get(s.id)
        const stopArrive = stopRow && stopRow.arrive !== '--:--' ? formatHM(stopRow.arrive, timeFormat) : ''
        return (
          <li key={s.id} className="pi-tl-row pi-tl-row--stop">
            <span className="pi-tl-time">{stopArrive}</span>
            <span className="pi-tl-rail"><i className={`pi-tl-dot cat-${s.category}`}>{i + 1}</i></span>
            <div className="pi-tl-body">
              <div className="pi-tl-toprow">
                <b className="pi-tl-title">{s.title}</b>
                <Chip tone="info">{titleCase(s.category)}</Chip>
                {s.openTime && <span className="small muted"><MetaIcon icon={ Clock } tone="time" />{formatHMRange(s.openTime, s.closeTime, timeFormat)}</span>}
              </div>
              <div className="pi-tl-meta">
                <span><MetaIcon icon={ MapPin } tone="place" />{s.locationName}</span>
                <span><MetaIcon icon={ Clock } tone="time" />{minutesToHM(s.visitMinutes)}</span>
                {s.entryFeeInrPerPerson > 0 && <span><MetaIcon icon={ Ticket } tone="ticket" />₹{s.entryFeeInrPerPerson}/person</span>}
              </div>
              {s.description && <div className="pi-tl-desc">{s.description}</div>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
