// ============ #800 AUTHORITY-IMPLEMENT-04 — the authority-aware catalogue ============
//
// One pure constructor decides the final contents of `cache.users`; one installer
// writes them. These tests drive the REAL init, auth and subscribe paths through
// the store, because the failures this replaces were all cross-cutting:
//
//   R8/F4a  a same-ID admin loss plus a failed read used to KEEP every
//           other-account private row, because the array was kept whole.
//   R8/F4b  a fresh self-read failure used to DISCARD a successful admin batch's
//           other-account rows, because the filter ran after the success.
//   F2      an admin who lost and regained authority while a read was in flight.
//   F3      a sign-out this module started, whose expected SIGNED_OUT successor
//           must not drop the disabled explanation — and whose OBSOLETE
//           completion must not clear the next account's admin flag.
//   F1      a stale private row must not hide a failed read's notice and retry.
//
// Every assertion below is a real behaviour assertion on the store or the App
// helpers. Where a mechanism is proved load-bearing, the RED proof is recorded in
// `.agent-evidence/800/authority-implementation-04-red.md`.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { state, toast } = vi.hoisted(() => ({
  state: {
    tableReads: [] as string[],
    rpcCalls: [] as { fn: string; args: unknown }[],
    cards: [] as unknown[],
    disabled: false as boolean | null,
    rpcError: false,
    /** RPC names that must answer an error, so a write can be refused. */
    rpcFailures: [] as string[],
    tableErrors: {} as Record<string, { message: string } | null>,
    profileErrors: {} as Record<string, { message: string } | null>,
    profileRows: {} as Record<string, unknown>,
    /** Rows an unfiltered select returns (the admin bulk read). */
    allProfileRows: [] as unknown[],
    /** Trip rows and membership rows, so a hydrate has a trip scope. */
    tripRows: [] as unknown[],
    memberRows: [] as unknown[],
    deferred: {} as Record<string, (() => void) | undefined>,
    /** A held SDK signOut: the call BEGINS for the caller, and its completion
     *  only resolves when the test releases it. */
    signOutGate: null as null | Promise<void>,
    signOuts: [] as string[],
    sessionUser: 'u-1' as 'u-1' | 'u-2' | null,
    /** Whether the resolved session carries the admin role, which is the only
     *  thing `adminFromSession` reads — a test that flips the flag mid-flight
     *  still goes through `_setAdminForTest`. */
    sessionAdmin: false,
    admin: false,
    /** The auth-event handler the SDK would call, so a test can emit SIGNED_OUT
     *  or SIGNED_IN exactly as the real client does. */
    authHandler: null as null | ((event: string, session: unknown) => void),
    /** The channel's subscribe callback, so a test can emit a reconnect. */
    subscribeHandler: null as null | ((status: string) => void),
    realtimeEvents: [] as string[],
    /** How many auth events the SDK delivered. */
    authEvents: 0,
  },
  toast: vi.fn(),
}))

vi.mock('../src/components/ui', () => ({ toast }))

