// ============ Bottom navigation (native shell only) ============
// The installed app's primary navigation. The website's floating pill
// (.nav-links) is hidden in the shell — a phone app navigates from a fixed
// bar at the thumb, not from a pill at the top of the screen — so these
// destinations are what the shell shows instead. Android grammar throughout:
// fixed bar above the gesture bar, equal columns, icon over an 11px label,
// 58px of tap height, the active destination tinted.
//
// Four destinations for everyone. A creator gets a fifth, Creator hub, placed
// before Profile so Profile stays last. The gate is the real profile flag, and
// it only decides whether a shortcut is drawn: the /creator-hub route keeps its
// own guard, so hiding this item is navigation, not authorization.
//
// This component never mounts on the web: App.tsx renders it only when
// isNative && me, so the website keeps the pill nav byte-for-byte.
//
// It is NOT an overlay: it does not join App.tsx's registerAndroidBack
// overlay-close contract, because closing "nothing" is the right answer for
// a navigation bar — back should walk history, not hide the nav.

import { Compass, House, Sparkles, Tent, User } from 'lucide-react'

export interface NavDestination {
  to: string
  label: string
  /** The full name, for the accessible label when the visible label is short. */
  title?: string
  Icon: typeof House
}

const HOME: NavDestination = { to: '/', label: 'Home', Icon: House }
const TRIPS: NavDestination = { to: '/trips', label: 'My trips', Icon: Tent }
const EXPLORE: NavDestination = { to: '/explore', label: 'Explore', Icon: Compass }
const PROFILE: NavDestination = { to: '/profile', label: 'Profile', Icon: User }
/** Creators only. The visible label is short because five columns are narrow;
 *  the accessible name stays "Creator hub". */
const CREATOR: NavDestination = { to: '/creator-hub', label: 'Creator', title: 'Creator hub', Icon: Sparkles }

/** The ordered destinations for this viewer: Profile always last. */
export function navDestinations(isCreator: boolean): NavDestination[] {
  return isCreator
    ? [HOME, TRIPS, EXPLORE, CREATOR, PROFILE]
    : [HOME, TRIPS, EXPLORE, PROFILE]
}

/** Where the user is, for active-state purposes. */
export type Area = 'home' | 'trips' | 'explore' | 'creator' | 'profile' | null

/**
 * Map a hash route onto a destination. Query strings ride on the segment
 * (`/explore?style=beach`, App.tsx strips them the same way), so drop them
 * first. A trip workspace belongs to My trips — it is opened from that list
 * and back returns there; every other route (/new, /creator/:id, /admin,
 * /pub/:slug, …) lights nothing, which is honest: the nav has no such tab.
 * The public creator page is deliberately not the hub.
 */
export function areaOf(route: string): Area {
  const path = route.split('?')[0]
  if (path === '/') return 'home'
  if (path === '/trips' || path.startsWith('/trip/')) return 'trips'
  if (path === '/explore') return 'explore'
  if (path === '/creator-hub') return 'creator'
  if (path === '/profile') return 'profile'
  return null
}

export function BottomNav({ route, onNavigate, isCreator = false }: {
  route: string
  onNavigate: (r: string) => void
  /** The real profile flag. Only decides whether the Creator hub item is drawn. */
  isCreator?: boolean
}) {
  const current = areaOf(route)
  const items = navDestinations(isCreator)
  return (
    // data-destinations lets the END of styles.css scope a five-column grid to
    // this case, so the four-item bar keeps its own rule untouched.
    <nav
      className="bottom-nav"
      role="navigation"
      aria-label="Primary"
      data-destinations={items.length}
    >
      {items.map(({ to, label, title, Icon }) => {
        // areaOf() never returns null for a destination, so a null `current`
        // (any route the nav does not own) leaves every item unlit.
        const active = current === areaOf(to)
        return (
          <button
            key={to}
            type="button"
            className={`bottom-nav-item${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
            aria-label={title}
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
