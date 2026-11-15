// ============ Creator fixture (development only) ============
// Mounts the real CreatorPage and CreatorHubPage over seeded store slices, so a
// later phase can screenshot every state without a backend. Nothing here is
// reachable from a production build: the pages live under `dev/`, nothing in
// `src/` imports them, and every row they write is fixture data.
//
// WHAT THIS DOES NOT DO. It does not sign in, mint a session or touch the
// hydrate. The store is never `init()`ed, so no slice read, realtime channel or
// write path starts. The two RPC reads the hub issues (`get_creator_sales`,
// `get_creator_funnel`) go out unauthenticated and land in the page's own
// failed-read state — which is the honest no-backend answer, shown on screen.
//
// STATE knobs, all in the query string (see the on-page index for every case):
//   case=live-0|live-1|live-3|live-7|unpub|long|disabled
//   links=none|youtube|both       read=ok|reading|failed|kept
//   viewer=owner|nonowner|signedout        theme=light|dark
//
// "read=kept" means: the publications read FAILED but rows were already on
// screen, so `rowsView` returns 'kept' — the hub keeps its rows and adds the
// failure note. The store cannot report "kept" itself; the pair (failed read,
// rows present) is what produces it, exactly as in production.
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/sora/500.css'
import '@fontsource/sora/600.css'
import '@fontsource/sora/700.css'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import '../src/styles.css'
import type { CachedUser, PrivateUser, PublicUser, PublishedItinerary, Trip } from '../src/data/types'
import { getSnapshot, _installUsersForTest } from '../src/store/store'
import { CreatorPage } from '../src/pages/CreatorPage'
import { CreatorHubPage } from '../src/pages/CreatorHubPage'

const params = new URLSearchParams(location.search)
const THEME = params.get('theme') === 'dark' ? 'dark' : 'light'
const CASE = params.get('case') ?? 'live-3'
const LINKS = params.get('links') ?? 'both'
const READ = params.get('read') ?? 'ok'
const VIEWER = params.get('viewer') ?? 'owner'

const CREATOR_ID = 'fixture-creator-0001'
const VIEWER_ID = 'fixture-viewer-0002'

// ---- Long strings: exactly the lengths the spec pins (40 name, 300 bio) ----
const LONG_NAME = ('Fixture Creator ' + 'n'.repeat(40)).slice(0, 40)
const LONG_BIO = 'YatraFlow fixture bio sentence. '.repeat(10).slice(0, 300)

type CaseKey = 'live-0' | 'live-1' | 'live-3' | 'live-7' | 'unpub' | 'long' | 'disabled'
const CASE_KEY: CaseKey = (
  ['live-0', 'live-1', 'live-3', 'live-7', 'unpub', 'long', 'disabled'] as const
).includes(CASE as CaseKey) ? (CASE as CaseKey) : 'live-3'

/** How many LIVE publications this case shows. `unpub` = 1 live + 1 taken down. */
const LIVE_COUNT: Record<Exclude<CaseKey, 'unpub' | 'long' | 'disabled'>, number> = {
  'live-0': 0, 'live-1': 1, 'live-3': 3, 'live-7': 7,
}

const pubCount = CASE_KEY in LIVE_COUNT ? LIVE_COUNT[CASE_KEY as keyof typeof LIVE_COUNT] : 1
const WITH_UNPUB = CASE_KEY === 'unpub'

// ---- The seeded creator (and, for the non-owner viewer, a second account) ----
// Clearly synthetic names — "Fixture", an example.invalid address — so a
// capture can never be mistaken for a real person.
type ProfileShape = {
  name: string
  isCreator: boolean
  creatorBio?: string
  socialLinks?: { youtube?: string; instagram?: string }
  creatorAvailable: boolean
  homeCity?: string
  languages: string[]
  travelStyles: string[]
  isDisabled?: boolean
}

const socialLinks: ProfileShape['socialLinks'] =
  LINKS === 'youtube'
    ? { youtube: 'https://www.youtube.com/@fixture-creator' }
    : LINKS === 'both'
      ? { youtube: 'https://www.youtube.com/@fixture-creator', instagram: 'https://www.instagram.com/fixture.creator' }
      : undefined

