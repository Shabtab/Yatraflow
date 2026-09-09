// ============ YatraFlow app shell ============
// Hash-based routing so the built app works from any static host or file://.
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  Bell, Compass, Import, Inbox, Luggage, Link2, Mail, Menu, Moon, Plus,
  Settings, Sparkles, Sun, Tent, X,
} from 'lucide-react'
import type { Trip } from './data/types'
import { useDb, currentUser, useUsers, useNotifications, useSessionUserId, logout, markAllNotificationsRead, tripById, joinViaInvite, duplicateTrip, init, useStoreReady, fetchSharedTrip, fetchTripByInviteCode } from './store/store'
import { Avatar, BrandMark, ToastZone, useClickOutside, toast } from './components/ui'
import { PillNav } from './components/PillNav'
import { decodeTripSnapshot } from './lib/snapshot'
import { scrollBehavior } from './lib/motion'
import { LandingPage } from './pages/Landing'
// Route-level code splitting: only the landing page stays in the main chunk (it
// is the app's front door and reads no store data); every other route —
// including the workspace and its map/editor subtree — loads on first visit.
const TripsListPage = lazy(() => import('./pages/TripsList').then(m => ({ default: m.TripsListPage })))
const TripWorkspace = lazy(() => import('./pages/TripWorkspace').then(m => ({ default: m.TripWorkspace })))
const ExplorePage = lazy(() => import('./pages/Explore').then(m => ({ default: m.ExplorePage })))
const AuthPage = lazy(() => import('./pages/Auth').then(m => ({ default: m.AuthPage })))
const CreateTripPage = lazy(() => import('./pages/CreateTrip').then(m => ({ default: m.CreateTripPage })))
const PublicItineraryPage = lazy(() => import('./pages/PublicItinerary').then(m => ({ default: m.PublicItineraryPage })))
const ProfilePage = lazy(() => import('./pages/Profile').then(m => ({ default: m.ProfilePage })))
const CreatorPage = lazy(() => import('./pages/CreatorPage').then(m => ({ default: m.CreatorPage })))
// Gated route: only shown in the nav when the account has creator mode on.
const CreatorHubPage = lazy(() => import('./pages/CreatorHubPage').then(m => ({ default: m.CreatorHubPage })))
// Masteradmin console: JWT app_metadata role only (never linked anywhere —
// admins type #/admin; non-admins fall through to landing inside the page).
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })))

/** Suspense fallback for the lazy routes — the same loading block the ready-gate shows. */
const lazyRouteFallback = <div className="container loading-block"><div className="spinner" />Loading…</div>

