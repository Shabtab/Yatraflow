// #424 — the mutation lifecycle contract.
//
// Two halves, on purpose:
//
//   1. the pure rules (phases, the direct-write predicate, the destructive-stop
//      composer) behave as documented;
//   2. the SOURCE invariants — a stop removal can only be composed in one place,
//      the refusal is spoken with one sentence, and a direct store writer has to
//      be declared. That second half is what makes "the same action behaves the
//      same way on every surface" true by construction instead of by three
//      copies agreeing with each other by luck.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Trip } from '../src/data/types'
import {
  MUTATION_PHASES,
  PHASE_MEANING,
  RECOVERY_MEANING,
  blocksDirectWrite,
  refuseWhileStaged,
  removeStopWithUndo,
  removalMessage,
  MUTATION_RECOVERY,
  DIRECT_WRITE_ALLOWLIST,
  nonDestructiveStoreWrites,
  supersededPaths,
  type ApplyChange,
  type MutationRecovery,
} from '../src/lib/mutationLifecycle'

function tripFixture(): Trip {
  return {
    id: 't1',
    title: 'Goa Long Weekend',
    days: [
      {
        index: 0,
        stops: [
          { id: 'a', title: 'Anjuna Flea Market', orderInDay: 1, lat: 15.58, lng: 73.74 },
          { id: 'b', title: 'Chapora Fort', orderInDay: 2, lat: 15.61, lng: 73.73 },
        ],
      },
      {
        index: 1,
        stops: [
          { id: 'c', title: 'Basilica de Bom Jesus', orderInDay: 1, lat: 15.5, lng: 73.91 },
          { id: 'd', title: 'Fontainhas', orderInDay: 2, lat: 15.49, lng: 73.83 },
          { id: 'e', title: 'Dona Paula', orderInDay: 3, lat: 15.45, lng: 73.8 },
        ],
      },
    ],
  } as unknown as Trip
}

describe('mutation phases', () => {
  it('names the four phases, and says what each one promises', () => {
    expect(MUTATION_PHASES).toEqual(['staged', 'kept', 'discarded', 'undone'])
    for (const phase of MUTATION_PHASES) {
      expect(PHASE_MEANING[phase]).toBeTruthy()
      expect(PHASE_MEANING[phase].length).toBeGreaterThan(30)
    }
  })
})

describe('blocksDirectWrite', () => {
  it('is false when nothing is staged — the shapes the callers actually hold', () => {
    expect(blocksDirectWrite(null)).toBe(false)
    expect(blocksDirectWrite(undefined)).toBe(false)
    expect(blocksDirectWrite(false)).toBe(false)
    expect(blocksDirectWrite(0)).toBe(false)
    expect(blocksDirectWrite('')).toBe(false)
    // An empty collection is "nothing staged", not "something staged": the map
    // and the timeline hold staged ids as a Set, and reading an empty one as
    // blocked would refuse a write for no reason.
    expect(blocksDirectWrite(new Set())).toBe(false)
    expect(blocksDirectWrite([])).toBe(false)
  })

  it('is true when a staged change exists, whatever shape carries it', () => {
    expect(blocksDirectWrite(true)).toBe(true)
    expect(blocksDirectWrite({ proposed: tripFixture() })).toBe(true)
    expect(blocksDirectWrite(new Set(['stop-1']))).toBe(true)
    expect(blocksDirectWrite(['stop-1'])).toBe(true)
  })
})

describe('refuseWhileStaged', () => {
  it('lets the write through when nothing is staged', () => {
    expect(refuseWhileStaged(false)).toBe(false)
    expect(refuseWhileStaged(undefined)).toBe(false)
    expect(refuseWhileStaged(null)).toBe(false)
  })

  it('refuses, once, when a preview is open', () => {
    expect(refuseWhileStaged(true)).toBe(true)
    expect(refuseWhileStaged({ proposed: tripFixture() })).toBe(true)
  })
})

