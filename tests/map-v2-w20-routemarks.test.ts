import { describe, expect, it } from 'vitest'
import { clockTicks, pickBandTag, tickText, windowLabel } from '../src/lib/map/routeMarks'

describe('W20 route marks', () => {
  const day = [
    { km: 0, arriveMin: 600, departMin: 600 },
    { km: 8, arriveMin: 620, departMin: 665 },
    { km: 71, arriveMin: 835, departMin: 840 },
  ]
  it('ticks the road between stops at the plan clock', () => {
    const ticks = clockTicks(day)
    expect(ticks.map(tick => tick.km)).toEqual([20, 40, 60])
    // 665 + (20 - 8) / 63 * 170 = 697.4
    expect(ticks[0].min).toBe(697)
    expect(ticks[2].min).toBeGreaterThan(ticks[1].min)
  })
  it('drops a tick that sits on a stop and a leg with no time', () => {
    expect(clockTicks([{ km: 0, arriveMin: 0, departMin: 0 }, { km: 21, arriveMin: 60, departMin: 60 }]).map(tick => tick.km)).toEqual([])
    expect(clockTicks([{ km: 0, arriveMin: 600, departMin: 600 }, { km: 60, arriveMin: 600, departMin: 600 }])).toEqual([])
  })
  it('caps the ticks and keeps them in road order', () => {
    const long = clockTicks([{ km: 0, arriveMin: 0, departMin: 0 }, { km: 400, arriveMin: 600, departMin: 600 }], { max: 3 })
    expect(long.map(tick => tick.km)).toEqual([20, 40, 60])
  })
  it('writes the clock in the reader format', () => {
    expect(tickText({ km: 21, min: 665 }, '12h')).toEqual({ clock: '11:05 AM', km: 'Km 21' })
    expect(tickText({ km: 21, min: 665 }, '24h')).toEqual({ clock: '11:05', km: 'Km 21' })
    expect(windowLabel('Lunch', 690, 870, '12h')).toBe('Lunch · 11:30 AM–2:30 PM')
  })
  it('words a pick past the scope and a pick over budget', () => {
    expect(pickBandTag('just-past', 35, 30)).toBe('+5 min past')
    expect(pickBandTag('over-budget', 38, 30)).toBe('+38 min · over budget')
    expect(pickBandTag('just-past', null, 30)).toBeNull()
    expect(pickBandTag('just-past', 25, 30)).toBeNull()
  })
})
