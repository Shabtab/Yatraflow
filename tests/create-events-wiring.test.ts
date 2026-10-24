import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CREATE_EVENTS } from '../src/lib/createEvents'

/** Strip comment lines so prose cannot impersonate the code (§6x). */
function codeOf(path: string): string {
  return readFileSync(resolve(__dirname, path), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n')
}

describe('#428 wiring — every funnel event fires at its real call site', () => {
  const create = codeOf('../src/pages/CreateTrip.tsx')
  const created = codeOf('../src/pages/TripCreated.tsx')
  const both = create + created

  it.each([
    ['started', 'create'],
    ['readiness_complete', 'create'],
    ['template_picked', 'create'],
    ['draft_resumed', 'create'],
    ['draft_discarded', 'create'],
    ['crew_added', 'create'],
    ['submitted', 'create'],
    ['moment_invite_sent', 'created'],
  ] as const)('%s is recorded', (ev, page) => {
    expect(page === 'create' ? create : created).toContain(`recordCreateEvent('${ev}'`)
  })

  it('the started event fires once per page session (a latch, not an effect loop)', () => {
    expect(create).toMatch(/startedRef\.current = true/)
  })

  it('readiness_complete fires only when the checklist turns ready (first time)', () => {
    expect(create).toMatch(/if \(readyRef\.current \|\| !readiness\.ready\) return/)
  })

  it('submitted carries counts and the mode — and the trip id', () => {
    expect(create).toMatch(/recordCreateEvent\('submitted', \{ days: trip\.days\.length, travellers: trip\.travellers, mode: trip\.transportMode \}, \{ tripId: trip\.id, userId: me\?\.id \}\)/)
    const finish = create.slice(create.indexOf('function finishCreate'), create.indexOf('function addCommitment'))
    expect(finish).toContain("recordCreateEvent('submitted'")
    expect(create).toContain('finishCreate(retry)')
  })

  it('keeps anonymous history append-only instead of attempting a session-token backfill', () => {
    const store = codeOf('../src/store/store.ts')
    expect(store).not.toContain('backfillCreateFunnelSession')
    expect(codeOf('../src/lib/createEvents.ts')).not.toContain('.update({ user_id:')
    expect(create).toContain("recordCreateEvent('started', undefined, { userId: me.id })")
    expect(created).toContain('{ tripId: trip?.id, userId: me?.id }')
  })

  it('the vocabulary constant is the single source (call sites never hardcode a second list)', () => {
    // the eight UI-raised words appear at their call sites; `abandoned` is the
    // beacon in the lib itself (registered on pagehide, not in a page)
    const beacon = codeOf('../src/lib/createEvents.ts')
    for (const ev of CREATE_EVENTS) {
      const occurrences = (both.match(new RegExp(`'${ev}'`, 'g')) ?? []).length
        + (ev === 'abandoned' ? (beacon.match(new RegExp(`'${ev}'`, 'g')) ?? []).length : 0)
      expect(occurrences).toBeGreaterThanOrEqual(1)
    }
  })

  it('the admin read surface reads the derivation, not a hand-rolled count', () => {
    const admin = codeOf('../src/pages/AdminPage.tsx')
    expect(admin).toMatch(/deriveCreateFunnel\(cfRows\)/)
    expect(admin).toMatch(/fetchCreateFunnelEvents\(\)/)
    // a failed funnel read renders Retry, never a friendly empty (empty-vs-error)
    expect(admin).toMatch(/cf\.phase === 'error'[\s\S]{0,400}Retry/)
  })
})
