// ============ Create funnel: the six steps, and which step owns an error ============
// The guided flow asks one question per screen, so it needs two things the long
// form never did: the ordered list of steps, and the rule that turns a submit
// error into the step that has to be shown to fix it.
//
// Both live here as pure functions, for three reasons:
//   1. `submit()` and the guided shell must agree. Two copies of "which step owns
//      `endDate`" would drift the first time one of them changed.
//   2. `createReadiness` already promises to mirror submit() exactly (see the
//      CONTRACT in createReadiness.ts). One validator keeps that promise cheap.
//   3. `tests/` runs in node with no DOM, so a rule that only exists inside a
//      component cannot be tested at all (AGENTS §1).
//
// The messages below are the SAME strings the long form already showed. This
// module moves them; it does not reword them. Copy changes are their own commit.

import { CREW_MAX, CREW_MIN } from './crew'

/** The six steps, in the order the traveller walks them. */
export type CreateStep = 'where' | 'how' | 'when' | 'who' | 'budget' | 'review'

/** Ordered, so progress ("Step 3 of 6") and the step list agree by construction. */
export const CREATE_STEPS: readonly CreateStep[] = ['where', 'how', 'when', 'who', 'budget', 'review'] as const

/** The question each step asks. The guided shell renders these as its h2. */
export const CREATE_STEP_QUESTION: Record<CreateStep, string> = {
  where: 'Where are you going?',
  how: 'How are you travelling?',
  when: 'When do you leave?',
  who: 'Who’s coming?',
  budget: 'What is your budget?',
  review: 'Check and create',
}

/** 1-based position, for "Step 3 of 6". */
export function stepNumber(step: CreateStep): number {
  return CREATE_STEPS.indexOf(step) + 1
}

/**
 * The primary action's label, wherever it is rendered.
 *
 * One constant, because the page renders this button in three places (the ticket
 * rail, the phone dock, and the Review step's own action). They said "Start
 * planning" while the Review step's heading said "Check and create" - the same
 * button under two names, which reads as two different actions.
 *
 * The heading wins: it describes what the press does. "Start planning" promises
 * a plan; the press creates a trip and opens its workspace.
 */
export const CREATE_ACTION_LABEL = 'Check and create'

/** What the button says while the request is in flight. */
export const CREATE_ACTION_BUSY_LABEL = 'Creating…'

/**
 * Every error key the create form can produce, and the step that owns it.
 *
 * The mapping follows where the CONTROL lives, not where the value is used. A
 * departure time is read by the schedule, but it is a field on the When screen,
 * so `dayStartTime` belongs to `when`: sending the traveller anywhere else means
 * showing them a screen with nothing to fix on it.
 *
 * `name` and `composerRow` are `review` because the guided flow suggests the trip
 * name on Review and hangs "Add details" (the pinned-plan row) off Review. They
 * are the only two keys that can be wrong while the step they sit on is open.
 */
const ERROR_STEP: Record<string, CreateStep> = {
  startLocation: 'where',
  destinations: 'where',
  // The return leg is planned on How, beside the mode that decides whether a
  // drive back is even possible. Its error has to follow the control.
  returnStops: 'how',
  drivesPart: 'how',
  fuelEconomy: 'how',
  fuelPrice: 'how',
  tankL: 'how',
  rentPerDay: 'how',
  startDate: 'when',
  endDate: 'when',
  dayStartTime: 'when',
  travellers: 'who',
  budgetPerPersonInr: 'budget',
  name: 'review',
  composerRow: 'review',
  composerTime: 'review',
}

/**
 * The step that can fix `key`.
 *
 * An unknown key returns `where`, the first step. That is deliberate: a new error
 * key must not silently point at the last step, because the guided shell would
 * then open Review on a form that is not ready and offer a Create button that
 * cannot work. Failing to the first step keeps the traveller in the flow and
 * makes the omission visible in review. `tests/create-steps.test.ts` pins the
 * known keys, so an unknown one fails there rather than in the browser.
 */
