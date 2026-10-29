//
// The database half is proved by the SQL probe; this file proves the CLIENT half
// through the store's real seams: the mappers, the merge rule, the public read
// path, the realtime dispatch and the offline-snapshot scrub. The mock records
// every table read, so a test can assert a public path never touches the private
// table — which is the property the whole change rests on.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { state, toast } = vi.hoisted(() => ({
  state: {
    /** Every `from(...)` read the store tries, so a test can assert a path
     *  never touches the private table. */
    tableReads: [] as string[],
    /** Every RPC the store calls, with its arguments. */
    rpcCalls: [] as { fn: string; args: unknown }[],
    /** What `get_public_profile_cards` answers. */
    cards: [] as unknown[],
    /** What `is_disabled` answers. */
    disabled: false,
    /** Set to make `get_public_profile_cards` answer with an error instead. */
    rpcError: false,
    /** Per-table read outcomes, so one read can fail while another succeeds. */
    tableErrors: {} as Record<string, { message: string } | null>,
    /** Per-id `profiles` read outcomes, so a self read can fail alone. */
    profileErrors: {} as Record<string, { message: string } | null>,
    /** What a `profiles` row read answers, keyed by the `eq('id', …)` value. */
    profileRows: {} as Record<string, unknown>,
    /** Deferred RPC answers, resolved by the test. */
    deferred: {} as Record<string, () => void>,
    /** Every `auth.signOut` call, so a test can assert who was signed out. */
    signOuts: [] as string[],
    /** The user the session answers with, and the epoch `identityEpoch` holds. */
    sessionUser: 'u-1' as 'u-1' | 'u-2',
    /** The session id the resolved session's JWT claims. A real Supabase
     *  session_id is a UUID; a test that replaces the session changes it, which
     *  is what a real re-login does even for the same account id. */
    sessionId: '11111111-1111-4111-8111-111111111111',
  },
  toast: vi.fn(),
}))

/** A synthetic JWT whose payload carries sub and a stable session_id. The
 *  signature is not verified and confers nothing; it exists so the observation
 *  seam can correlate a session the way a real token lets it. */
const makeToken = (sub: string, sessionId: string): string => {
  const payload = Buffer.from(JSON.stringify({ sub, session_id: sessionId })).toString('base64url')
  return 'eyJhbGciOiJIUzI1NiJ9.' + payload + '.sig'
}
vi.mock('../src/components/ui', () => ({ toast }))

vi.mock('../src/lib/supabase', () => {
  const builder = (table: string) => {
    const filters: Array<[string, unknown]> = []
    const b: Record<string, unknown> = {
      select: (column?: string) => { if (column) b.column = column; return b },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return b },
      in: () => b,
      limit: () => b,
      // A single-row read answers the row itself, not the array.
      maybeSingle: () => { b.singleUsed = true; return b },
      single: () => { b.singleUsed = true; return b },
      insert: () => b,
      update: () => b,
      upsert: () => b,
      delete: () => b,
      setHeader: () => b,
      then: (res: (v: { data: unknown; error: unknown }) => unknown) => {
        state.tableReads.push(table)
        const id = filters.find(([k]) => k === 'id')?.[1]
        const failed = state.tableErrors[table] ?? (id !== undefined ? (state.profileErrors[String(id)] ?? null) : null)
        const row = id !== undefined ? (state.profileRows[String(id)] ?? null) : null
        // `maybeSingle`/`single` answer the row; a plain select answers an array.
        const single = b.singleUsed === true
        return Promise.resolve({
          data: failed ? null : (single ? row : (row ? [row] : [])),
          error: failed,
        }).then(res)
      },
    }
    return b
  }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: builder,
      channel: () => { const c: Record<string, unknown> = { on: () => c, subscribe: () => ({}) }; return c },
      removeChannel: () => Promise.resolve(),
      auth: {
        getSession: () => Promise.resolve({
          data: { session: state.sessionUser ? { user: { id: state.sessionUser }, access_token: makeToken(state.sessionUser, state.sessionId) } : null },
        }),
        signOut: () => { state.signOuts.push(String(state.sessionUser)); return Promise.resolve({ error: null }) },
        onAuthStateChange: () => ({ data: { subscription: {} } }),
      },
      rpc: (fn: string, args: unknown) => {
        state.rpcCalls.push({ fn, args })
        const b: Record<string, unknown> = {
          setHeader: () => b,
          then: (res: (v: { data: unknown; error: unknown }) => unknown) => {
            const failed = (state.rpcError && fn === 'get_public_profile_cards')
              || (fn === 'is_disabled' && state.disabled === null)
            const data = failed ? null
              : fn === 'get_public_profile_cards' ? state.cards
                : fn === 'is_disabled' ? state.disabled
                  : null
            const settle = () => Promise.resolve({
              data, error: failed ? { message: 'PGRST202' } : null,
            })
            // A deferred answer parks until the test releases it. The release
            // callback the test holds is the ORIGINAL one; the new one this call
            // installs is for the next deferred request, so the two never clash.
            const parked = new Map(Object.entries(state.deferred)).get(fn)
            if (parked) {
              Reflect.set(state.deferred, fn, () => {})
              return parked().then(settle).then(res)
            }
            return settle().then(res)
          },
        }
        return b
      },
    },
  }
})

