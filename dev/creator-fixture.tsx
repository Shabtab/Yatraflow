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
//   case=live-0|live-1|live-3|live-7|unpub|long|disabled|kit   (kit = the cr- component gallery: no page, no store)
//   links=none|youtube|both       read=ok|reading|failed|kept
//   viewer=owner|nonowner|signedout        theme=light|dark
//
// "read=kept" means: the publications read FAILED but rows were already on
// screen, so `rowsView` returns 'kept' — the hub keeps its rows and adds the
// failure note. The store cannot report "kept" itself; the pair (failed read,
// rows present) is what produces it, exactly as in production.
import React, { Suspense, lazy } from 'react'
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
const CreatorRankingsPage = lazy(() =>
  import('../src/pages/CreatorRankings').then(module => ({ default: module.CreatorRankingsPage })))
import { CrSectionHead } from '../src/components/creator/CrSectionHead'
import { CrStatTile } from '../src/components/creator/CrStatTile'
import { CrRankTile } from '../src/components/creator/CrRankTile'
import { CrDelta } from '../src/components/creator/CrDelta'
import { CrMeterRow } from '../src/components/creator/CrMeterRow'
import { Chip } from '../src/components/ui'
import { Eye } from 'lucide-react'

const params = new URLSearchParams(location.search)
const THEME = params.get('theme') === 'dark' ? 'dark' : 'light'
const CASE = params.get('case') ?? 'live-3'
const LINKS = params.get('links') ?? 'both'
const READ = params.get('read') ?? 'ok'
const VIEWER = params.get('viewer') ?? 'owner'
const PAGE = params.get('page')

const CREATOR_ID = 'fixture-creator-0001'
const VIEWER_ID = 'fixture-viewer-0002'
const RANKED_ID = 'fixture-creator-ranked'
const DISABLED_ID = 'fixture-creator-disabled'

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

// ---- Rankings fixture: 0, 1, 3 or 15 ranked creators, one disabled account ----
const RANK_COUNTS: Record<string, number> = { 'rank-0': 0, 'rank-1': 1, 'rank-3': 3, 'rank-15': 15 }
const RANK_CASE = CASE in RANK_COUNTS ? CASE : undefined
const rankCount = RANK_CASE ? RANK_COUNTS[CASE] : 0
const rankStyleFor = (index: number) => (
  ['adventure', 'balanced', 'food-focused', 'family', 'budget', 'relaxed', 'packed'][
    index % 7
  ]
)

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

const rankedPrivate: PrivateUser = {
  id: RANKED_ID,
  kind: 'private',
  email: 'fixture-ranked@example.invalid',
  createdAt: 3,
  profile: {
    name: 'Fixture Ranked Creator',
    isCreator: true,
    creatorAvailable: true,
    languages: ['en'],
    travelStyles: ['balanced'],
  },
}

const rankedPublic: PublicUser = {
  id: RANKED_ID,
  kind: 'public',
  profile: {
    name: 'Fixture Ranked Creator',
    isCreator: true,
    creatorAvailable: true,
  },
}