vi.mock('../src/lib/supabase', () => {
  const builder = (table: string) => {
    const filters: Array<[string, unknown]> = []
    const b: Record<string, unknown> = {
      select: (column?: string) => { if (column) b.column = column; return b },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return b },
      in: () => b,
      limit: () => b,
      maybeSingle: () => { b.singleUsed = true; return b },
      single: () => { b.singleUsed = true; return b },
      insert: () => b,
      update: () => b,
      upsert: () => b,
      delete: () => b,
      setHeader: () => b,
      then: (res: (v: { data: unknown; error: unknown }) => unknown) => {
        state.tableReads.push(table)
        // Only an `eq('id', …)` filter is a single-row read. `.in('id', …)` (a
        // trip-scoped read) and an unfiltered select both answer the seeded rows
        // for their table, which is what the real client does.
        const eqId = filters.find(([k]) => k === 'id')?.[1]
        const failed = state.tableErrors[table] ?? (eqId !== undefined ? (state.profileErrors[String(eqId)] ?? null) : null)
        const row = eqId !== undefined ? (state.profileRows[String(eqId)] ?? null) : null
        const single = b.singleUsed === true
        const rows = row ? [row]
          : table === 'trips' ? state.tripRows
            : table === 'trip_members' ? state.memberRows
              : table === 'profiles' ? state.allProfileRows
                : []
        // A held read lets a test change the authority or the account mid-flight.
        const gate = eqId !== undefined ? state.deferred.__holdSelf : state.deferred.__holdProfiles
        if (gate && table === 'profiles') {
          if (eqId !== undefined) state.deferred.__holdSelf = undefined
          else state.deferred.__holdProfiles = undefined
          return gate().then(() => Promise.resolve({ data: failed ? null : (single ? row : rows), error: failed })).then(res)
        }
        return Promise.resolve({
          data: failed ? null : (single ? row : rows),
          error: failed,
        }).then(res)
      },
    }
    return b
  }
  const channel = () => {
    const c: Record<string, unknown> = {
      on: () => c,
      subscribe: (cb: (status: string) => void) => { state.subscribeHandler = cb; return c },
    }
    return c
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: builder,
      channel,
      removeChannel: () => Promise.resolve(),
      auth: {
        getSession: () => Promise.resolve({
          data: { session: state.sessionUser ? { user: { id: state.sessionUser, app_metadata: state.sessionAdmin ? { role: 'masteradmin' } : {} }, access_token: 'tok' } : null },
        }),
        signOut: () => {
          state.signOuts.push(String(state.sessionUser))
          const gate = state.signOutGate
          if (gate) { state.signOutGate = null; return gate.then(() => ({ error: null })) }
          return Promise.resolve({ error: null })
        },
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          state.authEvents += 1
          state.authHandler = cb
          return { data: { subscription: {} } }
        },
      },
      rpc: (fn: string, args: unknown) => {
        state.rpcCalls.push({ fn, args })
        const b: Record<string, unknown> = {
          setHeader: () => b,
          then: (res: (v: { data: unknown; error: unknown }) => unknown) => {
            const failed = (state.rpcError && fn === 'get_public_profile_cards')
              || (fn === 'is_disabled' && state.disabled === null)
              || state.rpcFailures.includes(fn)
            const data = failed ? null
              : fn === 'get_public_profile_cards' ? state.cards
                : fn === 'is_disabled' ? state.disabled
                  : null
            const settle = () => Promise.resolve({ data, error: failed ? { message: 'PGRST202' } : null })
            const parked = state.deferred[fn]
            if (parked) { state.deferred[fn] = undefined; return parked().then(settle).then(res) }
            return settle().then(res)
          },
        }
        return b
      },
    },
  }
})

const OWNER_PRIVATE = {
  id: 'u-1', email: 'a@example.invalid', name: 'Asha', avatar_url: 'https://cdn/a.png', home_city: 'Kochi',
  languages: ['en', 'ml'], travel_styles: ['balanced'], is_creator: true, creator_bio: 'Kerala',
  social_links: { youtube: 'https://y/@a', instagram: 'https://i/a' }, is_disabled: false, created_at: 111,
}
const OTHER_PRIVATE = {
  ...OWNER_PRIVATE, id: 'u-2', email: 'b@example.invalid', name: 'Bilal',
  social_links: { youtube: 'https://y/@b' },
}
const OWNER_CARD = { id: 'u-1', name: 'Asha', avatar_url: 'https://cdn/a.png', is_creator: true, creator_bio: 'Kerala', social_links: { youtube: 'https://y/@a', instagram: 'https://i/a' }, creator_available: true }
const OTHER_CARD = { id: 'u-2', name: 'Bilal', avatar_url: null, is_creator: false, creator_bio: null, social_links: null, creator_available: false }

/** One trip owned by u-1, shaped enough for `rowToTrip` to map. */
const TRIP_ROW = {
  id: 'trip-1', owner_id: 'u-1', name: 'Trip trip-1', start_location: 'Kochi',
  start_location_coords: null, destinations: ['Kochi'], destination_coords: null,
  start_date: '2026-10-01', end_date: '2026-10-03', travellers: 2, transport_mode: 'car',
  budget_per_person_inr: 5000, travel_style: 'balanced', fixed_commitments: [],
  days: [], expenses: [], cover_emoji: 'x', visibility: 'private', created_at: 1, updated_at: 1,
}
const MEMBER_ROW = { trip_id: 'trip-1', user_id: 'u-1', role: 'owner', joined_at: 1 }