const flush = () => new Promise(r => setTimeout(r, 0))

async function freshStore() {
  vi.resetModules()
  return await import('../src/store/store')
}

const OWNER_CARD = { id: 'u-1', name: 'Asha', avatar_url: 'https://cdn/a.png', is_creator: true, creator_bio: 'Kerala', social_links: { youtube: 'https://y/@a', instagram: 'https://i/a' }, creator_available: true }
const OTHER_CARD = { id: 'u-2', name: 'Bilal', avatar_url: null, is_creator: false, creator_bio: null, social_links: null, creator_available: false }

/** A private `public.profiles` row, as the self read (or an admin's bulk read)
 *  returns it. This is the ONLY shape that carries an account field. */
const OWNER_PRIVATE = {
  id: 'u-1', email: 'a@example.invalid', name: 'Asha', avatar_url: 'https://cdn/a.png', home_city: 'Kochi',
  languages: ['en', 'ml'], travel_styles: ['balanced'], is_creator: true, creator_bio: 'Kerala',
  social_links: { youtube: 'https://y/@a', instagram: 'https://i/a' }, is_disabled: false, created_at: 111,
}

beforeEach(() => {
  state.tableReads = []
  state.rpcCalls = []
  state.cards = [OWNER_CARD, OTHER_CARD]
  state.disabled = false
  state.rpcError = false
  state.tableErrors = {}
  state.profileErrors = {}
  state.profileRows = {}
  state.deferred = {}
  state.signOuts = []
  state.sessionUser = 'u-1'
  toast.mockClear()
})

describe('the mappers', () => {
  it('the public mapper produces exactly the reviewed shape and no account field', async () => {
    const { rowToPublicUser } = await freshStore()
    const user = rowToPublicUser(OWNER_CARD)
    expect(user).toEqual({
      id: 'u-1', kind: 'public',
      profile: { name: 'Asha', avatarUrl: 'https://cdn/a.png', isCreator: true, creatorBio: 'Kerala', socialLinks: { youtube: 'https://y/@a', instagram: 'https://i/a' }, creatorAvailable: true },
    })
    // The old rowToUser manufactured these five from a whole private row. They are
    // absent here because the card it is handed does not have them.
    expect(user).not.toHaveProperty('email')
    expect(user).not.toHaveProperty('createdAt')
    expect(user.profile).not.toHaveProperty('homeCity')
    expect(user.profile).not.toHaveProperty('languages')
    expect(user.profile).not.toHaveProperty('travelStyles')
    expect(user.profile).not.toHaveProperty('isDisabled')
  })

  it('the private mapper is the only one that touches an account field', async () => {
    const { rowToPrivateUser } = await freshStore()
    const user = rowToPrivateUser(OWNER_PRIVATE)
    expect(user.kind).toBe('private')
    expect(user.email).toBe('a@example.invalid')
    expect(user.createdAt).toBe(111)
    expect(user.profile.homeCity).toBe('Kochi')
    expect(user.profile.languages).toEqual(['en', 'ml'])
    expect(user.profile.travelStyles).toEqual(['balanced'])
    expect(user.profile.isDisabled).toBe(false)
    // A disabled account's own row maps to an unavailable creator, which is what
    // the public surfaces filter on.
    const disabled = rowToPrivateUser({ ...OWNER_PRIVATE, is_disabled: true })
    expect(disabled.profile.creatorAvailable).toBe(false)
  })
})

