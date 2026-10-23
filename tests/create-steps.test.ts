// ============ Create funnel: the six steps and the error-to-step rule ============
// Pure rules, node env (AGENTS §1). Step 1 of the guided flow: extract the submit
// rules so the long form and the guided shell cannot disagree about what is
// wrong, and so "which step owns this error" is a tested fact rather than a
// judgement made twice.
import { describe, it, expect } from 'vitest'
import {
  CREATE_STEPS, CREATE_STEP_QUESTION, stepNumber, stepOfError, firstErrorStep,
  validateCreate, stepIsComplete, type CreateInput,
} from '../src/lib/createSteps'

/** A form that submit() accepts. Each test changes one thing. */
function valid(over: Partial<CreateInput> = {}): CreateInput {
  return {
    name: 'Kerala slow coast',
    startLocation: 'Kochi',
    destInput: '',
    stopCount: 2,
    returnInput: '',
    returnOpen: false,
    composerTitle: '',
    startDate: '2026-11-14',
    endDate: '2026-11-16',
    travellers: 2,
    budgetPerPersonInr: 14500,
    mustAnswerDriving: false,
    unpicked: {},
    composerError: null,
    ...over,
  }
}

describe('the step order', () => {
  it('is the six approved steps in the approved order', () => {
    expect(CREATE_STEPS).toEqual(['where', 'how', 'when', 'who', 'budget', 'review'])
  })

  it('numbers steps 1-based, matching "Step 3 of 6"', () => {
    expect(stepNumber('where')).toBe(1)
    expect(stepNumber('when')).toBe(3)
    expect(stepNumber('review')).toBe(6)
  })

  it('gives every step a question, and the review step names the action', () => {
    for (const step of CREATE_STEPS) expect(CREATE_STEP_QUESTION[step]).toBeTruthy()
    // The last step's heading is the button, so the two can never drift apart.
    expect(CREATE_STEP_QUESTION.review).toBe('Check and create')
  })
})

describe('validateCreate', () => {
  it('accepts a complete form', () => {
    expect(validateCreate(valid())).toEqual({})
  })

  it('names the trip when the name is blank', () => {
    expect(validateCreate(valid({ name: '   ' })).name).toBe('Name your trip.')
  })

  it('asks for the starting point when it is blank', () => {
    expect(validateCreate(valid({ startLocation: ' ' })).startLocation).toBe('Where does the journey start?')
  })

  it('wants at least one stop when none are pinned', () => {
    expect(validateCreate(valid({ stopCount: 0 })).destinations).toBe('Add at least one destination.')
  })

  it('prefers the unpicked message over the bare "add a destination" one', () => {
    // The user can see the text in the box, so naming it is the more useful
    // sentence. #375 is the reason this ordering is pinned.
    const out = validateCreate(valid({
      stopCount: 0, destInput: 'Munnar',
      unpicked: { destinations: 'Pick “Munnar” from the suggestions…' },
    }))
    expect(out.destinations).toContain('Munnar')
    expect(out.destinations).not.toBe('Add at least one destination.')
  })

  it('does not accept an end date before the start date', () => {
    expect(validateCreate(valid({ endDate: '2026-11-13' })).endDate)
      .toBe('End date must be after the start date.')
  })

  it('accepts a one-day trip where both dates are equal', () => {
    expect(validateCreate(valid({ endDate: '2026-11-14' })).endDate).toBeUndefined()
  })

  it('refuses a party below the floor and above the ceiling, with different advice', () => {
    expect(validateCreate(valid({ travellers: 0 })).travellers).toBe('At least one traveller!')
    // Above the ceiling is not an error to correct but a split to make, so the
    // sentence has to say that.
    expect(validateCreate(valid({ travellers: 31 })).travellers).toMatch(/Split groups/)
  })

  it('allows a zero budget, because zero means "no target"', () => {
    expect(validateCreate(valid({ budgetPerPersonInr: 0 })).budgetPerPersonInr).toBeUndefined()
  })

  it('refuses a negative budget', () => {
    expect(validateCreate(valid({ budgetPerPersonInr: -1 })).budgetPerPersonInr)
      .toBe('A budget cannot be negative.')
  })

  it('blocks a Mixed trip with no driving answer, and only then', () => {
    expect(validateCreate(valid({ mustAnswerDriving: true })).drivesPart).toBeTruthy()
    expect(validateCreate(valid({ mustAnswerDriving: false })).drivesPart).toBeUndefined()
  })

  it('reports every problem at once, not just the first', () => {
    const out = validateCreate(valid({ name: '', startDate: '', travellers: 0, budgetPerPersonInr: -5 }))
    expect(Object.keys(out).sort()).toEqual(['budgetPerPersonInr', 'name', 'startDate', 'travellers'])
  })
})

