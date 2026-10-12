// ============ #704 — a failed publications read is never an empty list ============
//
// Two surfaces read the published list to say what a creator has. One is the
// creator hub's list and figures. The other is the Share tab's publish status.
// A failed read used to leave that list empty. Both surfaces then printed the
// answer for an empty account. The hub showed "Nothing published yet" and zero
// figures. The Share tab showed a Publish button. That button could write a
// second publication for a trip that already had one.
//
// This file pins four things:
//   - the store keeps the rows it loaded when a refresh fails;
//   - a failed read with no rows is `failed`, never `empty`;
//   - each surface checks that verdict before it prints an empty answer;
//   - the Share tab mounts its publish form only after a read that succeeded.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { rowsView, sliceState } from '../src/lib/readState'
import { publishFormKey } from '../src/lib/publishFormKey'

// Source scans read LF text. They ignore comments, so prose cannot pass a check.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const codeOf = (source: string) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

const { state } = vi.hoisted(() => ({
  state: {
    tables: {} as Record<string, unknown[]>,
    errors: {} as Record<string, unknown>,
    sessionUser: null as string | null,
    resolveSession: null as (() => void) | null,
  },
}))

vi.mock('../src/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const builder: Record<string, unknown> = {}
    const self = () => builder
    for (const method of ['select', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'single', 'update', 'insert', 'upsert', 'delete']) {
      builder[method] = self
    }
    builder.then = (res: (v: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve(state.errors[table]
        ? { data: null, error: state.errors[table] }
        : { data: state.tables[table] ?? [], error: null }).then(res)
    return builder
  }
  const chain: Record<string, unknown> = { on: () => chain, subscribe: () => ({}) }
  return {
    isSupabaseConfigured: true,
    supabase: {
      from: (t: string) => makeBuilder(t),
      rpc: () => Promise.resolve({ data: [], error: null }),
      channel: () => chain,
      removeChannel: () => Promise.resolve(),
      auth: {
        getSession: () => new Promise(resolve => {
          state.resolveSession = () =>
            resolve({ data: { session: state.sessionUser ? { user: { id: state.sessionUser } } : null } })
        }),
        onAuthStateChange: () => ({ data: { subscription: {} } }),
        signOut: () => Promise.resolve({ error: null }),
      },
    },
  }
})

function profileRow(id: string) {
  return { id, email: `${id}@example.com`, name: id, created_at: 1 }
}

function memberRow(tripId: string, userId: string, role: string) {
  return { trip_id: tripId, user_id: userId, role, joined_at: 1 }
}

function tripRow(id: string) {
  return {
    id, owner_id: 'u-owner', name: `Trip ${id}`, start_location: 'Kochi',
    start_location_coords: null, destinations: ['Kochi'], destination_coords: null,
    start_date: '2026-10-01', end_date: '2026-10-03', travellers: 2, transport_mode: 'car',
    budget_per_person_inr: 5000, travel_style: 'balanced', fixed_commitments: [],
    days: [], expenses: [], cover_emoji: '🧭', visibility: 'private',
    created_at: 1, updated_at: 1,
  }
}

function pubRow(id: string, tripId: string) {
  return {
    id, trip_id: tripId, creator_id: 'u-owner', title: `Plan ${id}`, tagline: 'A route',
    cover_image_url: 'https://images.example.test/k.jpg', route_summary: ['Kochi', 'Munnar'],
    duration_days: 3, estimated_budget_per_person_inr: 5000, travel_style: 'balanced',
    best_season: null, travel_tips: [], warnings_and_assumptions: [], free_day_indexes: [0],
    premium_price_inr: 199, subscriber_cta: 'Full checklist', published_at: 1,
    refreshed_at: 1, unpublished_at: null, views: 0, copies: 0,
  }
}

/** Let the store's fire-and-forget async work drain. */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

async function freshStore() {
  vi.resetModules()
  return await import('../src/store/store')
}

/** A signed-in owner with one trip. The trip stops the hydrate from seeding demo rows. */
function signedIn(published: unknown[]) {
  state.sessionUser = 'u-owner'
  state.tables = {
    profiles: [profileRow('u-owner')],
    published_itineraries: published,
    trip_members: [memberRow('tripA', 'u-owner', 'owner')],
    trips: [tripRow('tripA')],
  }
}

async function signIn(store: Awaited<ReturnType<typeof freshStore>>) {
  store.init()
  state.resolveSession!()
  await flush()
  await flush()
}

