import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rowToPrivateUser, rowToPublicUser } from '../src/store/store'

/** A synthetic JWT whose payload carries `sub` and a stable `session_id`. The
 *  signature is not verified and confers nothing; it exists so the observation
 *  seam can correlate a session the way a real token lets it. */
const makeToken = (sub: string, sessionId: string): string => {
  const payload = Buffer.from(JSON.stringify({ sub, session_id: sessionId })).toString('base64url')
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`
}

/** The session an SDK auth event carries: a resolved user plus the bearer its
 *  JWT claims. A real SDK always supplies the token; a bare `{ user }` object is
 *  not a session the observation seam can correlate. */
const signedSession = (id: string, sessionId: string, admin = false) => ({
  user: { id, app_metadata: admin ? { role: 'masteradmin' } : {} },
  access_token: makeToken(id, sessionId),
})

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
    /** The session id the resolved session's JWT claims. A test that replaces the
     *  session changes this, which is what a real re-login does even for the same
     *  account id. A real Supabase session_id is a UUID. */
    sessionId: '11111111-1111-4111-8111-111111111111',
    /** Whether the resolved session carries an access token at all. The
     *  missing-credential control clears it. */
    hasToken: true,
    holdWrites: false,
    writes: [] as { payload: Record<string, unknown>; resolve: (accepted: boolean) => void }[],
    sessionReply: null as Promise<{ data: { session: unknown } }> | null,
    admin: false,
    /** The auth-event handler the SDK would call, so a test can emit SIGNED_OUT
     *  or SIGNED_IN exactly as the real client does. */
    authHandler: null as null | ((event: string, session: unknown) => void),
    /** The channel's subscribe callback, so a test can emit a reconnect. */
    subscribeHandler: null as null | ((status: string) => void),
    realtimeEvents: [] as string[],
    /** How many auth events the SDK delivered. */
    authEvents: 0,
    /** Authorization headers a request pinned through `pinBearer`. */
    pinnedHeaders: [] as Array<[string, string]>,
    /** A held SDK signOut, so a test can change the session mid-flight. */
    signOutGate: null as null | Promise<void>,
    /** The offline snapshot `loadSnapshot` answers. */
    snapshot: null as null | { users: unknown[]; trips: unknown[]; trashedTrips: unknown[]; published: unknown[]; suggestions: unknown[]; decisions: unknown[]; activity: unknown[]; savedAt: number },
  },
  toast: vi.fn(),
}))

vi.mock('../src/components/ui', () => ({ toast }))

vi.mock('../src/lib/offlineCache', () => ({
  loadSnapshot: async () => state.snapshot,
  saveSnapshot: async () => undefined,
  clearSnapshot: async () => undefined,
}))

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
      update: (payload: Record<string, unknown>) => { b.writePayload = payload; return b },
      upsert: () => b,
      delete: () => b,
      setHeader: (name: string, value: string) => { state.pinnedHeaders.push([name, value]); return b },
      then: (res: (v: { data: unknown; error: unknown }) => unknown) => {
        state.tableReads.push(table)
        if (table === 'profiles' && state.holdWrites && b.writePayload) {
          const payload = b.writePayload as Record<string, unknown>
          const id = String(filters.find(([key]) => key === 'id')?.[1])
          return new Promise<boolean>(resolve => { state.writes.push({ payload, resolve }) }).then(accepted => {
            const previous = state.profileRows[id]
            if (accepted && previous && typeof previous === 'object') {
              state.profileRows[id] = { ...previous, ...Object.fromEntries(Object.entries(payload).filter(([,value]) => value !== undefined)) }
            }
            return { data: null, error: accepted ? null : { message: 'refused' } }
          }).then(res)
        }
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
        getSession: () => {
          const pending = state.sessionReply
          state.sessionReply = null
          return pending ?? Promise.resolve({
            data: { session: state.sessionUser ? { user: { id: state.sessionUser, app_metadata: state.sessionAdmin ? { role: 'masteradmin' } : {} }, access_token: state.hasToken ? makeToken(state.sessionUser, state.sessionId) : '' } : null },
          })
        },
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
          setHeader: (name: string, value: string) => { state.pinnedHeaders.push([name, value]); return b },
          then: (res: (v: { data: unknown; error: unknown }) => unknown) => {
            const failed = (state.rpcError && fn === 'get_public_profile_cards')
              || (fn === 'is_disabled' && state.disabled === null)
              || state.rpcFailures.includes(fn)
            const data = failed ? null
              : fn === 'get_public_profile_cards' ? state.cards
                : fn === 'is_disabled' ? state.disabled
                  : null
            const settle = () => Promise.resolve({ data, error: failed ? { message: 'PGRST202' } : null })
            const parked = new Map(Object.entries(state.deferred)).get(fn)
            if (parked) { Reflect.set(state.deferred, fn, undefined); return parked().then(settle).then(res) }
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
  state.sessionId = '11111111-1111-4111-8111-111111111111'
  state.hasToken = true
  state.holdWrites = false
  state.writes = []
  state.sessionReply = null
  state.admin = false
  state.authHandler = null
  state.subscribeHandler = null
  state.realtimeEvents = []
  state.pinnedHeaders = []
  state.signOutGate = null
  state.snapshot = null
  toast.mockClear()
})

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
    store.resumeSync()
    await flush(); await flush()
    // The self read has settled AND the bulk read is held.
    expect(state.tableReads.filter(t => t === 'profiles').length).toBe(readsBefore + 2)
    // A real auth event for the same id with no role: the store observes the loss,
    // moves the authority revision, and reprojects the catalogue immediately.
    state.authHandler!('SIGNED_IN', signedSession('u-1', state.sessionId))
    release()
    await flush(); await flush()

    // The held read's install is rejected — its authority revision and its admin
    // flag both moved — and the reprojection has already taken u-2's private row
    // away.
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

    // Loss while the bulk read is in flight, emitted as a real auth event.
    let release!: () => void
    const readsBefore = state.tableReads.filter(t => t === 'profiles').length
    state.deferred.__holdProfiles = () => new Promise<void>(r => { release = r })
    store.resumeSync()
    await flush(); await flush()
    expect(state.tableReads.filter(t => t === 'profiles').length).toBe(readsBefore + 2)
    state.authHandler!('SIGNED_IN', signedSession('u-1', state.sessionId))
    release()
    await flush(); await flush()
    expect(privateIds(store)).toEqual(['u-1'])

    // Regain: the next run asks for the bulk again and it succeeds.
    state.authHandler!('SIGNED_IN', signedSession('u-1', state.sessionId, true))
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
    state.authHandler!('SIGNED_IN', signedSession('u-2', '22222222-2222-4222-8222-222222222222', true))
    await flush(); await flush()
    expect(privateIds(store)).toEqual(['u-2'])
    expect(store.getSnapshot().users.some(u => u.id === 'u-1' && u.kind === 'private')).toBe(false)
  })
})

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

    // The source trigger updates `profiles` as well as `profile_cards`, so the
    // private row the event's refresh reads back carries the new name too.
    state.profileRows = { 'u-1': { ...OWNER_PRIVATE, name: 'Asha Nair' } }
    store._applyRealtimeEventForTest('profile_cards', {
      eventType: 'UPDATE', table: 'profile_cards', schema: 'public',
      new: { ...OWNER_CARD, name: 'Asha Nair' }, old: {},
    } as never)
    await flush(); await flush()
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
    expect(state.rpcCalls.some(c => c.fn === 'is_disabled')).toBe(true)

    // The server disagrees. Only the authoritative check sees it.
    state.disabled = true
    expect(await store.recheckDisabledStatus()).toBe(true)
    expect(state.signOuts).toEqual(['u-1'])
  })
})

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
    state.authHandler!('SIGNED_IN', signedSession('u-2', '22222222-2222-4222-8222-222222222222', true))
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

  it('an intervening login then a sign-out is not the expected successor', async () => {
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

    // B signs in — which retires A's owned sign-out permanently — and then B
    // signs out, leaving an empty session that looks exactly like A's expected
    // successor.
    state.sessionUser = 'u-2'
    state.authHandler!('SIGNED_IN', signedSession('u-2', '22222222-2222-4222-8222-222222222222'))
    state.sessionUser = null
    state.authHandler!('SIGNED_OUT', null)
    expect(store.getSnapshot().sessionUserId).toBeNull()

    release()
    expect(await pending).toBe(false)
    expect(toast).not.toHaveBeenCalledWith(
      'This account has been disabled. Contact support if you think this is a mistake.', 'err',
    )
  })

  it('a same-ID replacement retires the owned sign-out', async () => {
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

    state.sessionId = '22222222-2222-4222-8222-222222222222'
    // The same account signs back in — a new session, same id — and then signs
    // out again. Neither successor belongs to the held operation.
    state.authHandler!('SIGNED_IN', signedSession('u-1', state.sessionId))
    state.authHandler!('SIGNED_OUT', null)
    release()
    expect(await pending).toBe(false)
    expect(toast).not.toHaveBeenCalledWith(
      'This account has been disabled. Contact support if you think this is a mistake.', 'err',
    )
  })

  it('overlapping disabled checks share one operation and one message', async () => {
    const store = await freshStore()
    state.sessionUser = 'u-1'
    state.disabled = false
    state.profileRows = {}
    store.init()
    await flush(); await flush()

    let release!: () => void
    state.signOutGate = new Promise<void>(r => { release = r })
    state.disabled = true
    const first = store.enforceDisabledCheck()
    const second = store.enforceDisabledCheck()
    await flush()
    // One sign-out, not two: the second caller joined the operation in flight.
    expect(state.signOuts).toEqual(['u-1'])
    release()
    expect(await first).toBe(true)
    expect(await second).toBe(true)
    expect(state.signOuts).toEqual(['u-1'])
    // And the explanation is shown exactly once — the account switch's own
    // partial-load report is a different message about a different read.
    const disabledCalls = toast.mock.calls.filter(c => c[0] === 'This account has been disabled. Contact support if you think this is a mistake.')
    expect(disabledCalls).toHaveLength(1)
    expect(toast).toHaveBeenCalledWith(
      'This account has been disabled. Contact support if you think this is a mistake.', 'err',
    )
  })
})

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

  it('the signed-in route gate takes the page for a retained row', async () => {
    const { profileLookupBlocksRoute } = await import('../src/App')
    // The gate is consulted for a signed-in account WITH a private row, not only
    // for one without. A helper reachable only inside `!me` could never see this.
    expect(profileLookupBlocksRoute('userA', true, 'failed', true, false)).toBe(true)
    expect(profileLookupBlocksRoute('userA', true, 'ready', true, false)).toBe(false)
    expect(profileLookupBlocksRoute('userA', true, 'reading', true, false)).toBe(false)
    // Guest-accessible segments stay reachable on a failure.
    expect(profileLookupBlocksRoute('userA', true, 'failed', false, false)).toBe(true)
  })

  it('self success stands on its own verdict when only the public catalogue fails', async () => {
    const { profileLookupState } = await import('../src/App')
    // A successful private read with a row is a ready account, whatever the
    // public catalogue did. A consumer that OR-ed the public failure in would
    // hide a working import action behind a profile failure.
    expect(profileLookupState('userA', true, { 'self profile': 'ok', profiles: 'failed' })).toBe('ready')
    // A failed private read is failed even when the public catalogue succeeded.
    expect(profileLookupState('userA', true, { 'self profile': 'failed', profiles: 'ok' })).toBe('failed')
  })
})

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
    state.profileRows = { 'u-1': { ...OWNER_PRIVATE, name: 'Asha Nair' } }
    const ok = await store.updateProfile({ name: 'Asha Nair' })
    expect(ok).toEqual({ ok: true })
    expect(store.currentUser()?.profile.name).toBe('Asha Nair')

    // …and the install RE-STAMPED the catalogue, which is what a later public
    // refresh reads. The fresh public card carries the new name, so the private
    // row keeps it rather than falling back to the old one.
    state.cards = [{ ...OWNER_CARD, name: 'Asha Nair' }, OTHER_CARD]
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
    state.authHandler!('SIGNED_IN', signedSession('u-1', state.sessionId))
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

    // …and a live event renames that same account. The source trigger updates the
    // private row too, so the admin bulk read the event's refresh issues answers
    // with the new name.
    state.allProfileRows = [OWNER_PRIVATE, { ...OTHER_PRIVATE, name: 'Bilal Ahmed' }]
    store._applyRealtimeEventForTest('profile_cards', {
      eventType: 'UPDATE', table: 'profile_cards', schema: 'public',
      new: { ...OTHER_CARD, name: 'Bilal Ahmed' }, old: {},
    } as never)
    await flush(); await flush()
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.profile.name).toBe('Bilal Ahmed')

    // The RPC is then refused. The rollback restores the field this edit owned —
    // and only that field — so the newer rename survives.
    release()
    expect(await pending).toBe(false)
    const u2 = store.getSnapshot().users.find(u => u.id === 'u-2') as { kind: string; profile: { name: string; isDisabled?: boolean } }
    expect(u2.profile.name).toBe('Bilal Ahmed')
    expect(u2.profile.isDisabled).toBe(false)
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

describe('a private change reaches the screen through a real trigger', () => {
  it('an admin sees another account\'s changed private flag after a safe event', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, { ...OTHER_PRIVATE, is_disabled: false }]
    store.init()
    await flush(); await flush()
    expect((store.getSnapshot().users.find(u => u.id === 'u-2') as { profile: { isDisabled?: boolean } }).profile.isDisabled)
      .toBe(false)

    // The account is disabled server-side. The event carries only public fields,
    // so without a private refresh the console would keep showing it enabled.
    state.allProfileRows = [OWNER_PRIVATE, { ...OTHER_PRIVATE, is_disabled: true }]
    store._applyRealtimeEventForTest('profile_cards', {
      eventType: 'UPDATE', table: 'profile_cards', schema: 'public',
      new: { ...OTHER_CARD, creator_available: false }, old: {},
    } as never)
    await flush(); await flush(); await flush()

    const u2 = store.getSnapshot().users.find(u => u.id === 'u-2') as { kind: string; profile: { isDisabled?: boolean } }
    expect(u2.kind).toBe('private')
    expect(u2.profile.isDisabled).toBe(true)
  })

  it('a non-admin other-user event stays public-only and issues no private read', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    store.init()
    await flush(); await flush()
    const readsBefore = state.tableReads.filter(t => t === 'profiles').length

    store._applyRealtimeEventForTest('profile_cards', {
      eventType: 'UPDATE', table: 'profile_cards', schema: 'public',
      new: { ...OTHER_CARD, name: 'Bilal Ahmed' }, old: {},
    } as never)
    await flush(); await flush(); await flush()

    // No private read was issued for another account's row, and u-2 stays a
    // public card.
    expect(state.tableReads.filter(t => t === 'profiles').length).toBe(readsBefore)
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.kind).toBe('public')
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.profile.name).toBe('Bilal Ahmed')
  })

  it('a reconnect with no trips still asks about the caller and the private rows', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    store.init()
    await flush(); await flush()
    expect(store.getSnapshot().trips).toHaveLength(0)
    state.rpcCalls = []
    const readsBefore = state.tableReads.filter(t => t === 'profiles').length

    state.disabled = true
    expect(state.subscribeHandler).not.toBeNull()
    state.subscribeHandler!('SUBSCRIBED')
    state.subscribeHandler!('SUBSCRIBED')
    await flush(); await flush(); await flush()

    // The account-level work runs OUTSIDE the trip-count gate.
    expect(state.rpcCalls.some(c => c.fn === 'is_disabled')).toBe(true)
    expect(state.signOuts).toEqual(['u-1'])
    expect(toast).toHaveBeenCalledWith(
      'This account has been disabled. Contact support if you think this is a mistake.', 'err',
    )
    expect(state.tableReads.filter(t => t === 'profiles').length).toBeGreaterThan(readsBefore)
  })

  it('a burst of safe events issues one private read, not one per event', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.init()
    await flush(); await flush()
    const readsBefore = state.tableReads.filter(t => t === 'profiles').length

    // The source trigger updates the private row as well as the card, so the bulk
    // read the refresh issues answers with the newest name.
    state.allProfileRows = [OWNER_PRIVATE, { ...OTHER_PRIVATE, name: 'D' }]
    for (const name of ['A', 'B', 'C', 'D']) {
      store._applyRealtimeEventForTest('profile_cards', {
        eventType: 'UPDATE', table: 'profile_cards', schema: 'public',
        new: { ...OTHER_CARD, name }, old: {},
      } as never)
    }
    await flush(); await flush(); await flush()

    // Four events share the read already running, plus at most one trailing pass
    // for whatever landed while it ran — never one read per event.
    const reads = state.tableReads.filter(t => t === 'profiles').length - readsBefore
    expect(reads).toBeGreaterThan(0)
    expect(reads).toBeLessThanOrEqual(2)
    // The installed value is the last one the burst carried.
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.profile.name).toBe('D')
    expect(privateIds(store).sort()).toEqual(['u-1', 'u-2'])
  })

  it('a resume asks the server when the retained self row came from a failed read', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    store.init()
    await flush(); await flush()
    expect(store.currentUser()?.kind).toBe('private')

    // The next run's self read fails, so the row is retained but its verdict says
    // the account's status is unproven.
    state.profileErrors = { 'u-1': { message: 'row unavailable' } }
    await store.resumeSync()
    await flush(); await flush()
    expect(store.getSnapshot().sliceReads['self profile']).toBe('failed')

    // The cached row still says enabled, and it is exactly the stale state a
    // resume exists to catch — so the check goes to the server rather than
    // trusting it.
    state.rpcCalls = []
    state.disabled = true
    expect(await store.enforceDisabledCheck()).toBe(true)
    expect(state.rpcCalls.some(c => c.fn === 'is_disabled')).toBe(true)
    expect(state.signOuts).toEqual(['u-1'])
  })
})

describe('a public refresh overlays fresh fields onto a retained private row', () => {
  it('a remote rename, avatar and availability change reach the private row', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.init()
    await flush(); await flush()

    // The public retry reads fresh cards with a new name, avatar and
    // availability, while the private slices are not re-read.
    state.cards = [
      { ...OWNER_CARD, name: 'Asha Nair', avatar_url: 'https://cdn/a2.png', creator_available: false },
      { ...OTHER_CARD, name: 'Bilal Ahmed', creator_available: false },
    ]
    await store.rereadPublicSlices()
    await flush(); await flush()

    const me = store.currentUser() as unknown as { kind: string; email: string; profile: Record<string, unknown> }
    // The private fields survive…
    expect(me.kind).toBe('private')
    expect(me.email).toBe('a@example.invalid')
    // …and the fresh public ones landed on top.
    expect(me.profile.name).toBe('Asha Nair')
    expect(me.profile.avatarUrl).toBe('https://cdn/a2.png')
    expect(me.profile.creatorAvailable).toBe(false)
    const u2 = store.getSnapshot().users.find(u => u.id === 'u-2') as { kind: string; profile: Record<string, unknown> }
    expect(u2.kind).toBe('private')
    expect(u2.profile.name).toBe('Bilal Ahmed')
    expect(u2.profile.creatorAvailable).toBe(false)
  })

  it('a failed private hydration keeps the fresh public fields over the fallback', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.init()
    await flush(); await flush()

    // Both private reads fail — the table itself is unreadable — so both private
    // rows are fallbacks, while the public catalogue succeeded with fresh fields.
    state.tableErrors = { profiles: { message: 'table unavailable' } }
    state.cards = [{ ...OWNER_CARD, name: 'Asha Nair' }, { ...OTHER_CARD, name: 'Bilal Ahmed' }]
    await store.resumeSync()
    await flush(); await flush()

    const me = store.currentUser() as unknown as { kind: string; email: string; profile: { name: string } }
    expect(me.kind).toBe('private')
    expect(me.email).toBe('a@example.invalid')
    expect(me.profile.name).toBe('Asha Nair')
    const u2 = store.getSnapshot().users.find(u => u.id === 'u-2') as { kind: string; profile: { name: string } }
    expect(u2.kind).toBe('private')
    expect(u2.profile.name).toBe('Bilal Ahmed')
    // Both carry the failed verdict, so the notice and its retry are reachable.
    expect(store.getSnapshot().sliceReads['self profile']).toBe('failed')
    expect(store.getSnapshot().sliceReads['admin profiles']).toBe('failed')
  })
})

describe('a hostile nested social key never survives a public projection', () => {
  const HOSTILE = {
    id: 'u-1', kind: 'private' as const, email: 'a@example.invalid', createdAt: 1,
    profile: {
      name: 'Asha', languages: ['en'], travelStyles: [], isCreator: true,
      socialLinks: { youtube: 'https://y/@a', email: 'a@example.invalid' } as unknown as { youtube?: string },
    },
  }

  it('a live-card delta overlays the reviewed links onto a retained private row', async () => {
    const { buildCatalog } = await import('../src/store/profileCatalog')
    const fresh = {
      id: 'u-1', kind: 'public' as const,
      profile: { name: 'Asha Nair', isCreator: true, creatorAvailable: true, socialLinks: { youtube: 'https://y/@a2' } },
    }
    const result = buildCatalog(
      { userId: 'u-1', identityEpoch: 0, authorityEpoch: 0, admin: false },
      {
        public: { users: [fresh], failed: false, complete: false },
        self: { status: 'not-requested' },
        admin: { status: 'not-requested' },
      },
      { ownerUserId: 'u-1', identityEpoch: 0, authorityEpoch: 0, selfAuthorized: true, users: [HOSTILE] },
    )
    const me = result.users.find(u => u.id === 'u-1') as unknown as { kind: string; profile: Record<string, unknown> }
    // The private row is retained — the private fields survive…
    expect(me.kind).toBe('private')
    expect(me.profile.languages).toEqual(['en'])
    // …and the card's reviewed fields, including the rebuilt nested object, land
    // on top. The canary is gone.
    expect(me.profile.name).toBe('Asha Nair')
    expect(me.profile.socialLinks).toEqual({ youtube: 'https://y/@a2' })
  })

  it('the authority gate downgrade drops the nested canary', async () => {
    const { buildCatalog } = await import('../src/store/profileCatalog')
    // An admin batch installs the hostile row, then the caller loses admin
    // authority and the gate downgrades it.
    const result = buildCatalog(
      { userId: 'u-9', identityEpoch: 0, authorityEpoch: 1, admin: false },
      {
        public: { users: [], failed: false, complete: true },
        self: { status: 'not-requested' },
        admin: { status: 'ok', value: [HOSTILE] },
      },
      { ownerUserId: null, authorityEpoch: null, selfAuthorized: false, users: [] },
    )
    const public1 = result.users.find(u => u.id === 'u-1')
    expect(public1?.kind).toBe('public')
    const links = (public1 as unknown as { profile: { socialLinks?: Record<string, unknown> } }).profile.socialLinks
    expect(Object.keys(links ?? {})).toEqual(['youtube'])
  })

  it('the store projection and the offline snapshot agree with it', async () => {
    const store = await freshStore()
    // The store's own projection of the hostile row is the reviewed allowlist.
    expect(store.publicOnlyUsers([HOSTILE])[0].profile.socialLinks).toEqual({ youtube: 'https://y/@a' })

    // And a real authority loss projects the same way. The public read fails, so
    // u-2's entry can only come from projecting the retained private row.
    const hostileOther = {
      ...OTHER_PRIVATE,
      social_links: { youtube: 'https://y/@b', email: 'b@example.invalid' },
    }
    signIn(store, 'u-1', true)
    state.cards = [OWNER_CARD]
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, hostileOther]
    store.init()
    await flush(); await flush()
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.kind).toBe('private')

    state.rpcError = true
    state.authHandler!('SIGNED_IN', signedSession('u-1', state.sessionId))
    await flush(); await flush()
    const u2 = store.getSnapshot().users.find(u => u.id === 'u-2') as unknown as { kind: string; profile: { socialLinks?: Record<string, unknown> } }
    expect(u2.kind).toBe('public')
    expect(Object.keys(u2.profile.socialLinks ?? {})).toEqual(['youtube'])
    expect(store.publicOnlyUsers(store.getSnapshot().users).find(u => u.id === 'u-2')?.profile.socialLinks)
      .toEqual({ youtube: 'https://y/@b' })
  })
})

describe('a refused edit restores only its own operation-owned data', () => {
  it('a refusal from retired A cannot mutate B\'s admin-held A row', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': { ...OWNER_PRIVATE, home_city: 'OldCity' } }
    store.init()
    await flush(); await flush()
    expect((store.currentUser()?.profile as { homeCity?: string }).homeCity).toBe('OldCity')

    // A's write is HELD by the table, so the refusal is still in flight when B
    // signs in.
    state.profileErrors = { 'u-1': { message: 'row-level security policy' } }
    let release!: () => void
    state.deferred.__holdSelf = () => new Promise<void>(r => { release = r })
    const pending = store.updateProfile({ homeCity: 'NewCity' })
    await flush()
    expect((store.currentUser()?.profile as { homeCity?: string }).homeCity).toBe('NewCity')

    // B signs in as admin and hydrates A's row, which currently holds the value
    // A optimistically wrote.
    state.sessionUser = 'u-2'
    state.sessionAdmin = true
    state.profileRows = { 'u-1': { ...OWNER_PRIVATE, home_city: 'NewCity' }, 'u-2': { ...OTHER_PRIVATE } }
    state.allProfileRows = [{ ...OWNER_PRIVATE, home_city: 'NewCity' }, { ...OTHER_PRIVATE }]
    state.authHandler!('SIGNED_IN', signedSession('u-2', '22222222-2222-4222-8222-222222222222', true))
    await flush(); await flush()
    const held = store.getSnapshot().users.find(u => u.id === 'u-1') as { kind: string; profile: { homeCity?: string } }
    expect(held.kind).toBe('private')
    expect(held.profile.homeCity).toBe('NewCity')

    // A's refusal now lands. Its operation was retired by B's sign-in, so it
    // writes nothing at all — even though the current value equals the value it
    // optimistically wrote.
    release()
    expect(await pending).toEqual({ ok: false, error: 'Profile not saved. Check your connection and try again.' })
    const after = store.getSnapshot().users.find(u => u.id === 'u-1') as { profile: { homeCity?: string } }
    expect(after.profile.homeCity).toBe('NewCity')
  })

  it('a refusal under the same session still restores its own field', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': { ...OWNER_PRIVATE, home_city: 'OldCity' } }
    store.init()
    await flush(); await flush()

    state.profileErrors = { 'u-1': { message: 'row-level security policy' } }
    expect(await store.updateProfile({ homeCity: 'NewCity' })).toEqual({
      ok: false, error: 'Profile not saved. Check your connection and try again.',
    })
    expect((store.currentUser()?.profile as { homeCity?: string }).homeCity).toBe('OldCity')
  })

  it('a refused admin edit cannot revert another account\'s row after an authority loss', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.init()
    await flush(); await flush()

    state.rpcFailures = ['admin_set_disabled']
    let release!: () => void
    state.deferred.admin_set_disabled = () => new Promise<void>(r => { release = r })
    const pending = store.adminSetDisabled('u-2', true)
    await flush()
    expect((store.getSnapshot().users.find(u => u.id === 'u-2') as { profile: { isDisabled?: boolean } }).profile.isDisabled).toBe(true)

    // The caller loses admin authority while the RPC is in flight.
    state.authHandler!('SIGNED_IN', signedSession('u-1', state.sessionId))
    await flush()
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.kind).toBe('public')

    release()
    expect(await pending).toBe(false)
    // The retired operation wrote nothing back, and u-2 stays public.
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.kind).toBe('public')
    expect(store.getSnapshot().users.some(u => u.id === 'u-2' && u.kind === 'private')).toBe(false)
  })
})

describe('a refused delete restores only the row it removed', () => {
  it('a refusal preserves an unrelated accepted rename', async () => {
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

    // An unrelated accepted rename lands while the delete is in flight.
    state.allProfileRows = [OWNER_PRIVATE, { ...OTHER_PRIVATE, name: 'Bilal Ahmed' }]
    store._applyRealtimeEventForTest('profile_cards', {
      eventType: 'UPDATE', table: 'profile_cards', schema: 'public',
      new: { ...OTHER_CARD, name: 'Bilal Ahmed' }, old: {},
    } as never)
    await flush(); await flush()
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.profile.name).toBe('Bilal Ahmed')

    release()
    expect(await pending).toBe(false)
    // The deleted row is back, and the rename survived.
    const u2 = store.getSnapshot().users.find(u => u.id === 'u-2') as { kind: string; profile: { name: string } }
    expect(u2.kind).toBe('private')
    expect(u2.profile.name).toBe('Bilal Ahmed')
    expect(privateIds(store).sort()).toEqual(['u-1', 'u-2'])
  })

  it('a refusal from retired A cannot restore A\'s row under B', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.init()
    await flush(); await flush()

    let release!: () => void
    state.deferred.admin_delete_user = () => new Promise<void>(r => { release = r })
    state.rpcFailures = ['admin_delete_user']
    const pending = store.adminDeleteUser('u-2')
    await flush()
    expect(store.getSnapshot().users.some(u => u.id === 'u-2')).toBe(false)

    // B signs in as admin while the delete is in flight.
    state.sessionUser = 'u-2'
    state.sessionAdmin = true
    state.profileRows = { 'u-2': { ...OTHER_PRIVATE } }
    state.allProfileRows = [{ ...OTHER_PRIVATE }]
    state.authHandler!('SIGNED_IN', signedSession('u-2', '22222222-2222-4222-8222-222222222222', true))
    await flush(); await flush()
    expect(privateIds(store)).toEqual(['u-2'])

    release()
    expect(await pending).toBe(false)
    // The retired operation restored nothing, and A's row did not come back.
    expect(privateIds(store)).toEqual(['u-2'])
    expect(store.getSnapshot().users.some(u => u.id === 'u-1' && u.kind === 'private')).toBe(false)
  })
})

describe('ownership covers a field whose prior value was absent', () => {
  it('a first-time creatorBio is removed when the write is refused', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    // creatorBio starts ABSENT.
    state.profileRows = { 'u-1': { ...OWNER_PRIVATE, creator_bio: null } }
    store.init()
    await flush(); await flush()
    expect((store.currentUser()?.profile as { creatorBio?: string }).creatorBio).toBeUndefined()

    state.profileErrors = { 'u-1': { message: 'row-level security policy' } }
    expect(await store.updateProfile({ creatorBio: 'Rejected bio' })).toEqual({
      ok: false, error: 'Profile not saved. Check your connection and try again.',
    })
    // The rejected value is gone, not left behind.
    expect((store.currentUser()?.profile as { creatorBio?: string }).creatorBio).toBeUndefined()
    // And it is absent from the public projection too, so nothing carries it.
    const projected = store.publicOnlyUsers(store.getSnapshot().users).find(u => u.id === 'u-1')
    expect(projected?.profile.creatorBio).toBeUndefined()
  })

  it('an unrelated accepted update survives a refused optional field', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': { ...OWNER_PRIVATE, creator_bio: null } }
    store.init()
    await flush(); await flush()

    // Hold the write so the event lands while it is in flight.
    state.profileErrors = { 'u-1': { message: 'row-level security policy' } }
    let release!: () => void
    state.deferred.__holdSelf = () => new Promise<void>(r => { release = r })
    const pending = store.updateProfile({ creatorBio: 'Rejected bio' })
    await flush()
    expect((store.currentUser()?.profile as { creatorBio?: string }).creatorBio).toBe('Rejected bio')

    // A live event renames the account while the write is in flight. The source
    // trigger updates the private row too.
    state.profileRows = { 'u-1': { ...OWNER_PRIVATE, creator_bio: null, name: 'Asha Nair' } }
    store._applyRealtimeEventForTest('profile_cards', {
      eventType: 'UPDATE', table: 'profile_cards', schema: 'public',
      // The card carries no bio, so the only accepted change here is the name.
      new: { id: 'u-1', name: 'Asha Nair', avatar_url: 'https://cdn/a.png', is_creator: true, creator_available: true }, old: {},
    } as never)
    await flush(); await flush()

    release()
    expect(await pending).toEqual({ ok: false, error: 'Profile not saved. Check your connection and try again.' })
    const profile = store.currentUser()?.profile as { name: string; creatorBio?: string }
    // The accepted rename survived, and the refused bio is gone.
    expect(profile.name).toBe('Asha Nair')
    expect(profile.creatorBio).toBeUndefined()
  })
})

describe('a disabled sign-out owns its record on every branch', () => {
  it('a same-ID replacement that stays active is not the expected successor', async () => {
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

    state.sessionId = '22222222-2222-4222-8222-222222222222'
    // The SAME id signs in again — a new session with its own lifetime —
    // and stays active. The old sign-out's expected successor can never arrive.
    state.authHandler!('SIGNED_IN', signedSession('u-1', state.sessionId))
    expect(store.getSnapshot().sessionUserId).toBe('u-1')

    release()
    expect(await pending).toBe(false)
    expect(toast).not.toHaveBeenCalledWith(
      'This account has been disabled. Contact support if you think this is a mistake.', 'err',
    )
  })

  it('a token refresh is not a replacement, so the expected successor survives', async () => {
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

    // A token refresh carries the same session. It must not retire the record.
    state.authHandler!('TOKEN_REFRESHED', signedSession('u-1', state.sessionId))
    release()
    expect(await pending).toBe(true)
    expect(toast).toHaveBeenCalledWith(
      'This account has been disabled. Contact support if you think this is a mistake.', 'err',
    )
  })

  it('a reconnect and a direct check share one operation and one message', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    store.init()
    await flush(); await flush()

    state.disabled = true
    state.rpcCalls = []
    // The reconnect step calls recheckDisabledStatus directly, which is the entry
    // point the old serialization did not cover.
    state.subscribeHandler!('SUBSCRIBED')
    state.subscribeHandler!('SUBSCRIBED')
    const direct = store.recheckDisabledStatus()
    await flush()

    // One SDK sign-out and one explanation, not two.
    expect(state.signOuts).toEqual(['u-1'])
    expect(await direct).toBe(true)
    const calls = toast.mock.calls.filter(c => c[0] === 'This account has been disabled. Contact support if you think this is a mistake.')
    expect(calls).toHaveLength(1)
  })
})

describe('an admin loss keeps the same session\'s self row and drops the others', () => {
  it('the constructor keeps self private while other rows become public', async () => {
    const { buildCatalog } = await import('../src/store/profileCatalog')
    const previous = {
      ownerUserId: 'u-1', identityEpoch: 0, authorityEpoch: 0, selfAuthorized: true,
      users: [
        { ...rowToPrivateUser(OWNER_PRIVATE) },
        { ...rowToPrivateUser(OTHER_PRIVATE) },
      ],
    }
    // Admin lost: the authority revision moved, the identity generation did not.
    const result = buildCatalog(
      { userId: 'u-1', identityEpoch: 0, authorityEpoch: 1, admin: false },
      {
        public: { users: [], failed: true, complete: false, requested: false },
        self: { status: 'not-requested' },
        admin: { status: 'not-requested' },
      },
      previous,
    )
    expect(result.users.find(u => u.id === 'u-1')?.kind).toBe('private')
    expect(result.users.find(u => u.id === 'u-2')?.kind).toBe('public')
  })

  it('a new login with the same id does not inherit the self fallback', async () => {
    const { buildCatalog } = await import('../src/store/profileCatalog')
    const previous = {
      ownerUserId: 'u-1', identityEpoch: 0, authorityEpoch: 0, selfAuthorized: true,
      users: [{ ...rowToPrivateUser(OWNER_PRIVATE) }],
    }
    const result = buildCatalog(
      { userId: 'u-1', identityEpoch: 1, authorityEpoch: 0, admin: false },
      {
        public: { users: [], failed: true, complete: false, requested: false },
        self: { status: 'not-requested' },
        admin: { status: 'not-requested' },
      },
      previous,
    )
    expect(result.users.find(u => u.id === 'u-1')?.kind).toBe('public')
  })

  it('the auth callback keeps self private and downgrades the rest on a loss', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.init()
    await flush(); await flush()
    expect(privateIds(store).sort()).toEqual(['u-1', 'u-2'])

    // Same id, no role: the authority revision moves, the identity generation
    // does not, and the reprojection runs before any read.
    state.authHandler!('SIGNED_IN', signedSession('u-1', state.sessionId))
    await flush(); await flush()
    expect(privateIds(store)).toEqual(['u-1'])
    expect(store.getSnapshot().users.find(u => u.id === 'u-2')?.kind).toBe('public')
    expect(store.currentUser()?.kind).toBe('private')
    expect(store.currentUser()?.email).toBe('a@example.invalid')
  })

  it('explicit private absence keeps a public card read in the same run', async () => {
    const { buildCatalog } = await import('../src/store/profileCatalog')
    const previous = {
      ownerUserId: 'u-1', identityEpoch: 0, authorityEpoch: 0, selfAuthorized: true,
      users: [{ ...rowToPrivateUser(OWNER_PRIVATE) }],
    }
    const result = buildCatalog(
      { userId: 'u-1', identityEpoch: 0, authorityEpoch: 0, admin: false },
      {
        public: { users: [rowToPublicUser(OWNER_CARD)], failed: false, complete: true, requested: true },
        self: { status: 'absent' },
        admin: { status: 'not-requested' },
      },
      previous,
    )
    const self = result.users.find(u => u.id === 'u-1')
    // The private state is gone; the safe public identity survives.
    expect(self?.kind).toBe('public')
    expect((self as { email?: string }).email).toBeUndefined()
    expect((self as { profile: { name: string } }).profile.name).toBe('Asha')
  })
})

describe('a private refresh never certifies the public catalogue', () => {
  it('a public failure survives a successful private read through a safe event', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    store.init()
    await flush(); await flush()
    expect(store.getSnapshot().sliceReads.profiles).toBe('ok')

    // The public catalogue fails, then a safe event triggers the private refresh.
    // The source trigger updates the private row too, so the refresh answers with
    // the new name.
    state.rpcError = true
    state.profileRows = { 'u-1': { ...OWNER_PRIVATE, name: 'Asha Nair' } }
    await store.rereadPublicSlices()
    await flush(); await flush()
    expect(store.getSnapshot().sliceReads.profiles).toBe('failed')

    store._applyRealtimeEventForTest('profile_cards', {
      eventType: 'UPDATE', table: 'profile_cards', schema: 'public',
      new: { ...OWNER_CARD, name: 'Asha Nair' }, old: {},
    } as never)
    await flush(); await flush(); await flush()

    // The private read succeeded and the private row is fresh…
    expect(store.currentUser()?.kind).toBe('private')
    expect(store.currentUser()?.profile.name).toBe('Asha Nair')
    // …but the public slice keeps its failure.
    expect(store.getSnapshot().sliceReads.profiles).toBe('failed')
  })

  it('a zero-trip reconnect leaves a public failure failed after the private refresh', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    store.init()
    await flush(); await flush()
    expect(store.getSnapshot().trips).toHaveLength(0)

    state.rpcError = true
    await store.rereadPublicSlices()
    await flush(); await flush()
    expect(store.getSnapshot().sliceReads.profiles).toBe('failed')

    state.subscribeHandler!('SUBSCRIBED')
    state.subscribeHandler!('SUBSCRIBED')
    await flush(); await flush(); await flush()

    // The reconnect performs the private refresh and then returns before the
    // public profile step, so a false ready state would be final here.
    expect(store.getSnapshot().sliceReads.profiles).toBe('failed')
    expect(store.currentUser()?.kind).toBe('private')
  })

  it('a private failure survives a successful public read', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    store.init()
    await flush(); await flush()

    state.profileErrors = { 'u-1': { message: 'row unavailable' } }
    await store.resumeSync()
    await flush(); await flush()
    expect(store.getSnapshot().sliceReads['self profile']).toBe('failed')

    await store.rereadPublicSlices()
    await flush(); await flush()
    expect(store.getSnapshot().sliceReads.profiles).toBe('ok')
    expect(store.getSnapshot().sliceReads['self profile']).toBe('failed')
  })

  it('a new session does not join an old session\'s refresh', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    store.init()
    await flush(); await flush()
    const readsBefore = state.tableReads.filter(t => t === 'profiles').length

    // An event for u-1 starts a refresh, then B signs in before it settles.
    store._applyRealtimeEventForTest('profile_cards', {
      eventType: 'UPDATE', table: 'profile_cards', schema: 'public',
      new: { ...OWNER_CARD, name: 'Asha Nair' }, old: {},
    } as never)
    state.sessionUser = 'u-2'
    state.profileRows = { 'u-2': { ...OTHER_PRIVATE } }
    state.authHandler!('SIGNED_IN', signedSession('u-2', '22222222-2222-4222-8222-222222222222'))
    await flush(); await flush(); await flush()

    // B's own private read ran, rather than B returning on A's read.
    const reads = state.tableReads.filter(t => t === 'profiles').length - readsBefore
    expect(reads).toBeGreaterThan(0)
    expect(store.currentUser()?.id).toBe('u-2')
  })
})

describe('a signed-in offline snapshot boot keeps its safe identities', () => {
  const legacy = {
    users: [
      { id: 'u-1', kind: 'private', email: 'a@example.invalid', createdAt: 1, profile: { name: 'Asha', homeCity: 'Kochi', languages: ['en'], travelStyles: [], isCreator: true } },
      { id: 'u-2', kind: 'private', email: 'b@example.invalid', createdAt: 2, profile: { name: 'Bilal', homeCity: 'Kochi', languages: ['en'], travelStyles: [], isCreator: false } },
    ],
    trips: [], trashedTrips: [], published: [], suggestions: [], decisions: [], activity: [], savedAt: 1,
  }

  it('installs the sanitized snapshot under the current session ticket', async () => {
    const store = await freshStore()
    state.sessionUser = 'u-1'
    state.snapshot = legacy
    store.init()
    await flush(); await flush(); await flush()

    const users = store.getSnapshot().users
    // The safe names and avatars survived the sanitising boot.
    expect(users.map(u => u.id).sort()).toEqual(['u-1', 'u-2'])
    // No private field came back, and no private authority was manufactured.
    expect(users.every(u => u.kind === 'public')).toBe(true)
    expect(users.every(u => (u as { email?: string }).email === undefined)).toBe(true)
    expect(store.getSnapshot().catalogAuthority?.selfAuthorized).toBe(false)
    expect(store.getSnapshot().ready).toBe(true)
    expect(store.getSnapshot().sessionUserId).toBe('u-1')
  })

  it('an account switch while loading does not install the old snapshot', async () => {
    const store = await freshStore()
    state.sessionUser = 'u-1'
    state.snapshot = legacy
    store.init()
    await flush()

    // B signs in while the snapshot is still loading.
    state.sessionUser = 'u-2'
    state.authHandler!('SIGNED_IN', signedSession('u-2', '22222222-2222-4222-8222-222222222222'))
    await flush(); await flush(); await flush()

    // The retired snapshot install was rejected, so A's rows are not in B's cache
    // and B's readiness was not published from A's snapshot.
    expect(store.getSnapshot().users.some(u => u.id === 'u-1' && u.kind === 'private')).toBe(false)
    expect(store.getSnapshot().sessionUserId).toBe('u-2')
  })
})

describe('session lifetime and ordered profile edits', () => {
  async function boot() {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': { ...OWNER_PRIVATE } }
    store.init()
    await flush(); await flush()
    expect(store.currentUser()?.profile.homeCity).toBe('Kochi')
    return store
  }

  it('refuses private queries without captured credentials', async () => {
    const store = await freshStore()
    state.hasToken = false
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    store.init()
    await flush(); await flush()
    expect(state.tableReads.filter(table => table === 'profiles')).toHaveLength(0)
    expect(store.getSnapshot().sliceReads['self profile']).toBe('failed')
    expect(store.currentUser()).toBeNull()
  })

  it.each(['bootstrap', 'resume'])('ignores an older getSession response during %s', async phase => {
    const store = phase === 'resume' ? await boot() : await freshStore()
    let release = () => {}
    state.sessionReply = new Promise(resolve => { release = () => resolve({ data: { session: signedSession('u-1', state.sessionId) } }) })
    let pending: Promise<void> | undefined
    if (phase === 'resume') pending = store.resumeSync()
    else store.init()
    state.sessionUser = 'u-2'
    state.sessionAdmin = true
    state.profileRows = { 'u-2': OTHER_PRIVATE }
    state.allProfileRows = [OTHER_PRIVATE]
    state.authHandler!('SIGNED_IN', signedSession('u-2', '22222222-2222-4222-8222-222222222222', true))
    await flush(); await flush()
    expect(store.currentUser()?.id).toBe('u-2')
    release()
    await pending
    await flush()
    expect(store.currentUser()?.id).toBe('u-2')
    expect(store._isAdminForTest()).toBe(true)
  })

  it('does not revive bootstrap after resume adopts a newer session without a callback', async () => {
    const store = await freshStore()
    let release = () => {}
    state.sessionReply = new Promise(resolve => { release = () => resolve({ data: { session: signedSession('u-1', '11111111-1111-4111-8111-111111111111') } }) })
    store.init()
    state.sessionUser = 'u-2'
    state.sessionId = '22222222-2222-4222-8222-222222222222'
    state.profileRows = { 'u-2': OTHER_PRIVATE }
    await store.resumeSync()
    expect(store.currentUser()?.id).toBe('u-2')
    release()
    await flush(); await flush()
    expect(store.currentUser()?.id).toBe('u-2')
  })

  it('starts a same-account replacement before the old private response resolves', async () => {
    const store = await freshStore()
    state.profileRows = { 'u-1': { ...OWNER_PRIVATE, home_city: 'OLD_PRIVATE' } }
    let release = () => {}
    state.deferred.__holdSelf = () => new Promise<void>(resolve => { release = resolve })
    store.init()
    await flush()
    state.profileRows = { 'u-1': { ...OWNER_PRIVATE, home_city: 'NEW_PRIVATE' } }
    state.sessionId = '22222222-2222-4222-8222-222222222222'
    state.authHandler!('SIGNED_IN', signedSession('u-1', state.sessionId))
    expect(store.currentUser()).toBeNull()
    await flush(); await flush()
    expect(store.currentUser()?.profile.homeCity).toBe('NEW_PRIVATE')
    release()
    await flush(); await flush()
    expect(store.currentUser()?.profile.homeCity).toBe('NEW_PRIVATE')
  })

  it.each(['SIGNED_IN', 'TOKEN_REFRESHED'])('preserves a pending read on same-session %s', async event => {
    const store = await freshStore()
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    let release = () => {}
    state.deferred.__holdSelf = () => new Promise<void>(resolve => { release = resolve })
    store.init()
    await flush()
    const calls = state.tableReads.filter(table => table === 'profiles').length
    const session = signedSession('u-1', state.sessionId)
    state.authHandler!(event, { ...session, access_token: session.access_token + 'refreshed' })
    expect(state.tableReads.filter(table => table === 'profiles')).toHaveLength(calls)
    release()
    await flush(); await flush()
    expect(store.currentUser()?.email).toBe(OWNER_PRIVATE.email)
  })

  it.each(['same', 'other'])('retires a held disabled-status answer after %s-account replacement', async replacement => {
    const store = await boot()
    state.disabled = true
    let release = () => {}
    state.deferred.is_disabled = () => new Promise<void>(resolve => { release = resolve })
    const old = store.recheckDisabledStatus()
    await flush()
    state.disabled = false
    state.sessionUser = replacement === 'same' ? 'u-1' : 'u-2'
    state.sessionId = '22222222-2222-4222-8222-222222222222'
    state.profileRows = { [state.sessionUser]: { ...OWNER_PRIVATE, id: state.sessionUser } }
    const before = state.rpcCalls.filter(call => call.fn === 'is_disabled').length
    state.authHandler!('SIGNED_IN', signedSession(state.sessionUser, state.sessionId))
    await flush(); await flush()
    expect(store.currentUser()?.id).toBe(state.sessionUser)
    expect(state.rpcCalls.filter(call => call.fn === 'is_disabled').length).toBeGreaterThan(before)
    expect(state.signOuts).toHaveLength(0)
    release()
    expect(await old).toBe(false)
    expect(state.signOuts).toHaveLength(0)
  })

  it('preserves newer equal-valued acceptance when an older write fails', async () => {
    const store = await boot()
    state.holdWrites = true
    const old = store.updateProfile({ homeCity: 'AcceptedCity' })
    const newer = store.updateProfile({ homeCity: 'AcceptedCity' })
    await flush()
    state.writes[1].resolve(true)
    expect(await newer).toEqual({ ok: true })
    state.writes[0].resolve(false)
    expect((await old).ok).toBe(false)
    expect(store.currentUser()?.profile.homeCity).toBe('AcceptedCity')
    await flush()
    expect(store.currentUser()?.profile.homeCity).toBe('AcceptedCity')
  })

  it.each([[0, 1], [1, 0]])('restores the confirmed base when two writes fail in order %j', async (first, second) => {
    const store = await boot()
    state.holdWrites = true
    const writes = [store.updateProfile({ homeCity: 'One' }), store.updateProfile({ homeCity: 'Two' })]
    await flush()
    state.writes[first].resolve(false)
    await writes[first]
    state.writes[second].resolve(false)
    await writes[second]
    expect(store.currentUser()?.profile.homeCity).toBe('Kochi')
  })

  it('keeps a newer edit when canonical reconciliation answers late', async () => {
    const store = await boot()
    state.holdWrites = true
    const first = store.updateProfile({ homeCity: 'Accepted' })
    await flush()
    let release = () => {}
    state.deferred.__holdSelf = () => new Promise<void>(resolve => { release = resolve })
    state.writes[0].resolve(true)
    await first
    await flush()
    const second = store.updateProfile({ homeCity: 'Pending' })
    await flush()
    release()
    await flush()
    expect(store.currentUser()?.profile.homeCity).toBe('Pending')
    state.writes[1].resolve(false)
    await second
    expect(store.currentUser()?.profile.homeCity).toBe('Accepted')
  })

  it('projects resume-time admin loss before private reads finish', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    store.init()
    await flush(); await flush()
    expect(privateIds(store)).toEqual(['u-1', 'u-2'])
    state.sessionAdmin = false
    let release = () => {}
    state.deferred.__holdSelf = () => new Promise<void>(resolve => { release = resolve })
    const pending = store.resumeSync()
    await flush()
    expect(store._isAdminForTest()).toBe(false)
    expect(store.getSnapshot().users.find(user => user.id === 'u-2')?.kind).toBe('public')
    expect(store.getSnapshot().users.find(user => user.id === 'u-2')).not.toHaveProperty('email')
    release()
    await pending
  })

  it.each(['hydrate', 'event'])('does not replace a newer %s with a held canonical reply', async newerRead => {
    const store = await boot()
    state.holdWrites = true
    const edit = store.updateProfile({ homeCity: 'OlderCanonical' })
    await flush()
    let release = () => {}
    state.deferred.__holdSelf = () => new Promise<void>(resolve => { release = resolve })
    state.writes[0].resolve(true)
    await edit
    await flush()
    state.profileRows = { 'u-1': { ...OWNER_PRIVATE, home_city: 'NewerRead' } }
    if (newerRead === 'hydrate') await store.resumeSync()
    else store._applyRealtimeEventForTest('profile_cards', { eventType: 'UPDATE', table: 'profile_cards', schema: 'public', new: OWNER_CARD, old: {} } as never)
    await flush(); await flush()
    expect(store.currentUser()?.profile.homeCity).toBe('NewerRead')
    release()
    await flush(); await flush()
    expect(store.currentUser()?.profile.homeCity).toBe('NewerRead')
  })

  it.each([false, true])('keeps a public event over an older canonical reply when private refresh succeeds=%s', async succeeds => {
    const store = await boot()
    state.holdWrites = true
    const edit = store.updateProfile({ homeCity: 'OlderCanonical' })
    await flush()
    let releaseCanonical = () => {}
    state.deferred.__holdSelf = () => new Promise<void>(resolve => { releaseCanonical = resolve })
    state.writes[0].resolve(true)
    await edit
    await flush()
    let releaseRefresh = () => {}
    state.profileRows = { 'u-1': { ...OWNER_PRIVATE, name: 'NewEventName' } }
    if (!succeeds) state.profileErrors['u-1'] = { message: 'private refresh failed' }
    state.deferred.__holdSelf = () => new Promise<void>(resolve => { releaseRefresh = resolve })
    store._applyRealtimeEventForTest('profile_cards', {
      eventType: 'UPDATE', table: 'profile_cards', schema: 'public',
      new: { ...OWNER_CARD, name: 'NewEventName' }, old: {},
    } as never)
    await flush()
    expect(store.currentUser()?.profile.name).toBe('NewEventName')
    releaseCanonical()
    await flush(); await flush()
    expect(store.currentUser()?.profile.name).toBe('NewEventName')
    releaseRefresh()
    await flush(); await flush()
    expect(store.currentUser()?.profile.name).toBe('NewEventName')
    expect(store.getSnapshot().sliceReads?.['self profile']).toBe(succeeds ? 'ok' : 'failed')
  })

  it('drains an event arriving during the fourth refresh pass', async () => {
    const store = await boot()
    const trigger = () => store._applyRealtimeEventForTest('profile_cards', {
      eventType: 'UPDATE', table: 'profile_cards', schema: 'public', new: OWNER_CARD, old: {},
    } as never)
    let release = () => {}
    const hold = () => { state.deferred.__holdSelf = () => new Promise<void>(resolve => { release = resolve }) }
    hold()
    trigger()
    await flush()
    for (let pass = 1; pass <= 4; pass++) {
      state.profileRows = { 'u-1': { ...OWNER_PRIVATE, home_city: `Version${pass}` } }
      const finish = release
      hold()
      trigger()
      finish()
      await flush(); await flush()
    }
    release()
    await flush(); await flush()
    expect(store.currentUser()?.profile.homeCity).toBe('Version4')
  })
})

describe('a private request is bound to the credentials that asked for it', () => {
  it('the self read pins the captured bearer', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.pinnedHeaders = []
    store.init()
    await flush(); await flush(); await flush()

    const pinned = state.pinnedHeaders.filter(([n]) => n === 'Authorization')
    expect(pinned).toContainEqual(['Authorization', `Bearer ${makeToken('u-1', '11111111-1111-4111-8111-111111111111')}`])
    expect(pinned.every(([, v]) => v === `Bearer ${makeToken('u-1', '11111111-1111-4111-8111-111111111111')}`)).toBe(true)
  })

  it('the admin bulk read pins the captured bearer', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', true)
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    state.allProfileRows = [OWNER_PRIVATE, OTHER_PRIVATE]
    state.pinnedHeaders = []
    store.init()
    await flush(); await flush(); await flush()

    const pinned = state.pinnedHeaders.filter(([n]) => n === 'Authorization')
    expect(pinned).toContainEqual(['Authorization', `Bearer ${makeToken('u-1', '11111111-1111-4111-8111-111111111111')}`])
  })

  it('the header stays bound across a deferred session change', async () => {
    const store = await freshStore()
    signIn(store, 'u-1', false)
    // Hold the self read so the session can change underneath it.
    let release!: () => void
    state.deferred.__holdSelf = () => new Promise<void>(r => { release = r })
    state.pinnedHeaders = []
    store.init()
    await flush()
    // The request was already issued with A's bearer.
    expect(state.pinnedHeaders.filter(([n]) => n === 'Authorization'))
      .toContainEqual(['Authorization', `Bearer ${makeToken('u-1', '11111111-1111-4111-8111-111111111111')}`])

    // B signs in — a different session id for a different account — then A's held
    // read resolves.
    state.sessionUser = 'u-2'
    state.sessionId = '22222222-2222-4222-8222-222222222222'
    state.authHandler!('SIGNED_IN', signedSession('u-2', '22222222-2222-4222-8222-222222222222'))
    release()
    await flush(); await flush(); await flush()

    // A's answer was fenced by its retired ticket, so B's cache holds no A row.
    expect(store.getSnapshot().users.some(u => u.id === 'u-1' && u.kind === 'private')).toBe(false)
    // A's held request was issued with A's bearer and never re-issued with B's:
    // its header was captured before B's session existed. B's own reads are
    // separate requests, which is why they carry B's bearer.
    expect(state.pinnedHeaders[0]?.[1])
      .toBe(`Bearer ${makeToken('u-1', '11111111-1111-4111-8111-111111111111')}`)
    expect(state.pinnedHeaders.filter(([, v]) => v === `Bearer ${makeToken('u-2', '22222222-2222-4222-8222-222222222222')}`).length)
      .toBeGreaterThan(0)
  })
})