const baseProfile: ProfileShape = {
  name: CASE_KEY === 'long' ? LONG_NAME : 'Fixture Creator',
  isCreator: CASE_KEY !== 'disabled',
  creatorBio: CASE_KEY === 'long' ? LONG_BIO : 'Plans slow hill drives with early starts and long chai halts.',
  socialLinks,
  creatorAvailable: CASE_KEY !== 'disabled',
  homeCity: 'Kochi',
  languages: ['en', 'hi'],
  travelStyles: ['balanced'],
  // `disabled` is the admin-disabled account: the derived availability signal
  // is false, which is the only thing the public route reads (#800).
  isDisabled: CASE_KEY === 'disabled' ? true : undefined,
}

const creatorPrivate: PrivateUser = {
  id: CREATOR_ID,
  kind: 'private',
  email: 'fixture-creator@example.invalid',
  createdAt: 1,
  profile: baseProfile as PrivateUser['profile'],
}

const creatorPublic: PublicUser = {
  id: CREATOR_ID,
  kind: 'public',
  profile: {
    name: baseProfile.name,
    isCreator: baseProfile.isCreator,
    creatorBio: baseProfile.creatorBio,
    socialLinks: baseProfile.socialLinks,
    creatorAvailable: baseProfile.creatorAvailable,
  },
}

const viewerUser: PrivateUser = {
  id: VIEWER_ID,
  kind: 'private',
  email: 'fixture-viewer@example.invalid',
  createdAt: 2,
  profile: {
    name: 'Fixture Viewer',
    isCreator: false,
    creatorAvailable: false,
    languages: ['en'],
    travelStyles: [],
  },
}

// The viewer decides which identity the session carries, and therefore which
// shape the creator's row may hold: the account's OWN row is private, a row
// another account sees is the public card only (#800).
const sessionUserId: string | null =
  VIEWER === 'owner' ? CREATOR_ID : VIEWER === 'nonowner' ? VIEWER_ID : null
const creatorRow: CachedUser = VIEWER === 'owner' ? creatorPrivate : creatorPublic

// ---- The seeded trips behind the publications (one each, minimal shape) ----
function trip(i: number): Trip {
  return {
    id: `fixture-trip-${i}`,
    name: `Fixture road trip ${i}`,
    startLocation: 'Kochi',
    destinations: ['Munnar', 'Alleppey'],
    startDate: '2026-11-01',
    endDate: '2026-11-05',
    travellers: 2,
    transportMode: 'car',
    budgetPerPersonInr: 18000,
    travelStyle: 'balanced',
    fixedCommitments: [],
    days: [{ id: `fixture-trip-${i}-day-0`, index: 0, stops: [] }],
    expenses: [],
    coverEmoji: '🛣️',
    visibility: 'public',
    createdAt: 1,
    updatedAt: 1,
  }
}

// ---- The seeded publications ----
function pub(i: number, takenDown: boolean): PublishedItinerary {
  return {
    id: `fixture-pub-${i}`,
    tripId: `fixture-trip-${i}`,
    creatorId: CREATOR_ID,
    title: `Fixture Kerala drive ${i}`,
    tagline: 'A synthetic itinerary for screenshots only.',
    routeSummary: ['Kochi', 'Munnar', 'Alleppey'],
    durationDays: 5,
    estimatedBudgetPerPersonInr: 18000,
    travelStyle: 'balanced',
    bestSeason: 'Nov - Feb',
    travelTips: ['Fixture tip — replace with a real one in production data.'],
    warningsAndAssumptions: ['Fixture warning.'],
    freeDayIndexes: [0],
    premiumPriceInr: i % 2 === 0 ? 199 : undefined,
    publishedAt: 1_760_000_000_000 - i * 86_400_000,
    views: 120 + i * 7,
    copies: 9 + i,
    // Soft-unpublish (#350): the row SURVIVES the takedown; the public page
    // filters it, the hub keeps it for its sales history.
    ...(takenDown ? { unpublishedAt: 1_761_000_000_000 } : {}),
  }
}

const livePubs = Array.from({ length: pubCount }, (_, i) => pub(i, false))
const allPubs = WITH_UNPUB ? [...livePubs, pub(90, true)] : livePubs

// ---- The slice-read verdicts ----
// `ok`     → 'ready';  absent → 'reading';  `failed` → 'failed'.
// With rows already on screen, failed is exactly what `rowsView` reads as
// 'kept' — the hub keeps its rows and stamps the failure beside them.
const pubsVerdict = READ === 'ok' || READ === 'kept' ? 'ok' : READ === 'failed' ? 'failed' : undefined
// `kept` needs a FAILED read on screen WITH rows, so it re-maps to 'failed':
const effectivePubsVerdict = READ === 'kept' ? 'failed' : pubsVerdict
const tripsVerdict = effectivePubsVerdict ?? undefined