describe('the merge rule', () => {
  it('a public read never erases a private entry, and a private read replaces one', async () => {
    const { mergeUsers, rowToPublicUser, rowToPrivateUser } = await freshStore()
    const pub = rowToPublicUser(OWNER_CARD)
    const priv = rowToPrivateUser(OWNER_PRIVATE)

    // The dangerous direction: a public refresh arriving over a private row.
    const afterPublic = mergeUsers([priv], [pub])
    expect(afterPublic).toHaveLength(1)
    expect(afterPublic[0].kind).toBe('private')

    // The necessary direction: a self-read replacing a stale public card.
    const afterPrivate = mergeUsers([pub], [priv])
    expect(afterPrivate[0].kind).toBe('private')
    expect(afterPrivate[0]).toHaveProperty('email', 'a@example.invalid')

    // Distinct ids coexist.
    expect(mergeUsers([pub], [rowToPublicUser(OTHER_CARD)]).map(u => u.id).sort()).toEqual(['u-1', 'u-2'])

    // The natural hydrate shape carries an id TWICE: the public catalogue holds a
    // card for the signed-in user, and the self read adds their private row beside
    // it. The merge must resolve that to the private row, or `currentUser()` finds
    // a name where an account should be.
    const natural = mergeUsers([pub, rowToPublicUser(OTHER_CARD)], [priv])
    expect(natural).toHaveLength(2)
    expect(natural.find(u => u.id === 'u-1')?.kind).toBe('private')
    expect(natural.find(u => u.id === 'u-2')?.kind).toBe('public')
  })

  it('a public rename lands on a privately cached identity without erasing its email', async () => {
    const { mergeUsers, rowToPublicUser, rowToPrivateUser } = await freshStore()
    const priv = rowToPrivateUser(OWNER_PRIVATE)
    const merged = mergeUsers([priv], [rowToPublicUser({ ...OWNER_CARD, name: 'Renamed' })])[0]

    expect(merged.kind).toBe('private')
    expect(merged.email).toBe('a@example.invalid')  // the private field survives
    expect(merged.profile.name).toBe('Renamed')     // and the public one lands
  })

  it('a remote disablement reaches a privately cached identity', async () => {
    const { mergeUsers, rowToPublicUser, rowToPrivateUser } = await freshStore()
    const merged = mergeUsers([rowToPrivateUser(OWNER_PRIVATE)], [rowToPublicUser({ ...OWNER_CARD, creator_available: false })])[0]
    expect(merged.profile.creatorAvailable).toBe(false)
  })

  it('a remote avatar change reaches a privately cached identity', async () => {
    const { mergeUsers, rowToPublicUser, rowToPrivateUser } = await freshStore()
    const merged = mergeUsers([rowToPrivateUser(OWNER_PRIVATE)], [rowToPublicUser({ ...OWNER_CARD, avatar_url: 'https://cdn/new.png' })])[0]
    expect(merged.profile.avatarUrl).toBe('https://cdn/new.png')
    expect(merged.email).toBe('a@example.invalid')
  })

  it('an admin-held private row keeps its own private fields and takes public updates', async () => {
    const { mergeUsers, rowToPublicUser, rowToPrivateUser } = await freshStore()
    // An admin hydrates private rows for OTHER accounts, so the same rule must hold
    // for a row the signed-in user does not own.
    const other = rowToPrivateUser({
      ...OWNER_PRIVATE, id: 'u-9', email: 'other@example.invalid',
      home_city: 'PRIVATE-CITY', languages: ['hi'], travel_styles: ['fast'], is_disabled: false, created_at: 9,
    })
    const merged = mergeUsers([other], [rowToPublicUser({ ...OTHER_CARD, id: 'u-9', name: 'Bilal Ahmed' })])[0]
    expect(merged.kind).toBe('private')
    expect(merged.profile.name).toBe('Bilal Ahmed')
    expect(merged.profile.homeCity).toBe('PRIVATE-CITY')
    expect(merged.email).toBe('other@example.invalid')
  })
})