export function stepOfError(key: string): CreateStep {
  return ERROR_STEP[key] ?? 'where'
}

/** The earliest step that has anything wrong, or null when the form is valid. */
export function firstErrorStep(errors: Record<string, string>): CreateStep | null {
  let best: CreateStep | null = null
  for (const key of Object.keys(errors)) {
    const step = stepOfError(key)
    if (best === null || stepNumber(step) < stepNumber(best)) best = step
  }
  return best
}

/** Everything `validateCreate` needs. Deliberately flat: no React, no form refs. */
export interface CreateInput {
  name: string
  startLocation: string
  /** What sits in the outbound "add a stop" field, picked or not. */
  destInput: string
  /** How many stops are actually pinned to the map. */
  stopCount: number
  returnInput: string
  /** False when the trip has no custom return leg, so that field is not rendered. */
  returnOpen: boolean
  /** What sits in the pinned-plan row, added or not. */
  composerTitle: string
  startDate: string
  endDate: string
  travellers: number
  budgetPerPersonInr: number
  /** True only for a Mixed trip with no driving answer yet. */
  mustAnswerDriving: boolean
  /** Result of `unpickedStopErrors`; passed in so this module stays dependency-free. */
  unpicked: { destinations?: string; returnStops?: string }
  /** Result of `composerRowError`; null when the row is empty. */
  composerError: string | null
}

/** Field name → message. The key set is what F-15 focuses and what the steps read. */
export type CreateErrors = Record<string, string>

/**
 * The single validator. `submit()` calls this, and the guided shell calls it to
 * decide whether a step is complete.
 *
 * Order matters: it is the order F-15 focuses, so the first key is the first
 * thing a keyboard user lands on.
 */
export function validateCreate(input: CreateInput): CreateErrors {
  const next: CreateErrors = {}
  if (!input.name.trim()) next.name = 'Name your trip.'
  if (!input.startLocation.trim()) next.startLocation = 'Where does the journey start?'
  // #375: text typed into an add-stop field but never picked used to vanish.
  // The unpicked message wins over the bare "add a destination" one: it names
  // the text the user can see in the box, which is the more useful sentence.
  if (input.unpicked.destinations) next.destinations = input.unpicked.destinations
  else if (input.stopCount === 0) next.destinations = 'Add at least one destination.'
  if (input.unpicked.returnStops) next.returnStops = input.unpicked.returnStops
  // #378: a plan typed into the composer row but never "Add"ed used to be
  // dropped at submit without a word — same honesty hole as #375.
  if (input.composerError) next.composerRow = input.composerError
  if (!input.startDate) next.startDate = 'Pick a start date.'
  if (!input.endDate) next.endDate = 'Pick an end date.'
  else if (input.startDate && new Date(input.endDate) < new Date(input.startDate)) {
    next.endDate = 'End date must be after the start date.'
  }
  if (input.travellers < CREW_MIN) next.travellers = 'At least one traveller!'
  else if (input.travellers > CREW_MAX) next.travellers = `Split groups over ${CREW_MAX} into multiple trips.`
  // #213 Phase 5: the floor is the crew helper's, not a magic 500 — Trip
  // settings allows ₹0 (= "no per-person target", which the pacing tile
  // already renders honestly), so the two surfaces agree.
  if (input.budgetPerPersonInr < 0) next.budgetPerPersonInr = 'A budget cannot be negative.'
  // A new Mixed trip cannot be created without the driving answer (2026-10-19).
  // Every other mode has no question to ask, so this blocks only Mixed.
  if (input.mustAnswerDriving) next.drivesPart = 'Answer the driving question above.'
  return next
}

/** True when `step` has no error against it. The guided shell uses this for Next. */
export function stepIsComplete(step: CreateStep, errors: CreateErrors): boolean {
  return !Object.keys(errors).some(key => stepOfError(key) === step)
}
