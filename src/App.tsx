// ============ YatraFlow app shell ============
// Hash-based routing so the built app works from any static host or file://.
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { Trip } from './data/types'
import { useDb, currentUser, logout, notificationsFor, markAllNotificationsRead, tripById, joinViaInvite, duplicateTrip, init } from './store/store'
import { Avatar, BrandMark, ToastZone, useClickOutside, toast } from './components/ui'
import { decodeTripSnapshot } from './lib/snapshot'
import { LandingPage } from './pages/Landing'
import { AuthPage } from './pages/Auth'
import { TripsListPage } from './pages/TripsList'
import { CreateTripPage } from './pages/CreateTrip'
import { TripWorkspace } from './pages/TripWorkspace'
import { ExplorePage } from './pages/Explore'
import { PublicItineraryPage } from './pages/PublicItinerary'
import { ProfilePage } from './pages/Profile'

function currentRoute(): string {
  return location.hash.replace(/^#/, '') || '/'
}

export default function App() {
  const db = useDb()
  const me = currentUser(db)
  const [route, setRoute] = useState(currentRoute)
  const [dark, setDark] = useState(() => localStorage.getItem('yatraflow_theme') === 'dark')
  const [notifOpen, setNotifOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const notifRef = useClickOutside(() => setNotifOpen(false))
  const menuRef = useClickOutside(() => setMenuOpen(false))

  useEffect(() => {
    const onHash = () => { setRoute(currentRoute()); setMobileNav(false); window.scrollTo(0, 0) }
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
  function toggleTheme(e: MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const root = document.documentElement
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDark(d => !d); return
    }
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

  // route shapes: /, /auth, /trips, /new, /trip/:id, /explore, /pub/:slug, /invite/:tripId, /share/<payload>, /profile
  // Query strings (e.g. /auth?mode=signup) ride on parts[0]; strip them so the
  // segment still matches the switch. Pages read their own params from location.hash.
  const parts = route.split('/').filter(Boolean).map(s => s.split('?')[0])
  let page: React.ReactNode

  if (parts[0] === 'share' && parts[1]) {
    page = <SharedTripPage payload={parts[1]} onNavigate={navigate} />
  } else if (parts[0] === 'invite' && parts[1]) {
    page = <InviteGate tripId={parts[1]} onNavigate={navigate} />
  } else if (!me) {
    // public pages stay accessible logged-out; everything else funnels to auth/landing
    if (parts[0] === 'pub' && parts[1]) page = <PublicItineraryPage slug={parts[1]} onNavigate={navigate} />
    else if (parts[0] === 'explore') page = <ExplorePage onNavigate={navigate} />
    else if (parts[0] === 'auth') page = <AuthPage onNavigate={navigate} />
    else page = <LandingPage onNavigate={navigate} />
  } else {
    switch (parts[0]) {
      case undefined:
      case '':
        page = <LandingPage onNavigate={navigate} />
        break
      case 'trips':
        page = <TripsListPage onNavigate={navigate} />
        break
      case 'new':
        page = <CreateTripPage onNavigate={navigate} />
        break
      case 'trip':
        page = <TripWorkspace tripId={parts[1] ?? ''} initialTab={parts[2]} onNavigate={navigate} />
        break
      case 'explore':
        page = <ExplorePage onNavigate={navigate} />
        break
      case 'pub':
        page = <PublicItineraryPage slug={parts[1] ?? ''} onNavigate={navigate} />
        break
      case 'profile':
        page = <ProfilePage onNavigate={navigate} />
        break
      default:
        page = <LandingPage onNavigate={navigate} />
    }
  }

  const notifs = me ? notificationsFor(me.id) : []
  const unread = notifs.filter(n => !n.read).length

  return (
    <div className="app-shell">
      {/* Skip link (F-08): href="#main" would fight the hash router, so we
          preventDefault and focus <main> programmatically instead. */}
      <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus() }}>Skip to main content</a>
      <nav className="topnav">
        <div className="container topnav-inner">
          <a className="brand" href="#/" aria-label="YatraFlow home">
            <BrandMark />
            <span>Yatra<b style={{ color: 'var(--teal)' }}>Flow</b></span>
          </a>
          <div className="nav-links">
            {me && <>
              <a className={`nav-link ${route === '/trips' ? 'active' : ''}`} href="#/trips">My trips</a>
              <a className={`nav-link ${route === '/new' ? 'active' : ''}`} href="#/new">Plan a trip</a>
            </>}
            <a className={`nav-link ${route === '/explore' ? 'active' : ''}`} href="#/explore">Explore</a>
          </div>
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
              {mobileNav ? '✕' : '☰'}
            </button>

            <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle dark mode" title="Toggle dark mode">
              {dark ? '☀️' : '🌙'}
            </button>
            {me && (
              <div style={{ position: 'relative' }} ref={notifRef}>
                  <button className="icon-btn" onClick={() => setNotifOpen(o => !o)} aria-label={`Notifications (${unread} unread)`} aria-expanded={notifOpen} aria-controls="notif-pop">
                    🔔{unread > 0 && <span className="notif-badge">{unread}</span>}
                  </button>
              {notifOpen && (
                <div className="notif-pop" id="notif-pop">
                  <div className="row-between" style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
                    <b>Notifications</b>
                    {unread > 0 && <button className="btn btn-ghost btn-sm" onClick={() => markAllNotificationsRead(me.id)}>Mark all read</button>}
                  </div>
                  <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                    {notifs.length === 0 && <p className="muted small" style={{ padding: 16 }}>You’re all caught up ✨</p>}
                    {notifs.slice(0, 12).map(n => (
                      <div key={n.id} className={`notif-item ${n.read ? '' : 'unread'}`}>
                        <span>{n.text}</span>
                        {n.tripId && <button className="btn btn-ghost btn-sm" onClick={() => { setNotifOpen(false); navigate(`/trip/${n.tripId}`) }}>View →</button>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {me && (
            <div style={{ position: 'relative' }} ref={menuRef}>
              <button className="avatar-btn" onClick={() => setMenuOpen(o => !o)} aria-label="Account menu" aria-expanded={menuOpen} aria-controls="user-menu">
                <Avatar user={me} />
              </button>
              {menuOpen && (
                <div className="user-menu" id="user-menu">
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
                    <b>{me.profile.name}</b>
                    <div className="small muted">{me.email}</div>
                    {me.profile.isCreator && <span className="chip chip-saffron" style={{ marginTop: 6, display: 'inline-block' }}>✨ Creator</span>}
                  </div>
                  <button className="user-menu-item" onClick={() => { setMenuOpen(false); navigate('/profile') }}>Profile & settings</button>
                  <button className="user-menu-item" onClick={() => { setMenuOpen(false); navigate('/explore') }}>Explore itineraries</button>
                  <button className="user-menu-item danger" onClick={() => { logout(); setMenuOpen(false); navigate('/') }}>Log out</button>
                </div>
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
            <a className={`nav-link ${route === '/trips' ? 'active' : ''}`} href="#/trips">🏕️ My trips</a>
            <a className={`nav-link ${route === '/new' ? 'active' : ''}`} href="#/new">➕ Plan a trip</a>
          </>}
          <a className={`nav-link ${route === '/explore' ? 'active' : ''}`} href="#/explore">🧭 Explore</a>
          {me && <a className={`nav-link ${route === '/profile' ? 'active' : ''}`} href="#/profile">⚙️ Profile & settings</a>}
        </div>
      )}

      <main id="main" tabIndex={-1} style={{ flex: 1 }}>
        {/* keyed on the route so every page change (My trips ↔ Explore ↔ a trip)
            re-mounts and plays the route-panel entrance animation */}
        <div className="route-panel" key={route}>{page}</div>
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <span><b>YatraFlow</b> — plan together, travel better. Built for Indian travellers 🇮🇳</span>
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
        <div className="big">🔗</div>
        <h2>This snapshot link is broken</h2>
        <p className="muted">The link may have been truncated — ask for a fresh one from the trip’s Share tab.</p>
        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => onNavigate('/')}>Go home</button>
      </div>
    )
  }

  return (
    <div className="container empty-state">
      <div className="big">🧳</div>
      <h2>Shared itinerary{state.s === 'ready' ? `: “${state.name}”` : ''}</h2>
      {state.s === 'ready' && (
        <p className="muted">{state.days}-day trip · {state.destinations}</p>
      )}
      <p className="muted small" style={{ maxWidth: 460 }}>
        This whole plan is embedded in the link itself — nothing was stored on a server.
        Import it to get your own editable copy{me ? '' : ' (you will be asked to log in first)'}.
      </p>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14 }}>
        <button className="btn btn-primary" onClick={importIt}>{me ? '📥 Import into my trips' : 'Log in & import'}</button>
        <button className="btn btn-outline" onClick={() => onNavigate('/')}>Not now</button>
      </div>
    </div>
  )
}

/** Invite links land here: requires login, then joins the trip and opens it. */
function InviteGate({ tripId, onNavigate }: { tripId: string; onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const trip = tripById(tripId)
  // Keep the latest navigate callback in a ref so we don't re-fire the effect
  // (and re-join / re-arm the timer) on every parent re-render.
  const navigateRef = useRef(onNavigate)
  useEffect(() => { navigateRef.current = onNavigate })

  useEffect(() => {
    if (!me || !trip) return
    joinViaInvite(tripId, me.id)
    const t = setTimeout(() => navigateRef.current(`/trip/${tripId}`), 400)
    return () => clearTimeout(t)
    // Depend on the users/trip objects, not a mount-only []: the store hydrates
    // them asynchronously after init(), so a one-shot effect ran before they
    // existed and the invite never auto-joined.
  }, [me, trip, tripId])

  if (!trip) {
    return (
      <div className="container empty-state">
        <div className="big">🔗</div>
        <h2>This invite link is broken</h2>
        <p className="muted">Ask the trip organiser for a fresh link from the trip’s Share tab.</p>
        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => onNavigate('/')}>Go home</button>
      </div>
    )
  }

  if (!me) {
    return (
      <div className="container empty-state">
        <div className="big">✉️</div>
        <h2>You’ve been invited to “{trip.name}”</h2>
        <p className="muted">Log in or create a free account to join the planning crew.</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14 }}>
          <button className="btn btn-outline" onClick={() => onNavigate('/auth')}>Log in</button>
          <button className="btn btn-primary" onClick={() => onNavigate('/auth?mode=signup')}>Create account</button>
        </div>
      </div>
    )
  }

  return (
    <div className="container loading-block"><div className="spinner" />Joining “{trip.name}”…</div>
  )
}
