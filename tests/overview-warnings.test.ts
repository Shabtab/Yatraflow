// ============ #401 — the Overview's warning rows agree with themselves ============
// Two "top 3" lists disagreed (severity-sorted vs emission order), duplicate
// keys merged distinct rows, severity was icon-only, and the count chip cried
// wolf on all-low trips. One rank, data keys, said severity, honest tone.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { ScheduleWarning } from '../src/lib/engine'
import { rankWarnings, warningKey, maxWarningSeverity, severityLead } from '../src/lib/overviewWarnings'

function warning(over: Partial<ScheduleWarning> & { title: string }): ScheduleWarning {
  return {
    code: 'density', severity: 'low', detail: '', fix: '',
    ...over,
  }
}

describe('#401 — one rank for both lists', () => {
  it('orders a Day-1 low behind a Day-4 high in the same output both lists read', () => {
    const day1Low = warning({ title: 'Day 1: busy', severity: 'low', dayIndex: 0 })
    const day4High = warning({ title: 'Day 4: heavy travel time', severity: 'high', dayIndex: 3 })
    const ranked = rankWarnings([day1Low, day4High])
    expect(ranked.map(w => w.title)).toEqual([day4High.title, day1Low.title])
  })

  it('keeps emission order inside one band (stable, not alphabetical)', () => {
    const first = warning({ code: 'meals', title: 'B lunch', severity: 'medium', dayIndex: 1 })
    const second = warning({ code: 'hours', title: 'A hours', severity: 'medium', dayIndex: 0 })
    expect(rankWarnings([first, second]).map(w => w.title)).toEqual(['B lunch', 'A hours'])
  })

  it('does not mutate the input array', () => {
    const rows = [warning({ title: 'low', severity: 'low' }), warning({ title: 'high', severity: 'high' })]
    rankWarnings(rows)
    expect(rows.map(w => w.title)).toEqual(['low', 'high'])
  })
})

describe('#401 — keys are data, never the rendered title', () => {
  it('mounts same-titled warnings on different days as two rows', () => {
    const a = warning({ code: 'commitment', title: 'Airport check-in', dayIndex: 0 })
    const b = warning({ code: 'commitment', title: 'Airport check-in', dayIndex: 2 })
    expect(warningKey(a)).not.toBe(warningKey(b))
  })

  it('keeps trip-wide rows out of every day bucket', () => {
    const wide = warning({ code: 'hotels', title: 'Accommodation churn', dayIndex: null })
    const day0 = warning({ code: 'hotels', title: 'Accommodation churn', dayIndex: 0 })
    expect(warningKey(wide)).not.toBe(warningKey(day0))
    expect(warningKey(wide)).toContain('trip')
  })

  it('is stable: the same warning keys identically every render', () => {
    const w = warning({ code: 'travel', title: 'Day 2: heavy travel time', severity: 'high', dayIndex: 1 })
    expect(warningKey(w)).toBe(warningKey({ ...w }))
  })
})

describe('#401 — tone follows the severest warning present', () => {
  it('reports low for an all-low trip (the chip must not wear saffron)', () => {
    expect(maxWarningSeverity([
      warning({ title: 'a', severity: 'low' }),
      warning({ title: 'b', severity: 'low', dayIndex: 1 }),
    ])).toBe('low')
  })

  it('reports high over medium and low', () => {
    expect(maxWarningSeverity([
      warning({ title: 'a', severity: 'low' }),
      warning({ title: 'b', severity: 'medium' }),
      warning({ title: 'c', severity: 'high' }),
    ])).toBe('high')
  })

  it('reports null when there is nothing to tone', () => {
    expect(maxWarningSeverity([])).toBeNull()
  })

  it('says every band aloud (severity is icon-only on screen)', () => {
    for (const sev of ['high', 'medium', 'low'] as const) {
      expect(severityLead(sev)).toMatch(/severity:/i)
    }
    expect(new Set(['high', 'medium', 'low'].map(severityLead)).size).toBe(3)
  })
})

describe('#401 — OverviewTab reads the shared rules (source)', () => {
  const page = readFileSync(new URL('../src/pages/trip/OverviewTab.tsx', import.meta.url), 'utf8')

  it('both lists slice the same ranked array', () => {
    expect(page.split('rankedWarnings.slice(0, 3)').length - 1).toBe(2)
    expect(page).not.toContain('health.warnings.slice(0, 3)')
  })

  it('both rows key on data and announce severity', () => {
    expect(page.split('warningKey(w)').length - 1).toBe(2)
    expect(page.split('severityLead(w.severity)').length - 1).toBe(2)
    expect(page).not.toContain('w.code + w.title')
  })

  it('the count chip reads its tone, never a hardcoded alarm', () => {
    expect(page).toContain('className={countTone}')
  })
})
