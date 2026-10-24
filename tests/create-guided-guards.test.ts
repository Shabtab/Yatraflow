import { describe, expect, it } from 'vitest'
import { createSubmitIntent, guidedConstraintErrors, numericConstraintError } from '../src/lib/createGuidedGuards'
import { CREATE_STEPS, firstErrorStep, stepOfError } from '../src/lib/createSteps'
import { CREW_MAX } from '../src/lib/crew'

const complete = { fuelControls: true, rental: true, fuelEconomy: '14', fuelPrice: '104', tankL: '45', rentPerDay: '1800', travellers: 4, budgetPerPersonInr: 20000 }

describe('guided numeric validation', () => {
  it('accepts optional defaults and valid boundary values', () => {
    expect(guidedConstraintErrors({ ...complete, fuelEconomy: '', fuelPrice: '', tankL: '', rentPerDay: '' })).toEqual({})
    expect(guidedConstraintErrors({ ...complete, fuelEconomy: '2', fuelPrice: '250', tankL: '300', rentPerDay: '200', travellers: CREW_MAX, budgetPerPersonInr: 0 })).toEqual({})
  })

  it.each([
    ['fuelEconomy', '1'], ['fuelEconomy', '81'], ['fuelEconomy', '14.05'],
    ['fuelPrice', '49'], ['fuelPrice', '251'], ['fuelPrice', '104.05'],
    ['tankL', '4'], ['tankL', '301'], ['tankL', '45.5'],
    ['rentPerDay', '199'], ['rentPerDay', '225'],
  ])('keeps an invalid %s value %s on How', (key, value) => {
    const errors = guidedConstraintErrors({ ...complete, [key]: value })
    expect(errors[key]).toBeTruthy()
    expect(stepOfError(key)).toBe('how')
    expect(firstErrorStep(errors)).toBe('how')
  })

  it('does not validate controls absent for the selected mode', () => {
    expect(guidedConstraintErrors({ ...complete, fuelControls: false, fuelEconomy: '1', tankL: '1', rentPerDay: '1' })).toEqual({})
    expect(guidedConstraintErrors({ ...complete, rental: false, rentPerDay: '1' })).toEqual({})
  })

  it.each([NaN, Infinity, -1, 250])('refuses invalid budget %s on Budget', budgetPerPersonInr => {
    const errors = guidedConstraintErrors({ ...complete, budgetPerPersonInr })
    expect(errors.budgetPerPersonInr).toBeTruthy()
    expect(firstErrorStep(errors)).toBe('budget')
  })

  it.each([NaN, Infinity, 0, 1.5, CREW_MAX + 1])('refuses invalid traveller count %s on Who', travellers => {
    const errors = guidedConstraintErrors({ ...complete, travellers })
    expect(errors.travellers).toBeTruthy()
    expect(firstErrorStep(errors)).toBe('who')
  })

  it('handles decimal rounding and rejects invalid numeric text', () => {
    expect(numericConstraintError('2.3', { min: 2, max: 80, step: 0.1 })).toBeNull()
    expect(numericConstraintError('bad', { min: 2 })).toBeTruthy()
  })
})

describe('form submit intent', () => {
  it('advances every guided step before Review', () => {
    CREATE_STEPS.slice(0, -1).forEach((step, index) => {
      expect(createSubmitIntent(true, step)).toEqual({ kind: 'advance', step: CREATE_STEPS[index + 1] })
    })
  })
  it('permits guided creation only on Review', () => {
    expect(createSubmitIntent(true, 'review')).toEqual({ kind: 'create' })
  })
  it('preserves legacy submit at every step', () => {
    CREATE_STEPS.forEach(step => expect(createSubmitIntent(false, step)).toEqual({ kind: 'create' }))
  })
})
