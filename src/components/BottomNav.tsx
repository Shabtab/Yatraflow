// ============ Bottom navigation (native shell only) ============
// The installed app's primary navigation. The website's floating pill
// (.nav-links) is hidden in the shell — a phone app navigates from a fixed
// bar at the thumb, not from a pill at the top of the screen — so these four
// destinations are what the shell shows instead. Android grammar throughout:
// fixed bar above the gesture bar, four equal columns, icon over an 11px
// label, 58px of tap height, the active destination tinted.
//
// This component never mounts on the web: App.tsx renders it only when
// isNative && me, so the website keeps the pill nav byte-for-byte.
//
// It is NOT an overlay: it does not join App.tsx's registerAndroidBack
// overlay-close contract, because closing "nothing" is the right answer for
// a navigation bar — back should walk history, not hide the nav.

import { Compass, House, Tent, User } from 'lucide-react'

/** The four destinations, in Material's order: home first, profile last.
 *  Labels are sentence case — the design system's uppercase is CSS-only. */
const DESTINATIONS = [
  { to: '/', label: 'Home', Icon: House },
  { to: '/trips', label: 'My trips', Icon: Tent },
  { to: '/explore', label: 'Explore', Icon: Compass },
  { to: '/profile', label: 'Profile', Icon: User },
] as const

/** Where the user is, for active-state purposes. */
type Area = 'home' | 'trips' | 'explore' | 'profile' | null

/**
 * Map a hash route onto a destination. Query strings ride on the segment
 * (`/explore?style=beach`, App.tsx strips them the same way), so drop them
 * first. A trip workspace belongs to My trips — it is opened from that list
 * and back returns there; every other route (/new, /creator-hub, /admin,
 * /pub/:slug, …) lights nothing, which is honest: the nav has no such tab.
 */
function areaOf(route: string): Area {
  const path = route.split('?')[0]
  if (path === '/') return 'home'
  if (path === '/trips' || path.startsWith('/trip/')) return 'trips'
  if (path === '/explore') return 'explore'
  if (path === '/profile') return 'profile'
  return null
}

export function BottomNav({ route, onNavigate }: {
  route: string
  onNavigate: (r: string) => void
}) {
  const current = areaOf(route)
  return (
    <nav className="bottom-nav" role="navigation" aria-label="Primary">
      {DESTINATIONS.map(({ to, label, Icon }) => {
        // areaOf() never returns null for a destination, so a null `current`
        // (any route the nav does not own) leaves every item unlit.
        const active = current === areaOf(to)
        return (
          <button
            key={to}
            type="button"
            className={`bottom-nav-item${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => onNavigate(to)}
          >
            <Icon size={22} aria-hidden />
            <span className="bottom-nav-label">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
