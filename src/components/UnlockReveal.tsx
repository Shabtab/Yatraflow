// ============ The unlock moment (ROADMAP I-20) ============
// Paying for a plan used to end in a toast: the days quietly became readable
// and nothing acknowledged what had just been bought. This is the ceremony the
// research asks for — "You now own X", listing what is INSIDE, and every line
// of it computed from the itinerary the buyer just gained. No adjectives.
//
// The order matters as much as the content (research §4): the reveal lands
// first, and the fork CTA sits inside it, because the moment a plan appears in
// your own workspace is when a purchase feels worth its price. Dismissing it
// costs nothing — the plan is already theirs, and the shelf remembers it.
//
// Motion follows the token catalog: a full-screen sheet is a large surface
// (--motion-slow + --ease-out), the facts take the entrance pattern, and both
// opt out under prefers-reduced-motion (AGENTS rule 10).
import { useState } from 'react'
import { CalendarDays, Share2 } from 'lucide-react'
import { InlineIcon } from './icons'
import { Modal, StatTile } from './ui'
import { CoverThumb } from './CoverThumb'
import { formatInr } from '../lib/engine'
import { unlockRevealStats } from '../lib/purchases'
import { sharePurchase } from '../lib/purchaseShare'
import type { PublishedItinerary, Trip, User } from '../data/types'

export function UnlockReveal({ open, pub, trip, creator, amountPaidInr, entitlementId, onFork, onClose }: {
  open: boolean
  pub: PublishedItinerary
  /** The itinerary served AFTER the entitlement existed — the pre-purchase
   *  copy is wire-stubbed, and the stub keeps titles and coordinates while
   *  emptying the plan behind them, so stats read from it would look right
   *  over empty days. See `unlockRevealStats`. */
  trip: Trip
  creator?: User
  amountPaidInr?: number
  /** The grant this purchase produced. Absent for a moment while the
   *  entitlement read lands (the purchase callback refreshes it), which only
   *  keeps the share control from appearing a beat early — the card is gated on
   *  the server anyway. */
  entitlementId?: string
  onFork: () => void
  onClose: () => void
}) {
  const stats = unlockRevealStats(trip)
  // #590 — the share awaits the system sheet (or the clipboard fallback), so a
  // double-tap on the quietest button of the ceremony would open two sheets or
  // fire two toasts. Same guard the shelf's identical control carries (the
  // #409 pass) — the pair is pinned together in tests.
  const [sharing, setSharing] = useState(false)
  const shareBought = () => {
    if (sharing || !entitlementId) return
    setSharing(true)
    void sharePurchase({ pubId: pub.id, entitlementId, title: pub.title })
      .finally(() => setSharing(false))
  }

  return (
    <Modal open={open} onClose={onClose} title="You now own it" variant="full">
      <div className="unlock-reveal">
        <div className="unlock-reveal-hero">
          <CoverThumb variant="wide" explicitUrl={pub.coverImageUrl} trip={{ name: pub.title, destinations: pub.routeSummary }} emoji="🧭" />
        </div>

        <p className="unlock-reveal-kicker">Unlocked</p>
        <h3 className="unlock-reveal-title">{pub.title}</h3>
        <p className="unlock-reveal-by">
          {creator?.profile?.name ? <>by <b>{creator.profile.name}</b></> : <>an independent creator</>}
          {trip.startLocation ? <> · {trip.startLocation}</> : null}
        </p>

        {/* Only facts that are actually true: a zero-day or zero-stop line is
            noise, and a made-up "0 km" would undercut every other number here. */}
        <div className="unlock-reveal-facts">
          {stats.days > 0 && (
            <StatTile label="Days" value={stats.days} sub="every one unlocked" />
          )}
          {stats.stops > 0 && (
            <StatTile label="Stops" value={stats.stops} sub="with notes and timings" />
          )}
          {stats.km > 0 && (
            <StatTile label="Route" value={`${stats.km} km`} sub="planned distance" />
          )}
          {stats.perPersonInr > 0 && (
            <StatTile label="Budget" value={formatInr(stats.perPersonInr)} sub="per person, rebuilt" />
          )}
        </div>

        {pub.travelTips.length > 0 && (
          <p className="unlock-reveal-tips">
            <b>{pub.travelTips.length}</b> {pub.travelTips.length === 1 ? 'travel tip' : 'travel tips'} from the creator are included.
          </p>
        )}

        <p className="unlock-reveal-receipt">
          {typeof amountPaidInr === 'number' ? <>Paid <b>{formatInr(amountPaidInr)}</b> · </> : null}
          yours for good — find it any time under <b>My purchases</b>.
        </p>

        <div className="unlock-reveal-actions">
          <button className="btn btn-saffron btn-lg" onClick={onFork}>
            <InlineIcon icon={CalendarDays} size={15} gap={6} />
            Fork into my trips
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Read the plan</button>
          {/* ROADMAP I-21 — the artifact buyers voluntarily circulate. This is
              the highest-intent moment there is for one, but it stays the last
              and quietest action: the ceremony is about what was just gained,
              not about asking for a post. */}
          {entitlementId && (
            <button
              className="btn btn-ghost"
              disabled={sharing}
              onClick={shareBought}
            >
              <InlineIcon icon={Share2} size={15} gap={6} />
              {sharing ? 'Opening…' : 'Share what you bought'}
            </button>
          )}
        </div>
        <p className="hint-text unlock-reveal-hint">
          Forking copies the whole plan into your own trips with today’s dates — you can rename it, re-time it and
          take it with you offline.
        </p>
      </div>
    </Modal>
  )
}
