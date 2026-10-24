// ============ #374 + #373 — a create that is saved before it is entered ============
//
// Two bugs on one path, and they share a cause: nothing on the create path
// waited for the write.
//
//   * #374 — `createTrip` admitted the trip to the cache, fired
//     `void persistTrip(...)` and returned, so the page routed into a workspace
//     built on a row that might not exist. A failure produced a toast and
//     nothing else: no rollback, no staying put, inputs gone.
//   * #373 — with no submitting state anywhere, both Start-planning buttons
//     stayed live and every submit minted a fresh uuid, so an impatient
//     double-click left twin trips in My Trips.
//
// The store half is behavioural (real store, mocked transport): a failed create
// must leave no trip behind, and a retry must reuse the SAME id. The page half
// is pinned textually, like this repo's other UI contracts — the node test
// environment has no DOM to render a form in, and what needs pinning is the
// ORDER of the guard, the awaits and the navigation.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

type FakeError = { code?: string; message: string } | null

const { state, toast } = vi.hoisted(() => ({
  state: {
    /** Successive outcomes for each table's writes (shifted per call). */
    tripErrors: [] as FakeError[],
    memberErrors: [] as FakeError[],
    /** a table whose write REJECTS instead of answering with an error object */
    throwOn: null as string | null,
    writes: [] as Array<{ table: string; method: string; payload: any }>,
    savedTrip: null as any,
    savedOwner: null as any,
  },
  toast: vi.fn(),
}))

vi.mock('../src/components/ui', () => ({ toast }))

vi.mock('../src/lib/supabase', () => {
  const next = (queue: FakeError[]) => (queue.length ? queue.shift()! : null)
  function query(table: string) {
    const qb: any = {}
    const filters = new Map<string, unknown>()
    qb.select = () => qb
    qb.eq = (key: string, value: unknown) => { filters.set(key, value); return qb }
    qb.in = () => qb
    qb.order = () => qb
    qb.limit = () => qb
    qb.then = (res: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(res)
    qb.maybeSingle = () => ({
      then: (res: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: (() => {
          const row = table === 'trips' ? state.savedTrip : state.savedOwner
          return row && [...filters].every(([key, value]) => row[key] === value) ? row : null
        })(), error: null }).then(res),
    })
    return qb
  }
  function write(table: string, method: string, payload: any) {
    const qb: any = {}
    qb.eq = () => qb
    qb.in = () => qb
    qb.select = () => qb
    // Both handlers: a thenable that only accepts `res` hangs the awaiting
    // caller forever when it means to reject (the rejection lands in an
    // unhandled-promise slot and the await never settles).
    qb.then = (
      res: (v: { data: unknown; error: unknown }) => unknown,
      rej?: (e: unknown) => unknown,
    ) => {
      state.writes.push({ table, method, payload })
      if (state.throwOn === table) return Promise.reject(new Error('fetch failed')).then(res, rej)
      const error = table === 'trips' ? next(state.tripErrors)
        : table === 'trip_members' ? next(state.memberErrors)
          : null
      return Promise.resolve({ data: null, error }).then(res, rej)
    }
    return qb
  }
  return {
    isSupabaseConfigured: () => true,
    supabase: {
      from: (table: string) => {
        const qb = query(table)
        qb.insert = (p: any) => write(table, 'insert', p)
        qb.update = (p: any) => write(table, 'update', p)
        qb.upsert = (p: any) => write(table, 'upsert', p)
        qb.delete = () => write(table, 'delete', null)
        return qb
      },
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      channel: () => ({ on() { return this }, subscribe() { return this } }),
      removeChannel: () => {},
      rpc: async () => ({ data: null, error: null }),
    },
  }
})

import { createTripPersisted, retryCreateTrip, tripById, getSnapshot } from '../src/store/store'
import type { NewTripInput } from '../src/store/store'

const OWNER = 'creator-374'

/** The smallest real create payload — the same shape the form builds. */
function input(over: Partial<NewTripInput> = {}): NewTripInput {
  return {
    name: 'Kerala in four days', startLocation: 'Kochi', destinations: ['Munnar'],
    startDate: '2026-10-01', endDate: '2026-10-04', travellers: 2,
    transportMode: 'car', budgetPerPersonInr: 22000, travelStyle: 'balanced',
    fixedCommitments: [],
    ...over,
  } as NewTripInput
}

function tripsWrites() {
  return state.writes.filter(w => w.table === 'trips' && w.method === 'insert')
}

beforeEach(() => {
  state.tripErrors.length = 0
  state.memberErrors.length = 0
  state.throwOn = null
  state.writes.length = 0
  state.savedTrip = null
  state.savedOwner = null
  toast.mockClear()
})

