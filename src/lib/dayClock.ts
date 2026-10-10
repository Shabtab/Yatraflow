/**
 * The page's calendar clock (#648).
 *
 * My Trips needs "today" for two readings: the departure countdown and the date
 * filter. One value must feed both, so the two cannot disagree. That value must
 * also move when the calendar day moves. A value captured once at mount stays on
 * the mount date, so a tab left open overnight keeps saying "Departs tomorrow"
 * for a trip that leaves today.
 *
 * The unit is a day, not a second, so the clock wakes once per midnight. The
 * pure part lives here and takes its time source from the caller, so a node test
 * can drive it without a browser. The React binding is `src/hooks/useToday.ts`.
 */

/** Local midnight of the day that holds `d`. */
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** True when both instants fall on the same local calendar day. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Milliseconds from `now` to the next local midnight.
 *
 * The span comes from calendar fields, not from adding 24 hours. A local
 * midnight is therefore always the target, even on a day a daylight-saving
 * change shortens or lengthens. The answer is at least 1ms, so a caller at
 * exactly midnight still waits for the NEXT midnight instead of waking at once
 * in a loop.
 */
export function msUntilNextLocalDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return Math.max(1, next.getTime() - now.getTime())
}

/**
 * Extra milliseconds past the boundary. A timer that fires exactly on midnight
 * can read the instant before it, so the clock waits a moment to be sure the new
 * day has started.
 */
export const DAY_TICK_LATENESS_MS = 50

export interface DayClockOptions {
  /** Reads the current instant. A test injects its own time source. */
  now?: () => Date
  /** Called once per new calendar day, with local midnight of that day. */
  onChange: (day: Date) => void
  /** Schedules one wake-up. A test injects its own scheduler. */
  setTimer?: (fn: () => void, ms: number) => unknown
  /** Cancels a wake-up from `setTimer`. */
  clearTimer?: (id: unknown) => void
}

export interface DayClock {
  /** The local day the clock holds. */
  current(): Date
  /** Re-read the day now. The focus and visibility listeners call this. */
  refresh(): void
  /** Stop waiting. A stopped clock never calls `onChange` again. */
  stop(): void
}

/**
 * One clock that reports each new local day.
 *
 * `refresh` reports a change only when the calendar day actually moved, so a
 * focus event on the same day costs no render. The wake-up is armed once per
 * day, so nothing polls.
 */
export function createDayClock(opts: DayClockOptions): DayClock {
  const read = opts.now ?? (() => new Date())
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? (id => clearTimeout(id as ReturnType<typeof setTimeout>))

  let held = startOfLocalDay(read())
  let timer: unknown = null
  let stopped = false

  function refresh() {
    if (stopped) return
    const day = startOfLocalDay(read())
    if (isSameLocalDay(day, held)) return
    held = day
    opts.onChange(day)
  }

  function arm() {
    if (stopped) return
    if (timer !== null) clearTimer(timer)
    timer = setTimer(() => {
      timer = null
      refresh()
      arm()
    }, msUntilNextLocalDay(read()) + DAY_TICK_LATENESS_MS)
  }

  arm()

  return {
    current: () => held,
    refresh,
    stop() {
      stopped = true
      if (timer !== null) {
        clearTimer(timer)
        timer = null
      }
    },
  }
}
