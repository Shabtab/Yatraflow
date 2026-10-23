// ============ The guided flow: copy and accessibility ============
// Step 10 of the build. The STE gate covers prose; these cover the parts of
// accessibility that live in markup, which no node test can render: a labelled
// navigation landmark, a real button for every action, a heading to announce, and
// errors that name their control.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const shell = readFileSync('src/components/CreateFlowShell.tsx', 'utf8')
const page = readFileSync('src/pages/CreateTrip.tsx', 'utf8')

describe('the progress landmark', () => {
  it('is a nav with an accessible name', () => {
    // A bare <nav> is announced as "navigation" with no clue which one; the
    // page has a main nav too.
    expect(shell).toMatch(/<nav className="ct-progress" aria-label="Progress">/)
  })

  it('marks the current step with aria-current', () => {
    // aria-current="step" is the value screen readers announce as "current step".
    expect(shell).toContain("aria-current={s === step ? 'step' : undefined}")
  })

  it('uses a real button for a step you can go back to', () => {
    // A div with onClick is not reachable by keyboard. The link path is a button.
    expect(shell).toContain('<button type="button" className="ct-progress-link"')
  })

  it('keeps a non-reachable step as plain text, not a disabled button', () => {
    // A disabled button is skipped by screen readers, so the traveller would not
    // hear that the step exists at all.
    expect(shell).toContain('<span className="ct-progress-plain">')
    expect(shell).not.toContain('disabled={!stepIsLink')
  })
})

describe('every action is a real control', () => {
  it('Back and Next are buttons, never clickable spans', () => {
    expect(shell).toMatch(/<button type="button" className="btn btn-outline ct-back"/)
    expect(shell).toMatch(/<button type="button" className="btn btn-primary ct-next"/)
  })

  it('Review\'s action submits the form it belongs to', () => {
    // The form owns submit(); a plain button would need its own handler and
    // could bypass the double-submit guard.
    expect(shell).toMatch(/<button type="submit" form="yf-create-form" className="btn btn-primary ct-create">/)
  })

  it('the Review Change link names its row, not just "Change"', () => {
    // Six "Change" buttons in a list are six identical names without this.
    expect(page).toMatch(/Change<span className="sr-only"> \{line\.label\}<\/span>/)
  })
})

describe('a step change announces itself', () => {
  it('moves focus to the new step heading', () => {
    expect(shell).toContain("document.querySelector<HTMLElement>('.ct-panel > *:not([hidden]) h2')")
    expect(shell).toContain("heading.setAttribute('tabindex', '-1')")
    expect(shell).toContain('heading.focus()')
  })

  it('does not steal focus on first render', () => {
    // Arriving on the page is App's business; grabbing focus here would fight it.
    expect(shell).toMatch(/if \(first\.current\) \{ first\.current = false; return \}/)
  })

  it('only finds the VISIBLE step, because the others are held with `hidden`', () => {
    // `hidden` is what the flow uses to hold the other five steps, so the
    // selector's `:not([hidden])` is what makes it find the right heading.
    expect(shell).toContain(':not([hidden]) h2')
  })
})

describe('the page still has one h1 on a phone', () => {
  it('renders PageHeader, which owns the h1', () => {
    // Step 10's requirement: a screen reader lands on a real page title before
    // the six steps. PageHeader renders it; the page must keep using it.
    expect(page).toContain('<PageHeader')
    expect(page).toContain('headline={{ lead:')
  })

  it('does not add a second h1 in the flow', () => {
    const h1s = [...page.matchAll(/<h1[\s>]/g)]
    expect(h1s).toHaveLength(0)
  })
})

describe('the honest "what is left" line is announced politely', () => {
  it('is a status region, so it does not interrupt', () => {
    // It changes on every step, and it is advice rather than a failure.
    expect(shell).toMatch(/<span className="ct-nav-left" role="status">/)
  })
})
