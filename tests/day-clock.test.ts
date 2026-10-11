import { describe, expect, it, vi } from 'vitest'
import {
  DAY_TICK_LATENESS_MS,
  createDayClock,
  isSameLocalDay,
  msUntilNextLocalDay,
  startOfLocalDay,
} from '../src/lib/dayClock'

/* #648: My Trips must move to the next calendar day while it stays open, and it
   must do that without re-rendering every second. These cases drive the clock
   with an injected time source and an injected scheduler, so the boundary and
   the focus path are pinned without a browser. */

const at = (y: number, m: number, d: number, hh = 0, mm = 0, ss = 0) =>
  new Date(y, m - 1, d, hh, mm, ss)

describe('startOfLocalDay / isSameLocalDay', () => {
  it('drops the time of day', () => {
    expect(startOfLocalDay(at(2026, 10, 6, 23, 59, 59)).getTime()).toBe(at(2026, 10, 6).getTime())
  })

  it('tells two instants on one day apart from two on different days', () => {
    expect(isSameLocalDay(at(2026, 10, 6, 0, 0, 1), at(2026, 10, 6, 23, 59, 59))).toBe(true)
    expect(isSameLocalDay(at(2026, 10, 6, 23, 59, 59), at(2026, 10, 7, 0, 0, 1))).toBe(false)
    expect(isSameLocalDay(at(2026, 10, 31), at(2026, 11, 1))).toBe(false)
    expect(isSameLocalDay(at(2026, 12, 31), at(2027, 1, 1))).toBe(false)
  })
})

describe('msUntilNextLocalDay', () => {
  it('lands on local midnight of the next calendar day, whatever the hour', () => {
    for (const now of [at(2026, 10, 6), at(2026, 10, 6, 12, 34, 56), at(2026, 10, 6, 23, 59, 59)]) {
      const next = new Date(now.getTime() + msUntilNextLocalDay(now))
      expect(next.getTime(), now.toISOString()).toBe(at(2026, 10, 7).getTime())
    }
  })

  it('carries across a month and a year boundary', () => {
    expect(new Date(at(2026, 10, 31, 8).getTime() + msUntilNextLocalDay(at(2026, 10, 31, 8))).getTime())
      .toBe(at(2026, 11, 1).getTime())
    expect(new Date(at(2026, 12, 31, 8).getTime() + msUntilNextLocalDay(at(2026, 12, 31, 8))).getTime())
      .toBe(at(2027, 1, 1).getTime())
  })

  it('never answers 0 or a negative wait, so an exactly-midnight read waits a whole day', () => {
    const wait = msUntilNextLocalDay(at(2026, 10, 6))
    expect(wait).toBeGreaterThan(0)
    expect(new Date(at(2026, 10, 6).getTime() + wait).getTime()).toBe(at(2026, 10, 7).getTime())
  })
})

describe('createDayClock', () => {
  /** A clock with a hand-moved time source and a scheduler whose callback a test fires. */
  function harness(start: Date) {
    let now = start
    const onChange = vi.fn()
    let pending: { fn: () => void; ms: number } | null = null
    const clock = createDayClock({
      now: () => now,
      onChange,
      setTimer: (fn, ms) => {
        pending = { fn, ms }
        return 1
      },
      clearTimer: () => {
        pending = null
      },
    })
    return {
      clock,
      onChange,
      set: (d: Date) => {
        now = d
      },
      /** Fire the armed wake-up, as the browser would at midnight. */
      fire: () => {
        const armed = pending
        pending = null
        armed?.fn()
      },
      armed: () => pending,
    }
  }

  it('starts on the local day, without announcing it', () => {
    const h = harness(at(2026, 10, 6, 9, 30))
    expect(h.clock.current().getTime()).toBe(at(2026, 10, 6).getTime())
    expect(h.onChange).not.toHaveBeenCalled()
  })

  it('arms one wake-up per day, a moment after the next midnight', () => {
    const h = harness(at(2026, 10, 6, 23, 59, 59))
    expect(h.armed()?.ms).toBe(1000 + DAY_TICK_LATENESS_MS)
  })

  it('reports the new day when midnight passes, and re-arms for the next one', () => {
    const h = harness(at(2026, 10, 6, 23, 59, 59))
    h.set(at(2026, 10, 7, 0, 0, 1))
    h.fire()
    expect(h.onChange).toHaveBeenCalledTimes(1)
    expect(h.onChange.mock.calls[0][0].getTime()).toBe(at(2026, 10, 7).getTime())
    expect(h.clock.current().getTime()).toBe(at(2026, 10, 7).getTime())
    // A whole day, not a second: the unit is a day.
    expect(h.armed()?.ms).toBeGreaterThan(23 * 60 * 60 * 1000)
  })

  it('reports the new day on refresh, so a focus after a missed wake-up is not stale', () => {
    // A background tab throttles timers, so the wake-up may never fire.
    const h = harness(at(2026, 10, 6, 9, 30))
    h.set(at(2026, 10, 7, 8, 0))
    h.clock.refresh()
    expect(h.onChange).toHaveBeenCalledTimes(1)
    expect(h.clock.current().getTime()).toBe(at(2026, 10, 7).getTime())
  })

  it('says nothing when refresh happens on the same day, so focus costs no render', () => {
    const h = harness(at(2026, 10, 6, 9, 30))
    h.set(at(2026, 10, 6, 18, 45))
    h.clock.refresh()
    h.clock.refresh()
    expect(h.onChange).not.toHaveBeenCalled()
    expect(h.clock.current().getTime()).toBe(at(2026, 10, 6).getTime())
  })

  it('stops cleanly: the timer is cancelled and no day is ever announced', () => {
    const h = harness(at(2026, 10, 6, 23, 59, 59))
    h.clock.stop()
    expect(h.armed()).toBeNull()
    h.set(at(2026, 10, 8, 12))
    h.clock.refresh()
    expect(h.onChange).not.toHaveBeenCalled()
  })
})
