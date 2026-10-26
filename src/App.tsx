// ============ YatraFlow app shell ============
// Hash-based routing so the built app works from any static host or file://.
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { InlineIcon } from './components/icons'
import { createPortal } from 'react-dom'
import {
  Bell, Compass, Import, Inbox, Luggage, Link2, Mail, Menu, Moon, Plus,
  Settings, Sparkles, Sun, Tent, X,
} from 'lucide-react'
import { Analytics } from '@vercel/analytics/react'
import {
  browserNotifEnabled, browserNotifPermission, fireBrowserNotification,
  shouldBrowserNotify,
} from './lib/browserNotifications'
import type { Notification, Trip } from './data/types'
import { useDb, currentUser, privateUser, useUsers, useNotifications, useSessionUserId, useIdentityGeneration, useSliceReads, logout, markAllNotificationsRead, tripById, joinViaInvite, reloadJoinedTrip, importTripPersisted, retryImportTrip, init, resumeSync, useStoreReady, fetchSharedTrip, fetchTripByInviteCode, viewerIsMemberOf, collectUnclaimedCovers } from './store/store'
import { Avatar, BrandMark, ToastZone, useClickOutside, toast } from './components/ui'
import { BottomNav } from './components/BottomNav'
import { OfflineBanner } from './components/OfflineBanner'
import { UpdateNotice } from './components/UpdateNotice'
import { PillNav } from './components/PillNav'
import { decodeTripSnapshot } from './lib/snapshot'
import { analyticsBeforeSend } from './lib/analyticsPrivacy'
import { scrollBehavior } from './lib/motion'
import { pageTitle, routeParts } from './lib/pageTitle'
import { CREATE_SEGMENT, CREATE_PATH } from './lib/routes'
import { createFunnelOn } from './lib/featureFlags'
import { currentRoute, navigate as navigateRoute, onRouteChange, settleLegacyHash } from './lib/router'
import { appLink } from './lib/appLink'
import { App as CapApp } from '@capacitor/app'
import { isNative } from './lib/native'
import { apkUpdateCheck, bootApkUpdates } from './lib/apkUpdateRuntime'
import { feedbackHref } from './lib/feedback'
import { setTheme, useTheme } from './lib/theme'
import { hideSplash, registerAndroidBack, setNativeTheme } from './lib/appShell'
import { sliceState, rowsView, type RowsView } from './lib/readState'
import { StateBlock } from './components/page/StateBlock'
import { LandingPage } from './pages/Landing'
import { NativeHomePage } from './pages/NativeHome'
import {
  sharedSnapshotState, inviteGateState, gateMachine, dispatchGateEvent, setGateOwner, ownedBy, disposeGateMount,
  subscribeGateState, gateMachineVersion,
  type JoinResult,
  inviteLoginNext, inviteSignupNext, invitePreview,
  joinMachine, joinAllowsNavigation, nextAttemptId,
  createAttemptOwner, retireAttemptOwner, attemptOwnerLive,
  type JoinEvent, type JoinPlan, type JoinAction, type AttemptOwner,
} from './lib/inviteGateStates'
// Route-level code splitting: only the landing page stays in the main chunk (it
// is the app's front door and reads no store data); every other route -
// including the workspace and its map/editor subtree - loads on first visit.
const TripsListPage = lazy(() => import('./pages/TripsList').then(m => ({ default: m.TripsListPage })))
const TripWorkspace = lazy(() => import('./pages/TripWorkspace').then(m => ({ default: m.TripWorkspace })))
const TripCreatedPage = lazy(() => import('./pages/TripCreated').then(m => ({ default: m.TripCreatedPage })))
const ExplorePage = lazy(() => import('./pages/Explore').then(m => ({ default: m.ExplorePage })))
const AuthPage = lazy(() => import('./pages/Auth').then(m => ({ default: m.AuthPage })))
const CreateTripPage = lazy(() => import('./pages/CreateTrip').then(m => ({ default: m.CreateTripPage })))
const PublicItineraryPage = lazy(() => import('./pages/PublicItinerary').then(m => ({ default: m.PublicItineraryPage })))
const ProfilePage = lazy(() => import('./pages/Profile').then(m => ({ default: m.ProfilePage })))
const PurchasesPage = lazy(() => import('./pages/Purchases').then(m => ({ default: m.PurchasesPage })))
const CreatorPage = lazy(() => import('./pages/CreatorPage').then(m => ({ default: m.CreatorPage })))
// Gated route: only shown in the nav when the account has creator mode on.
const CreatorHubPage = lazy(() => import('./pages/CreatorHubPage').then(m => ({ default: m.CreatorHubPage })))
// Masteradmin console: JWT app_metadata role only (never linked anywhere -
// admins type /admin; non-admins fall through to landing inside the page).
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })))
const DMCAPage = lazy(() => import('./pages/DMCAPage').then(m => ({ default: m.DMCAPage })))

/** Suspense fallback for the lazy routes - the same loading block the ready-gate shows. The `page-enter` root gives the block the shared entrance, so it never pops in. */
const lazyRouteFallback = <div className="container page-enter"><StateBlock kind="loading" titleLevel="h2" icon={<span className="spinner" aria-hidden="true" />} title="Loading…" /></div>

export type ProfileLookupState = 'anonymous' | 'reading' | 'failed' | 'missing' | 'ready'

/** Whether the profile lookup is still outstanding for this render.
 *
 *  `state` is required, not defaulted: a caller that omits it would silently
 *  treat a failed read as settled, which is the defect this replaces. */
export function needsProfileLookup(
  sessionUserId: string | null,
  hasProfile: boolean,
  state: ProfileLookupState,
): boolean {
  return !!sessionUserId && (!hasProfile || state === 'failed')
}

export function profileLookupState(
  sessionUserId: string | null,
  hasProfile: boolean,
  sliceReads: Record<string, 'ok' | 'failed'>,
): ProfileLookupState {
  if (!sessionUserId) return 'anonymous'
  // The signed-in account is the PRIVATE read (`self profile`), not the public
  // catalogue. A public catalogue that succeeded while the private read failed
  // used to read as "completed without an account", so the notice offered a
  // missing-profile message and no working retry.
  //
  // Self success stands on its OWN verdict. A public-only failure must not
  // override a private read that succeeded: the account's data is usable, and a
  // consumer that follows the public verdict would hide a working import action
  // behind a profile failure.
  //
  // A failure is checked BEFORE `hasProfile`, because a private row still in the
  // cache from an earlier successful read must not settle a lookup whose latest
  // read failed. A read that failed means the account's status is unproven,
  // whatever the cache happens to still hold.
  const selfRead = sliceState(sliceReads, 'self profile')
  if (selfRead === 'failed') return 'failed'
  if (selfRead === 'ready' && hasProfile) return 'ready'
  if (selfRead === 'reading' && 'self profile' in sliceReads) return 'reading'
  const profileRead = sliceState(sliceReads, 'profiles')
  if (profileRead === 'failed') return 'failed'
  if (hasProfile) return 'ready'
  if (profileRead === 'reading') return 'reading'
  return 'missing'
}

/** Route segments that answer for a signed-out visitor. They stay reachable when
 *  the signed-in account's private read fails. */
const GUEST_ROUTE_SEGMENTS = new Set(['pub', 'creator', 'explore'])

/** Whether the profile lookup takes the page from the route. A failed lookup takes it on the
 *  bare route too, so its Try again is never hidden behind the landing. A reading lookup does
 *  not, so the landing does not flash while hydrate runs. */
export function profileLookupBlocksRoute(
  sessionUserId: string | null,
  hasProfile: boolean,
  state: ProfileLookupState,
  bareRoute: boolean,
  native: boolean,
): boolean {
  if (!needsProfileLookup(sessionUserId, hasProfile, state)) return false
  return !bareRoute || native || state === 'failed'
}

export function notificationPanelModel(
  sliceReads: Record<string, 'ok' | 'failed'>,
  notifications: Notification[],
  sessionUserId: string | null,
): { rows: Notification[]; view: RowsView } {
  const rows = sessionUserId
    ? notifications.filter(notification => notification.userId === sessionUserId).sort((a, b) => b.at - a.at)
    : []
  // hydrate reads notifications by trip, so an account with no trips issues no
  // notifications read and the slice stays unreported. A trips verdict beside
  // that gap is the answer: no trips, so no trip notifications. Without a trips
  // verdict the read is still pending, and that stays "reading".
  const noTripScope = !('notifications' in sliceReads) && sliceState(sliceReads, 'trips') === 'ready'
  const read = noTripScope ? 'ready' : sliceState(sliceReads, 'notifications')
  return { rows, view: rowsView(read, rows.length) }
}

