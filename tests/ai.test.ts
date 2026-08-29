// ============ AI router tests ============
// Guards the question router in src/lib/ai.ts against mis-routing.
import { describe, it, expect } from 'vitest'
import { answerQuestion } from '../src/lib/ai'
import { seedData } from '../src/data/seed'

const trip = seedData.trips[0]

describe('answerQuestion routing', () => {
  it('routes a TRAIN question to the airport/feasibility handler, not rain (regression for #3)', () => {
    const q = 'What time should we leave for the train station?'
    const reply = answerQuestion(trip, q)
    // rainPlan() answers are about "rain options"; a train question must not
    // produce rain-plan text.
    expect(reply.text).not.toMatch(/rain option/i)
    expect(reply.text.length).toBeGreaterThan(0)
  })

  it('still routes an explicit rain question to the rain plan', () => {
    const reply = answerQuestion(trip, 'What if it rains on Day 2?')
    expect(reply.text).toMatch(/rain/i)
  })
})
