// ============ P15 R23 — the admin console says what it could read ============
// Every panel below reads from the admin-widened hydrate, and a failed read
// leaves the cache empty. Before this the console printed a zero, an empty
// table or "no users match" for a read it never made, which is the same conflation
// #704 fixed on the creator hub. The verdicts come from the shared readState
// module, so these pins call the real functions rather than restating a shape.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { rowsView, sliceState, combinedReadState } from '../src/lib/readState'

const page = readFileSync(new URL('../src/pages/AdminPage.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const store = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

/** The slice verdicts the store's own READ_SLICES set, plus the trip-scoped names. */
const READS = {
  asked: (asked: string[]) => Object.fromEntries(asked.map(s => [s, 'ok' as const])),
  failed: (name: string, asked: string[]) =>
    Object.fromEntries(asked.map(s => [s, s === name ? 'failed' as const : 'ok' as const])),
}

describe('P15 R23 — the verdict vocabulary the console shares with the rest of the app', () => {
  it('an unreported slice is reading, never ready', () => {
    expect(sliceState(undefined, 'profiles')).toBe('reading')
    expect(sliceState({}, 'profiles')).toBe('reading')
    expect(sliceState(READS.asked(['profiles']), 'profiles')).toBe('ready')
    expect(sliceState(READS.failed('profiles', ['profiles']), 'profiles')).toBe('failed')
  })

  it('a combined verdict fails over any failed slice and reads over any unread one', () => {
    const asked = ['profiles', 'trips', 'suggested itineraries', 'suggestions', 'decisions', 'activity']
    expect(combinedReadState(asked.map(s => sliceState(READS.asked(asked), s)))).toBe('ready')
    expect(combinedReadState(asked.map(s => sliceState(READS.failed('activity', asked), s)))).toBe('failed')
    expect(combinedReadState(asked.map(s => sliceState(READS.failed('suggestions', asked), s)))).toBe('failed')
    // One unread slice holds the whole strip at Loading: it is not ready, and a
    // half-read strip is not a failed one either.
    const half = asked.map(s => sliceState(s === 'decisions' ? {} : READS.asked([s]) as Record<string, 'ok'>, s))
    expect(combinedReadState(half)).toBe('reading')
  })

  it('an empty array over a failed read is failed, and never empty', () => {
    expect(rowsView('failed', 0)).toBe('failed')
    expect(rowsView('reading', 0)).toBe('reading')
    // Only a read that succeeded may say there is nothing here.
    expect(rowsView('ready', 0)).toBe('empty')
    // Rows that survived a failed refresh are kept, not thrown away.
    expect(rowsView('failed', 3)).toBe('kept')
  })
})

describe('P15 R23 — every console panel reads its verdict, not the raw length', () => {
  it('the panel list is built from sliceState and rowsView', () => {
    expect(page).toMatch(/import \{ sliceState, rowsView, combinedReadState \} from '\.\.\/lib\/readState'/)
    // users -> profiles, trips -> trips, invites -> trips (the ranking reads
    // trips), content -> the published catalog.
    expect(page).toMatch(/const adminProfilesRead = sliceState\(db\.sliceReads, 'admin profiles'\)/)
    // #800 F1: the private verdict wins, with no fallback to `profiles` after an
    // admin SUCCESS either — a complete private table read as failed because the
    // public catalogue broke.
    expect(page).toMatch(/const usersView = rowsView\(adminProfilesRead, users\.length\)/)
    expect(page).toMatch(/const tripsView = rowsView\(sliceState\(db\.sliceReads, 'trips'\), trips\.length\)/)
    expect(page).toMatch(/const tripsView = rowsView\(sliceState\(db\.sliceReads, 'trips'\), rows\.length\)/)
    expect(page).toMatch(/const pubsView = rowsView\(sliceState\(db\.sliceReads, 'suggested itineraries'\), pubs\.length\)/)
  })

  it('no panel gates its empty copy on a bare length check', () => {
    expect(page).not.toMatch(/\{(?:users|trips|rows|pubs)\.length === 0 \? \(/)
    expect(page).not.toMatch(/\{(?:users|trips|rows|pubs)\.length === 0 && \(/)
  })

  it('each panel can render failed, kept, reading and empty as four rooms', () => {
    // The four branches, once per panel. A panel missing the kept room renders
    // rows over a failed refresh with nothing saying so.
    for (const view of ['usersView', 'tripsView', 'pubsView']) {
      expect(page, `${view} has no failed room`).toMatch(new RegExp(`${view} === 'failed' \\? \\(`))
      expect(page, `${view} has no reading room`).toMatch(new RegExp(`${view} === 'reading' \\? \\(`))
      expect(page, `${view} has no empty room`).toMatch(new RegExp(`${view} === 'empty' \\? \\(`))
    }
    expect(page).toMatch(/tripsView === 'kept' && \(/)
    expect(page).toMatch(/pubsView === 'kept' && \(/)
  })

  it('the overview strip and the cached analytics figures say Unavailable, not 0', () => {
    // A zero over a failed read states something nobody verified.
    expect(page).toMatch(/feedsRead === 'ready' \? value : feedsRead === 'reading' \? 'Loading…' : 'Unavailable'/)
    expect(page).toMatch(/const cacheFigure = \(value: string\) => \(/)
    // The growth bars stay hidden unless the feeds read: a twelve-row table of
    // zeros reads as a real trend.
    expect(page).toMatch(/\{feedsRead === 'ready' && \(\s*<>\s*<table className="compare-table" tabIndex=\{0\} aria-label="Growth/)
    expect(page).not.toMatch(/aria-label="Growth — last 12 weeks"[\s\S]{0,80}\{growth\.map/)
  })

  it('the audit empty copy needs a read that succeeded', () => {
    expect(page).toMatch(/\{audit\.length === 0 && !auditFailed \? \(/)
    // The notice above it is the answer over a failure, and it is kept verbatim.
    expect(page).toContain("The audit log couldn't be read.")
    expect(page).toContain('Rows shown below may be out of date — nothing was lost.')
  })

  it('every retry re-reads the slice the panel renders', () => {
    expect(page).toMatch(/void rereadTrips\(\)\.finally\(\(\) => setReadRetrying\(false\)\)/)
    // The published panel retries the two public slices, not the trips read.
    expect(page).toMatch(/void rereadPublicSlices\(\)\.finally\(\(\) => setReadRetrying\(false\)\)/)
    expect(store).toMatch(/export async function rereadPublicSlices\(\)/)
    expect(page).toMatch(/void refreshAdminAuditNow\(\)/)
  })
})