/** Re-issue the private profile read (#800 F1). A reload re-runs hydrate, but a
 *  reload is not what the notice promises: it reloads the whole app, loses the
 *  scroll position and any in-progress draft, and — worst — it re-reads the
 *  PUBLIC catalogue too, which is the read that already succeeded. `resumeSync`
 *  re-issues the same authorized reads under the same generation, so the retry
 *  actually reaches the read that failed.
 *
 *  The promise is returned so a caller can await the retry it triggered. */
export function retryProfileLookup(): Promise<void> {
  return import('./store/store')
    .then(store => store.resumeSync())
    .catch(() => { window.location.reload() })
}

export function ProfileLookupNotice({ state }: { state: ProfileLookupState }) {
  if (state === 'ready' || state === 'anonymous') return null
  if (state === 'reading') {
    return <StateBlock kind="loading" title="Loading your profile…" titleLevel="h2" />
  }
  if (state === 'failed') {
    return (
      <StateBlock
        kind="failed"
        title="Your profile could not load."
        titleLevel="h2"
        actions={<button className="btn btn-primary btn-sm" onClick={retryProfileLookup}>Try again</button>}
      />
    )
  }
  return (
    <StateBlock
      kind="empty"
      title="Your profile is not available."
      body="The profile read completed without a matching account."
      titleLevel="h2"
    />
  )
}

function ProfileLookupPage({ state }: { state: ProfileLookupState }) {
  return (
    <div className="container page-enter yf-page">
      <ProfileLookupNotice state={state} />
    </div>
  )
}

export function NotificationReadNotice({ view, onRetry }: { view: RowsView; onRetry: () => void }) {
  if (view === 'rows' || view === 'empty') return null
  if (view === 'reading') {
    return <StateBlock kind="loading" size="compact" title="Loading notifications…" />
  }
  if (view === 'failed') {
    return (
      <StateBlock
        kind="failed"
        size="compact"
        title="Couldn’t load notifications."
        actions={<button className="btn btn-primary btn-sm" onClick={onRetry}>Try again</button>}
      />
    )
  }
  return (
    <StateBlock
      kind="kept"
      size="compact"
      title="Refresh failed. The app shows your last notifications."
      actions={<button className="btn btn-primary btn-sm" onClick={onRetry}>Try again</button>}
    />
  )
}

export function NotificationPanelContent({
  model,
  showAll,
  onRetry,
  onOpenTrip,
}: {
  model: { rows: Notification[]; view: RowsView }
  showAll: boolean
  onRetry: () => void
  onOpenTrip: (tripId: string) => void
}) {
  const { rows, view } = model
  return (
    <div style={{ maxHeight: showAll ? 'min(60vh, calc(100vh - 150px))' : 320, overflowY: 'auto', overscrollBehavior: 'contain' }}>
      {view === 'empty' && (
        <p className="muted small" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Inbox size={14} aria-hidden />You’re all caught up
        </p>
      )}
      <NotificationReadNotice view={view} onRetry={onRetry} />
      {(showAll ? rows : rows.slice(0, 12)).map(notification => {
        const tripId = notification.tripId
        return (
          <div key={notification.id} className={`notif-item ${notification.read ? '' : 'unread'}`}>
            <span>{notification.text}</span>
            {tripId && <button className="btn btn-ghost btn-sm" onClick={() => onOpenTrip(tripId)}>View →</button>}
          </div>
        )
      })}
    </div>
  )
}