describe('#374 — a failed create leaves nothing behind', () => {
  it('rolls the trip back out of the cache and hands the trip back for a retry', async () => {
    state.tripErrors.push({ message: 'network unreachable' })
    const { trip, persisted } = await createTripPersisted(OWNER, input())

    expect(persisted).toBe(false)
    // The whole point: no zombie row that a reload would disprove.
    expect(tripById(trip.id)).toBeUndefined()
    expect(getSnapshot().trips.some(t => t.id === trip.id)).toBe(false)
    // …and the built trip still comes back, so the form can retry the SAME id.
    expect(trip.id).toBeTruthy()
    expect(trip.members?.[0]?.userId).toBe(OWNER)
    expect(toast).toHaveBeenCalledWith('Could not save trip.')
  })

  it('a member-row failure counts as a failed create too', async () => {
    // The trips row landed, the membership did not: the trip is invisible to
    // its owner after a reload, so it must not be reported as saved (#374's
    // pitfall note).
    state.memberErrors.push({ message: 'new row violates row-level security policy' })
    const { trip, persisted } = await createTripPersisted(OWNER, input())
    expect(persisted).toBe(false)
    expect(tripById(trip.id)).toBeUndefined()
  })

  it('a THROW is a failed create, not a zombie row', async () => {
    // supabase-js normally answers with an error object, but a dropped fetch
    // rejects — and an uncaught rejection used to leave the optimistic row in
    // the cache forever.
    state.throwOn = 'trips'
    const { trip, persisted } = await createTripPersisted(OWNER, input({ name: 'Throws' }))
    expect(persisted).toBe(false)
    expect(tripById(trip.id)).toBeUndefined()
  })

  it('a successful create is in the cache and reports persisted', async () => {
    const { trip, persisted } = await createTripPersisted(OWNER, input())
    expect(persisted).toBe(true)
    expect(tripById(trip.id)).toBeDefined()
    expect(tripsWrites()).toHaveLength(1)
    expect(state.writes.some(w => w.table === 'trip_members')).toBe(true)
  })

  it('retracts are not resurrected by a debounced write (source tripwire)', () => {
    const store = readFileSync(new URL('../src/store/store.ts', import.meta.url), 'utf8')
    const retract = store.slice(
      store.indexOf('function retractTripCopy'),
      store.indexOf('/** Duplicate any trip into the user'),
    )
    // A pending field write for the retracted id would land on the server with
    // no cache row in front of it and the trip would come back on the next
    // hydrate — the "it vanished, then it was there" the create path produced.
    expect(retract).toMatch(/pendingTripWrites\.get\(copy\.id\)/)
    expect(retract).toMatch(/clearTimeout\(pending\.timer\)/)
    expect(retract).toMatch(/pendingTripWrites\.delete\(copy\.id\)/)
  })
})

describe('#374 — the retry re-uses the trip instead of minting a twin', () => {
  it('a retry after a failed save lands ONE trip, with the original id', async () => {
    state.tripErrors.push({ message: 'network unreachable' })
    const { trip, persisted } = await createTripPersisted(OWNER, input())
    expect(persisted).toBe(false)

    const ok = await retryCreateTrip(trip, OWNER)
    expect(ok).toBe(true)
    // Same id in both attempts, one row in the cache: the idempotency key the
    // issue asks for is the trip object itself.
    const ids = tripsWrites().map(w => w.payload.id)
    expect(ids).toEqual([trip.id, trip.id])
    expect(getSnapshot().trips.filter(t => t.id === trip.id)).toHaveLength(1)
    expect(tripById(trip.id)).toBeDefined()
  })

  it('a retry that meets its OWN earlier row succeeds instead of failing forever', async () => {
    // The first attempt reached the server and died on the way back: its row —
    // and possibly its membership — are already there. A plain insert then
    // fails on the primary key forever, telling the user their trip did not
    // save while it sits in their list.
    state.tripErrors.push({ message: 'connection reset' })
    const { trip } = await createTripPersisted(OWNER, input())
    expect(tripById(trip.id)).toBeUndefined()

    state.tripErrors.push({ code: '23505', message: 'duplicate key value violates unique constraint "trips_pkey"' })
    state.memberErrors.push({ code: '23505', message: 'duplicate key value violates unique constraint "trip_members_pkey"' })
    const row = state.writes.find(write => write.table === 'trips')!.payload
    state.savedTrip = { ...row, created_at: trip.createdAt, updated_at: trip.updatedAt }
    state.savedOwner = { trip_id: trip.id, user_id: OWNER, role: 'owner', joined_at: trip.createdAt }
    const ok = await retryCreateTrip(trip, OWNER)

    expect(ok).toBe(true)
    expect(tripById(trip.id)).toBeDefined()
    expect(getSnapshot().trips.filter(t => t.id === trip.id)).toHaveLength(1)
  })

  it('a retry that fails again is rolled back again', async () => {
    state.tripErrors.push({ message: 'offline' })
    const { trip } = await createTripPersisted(OWNER, input())
    state.tripErrors.push({ message: 'still offline' })
    expect(await retryCreateTrip(trip, OWNER)).toBe(false)
    expect(tripById(trip.id)).toBeUndefined()
  })

  it('the duplicate tolerance is a RETRY-only affordance', async () => {
    // A first attempt meeting a duplicate key is not its own row — it is a
    // genuine collision, and it must keep failing loudly.
    state.tripErrors.push({ code: '23505', message: 'duplicate key' })
    const { persisted, trip } = await createTripPersisted(OWNER, input())
    expect(persisted).toBe(false)
    expect(tripById(trip.id)).toBeUndefined()
  })

  it('refuses a duplicate response without a verified owned row', async () => {
    state.tripErrors.push({ message: 'offline' })
    const { trip } = await createTripPersisted(OWNER, input())
    state.tripErrors.push({ code: '23505', message: 'duplicate key' })
    expect(await retryCreateTrip(trip, OWNER)).toBe(false)
    expect(tripById(trip.id)).toBeUndefined()
  })
})