/** Run one refresh of the signed-in account, as app resume does. */
async function refresh(store: Awaited<ReturnType<typeof freshStore>>) {
  const pending = store.resumeSync()
  state.resolveSession!()
  await pending
  await flush()
}

beforeEach(() => {
  state.tables = {}
  state.errors = {}
  state.sessionUser = null
  state.resolveSession = null
})

// ================= the store keeps what loaded =================

describe('#704 — the store keeps what loaded when a refresh fails', () => {
  it('a failed refresh keeps the publications already loaded, and the verdict still says failed', async () => {
    const store = await freshStore()
    signedIn([pubRow('pub-1', 'tripA')])
    await signIn(store)
    expect(store.getSnapshot().published.map(p => p.id)).toEqual(['pub-1'])

    state.errors = { published_itineraries: { message: 'dropped connection' } }
    await refresh(store)

    const snap = store.getSnapshot()
    expect(snap.published.map(p => p.id)).toEqual(['pub-1'])
    const verdict = sliceState(snap.sliceReads, 'suggested itineraries')
    expect(verdict).toBe('failed')
    expect(rowsView(verdict, snap.published.length)).toBe('kept')
  })

  it('a later read that succeeds replaces the kept rows', async () => {
    const store = await freshStore()
    signedIn([pubRow('pub-1', 'tripA')])
    await signIn(store)

    state.errors = { published_itineraries: { message: 'dropped connection' } }
    await refresh(store)

    state.errors = {}
    state.tables.published_itineraries = [pubRow('pub-2', 'tripA')]
    await refresh(store)

    const snap = store.getSnapshot()
    expect(snap.published.map(p => p.id)).toEqual(['pub-2'])
    expect(sliceState(snap.sliceReads, 'suggested itineraries')).toBe('ready')
  })

  it('a read that fails before anything loaded is failed, not empty', async () => {
    const store = await freshStore()
    signedIn([])
    state.errors = { published_itineraries: { message: 'dropped connection' } }
    await signIn(store)

    const snap = store.getSnapshot()
    expect(snap.published).toEqual([])
    const verdict = sliceState(snap.sliceReads, 'suggested itineraries')
    expect(verdict).toBe('failed')
    expect(rowsView(verdict, snap.published.length)).toBe('failed')
  })

  it('a read that succeeds with no publications is empty', async () => {
    const store = await freshStore()
    signedIn([])
    await signIn(store)

    const snap = store.getSnapshot()
    const verdict = sliceState(snap.sliceReads, 'suggested itineraries')
    expect(verdict).toBe('ready')
    expect(rowsView(verdict, snap.published.length)).toBe('empty')
  })
})

// ================= the view rule =================

describe('#704 — only a read that succeeded may say "empty"', () => {
  it('a failed read with no rows is failed, not empty', () => {
    expect(rowsView('failed', 0)).toBe('failed')
  })

  it('a pending read with no rows is reading, not empty', () => {
    expect(rowsView('reading', 0)).toBe('reading')
  })

  it('only a read that succeeded with no rows is empty', () => {
    expect(rowsView('ready', 0)).toBe('empty')
  })

  it('a failed read keeps the rows it loaded', () => {
    expect(rowsView('failed', 2)).toBe('kept')
  })

  it('a pending or successful read shows its rows as they are', () => {
    expect(rowsView('reading', 2)).toBe('rows')
    expect(rowsView('ready', 2)).toBe('rows')
  })

  it('a slice nobody reported is reading, so it is never empty', () => {
    expect(rowsView(sliceState(undefined, 'suggested itineraries'), 0)).toBe('reading')
  })
})

// ================= the creator hub =================

describe('#704 — the creator hub checks the list before it prints an empty answer', () => {
  const hub = codeOf(read('../src/pages/CreatorHubPage.tsx'))

  it('reads the publication slice through the shared rule', () => {
    expect(hub).toMatch(/sliceState\(db\.sliceReads, 'suggested itineraries'\)/)
    expect(hub).toMatch(/rowsView\(publishedRead, myPubs\.length\)/)
  })

  it('the loading and failed branches come before "Nothing published yet"', () => {
    const gate = hub.indexOf("publishedView === 'reading' || publishedView === 'failed'")
    const empty = hub.indexOf('Nothing published yet')
    expect(gate).toBeGreaterThan(-1)
    expect(empty).toBeGreaterThan(gate)
  })

  it('the failed sentence and the empty sentence are different', () => {
    expect(hub).toContain("Couldn't load your publications.")
    expect(hub).toContain('Nothing published yet')
  })

  it('the four tiles show "Not read", not a zero, until the list reads', () => {
    expect(hub.match(/unknownPubs \? <UnreadFigure view=\{publishedView\} \/> : /g)?.length ?? 0).toBe(4)
    expect(hub).toMatch(/pubsUnknown \? <UnreadFigure view=\{publishedView\} \/> : /)
  })

  it('the ledger and the projection do not say "nothing priced" over an unread list', () => {
    expect(hub).toMatch(/nothingPriced && !pubsUnknown \? 'Nothing priced yet' : 'No sales yet'/)
    expect(hub.match(/pubsUnknown \? \(\s*<PubsUnread/g)?.length ?? 0).toBe(2)
    expect(hub).toMatch(/\) : pubsUnknown \?/)
  })

  it('a retry re-issues the public read and shows that it is in flight', () => {
    expect(hub).toMatch(/rereadPublicSlices\(\)\.finally/)
    expect(hub).toContain('Retrying…')
  })
})