describe('the public read path', () => {
  it('a public refresh reads the RPC and never the private table', async () => {
    const store = await freshStore()
    await store.rereadPublicSlices()
    await flush(); await flush()

    expect(state.rpcCalls.some(c => c.fn === 'get_public_profile_cards')).toBe(true)
    expect(state.tableReads).not.toContain('profiles')
    const users = store.getSnapshot().users
    expect(users).toHaveLength(2)
    expect(users.every(u => u.kind === 'public')).toBe(true)
  })

  it('a public refresh does not erase the signed-in user’s private row', async () => {
    const store = await freshStore()
    const { rowToPublicUser, rowToPrivateUser } = store
    // Seed the cache the way a hydrate does: public cards plus the private self row.
    store.getSnapshot().sessionUserId = 'u-1'
    store._installUsersForTest([rowToPrivateUser(OWNER_PRIVATE), ...state.cards.map(rowToPublicUser)])
    await store.rereadPublicSlices()
    await flush(); await flush()

    // The catalogue is refreshed — u-1's card is superseded by the private row for
    // that id, and u-2 stays a public card — so two entries, one of each kind.
    const users = store.getSnapshot().users
    expect(users).toHaveLength(2)
    expect(users.filter(u => u.kind === 'public').map(u => u.id)).toEqual(['u-2'])
    // …and the private row is still there.
    const me = store.currentUser()
    expect(me?.kind).toBe('private')
    expect(me?.email).toBe('a@example.invalid')
    expect(state.tableReads).not.toContain('profiles')
  })

  it('a failed public read reports failed and does not wipe the rows', async () => {
    const store = await freshStore()
    await store.rereadPublicSlices()
    await flush(); await flush()
    const loaded = store.getSnapshot().users

    // The RPC answers an error (a missing function, say). The slice must report
    // failed, and the rows must survive — "still broken" and "now empty as well"
    // are different states, and only one of them is a regression.
    state.rpcError = true
    await store.rereadPublicSlices()
    await flush(); await flush()

    expect(store.getSnapshot().sliceReads.profiles).toBe('failed')
    expect(store.getSnapshot().users).toHaveLength(loaded.length)
  })
})

describe('the realtime dispatch', () => {
  it('a profile_cards event lands through the public mapper and keeps a private entry', async () => {
    const store = await freshStore()
    const { rowToPublicUser, rowToPrivateUser, _applyRealtimeEventForTest } = store
    store.getSnapshot().sessionUserId = 'u-1'
    store._installUsersForTest([rowToPrivateUser(OWNER_PRIVATE), rowToPublicUser(OTHER_CARD)])

    _applyRealtimeEventForTest('profile_cards', {
      eventType: 'UPDATE', schema: 'public', table: 'profile_cards',
      commit_timestamp: new Date().toISOString(),
      old: { id: 'u-2' },
      new: { id: 'u-2', name: 'Bilal Ahmed', avatar_url: null, is_creator: false, creator_bio: null, social_links: null, creator_available: true },
    } as never)

    const other = store.getSnapshot().users.find(u => u.id === 'u-2')
    expect(other?.kind).toBe('public')
    expect(other?.profile.name).toBe('Bilal Ahmed')
    // The signed-in user's own private row survives the public event stream.
    expect(store.currentUser()?.kind).toBe('private')
    expect(store.currentUser()?.email).toBe('a@example.invalid')
  })

  it('a remote rename of the SIGNED-IN user reaches the screen and keeps the account', async () => {
    const store = await freshStore()
    const { rowToPrivateUser, _applyRealtimeEventForTest } = store
    store.getSnapshot().sessionUserId = 'u-1'
    store._installUsersForTest([rowToPrivateUser(OWNER_PRIVATE)])

    _applyRealtimeEventForTest('profile_cards', {
      eventType: 'UPDATE', schema: 'public', table: 'profile_cards',
      commit_timestamp: new Date().toISOString(),
      old: { id: 'u-1' },
      new: { id: 'u-1', name: 'Asha Nair', avatar_url: 'https://cdn/new.png', is_creator: true, creator_bio: 'Kerala', social_links: { instagram: 'https://i/a' }, creator_available: true },
    } as never)

    const me = store.currentUser()
    expect(me?.kind).toBe('private')
    expect(me?.email).toBe('a@example.invalid')      // the account survives
    expect(me?.profile.name).toBe('Asha Nair')       // and the rename lands
    expect(me?.profile.avatarUrl).toBe('https://cdn/new.png')
  })

  it('a remote disablement of the SIGNED-IN user reaches the screen', async () => {
    const store = await freshStore()
    const { rowToPrivateUser, _applyRealtimeEventForTest } = store
    store.getSnapshot().sessionUserId = 'u-1'
    store._installUsersForTest([rowToPrivateUser(OWNER_PRIVATE)])

    _applyRealtimeEventForTest('profile_cards', {
      eventType: 'UPDATE', schema: 'public', table: 'profile_cards',
      commit_timestamp: new Date().toISOString(),
      old: { id: 'u-1' },
      new: { id: 'u-1', name: 'Asha', avatar_url: null, is_creator: true, creator_bio: null, social_links: null, creator_available: false },
    } as never)

    expect(store.currentUser()?.profile.creatorAvailable).toBe(false)
    expect(store.currentUser()?.email).toBe('a@example.invalid')
  })
})