export default function App() {
  // Slice subscriptions: the shell re-renders only when profiles, the session
  // or notifications change - a trip edit no longer re-renders the entire
  // page tree through App.
  const users = useUsers()
  const sessionUserId = useSessionUserId()
  const notifications = useNotifications()
  const sliceReads = useSliceReads()
  // Same semantics as currentUser(): the profile whose id matches sessionUserId.
  // Narrowed to the PRIVATE row, because the account menu below shows the signed-in
  // user's own email — which exists only there (#800).
  const me = useMemo(() => {
    const found = users.find(u => u.id === sessionUserId)
    return found && privateUser(found) ? found : null
  }, [users, sessionUserId])
  const profileState = profileLookupState(sessionUserId, !!me, sliceReads)
  const notificationPanel = useMemo(
    () => notificationPanelModel(sliceReads, notifications, sessionUserId),
    [sliceReads, notifications, sessionUserId],
  )
  // The route lives in the address bar now (web): the initial state settles
  // any legacy hash address first — a bookmark from the hash era, a card
  // handler's `/#/pub/<id>` hand-off, a native share intent opened on web —
  // so the first render already renders the promoted route.
  const [route, setRoute] = useState(() => settleLegacyHash() ?? currentRoute())
  // Theme is shared (src/lib/theme.ts) so the web topnav toggle and the
  // Profile card in the Android shell stay in sync - setTheme applies the
  // DOM + persistence + status bar and notifies both render trees.
  const dark = useTheme()
  const [notifOpen, setNotifOpen] = useState(false)
  // #84: the panel capped at 12 with no way to reach older items - silently
  // lossy. "Show all" expands the list in place; it resets when the popover
  // closes so the bell always opens on the recent view.
  const [notifShowAll, setNotifShowAll] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [notifRef, notifPopRef] = useClickOutside(() => setNotifOpen(false))
  const [menuRef, userMenuRef] = useClickOutside(() => setMenuOpen(false))
  // Both popovers portal to document.body: nested inside .topnav (which has
  // its own backdrop-filter), their backdrop blur would only sample the nav's
  // own interior - the page behind stayed sharp. Portaled panels need
  // position: fixed, so capture the trigger's viewport rect at open time.
  const [notifPos, setNotifPos] = useState({ top: 0, right: 0 })
  const [menuPos, setMenuPos] = useState({ top: 0, right: 0 })
  const syncNotifPos = () => {
    const el = notifRef.current
    if (el) { const r = el.getBoundingClientRect(); setNotifPos({ top: r.bottom + 8, right: window.innerWidth - r.right }) }
  }
  const syncMenuPos = () => {
    const el = menuRef.current
    if (el) { const r = el.getBoundingClientRect(); setMenuPos({ top: r.bottom + 8, right: window.innerWidth - r.right }) }
  }

  useEffect(() => {
    // One subscription for every route change: this module's navigate (one
    // pushState on the web), the browser's Back/Forward, and the native
    // shell's hash changes — the seam lives in lib/router.
    return onRouteChange(() => {
      setRoute(currentRoute())
      setMobileNav(false)
      window.scrollTo({ top: 0, behavior: scrollBehavior() })
    })
  }, [])

  // Boot the store once: subscribes to Supabase auth changes and hydrates the
  // session's data into the cache. Without this, `me` stays null forever and
  // every route falls through to the landing page. Idempotent inside the store.
  useEffect(() => { init() }, [])

  // Apply the persisted theme to the document on first paint (the HTML ships
  // without data-theme). Changes go through setTheme(); this only seeds the
  // initial value so the app never flashes the wrong theme on boot.
  useEffect(() => {
    const root = document.documentElement
    if (root.dataset.theme !== (dark ? 'dark' : 'light')) {
      root.dataset.theme = dark ? 'dark' : 'light'
      document.querySelectorAll('meta[name="theme-color"]').forEach(m =>
        m.setAttribute('content', dark ? '#0C1420' : '#FAF7F2'))
      void setNativeTheme(dark)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Native shell boot: hide the launch splash once the store has hydrated
  // (the same ready-gate below flips) or after 2.5s worst case, and own the
  // Android back button (overlays close first, then hash history, then exit).
  useEffect(() => { void hideSplash() }, [])
  // Foreground resume: the OS froze the WebView while backgrounded, so the
  // realtime socket is dead without an event. One full re-hydrate refetches
  // notifications/trips and re-subscribes. Web needs nothing like this.
  useEffect(() => {
    if (!isNative) return
    const handle = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) { void resumeSync().catch(() => {}) }
    })
    return () => { handle.then(h => h.remove()).catch(() => {}) }
  }, [])
  // APK update checks: one automatic check at native startup, and one each time
  // the app returns to the foreground. The core rate-limits automatic checks to
  // one a day, so a resume inside that window costs no request, and a StrictMode
  // double mount cannot start two: the runtime boots once, and a second check
  // joins the request already in flight. Web mounts nothing.
  useEffect(() => {
    if (!isNative) return
    let live = true
    void bootApkUpdates()
      .then(() => { if (live) void apkUpdateCheck() })
      .catch(() => {})
    const handle = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void apkUpdateCheck()
    })
    return () => {
      live = false
      void handle.then(h => h.remove()).catch(() => {})
    }
  }, [])
  useEffect(() => {
    const off = registerAndroidBack({
      closeOverlay: () => {
        const hadAny = mobileNav || notifOpen || menuOpen
        setMobileNav(false); setNotifOpen(false); setMenuOpen(false)
        return hadAny
      },
    })
    return off
  }, [mobileNav, notifOpen, menuOpen])

  // Theme radiate via View Transitions - the real UI morphs in both themes.
  // Two hard-won rules make this flawless:
  //  1. Suppress backdrop-filter for the transition's lifetime: Chromium
  //     renders glass inside VT snapshots WITHOUT its backdrop, so any glass
  //     layer turns the captured page into a flat gray veil. Unblurred glass
  //     for ~600ms is imperceptible; the veil is not.
  //  2. Drive the clip-path from CSS keyframes selected by a class that is set
  //     BEFORE startViewTransition - the animation exists from the snapshot
  //     tree's first frame (no JS-attach gap → no pre-flash) and `fill: both`
  //     holds the end state until teardown (no end flash).
  // Dark → light: the new light view radiates OUT of the icon (slow → zap).
  // Light → dark: the old light view collapses INTO the icon (fast → settle).
  // The landing page runs continuous CSS animations (atmosphere blobs, route
  // line draw, ticker, odometer). A full-page View-Transition snapshots the DOM,
  // so all of that scenery visibly freezes for the ~700 ms the snapshot plays.
  // Swap instantly there - no radiate - keeping the homepage alive; the radiate
  // stays for the calmer in-app pages. (Also fixes the mobile eruption point,
  // which was only ever observed on the landing route.)
  function toggleTheme(e: MouseEvent<HTMLButtonElement>) {
    // Landing page: skip View Transition entirely to avoid freezing continuous CSS animations
    if (route === '/' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setTheme(!dark); return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const root = document.documentElement
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    root.style.setProperty('--vt-x', `${x}px`)
    root.style.setProperty('--vt-y', `${y}px`)
    root.style.setProperty('--vt-r', `${radius}px`)
    const goingLight = dark
    root.classList.remove('vt-radiate-out', 'vt-radiate-in')
    root.classList.add(goingLight ? 'vt-radiate-out' : 'vt-radiate-in')
    root.classList.add('vt-active') // backdrop-filter suppression window
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void> }
    }
    if (!doc.startViewTransition) { // old browsers: skip straight to the swap
      root.classList.remove('vt-radiate-out', 'vt-radiate-in', 'vt-active')
      setTheme(!dark); return
    }
    const vt = doc.startViewTransition(() => setTheme(!dark))
    vt.finished.finally(() => {
      root.classList.remove('vt-radiate-out', 'vt-radiate-in', 'vt-active')
      root.style.removeProperty('--vt-x'); root.style.removeProperty('--vt-y'); root.style.removeProperty('--vt-r')
    }).catch(() => { /* nothing to clean up further */ })
  }

  // Portaled panels sit at the end of <body>: without an explicit focus grab,
  // Tab from the trigger would skip the menu and wander into the page instead.
  useEffect(() => {
    if (notifOpen) notifPopRef.current?.focus({ preventScroll: true })
    if (menuOpen) userMenuRef.current?.focus({ preventScroll: true })
  }, [notifOpen, menuOpen, notifPopRef, userMenuRef])

  // On close, hand focus back to the trigger so keyboard users aren't stranded
  // at the end of <body> (the close paths are Escape, outside-click and the
  // menu items themselves - all leave the trigger as the right landing spot).
  const prevNotifOpen = useRef(false)
  const prevMenuOpen = useRef(false)
  useEffect(() => {
    if (prevNotifOpen.current && !notifOpen) { notifRef.current?.focus({ preventScroll: true }); setNotifShowAll(false) }
    prevNotifOpen.current = notifOpen
    if (prevMenuOpen.current && !menuOpen) menuRef.current?.focus({ preventScroll: true })
    prevMenuOpen.current = menuOpen
  }, [notifOpen, menuOpen, notifRef, menuRef])

  // Escape closes any open popover (UI audit F-10) - outside-click alone
  // leaves keyboard users stranded.
  useEffect(() => {
    if (!mobileNav && !notifOpen && !menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setMobileNav(false); setNotifOpen(false); setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileNav, notifOpen, menuOpen])

  function navigate(to: string) {
    navigateRoute(to)
  }

  // route shapes: /, /auth, /trips, /new, /trip/:id, /explore, /pub/:slug, /creator/:id, /creator-hub, /join/:code, /invite/:tripId (legacy), /admin, /share/<payload>, /profile
  // Query strings (e.g. /auth?mode=signup) ride on parts[0]; strip them so the
  // segment still matches the switch. Pages read their own params from the
  // address via lib/router's currentQuery().
  const parts = routeParts(route)
  // A guided step changes the address while keeping the live form mounted.
  // Other query values still identify a new page, including future seed inputs.
  const routePanelKey = parts[0] === CREATE_SEGMENT && createFunnelOn('guided')
    ? (() => {
      const [path, query = ''] = route.split('?')
      const params = new URLSearchParams(query)
      params.delete('step')
      return params.toString() ? `${path}?${params}` : path
    })()
    : route

  // One title per route. `index.html` carries a single static title, so every
  // route shared it: four open tabs all read the same thing, and a bookmark of
  // one itinerary was indistinguishable from a bookmark of the site. Routes
  // Whose name lives in the store (`/trip/…`, `/pub/…`, `/creator/…`) get a
  // generic title here and are refined by the page that already holds the
  // record - App deliberately slices its subscriptions, and reading the trips
  // table just to label a tab would undo that.
  // The same title feeds the route-change live region below: without it a
  // screen-reader user crossing routes hears nothing (no focus move happens
  // on navigation, and the new page's headings are not announced on their
  // own), so the title is the cheapest honest announcement of "where you
  // are now". Reviewed 2026-09-23 (entry-path interface review, finding 3).
  const [routeAnnounce, setRouteAnnounce] = useState('')
  useEffect(() => {
    const title = pageTitle(routeParts(route))
    document.title = title
    setRouteAnnounce(title)
  }, [route])

  let page: React.ReactNode

  // Before the first hydrate settles, every "empty" is a lie: a deep link to
  // #/trip/... used to flash Landing, "No trips yet" rendered before data, and
  // invite links showed "broken" mid-load. One gate at the router fixes all
  // three - auth and share links don't read the cache, so they stay live.
  // The landing route stays live too: LandingPage (and the Plan Bench inside
  // it) never reads the store, and route "/" renders LandingPage after the
  // gate regardless of who is signed in - so rendering it immediately shows
  // exactly what the post-gate frame would be, instead of a spinner that
  // swaps to the full page (the landing load shift, Lighthouse CLS 0.997).
  const ready = useStoreReady()
  // Splash hides on the same ready flip (or 2.5s worst case) so the launch
  // image never lingers behind the loading block.
  useEffect(() => {
    if (!ready) { const t = setTimeout(() => void hideSplash(), 2500); return () => clearTimeout(t) }
    void hideSplash()
  }, [ready])
  // Collect any share-link cover still pointing at someone else's host. Taking
  // ownership at publish time is a write-path fix, so rows published before it
  // shipped — and any publish whose copy failed, which keeps the third-party URL
  // by design — would otherwise keep pointing at Wikimedia forever. Idempotent:
  // with nothing to collect it reads the cache and returns.
  useEffect(() => {
    if (!ready || !sessionUserId) return
    void collectUnclaimedCovers().catch(() => {})
  }, [ready, sessionUserId])
  const bareRoute = parts[0] === undefined || parts[0] === ''
  // The web paints its landing instantly while the store hydrates (no spinner
  // in front of the marketing home). The shell never shows that page - not
  // even as a flash before hydration completes: a signed-in user opening the
  // app must see the loading block (under the splash), then their app home -
  // never the website's home. That ready-gate exclusion used to be
  // unconditional, so every launch flashed the marketing landing + its
  // website chrome before NativeHome arrived.
  if (!ready && parts[0] !== 'auth' && parts[0] !== 'share' && (!bareRoute || isNative)) {
    page = lazyRouteFallback
  } else if (parts[0] === 'share' && parts[1]) {
    page = <SharedTripPage payload={parts[1]} onNavigate={navigate} />
  } else if (parts[0] === 'join' && parts[1]) {
    page = <InviteGate codeOrTripId={parts[1]} onNavigate={navigate} />
  } else if (parts[0] === 'invite' && parts[1]) {
    // Legacy UUID links (#/invite/<tripId>) from before invite codes shipped.
    // Keep working: the gate accepts a raw trip id too.
    page = <InviteGate codeOrTripId={parts[1]} onNavigate={navigate} />
  } else if (parts[0] === 'dmca') {
    // A policy page answers for signed-out visitors too, so it sits pre-switch
    // beside share/join/invite rather than inside the signed-in switch.
    page = <Suspense fallback={lazyRouteFallback}><DMCAPage /></Suspense>
  } else if (!me) {
    // public pages stay accessible logged-out; everything else funnels to auth/landing
    if (parts[0] === 'pub' && parts[1]) page = <Suspense fallback={lazyRouteFallback}><PublicItineraryPage key={parts[1]} slug={parts[1]} onNavigate={navigate} /></Suspense>
    else if (parts[0] === 'creator' && parts[1]) page = <Suspense fallback={lazyRouteFallback}><CreatorPage creatorId={parts[1]} onNavigate={navigate} /></Suspense>
    else if (parts[0] === 'explore') page = <Suspense fallback={lazyRouteFallback}><ExplorePage onNavigate={navigate} /></Suspense>
    else if (parts[0] === 'auth' && !sessionUserId) page = <Suspense fallback={lazyRouteFallback}><AuthPage onNavigate={navigate} /></Suspense>
    else if (profileLookupBlocksRoute(sessionUserId, !!me, profileState, bareRoute, isNative)) page = <ProfileLookupPage state={profileState} />
    else page = <LandingPage onNavigate={navigate} />
  } else if (!GUEST_ROUTE_SEGMENTS.has(parts[0] ?? '')
    && profileLookupBlocksRoute(sessionUserId, !!me, profileState, bareRoute, isNative)) {
    // A failed private read KEEPS the account's row — it is not silently
    // downgraded to a public card — so `me` is non-null and this branch runs. The
    // notice and its Try again must still be reachable here; a gate consulted only
    // inside the `!me` branch above could never see this case. Guest-accessible
    // segments stay reachable, exactly as they do for an account with no row.
    page = <ProfileLookupPage state={profileState} />
  } else {
    switch (parts[0]) {
      case undefined:
      case '':
        // In the installed app the marketing landing is the wrong front
        // door - a signed-in user wants their trips, not a sales pitch.
        // The shell gets a task-first home; the website keeps the landing
        // (SEO, first-time visitors, the Plan Bench calculator).
        page = isNative && me
          ? <NativeHomePage me={me} onNavigate={navigate} />
          : <LandingPage onNavigate={navigate} />
        break
      case 'trips':
        page = <Suspense fallback={lazyRouteFallback}><TripsListPage onNavigate={navigate} /></Suspense>
        break
      case CREATE_SEGMENT:
        page = <Suspense fallback={lazyRouteFallback}><CreateTripPage onNavigate={navigate} /></Suspense>
        break
      case 'created':
        page = <Suspense fallback={lazyRouteFallback}><TripCreatedPage tripId={parts[1] ?? ''} onNavigate={navigate} /></Suspense>
        break
      case 'trip':
        page = <Suspense fallback={lazyRouteFallback}><TripWorkspace tripId={parts[1] ?? ''} initialTab={parts[2]} onNavigate={navigate} /></Suspense>
        break
      case 'explore':
        page = <Suspense fallback={lazyRouteFallback}><ExplorePage onNavigate={navigate} /></Suspense>
        break
      case 'pub':
        page = <Suspense fallback={lazyRouteFallback}><PublicItineraryPage key={parts[1]} slug={parts[1] ?? ''} onNavigate={navigate} /></Suspense>
        break
      case 'creator':
        page = <Suspense fallback={lazyRouteFallback}><CreatorPage creatorId={parts[1] ?? ''} onNavigate={navigate} /></Suspense>
        break
      case 'profile':
        page = <Suspense fallback={lazyRouteFallback}><ProfilePage onNavigate={navigate} /></Suspense>
        break
      // I-20: the buyer's shelf. Reached from My trips (and from the unlock
      // moment's own copy); deliberately its own route so it can be bookmarked
      // and titled, rather than a third view inside the trip list.
      case 'purchases':
        page = <Suspense fallback={lazyRouteFallback}><PurchasesPage onNavigate={navigate} /></Suspense>
        break
      case 'creator-hub':
        page = <Suspense fallback={lazyRouteFallback}><CreatorHubPage onNavigate={navigate} /></Suspense>
        break
      case 'auth':
        // A logged-in user landing on /auth (e.g. right after the invite
        // round-trip's login submit) used to fall to `default:` → Landing,
        // and AuthPage - whose me-effect performs the post-login redirect -
        // never mounted, stranding the user on the landing page with the
        // invite lost. Mount it; the effect sends them on to `next` (or /trips).
        page = <Suspense fallback={lazyRouteFallback}><AuthPage onNavigate={navigate} /></Suspense>
        break
      // Masteradmin console - intentionally unlinked (no nav pill anywhere):
      // admins type /admin; AdminPage itself falls through to Landing for
      // non-admins (the JWT role is the gate, the route existing is not).
      case 'admin':
        page = <Suspense fallback={lazyRouteFallback}><AdminPage onNavigate={navigate} /></Suspense>
        break
      default:
        // Shell parity: an unknown deep link in the installed app must not
        // drop a signed-in user onto the marketing landing (website chrome
        // reads as "the app came back as a website"). The bottom nav's Home
        // is the honest fallback; the web keeps the landing for its SEO job.
        page = isNative && me ? <NativeHomePage me={me} onNavigate={navigate} /> : <LandingPage onNavigate={navigate} />
    }
  }

  // Same filter+sort as notificationsFor(), but derived from the subscribed
  // notifications slice so the bell stays live without a full-cache subscription.
  const notifs = notificationPanel.rows
  const unread = notifs.filter(n => !n.read).length
  function retryNotifications() { void resumeSync() }

  // ---- Browser push (local Notification API, no service worker) ----
  // In-app bell is the source of truth; this effect mirrors NEW unread rows
  // for the session user to the OS level when the tab is in the background.
  // Guards: user opted in (Profile toggle) + permission granted + per-id
  // dedupe + read-flag + unfocused tab. Own local writes land in the slice
  // too, but they arrive while the tab is focused, so shouldBrowserNotify()
  // already filters them - no echo-suppression map needed here.
  const seenNotifIds = useRef<Set<string>>(new Set())
  // A fresh login must not replay the whole inbox as OS pings: seed the seen
  // set with whatever is already in the slice on first run / account switch.
  const notifSeedUser = useRef<string | null>(null)
  useEffect(() => {
    if (!sessionUserId) { notifSeedUser.current = null; return }
    if (notifSeedUser.current !== sessionUserId) {
      notifSeedUser.current = sessionUserId
      seenNotifIds.current = new Set(notifs.map(n => n.id))
      return
    }
    if (!browserNotifEnabled()) return
    if (browserNotifPermission() !== 'granted') return
    for (const n of notifs) {
      if (shouldBrowserNotify(n, sessionUserId, seenNotifIds.current, document.hasFocus())) {
        seenNotifIds.current.add(n.id)
        fireBrowserNotification('YatraFlow', n.text)
      } else {
        // Read elsewhere / already seen: record so a later unread flip of the
        // same row can't re-ping.
        seenNotifIds.current.add(n.id)
      }
    }
  }, [notifs, sessionUserId])

  return (
    <div className="app-shell">
      {/* Skip link (F-08): href="#main" would fight the hash router, so we
          preventDefault and focus <main> programmatically instead. */}
      <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus() }}>Skip to main content</a>
      {/* The topnav is the website's chrome. The signed-in Android shell hides
          it entirely - its controls (theme, notifications, account, feedback,
          creator hub, logout) relocate to the Profile page, reachable from the
          bottom nav. Signed-out users (login entry) and the web keep it. */}
      {(!isNative || !me) && (
      <nav className="topnav" aria-label="Site header">
        <div className="container topnav-inner">
          <a className="brand" {...appLink('/')} aria-label="YatraFlow home">
            <BrandMark size={32} />
            <span>Yatra<b style={{ color: 'var(--teal)' }}>Flow</b></span>
          </a>
          <PillNav activeKey={route} className="nav-links" aria-label="Primary">
            {me && <>
              <a className={`nav-link ${route === '/trips' ? 'active' : ''}`} data-pill-key="/trips" {...appLink('/trips')}>My trips</a>
              <a className={`nav-link ${route === CREATE_PATH ? 'active' : ''}`} data-pill-key={CREATE_PATH} {...appLink(CREATE_PATH)}>Plan a trip</a>
            </>}
            <a className={`nav-link ${route === '/explore' ? 'active' : ''}`} data-pill-key="/explore" {...appLink('/explore')}>Explore</a>
            {me?.profile.isCreator && (
              <a className={`nav-link ${route === '/creator-hub' ? 'active' : ''}`} data-pill-key="/creator-hub" {...appLink('/creator-hub')}>Creator hub</a>
            )}
          </PillNav>
        <div className="nav-right">
          {/* CTI control tray: icon controls live in one soft pill. Auth
              buttons stay outside it (they're wide, and logged-out mobile
              needs the width). Hamburger is ≤720px only (CSS-gated) and
              web-only — its tray below never mounts in the shell. */}
          <div className="nav-pill-group">
            {/* Web-only, like its tray below (`mobileNav && !isNative`): the
                signed-out shell keeps the topnav, and an ungated button there
                toggles state that renders nothing — a dead control. */}
            {!isNative && (
              <button
                className="mobile-nav-btn"
                onClick={() => setMobileNav(o => !o)}
                aria-label="Menu"
                aria-expanded={mobileNav}
                aria-controls="mobile-menu"
              >
                {mobileNav ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
              </button>
            )}

            <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle dark mode" title="Toggle dark mode">
              {dark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
            </button>
            {me && (
              <div style={{ position: 'relative' }} ref={notifRef}>
                  <button className="icon-btn" onClick={() => { syncNotifPos(); setNotifOpen(o => !o) }} aria-label={`Notifications (${unread} unread)`} aria-expanded={notifOpen} aria-controls="notif-pop">
                    <Bell size={18} aria-hidden />{unread > 0 && <span className="notif-badge">{unread}</span>}
                  </button>
              {notifOpen && createPortal(
                <div className="notif-pop popover" id="notif-pop" ref={notifPopRef} tabIndex={-1} style={{ top: notifPos.top, right: notifPos.right }}>
                  <div className="row-between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
                    <b>Notifications</b>
                    {unread > 0 && <button className="btn btn-ghost btn-sm" onClick={() => markAllNotificationsRead(me.id)}>Mark all read</button>}
                  </div>
                  <NotificationPanelContent
                    model={notificationPanel}
                    showAll={notifShowAll}
                    onRetry={retryNotifications}
                    onOpenTrip={tripId => { setNotifOpen(false); navigate(`/trip/${tripId}`) }}
                  />
                  {/* #84: the old panel truncated at 12 with no recovery path.
                      Honest count + in-place expansion; the list is already
                      fully loaded in the store, so this is pure disclosure. */}
                  {notifs.length > 12 && (
                    <button className="notif-showall" onClick={() => setNotifShowAll(v => !v)}>
                      {notifShowAll ? 'Show recent only' : `Show all ${notifs.length} notifications`}
                    </button>
                  )}
                </div>,
                document.body
              )}
            </div>
          )}
          {me && (
            <div style={{ position: 'relative' }} ref={menuRef}>
              <button className="avatar-btn" onClick={() => { syncMenuPos(); setMenuOpen(o => !o) }} aria-label="Account menu" aria-expanded={menuOpen} aria-controls="user-menu">
                <Avatar user={me} />
              </button>
              {menuOpen && createPortal(
                <div className="user-menu popover" id="user-menu" ref={userMenuRef} tabIndex={-1} style={{ top: menuPos.top, right: menuPos.right }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
                    <b>{me.profile.name}</b>
                    <div className="small muted">{me.email}</div>
                    {me.profile.isCreator && <span className="chip chip-saffron" style={{ marginTop: 6, display: 'inline-block' }}><Sparkles size={14} aria-hidden /> Creator</span>}
                  </div>
                  <button className="user-menu-item" onClick={() => { setMenuOpen(false); navigate('/profile') }}>Profile & settings</button>
                  <button className="user-menu-item" onClick={() => { setMenuOpen(false); navigate('/explore') }}>Explore itineraries</button>
                  <a className="user-menu-item" href={feedbackHref()} onClick={() => setMenuOpen(false)}><InlineIcon icon={Mail} size={14} gap={6} />Send feedback</a>
                  <button className="user-menu-item danger" onClick={() => { logout(); setMenuOpen(false); navigate('/') }}>Log out</button>
                </div>,
                document.body
              )}
            </div>
          )}
          </div>{/* /nav-pill-group */}
          {/* On the auth route the card below already offers both, as tabs plus
              a submit. Repeating them in the chrome gave the accent two owners
              on one screen — and two controls a screen apart that both said
              "Log in". */}
          {!me && !sessionUserId && parts[0] !== 'auth' && (
            <>
              <a className="btn btn-outline btn-sm" {...appLink('/auth')}>Log in</a>
              <a className="btn btn-primary btn-sm" {...appLink('/auth?mode=signup')}>Start planning free</a>
            </>
          )}
        </div>
      </div>
      </nav>
      )}

      {mobileNav && !isNative && (
        <div className="mobile-menu" id="mobile-menu" onClick={() => setMobileNav(false)}>
          {/* The hamburger tray is where Log in lives at the narrowest widths:
              the reflow rung (≤350px) hides the chrome pair from .nav-right so
              the primary CTA fits 320px, and this tray keeps Log in reachable
              (review finding 1). */}
          {!me && !sessionUserId && <a className="nav-link" {...appLink('/auth')}>Log in</a>}
          {me && <>
            <a className={`nav-link ${route === '/trips' ? 'active' : ''}`} {...appLink('/trips')}><InlineIcon icon={Tent} size={15} gap={6} />My trips</a>
            <a className={`nav-link ${route === CREATE_PATH ? 'active' : ''}`} {...appLink(CREATE_PATH)}><InlineIcon icon={Plus} size={15} gap={6} />Plan a trip</a>
          </>
          }
          <a className={`nav-link ${route === '/explore' ? 'active' : ''}`} {...appLink('/explore')}><InlineIcon icon={Compass} size={15} gap={6} />Explore</a>
          {me?.profile.isCreator && <a className={`nav-link ${route === '/creator-hub' ? 'active' : ''}`} {...appLink('/creator-hub')}><InlineIcon icon={Sparkles} size={15} gap={6} />Creator hub</a>}
          {me && <a className={`nav-link ${route === '/profile' ? 'active' : ''}`} {...appLink('/profile')}><InlineIcon icon={Settings} size={15} gap={6} />Profile & settings</a>}
        </div>
      )}

      {/* Offline state is global, so the strip lives in the shell rather than
          in any one page. It renders only while actually offline. */}
      <OfflineBanner />

      {/* A newer Android build, when the reviewed core finds one. Nonmodal and
          dismissible; it never takes focus and never blocks a tap. */}
      <UpdateNotice />

      <main id="main" tabIndex={-1} style={{ flex: 1 }}>
        {/* Route-change announcement (review finding 3): polite, off-screen,
            fed by the title effect above. The loading block carries role=status
            so the pre-hydrate gate announces itself too. */}
        <p className="sr-only" role="status" aria-live="polite">{routeAnnounce}</p>
        {/* keyed on the route so every page change (My trips ↔ Explore ↔ a trip)
            re-mounts and plays the route-panel entrance animation */}
        <div className="route-panel" key={routePanelKey}>{page}</div>
      </main>

      <footer className="footer">
        <svg className="footer-route-mark" viewBox="0 0 120 14" aria-hidden="true" focusable="false">
          <path d="M3 5.5C9 2 16 2 22 5.5S35 9 41 5.5S54 2 60 5.5S73 9 79 5.5S92 2 98 5.5S111 9 117 5.5" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeDasharray="3 3" />
          <circle cx="3" cy="5.5" r="3" fill="currentColor" />
          <circle cx="117" cy="5.5" r="3" fill="currentColor" />
        </svg>
        <div className="container footer-inner">
          <span><b>YatraFlow</b>: plan together, travel better. Built for Indian travellers</span>
          <span className="small muted">All costs are transparent estimates. No bookings — planning plus paid itinerary unlocks. <a className="footer-link" href={feedbackHref()}>Send feedback</a> · <a className="footer-link" href="/ladakh-trip-cost-calculator/">Ladakh trip cost calculator</a></span>
        </div>
      </footer>

      {/* The shell's primary navigation - same platform gate as the shell home
          above (isNative && me), so the website never renders it. It replaces
          the floating pill (hidden in the shell via CSS); the hamburger tray
          is web-only — its shell-side destinations are the four tabs, plus a
          Creator hub tab for a creator, or the relocated controls on Profile.
          A plain bar, not an overlay: registerAndroidBack above still closes
          only the real overlays, so back walks history while this is mounted. */}
      {isNative && me && <BottomNav route={route} onNavigate={navigate} isCreator={me.profile.isCreator} />}

      <ToastZone />
      {/* Web Analytics is a web concern: the Capacitor shell has no Vercel
          insights endpoint to reach, so the script would load and fail
          silently on Android. Mount it for the web app only. */}
      {!isNative && <Analytics beforeSend={analyticsBeforeSend} />}
    </div>
  )
}

/** Snapshot links (#/share/<payload>) land here: decode, preview, import as own copy. */
function SharedTripPage({ payload, onNavigate }: { payload: string; onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const profileState = profileLookupState(db.sessionUserId, !!me, db.sliceReads)
  const profileLookupPending = needsProfileLookup(db.sessionUserId, !!me, profileState)
  const [state, setState] = useState<
    { s: 'loading' } | { s: 'error' } | { s: 'ready'; name: string; days: number; destinations: string }
  >({ s: 'loading' })
  const [trip, setTrip] = useState<Trip | null>(null)
  // #551 — the copy a failed import built, held for a same-object retry: its
  // id is the idempotency key, so a first save that reached the server after
  // the client gave up is not followed by a twin (#374's rule).
  const [pendingImport, setPendingImport] = useState<Trip | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    decodeTripSnapshot(payload)
      .then(t => {
        if (cancelled) return
        setTrip(t)
        setState({ s: 'ready', name: t.name, days: t.days.length, destinations: t.destinations.join(' → ') })
      })
      .catch(() => { if (!cancelled) setState({ s: 'error' }) })
    return () => { cancelled = true }
  }, [payload])

  async function importIt() {
    if (!me) {
      if (!db.sessionUserId) onNavigate('/auth')
      return
    }
    if (!trip || importing) return
    setImporting(true)
    try {
      const retry = pendingImport
      if (retry) {
        // persistTrip has already said why the save failed; only the truth
        // navigates (#551).
        if (!await retryImportTrip(retry, me.id)) return
        setPendingImport(null)
      } else {
        const { trip: copy, persisted } = await importTripPersisted(trip, me.id)
        if (!persisted) { setPendingImport(copy); return }
      }
      toast('Snapshot imported - it is now in your trips')
      onNavigate('/trips')
    } finally {
      setImporting(false)
    }
  }

  /* The decode's own state. A snapshot travels inside the link, so a truncated
     link and a browser without DecompressionStream both land in `failed`. That
     is a different answer from "no trip", so the two never share a branch. */
  const snapshot = sharedSnapshotState({ loading: state.s === 'loading', failed: state.s === 'error', trip })

  if (snapshot === 'failed') {
    return (
      <div className="container yf-page page-enter">
        <StateBlock
          kind="failed"
          art={<Link2 size={38} aria-hidden />}
          title="This snapshot didn’t load"
          body="A snapshot travels inside the link itself, so this is usually a link that arrived truncated. Ask for a fresh one from the trip’s Share tab. Opening it in an up-to-date browser, which can unpack it, is worth a try too."
          actions={(
            <button className="btn btn-primary" onClick={() => onNavigate('/')}>Go home</button>
          )}
        />
      </div>
    )
  }

  if (snapshot === 'loading') {
    return (
      <div className="container yf-page page-enter">
        <StateBlock kind="loading" title="Opening the shared plan" />
      </div>
    )
  }

  return (
    <div className="container yf-page page-enter">
      <StateBlock
        kind="empty"
        art={<Luggage size={38} aria-hidden />}
        title={`Shared itinerary${state.s === 'ready' ? `: “${state.name}”` : ''}`}
        body={(
          <>
            {state.s === 'ready' && <p className="muted">{state.days}-day trip · {state.destinations}</p>}
            <p className="muted small">
              This whole plan is embedded in the link itself - nothing was stored on a server. The browser
              sends the page address only. The part after the <code>#</code> stays in your browser.
            </p>
            <p className="muted small">
              Anyone who holds the link can read the plan, and the sender cannot take the link back. The link is the
              only key. Importing it, forwarding it, or reporting a problem with the address in it all put the plan
              where you chose.
            </p>
            <p className="muted small">
              An older link put the plan in the page address instead. That one was sent on its first request, and a
              browser can repeat it in same-origin referrers while you stay here. Nothing in the app undoes that.
            </p>
            <p className="muted small">
              Import it to get your own editable copy{me || db.sessionUserId ? '' : ' (you will be asked to log in first)'}.
            </p>
          </>
        )}
        actions={profileLookupPending ? (
          <ProfileLookupNotice state={profileState} />
        ) : (
          <div className="inv-actions">
            <button className="btn btn-primary" onClick={importIt} disabled={importing} aria-busy={importing}><InlineIcon icon={Import} size={16} gap={6} vAlign="-3px" />{importing ? 'Importing…' : pendingImport ? 'Retry import' : me ? 'Import into my trips' : 'Log in & import'}</button>
            <button className="btn btn-outline" onClick={() => onNavigate('/')}>Not now</button>
          </div>
        )}
      />
    </div>
  )
}

