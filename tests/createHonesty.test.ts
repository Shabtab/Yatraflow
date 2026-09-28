// ============ #378 — create-form honesty helpers ============
// Pure rules, node env. Three silent behaviours on the create form, each fixed
// by saying so: a one-sided fuel input billed the blended rate without notice,
// a shortened trip left pinned plans pointing at days that no longer existed,
// and a plan typed into the composer row but never "Add"ed vanished at submit.
// The clamp policy is the owner call pending on the issue — these tests pin
// clamp as the default so a silent flip to drop cannot ship unnoticed.
import { describe, it, expect } from 'vitest'
import {
  fuelFallbackNotice, revalidateCommitments, commitmentMoveMessage,
  composerRowError, ticketFuelSegments,
} from '../src/lib/createHonesty'

const row = (dayIndex: number, title = `plan-${dayIndex}`) => ({ title, type: 'other' as const, dayIndex, time: '09:00' })

describe('fuelFallbackNotice', () => {
  it('stays silent when both numbers are present and parse, or both are empty', () => {
    expect(fuelFallbackNotice('car', '15', '105')).toBeNull()
    expect(fuelFallbackNotice('car', '', '')).toBeNull()
    expect(fuelFallbackNotice('car', '  ', ' ')).toBeNull()
  })

  it('names the blended rate when only a price is set (the priceIgnored shape)', () => {
    const msg = fuelFallbackNotice('car', '', '105')
    expect(msg).toContain('blended')
    expect(msg).toContain('₹9/km') // MODE_COST_PER_KM.car
  })

  it('nudges toward the price when only a mileage is set', () => {
    const msg = fuelFallbackNotice('car', '15', '')
    expect(msg).toContain('blended')
    expect(msg).toContain('₹9/km')
  })

  it('flags an out-of-band mileage (the parsers reject 2–80 / 50–250)', () => {
    expect(fuelFallbackNotice('car', '999', '105')).toContain('out of range')
    expect(fuelFallbackNotice('car', '15', '999')).toContain('out of range')
    // Out-of-band typing silently fell back too — same honesty gap.
    expect(fuelFallbackNotice('car', '999', '')).toContain('blended')
  })

  it('handles both fields out of range in one sentence', () => {
    expect(fuelFallbackNotice('car', '0', '999')).toContain('both')
  })

  it('reads the rate from the MODE, not hard-coded car', () => {
    expect(fuelFallbackNotice('motorcycle', '', '105')).toContain('₹4.5/km')
  })

  it('is mode-agnostic — the rate lookup falls back like the bill does', () => {
    // The fuel block only renders for fuel-economy modes, but the helper is
    // the one guard: it answers for whatever mode it is handed, reading the
    // same MODE_COST_PER_KM table the bill reads.
    expect(fuelFallbackNotice('train', '', '105')).toContain('₹1.6/km')
  })
})

describe('revalidateCommitments', () => {
  it('keeps every row inside the new day count untouched', () => {
    const list = [row(0), row(1), row(2)]
    const out = revalidateCommitments(list, 4)
    expect(out.kept.map(r => r.dayIndex)).toEqual([0, 1, 2])
    expect(out.movedCount).toBe(0)
    expect(out.droppedCount).toBe(0)
  })

  it('clamps a row whose day fell off the end to the LAST day, keeping its content', () => {
    const list = [row(0, 'rafting deposit'), row(4, 'train home')]
    const out = revalidateCommitments(list, 3)
    expect(out.kept).toHaveLength(2)
    expect(out.kept[1].dayIndex).toBe(2) // 3 days → last index 2
    expect(out.kept[1].title).toBe('train home') // what was typed survives
    expect(out.movedCount).toBe(1)
  })

  it('clamps every overflow row to the same last day', () => {
    const out = revalidateCommitments([row(2), row(3), row(4)], 3)
    expect(out.kept.every(r => r.dayIndex === 2)).toBe(true)
    expect(out.movedCount).toBe(2)
  })

  it('never leaves a dangling dayIndex — the issue’s core invariant', () => {
    for (const dayCount of [1, 2, 5]) {
      for (const d of [0, 3, 9]) {
        const out = revalidateCommitments([row(d)], dayCount)
        expect(out.kept.every(r => r.dayIndex >= 0 && r.dayIndex < dayCount)).toBe(true)
      }
    }
  })

  it('offers the drop policy for the owner’s alternative', () => {
    const out = revalidateCommitments([row(0), row(4)], 3, 'drop')
    expect(out.kept).toHaveLength(1)
    expect(out.droppedCount).toBe(1)
    expect(out.movedCount).toBe(0)
  })

  it('keeps every row when the day count is not a usable span (dates gone)', () => {
    const list = [row(0), row(5)]
    for (const bad of [0, -1, NaN]) {
      const out = revalidateCommitments(list, bad)
      expect(out.kept).toHaveLength(2)
      expect(out.movedCount).toBe(0)
    }
  })
})

describe('commitmentMoveMessage', () => {
  it('says what moved, singular and plural', () => {
    expect(commitmentMoveMessage(1)).toContain('1 pinned plan moved to the last day')
    expect(commitmentMoveMessage(2)).toContain('2 pinned plans moved to the last day')
  })

  it('joins both counts and stays empty when nothing happened', () => {
    expect(commitmentMoveMessage(1, 1)).toContain('moved')
    expect(commitmentMoveMessage(1, 1)).toContain('dropped')
    expect(commitmentMoveMessage(0, 0)).toBe('')
  })
})

describe('composerRowError', () => {
  it('blocks a typed-but-unadded plan and names the text', () => {
    const msg = composerRowError('Houseboat boarding')
    expect(msg).toContain('Houseboat boarding')
    expect(msg).toContain('Add')
  })

  it('collapses whitespace but never treats it as a plan', () => {
    expect(composerRowError('   ')).toBeNull()
    expect(composerRowError(' Multi  word ')).toContain('Multi word')
  })

  it('truncates a long title instead of printing a paragraph', () => {
    const msg = composerRowError('a'.repeat(80))
    // 47 shown + the fixed sentence around it — bounded, not the 80 typed.
    expect(msg!.length).toBeLessThan(100)
    expect(msg).not.toContain('a'.repeat(60))
  })
})

describe('ticketFuelSegments', () => {
  it('prints only what the bill parsed — raw junk never reaches the ticket', () => {
    expect(ticketFuelSegments('15', '105', '45')).toEqual(['15 km/L', '₹105/L', '45 L tank'])
    expect(ticketFuelSegments('abc', '', '')).toEqual([]) // old line printed "abc km/L"
    expect(ticketFuelSegments('999', '105', '')).toEqual(['₹105/L']) // out-of-band mileage dropped
  })

  it('needs the economy before it shows a tank (km per tank is economy × litres)', () => {
    expect(ticketFuelSegments('', '105', '45')).toEqual(['₹105/L'])
    expect(ticketFuelSegments('15', '', '9999')).toEqual(['15 km/L'])
  })
})