describe('the offline snapshot', () => {
  it('an old snapshot carrying private rows is scrubbed on the way in', async () => {
    const { sanitizeSnapshotUsers, publicOnlyUsers, rowToPrivateUser } = await freshStore()
    const scrubbed = sanitizeSnapshotUsers([
      // A whole private row, as every snapshot written before #800 held it.
      { id: 'u-1', email: 'a@example.invalid', createdAt: 111, profile: { name: 'Asha', homeCity: 'Kochi', languages: ['en'], travelStyles: ['balanced'], isCreator: true, isDisabled: false } },
      // A current public card passes through.
      { id: 'u-2', kind: 'public', profile: { name: 'Bilal', isCreator: false, creatorAvailable: true } },
      // Junk is dropped rather than coerced.
      null, 'nope', { id: 'u-3' }, { id: 'u-4', profile: 7 },
    ])
    expect(scrubbed.map(u => u.id)).toEqual(['u-1', 'u-2'])
    for (const u of scrubbed) {
      expect(u.kind).toBe('public')
      expect(u).not.toHaveProperty('email')
      expect(u).not.toHaveProperty('createdAt')
      expect(u.profile).not.toHaveProperty('homeCity')
      expect(u.profile).not.toHaveProperty('languages')
      expect(u.profile).not.toHaveProperty('travelStyles')
      expect(u.profile).not.toHaveProperty('isDisabled')
    }
    // The write side projects every identity, dropping only the private data.
    const mixed = [rowToPrivateUser(OWNER_PRIVATE), { id: 'u-2', kind: 'public', profile: { name: 'Bilal', isCreator: false, creatorAvailable: true } }]
    const written = publicOnlyUsers(mixed as never)
    expect(written.map(u => u.id)).toEqual(['u-1', 'u-2'])
    expect(JSON.stringify(written).includes('a@example.invalid')).toBe(false)
    expect(JSON.stringify(written).includes('Kochi')).toBe(false)
  })

  it('the write side projects a private identity instead of deleting it', async () => {
    const { publicOnlyUsers, rowToPrivateUser } = await freshStore()
    const users = publicOnlyUsers([rowToPrivateUser(OWNER_PRIVATE)])

    expect(users).toHaveLength(1)
    expect(users[0].id).toBe('u-1')
    expect(users[0].kind).toBe('public')
    expect(users[0].profile.name).toBe('Asha')
    expect(users[0].profile.isCreator).toBe(true)
    // And nothing private came with it.
    expect(users[0]).not.toHaveProperty('email')
    expect(users[0]).not.toHaveProperty('createdAt')
    expect(users[0].profile).not.toHaveProperty('homeCity')
    expect(users[0].profile).not.toHaveProperty('languages')
    expect(users[0].profile).not.toHaveProperty('travelStyles')
    expect(users[0].profile).not.toHaveProperty('isDisabled')
  })

  it('a legacy disabled snapshot cannot restore creator availability', async () => {
    const { sanitizeSnapshotUsers, rowToPrivateUser } = await freshStore()
    const priv = rowToPrivateUser(OWNER_PRIVATE)
    // An old snapshot: the administrative flag is present and the derived signal
    // is absent. A read of the absent signal as `!== false` used to restore a
    // disabled creator as publicly available.
    const users = sanitizeSnapshotUsers([{ ...priv, profile: { ...priv.profile, isDisabled: true, creatorAvailable: undefined } }])
    expect(users[0].profile.creatorAvailable).toBe(false)
    expect(users[0].profile).not.toHaveProperty('isDisabled')
  })

  it('a legacy snapshot social-links object is rebuilt from the reviewed keys', async () => {
    const { sanitizeSnapshotUsers, rowToPrivateUser, reviewedSocialLinks } = await freshStore()
    const priv = rowToPrivateUser(OWNER_PRIVATE)
    const canary = { instagram: 'https://instagram.com/synthetic', email: 'PRIVATE-NESTED-CANARY' }
    const users = sanitizeSnapshotUsers([{ ...priv, profile: { ...priv.profile, socialLinks: canary } }])
    expect(JSON.stringify(users).includes('PRIVATE-NESTED-CANARY')).toBe(false)
    expect(users[0].profile.socialLinks).toEqual({ instagram: 'https://instagram.com/synthetic' })
    // The same rebuild runs on any untrusted value, including non-objects.
    expect(reviewedSocialLinks(null)).toBeUndefined()
    expect(reviewedSocialLinks('nope')).toBeUndefined()
    expect(reviewedSocialLinks({ youtube: '  ', instagram: 7 })).toBeUndefined()
    expect(reviewedSocialLinks({ youtube: 'https://y/@a', other: 'x' })).toEqual({ youtube: 'https://y/@a' })
  })

  it('a future public snapshot strips unreviewed nested keys from a private row', async () => {
    // R5's second half. The legacy sanitiser was repaired, but `publicOnlyUsers`
    // still copied `u.profile.socialLinks` directly — and an authorized private
    // row may hold arbitrary nested keys, so the canary survived into the future
    // snapshot. This is the write side of the same boundary.
    const { publicOnlyUsers, rowToPrivateUser } = await freshStore()
    const hostile = rowToPrivateUser({
      ...OWNER_PRIVATE,
      social_links: { youtube: 'https://y/@a', instagram: 'https://i/a', email: 'PRIVATE-FUTURE-CANARY' },
    })

    const written = publicOnlyUsers([hostile])
    expect(JSON.stringify(written).includes('PRIVATE-FUTURE-CANARY')).toBe(false)
    expect(written[0].profile.socialLinks).toEqual({ youtube: 'https://y/@a', instagram: 'https://i/a' })
  })

  it('an admin-held private catalogue still serialises as public identities', async () => {
    // An admin hydrate replaces the whole catalogue with private rows. The save
    // path must still write identities — the R6 defect — and must strip the
    // nested keys those rows may carry.
    const { publicOnlyUsers, rowToPrivateUser } = await freshStore()
    const adminCache = [
      rowToPrivateUser({ ...OWNER_PRIVATE, social_links: { youtube: 'https://y/@a', email: 'PRIVATE-FUTURE-CANARY' } }),
      rowToPrivateUser({ ...OWNER_PRIVATE, id: 'u-2', email: 'b@example.invalid', name: 'Bilal', is_creator: false }),
    ]

    const written = publicOnlyUsers(adminCache)
    expect(written.map(u => u.id)).toEqual(['u-1', 'u-2'])
    expect(JSON.stringify(written).includes('PRIVATE-FUTURE-CANARY')).toBe(false)
    expect(JSON.stringify(written).includes('example.invalid')).toBe(false)
    // Every entry is a public card with its display fields intact.
    expect(written.every(u => u.kind === 'public' && typeof u.profile.name === 'string')).toBe(true)
  })

  it('an offline boot restores the public directory and then the signed-in private row', async () => {
    // The lifecycle, not just the mapper: a cold boot reads the snapshot, and the
    // hydrate that follows must put the private row back without the public read
    // erasing it.
    const store = await freshStore()
    const { rowToPrivateUser, rowToPublicUser, sanitizeSnapshotUsers, mergeUsers } = store
    const legacy = sanitizeSnapshotUsers([{
      id: 'u-1', email: 'a@example.invalid', createdAt: 1,
      profile: { name: 'Asha', isCreator: true, isDisabled: false, homeCity: 'Kochi', languages: ['en'], travelStyles: ['balanced'], socialLinks: { instagram: 'https://i/a', email: 'CANARY' } },
    }])
    store._installUsersForTest(legacy)
    expect(store.getSnapshot().users).toHaveLength(1)
    expect(JSON.stringify(store.getSnapshot().users).includes('CANARY')).toBe(false)

    // The hydrate's public read then lands, and the self row on top of it.
    store.getSnapshot().sessionUserId = 'u-1'
    store._installUsersForTest(mergeUsers(legacy, [rowToPrivateUser(OWNER_PRIVATE)]))
    const me = store.currentUser()
    expect(me?.kind).toBe('private')
    expect(me?.email).toBe('a@example.invalid')
    expect(me?.profile.homeCity).toBe('Kochi')
    // The private row's own social links, which the snapshot's rebuilt allowlist
    // already narrowed to the reviewed keys.
    expect(me?.profile.socialLinks).toEqual({ youtube: 'https://y/@a', instagram: 'https://i/a' })
  })
})