const flush = () => new Promise(r => setTimeout(r, 0))

async function freshStore() {
  vi.resetModules()
  return await import('../src/store/store')
}

/** A signed-in session for `userId`, with the admin role the test chooses. The
 *  role rides the resolved session, because that is the only thing the real
 *  `adminFromSession` reads. */
function signIn(store: Awaited<ReturnType<typeof freshStore>>, userId: 'u-1' | 'u-2', admin: boolean): void {
  state.sessionUser = userId
  state.sessionAdmin = admin
  store._setAdminForTest(admin)
}

const privateIds = (store: Awaited<ReturnType<typeof freshStore>>) =>
  store.getSnapshot().users.filter(u => u.kind === 'private').map(u => u.id)

beforeEach(() => {
  state.tableReads = []
  state.rpcCalls = []
  state.cards = [OWNER_CARD, OTHER_CARD]
  state.disabled = false
  state.rpcError = false
  state.rpcFailures = []
  state.tableErrors = {}
  state.profileErrors = {}
  state.profileRows = {}
  state.allProfileRows = []
  state.tripRows = []
  state.memberRows = []
  state.deferred = {}
  state.signOutGate = null
  state.signOuts = []
  state.sessionUser = 'u-1'
  state.sessionAdmin = false
  state.admin = false
  state.authHandler = null
  state.subscribeHandler = null
  state.realtimeEvents = []
  toast.mockClear()
})

