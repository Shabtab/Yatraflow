// ============ The guided flow's step, in the address ============
// A step that lives only in component state has two problems the moment the flow
// has more than one screen: Back leaves the page instead of going back a step,
// and a reload loses the traveller's place. Both are fixed by putting the step
// in the address.
//
// Two different URL writes, and the difference is the whole point:
//   - Moving between steps uses `navigate`, so each step is a history entry and
//     the browser's Back button steps backwards. That is the behaviour the spec
//     promises ("Browser Back moves one step").
//   - Anything that is NOT a step change (a validation error, a drawer opening)
//     must not touch the address at all, or Back would have to be pressed once
//     per keystroke.
//
// Pure module: no react, no DOM. The page passes the route string in, so the
// rule is testable in node (AGENTS §1).

import { CREATE_STEPS, type CreateStep } from './createSteps'

/** The query key. Short because it appears in every create URL. */
export const STEP_PARAM = 'step'

/** Is this string one of the six steps? */
export function isCreateStep(value: unknown): value is CreateStep {
  return typeof value === 'string' && (CREATE_STEPS as readonly string[]).includes(value)
}

/**
 * The step an address names, or the first step when it names none.
 *
 * An unrecognised value falls back rather than throwing: `/create?step=packing`
 * is a URL a person can type, a bookmark can hold, or an older build can leave
 * behind. The flow opens at the start, which is always a valid screen.
 */
export function stepFromQuery(query: URLSearchParams | string): CreateStep {
  const params = typeof query === 'string' ? new URLSearchParams(query) : query
  const raw = params.get(STEP_PARAM)
  return isCreateStep(raw) ? raw : CREATE_STEPS[0]
}

/**
 * The address for a step: `/create?step=when`.
 *
 * The first step carries no parameter, so the commonest address is the plain
 * `/create`. A `?step=where` would be the same screen under a longer name, and
 * two addresses for one screen is how a share link starts disagreeing with what
 * the sender saw.
 */
export function stepHref(step: CreateStep, base = '/create'): string {
  if (step === CREATE_STEPS[0]) return base
  return `${base}?${STEP_PARAM}=${step}`
}

/**
 * Which step a Back press lands on, or null when Back leaves the flow.
 *
 * Returning null at the first step matters: the flow must not push a synthetic
 * history entry to "catch" Back at the start, because that would make Back do
 * nothing at all — a worse failure than leaving the page.
 */
export function previousStep(step: CreateStep): CreateStep | null {
  const i = CREATE_STEPS.indexOf(step)
  return i > 0 ? CREATE_STEPS[i - 1] : null
}

/** The next step, or null at Review (where the action is Create, not Next). */
export function nextStep(step: CreateStep): CreateStep | null {
  const i = CREATE_STEPS.indexOf(step)
  return i >= 0 && i < CREATE_STEPS.length - 1 ? CREATE_STEPS[i + 1] : null
}