describe('the disabled-account check', () => {
  it('a missing private row is not read as an enabled account', async () => {
    const store = await freshStore()
    store.init()
    await flush(); await flush()
    // A disabled account cannot read its own row, so there is no private entry.
    store.getSnapshot().sessionUserId = 'u-1'
    store._installUsersForTest([])
    expect(store.currentUser()).toBeNull()

    // The server helper answers for the caller, so the friendly message still fires.
    state.disabled = true
    expect(await store.enforceDisabledCheck()).toBe(true)
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('disabled'), 'err')
    expect(state.rpcCalls.some(c => c.fn === 'is_disabled')).toBe(true)
  })

  it('an enabled account with a private row is not signed out', async () => {
    const store = await freshStore()
    const { rowToPrivateUser } = store
    store.getSnapshot().sessionUserId = 'u-1'
    store._installUsersForTest([rowToPrivateUser(OWNER_PRIVATE)])

    expect(await store.enforceDisabledCheck()).toBe(false)
    expect(state.rpcCalls.some(c => c.fn === 'is_disabled')).toBe(false)
  })
})

describe('the delayed disabled-account check', () => {
  it('an answer that arrives after an account switch signs nobody out', async () => {
    // The browser reproduction: account A has no private row, its `is_disabled`
    // call is held, account B becomes current, then A's `true` answer lands.
    const store = await freshStore()
    store.init()
    await flush(); await flush()
    state.rpcCalls = []
    state.sessionUser = 'u-1'
    state.profileRows = {}
    state.disabled = true
    let parkedResolve = () => {}
    state.deferred.is_disabled = new Promise<void>(r => { parkedResolve = r })

    store.getSnapshot().sessionUserId = 'u-1'
    const pending = store.enforceDisabledCheck()
    await flush()
    expect(state.rpcCalls.some(c => c.fn === 'is_disabled')).toBe(true)
    expect(state.signOuts).toHaveLength(0)

    // Account B becomes current while A's answer is still in flight.
    state.sessionUser = 'u-2'
    store.getSnapshot().sessionUserId = 'u-2'
    parkedResolve()
    expect(await pending).toBe(false)

    // Nobody was signed out, and the new account was told nothing.
    expect(state.signOuts).toHaveLength(0)
    expect(store.getSnapshot().sessionUserId).toBe('u-2')
  })

  it('a stable disabled account is still signed out with the message', async () => {
    const store = await freshStore()
    store.init()
    await flush(); await flush()
    state.sessionUser = 'u-1'
    state.profileRows = {}
    state.disabled = true

    store.getSnapshot().sessionUserId = 'u-1'
    expect(await store.enforceDisabledCheck()).toBe(true)
    expect(state.signOuts).toEqual(['u-1'])
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('disabled'), 'err')
  })

  it('a stable enabled account is not signed out', async () => {
    const store = await freshStore()
    state.sessionUser = 'u-1'
    state.profileRows = {}
    state.disabled = false

    store.getSnapshot().sessionUserId = 'u-1'
    expect(await store.enforceDisabledCheck()).toBe(false)
    expect(state.signOuts).toHaveLength(0)
  })

  it('a failed check stays silent and does not sign anybody out', async () => {
    const store = await freshStore()
    state.sessionUser = 'u-1'
    state.profileRows = {}
    state.disabled = null // the RPC answers an error

    store.getSnapshot().sessionUserId = 'u-1'
    expect(await store.enforceDisabledCheck()).toBe(false)
    expect(state.signOuts).toHaveLength(0)
  })
})

