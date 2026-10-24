// ============ The guided flow's step, in the address ============
// Pure rules, node env (AGENTS §1). Step 3 of the guided flow: a step in the URL
// is what makes Back move one step and a reload keep its place. Both promises
// are tested here rather than in a browser, because the rule is the address, not
// the pixels.
import { describe, it, expect } from 'vitest'
import {
  STEP_PARAM, isCreateStep, stepFromQuery, stepHref, previousStep, nextStep,
} from '../src/lib/createStepUrl'
import { CREATE_STEPS } from '../src/lib/createSteps'

describe('stepFromQuery', () => {
  it('reads a step the address names', () => {
    expect(stepFromQuery('step=when')).toBe('when')
    expect(stepFromQuery('?step=review')).toBe('review')
    expect(stepFromQuery(new URLSearchParams('step=budget'))).toBe('budget')
  })

  it('opens at the first step when the address names none', () => {
    expect(stepFromQuery('')).toBe('where')
    expect(stepFromQuery('?ref=card')).toBe('where')
  })

  it('opens at the first step for a value that is not a step', () => {
    // A typed URL, a bookmark from an older build, or a step a future build
    // removed. All three must open a screen that exists.
    expect(stepFromQuery('step=packing')).toBe('where')
    expect(stepFromQuery('step=')).toBe('where')
    expect(stepFromQuery('step=WHERE')).toBe('where')
  })

  it('ignores a repeated parameter rather than joining the values', () => {
    // URLSearchParams.get returns the first, which is the one the sender meant.
    expect(stepFromQuery('step=when&step=budget')).toBe('when')
  })

  it('accepts every one of the six steps', () => {
    for (const step of CREATE_STEPS) expect(stepFromQuery(`step=${step}`)).toBe(step)
  })
})

describe('stepHref', () => {
  it('replaces only step and preserves duplicate keys and decoded values', () => {
    const original = new URLSearchParams('seed=synthetic%2Freview&tag=a%2Bb&step=how&tag=a+b&step=who&empty=')
    const href = stepHref('when', '/new', original)
    const actual = new URLSearchParams(href.split('?')[1])
    expect(actual.getAll('step')).toEqual(['when'])
    expect([...actual].filter(([key]) => key !== 'step')).toEqual([...original].filter(([key]) => key !== 'step'))
    expect(original.getAll('step')).toEqual(['how', 'who'])
    expect(actual.getAll('tag')).toEqual(['a+b', 'a b'])
  })

  it('removes every step value at Where without dropping seed or empty values', () => {
    expect(stepHref('where', '/new', '?step=how&seed=one&step=review&empty=')).toBe('/new?seed=one&empty=')
  })

  it('gives the first step the plain address, so one screen has one URL', () => {
    expect(stepHref('where')).toBe('/create')
  })

  it('names every other step', () => {
    expect(stepHref('when')).toBe('/create?step=when')
    expect(stepHref('review')).toBe('/create?step=review')
  })

  it('round-trips with stepFromQuery', () => {
    for (const step of CREATE_STEPS) {
      const href = stepHref(step)
      const query = href.includes('?') ? href.slice(href.indexOf('?')) : ''
      expect(stepFromQuery(query)).toBe(step)
    }
  })

  it('honours a different base path', () => {
    expect(stepHref('when', '/trips/new')).toBe('/trips/new?step=when')
    expect(stepHref('where', '/trips/new')).toBe('/trips/new')
  })
})

describe('previousStep', () => {
  it('steps back one, which is what Back must do', () => {
    expect(previousStep('review')).toBe('budget')
    expect(previousStep('when')).toBe('how')
  })

  it('returns null at the first step, so Back leaves the flow', () => {
    // The alternative - pushing a synthetic entry to catch Back - would make
    // Back do nothing at all, which is worse than leaving the page.
    expect(previousStep('where')).toBeNull()
  })
})

describe('nextStep', () => {
  it('steps forward one', () => {
    expect(nextStep('where')).toBe('how')
    expect(nextStep('budget')).toBe('review')
  })

  it('returns null at Review, where the action is Create', () => {
    expect(nextStep('review')).toBeNull()
  })
})

describe('the walk through the flow', () => {
  it('reaches Review in five Next presses and returns in five Backs', () => {
    const forward: string[] = []
    let step = CREATE_STEPS[0]
    for (let n = nextStep(step); n; n = nextStep(step)) {
      forward.push(n)
      step = n
    }
    expect(forward).toEqual(['how', 'when', 'who', 'budget', 'review'])

    const back: string[] = []
    for (let p = previousStep(step); p; p = previousStep(step)) {
      back.push(p)
      step = p
    }
    expect(back).toEqual(['budget', 'who', 'when', 'how', 'where'])
    expect(step).toBe('where')
  })
})

describe('isCreateStep', () => {
  it('accepts the six steps and nothing else', () => {
    for (const step of CREATE_STEPS) expect(isCreateStep(step)).toBe(true)
    for (const bad of ['', 'Where', 'packing', null, undefined, 3, {}]) {
      expect(isCreateStep(bad)).toBe(false)
    }
  })
})

describe('the parameter name', () => {
  it('is short, because it rides in every create URL', () => {
    expect(STEP_PARAM).toBe('step')
  })
})
