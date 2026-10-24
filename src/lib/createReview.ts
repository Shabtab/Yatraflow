// ============ Review: what the trip says, in six lines ============
// The last step shows the answers and a way back to each one. It is NOT a second
// form: every line is a value and a "Change" link, so the traveller checks the
// trip rather than re-reading six screens.
//
// Pure: the page passes values in, and these functions say what each line reads
// and whether it can be changed. That keeps the wording testable in node
// (AGENTS §1) and keeps the page free of a second copy of every label.

import type { CreateStep } from './createSteps'

export interface ReviewLine {
  /** Which step owns this value - what "Change" goes back to. */
  step: CreateStep
  label: string
  /** The value as the traveller reads it, or null when it is missing. */
  value: string | null
  /** What to say instead of a value. Never blank: an empty row must explain. */
  empty: string
}

export interface ReviewInput {
  name: string
  startLocation: string
  stopNames: string[]
  startDate: string
  endDate: string
  days: number
  travellers: number
  transportLabel: string
  budgetPerPersonInr: number
  hasCover: boolean
  commitmentCount: number
}

/** ₹ with Indian digit grouping, the way every other money figure on the page reads. */
function inr(v: number): string {
  return '\u20B9' + Math.round(v).toLocaleString('en-IN')
}

/**
 * The lines Review shows, in step order.
 *
 * Step order, not importance order: the list doubles as a way to walk back
 * through the flow, and a list in the order the questions were asked is the one a
 * traveller can follow.
 */
export function reviewLines(input: ReviewInput): ReviewLine[] {
  const stops = input.stopNames.filter(s => s.trim())
  const dates = input.startDate && input.endDate
    ? `${input.startDate} to ${input.endDate}${input.days > 0 ? ` - ${input.days} day${input.days === 1 ? '' : 's'}` : ''}`
    : null
  return [
    {
      step: 'where',
      label: 'Route',
      value: stops.length > 0
        ? [input.startLocation, ...stops].filter(Boolean).join(' to ')
        : null,
      empty: 'Add where you start and where you stop.',
    },
    {
      step: 'how',
      label: 'Travelling',
      value: input.transportLabel.trim() || null,
      empty: 'Pick how you travel.',
    },
    {
      step: 'when',
      label: 'Dates',
      value: dates,
      empty: 'Pick your dates.',
    },
    {
      step: 'who',
      label: 'Party',
      value: input.travellers > 0
        ? `${input.travellers} traveller${input.travellers === 1 ? '' : 's'}`
        : null,
      empty: 'At least one traveller.',
    },
    {
      step: 'budget',
      label: 'Budget',
      value: Number.isFinite(input.budgetPerPersonInr) && input.budgetPerPersonInr >= 0
        ? `${inr(input.budgetPerPersonInr)} per person - ${inr(input.budgetPerPersonInr * input.travellers)} for the group`
        : null,
      empty: 'Set a budget per person.',
    },
  ]
}

/** The optional extras, shown separately because they never block the action. */
export function reviewOptional(input: ReviewInput): ReviewLine[] {
  return [
    {
      step: 'review',
      label: 'Trip name',
      value: input.name.trim() || null,
      empty: 'Unnamed - name it on this step.',
    },
    {
      step: 'review',
      label: 'Cover',
      value: input.hasCover ? 'Set' : null,
      empty: 'Optional',
    },
    {
      step: 'review',
      label: 'Fixed plans',
      value: input.commitmentCount > 0
        ? `${input.commitmentCount} pinned`
        : null,
      empty: 'Optional',
    },
  ]
}

/**
 * The rows that stop the action, in the order they are shown.
 *
 * A row blocks when its value is missing AND the step that owns it is mandatory.
 * The optional rows never block - that is what makes them optional, and a
 * "blocking row" that is merely optional would be a lie.
 */
export function blockingLines(lines: ReviewLine[]): ReviewLine[] {
  return lines.filter(l => l.value === null)
}