describe('#373 — the page cannot submit twice, and cannot route on a failed save', () => {
  const page = readFileSync(new URL('../src/pages/CreateTrip.tsx', import.meta.url), 'utf8')

  it('creates through the awaited path, never the fire-and-forget one', () => {
    expect(page).toMatch(/createTripPersisted/)
    expect(page).toMatch(/retryCreateTrip/)
    // No bare `createTrip(` call: that is the unawaited one.
    expect(page).not.toMatch(/\bcreateTrip\(/)
  })

  it('engages the guard AFTER validation and BEFORE the network', () => {
    const validationReturn = page.indexOf('if (Object.keys(next).length) {')
    const guard = page.indexOf('if (creatingRef.current) return')
    const firstAwait = page.indexOf('await createTripPersisted(')
    expect(validationReturn, 'the validation block must exist').toBeGreaterThan(-1)
    expect(guard).toBeGreaterThan(validationReturn)
    expect(firstAwait).toBeGreaterThan(guard)
    // The flag spans the await — disabling only the synchronous part reopens
    // the window that actually races.
    expect(page).toMatch(/creatingRef\.current = true/)
    expect(page).toMatch(/finally \{[\s\S]{0,80}creatingRef\.current = false/)
  })

  it('both submit surfaces wait, and say so', () => {
    const guarded = [...page.matchAll(/className="(tk-cta|dock-cta)" disabled=\{submitting\}/g)]
    expect(guarded.map(m => m[1]).sort()).toEqual(['dock-cta', 'tk-cta'])
    // both primaries + the retry button
    expect([...page.matchAll(/submitting \? 'Creating…' : /g)]).toHaveLength(3)
    expect(page).toMatch(/aria-busy=\{submitting\}/)
  })

  it('a failed save stays on the form, keeps the inputs, and offers a retry', () => {
    expect(page).toMatch(/if \(!persisted\) \{[\s\S]{0,120}setSaveError\(SAVE_FAILED\)[\s\S]{0,40}return/)
    // The retry re-uses the built trip — the same id, so no twin.
    expect(page).toMatch(/pendingTrip\.current = trip/)
    expect(page).toMatch(/const retry = pendingTrip\.current/)
    expect(page).toMatch(/await retryCreateTrip\(retry, me\.id\)/)
    // Nothing is cleared or routed before the save is confirmed.
    const finish = page.slice(page.indexOf('function finishCreate'), page.indexOf('function addCommitment'))
    expect(finish).toMatch(/haptic\(HAPTIC\.success\)/)
    expect(finish).toMatch(/clearDraft\(\)/)
    expect(finish).toMatch(/navigateWithTransition\(/)
    const beforeFinish = page.slice(page.indexOf('async function submit'), page.indexOf('function finishCreate'))
    expect(beforeFinish).not.toMatch(/clearDraft\(\)/)
    expect(beforeFinish).not.toMatch(/haptic\(HAPTIC\.success\)/)
  })

  it('the failure is on the form, beside both actions', () => {
    expect([...page.matchAll(/\{saveFailure\}/g)]).toHaveLength(2)
    expect(page).toMatch(/className="chip chip-danger" role="alert"/)
  })
})