describe('stepOfError', () => {
  it('maps every error key validateCreate can produce to exactly one step', () => {
    // Every key, forced to fire at once.
    const all = validateCreate({
      name: '', startLocation: '', destInput: '', stopCount: 0, returnInput: 'x', returnOpen: true,
      composerTitle: 'x', startDate: '', endDate: '', travellers: 0, budgetPerPersonInr: -1,
      mustAnswerDriving: true,
      unpicked: { destinations: 'd', returnStops: 'r' },
      composerError: 'c',
    })
    expect(Object.keys(all).sort()).toEqual([
      'budgetPerPersonInr', 'composerRow', 'destinations', 'drivesPart', 'endDate',
      'name', 'returnStops', 'startDate', 'startLocation', 'travellers',
    ])
    for (const key of Object.keys(all)) {
      expect(CREATE_STEPS).toContain(stepOfError(key))
    }
  })

  it('puts route errors on Where', () => {
    expect(stepOfError('startLocation')).toBe('where')
    expect(stepOfError('destinations')).toBe('where')
    expect(stepOfError('returnStops')).toBe('where')
  })

  it('puts the driving question on How, because that is where it is asked', () => {
    expect(stepOfError('drivesPart')).toBe('how')
  })

  it('puts dates and the departure time on When', () => {
    expect(stepOfError('startDate')).toBe('when')
    expect(stepOfError('endDate')).toBe('when')
    // The schedule reads this value, but the control is on When. It would be
    // worse than useless to send the traveller to a screen with nothing to fix.
    expect(stepOfError('dayStartTime')).toBe('when')
  })

  it('puts party size on Who and the money on Budget', () => {
    expect(stepOfError('travellers')).toBe('who')
    expect(stepOfError('budgetPerPersonInr')).toBe('budget')
  })

  it('puts the name and the pinned-plan row on Review, where both are asked', () => {
    expect(stepOfError('name')).toBe('review')
    expect(stepOfError('composerRow')).toBe('review')
  })

  it('sends an unknown key to the first step, never to Review', () => {
    // A new error key must not open Review on an unfinished form and offer a
    // Create button that cannot work. Failing to step 1 keeps the traveller in
    // the flow, and the test above makes the omission visible.
    expect(stepOfError('someFutureField')).toBe('where')
    expect(stepOfError('')).toBe('where')
  })
})

describe('firstErrorStep', () => {
  it('returns null when nothing is wrong', () => {
    expect(firstErrorStep({})).toBeNull()
  })

  it('returns the earliest step, not the first key inserted', () => {
    // Object order is insertion order, so a later-inserted Where error must still
    // win: the traveller fixes the flow from the top.
    const errors = { budgetPerPersonInr: 'x', travellers: 'y', startLocation: 'z' }
    expect(firstErrorStep(errors)).toBe('where')
  })

  it('skips past a complete step', () => {
    expect(firstErrorStep({ budgetPerPersonInr: 'x' })).toBe('budget')
    expect(firstErrorStep({ endDate: 'x', travellers: 'y' })).toBe('when')
  })
})

describe('stepIsComplete', () => {
  it('is true for a step with no error against it', () => {
    const errors = validateCreate(valid({ endDate: '' }))
    expect(stepIsComplete('where', errors)).toBe(true)
    expect(stepIsComplete('how', errors)).toBe(true)
  })

  it('is false for the step that owns the error', () => {
    const errors = validateCreate(valid({ endDate: '' }))
    expect(stepIsComplete('when', errors)).toBe(false)
  })

  it('does not leak one step\'s error onto another', () => {
    const errors = validateCreate(valid({ travellers: 0 }))
    for (const step of CREATE_STEPS) {
      expect(stepIsComplete(step, errors)).toBe(step !== 'who')
    }
  })
})
