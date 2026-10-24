// ============ The guided flow's progress line ============
// Phone shows "Step 3 of 6" and six segments. Tablet and larger show a labelled
// list where a completed step is a link. Both read the same two facts - the
// current step and which steps are complete - so the two sizes cannot disagree.
//
// The rules are pure: what is complete, what the label says, and which steps are
// reachable. The component below only draws them.

import { CREATE_STEPS, CREATE_STEP_QUESTION, stepNumber, stepIsComplete, type CreateStep } from './createSteps'

/** "Step 3 of 6" - the phone form. */
export function stepCounterLabel(step: CreateStep): string {
  return `Step ${stepNumber(step)} of ${CREATE_STEPS.length}`
}

/**
 * What the progress line says under the counter.
 *
 * Deliberately silent when the current step is the one that is incomplete: the
 * traveller can see the empty field in front of them, and a sentence telling
 * them it is empty is noise. It speaks only about the REST of the flow.
 */
export function remainingStepsLabel(step: CreateStep, errors: Record<string, string>): string {
  const after = CREATE_STEPS.slice(stepNumber(step))
  const blocked = after.filter(s => !stepIsComplete(s, errors))
  if (blocked.length === 0) return after.length === 0 ? 'Last step' : 'Nothing else to fill in'
  if (blocked.length === 1) return `One thing left: ${CREATE_STEP_QUESTION[blocked[0]].toLowerCase()}`
  return `${blocked.length} things left after this`
}

/**
 * The steps a traveller may jump to: any step at or before the first incomplete
 * one. Jumping past an empty step would land them on a screen that cannot
 * finish, so the list never offers it.
 */
export function reachableSteps(errors: Record<string, string>): CreateStep[] {
  const firstOpen = CREATE_STEPS.findIndex(s => !stepIsComplete(s, errors))
  const upTo = firstOpen < 0 ? CREATE_STEPS.length - 1 : firstOpen
  return CREATE_STEPS.slice(0, upTo + 1)
}

/** True when a completed step should be a link rather than plain text. */
export function stepIsLink(step: CreateStep, current: CreateStep, errors: Record<string, string>): boolean {
  if (step === current) return false
  return reachableSteps(errors).includes(step)
}
