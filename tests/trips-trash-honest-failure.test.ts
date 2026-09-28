// ============ Wave F1 — My Trips, Trash honest failure (#383 half + #387) ============
// A failed read and a genuine empty rendered identically on both surfaces:
// My Trips branched data-only (no ready/partial consumed) and the bin's fetch
// failure stopped at a console.error. Three states, never two — failed
// outranks everything, reading is the unsettled case, and only an explicit
// success may print the friendly copy. Retry re-issues the RPC, never
// re-renders the same empty array.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { readState, sliceState, emptyCopyFor } from '../src/lib/readState'
import { sliceReadReport, READ_SLICES } from '../src/store/store'

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const retry = () => {}

describe('F1 — the trips slice is published like the public slices', () => {
  it('marks trips failed while the rest stay ok', () => {
    const report = sliceReadReport(['trips'])
    expect(report['trips']).toBe('failed')
    expect(report['profiles']).toBe('ok')
    expect(report['suggested itineraries']).toBe('ok')
  })

  it('reports trips ok when nothing failed', () => {
    const report = sliceReadReport([])
    expect(report['trips']).toBe('ok')
  })

  it('uses the exact names the hydrate pushes, not invented ones', () => {
    const source = src('../src/store/store.ts')
    for (const slice of READ_SLICES) {
      expect(source, `the hydrate never pushes '${slice}'`).toContain(`partial.push('${slice}')`)
    }
  })

  it('resolves the trips verdict through the shared three-state helper', () => {
    expect(sliceState({ trips: 'failed' }, 'trips')).toBe('failed')
    expect(sliceState({ trips: 'ok' }, 'trips')).toBe('ready')
    expect(sliceState(undefined, 'trips')).toBe('reading')
    expect(sliceState({}, 'trips')).toBe('reading')
  })

  it('lets a failure outrank a success for the trash pair too', () => {
    // The bin derives its ReadState through readState(), so the precedence the
    // helper pins (failed outranks everything; a settle is not a success) is
    // the bin's precedence as well.
    expect(readState({ settled: true, failed: true, read: true })).toBe('failed')
    expect(readState({ settled: true, read: true })).toBe('ready')
    expect(readState({ settled: true })).toBe('reading')
  })
})

describe('F1 — the copy a state may print', () => {
  it('offers a way back only from the failed state', () => {
    expect(emptyCopyFor('failed', 'trips', retry).retry).toBe(retry)
    expect(emptyCopyFor('failed', 'trash', retry).retry).toBe(retry)
    expect(emptyCopyFor('reading', 'trips', retry).retry).toBeUndefined()
    expect(emptyCopyFor('ready', 'trips', retry).retry).toBeUndefined()
  })

  it('never tells a reader a failed bin read was empty', () => {
    const failed = emptyCopyFor('failed', 'trash', retry)
    expect(failed.title).toMatch(/Couldn’t load/)
    expect(failed.body).toMatch(/not the same as/)
  })
})

describe('F1 — TripsList checks the failure before the empty copy', () => {
  const page = src('../src/pages/TripsList.tsx')

  it('My Trips guards on the trips verdict before either empty copy', () => {
    const guard = page.indexOf("tripsRead !== 'ready'")
    const genuine = page.indexOf('title="No trips yet"')
    const filtered = page.indexOf('title="No trips match those filters"')
    expect(guard).toBeGreaterThan(-1)
    expect(genuine).toBeGreaterThan(-1)
    expect(filtered).toBeGreaterThan(-1)
    expect(guard, 'the failed branch must precede the genuine-empty copy').toBeLessThan(genuine)
    expect(guard, 'the failed branch must precede the filtered-empty copy').toBeLessThan(filtered)
  })

  it('Trash guards on the bin verdict before the genuine-empty copy', () => {
    const guard = page.indexOf("trashRead !== 'ready'")
    const empty = page.indexOf('title="Trash is empty"')
    expect(guard).toBeGreaterThan(-1)
    expect(empty).toBeGreaterThan(-1)
    expect(guard, 'the bin error branch must precede the empty copy').toBeLessThan(empty)
  })

  it('both retries re-issue the read, not a re-render', () => {
    expect(page).toContain('rereadTrips()')
    expect(page).toContain('fetchTrashedTrips()')
    // The Retry buttons are wired to those re-reads, not to a state toggle.
    expect(page).toContain('onClick={retryTrips}')
    expect(page).toContain('onClick={retryTrash}')
  })

  it('the bin refetches on focus while resident (entry-only was the bug)', () => {
    expect(page).toContain("addEventListener('focus'")
    expect(page).toContain('visibilitychange')
  })
})

