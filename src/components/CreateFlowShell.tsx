// ============ The guided create flow's frame ============
// Progress, Back, Next, and the focus move that makes a step change audible.
// The step CONTENT stays in CreateTrip.tsx: these components own only the frame,
// so a step's own fields keep their existing refs, ids and error wiring.
//
// Two pieces rather than one wrapper, because the page already has a form and a
// ticket rail in a fixed layout. A wrapper around the panel would mean either
// moving the rail or rendering the panel twice; progress and nav inside the
// existing panel keeps one copy of every field.

import { useEffect, useRef } from 'react'
import type { CreateStep } from '../lib/createSteps'
import { CREATE_STEPS, CREATE_STEP_QUESTION, CREATE_ACTION_LABEL, stepNumber } from '../lib/createSteps'
import { reachableSteps, stepCounterLabel, stepIsLink, remainingStepsLabel } from '../lib/createProgress'
import { previousStep, nextStep } from '../lib/createStepUrl'

/** The progress line: a counter and six segments on a phone, a labelled list of
 *  links from tablet width up. One list, two presentations, so they cannot
 *  disagree about which step is current. */
export function StepProgress({ step, errors, onGo }: {
  step: CreateStep
  errors: Record<string, string>
  onGo: (step: CreateStep) => void
}) {
  const reachable = reachableSteps(errors)
  return (
    <nav className="ct-progress" aria-label="Progress">
      <span className="ct-progress-count">{stepCounterLabel(step)}</span>
      <ol className="ct-progress-list">
        {CREATE_STEPS.map(s => {
          const done = s !== step && stepNumber(s) < stepNumber(step) && reachable.includes(s)
          const label = CREATE_STEP_QUESTION[s]
          const inner = (
            <>
              <span className="ct-progress-n" aria-hidden>{stepNumber(s)}</span>{label}
            </>
          )
          return (
            <li key={s} className={`ct-progress-item${s === step ? ' now' : ''}${done ? ' done' : ''}`}
              aria-current={s === step ? 'step' : undefined}>
              {stepIsLink(s, step, errors) ? (
                <button type="button" className="ct-progress-link" onClick={() => onGo(s)}>{inner}</button>
              ) : (
                <span className="ct-progress-plain">{inner}</span>
              )}
            </li>
          )
        })}
      </ol>
      <span className="ct-progress-segs" aria-hidden>
        {CREATE_STEPS.map(s => (
          <i key={s} className={s === step ? 'now' : stepNumber(s) < stepNumber(step) ? 'done' : ''} />
        ))}
      </span>
    </nav>
  )
}

/** Back, the honest "what is left" line, and Next. */
export function StepNav({ step, errors, onGo }: {
  step: CreateStep
  errors: Record<string, string>
  onGo: (step: CreateStep) => void
}) {
  const back = previousStep(step)
  const next = nextStep(step)
  const isReview = next === null
  return (
    <div className="ct-nav">
      {back ? (
        <button type="button" className="btn btn-outline ct-back" onClick={() => onGo(back)}>Back</button>
      ) : <span />}
      <span className="ct-nav-left" role="status">{remainingStepsLabel(step, errors)}</span>
      {next && (
        // Never disabled (spec §4 rule 1): a press with an incomplete answer
        // moves focus to the field that needs one, which is more use than a dead
        // button that explains nothing.
        <button type="button" className="btn btn-primary ct-next" onClick={() => onGo(next)}>
          Next: {CREATE_STEP_QUESTION[next].replace(/\?$/, '')}
        </button>
      )}
      {isReview && (
        // Review's action is Create, and it is never disabled either (spec §4
        // rule 6): a press with a blocking row moves focus to that row.
        <button type="submit" form="yf-create-form" className="btn btn-primary ct-create">
          {CREATE_ACTION_LABEL}
        </button>
      )}
    </div>
  )
}

/**
 * Move focus to the new step's heading when the step changes.
 *
 * The first render is the page arriving, and App already handles that focus, so
 * this skips it. Every later change has to announce itself: a screen reader user
 * pressing Next otherwise stays on a button while the screen swaps underneath.
 *
 * The heading is found in the step's own markup, and only in a VISIBLE block -
 * `hidden` is what the flow uses to hold the other five steps, so an unhidden
 * direct child of `.ct-panel` is the step on screen.
 */
export function useStepFocus(step: CreateStep, enabled: boolean) {
  const first = useRef(true)
  useEffect(() => {
    if (!enabled) return
    if (first.current) { first.current = false; return }
    const heading = document.querySelector<HTMLElement>('.ct-panel > *:not([hidden]) h2')
    if (!heading) return
    heading.setAttribute('tabindex', '-1')
    heading.focus()
  }, [step, enabled])
}
