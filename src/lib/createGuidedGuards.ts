import { nextStep } from './createStepUrl'
import type { CreateErrors, CreateStep } from './createSteps'
import { CREW_MAX, CREW_MIN } from './crew'

/** Match the create form's native numeric constraints without a hidden browser prompt. */
export function numericConstraintError(value: string | number, { min, max, step = 1 }: { min: number; max?: number; step?: number }): string | null {
  if (typeof value === 'string' && !value.trim()) return null
  const number = Number(value)
  if (!Number.isFinite(number)) return 'Enter a number.'
  if (number < min) return `Enter ${min} or more.`
  if (max !== undefined && number > max) return `Enter ${max} or less.`
  const increments = (number - min) / step
  if (Math.abs(increments - Math.round(increments)) > 0.000001) return `Use increments of ${step}, from ${min}.`
  return null
}

export function guidedConstraintErrors(input: {
  fuelControls: boolean; rental: boolean
  fuelEconomy: string; fuelPrice: string; tankL: string; rentPerDay: string
  travellers: number; budgetPerPersonInr: number
}): CreateErrors {
  const errors: CreateErrors = {}
  const check = (key: string, value: string | number, bounds: Parameters<typeof numericConstraintError>[1]) => {
    const message = numericConstraintError(value, bounds)
    if (message) errors[key] = message
  }
  if (input.fuelControls) {
    check('fuelEconomy', input.fuelEconomy, { min: 2, max: 80, step: 0.1 })
    check('fuelPrice', input.fuelPrice, { min: 50, max: 250, step: 0.1 })
    check('tankL', input.tankL, { min: 5, max: 300 })
    if (input.rental) check('rentPerDay', input.rentPerDay, { min: 200, step: 50 })
  }
  check('travellers', input.travellers, { min: CREW_MIN, max: CREW_MAX })
  check('budgetPerPersonInr', input.budgetPerPersonInr, { min: 0, step: 500 })
  return errors
}

export function createSubmitIntent(guided: boolean, step: CreateStep): { kind: 'advance'; step: CreateStep } | { kind: 'create' } {
  const next = nextStep(step)
  return guided && next ? { kind: 'advance', step: next } : { kind: 'create' }
}