function currentRoute(): string {
  return location.hash.replace(/^#/, '') || '/'
}

export default function App() {
  // Slice subscriptions: the shell re-renders only when profiles, the session
  // or notifications change — a trip edit no longer re-renders the entire
  // page tree through App.
  const users = useUsers()
  const sessionUserId = useSessionUserId()
  const notifications = useNotifications()
  // Same semantics as currentUser(): the profile whose id matches sessionUserId.
  const me = useMemo(() => users.find(u => u.id === sessionUserId) ?? null, [users, sessionUserId])
  const [route, setRoute] = useState(currentRoute)
  const [dark, setDark] = useState(() => localStorage.getItem('yatraflow_theme') === 'dark')
  const [notifOpen, setNotifOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [notifRef, notifPopRef] = useClickOutside(() => setNotifOpen(false))
  const [menuRef, userMenuRef] = useClickOutside(() => setMenuOpen(false))
  // Both popovers portal to document.body: nested inside .topnav (which has
  // its own backdrop-filter), their backdrop blur would only sample the nav's
  // own interior — the page behind stayed sharp. Portaled panels need
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
    const onHash = () => { setRoute(currentRoute()); setMobileNav(false); window.scrollTo({ top: 0, behavior: scrollBehavior() }) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Boot the store once: subscribes to Supabase auth changes and hydrates the
  // session's data into the cache. Without this, `me` stays null forever and
  // every route falls through to the landing page. Idempotent inside the store.
  useEffect(() => { init() }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem('yatraflow_theme', dark ? 'dark' : 'light')
    // Keep the browser chrome (address bar) in step with the explicit toggle —
    // the two media-scoped <meta name="theme-color"> tags only react to the
    // OS preference, not to this in-app switch.
    document.querySelectorAll('meta[name="theme-color"]').forEach(m =>
      m.setAttribute('content', dark ? '#0C1420' : '#FAF7F2'))
  }, [dark])

  // Theme radiate via View Transitions — the real UI morphs in both themes.
  // Two hard-won rules make this flawless:
  //  1. Suppress backdrop-filter for the transition's lifetime: Chromium
  //     renders glass inside VT snapshots WITHOUT its backdrop, so any glass
  //     layer turns the captured page into a flat gray veil. Unblurred glass
  //     for ~600ms is imperceptible; the veil is not.
  //  2. Drive the clip-path from CSS keyframes selected by a class that is set
  //     BEFORE startViewTransition — the animation exists from the snapshot
  //     tree's first frame (no JS-attach gap → no pre-flash) and `fill: both`
  //     holds the end state until teardown (no end flash).
  // Dark → light: the new light view radiates OUT of the icon (slow → zap).
  // Light → dark: the old light view collapses INTO the icon (fast → settle).
  // The landing page runs continuous CSS animations (atmosphere blobs, route
  // line draw, ticker, odometer). A full-page View-Transition snapshots the DOM,
  // so all of that scenery visibly freezes for the ~700 ms the snapshot plays.
  // Swap instantly there — no radiate — keeping the homepage alive; the radiate
  // stays for the calmer in-app pages. (Also fixes the mobile eruption point,
  // which was only ever observed on the landing route.)
  function toggleTheme(e: MouseEvent<HTMLButtonElement>) {
    // Landing page: skip View Transition entirely to avoid freezing continuous CSS animations
    if (route === '/' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDark(d => !d); return
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
      setDark(d => !d); return
    }
    const vt = doc.startViewTransition(() => setDark(d => !d))
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
  // menu items themselves — all leave the trigger as the right landing spot).
  const prevNotifOpen = useRef(false)
  const prevMenuOpen = useRef(false)
  useEffect(() => {
    if (prevNotifOpen.current && !notifOpen) notifRef.current?.focus({ preventScroll: true })
    prevNotifOpen.current = notifOpen
    if (prevMenuOpen.current && !menuOpen) menuRef.current?.focus({ preventScroll: true })
    prevMenuOpen.current = menuOpen
  }, [notifOpen, menuOpen, notifRef, menuRef])

  // Escape closes any open popover (UI audit F-10) — outside-click alone
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
    location.hash = to
  }

  // route shapes: /, /auth, /trips, /new, /trip/:id, /explore, /pub/:slug, /creator/:id, /creator-hub, /join/:code, /invite/:tripId (legacy), /admin, /share/<payload>, /profile
  // Query strings (e.g. /auth?mode=signup) ride on parts[0]; strip them so the
  // segment still matches the switch. Pages read their own params from location.hash.
  const parts = route.split('/').filter(Boolean).map(s => s.split('?')[0])
  let page: React.ReactNode

  // Before the first hydrate settles, every "empty" is a lie: a deep link to
  // #/trip/... used to flash Landing, "No trips yet" rendered before data, and
  // invite links showed "broken" mid-load. One gate at the router fixes all
  // three — auth and share links don't read the cache, so they stay live.
  // The landing route stays live too: LandingPage (and the Plan Bench inside
  // it) never reads the store, and route "/" renders LandingPage after the
  // gate regardless of who is signed in — so rendering it immediately shows
  // exactly what the post-gate frame would be, instead of a spinner that
  // swaps to the full page (the landing load shift, Lighthouse CLS 0.997).
  const ready = useStoreReady()
  const bareRoute = parts[0] === undefined || parts[0] === ''
  if (!ready && parts[0] !== 'auth' && parts[0] !== 'share' && !bareRoute) {
    page = <div className="container loading-block"><div className="spinner" />Loading…</div>
  } else if (parts[0] === 'share' && parts[1]) {
    page = <SharedTripPage payload={parts[1]} onNavigate={navigate} />
  } else if (parts[0] === 'join' && parts[1]) {
    page = <InviteGate codeOrTripId={parts[1]} onNavigate={navigate} />
  } else if (parts[0] === 'invite' && parts[1]) {
    // Legacy UUID links (#/invite/<tripId>) from before invite codes shipped.
    // Keep working: the gate accepts a raw trip id too.
    page = <InviteGate codeOrTripId={parts[1]} onNavigate={navigate} />
  } else if (!me) {
    // public pages stay accessible logged-out; everything else funnels to auth/landing
    if (parts[0] === 'pub' && parts[1]) page = <Suspense fallback={lazyRouteFallback}><PublicItineraryPage slug={parts[1]} onNavigate={navigate} /></Suspense>
    else if (parts[0] === 'creator' && parts[1]) page = <Suspense fallback={lazyRouteFallback}><CreatorPage creatorId={parts[1]} onNavigate={navigate} /></Suspense>
    else if (parts[0] === 'explore') page = <Suspense fallback={lazyRouteFallback}><ExplorePage onNavigate={navigate} /></Suspense>
    else if (parts[0] === 'auth') page = <Suspense fallback={lazyRouteFallback}><AuthPage onNavigate={navigate} /></Suspense>
    else page = <LandingPage onNavigate={navigate} />
  } else {
    switch (parts[0]) {
      case undefined:
      case '':
        page = <LandingPage onNavigate={navigate} />
        break
      case 'trips':
        page = <Suspense fallback={lazyRouteFallback}><TripsListPage onNavigate={navigate} /></Suspense>
        break
      case 'new':
        page = <Suspense fallback={lazyRouteFallback}><CreateTripPage onNavigate={navigate} /></Suspense>
        break
      case 'trip':
        page = <Suspense fallback={lazyRouteFallback}><TripWorkspace tripId={parts[1] ?? ''} initialTab={parts[2]} onNavigate={navigate} /></Suspense>
        break
      case 'explore':
        page = <Suspense fallback={lazyRouteFallback}><ExplorePage onNavigate={navigate} /></Suspense>
        break
      case 'pub':
        page = <Suspense fallback={lazyRouteFallback}><PublicItineraryPage slug={parts[1] ?? ''} onNavigate={navigate} /></Suspense>
        break
      case 'creator':
        page = <Suspense fallback={lazyRouteFallback}><CreatorPage creatorId={parts[1] ?? ''} onNavigate={navigate} /></Suspense>
        break
      case 'profile':
        page = <Suspense fallback={lazyRouteFallback}><ProfilePage onNavigate={navigate} /></Suspense>
        break
      case 'creator-hub':
        page = <Suspense fallback={lazyRouteFallback}><CreatorHubPage onNavigate={navigate} /></Suspense>
        break
      case 'auth':
        // A logged-in user landing on /auth (e.g. right after the invite
        // round-trip's login submit) used to fall to `default:` → Landing,
        // and AuthPage — whose me-effect performs the post-login redirect —
        // never mounted, stranding the user on the landing page with the
        // invite lost. Mount it; the effect sends them on to `next` (or /trips).
        page = <Suspense fallback={lazyRouteFallback}><AuthPage onNavigate={navigate} /></Suspense>
        break
      // Masteradmin console — intentionally unlinked (no nav pill anywhere):
      // admins type #/admin; AdminPage itself falls through to Landing for
      // non-admins (the JWT role is the gate, the route existing is not).
      case 'admin':
        page = <Suspense fallback={lazyRouteFallback}><AdminPage onNavigate={navigate} /></Suspense>
        break
      default:
        page = <LandingPage onNavigate={navigate} />
    }
  }

  // Same filter+sort as notificationsFor(), but derived from the subscribed
  // notifications slice so the bell stays live without a full-cache subscription.
  const notifs = useMemo(
    () => sessionUserId
      ? notifications.filter(n => n.userId === sessionUserId).sort((a, b) => b.at - a.at)
      : [],
    [notifications, sessionUserId],
  )
  const unread = notifs.filter(n => !n.read).length

  return (
    <div className="app-shell">
      {/* Skip link (F-08): href="#main" would fight the hash router, so we
          preventDefault and focus <main> programmatically instead. */}
      <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus() }}>Skip to main content</a>
      <nav className="topnav">
        <div className="container topnav-inner">
          <a className="brand" href="#/" aria-label="YatraFlow home">
            <BrandMark size={32} />
            <span>Yatra<b style={{ color: 'var(--teal)' }}>Flow</b></span>
          </a>
          <PillNav activeKey={route} className="nav-links" role="navigation" aria-label="Primary">
            {me && <>
              <a className={`nav-link ${route === '/trips' ? 'active' : ''}`} data-pill-key="/trips" href="#/trips">My trips</a>
              <a className={`nav-link ${route === '/new' ? 'active' : ''}`} data-pill-key="/new" href="#/new">Plan a trip</a>
            </>}
            <a className={`nav-link ${route === '/explore' ? 'active' : ''}`} data-pill-key="/explore" href="#/explore">Explore</a>
            {me?.profile.isCreator && (
              <a className={`nav-link ${route === '/creator-hub' ? 'active' : ''}`} data-pill-key="/creator-hub" href="#/creator-hub">Creator hub</a>
            )}
          </PillNav>
        <div className="nav-right">
          {/* CTI control tray: icon controls live in one soft pill. Auth
              buttons stay outside it (they're wide, and logged-out mobile
              needs the width). Hamburger is ≤720px only (CSS-gated). */}
          <div className="nav-pill-group">
            <button
              className="mobile-nav-btn"
              onClick={() => setMobileNav(o => !o)}
              aria-label="Menu"
              aria-expanded={mobileNav}
              aria-controls="mobile-menu"
            >
              {mobileNav ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
            </button>

            <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle dark mode" title="Toggle dark mode">
              {dark ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
            </button>
            {me && (
              <div style={{ position: 'relative' }} ref={notifRef}>
                  <button className="icon-btn" onClick={() => { syncNotifPos(); setNotifOpen(o => !o) }} aria-label={`Notifications (${unread} unread)`} aria-expanded={notifOpen} aria-controls="notif-pop">
                    <Bell size={18} aria-hidden />{unread > 0 && <span className="notif-badge">{unread}</span>}
                  </button>
              {notifOpen && createPortal(
                <div className="notif-pop" id="notif-pop" ref={notifPopRef} tabIndex={-1} style={{ top: notifPos.top, right: notifPos.right }}>
                  <div className="row-between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
                    <b>Notifications</b>
                    {unread > 0 && <button className="btn btn-ghost btn-sm" onClick={() => markAllNotificationsRead(me.id)}>Mark all read</button>}
                  </div>
                  <div style={{ maxHeight: 320, overflowY: 'auto', overscrollBehavior: 'contain' }}>
                    {notifs.length === 0 && (
                      <p className="muted small" style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Inbox size={14} aria-hidden />You’re all caught up
                      </p>
                    )}
                    {notifs.slice(0, 12).map(n => (
                      <div key={n.id} className={`notif-item ${n.read ? '' : 'unread'}`}>
                        <span>{n.text}</span>
                        {n.tripId && <button className="btn btn-ghost btn-sm" onClick={() => { setNotifOpen(false); navigate(`/trip/${n.tripId}`) }}>View →</button>}
                      </div>
                    ))}
                  </div>
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
                <div className="user-menu" id="user-menu" ref={userMenuRef} tabIndex={-1} style={{ top: menuPos.top, right: menuPos.right }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
                    <b>{me.profile.name}</b>
                    <div className="small muted">{me.email}</div>
                    {me.profile.isCreator && <span className="chip chip-saffron" style={{ marginTop: 6, display: 'inline-block' }}><Sparkles size={14} aria-hidden /> Creator</span>}
                  </div>
                  <button className="user-menu-item" onClick={() => { setMenuOpen(false); navigate('/profile') }}>Profile & settings</button>
                  <button className="user-menu-item" onClick={() => { setMenuOpen(false); navigate('/explore') }}>Explore itineraries</button>
                  <button className="user-menu-item danger" onClick={() => { logout(); setMenuOpen(false); navigate('/') }}>Log out</button>
                </div>,
                document.body
              )}
            </div>
          )}
          </div>{/* /nav-pill-group */}
          {!me && (
            <>
              <a className="btn btn-outline btn-sm" href="#/auth">Log in</a>
              <a className="btn btn-primary btn-sm" href="#/auth?mode=signup">Sign up free</a>
            </>
          )}
        </div>
      </div>
      </nav>

      {mobileNav && (
        <div className="mobile-menu" id="mobile-menu" onClick={() => setMobileNav(false)}>
          {me && <>
            <a className={`nav-link ${route === '/trips' ? 'active' : ''}`} href="#/trips"><Tent size={15} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />My trips</a>
            <a className={`nav-link ${route === '/new' ? 'active' : ''}`} href="#/new"><Plus size={15} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />Plan a trip</a>
          </>
          }
          <a className={`nav-link ${route === '/explore' ? 'active' : ''}`} href="#/explore"><Compass size={15} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />Explore</a>
          {me?.profile.isCreator && <a className={`nav-link ${route === '/creator-hub' ? 'active' : ''}`} href="#/creator-hub"><Sparkles size={15} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />Creator hub</a>}
          {me && <a className={`nav-link ${route === '/profile' ? 'active' : ''}`} href="#/profile"><Settings size={15} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />Profile & settings</a>}
        </div>
      )}

      <main id="main" tabIndex={-1} style={{ flex: 1 }}>
        {/* keyed on the route so every page change (My trips ↔ Explore ↔ a trip)
            re-mounts and plays the route-panel entrance animation */}
        <div className="route-panel" key={route}>{page}</div>
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <span><b>YatraFlow</b> — plan together, travel better. Built for Indian travellers</span>
          <span className="small muted">All costs are transparent estimates · No bookings, no payments — planning only</span>
        </div>
      </footer>

      <ToastZone />
    </div>
  )
}

/** Snapshot links (#/share/<payload>) land here: decode, preview, import as own copy. */
function SharedTripPage({ payload, onNavigate }: { payload: string; onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const [state, setState] = useState<
    { s: 'loading' } | { s: 'error' } | { s: 'ready'; name: string; days: number; destinations: string }
  >({ s: 'loading' })
  const [trip, setTrip] = useState<Trip | null>(null)

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

  function importIt() {
    if (!trip || !me) { onNavigate('/auth'); return }
    duplicateTrip(trip, me.id)
    toast('Snapshot imported — it is now in your trips')
    onNavigate('/trips')
  }

  if (state.s === 'error') {
    return (
      <div className="container empty-state">
        <div className="big"><Link2 size={38} aria-hidden /></div>
        <h1 style={{ fontSize: 26 }}>This snapshot link is broken</h1>
        <p className="muted">The link may have been truncated — ask for a fresh one from the trip’s Share tab.</p>
        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => onNavigate('/')}>Go home</button>
      </div>
    )
  }

  return (
    <div className="container empty-state">
      <div className="big"><Luggage size={38} aria-hidden /></div>
      <h1 style={{ fontSize: 26 }}>Shared itinerary{state.s === 'ready' ? `: “${state.name}”` : ''}</h1>
      {state.s === 'ready' && (
        <p className="muted">{state.days}-day trip · {state.destinations}</p>
      )}
      <p className="muted small" style={{ maxWidth: 460 }}>
        This whole plan is embedded in the link itself — nothing was stored on a server.
        Import it to get your own editable copy{me ? '' : ' (you will be asked to log in first)'}.
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14 }}>
        <button className="btn btn-primary" onClick={importIt}><Import size={16} aria-hidden style={{ verticalAlign: '-3px', marginRight: 6 }} />{me ? 'Import into my trips' : 'Log in & import'}</button>
        <button className="btn btn-outline" onClick={() => onNavigate('/')}>Not now</button>
      </div>
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
  // The invited trip is (by definition) not the viewer's yet, so the
  // membership-scoped hydration never loaded it — fetch it on demand. The
  // RPC fallback covers private trips: holding the link (the trip's UUID)
  // is the capability to preview it.
  const [trip, setTrip] = useState<Trip | null>(null)
  const [status, setStatus] = useState<'loading' | 'broken' | 'joining'>('loading')
  // Keep the latest navigate callback in a ref so we don't re-fire effects
  // on every parent re-render.
  const navigateRef = useRef(onNavigate)
  useEffect(() => { navigateRef.current = onNavigate })

  // Resolve the code/UUID to a trip, once per link target. A hydration can
  // evict the fetched trip from the cache (fetchSharedTrip merges it, the
  // next full hydrate may drop it), so `trip` lives in local state, not the
  // cache — the gate must survive re-hydrations without refetching.
  // decodeURIComponent first: the landing page's code box navigates with
  // encodeURIComponent, and a code typed with a space would otherwise arrive
  // as a %20 inside the segment.
  useEffect(() => {
    let alive = true
    const target = (() => { try { return decodeURIComponent(codeOrTripId) } catch { return codeOrTripId } })()
    const resolve = UUID_RE.test(target)
      ? fetchSharedTrip(target, true)
      : fetchTripByInviteCode(target)
    void resolve.then(t => {
      if (!alive) return
      if (t) setTrip(t)
      else setStatus('broken')
    })
    return () => { alive = false }
  }, [codeOrTripId])

  // Logged in + trip resolved → join once, then open the trip. The join is
  // awaited: joinViaInvite writes the membership row before its side effects,
  // and only a confirmed member should be navigated into the workspace.
  const joinedRef = useRef(false)
  useEffect(() => {
    if (!me || !trip || joinedRef.current) return
    // A member re-clicking the link just opens the trip — no re-join toast.
    // The cached copy carries the viewer's membership; a fresh RPC fetch may
    // not, so prefer the cache's memberful view for this check.
    const cached = tripById(trip.id)
    if ((cached ?? trip).members?.some(m => m.userId === me.id)) {
      joinedRef.current = true
      navigateRef.current(`/trip/${trip.id}`)
      return
    }
    joinedRef.current = true // StrictMode double-fire guard
    void (async () => {
      setStatus('joining')
      // Ensure the trip is in the cache before joining — a sign-in hydration
      // can have replaced the cache after our first fetch, and joinViaInvite
      // reads tripById.
      await fetchSharedTrip(trip.id, true)
      const ok = await joinViaInvite(trip.id, me.id)
      if (ok) toast(`You're on “${trip.name}” — happy planning!`)
      else toast('Could not join — the link may be old. Ask for a fresh one.', 'err')
      navigateRef.current(`/trip/${trip.id}`)
    })()
    // Depend on me/trip objects, not a mount-only []: the store hydrates them
    // asynchronously after init(), so a one-shot effect ran before they
    // existed and the invite never auto-joined.
  }, [me, trip])

  if (status === 'broken' || !trip) {
    return status === 'broken' ? (
      <div className="container empty-state">
        <div className="big"><Link2 size={38} aria-hidden /></div>
        <h1 style={{ fontSize: 26 }}>This invite link is broken</h1>
        <p className="muted">Ask the trip organiser for a fresh link from the trip’s Share tab.</p>
        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => onNavigate('/')}>Go home</button>
      </div>
    ) : (
      <div className="container loading-block"><div className="spinner" />Opening invite…</div>
    )
  }

  if (!me) {
    // Park the invite in the URL and bounce through auth with a next param —
    // the old buttons went to plain /auth, and AuthPage's post-login redirect
    // to /trips dropped the invite entirely: users logged in, landed on My
    // Trips, and the trip never appeared.
    const inviteRoute = UUID_RE.test(codeOrTripId) ? `/invite/${codeOrTripId}` : `/join/${codeOrTripId}`
    return (
      <div className="container empty-state">
        <div className="big"><Mail size={38} aria-hidden /></div>
        <h1 style={{ fontSize: 26 }}>You’ve been invited to “{trip.name}”</h1>
        <p className="muted">Log in or create a free account to join the planning crew.</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14 }}>
          <button className="btn btn-outline" onClick={() => onNavigate(`/auth?next=${encodeURIComponent(inviteRoute)}`)}>Log in</button>
          <button className="btn btn-primary" onClick={() => onNavigate(`/auth?mode=signup&next=${encodeURIComponent(inviteRoute)}`)}>Create account</button>
        </div>
      </div>
    )
  }

  return (
    <div className="container loading-block">
      <div className="spinner" />
      {status === 'joining' ? `Joining “${trip.name}”…` : 'Opening invite…'}
    </div>
  )
}

/** Raw trip UUIDs (legacy #/invite/<id> links) vs short invite codes. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