// ============ R8/F4 — the authority gate, not a filter on the array ============
describe('the catalogue installs under the authority that is current', () => {
  it('a same-ID admin loss plus a failed bulk read removes the other-account private row', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.init()
    await flush(); await flush()
    // Phase 1: an admin hydrate installs both private rows.
    expect(privateIds(store).sort()).toEqual(['u-1', 'u-2'])
    expect(store.getSnapshot().sliceReads['admin profiles']).toBe('ok')

    // Phase 2: the SAME id loses admin authority while the bulk read is in flight.
    let release!: () => void
    const readsBefore = state.tableReads.filter(t => t === 'profiles').length
    state.deferred.__holdProfiles = () => new Promise<void>(r => { release = r })
    const resumed = store.resumeSync()
    await flush(); await flush()
    // The self read has settled AND the bulk read is held: this run has issued
    // one more self read and one more bulk read than phase 1 did.
    expect(state.tableReads.filter(t => t === 'profiles').length).toBe(readsBefore + 2)
    store._setAdminForTest(false)
    release()
    await resumed
    await flush(); await flush()

    // The authority revision moved when the loss was observed, so the stamp on
    // the catalogue it replaced no longer authorises u-2's private row.
    expect(privateIds(store)).toEqual(['u-1'])
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.kind).toBe('public')
    // The caller's own row is still private: its self read succeeded.
    expect(store.currentUser()?.kind).toBe('private')
    expect(store.getSnapshot().sliceReads['admin profiles']).toBe('failed')
  })

  it('a successful admin batch installs both authorised private accounts after the self read fails', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    // The narrower self read fails outright…
    state.profileErrors = { 'u-1': { message: 'row unavailable' } }
    // …while the wider bulk read succeeds and carries BOTH accounts.
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.init()
    await flush(); await flush()

    // The batch supplies self, so the self result is successful: the failed
    // narrower read must not defeat the successful wider one.
    expect(privateIds(store).sort()).toEqual(['u-1', 'u-2'])
    expect(store.currentUser()?.kind).toBe('private')
    expect(store.currentUser()?.email).toBe('a@example.invalid')
    expect(store.getSnapshot().sliceReads['self profile']).toBe('ok')
    expect(store.getSnapshot().sliceReads['admin profiles']).toBe('ok')
    // And the account's private email is not leaked onto a public card.
    expect(store.getSnapshot().users.every(u => u.kind === 'private')).toBe(true)
  })

  it('a batch that omits self cannot invent self success', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileErrors = { 'u-1': { message: 'row unavailable' } }
    // The bulk read succeeds but returns only the OTHER account.
    state.allProfileRows = [OTHER_PRIVATE]
    store.init()
    await flush(); await flush()

    // u-2 is installed as private; u-1 has no authorised row at all.
    expect(privateIds(store)).toEqual(['u-2'])
    expect(store.currentUser()).toBeNull()
    expect(store.getSnapshot().users.find(u => u.id === 'u-1')?.kind).toBe('public')
    expect(store.getSnapshot().sliceReads['self profile']).toBe('failed')
    expect(store.getSnapshot().sliceReads['admin profiles']).toBe('ok')
  })

  it('an admin who loses and regains authority mid-read ends with the console restored', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.init()
    await flush(); await flush()
    expect(privateIds(store).sort()).toEqual(['u-1', 'u-2'])

    // Loss while the bulk read is in flight.
    let release!: () => void
    const readsBefore = state.tableReads.filter(t => t === 'profiles').length
    state.deferred.__holdProfiles = () => new Promise<void>(r => { release = r })
    const lost = store.resumeSync()
    await flush(); await flush()
    expect(state.tableReads.filter(t => t === 'profiles').length).toBe(readsBefore + 2)
    store._setAdminForTest(false)
    release()
    await lost
    await flush(); await flush()
    expect(privateIds(store)).toEqual(['u-1'])

    // Regain: the next run asks for the bulk again and it succeeds.
    store._setAdminForTest(true)
    await store.resumeSync()
    await flush(); await flush()
    expect(privateIds(store).sort()).toEqual(['u-1', 'u-2'])
    expect(store.getSnapshot().sliceReads['admin profiles']).toBe('ok')
  })

  it('a non-admin hydrate keeps the public catalogue plus its own private row', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.init()
    await flush(); await flush()
    expect(privateIds(store)).toEqual(['u-1'])
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.kind).toBe('public')
  })

  it('a previous account\'s private rows are never a fallback for the next one', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.init()
    await flush(); await flush()
    expect(privateIds(store).sort()).toEqual(['u-1', 'u-2'])

    // A real account switch, emitted the way the SDK emits it: hydrate runs its
    // own account-change branch, which empties the cache and moves the identity.
    state.profileRows = { 'u-2': { ...OTHER_PRIVATE } }
    state.profileErrors = { 'u-1': { message: 'gone' } }
    // The new account's bulk read sees only its own account. u-1's private row is
    // therefore not a fallback for u-2 and not a leftover from u-1's session.
    state.allProfileRows = [{ ...OTHER_PRIVATE }]
    state.authHandler!('SIGNED_IN', { user: { id: 'u-2', app_metadata: { role: 'masteradmin' } } })
    await flush(); await flush()
    expect(privateIds(store)).toEqual(['u-2'])
    expect(store.getSnapshot().users.some(u => u.id === 'u-1' && u.kind === 'private')).toBe(false)
  })
})

