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

  it('does NOT route "alternative" (without "cheap"/"cheaper") to cheaperAlternative (regression for #15)', () => {
    // JS operator precedence made `q.includes('cheaper') || q.includes('alternative') && q.includes('cheap')`
    // hard to reason about. "suggest an alternative museum" must stay in the
    // generic handler, never the budget-levers answer.
    const reply = answerQuestion(trip, 'suggest an alternative museum')
    expect(reply.text).not.toMatch(/Biggest levers/)
  })

  it('routes "find a cheaper alternative" to cheaperAlternative', () => {
    const reply = answerQuestion(trip, 'find a cheaper alternative')
    expect(reply.text).toMatch(/Current estimated total/)
  })
})
