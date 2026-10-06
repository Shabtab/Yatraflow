// ============ Route constants ============
// The create-trip route, in the three forms this app needs it. Those forms used
// to be three independent string literals — a hash in the bench CTA, a bare
// segment in the router's `switch`, and a path in two nav links — and the bench's
// once read `#/create`, which no route handled: the CTA looked alive, the
// router's `default:` dropped the visitor on the landing page, and the prefill
// the bench had just stashed was never read (#398). Derived from one segment, so
// a rename cannot half-land: change `CREATE_SEGMENT` and every form follows.

/** The bare segment the router's `switch` matches. */
export const CREATE_SEGMENT = 'new'

/** The path form, for comparisons such as `route === CREATE_PATH`. */
export const CREATE_PATH = `/${CREATE_SEGMENT}`

/** The hash form, for links, redirects and `location.hash = CREATE_ROUTE`. */
export const CREATE_ROUTE = `#${CREATE_PATH}`

/** Every first segment the router resolves (`App.tsx`'s pre-switch gates and
 *  `switch`, including '' for the bare route). The legacy-hash bridge maps an
 *  old `#/seg/…` bookmark onto `/{seg}/…` when — and only when — the head is
 *  one of these, so a stale in-app address lands where the router actually
 *  answers instead of the `default:`. Pinned against `App.tsx` itself by
 *  `tests/route-integrity.test.ts` (table ⊆ handled), the same extraction that
 *  polices `LEGACY_SCHEMES` — a router case renamed without updating this list
 *  fails the gate rather than stranding the bookmark. `creator` keeps its own
 *  case in the switch, so the bridge maps `#/creator/<id>` to `/creator/<id>`;
 *  the crawler-facing card lives at `/c/<id>` and stays slice 3's reconciliation. */
export const ROUTED_SEGMENTS: readonly string[] = [
  'pub',
  'trips',
  'share',
  'join',
  'invite',
  'creator',
  'explore',
  'auth',
  CREATE_SEGMENT,
  'created',
  'trip',
  'profile',
  'purchases',
  'creator-hub',
  'admin',
  'dmca',
]

// ============ Real paths, and the legacy hashes that must reach them (#426)
//
// Every screen in this app is addressed by a fragment today, which means every
// screen is `/` to a server and to a crawler. The migration gives each one a real
// path; this table is the part that has to be right BEFORE anything reads it —
// get a scheme wrong here and an old shared link lands on the landing page
// instead of the itinerary it names.
//
// The table is deliberately behaviour-neutral: nothing on a live surface reads it
// yet, so it can land, be reviewed and be pinned while the router still runs on
// hashes. The router swap is the next slice.
//
// The rule for every entry: the FIRST path segment must be a segment the router
// resolves (`tests/route-integrity.test.ts` proves that against `App.tsx` itself,
// so a rename cannot leave this table pointing at a route nothing serves — the
// #398 lesson, extended to paths).

/** A scheme whose old hash links must keep working after the migration. */
export interface LegacyScheme {
  /** `parts[0]` of the legacy hash, e.g. `pub` in `#/pub/<id>`. */
  readonly scheme: string
  /** The first segment of the real path it becomes. Usually the same word —
   *  `creator` is the exception, because the shareable creator address has
   *  always been `/c/<id>` (`creatorShareUrl`), and a redirect that produced
   *  `/creator/<id>` would mint a second address for one page (#362). */
  readonly segment: string
}

/** Every scheme an old link can carry. Ordered as the issue lists them. */
export const LEGACY_SCHEMES: readonly LegacyScheme[] = [
  { scheme: 'pub', segment: 'pub' },
  { scheme: 'join', segment: 'join' },
  { scheme: 'invite', segment: 'invite' },
  { scheme: 'share', segment: 'share' },
  { scheme: 'creator', segment: 'c' },
]

/** The real path an old hash should redirect to, or null when the hash is not a
 *  legacy scheme (the caller then leaves it alone rather than inventing a path).
 *
 *  Pure and total: it never throws, never encodes, and never reorders a query —
 *  the id and any `?query` ride through exactly as they arrived, because the
 *  hash is already percent-encoded by whoever built the link and re-encoding it
 *  here is how `%2F` becomes `%252F` on the second hop. */
export function legacyRedirectPath(hash: string): string | null {
  const route = hash.replace(/^#/, '')
  // Empties filtered, the way `routeParts` reads a route: the hash form carries a
  // leading slash (`#/pub/<id>`), so `split` alone would hand back an empty head
  // and every scheme would look unknown.
  const [head, ...rest] = route.split('/').filter(Boolean)
  const entry = LEGACY_SCHEMES.find(s => s.scheme === head)
  if (!entry) return null
  // A bare scheme (`#/pub`) has nothing to name, so it redirects to the landing
  // page's path rather than to a path with an empty id.
  if (rest.length === 0) return '/'
  return `/${entry.segment}/${rest.join('/')}`
}