describe('F1 — the store refetches the bin after every mutation resolution', () => {
  const store = src('../src/store/store.ts')

  function bodyOf(name: string): string {
    const base = name.replace(/\(.*$/, '')
    const at = store.indexOf(`function ${base}(`)
    expect(at, `store never defines ${base}`).toBeGreaterThan(-1)
    const next = store.indexOf('export ', at + base.length + 10)
    return next >= 0 ? store.slice(at, next) : store.slice(at)
  }

  it('fetchTrashedTrips publishes its verdict (replace-on-success only)', () => {
    const body = bodyOf('fetchTrashedTrips')
    expect(body).toContain('trashFailed: true')
    expect(body).toContain('trashLoaded: true')
    // A throw reports the same way an error response does.
    expect(body).toContain('catch')
  })

  it('trash + session-undo re-issue the bin RPC after resolution', () => {
    expect(bodyOf('trashTrip')).toContain('fetchTrashedTrips')
    expect(bodyOf('restoreTrashedTrip')).toContain('fetchTrashedTrips')
  })

  it('RPC restore + purge re-issue the bin RPC on success AND failure', () => {
    const restore = bodyOf('restoreTrashedTripById')
    const purge = bodyOf('permanentlyDeleteTrip')
    // One call in the failure branch, one after the success path.
    expect(restore.split('fetchTrashedTrips').length - 1).toBeGreaterThanOrEqual(2)
    expect(purge.split('fetchTrashedTrips').length - 1).toBeGreaterThanOrEqual(2)
  })

  it('rereadTrips exists and never seeds (a retry must not demo-seed)', () => {
    const body = bodyOf('rereadTrips')
    expect(body).toContain('hydrateFromSupabase')
    expect(body).toContain('false')
  })

  it('the public re-read preserves the trips verdict it never collected', () => {
    const body = bodyOf('rereadPublicSlices')
    expect(body).toContain("...cache.sliceReads")
    expect(body).toContain('trips')
  })
})

describe('F1 — the purge audit row (#387, lane G surface)', () => {
  const migration = src('../supabase/migrations/20260929_trash_purge_audit.sql')

  it('logs the user-triggered purge with actor, identity and child counts', () => {
    expect(migration).toMatch(/create or replace function public\.purge_trashed_trip/)
    expect(migration).toMatch(/insert into public\.admin_audit/)
    expect(migration).toMatch(/'trip\.purge'/)
    expect(migration).toMatch(/owner_id = auth\.uid\(\)/)
    expect(migration).toMatch(/deleted_at is not null/)
    for (const table of ['trip_members', 'suggestions', 'decisions', 'activity']) {
      expect(migration, `the audit must count ${table}`).toContain(table)
    }
  })

  it('keeps the owner-scoped grants and leaves the scheduled sweep alone', () => {
    expect(migration).toMatch(/revoke all on function public\.purge_trashed_trip\(uuid\) from public, anon/)
    expect(migration).toMatch(/grant execute on function public\.purge_trashed_trip\(uuid\) to authenticated/)
    expect(migration).not.toContain('function public.purge_trashed_trips')
  })

  it('is declared no-probe-surface (a redefined function exists before and after)', () => {
    const checker = src('../scripts/checkMigrations.mjs')
    expect(checker).toContain('20260929_trash_purge_audit.sql')
  })
})