// ============ F2 — safe events, the public retry and the reconnect ============
describe('the public paths never widen or erase the boundary', () => {
  it('a public refresh keeps the private rows the current authority covers', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.init()
    await flush(); await flush()
    expect(privateIds(store).sort()).toEqual(['u-1', 'u-2'])

    // The public retry re-reads the public RPC only. It must not certify or
    // revoke the private slices, and it must not drop the private rows.
    state.profileRows = {}
    state.allProfileRows = []
    await store.rereadPublicSlices()
    await flush(); await flush()
    expect(privateIds(store).sort()).toEqual(['u-1', 'u-2'])
    expect(store.getSnapshot().sliceReads['admin profiles']).toBe('ok')
    expect(store.getSnapshot().sliceReads['self profile']).toBe('ok')
    expect(store.getSnapshot().sliceReads.profiles).toBe('ok')
  })

  it('a live profile_cards event lands through the public mapper and keeps a private entry', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    store.init()
    await flush(); await flush()
    expect(store.currentUser()?.kind).toBe('private')

    store._applyRealtimeEventForTest('profile_cards', {
      eventType: 'UPDATE', table: 'profile_cards', schema: 'public',
      new: { ...OWNER_CARD, name: 'Asha Nair' }, old: {},
    } as never)
    await flush()
    const me = store.currentUser()
    expect(me?.kind).toBe('private')
    expect(me?.email).toBe('a@example.invalid')
    expect(me?.profile.name).toBe('Asha Nair')
    // The event is a DELTA: u-2's card is still there.
    expect(store.getSnapshot().users.map(u => u.id).sort()).toEqual(['u-1', 'u-2'])
  })

  it('a reconnect asks the server about the caller, not the cache', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    // A trip in scope, so the reconnect has rows to reconcile and does not bail
    // out before it reaches the caller-status step.
    state.tripRows = [TRIP_ROW]
    state.memberRows = [MEMBER_ROW]
    // A private row that says ENABLED is already in the cache.
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    store.init()
    await flush(); await flush()
    expect(store.currentUser()?.profile.isDisabled).toBe(false)
    expect(store.getSnapshot().trips).toHaveLength(1)
    state.rpcCalls = []

    // The account was disabled while the socket was down. Nothing in the cache
    // can see it, so the reconnect's authoritative check has to ask.
    state.disabled = true
    // Emit the reconnect exactly as the SDK does: the first SUBSCRIBED only
    // arms the resync, the second one IS the reconnect.
    expect(state.subscribeHandler).not.toBeNull()
    state.subscribeHandler!('SUBSCRIBED')
    state.subscribeHandler!('SUBSCRIBED')
    await flush(); await flush(); await flush()

    expect(state.rpcCalls.some(c => c.fn === 'is_disabled')).toBe(true)
    expect(state.signOuts).toEqual(['u-1'])
    expect(toast).toHaveBeenCalledWith(
      'This account has been disabled. Contact support if you think this is a mistake.', 'err',
    )
  })

  it('the authoritative check overrides a cached row that says enabled', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    store.init()
    await flush(); await flush()
    // The cache says enabled, and it is current — a resume may trust it.
    state.disabled = false
    expect(await store.enforceDisabledCheck()).toBe(false)
    expect(state.rpcCalls.some(c => c.fn === 'is_disabled')).toBe(false)

    // The server disagrees. Only the authoritative check sees it.
    state.disabled = true
    expect(await store.recheckDisabledStatus()).toBe(true)
    expect(state.signOuts).toEqual(['u-1'])
  })
})

// ============ F3 — the owned sign-out operation ============
describe('the disabled sign-out belongs to the account that asked', () => {
  it('its own expected SIGNED_OUT successor keeps the explanation', async () => {
    const store = await freshStore()
    state.sessionUser = 'u-1'
    state.disabled = false
    // A disabled account cannot read its own row, so there is nothing to
    // short-circuit on: the check goes to the server.
    state.profileRows = {}
    store.init()
    await flush()

    let release!: () => void
    state.signOutGate = new Promise<void>(r => { release = r })
    state.disabled = true
    const pending = store.enforceDisabledCheck()
    await flush()
    // The SDK signOut has BEGUN. It emits SIGNED_OUT, which moves the identity
    // generation and empties the session.
    expect(state.signOuts).toEqual(['u-1'])
    state.authHandler!('SIGNED_OUT', null)
    expect(store.getSnapshot().sessionUserId).toBeNull()

    release()
    expect(await pending).toBe(true)
    // The message the disabled account needs to see is not dropped.
    expect(toast).toHaveBeenCalledWith(
      'This account has been disabled. Contact support if you think this is a mistake.', 'err',
    )
  })

  it('an obsolete completion does not clear the next account\'s admin flag', async () => {
    const store = await freshStore()
    state.sessionUser = 'u-1'
    state.disabled = false
    state.profileRows = {}
    store.init()
    await flush()

    let release!: () => void
    state.signOutGate = new Promise<void>(r => { release = r })
    state.disabled = true
    const pending = store.enforceDisabledCheck()
    await flush()
    expect(state.signOuts).toEqual(['u-1'])

    // A different account signs in as admin, with a fresh generation, while the
    // old sign-out is still in flight.
    state.sessionUser = 'u-2'
    state.sessionAdmin = true
    state.authHandler!('SIGNED_IN', { user: { id: 'u-2', app_metadata: { role: 'masteradmin' } } })
    expect(store._isAdminForTest()).toBe(true)

    release()
    expect(await pending).toBe(false)
    // The obsolete completion touched nothing: no message, and the next
    // account's admin flag is intact.
    // The obsolete completion touched nothing: it did not clear the next
    // account's admin flag, and it did not claim this account was disabled.
    // (The account switch legitimately reports its own partial load; that is a
    // different message about a different read, and it is not this operation's.)
    expect(toast).not.toHaveBeenCalledWith(
      'This account has been disabled. Contact support if you think this is a mistake.', 'err',
    )
    expect(store._isAdminForTest()).toBe(true)
    expect(store.getSnapshot().sessionUserId).toBe('u-2')
  })
})