describe('the public retry reports each slice from its own response', () => {
  it('a fully successful retry clears both failure verdicts', async () => {
    const store = await freshStore()
    await store.rereadPublicSlices()
    await flush(); await flush()

    const { sliceReads } = store.getSnapshot()
    expect(sliceReads.profiles).not.toBe('failed')
    expect(sliceReads['suggested itineraries']).not.toBe('failed')
  })

  it('a profiles-only failure leaves publications ready', async () => {
    const store = await freshStore()
    state.rpcError = true
    await store.rereadPublicSlices()
    await flush(); await flush()

    const { sliceReads } = store.getSnapshot()
    expect(sliceReads.profiles).toBe('failed')
    expect(sliceReads['suggested itineraries']).not.toBe('failed')
  })

  it('a publications-only failure leaves profiles ready', async () => {
    const store = await freshStore()
    state.tableErrors = { published_itineraries: { message: 'denied' } }
    await store.rereadPublicSlices()
    await flush(); await flush()

    const { sliceReads } = store.getSnapshot()
    expect(sliceReads['suggested itineraries']).toBe('failed')
    expect(sliceReads.profiles).not.toBe('failed')
  })

  it('a failure followed by success recovers both verdicts', async () => {
    const store = await freshStore()
    state.tableErrors = { published_itineraries: { message: 'denied' } }
    await store.rereadPublicSlices()
    await flush(); await flush()
    expect(store.getSnapshot().sliceReads['suggested itineraries']).toBe('failed')

    state.tableErrors = {}
    await store.rereadPublicSlices()
    await flush(); await flush()
    expect(store.getSnapshot().sliceReads['suggested itineraries']).not.toBe('failed')
    expect(store.getSnapshot().sliceReads.profiles).not.toBe('failed')
  })
})

