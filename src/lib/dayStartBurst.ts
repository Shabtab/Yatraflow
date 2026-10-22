// ============ One announcement per settled change (#828) ============
//
// A native `<input type="time">` fires `change` on EVERY spin of its minute
// field — ten presses of the up-arrow is ten events, not one. The Timeline's
// Departure control announced each one, so a ten-minute adjustment stacked ten
// toasts on screen, fired ten success haptics, and captured ten debounced
// writes for one intent.
//
// The messages differ every time ("Day 2 now starts 09:31", "...09:32"), so
// deduplicating identical text cannot help: the fix has to COALESCE the burst
// into the value the person actually settled on. This module holds that rule as
// plain data and functions so the behaviour is pinned in node tests, with the
// component owning only the timer.

/** How long a burst is allowed to keep collecting before it is announced. Long
 *  enough to swallow a spin (the field repeats faster than this), short enough
 *  that a deliberate single change still feels acknowledged at once. */
export const DAY_START_SETTLE_MS = 500

/** The line a settled day start announces. `time` is the committed "HH:MM", and
 *  `display` is that same clock in the person's chosen 12h/24h format — the
 *  toast says what the panel says, not the raw input value. */
export function dayStartAnnouncement(dayIndex: number, time: string, display: string): string {
  return time ? `Day ${dayIndex + 1} now starts ${display}` : 'Ride start reset to the default'
}

/** A burst tracker: each `push` replaces the pending announcement, and only the
 *  last value in the burst is spoken. `take` hands back the pending line (and
 *  clears it) so a timer can announce exactly once.
 *
 *  Pure and timer-free on purpose — the component schedules the flush, this
 *  decides what the flush says. */
export function createDayStartBurst() {
  let pending: { dayIndex: number; time: string } | null = null
  return {
    /** Record the newest value in the burst. */
    push(dayIndex: number, time: string): void {
      pending = { dayIndex, time }
    },
    /** The newest value, cleared. Null when the burst announced nothing —
     *  a flush that arrives with no work must not speak at all. */
    take(): { dayIndex: number; time: string } | null {
      const out = pending
      pending = null
      return out
    },
    /** True while a flush still has something to say. */
    hasPending(): boolean {
      return pending !== null
    },
  }
}