// ============ F1 — the visible retry ============
describe('a stale private row does not hide the failure', () => {
  it('the lookup reads failed while a private row is still in the cache', async () => {
    const { profileLookupState, needsProfileLookup, profileLookupBlocksRoute } = await import('../src/App')
    const stale = { 'self profile': 'failed' as const }
    expect(profileLookupState('userA', true, stale)).toBe('failed')
    expect(needsProfileLookup('userA', true, 'failed')).toBe(true)
    expect(profileLookupBlocksRoute('userA', true, 'failed', true, false)).toBe(true)
    // The public verdict alone is enough: the account's status is unproven.
    expect(profileLookupState('userA', true, { profiles: 'failed' })).toBe('failed')
    // A row under a read that succeeded is still a ready account.
    expect(profileLookupState('userA', true, { 'self profile': 'ok', profiles: 'ok' })).toBe('ready')
  })

  it('a store-level failed self read leaves a failed verdict beside the stale row', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    store.init()
    await flush(); await flush()
    expect(store.currentUser()?.kind).toBe('private')

    // The next run's self read fails. The previous private row is retained (the
    // same identity, the same authority) but it is reported as a failure.
    state.profileErrors = { 'u-1': { message: 'row unavailable' } }
    await store.resumeSync()
    await flush(); await flush()
    expect(store.getSnapshot().sliceReads['self profile']).toBe('failed')
    const { profileLookupState } = await import('../src/App')
    expect(profileLookupState('u-1', !!store.currentUser(), store.getSnapshot().sliceReads)).toBe('failed')
  })
})