// ================= the Share tab =================

describe('#704 — the Share tab does not say "not published" over an unread status', () => {
  const share = codeOf(read('../src/pages/trip/ShareTab.tsx'))

  it('reads the status through the shared rule', () => {
    expect(share).toMatch(/sliceState\(db\.sliceReads, 'suggested itineraries'\)/)
    expect(share).toMatch(/rowsView\(publishRead, pub \? 1 : 0\)/)
  })

  it('states a failed read as unknown, with a retry, above the form', () => {
    const failed = share.indexOf("publishView === 'failed'")
    const form = share.indexOf('<PublicationForm')
    expect(failed).toBeGreaterThan(-1)
    expect(form).toBeGreaterThan(failed)
    expect(share).toContain("Couldn't read this trip's publish status.")
    expect(share).toMatch(/rereadPublicSlices\(\)\.finally/)
  })

  it('never claims that the trip is not published', () => {
    expect(share).not.toMatch(/not published/i)
  })

  it('mounts the publish form only once the status has loaded', () => {
    expect(share).toMatch(/publishRead === 'ready' && \(\s*<PublicationForm/)
    // While the status is unread, no editable field exists to fill.
    expect(share).not.toMatch(/publishBlockedReason/)
    expect(share).not.toMatch(/ts-submit-gate/)
  })

  it('keys the form by the publication it edits, and holds the key while a write is in flight', () => {
    expect(share).toMatch(/const formKey = frozenKey \?\? publishFormKey\(pub\)/)
    expect(share).toMatch(/<PublicationForm key=\{formKey\}/)
    expect(share).toMatch(/onWriting=\{writing => setFrozenKey\(writing \? publishFormKey\(pub\) : null\)\}/)
  })

  it('reports each write to the parent, and spends the draft on a publish', () => {
    expect(share).toMatch(/setBusy\(true\)\s*onWriting\(true\)/)
    expect(share).toMatch(/setBusy\(false\)\s*onWriting\(false\)/)
    expect(share).toContain('setDraft(null)')
  })
})

// ================= the form's key =================

describe('#704 — the publish form is keyed by the publication it edits', () => {
  const pub = { id: 'pub-1', publishedAt: 100, refreshedAt: 200 }

  it('names no publication "new"', () => {
    expect(publishFormKey(undefined)).toBe('new')
  })

  it('changes when the publication is replaced', () => {
    expect(publishFormKey({ ...pub, id: 'pub-2' })).not.toBe(publishFormKey(pub))
  })

  it('changes when a write refreshes the publication', () => {
    expect(publishFormKey({ ...pub, refreshedAt: 300 })).not.toBe(publishFormKey(pub))
  })

  it('holds still for the same publication at the same refresh', () => {
    expect(publishFormKey({ ...pub })).toBe(publishFormKey(pub))
  })

  it('falls back to the publish time for a row with no refresh time', () => {
    expect(publishFormKey({ id: 'pub-1', publishedAt: 100 }))
      .toBe(publishFormKey({ id: 'pub-1', publishedAt: 100, refreshedAt: undefined }))
    expect(publishFormKey({ id: 'pub-1', publishedAt: 100 })).not.toBe(publishFormKey({ id: 'pub-1', publishedAt: 101 }))
  })
})

// ================= the store's source =================

describe('#704 — the signed-in hydrate keeps the cached list on a failed read', () => {
  it('keeps cache.published when the published read errors', () => {
    const store = codeOf(read('../src/store/store.ts'))
    expect(store).toMatch(/published: pubRes\.error \? cache\.published : dedupePublished\(pubRows\),/)
  })
})