const disabledCreator: PublicUser = {
  id: DISABLED_ID,
  kind: 'public',
  profile: {
    name: 'Fixture Disabled Creator',
    isCreator: true,
    creatorAvailable: false,
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

// The viewer decides which identity the session carries, so it decides which
// shape the creator's row may hold: the account's OWN row is private, a row
// another account sees is the public card only (#800).
const sessionUserId: string | null =
  PAGE === 'rankings'
    ? VIEWER === 'signedin' ? RANKED_ID : null
    : VIEWER === 'owner' ? CREATOR_ID : VIEWER === 'nonowner' ? VIEWER_ID : null
const rankCreatorIds = Array.from({ length: rankCount }, (_, index) => (
  index === 2 ? RANKED_ID : `fixture-rank-creator-${String(index + 1).padStart(4, '0')}`
))

const rankCreatorRows: CachedUser[] = rankCreatorIds.map((id, index) => (
  id === RANKED_ID
    ? sessionUserId === RANKED_ID ? rankedPrivate : rankedPublic
    : {
        id,
        kind: 'public',
        profile: {
          name: `Fixture Ranked ${String.fromCharCode(65 + index)}`,
          isCreator: true,
          creatorAvailable: true,
        },
      }
))

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
const rankPubs = [
  ...rankCreatorIds.map((creatorId, index) => ({
    ...pub(index, false),
    id: `fixture-rank-pub-${index}`,
    creatorId,
    title: `Fixture ranked drive ${index}`,
    travelStyle: rankStyleFor(index),
    views: 500 - index * 5,
    copies: Math.max(1, rankCount * 4 - index),
  })),
  // A disabled account's live route still exists, but the account never ranks.
  { ...pub(90, false), id: 'fixture-rank-pub-disabled', creatorId: DISABLED_ID, copies: 999, views: 999 },
]
const seededPubs = RANK_CASE ? rankPubs : allPubs

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
db.published = seededPubs
db.suggestions = []
db.ready = true
db.sessionUserId = sessionUserId
const reads: Record<string, 'ok' | 'failed'> = {
  trips: tripsVerdict ?? 'ok',
  profiles: effectivePubsVerdict ?? 'ok',
  'suggested itineraries': effectivePubsVerdict ?? 'ok',
}
db.sliceReads = reads

if (PAGE === 'rankings') {
  _installUsersForTest(sessionUserId === RANKED_ID
    ? [...rankCreatorRows, disabledCreator]
    : [...rankCreatorRows, rankedPublic, disabledCreator])
} else if (sessionUserId === CREATOR_ID) {
  _installUsersForTest([creatorPrivate])
} else if (sessionUserId === VIEWER_ID) {
  _installUsersForTest([viewerUser, creatorPublic])
} else {
  _installUsersForTest([creatorPublic])
}

document.documentElement.dataset.theme = THEME

// ---- The on-page index: a link to every case this fixture can render ----
const INDEX_CASES: { label: string; query: string }[] = [
  { label: 'cr- kit gallery (every shared component)', query: '?case=kit' },
  { label: 'cr- kit gallery, dark theme', query: '?case=kit&theme=dark' },
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
  { label: 'rankings: 0 creators', query: '?page=rankings&case=rank-0' },
  { label: 'rankings: 1 creator', query: '?page=rankings&case=rank-1' },
  { label: 'rankings: 3 creators', query: '?page=rankings&case=rank-3' },
  { label: 'rankings: 15 creators', query: '?page=rankings&case=rank-15' },
  { label: 'rankings: signed-in ranked creator', query: '?page=rankings&case=rank-3&viewer=signedin' },
  { label: 'rankings: read loading', query: '?page=rankings&case=rank-3&read=reading' },
  { label: 'rankings: read failed', query: '?page=rankings&case=rank-3&read=failed' },
  { label: 'rankings: read kept', query: '?page=rankings&case=rank-3&read=kept' },
  { label: 'rankings: disabled creator hidden', query: '?page=rankings&case=rank-1' },
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

// ---- The cr- kit gallery (?case=kit): every shared component, every state ----
// Dev only. No page and no store is mounted: the kit's own components render
// over fixture text. Each block carries a caption that names what it shows, so
// a browser check can read every state without the real pages.
const KIT_BLOCK: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: '18px 0',
  borderTop: '1px solid var(--pw-line)',
}
const KIT_CAPTION: React.CSSProperties = {
  margin: 0,
  font: '500 12px/1.4 "Plus Jakarta Sans", sans-serif',
  color: 'var(--pw-ink-3)',
}

function KitBlock({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <section style={KIT_BLOCK}>
      <p style={KIT_CAPTION}>{caption}</p>
      {children}
    </section>
  )
}

function KitGallery() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 64px', color: 'var(--pw-ink)' }}>
      <p style={{ margin: 0, font: '600 13px/1.4 "Plus Jakarta Sans", sans-serif' }}>
        cr- kit gallery · theme: {THEME} · fixture text only
      </p>

      <KitBlock caption="CrSectionHead: kicker, title and note">
        <CrSectionHead kicker="Fixture kicker" title="Fixture section title" note="Fixture note beside the title." />
      </KitBlock>
      <KitBlock caption="CrSectionHead: no note">
        <CrSectionHead kicker="Fixture kicker" title="Fixture section without a note" />
      </KitBlock>
      <KitBlock caption="CrSectionHead: with actions">
        <CrSectionHead
          kicker="Fixture kicker"
          title="Fixture section with actions"
          note="Fixture note beside the actions."
          actions={<button type="button" className="btn">Fixture action</button>}
        />
      </KitBlock>

      <KitBlock caption="cr-card with cr-card__title">
        <div className="cr-card">
          <h3 className="cr-card__title">Fixture card title</h3>
          <p>Fixture card body text.</p>
        </div>
      </KitBlock>

      <KitBlock caption="cr-tilegrid, 2 columns (--cr-cols 2): value, Unavailable (value null), soft">
        <div className="cr-tilegrid" style={{ '--cr-cols': 2 } as React.CSSProperties}>
          <CrStatTile label="Fixture value" value="1,240" />
          <CrStatTile label="Unavailable (value null)" value={null} />
          <CrStatTile label="Soft tile" value="88" soft />
        </div>
      </KitBlock>
      <KitBlock caption="cr-tilegrid, 3 columns (--cr-cols 3): note, icon, soft with note">
        <div className="cr-tilegrid" style={{ '--cr-cols': 3 } as React.CSSProperties}>
          <CrStatTile label="With a note" value="12" note="Fixture note under the label." />
          <CrStatTile label="With an icon" value="7" icon={<Eye size={18} />} />
          <CrStatTile label="Soft with a note" value="4" note="Fixture soft note." soft />
        </div>
      </KitBlock>

      <KitBlock caption="CrRankTile: rank 12 of 120, no link">
        <CrRankTile scope="Fixture scope" rank={12} total={120} />
      </KitBlock>
      <KitBlock caption="CrRankTile: rank 12 of 120, with href (in-app link to /creators)">
        <CrRankTile scope="Fixture scope" rank={12} total={120} href="/creators" />
      </KitBlock>
      <KitBlock caption="CrRankTile: rank null (Unavailable)">
        <CrRankTile scope="Fixture scope" rank={null} total={120} />
      </KitBlock>

      <KitBlock caption="CrDelta: +3, −2 and 0">
        <div style={{ display: 'flex', gap: 16 }}>
          <CrDelta value={3} />
          <CrDelta value={-2} />
          <CrDelta value={0} />
        </div>
      </KitBlock>

      <KitBlock caption="CrMeterRow: pct 0, 50, 100 and 140 (140 clamps to a full bar; the shown value stays 140%)">
        <CrMeterRow label="Fixture zero" value="0%" pct={0} tone="route" />
        <CrMeterRow label="Fixture half" value="50%" pct={50} tone="route" />
        <CrMeterRow label="Fixture full" value="100%" pct={100} tone="route" />
        <CrMeterRow label="Fixture over (clamp check)" value="140%" pct={140} tone="route" />
      </KitBlock>
      <KitBlock caption="CrMeterRow: one row per tone (route, lagoon, lagoon-deep, marigold)">
        <CrMeterRow label="Tone route" value="40%" pct={40} tone="route" />
        <CrMeterRow label="Tone lagoon" value="40%" pct={40} tone="lagoon" />
        <CrMeterRow label="Tone lagoon-deep" value="40%" pct={40} tone="lagoon-deep" />
        <CrMeterRow label="Tone marigold" value="40%" pct={40} tone="marigold" />
      </KitBlock>
      <KitBlock caption="CrMeterRow: with a note">
        <CrMeterRow label="Fixture with a note" value="60%" pct={60} tone="lagoon" note="Fixture note under the meter." />
      </KitBlock>

      <KitBlock caption="cr-ident with cr-ident__name: fake h1-sized name and a teal Creator chip">
        <div className="cr-ident">
          <div className="cr-ident__name">
            <h1 style={{ margin: 0 }}>Fixture Creator</h1>
            <Chip tone="teal">Creator</Chip>
          </div>
        </div>
      </KitBlock>

      <KitBlock caption="cr-band with cr-band__title, kicker, body and one .btn">
        <div className="cr-band">
          <div>
            <p style={{ margin: 0, opacity: 0.8 }}>Fixture kicker</p>
            <h3 className="cr-band__title">Fixture band title</h3>
            <p style={{ margin: '4px 0 0' }}>Fixture band body text.</p>
          </div>
          <button type="button" className="btn">Fixture button</button>
        </div>
      </KitBlock>

      <KitBlock caption="cr-divider with kicker and note">
        <div className="cr-divider">
          <span>Fixture kicker</span>
          <span>Fixture note</span>
        </div>
      </KitBlock>
    </div>
  )
}

const navigate = (route: string) => { console.log('[fixture] navigate', route) }

const root = document.getElementById('root')
if (!root) throw new Error('Creator fixture root not found')
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <>
      {PAGE === 'rankings' ? (
        <Suspense fallback={<StateBlockLoading />}>
          <CreatorRankingsPage />
        </Suspense>
      ) : CASE === 'kit' ? (
        <KitGallery />
      ) : params.has('case') || params.has('viewer') || params.has('read') || params.has('links') ? (
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

function StateBlockLoading() {
  return <div className="container yf-page page-enter">Loading…</div>
}
