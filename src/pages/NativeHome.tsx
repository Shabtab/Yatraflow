// ============ Native app home (shell only) ============
// The website's "/" is a marketing landing — hero, Plan Bench calculator,
// ticker, CTAs. Right for a first-time visitor in a browser; wrong inside
// the installed app, where the user is signed in and wants their trips, not
// a sales pitch. In the native shell the "/" route becomes a task-first
// home: greeting, quick actions, live/upcoming trips first, then the rest —
// the layout grammar of an Android app (one column, big touch rows, no
// columns that collapse awkwardly at 360px).
//
// This component never mounts on the web: App.tsx picks it only when
// isNative && me, so the landing page's SEO/marketing job stays untouched.

import { useMemo } from 'react'
import { Bell, Compass, MapPin, Plus, Sparkles, Users, Wallet } from 'lucide-react'
import type { Trip } from '../data/types'
import { useUsers, useSessionUserId, useNotifications, tripsForUser } from '../store/store'
import { computeTotals, formatInrShort } from '../lib/engine'
import { Avatar } from '../components/ui'

function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Late night planning'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

/** Live = today falls inside the date range; upcoming = starts in the future. */
function tripPhase(t: Trip): 'live' | 'upcoming' | 'other' {
  const start = t.startDate ? Date.parse(t.startDate) : NaN
  const end = t.endDate ? Date.parse(t.endDate) : NaN
  const today = new Date().setHours(0, 0, 0, 0)
  if (Number.isFinite(start)) {
    const e = Number.isFinite(end) ? end : start
    if (today >= start && today <= e + 86_400_000) return 'live'
    if (start > today) return 'upcoming'
  }
  return 'other'
}

function HomeTripRow({ trip, onNavigate }: { trip: Trip; onNavigate: (r: string) => void }) {
  const phase = tripPhase(trip)
  const totals = computeTotals(trip)
  const crew = (trip.members ?? []).length
  return (
    <button className="app-home-trip" onClick={() => onNavigate(`/trip/${trip.id}`)}>
      <span className={`app-home-trip-thumb ${phase === 'live' ? 'is-live' : ''}`}>
        {trip.coverEmoji || <MapPin size={20} aria-hidden />}
      </span>
      <span className="app-home-trip-body">
        <span className="app-home-trip-name">{trip.name}</span>
        <span className="app-home-trip-meta">
          {phase === 'live'
            ? <><span className="app-home-live-dot" />Live now</>
            : phase === 'upcoming'
              ? <>Starts {new Date(Date.parse(trip.startDate!)).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</>
              : <>{trip.days.length} days</>}
          <span aria-hidden>·</span>
          <span><Wallet size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 2 }} />{formatInrShort(totals.costPerPersonInr)}/person</span>
          {crew > 1 && (
            <><span aria-hidden>·</span><span><Users size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 2 }} />{crew}</span></>
          )}
        </span>
      </span>
    </button>
  )
}

export function NativeHomePage({ me, onNavigate }: {
  me: { id: string; profile: { name: string } }
  onNavigate: (r: string) => void
}) {

  const users = useUsers()
  const meId = useSessionUserId()
  const notifs = useNotifications()
  const unread = notifs.filter(n => !n.read).length

  // Same membership rule as the trips page.
  const trips = useMemo(
    () => tripsForUser(meId)
      .slice()
      .sort((a, b) => {
        // Live first, then upcoming (soonest first), then the rest by recency.
        const phase = (t: Trip) => ({ live: 0, upcoming: 1, other: 2 })[tripPhase(t)]
        if (phase(a) !== phase(b)) return phase(a) - phase(b)
        if (tripPhase(a) === 'upcoming') return Date.parse(a.startDate!) - Date.parse(b.startDate!)
        return b.updatedAt - a.updatedAt
      }),
    [meId],
  )
  const firstName = me.profile.name.split(' ')[0]

  return (
    <div className="app-home">
      {/* Greeting block — an app, not a website: who's here and what matters now. */}
      <div className="app-home-hero">
        <div className="app-home-hello">
          <h1>{greeting()}, {firstName}</h1>
          <p className="muted small">
            {trips.length === 0
              ? 'Nothing planned yet — your first trip is one tap away.'
              : trips.length === 1
                ? 'One trip on your bench.'
                : `${trips.length} trips on your bench.`}
          </p>
        </div>
        <div className="app-home-avatar-row">
          {unread > 0 && (
            <button className="app-home-bell" onClick={() => onNavigate('/trips')} aria-label={`${unread} unread notifications`}>
              <Bell size={17} aria-hidden />
              <span className="app-home-bell-count">{unread}</span>
            </button>
          )}
          <Avatar user={{ profile: { name: me.profile.name, avatarUrl: users.find(u => u.id === meId)?.profile.avatarUrl } }} size="lg" />
        </div>
      </div>

      {/* Primary actions — the two things an app home must do instantly. */}
      <div className="app-home-actions">
        <button className="app-home-action app-home-action--primary" onClick={() => onNavigate('/new')}>
          <Plus size={20} aria-hidden />
          <span>Plan a trip</span>
        </button>
        <button className="app-home-action" onClick={() => onNavigate('/explore')}>
          <Compass size={20} aria-hidden />
          <span>Explore</span>
        </button>
      </div>

      {trips.length === 0 ? (
        <div className="app-home-empty">
          <Sparkles size={26} aria-hidden />
          <p><strong>No trips yet.</strong></p>
          <p className="muted small">Start from scratch, or browse what other travellers have published in Explore.</p>
        </div>
      ) : (
        <>
          <h2 className="app-home-section">Your trips</h2>
          <div className="app-home-trips">
            {trips.slice(0, 6).map(t => <HomeTripRow key={t.id} trip={t} onNavigate={onNavigate} />)}
          </div>
          {trips.length > 6 && (
            <button className="app-home-more" onClick={() => onNavigate('/trips')}>
              All {trips.length} trips
            </button>
          )}
        </>
      )}
    </div>
  )
}