describe('removeStopWithUndo — the one destructive-stop path', () => {
  it('stages a removal through the impact preview and leaves a way back', () => {
    const trip = tripFixture()
    const calls: Array<{ kind: string; dayIndex: number; onKept?: () => void }> = []
    const applyChange: ApplyChange = (_mutator, kind, dayIndex, onKept) => {
      calls.push({ kind, dayIndex, onKept })
    }

    const outcome = removeStopWithUndo({ trip, stopId: 'c', dayIndex: 1, applyChange })

    expect(outcome).toBe('staged-undo')
    expect(calls).toHaveLength(1)
    expect(calls[0].kind).toBe('remove')
    expect(calls[0].dayIndex).toBe(1)
    expect(typeof calls[0].onKept).toBe('function')
  })

  it('removes the stop and renumbers the survivors when the proposal is applied', () => {
    const trip = tripFixture()
    let mutator: ((draft: Trip) => void) | null = null
    const applyChange: ApplyChange = (m) => { mutator = m }

    removeStopWithUndo({ trip, stopId: 'c', dayIndex: 1, applyChange })

    const draft = tripFixture()
    mutator!(draft)
    expect(draft.days[1].stops.map(s => s.id)).toEqual(['d', 'e'])
    // 1..n again — the next add cannot mint a duplicate order.
    expect(draft.days[1].stops.map(s => s.orderInDay)).toEqual([1, 2])
    // The untouched day is untouched.
    expect(draft.days[0].stops.map(s => s.id)).toEqual(['a', 'b'])
  })

  it('offers no Undo for a stop that is not in the row, and says so', () => {
    let onKept: (() => void) | undefined
    let captured = false
    const applyChange: ApplyChange = (_m, _k, _d, kept) => { captured = true; onKept = kept }

    expect(removeStopWithUndo({ trip: tripFixture(), stopId: 'missing', dayIndex: 0, applyChange })).toBe('staged')
    expect(captured).toBe(true)
    expect(onKept).toBeUndefined()
  })

  it('never writes the row itself — it only stages', () => {
    // The composer receives applyChange and nothing store-shaped, and calling it
    // with a trip the store does not know must not throw (the old map path wrote
    // straight to the cache; that is the divergence this removes).
    const applyChange = vi.fn<ApplyChange>()
    expect(() => removeStopWithUndo({ trip: tripFixture(), stopId: 'c', dayIndex: 1, applyChange })).not.toThrow()
    expect(applyChange).toHaveBeenCalledTimes(1)
  })

  it('names the day the stop will come back to', () => {
    expect(removalMessage('Fontainhas', 1)).toBe('“Fontainhas” removed from Day 2')
  })
})

describe('the declared recovery table covers the store (source)', () => {
  it('classifies every destructive store write — nothing may go undeclared', () => {
    // The audit for "every destructive action has Undo or a confirmation" is only
    // true while it keeps being asked: a new `deleteX()` in the store must land in
    // one of exactly three buckets, and choosing which one is a decision someone
    // has to make in review.
    const store = readFileSync('src/store/store.ts', 'utf8').replace(/\r\n/g, '\n')
    const names = [...store.matchAll(/^export (?:async )?function (\w+)/gm)].map(m => m[1])
    const destructive = names.filter(n => /^(delete|remove|purge|trash|clear|decline|unpublish|admin)/.test(n))
    expect(destructive.length).toBeGreaterThan(5) // the scan found the store, not an empty file

    const declared = new Set(MUTATION_RECOVERY.map(r => r.storeCall).filter(Boolean) as string[])
    const excused = new Set<string>()
    for (const fn of nonDestructiveStoreWrites()) excused.add(fn.name)
    for (const fn of supersededPaths()) excused.add(fn.name)

    const undeclared = destructive.filter(n => !declared.has(n) && !excused.has(n))
    expect(undeclared).toEqual([])

    // …and the table may not name a function the store does not export.
    const ghosts = [...declared].filter(n => !names.includes(n))
    expect(ghosts).toEqual([])
  })
})

describe('the declared recovery table', () => {
  it('declares a recovery for every destructive action, with no placeholders', () => {
    const seen = new Set<string>()
    const recoveries = Object.keys(RECOVERY_MEANING) as MutationRecovery[]
    expect(recoveries.sort()).toEqual(['confirm', 'marker', 'regenerated', 'undo'])
    for (const row of MUTATION_RECOVERY) {
      expect(seen.has(row.action)).toBe(false) // ids are the join key — unique
      seen.add(row.action)
      expect(recoveries).toContain(row.recovery)
      expect(row.surfaces.length).toBeGreaterThan(0)
      expect(row.why.length).toBeGreaterThan(40)
      // Every recovery value has to mean something a reader can act on.
      expect(RECOVERY_MEANING[row.recovery].length).toBeGreaterThan(20)
    }
  })

  it('never leans on "regenerated" for something that is merely gone', () => {
    // `regenerated` is the only escape from "restore or ask first", so it carries
    // the burden of proof: such a row must say what re-derives the thing.
    for (const row of MUTATION_RECOVERY.filter(r => r.recovery === 'regenerated')) {
      expect(row.why, `${row.action} must name what re-derives it`).toMatch(/re-deriv|re-plan|re-scan|recompute/i)
    }
  })

  it('offers Undo for every stop removal and for trashing a trip', () => {
    const byAction = new Map(MUTATION_RECOVERY.map(r => [r.action, r.recovery]))
    expect(byAction.get('stop.remove')).toBe('undo')
    expect(byAction.get('stop.remove-from-fill')).toBe('undo')
    expect(byAction.get('trip.trash')).toBe('undo')
    // The one action Undo cannot honestly cover.
    expect(byAction.get('trip.purge')).toBe('confirm')
  })
})