/**
 * Invite links land here: resolve the code, require login, then join the trip
 * and open it. Accepts a short invite code ("GOA-K7QF", #/join/<code>) or a
 * legacy raw trip UUID (#/invite/<tripId>).
 *
 * The auth round-trip is the load-bearing part: the gate parked the invite in
 * `location.hash` and navigated to /auth with a `next` param. AuthPage sends
 * the user back here after login, so the join effect re-fires on the SAME
 * invite instead of dead-ending at My Trips.
 */
function InviteGate({ codeOrTripId, onNavigate }: { codeOrTripId: string; onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const profileState = profileLookupState(db.sessionUserId, !!me, db.sliceReads)
  // The invited trip is (by definition) not the viewer's yet, so the
  // membership-scoped hydration never loaded it - fetch it on demand. The
  // RPC fallback covers private trips: holding the link (the trip's UUID)
  // is the capability to preview it.
  // The resolved trip AND the link target that resolved it, in one value: a
  // failed resolve for a new target is a failed link, never the old trip.
  const [resolved, setResolved] = useState<{ target: string; trip: Trip | null } | null>(null)
  // #804 (B1) — 'joined-unloaded' and 'join-failed' are distinct outcomes of a
  // join, kept apart from 'broken' (the link read failed) and 'retired' (a
  // trip-id link for a non-member). Each offers a different remedy.
  // The gate's own read states. 'ready' means the code or UUID resolved to a
  // trip and the join machine owns everything from there (B2).
  const [status, setStatus] = useState<'loading' | 'broken' | 'retired' | 'ready'>('loading')
  // A dropped connection resolves to the same null as a dead code, so the
  // failure screen has to offer the one remedy that costs nothing: try again.
  const [retryTick, setRetryTick] = useState(0)
  // Keep the latest navigate callback in a ref so we don't re-fire effects
  // on every parent re-render.
  const navigateRef = useRef(onNavigate)
  useEffect(() => { navigateRef.current = onNavigate })
  const [mountId] = useState(nextAttemptId)
  const mountLeaseRef = useRef(0)
  // C2/R4 — the try lifetime lives outside React reset. A NEW try
  // retires the previous one before it allocates, and unmount retires the
  // current one. StrictMode's mount/cleanup/mount starts a fresh
  // try instead of leaving the gate dead.
  const lifetimeRef = useRef<AttemptOwner | null>(null)
  // #804 (round 10 B4) — a try belongs to ONE link target. The owner records
  // that target, so a completion for an older target can never settle, load or
  // navigate the trip that the new target resolved to.
  const beginAttempt = useCallback((target: string): AttemptOwner => {
    if (lifetimeRef.current) retireAttemptOwner(lifetimeRef.current)
    lifetimeRef.current = createAttemptOwner(target)
    return lifetimeRef.current
  }, [])
  useEffect(() => {
    mountLeaseRef.current += 1
    return () => {
      const cleanupLease = ++mountLeaseRef.current
      if (lifetimeRef.current) retireAttemptOwner(lifetimeRef.current)
      void Promise.resolve().then(() => {
        if (mountLeaseRef.current !== cleanupLease) return
        disposeGateMount(mountId)
      })
    }
  }, [mountId])
  // The link's own value, decoded once. A trip-id link (/invite/<uuid>) never
  // joins anyone: it opens the trip only for a viewer who is already a member.
  const linkTarget = (() => { try { return decodeURIComponent(codeOrTripId) } catch { return codeOrTripId } })()
  const isTripIdLink = UUID_RE.test(linkTarget)

  // #804 (round 10 B4) — the join state of THIS target lives in the gate's
  // store, read through `useSyncExternalStore` like the trip cache itself.
  // Asking for a new target retires the old try and resets the machine inside
  // that read, so no callback that runs before the next render can still act
  // for the old target, and React sees a plain external value.
  // Each MOUNT gets its own machine: the mount counter is module state, so two
  // mounts on the same link never share a try.
  const subscribeJoin = useCallback((fn: () => void) => subscribeGateState(fn), [])
  const readJoinVersion = useCallback(() => gateMachineVersion(linkTarget, mountId), [linkTarget, mountId])
  // The store's version is the change signal. The state below is read from the
  // same store, keyed by this target, so a new target reads ITS own machine.
  // A render HAPPENS on every change (React re-renders the subscriber), so the
  // value is read for its subscription only, never compared.
  const joinVersion = useSyncExternalStore(subscribeJoin, readJoinVersion, readJoinVersion)
  void joinVersion
  const joinStore = gateMachine(linkTarget, mountId)
  const machine = joinStore.machine
  const owner = joinStore.owner
  // The fields the effects act on, as plain values.
  const joinPhase = machine.phase
  const joinGen = machine.gen
  const joinUserId = machine.userId
  const joinTryId = machine.tryId
  const joinReason = machine.reason
  // `dispatch` is memoised per target, not per machine, so the effect that
  // dispatched does not run again by itself; the effects below depend on the
  // phase fields they act on, not on the machine object.
  const dispatch = useCallback((event: JoinEvent): JoinPlan => dispatchGateEvent(linkTarget, event, mountId), [linkTarget, mountId])
  const setOwner = useCallback((next: AttemptOwner | null) => setGateOwner(linkTarget, next, mountId), [linkTarget, mountId])
  // Only a trip this target resolved counts, so a target change needs no reset.
  const shownTrip: Trip | null = resolved && resolved.target === linkTarget ? resolved.trip : null


  // Resolve the code/UUID to a trip, once per link target. A hydration can
  // evict the fetched trip from the cache (fetchSharedTrip merges it, the
  // next full hydrate may drop it), so `trip` lives in local state, not the
  // cache - the gate must survive re-hydrations without refetching.
  // decodeURIComponent first: the landing page's code box navigates with
  // encodeURIComponent, and a code typed with a space would otherwise arrive
  // as a %20 inside the segment.
  useEffect(() => {
    let alive = true
    const resolve = isTripIdLink
      ? fetchSharedTrip(linkTarget, true)
      : fetchTripByInviteCode(linkTarget)
    void resolve.then(t => {
      if (!alive) return
      // B2 — a successful resolve MUST leave the loading status. It was only ever
      // set on failure, so every later branch (the three join screens, the retry
      // buttons, the signed-out preview) fell through to the 'loading' render and
      // was unreachable. The read succeeded, so the gate says ready and the join
      // machine drives from there.
      if (t) { setResolved({ target: linkTarget, trip: t }); setStatus('ready') }
      else { setResolved({ target: linkTarget, trip: null }); setStatus('broken') }
    })
    return () => { alive = false }
  }, [linkTarget, isTripIdLink, retryTick])

  // #804 — the join flow owns its state in ONE place (the machine above). This
  // component dispatches events and renders the phase. Every continuation quotes
  // the try id, identity and target it started with, and the machine ignores it
  // unless they still match.
  const identityGen = useIdentityGeneration()
  const phase = machine.phase

  // Reset stale identity state before the begin effect can allocate a new owner.
  // Cleanup is scoped to this machine's owner so an old render cannot retire its replacement.
  useEffect(() => {
    if (joinUserId === null || (joinGen === identityGen && me && me.id === joinUserId)) return
    if (owner && joinStore.owner === owner) {
      retireAttemptOwner(owner)
      if (lifetimeRef.current === owner) lifetimeRef.current = null
      setOwner(null)
    }
    dispatch({ type: 'reset' })
  }, [identityGen, joinGen, joinUserId, me, owner, joinStore, dispatch, setOwner])

  /** Carry out one action from the machine. Every settlement quotes its try and
   *  its target, so a completion for an older target does nothing at all. */
  const runJoinAction = useCallback((action: JoinAction, tripId: string, userId: string, gen: number, attempt: AttemptOwner, inviteCode?: string) => {
    if (action.type === 'none') return
    // C2 — a retired try does nothing: no dispatch, no effects, no settle.
    if (!attemptOwnerLive(attempt)) return
    setOwner(attempt)
    const tryId = action.tryId
    const settle = (kind: 'join-settled' | 'reload-settled', result: JoinResult) => {
      // The try STAYS the owner after it settles: the navigation effect checks
      // that the joined state belongs to a live try. A retry or a target change
      // retires it, and that is what clears the claim.
      if (!attemptOwnerLive(attempt)) return
      dispatch({ type: kind, userId, gen, tryId, result })
    }
    if (action.type === 'reload') {
      const guard = () => attemptOwnerLive(attempt)
      void reloadJoinedTrip(tripId, guard).then(
        result => settle('reload-settled', result),
        error => {
          // A rejected read is a read failure, not a membership claim.
          console.error('[yatraflow] reload after join rejected', error)
          settle('reload-settled', 'failed')
        },
      )
      return
    }
    const guard = () => attemptOwnerLive(attempt)
    void joinViaInvite(tripId, userId, inviteCode ?? '', guard).then(
      result => settle('join-settled', result),
      error => {
        console.error('[yatraflow] join rejected', error)
        settle('join-settled', 'failed')
      },
    )
  }, [dispatch, setOwner])

  useEffect(() => {
    if (!me || !shownTrip) return
    if (joinUserId !== null && (joinGen !== identityGen || joinUserId !== me.id)) return
    // B-2 — a legacy /invite/<uuid> link never joins. The separate
    // viewerIsMemberOf effect below opens the trip for a member and explains
    // itself to anyone else. Without this guard the join ran with the UUID as
    // the invite code, which the server cannot resolve.
    if (isTripIdLink) return
    // B-1 — membership is decided BEFORE the machine is told to begin, and the
    // machine returns the right action from that one event. Dispatching 'begin'
    // and then correcting it with a second event is what hung a member on
    // "Joining…": the correction arrived while the machine was already 'joining'
    // and was refused.
    const cached = tripById(shownTrip.id)
    const member = !!(cached ?? shownTrip).members?.some(m => m.userId === me.id)
    // B2 — ask the machine FIRST. A profile-object refresh re-runs this effect
    // with the same account, and the machine answers 'none'; retiring the pending
    // owner for a no-op is what left the gate stuck on "Joining…".
    const probe = joinMachine({ phase: joinPhase, userId: joinUserId, gen: joinGen, tryId: joinTryId, reason: joinReason }, { type: 'begin', userId: me.id, gen: identityGen, member })
    if (probe.action.type === 'none') return
    const attempt = beginAttempt(linkTarget)
    const plan = dispatch({ type: 'begin', userId: me.id, gen: identityGen, member, tryId: attempt.id })
    if (plan.action.type === 'none') return
    runJoinAction(plan.action, shownTrip.id, me.id, identityGen, attempt, shownTrip.inviteCode ?? linkTarget)
  }, [me, shownTrip, identityGen, isTripIdLink, linkTarget, joinPhase, joinGen, joinUserId, joinTryId, joinReason, dispatch, runJoinAction, beginAttempt])

  // B1 — a retry executes exactly one action HERE, from the action the machine
  // returned. The old code dropped it and waited for the effect to notice, so the
  // next 'begin' answered 'none' and no second join ever ran.
  const retryJoin = useCallback(() => {
    if (!me || !shownTrip) return
    // Membership is re-read at the moment of the retry: the user may have been
    // added by someone else between the failure and the click.
    const cached = tripById(shownTrip.id)
    const member = !!(cached ?? shownTrip).members?.some(m => m.userId === me.id)
    // B2 — the same probe-before-allocate rule as the begin effect.
    const probe = joinMachine({ phase: joinPhase, userId: joinUserId, gen: joinGen, tryId: joinTryId, reason: joinReason }, { type: 'retry', userId: me.id, gen: identityGen, member })
    if (probe.action.type === 'none') return
    const attempt = beginAttempt(linkTarget)
    const plan = dispatch({ type: 'retry', userId: me.id, gen: identityGen, member, tryId: attempt.id })
    if (plan.action.type === 'none') return
    runJoinAction(plan.action, shownTrip.id, me.id, identityGen, attempt, shownTrip.inviteCode ?? linkTarget)
  }, [me, shownTrip, joinPhase, joinGen, joinUserId, joinTryId, joinReason, identityGen, linkTarget, beginAttempt, dispatch, runJoinAction])

  // A trip-id link never joins. It opens the trip for a member and explains
  // itself to anyone else. Guarded by identity so a late answer cannot navigate
  // the new account (N1).
  useEffect(() => {
    if (!me || !shownTrip || !isTripIdLink) return
    let alive = true
    const gen = identityGen
    const target = linkTarget
    // B4 — the UUID path is a lifetime too. Allocate an owner so its async
    // membership answer is checked against something, instead of being dropped.
    const attempt = beginAttempt(target)
    void viewerIsMemberOf(shownTrip.id, me.id).then(isMember => {
      // The callback compares against the target its OWN effect captured, and
      // the try it holds, so nothing else is read here.
      if (!alive || gen !== identityGen || !attemptOwnerLive(attempt) || attempt.target !== target) return
      if (isMember) navigateRef.current(`/trip/${shownTrip.id}`)
      else setStatus('retired')
    })
    return () => { alive = false }
  }, [me, shownTrip, isTripIdLink, identityGen, beginAttempt, linkTarget])

  // The trip opens only from the machine's 'joined' phase, and only while the
  // try that opened THIS target is still live. A target change retires that try
  // in the store, so an old join can never authorize a newly resolved trip.
  useEffect(() => {
    if (!shownTrip || !me) return
    if (!ownedBy(owner, linkTarget)) return
    if (!joinAllowsNavigation(machine)) return
    if (joinUserId !== me.id || joinGen !== identityGen) return
    toast(`You’re on “${shownTrip.name}” - happy planning!`)
    navigateRef.current(`/trip/${shownTrip.id}`)
  }, [joinPhase, joinGen, joinUserId, me, shownTrip, identityGen, linkTarget, owner, machine])
  /* The gate's own state. A read that failed and a link that is dead are
     different answers, and the code below never shows one as the other. */
  const gate = inviteGateState({ loading: status === 'loading' || !shownTrip, failed: status === 'broken', trip: shownTrip })

  if (status === 'retired') {
    return (
      <div className="container yf-page page-enter">
        <StateBlock
          kind="empty"
          art={<Link2 size={38} aria-hidden />}
          title="This invite link is retired"
          body="Ask the trip owner for a fresh invite link."
          actions={(
            <button className="btn btn-outline" onClick={() => onNavigate('/')}>Go home</button>
          )}
        />
      </div>
    )
  }

  if (gate === 'failed') {
    return (
      <div className="container yf-page page-enter">
        <StateBlock
          kind="failed"
          art={<Link2 size={38} aria-hidden />}
          title="This invite didn’t load"
          body="The connection may have dropped, so the link may still be good. Ask the organiser for a fresh link, or try again."
          actions={(
            <div className="inv-actions">
              <button className="btn btn-primary" onClick={() => { setStatus('loading'); setRetryTick(t => t + 1) }}>Try again</button>
              <button className="btn btn-outline" onClick={() => onNavigate('/')}>Go home</button>
            </div>
          )}
        />
      </div>
    )
  }

  if (gate === 'expired') {
    return (
      <div className="container yf-page page-enter">
        <StateBlock
          kind="empty"
          art={<Link2 size={38} aria-hidden />}
          title="This invite is no longer active"
          body="The code may be mistyped or no longer active. Ask the organiser for a fresh link."
          actions={(
            <div className="inv-actions">
              <button className="btn btn-primary" onClick={() => { setStatus('loading'); setRetryTick(t => t + 1) }}>Try again</button>
              <button className="btn btn-outline" onClick={() => onNavigate('/')}>Go home</button>
            </div>
          )}
        />
      </div>
    )
  }

  if (gate === 'loading') {
    return (
      <div className="container yf-page page-enter">
        <StateBlock kind="loading" title={phase === 'joining' && shownTrip ? `Joining “${shownTrip.name}”…` : 'Opening invite…'} />
      </div>
    )
  }

  // #804 (B1) — joined, but the plan did not load. The user IS a member; only
  // the page read failed. Retry re-reads the row and never joins again.
  if (phase === 'joined-unloaded') {
    // The membership exists; only the row could not be read. An unusable row
    // and a failed read are different answers, so the copy names which one.
    const incomplete = machine.reason === 'incomplete'
    return (
      <div className="container yf-page page-enter">
        <StateBlock
          kind="failed"
          art={<Link2 size={38} aria-hidden />}
          title={`You joined “${shownTrip?.name ?? 'this trip'}”`}
          body={incomplete
            ? 'The plan arrived in a form this screen cannot trust, so it was not opened. You are on the crew, so this is a read problem, not a join problem. Try again, or open it from My trips.'
            : 'The plan did not load. You are on the crew, so this is a read problem, not a join problem. Try again, or open it from My trips.'}
          actions={(
            <div className="inv-actions">
              <button className="btn btn-primary" onClick={retryJoin}>Try again</button>
              <button className="btn btn-outline" onClick={() => onNavigate('/trips')}>Go to My trips</button>
            </div>
          )}
        />
      </div>
    )
  }

  // #804 (B1/B5) — the join itself failed, so no membership exists. The typed
  // refusal stays distinct, so the screen names the actual remedy instead of
  // calling every outcome a dropped connection.
  if (phase === 'failed') {
    const refusal = machine.reason
    const copy = refusal === 'not-member'
      ? {
          title: 'This account is not on the trip',
          body: 'This invite opened a trip that is not shared with this account. Ask the organiser to invite this account, or log in with the account that was invited.',
        }
      : refusal === 'missing'
        ? {
            title: 'This trip is not available',
            body: 'The invite is valid, but its trip could not be found. Ask the organiser for a fresh link.',
          }
        : refusal === 'deleted'
          ? {
              title: 'This trip was deleted',
              body: 'The organiser deleted this trip, so the invite can no longer open it. Ask them to create a new trip and invite you again.',
            }
          : {
              title: 'Couldn’t join just now',
              body: 'The link may still be good — a dropped connection looks the same as a refused join. Try again, or ask the organiser for a fresh link.',
            }
    return (
      <div className="container yf-page page-enter">
        <StateBlock
          kind="failed"
          art={<Link2 size={38} aria-hidden />}
          title={copy.title}
          body={copy.body}
          actions={(
            <div className="inv-actions">
              <button className="btn btn-primary" onClick={retryJoin}>Try again</button>
              <button className="btn btn-outline" onClick={() => onNavigate('/')}>Go home</button>
            </div>
          )}
        />
      </div>
    )
  }

  // B-3 — the join was cut short by an account or access change, so this client
  // cannot say whether the membership exists. Saying "you joined" would be a
  // guess and saying "you did not join" would be a different guess, so the copy
  // says exactly what is known. Without this branch the screen fell through to
  // the "Opening invite…" spinner with no way out.
  if (phase === 'abandoned') {
    return (
      <div className="container yf-page page-enter">
        <StateBlock
          kind="failed"
          art={<Link2 size={38} aria-hidden />}
          title="We couldn’t confirm the join"
          body="Your account changed while we were joining, so we can’t tell whether it worked. Try again, or open My trips to check."
          actions={(
            <div className="inv-actions">
              <button className="btn btn-primary" onClick={retryJoin}>Try again</button>
              <button className="btn btn-outline" onClick={() => onNavigate('/trips')}>Go to My trips</button>
            </div>
          )}
        />
      </div>
    )
  }

  if (!me) {
    // The state rides the gate, so a stale private row cannot settle a lookup
    // whose latest read failed — the notice and its retry stay reachable.
    if (needsProfileLookup(db.sessionUserId, !!me, profileState)) {
      return (
        <div className="container yf-page page-enter">
          <StateBlock
            kind="empty"
            art={<Mail size={38} aria-hidden />}
            title={`You’ve been invited to “${invitePreview(shownTrip ?? { name: '' }).name}”`}
            actions={<ProfileLookupNotice state={profileState} />}
          />
        </div>
      )
    }
    // Park the invite in the URL and bounce through auth with a next param -
    // the old buttons went to plain /auth, and AuthPage's post-login redirect
    // to /trips dropped the invite entirely: users logged in, landed on My
    // Trips, and the trip never appeared.
    // The preview below reads only what the gate already holds. No field is
    // fetched a second time to fill it in.
    const preview = invitePreview(shownTrip ?? { name: '' })
    return (
      <div className="container yf-page page-enter">
        <StateBlock
          kind="empty"
          art={<Mail size={38} aria-hidden />}
          title={`You’ve been invited to “${preview.name}”`}
          body={(
            <>
              <p className="muted">Log in or create a free account to join the planning crew.</p>
              <dl className="inv-preview">
                {preview.route && (
                  <div className="inv-preview-row">
                    <dt>Route</dt>
                    <dd>{preview.route}</dd>
                  </div>
                )}
                {preview.dates && (
                  <div className="inv-preview-row">
                    <dt>Dates</dt>
                    <dd>{preview.dates}</dd>
                  </div>
                )}
                <div className="inv-preview-row">
                  <dt>Crew</dt>
                  <dd>{preview.memberCount} {preview.memberCount === 1 ? 'planner' : 'planners'}</dd>
                </div>
              </dl>
            </>
          )}
          actions={(
            <div className="inv-actions">
              {/* The `next` round-trip is load-bearing: it parks this invite so
                  AuthPage returns here after login. The route and its encoding
                  come from inviteLoginNext and inviteSignupNext, and the
                  navigation calls below stay exactly as they were. */}
              <button className="btn btn-outline" onClick={() => onNavigate(inviteLoginNext(codeOrTripId, isTripIdLink))}>Log in</button>
              <button className="btn btn-primary" onClick={() => onNavigate(inviteSignupNext(codeOrTripId, isTripIdLink))}>Create account</button>
            </div>
          )}
        />
      </div>
    )
  }

  return (
    <div className="container yf-page page-enter">
      <StateBlock kind="loading" title={phase === 'joining' && shownTrip ? `Joining “${shownTrip.name}”…` : 'Opening invite…'} />
    </div>
  )
}

/** Raw trip UUIDs (legacy #/invite/<id> links) vs short invite codes. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
