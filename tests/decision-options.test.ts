// Add an option to an open decision: pure checks (node env, no DOM).
import { describe, expect, it } from 'vitest'
import {
  MAX_DECISION_OPTIONS, MAX_OPTION_LABEL_LENGTH, canAddOption, checkNewOptionLabel, findDuplicateOption, normalizeOptionLabel,
} from '../src/lib/decisionOptions'
import type { DecisionOption } from '../src/data/types'

const NOW = 1_800_000_000_000
const opts = (...labels: string[]): DecisionOption[] => labels.map((label, i) => ({ id: `o_${i}`, label }))

describe('normalizeOptionLabel', () => {
  it('trims and lower-cases', () => {
    expect(normalizeOptionLabel('  Fort  ')).toBe('fort')
    expect(normalizeOptionLabel('BEACH')).toBe('beach')
  })
})

describe('findDuplicateOption', () => {
  it('matches case-insensitively after a trim', () => {
    const options = opts('Fort', 'Beach')
    expect(findDuplicateOption(options, ' fort ')?.id).toBe('o_0')
    expect(findDuplicateOption(options, 'BEACH')?.id).toBe('o_1')
  })
  it('does not match a different label or an inner-space difference', () => {
    const options = opts('Old Fort')
    expect(findDuplicateOption(options, 'Fort')).toBeUndefined()
    expect(findDuplicateOption(options, 'Old  Fort')).toBeUndefined()
  })
})

describe('checkNewOptionLabel', () => {
  it('returns the trimmed label on success', () => {
    expect(checkNewOptionLabel(opts('Fort'), '  Market ')).toEqual({ ok: true, label: 'Market' })
  })
  it('refuses an empty or blank label', () => {
    expect(checkNewOptionLabel(opts('Fort'), '')).toEqual({ ok: false, reason: 'empty' })
    expect(checkNewOptionLabel(opts('Fort'), '   ')).toEqual({ ok: false, reason: 'empty' })
  })
  it('refuses a label over the limit, and accepts one at the limit', () => {
    expect(checkNewOptionLabel([], 'x'.repeat(MAX_OPTION_LABEL_LENGTH + 1))).toEqual({ ok: false, reason: 'too long' })
    expect(checkNewOptionLabel([], 'x'.repeat(MAX_OPTION_LABEL_LENGTH)).ok).toBe(true)
  })
  it('refuses a duplicate, whatever its case or padding', () => {
    expect(checkNewOptionLabel(opts('Fort'), 'FORT')).toEqual({ ok: false, reason: 'duplicate' })
    expect(checkNewOptionLabel(opts('Fort'), '  fort ')).toEqual({ ok: false, reason: 'duplicate' })
  })
  it('refuses a new option when the decision holds the most it can', () => {
    const full = Array.from({ length: MAX_DECISION_OPTIONS }, (_, i) => ({ id: `o_${i}`, label: `Option ${i}` }))
    expect(checkNewOptionLabel(full, 'One more')).toEqual({ ok: false, reason: 'too many options' })
    expect(checkNewOptionLabel(full.slice(1), 'One more').ok).toBe(true)
  })
  it('keeps the limits the SQL uses', () => {
    expect(MAX_DECISION_OPTIONS).toBe(20)
    expect(MAX_OPTION_LABEL_LENGTH).toBe(200)
  })
})

describe('canAddOption', () => {
  const base = { status: 'open' as const, options: opts('A', 'B') }
  it('allows an open decision with no closing time', () => {
    expect(canAddOption(base, NOW)).toBe(true)
  })
  it('allows it before the closing time and refuses it at and after', () => {
    expect(canAddOption({ ...base, closesAt: NOW + 1 }, NOW)).toBe(true)
    expect(canAddOption({ ...base, closesAt: NOW }, NOW)).toBe(false)
    expect(canAddOption({ ...base, closesAt: NOW - 1 }, NOW)).toBe(false)
  })
  it('refuses a resolved decision', () => {
    expect(canAddOption({ ...base, status: 'resolved' }, NOW)).toBe(false)
  })
  it('refuses a full decision', () => {
    const options = Array.from({ length: MAX_DECISION_OPTIONS }, (_, i) => ({ id: `o_${i}`, label: `Option ${i}` }))
    expect(canAddOption({ ...base, options }, NOW)).toBe(false)
  })
})