// ---- Seed the snapshot, then install the users through the store's OWN gate ----
// A direct write to `cache.users` would leave `catalogAuthority` unstamped and
// the next install would refuse every private row — the same trap the profile
// fixture documents. Seed the plain slices first, plant the session id, then
// let `_installUsersForTest` stamp the authority once.
const db = getSnapshot()
db.trips = allPubs.map((p, i) => trip(WITH_UNPUB && i === livePubs.length ? 90 : i))
db.decisions = []
db.activity = []
db.notifications = []
db.published = allPubs
db.suggestions = []
db.ready = true
db.sessionUserId = sessionUserId
const reads: Record<string, 'ok' | 'failed'> = {
  trips: tripsVerdict ?? 'ok',
  profiles: effectivePubsVerdict ?? 'ok',
  'suggested itineraries': effectivePubsVerdict ?? 'ok',
}
db.sliceReads = reads

if (sessionUserId === CREATOR_ID) {
  _installUsersForTest([creatorPrivate])
} else if (sessionUserId === VIEWER_ID) {
  _installUsersForTest([viewerUser, creatorPublic])
} else {
  _installUsersForTest([creatorPublic])
}

document.documentElement.dataset.theme = THEME

// ---- The on-page index: a link to every case this fixture can render ----
const INDEX_CASES: { label: string; query: string }[] = [
  { label: '0 live routes', query: '?case=live-0' },
  { label: '1 live route', query: '?case=live-1' },
  { label: '3 live routes', query: '?case=live-3' },
  { label: '7 live routes', query: '?case=live-7' },
  { label: 'one unpublished route', query: '?case=unpub' },
  { label: 'long name (40) and bio (300)', query: '?case=long' },
  { label: 'links: none', query: '?case=live-3&links=none' },
  { label: 'links: YouTube only', query: '?case=live-3&links=youtube' },
  { label: 'links: YouTube + Instagram', query: '?case=live-3&links=both' },
  { label: 'publications read: reading', query: '?case=live-3&read=reading' },
  { label: 'publications read: failed', query: '?case=live-3&read=failed' },
  { label: 'publications read: kept', query: '?case=live-3&read=kept' },
  { label: 'viewer: owner', query: '?case=live-3&viewer=owner' },
  { label: 'viewer: non-owner (signed in)', query: '?case=live-3&viewer=nonowner' },
  { label: 'viewer: signed out', query: '?case=live-3&viewer=signedout' },
  { label: 'disabled creator', query: '?case=disabled' },
]

function FixtureIndex() {
  return (
    <div
      style={{
        position: 'fixed',
        left: 12,
        top: 12,
        zIndex: 2147483647,
        maxWidth: 280,
        maxHeight: 'calc(100vh - 24px)',
        overflowY: 'auto',
        padding: '10px 12px',
        borderRadius: 12,
        background: '#0C1420',
        color: '#FCFEFD',
        font: '500 11px/1.5 "Plus Jakarta Sans", sans-serif',
      }}
    >
      <b style={{ display: 'block', marginBottom: 6, font: '700 10px/1.4 "Plus Jakarta Sans", sans-serif', letterSpacing: '.08em', textTransform: 'uppercase' }}>
        Creator fixture — every case
      </b>
      {INDEX_CASES.map(({ label, query }) => (
        <a
          key={query}
          href={`/dev/creator-fixture.html${query}`}
          style={{ display: 'block', color: '#7DE2D1', textDecoration: 'none', padding: '1px 0' }}
        >
          {label}
        </a>
      ))}
      <span style={{ display: 'block', marginTop: 6, opacity: .7 }}>
        Dev only — synthetic data, no session, no store hydrate.
      </span>
    </div>
  )
}

const navigate = (route: string) => { console.log('[fixture] navigate', route) }

const root = document.getElementById('root')
if (!root) throw new Error('Creator fixture root not found')
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <>
      {params.has('case') || params.has('viewer') || params.has('read') || params.has('links') ? (
        <>
          <CreatorPage creatorId={CREATOR_ID} onNavigate={navigate} />
          <CreatorHubPage onNavigate={navigate} />
        </>
      ) : (
        <FixtureIndex />
      )}
    </>
  </React.StrictMode>,
)