describe('the private read has its own verdict and retry', () => {
  // `resumeSync` is the real authorised re-hydration path (app-resume and the
  // reconnect retry), so these tests drive it rather than a private helper.
  async function signedIn(userId: 'u-1' | 'u-2') {
    const store = await freshStore()
    state.sessionUser = userId
    store.getSnapshot().sessionUserId = userId
    return store
  }

  it('a failed self read does not let the public read certify the account ready', async () => {
    const store = await signedIn('u-1')
    state.profileRows = {}
    // Only the self read fails: the public RPC still succeeds, which is exactly
    // the case where a public verdict must not be read as an account verdict.
    state.profileErrors = { 'u-1': { message: 'network down' } }
    state.cards = [OWNER_CARD, OTHER_CARD]

    await store.resumeSync()
    await flush(); await flush(); await flush()

    const { sliceReads, users } = store.getSnapshot()
    expect(sliceReads.profiles).not.toBe('failed')
    expect(sliceReads['self profile']).toBe('failed')
    // The account was not silently downgraded to a public card, and the public
    // catalogue was not wiped by the private read's failure.
    expect(store.currentUser()).toBeNull()
    expect(users.every(u => u.kind === 'public')).toBe(true)
    expect(users).not.toContainEqual(expect.objectContaining({ kind: 'private' }))
  })

  it('a successful self read installs the private row', async () => {
    const store = await signedIn('u-1')
    state.profileRows = { 'u-1': OWNER_PRIVATE }

    await store.resumeSync()
    await flush(); await flush(); await flush()

    expect(store.getSnapshot().sliceReads['self profile']).not.toBe('failed')
    expect(store.currentUser()?.email).toBe('a@example.invalid')
  })

  it('a genuine absent row is a distinct outcome from a failure', async () => {
    const store = await signedIn('u-1')
    state.profileRows = {} // legitimately absent, no error

    await store.resumeSync()
    await flush(); await flush(); await flush()

    expect(store.getSnapshot().sliceReads['self profile']).not.toBe('failed')
    expect(store.currentUser()).toBeNull()
  })

  it('a retry after a failed self read actually rereads it', async () => {
    const store = await signedIn('u-1')
    state.profileRows = {}
    state.tableErrors = { profiles: { message: 'network down' } }

    await store.resumeSync()
    await flush(); await flush(); await flush()
    expect(store.getSnapshot().sliceReads['self profile']).toBe('failed')

    // The read is fixed and the same authorised path runs again.
    state.tableErrors = {}
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    await store.resumeSync()
    await flush(); await flush(); await flush()

    expect(store.getSnapshot().sliceReads['self profile']).not.toBe('failed')
    expect(store.currentUser()?.email).toBe('a@example.invalid')
  })

  it('a private read failure does not install another account\'s row', async () => {
    const store = await signedIn('u-1')
    state.profileRows = { 'u-1': OWNER_PRIVATE }
    await store.resumeSync()
    await flush(); await flush(); await flush()
    expect(store.currentUser()?.email).toBe('a@example.invalid')

    // Account B signs in: the identity generation moves (as a real auth event
    // does) and the cache now belongs to B. B's own hydrate runs through the
    // reconnect path; its private read fails, so A's row must not be left
    // installed under B's session.
    store._bumpIdentityEpochForTest()
    state.sessionUser = 'u-2'
    store.getSnapshot().sessionUserId = 'u-2'
    state.profileRows = {}
    state.profileErrors = { 'u-2': { message: 'network down' } }
    await store.resumeSync()
    await flush(); await flush(); await flush()

    expect(store.currentUser()).toBeNull()
    // No account's private row survives under the new session.
    expect(store.getSnapshot().users.every(u => u.kind === 'public')).toBe(true)
    expect(store.getSnapshot().users.every(u => u.email === undefined)).toBe(true)
  })
})
