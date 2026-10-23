// ============ The guided flow's progress line ============
// Pure rules, node env (AGENTS §1). The progress line is the flow's one claim
// about how much is left, so it must never overstate progress. These pin the
// three things it says: the counter, what remains, and which steps are links.
import { describe, it, expect } from 'vitest'
import {
  stepCounterLabel, remainingStepsLabel, reachableSteps, stepIsLink,
} from '../src/lib/createProgress'
import { validateCreate, type CreateInput } from '../src/lib/createSteps'

function valid(over: Partial<CreateInput> = {}): CreateInput {
  return {
    name: 'Kerala slow coast', startLocation: 'Kochi', destInput: '', stopCount: 2,
    returnInput: '', returnOpen: false, composerTitle: '', startDate: '2026-11-14',
    endDate: '2026-11-16', travellers: 2, budgetPerPersonInr: 14500,
    mustAnswerDriving: false, unpicked: {}, composerError: null, ...over,
  }
}

describe('stepCounterLabel', () => {
  it('counts from one, out of six', () => {
    expect(stepCounterLabel('where')).toBe('Step 1 of 6')
    expect(stepCounterLabel('when')).toBe('Step 3 of 6')
    expect(stepCounterLabel('review')).toBe('Step 6 of 6')
  })
})

describe('remainingStepsLabel', () => {
  it('says nothing about the step in front of the traveller', () => {
    // Telling someone that the empty field they are looking at is empty is
    // noise. It speaks only about what comes after.
    expect(remainingStepsLabel('when', validateCreate(valid({ startDate: '' }))))
      .toBe('Nothing else to fill in')
  })

  it('names the single thing left after this step', () => {
    const errors = validateCreate(valid({ travellers: 0 }))
    expect(remainingStepsLabel('where', errors)).toContain('One thing left')
  })

  it('counts the rest when several are open', () => {
    const errors = validateCreate(valid({ travellers: 0, budgetPerPersonInr: -1 }))
    expect(remainingStepsLabel('where', errors)).toBe('2 things left after this')
  })

  it('says "Last step" on Review when nothing is wrong', () => {
    expect(remainingStepsLabel('review', {})).toBe('Last step')
  })

  it('says nothing else is left when the rest of the flow is complete', () => {
    // On step 1 of a valid form there are no steps after it to block, so the
    // line must not claim there is work waiting.
    expect(remainingStepsLabel('where', {})).toBe('Nothing else to fill in')
  })
})

describe('reachableSteps', () => {
  it('stops at the first step that is not complete', () => {
    // The list must never offer a step past an empty one: jumping there would
    // land the traveller on a screen that cannot finish.
    const errors = validateCreate(valid({ startDate: '' }))
    expect(reachableSteps(errors)).toEqual(['where', 'how', 'when'])
  })

  it('opens every step when nothing is wrong', () => {
    expect(reachableSteps({})).toEqual(['where', 'how', 'when', 'who', 'budget', 'review'])
  })

  it('opens only the first step when the route is empty', () => {
    expect(reachableSteps(validateCreate(valid({ startLocation: '', stopCount: 0 }))))
      .toEqual(['where'])
  })

  it('is unaffected by an error on a later step', () => {
    const errors = validateCreate(valid({ budgetPerPersonInr: -1 }))
    expect(reachableSteps(errors)).toEqual(['where', 'how', 'when', 'who', 'budget'])
  })
})

describe('stepIsLink', () => {
  it('never links the current step', () => {
    expect(stepIsLink('where', 'where', {})).toBe(false)
  })

  it('links a step the traveller may return to', () => {
    expect(stepIsLink('where', 'when', {})).toBe(true)
  })

  it('does not link a step that is not reachable', () => {
    const errors = validateCreate(valid({ startLocation: '', stopCount: 0 }))
    expect(stepIsLink('budget', 'where', errors)).toBe(false)
  })
})