// ---------------------------------------------------------------------------
// Source invariants. These read the tree, so they fail on the next surface that
// reaches around the lifecycle rather than on the user who clicks it.
// ---------------------------------------------------------------------------

function srcFiles(rel = 'src'): string[] {
  const out: string[] = []
  for (const entry of readdirSync(rel, { withFileTypes: true })) {
    const p = join(rel, entry.name)
    if (entry.isDirectory()) out.push(...srcFiles(p))
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) out.push(p)
  }
  // Forward slashes so the expectations read the same on every platform.
  return out.map(p => p.replace(/\\/g, '/'))
}
const read = (p: string) => readFileSync(p, 'utf8')
const CRLF = /\r\n/g
const filesWith = (needle: string) => srcFiles().filter(f => read(f).replace(CRLF, '\n').includes(needle))

describe('one destructive-stop path (source)', () => {
  it('composes a stop removal in exactly one place', () => {
    expect(filesWith('removeStopFromDay(').sort()).toEqual([
      'src/lib/mutationLifecycle.ts',
      'src/lib/stopOrder.ts',
    ])
  })

  it('puts a deleted stop back from exactly one place', () => {
    // store.ts defines restoreStop (and only the lifecycle calls it) — so a
    // surface cannot hand-roll its own Undo beside the shared one.
    expect(filesWith('restoreStop(').sort()).toEqual([
      'src/lib/mutationLifecycle.ts',
      'src/store/store.ts',
    ])
  })

  it('gives Timeline, Board and Map the same call, with no surface-specific variant', () => {
    const surfaces = ['src/pages/trip/TimelineTab.tsx', 'src/components/BoardView.tsx', 'src/pages/trip/MapTab.tsx']
    for (const file of surfaces) {
      const src = read(file).replace(CRLF, '\n')
      const call = src.match(/removeStopWithUndo\(\{[^}]*\}\)/)
      expect(call, `${file} must delete through the shared composer`).toBeTruthy()
      // Same four arguments everywhere: if a surface grows a variant (its own
      // label, its own day resolution), this fails and the divergence has to be
      // argued for rather than merged quietly.
      // Keys are written both ways in this tree (`trip` shorthand, `dayIndex:
      // meta.dayIndex`), so read the identifier before any colon.
      const keys = call![0]
        .replace(/^removeStopWithUndo\(\{|\}\)$/g, '')
        .split(',')
        .map(a => a.trim().split(':')[0].trim())
        .filter(Boolean)
        .sort()
      expect(keys, `${file} must pass the same lifecycle keys`).toEqual(['applyChange', 'dayIndex', 'stopId', 'trip'])
    }
  })

  it('names each direct store writer in the allowlist', () => {
    const allowed = DIRECT_WRITE_ALLOWLIST.map(a => a.file).concat(['src/store/store.ts'])
    for (const file of filesWith('deleteStop(')) {
      expect(allowed, `${file} writes a removal directly and is not declared`).toContain(file)
    }
    // The allowlist is not decorative: the entries it names must really contain one.
    for (const file of DIRECT_WRITE_ALLOWLIST.map(a => a.file)) {
      expect(read(file).replace(CRLF, '\n')).toContain('deleteStop(')
    }
  })
})

describe('one refusal wording (source)', () => {
  it('speaks the busy message from one place only', () => {
    expect(filesWith('PREVIEW_BUSY').sort()).toEqual([
      'src/lib/mutationLifecycle.ts',
      'src/lib/previewChain.ts',
    ])
  })

  it('routes every direct writer through the shared refusal', () => {
    const surfaces = [
      'src/pages/trip/TimelineTab.tsx',
      'src/components/BoardView.tsx',
      'src/pages/trip/BudgetTab.tsx',
      'src/pages/trip/GroupInputTab.tsx',
    ]
    for (const file of surfaces) {
      const src = read(file).replace(CRLF, '\n')
      expect(src, `${file} must refuse through the shared rule`).toContain('refuseWhileStaged(')
      // No surface keeps a hand-rolled guard beside it.
      expect(src, `${file} still holds a pasted guard`).not.toMatch(/if \(previewOpen\) \{ toast\(/)
    }
  })
})
