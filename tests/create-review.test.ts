// ============ Review: what the trip says, in six lines ============
// Pure rules, node env (AGENTS §1). Review's whole job is to state the trip
// without a second form, so what matters is that each line reads correctly, that
// a missing value explains itself, and that only mandatory rows block.
import { describe, it, expect } from 'vitest'
import { reviewLines, reviewOptional, blockingLines, type ReviewInput } from '../src/lib/createReview'
import { CREATE_STEPS, stepNumber } from '../src/lib/createSteps'

function trip(over: Partial<ReviewInput> = {}): ReviewInput {
  return {
    name: 'Kerala slow coast',
    startLocation: 'Kochi',
    stopNames: ['Munnar', 'Alleppey'],
    startDate: '2026-11-14',
    endDate: '2026-11-16',
    days: 3,
    travellers: 2,
    transportLabel: 'Car',
    budgetPerPersonInr: 14500,
    hasCover: false,
    commitmentCount: 0,
    ...over,
  }
}

describe('reviewLines', () => {
  it('gives one line per required step, in step order', () => {
    const lines = reviewLines(trip())
    // Order matters: the list doubles as a way to walk back through the flow.
    expect(lines.map(l => l.step)).toEqual(['where', 'how', 'when', 'who', 'budget'])
    // And that order must match the flow's own, or "Change" walks backwards.
    const positions = lines.map(l => stepNumber(l.step))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(CREATE_STEPS.slice(0, 5)).toEqual(lines.map(l => l.step))
  })

  it('reads the route from the start through every stop', () => {
    expect(reviewLines(trip())[0].value).toBe('Kochi to Munnar to Alleppey')
  })

  it('drops a blank stop rather than printing an empty "to"', () => {
    expect(reviewLines(trip({ stopNames: ['Munnar', '  ', 'Alleppey'] }))[0].value)
      .toBe('Kochi to Munnar to Alleppey')
  })

  it('says the route is missing when there are no stops', () => {
    const line = reviewLines(trip({ stopNames: [] }))[0]
    expect(line.value).toBeNull()
    expect(line.empty).toBeTruthy()
  })

  it('reads the dates with the day count', () => {
    expect(reviewLines(trip())[2].value).toBe('2026-11-14 to 2026-11-16 - 3 days')
  })

  it('says "1 day", not "1 days"', () => {
    expect(reviewLines(trip({ days: 1 }))[2].value).toContain('1 day')
    expect(reviewLines(trip({ days: 1 }))[2].value).not.toContain('1 days')
  })

  it('says the dates are missing when either end is blank', () => {
    expect(reviewLines(trip({ endDate: '' }))[2].value).toBeNull()
  })

  it('says "1 traveller", not "1 travellers"', () => {
    expect(reviewLines(trip({ travellers: 1 }))[3].value).toBe('1 traveller')
    expect(reviewLines(trip({ travellers: 4 }))[3].value).toBe('4 travellers')
  })

  it('reads the budget per person AND for the group', () => {
    // A per-head figure alone makes the traveller do the multiplication.
    const value = reviewLines(trip())[4].value!
    expect(value).toContain('₹14,500 per person')
    expect(value).toContain('₹29,000 for the group')
  })

  it('allows a zero budget, which means "no target"', () => {
    expect(reviewLines(trip({ budgetPerPersonInr: 0 }))[4].value).toContain('₹0 per person')
  })

  it('refuses to print a negative budget as a value', () => {
    expect(reviewLines(trip({ budgetPerPersonInr: -1 }))[4].value).toBeNull()
  })

  it('never leaves a line without something to say', () => {
    // An empty row that explains nothing is the failure mode this guards: the
    // traveller sees a blank line and cannot tell what is wrong.
    const blank = reviewLines(trip({
      startLocation: '', stopNames: [], transportLabel: '', startDate: '', endDate: '',
      travellers: 0, budgetPerPersonInr: -1,
    }))
    for (const line of blank) {
      expect(line.value).toBeNull()
      expect(line.empty.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('reviewOptional', () => {
  it('lists the extras that never block', () => {
    expect(reviewOptional(trip()).map(l => l.label)).toEqual(['Trip name', 'Cover', 'Fixed plans'])
  })

  it('says an unnamed trip is unnamed rather than showing nothing', () => {
    const name = reviewOptional(trip({ name: '   ' }))[0]
    expect(name.value).toBeNull()
    expect(name.empty).toContain('Unnamed')
  })

  it('counts the pinned plans', () => {
    expect(reviewOptional(trip({ commitmentCount: 2 }))[2].value).toBe('2 pinned')
  })
})

describe('blockingLines', () => {
  it('is empty for a complete trip', () => {
    expect(blockingLines(reviewLines(trip()))).toEqual([])
  })

  it('names the rows that stop the action', () => {
    const lines = reviewLines(trip({ startDate: '', endDate: '' }))
    const blocking = blockingLines(lines)
    expect(blocking).toHaveLength(1)
    expect(blocking[0].step).toBe('when')
  })

  it('never blocks on an optional row', () => {
    // A blocking row that is merely optional would be a lie about the form.
    const optional = reviewOptional(trip({ name: '', hasCover: false, commitmentCount: 0 }))
    expect(blockingLines(optional)).toHaveLength(3)
    // ...and none of them may appear in the mandatory list's blockers.
    const mandatory = blockingLines(reviewLines(trip()))
    expect(mandatory).toEqual([])
  })

  it('reports every blocking row, not just the first', () => {
    const lines = reviewLines(trip({ stopNames: [], startDate: '', endDate: '', travellers: 0 }))
    expect(blockingLines(lines).map(l => l.step)).toEqual(['where', 'when', 'who'])
  })
})
