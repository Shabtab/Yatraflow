// Horizon 3.6: slack prompts.
// After any itinerary change the day's leftover slack surfaces one nearby
// pick that fits: "you have ~90 min slack in Jodhpur — X is 15 min away".
import { describe, it, expect } from 'vitest'
import { daySlackMin, pickSlackHit, slackPrompt } from '../src/lib/slackPrompts'

describe('slack prompts', () => {
  it('computes leftover slack inside the day window, floored at zero', () => {
    // 08:30 → 21:00 window (750 min), 600 committed → 150 slack
    expect(daySlackMin({ dayEndMin: 1260, startMin: 510, driveMin: 400, dwellMin: 100, planMin: 80, bufferMin: 20 })).toBe(150)
    expect(daySlackMin({ dayEndMin: 1260, startMin: 510, driveMin: 800, dwellMin: 0, planMin: 0, bufferMin: 0 })).toBe(0)
  })

  it('picks the closest fitting candidate (there-and-back + visit)', () => {
    const cands = [
      { name: 'Far Fort', detourMin: 40, category: 'fort' },
      { name: 'Jaswant Thada', detourMin: 15, category: 'museum' },
    ]
    // 90 slack: Far Fort needs 80+60=140 (no fit at 60-min visit), Thada 30+90=120 no...
    // museum visit is 90: 30+90=120 > 90. Use food stop instead.
    const eats = [
      { name: 'Far Dhaba', detourMin: 40, category: 'food' },
      { name: 'Near Dhaba', detourMin: 10, category: 'food' },
    ]
    expect(pickSlackHit(90, eats)?.name).toBe('Near Dhaba')
    expect(pickSlackHit(90, cands)).toBeNull()
  })

  it('stays quiet on thin slack and speaks on roomy days', () => {
    const eats = [{ name: 'Near Dhaba', detourMin: 10, category: 'food' }]
    expect(slackPrompt(20, 'Jodhpur', eats)).toBeNull()
    const text = slackPrompt(90, 'Jodhpur', eats)
    expect(text).not.toBeNull()
    expect(text!).toContain('90 min slack')
    expect(text!).toContain('Jodhpur')
    expect(text!).toContain('Near Dhaba')
  })
})
