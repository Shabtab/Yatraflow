// ============ #828 — one announcement per settled day start ============
//
// The bug this pins: the Timeline's Departure control is a native
// `<input type="time">`, which fires `change` on every spin of its minute
// field. A ten-minute adjustment arrives as ten calls with ten DIFFERENT
// clock values, and announcing each one stacked ten toasts on screen (the
// toast zone appends with no dedupe and no cap) and fired ten success
// haptics. Deduplicating identical text cannot fix it — the text differs every
// time — so the rule is to coalesce the burst and speak only the value the
// person settled on.
//
// The write stays immediate: the plan, the arrival clock and the map must stay
// live while the person spins. Only the ANNOUNCEMENT is coalesced.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DAY_START_SETTLE_MS, createDayStartBurst, dayStartAnnouncement } from '../src/lib/dayStartBurst'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('#828 — the burst tracker speaks once, for the settled value', () => {
  it('ten spins produce ONE announcement, carrying the last value', () => {
    const burst = createDayStartBurst()
    // The ten events a ten-minute adjustment actually produces.
    for (let m = 31; m <= 40; m++) burst.push(2, `09:${m}`)

    const first = burst.take()
    expect(first).toEqual({ dayIndex: 2, time: '09:40' })
    // The whole point: nothing is left to speak a second time.
    expect(burst.take()).toBeNull()
    expect(burst.hasPending()).toBe(false)
  })

  it('a later burst is announced on its own — coalescing must not swallow it', () => {
    const burst = createDayStartBurst()
    burst.push(1, '07:15')
    expect(burst.take()).toEqual({ dayIndex: 1, time: '07:15' })
    burst.push(1, '07:20')
    expect(burst.take()).toEqual({ dayIndex: 1, time: '07:20' })
  })

  it('a flush with nothing pending says nothing', () => {
    const burst = createDayStartBurst()
    // A timer that fires after a previous take (or after an unmount clear) must
    // not invent an announcement.
    expect(burst.take()).toBeNull()
    expect(burst.hasPending()).toBe(false)
  })

  it('the last push wins across days, not just across minutes', () => {
    const burst = createDayStartBurst()
    burst.push(0, '06:00')
    burst.push(3, '11:45')
    expect(burst.take()).toEqual({ dayIndex: 3, time: '11:45' })
  })
})

describe('#828 — the sentence names the day and the settled clock', () => {
  it('reads the 12h format when that is the preference', () => {
    expect(dayStartAnnouncement(1, '09:40', '9:40 AM')).toBe('Day 2 now starts 9:40 AM')
  })

  it('reads the 24h format when that is the preference', () => {
    expect(dayStartAnnouncement(0, '09:40', '09:40')).toBe('Day 1 now starts 09:40')
  })

  it('a cleared start says it went back to the engine default', () => {
    expect(dayStartAnnouncement(4, '', '')).toBe('Ride start reset to the default')
  })
})

describe('#828 — the settle window is a real, short delay', () => {
  it('is long enough to swallow a spin and short enough to feel immediate', () => {
    expect(DAY_START_SETTLE_MS).toBeGreaterThanOrEqual(250)
    expect(DAY_START_SETTLE_MS).toBeLessThanOrEqual(1000)
  })
})

describe('#828 — the wiring keeps the write immediate and coalesces only the words', () => {
  const tab = read('../src/pages/trip/TimelineTab.tsx')

  it('writes the trip on every call, before any announcement is scheduled', () => {
    const body = tab.slice(tab.indexOf('const handleSetDayStart'), tab.indexOf('const handleAddPlannedHalts'))
    const writeAt = body.indexOf('updateTrip(')
    const announceAt = body.indexOf('dayStartBurst.current.push(')
    expect(writeAt, 'handleSetDayStart must still write the trip').toBeGreaterThan(-1)
    expect(announceAt, 'handleSetDayStart must queue an announcement').toBeGreaterThan(-1)
    // The write comes FIRST: the plan is live while the person is still spinning.
    expect(writeAt).toBeLessThan(announceAt)
  })

  it('toasts from the flush, not from the change handler', () => {
    const body = tab.slice(tab.indexOf('const handleSetDayStart'), tab.indexOf('const handleAddPlannedHalts'))
    const toastAt = body.indexOf('toast(')
    const timerAt = body.indexOf('window.setTimeout(')
    // The one toast call sits inside the timer callback, so it cannot run per
    // spin — that is the defect this pins.
    expect(timerAt).toBeGreaterThan(-1)
    expect(toastAt).toBeGreaterThan(timerAt)
  })

  it('clears a pending announcement on unmount', () => {
    // A burst that outlives the tab would speak for a surface already left.
    // Asserted against the CLEANUP EFFECT itself: matching the clear anywhere in
    // the file is vacuous, because the change handler clears the timer too.
    const cleanup = tab.slice(tab.indexOf('// A pending announcement must not outlive'))
    expect(cleanup, 'the unmount cleanup must exist').not.toBe('')
    const body = cleanup.slice(0, cleanup.indexOf('}, [])'))
    expect(body, 'unmount must cancel the pending flush').toMatch(/clearTimeout\(dayStartFlush\.current\)/)
    expect(body, 'unmount must drop the pending value').toMatch(/dayStartBurst\.current\.take\(\)/)
  })

  it('no longer announces the raw input value', () => {
    // The old line interpolated `time` straight into the sentence, which both
    // bypassed the 12h/24h preference and announced every spin.
    expect(tab).not.toMatch(/`Day \$\{dayIndex \+ 1\} now starts \$\{time\}`/)
  })

  it('speaks the settled clock in the person’s own format', () => {
    // The old sentence pasted the raw "HH:MM" input value, so a 12h user was
    // told "09:40" while every other clock on the page read "9:40 AM".
    expect(tab).toMatch(/dayStartAnnouncement\(settled\.dayIndex, settled\.time, formatHM\(settled\.time, getTimeFormat\(\)\)\)/)
  })
})