// ============ the writers all enter the one gate ============
describe('every catalogue writer installs through the gate', () => {
  it('updateProfile edits and rolls back through the install', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    store.init()
    await flush(); await flush()
    expect(store.getSnapshot().users.filter(u => u.kind === 'private')).toHaveLength(1)

    // A refused write restores the saved name.
    state.profileErrors = { 'u-1': { message: 'new row violates row-level security policy' } }
    const refused = await store.updateProfile({ name: 'Asha Nair' })
    expect(refused.ok).toBe(false)
    expect(store.getSnapshot().users.find(u => u.id === 'u-1')?.profile.name).toBe('Asha')
    // And the row is still private: the gate re-stamped it.
    expect(store.currentUser()?.kind).toBe('private')

    // An accepted write lands on the private row.
    state.profileErrors = {}
    const ok = await store.updateProfile({ name: 'Asha Nair' })
    expect(ok).toEqual({ ok: true })
    expect(store.currentUser()?.profile.name).toBe('Asha Nair')

    // …and the install RE-STAMPED the catalogue, which is what a later public
    // refresh reads. A write that patched `cache.users` directly would leave the
    // stamp describing the row as it was before the edit, so the next install
    // would treat the account's own private row as unauthorised and drop it.
    await store.rereadPublicSlices()
    await flush(); await flush()
    expect(store.currentUser()?.kind).toBe('private')
    expect(store.currentUser()?.profile.name).toBe('Asha Nair')
  })

  it('adminSetDisabled edits a private row and rolls back on refusal', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.init()
    await flush(); await flush()

    // Hold the RPC so the optimistic edit is on screen while it is in flight.
    // The mock's gate is a FUNCTION it calls, not a promise.
    let release!: () => void
    state.deferred.admin_set_disabled = () => new Promise<void>(r => { release = r })
    // …and the RPC answers an error once it is released.
    state.rpcFailures = ['admin_set_disabled']
    const pending = store.adminSetDisabled('u-2', true)
    await flush()
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.kind).toBe('private')
    expect((store.getSnapshot().users.find(u => u.id === 'u-2') as { profile: { isDisabled?: boolean } }).profile.isDisabled).toBe(true)

    // Refused: the row goes back, and it is still private.
    release()
    expect(await pending).toBe(false)
    const u2 = store.getSnapshot().users.find(u => u.id === 'u-2') as { kind: string; profile: { isDisabled?: boolean } }
    expect(u2.kind).toBe('private')
    expect(u2.profile.isDisabled).toBe(false)
  })

  it('an optimistic rollback during an authority change does not reinstate a revoked row', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.init()
    await flush(); await flush()
    expect(privateIds(store).sort()).toEqual(['u-1', 'u-2'])

    // The optimistic edit is on screen while the RPC is in flight…
    let release!: () => void
    state.deferred.admin_set_disabled = () => new Promise<void>(r => { release = r })
    state.rpcFailures = ['admin_set_disabled']
    const pending = store.adminSetDisabled('u-2', true)
    await flush()

    // …and the caller LOSES admin authority while it is — a same-id role change,
    // which is exactly the case an identity check cannot see. The catalogue is
    // reprojected immediately, so u-2 is public again and a NEW array is installed.
    state.authHandler!('SIGNED_IN', { user: { id: 'u-1', app_metadata: {} } })
    await flush(); await flush()
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.kind).toBe('public')

    // The RPC is then refused. The rollback must see that something else
    // installed a catalogue in between and drop itself, rather than writing the
    // revoked private row back over the projection.
    release()
    expect(await pending).toBe(false)
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.kind).toBe('public')
    expect(privateIds(store)).toEqual(['u-1'])
  })

  it('an obsolete rollback does not clobber a newer edit to the same row', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.init()
    await flush(); await flush()
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.profile.name).toBe('Bilal')

    // The optimistic edit is on screen while its RPC is in flight…
    let release!: () => void
    state.deferred.admin_set_disabled = () => new Promise<void>(r => { release = r })
    state.rpcFailures = ['admin_set_disabled']
    const pending = store.adminSetDisabled('u-2', true)
    await flush()

    // …and a live event renames that same account. The authority is unchanged, so
    // the catalogue the gate produces is perfectly valid — which is exactly why
    // the rollback cannot rely on the gate to protect it.
    store._applyRealtimeEventForTest('profile_cards', {
      eventType: 'UPDATE', table: 'profile_cards', schema: 'public',
      new: { ...OTHER_CARD, name: 'Bilal Ahmed' }, old: {},
    } as never)
    await flush()
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.profile.name).toBe('Bilal Ahmed')

    // The RPC is then refused. The rollback must see that another write landed
    // and drop itself, rather than restoring the row it was handed.
    release()
    expect(await pending).toBe(false)
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.profile.name).toBe('Bilal Ahmed')
    expect(privateIds(store).sort()).toEqual(['u-1', 'u-2'])
  })

  it('adminDeleteUser removes the row through the gate and restores it on refusal', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.init()
    await flush(); await flush()
    expect(privateIds(store).sort()).toEqual(['u-1', 'u-2'])

    let release!: () => void
    state.deferred.admin_delete_user = () => new Promise<void>(r => { release = r })
    state.rpcFailures = ['admin_delete_user']
    const pending = store.adminDeleteUser('u-2')
    await flush()
    expect(store.getSnapshot().users.some(u => u.id === 'u-2')).toBe(false)

    // Refused: the row comes back, still private, and the stamp still covers it.
    release()
    expect(await pending).toBe(false)
    expect(privateIds(store).sort()).toEqual(['u-1', 'u-2'])
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.kind).toBe('private')
  })
})
