// ============ #800 — the authority-aware profile catalogue ============
//
// One pure constructor decides the final contents of `cache.users`, and one
// installer writes them. Everything else in the store asks this module.
//
// The failure this replaces: hydrate assembled `installedUsers`, then chose
// between it and the previous array with `usersToInstall` / `keepPreviousUsers`,
// and filtered it with `dropStalePrivate`. Those are three decisions made at
// three different times, from three different views of the same authority, so a
// same-ID admin loss could keep every other-account private row (the array was
// kept whole) and a fresh self-read failure could filter a successful admin
// batch down to self (the filter ran after the success). Root's browser probe at
// 2c31f6bd recorded both: `owner-authority-alias-2c31f6bd.json` fails
// "Same-ID role loss plus failed read removes other-account private data" and
// "Successful admin read installs both authorized private accounts after self
// read failure".
//
// The rule this module enforces: an entry is private only while the CURRENT
// authority revision authorizes it, and a read outcome can only ever add data,
// never take authority away. Authority loss is therefore an install-time fact,
// not a read-time hope — which is why the previous catalogue carries the
// revision it was built under, and why that revision, not a user id, is what
// decides whether a private row may be retained.
import type { CachedUser, ID, PrivateUser, PrivateUserProfile, PublicUser, PublicUserProfile } from '../data/types'

/** The authority a read was taken under, and the one its result will be judged
 *  against. Both epochs are captured BEFORE any await, so a transition during a
 *  read cannot reauthorize that read's result.
 *
 *  `authorityEpoch` moves on every observed admin loss or regain, including a
 *  same-ID transition. `identityEpoch` moves on every identity change. They are
 *  separate on purpose: an admin true → false → true cycle keeps the same user,
 *  so an identity check alone would treat the old read as current.
 *
 *  `userId` is null for the anonymous catalogue: there is no account, so there
 *  is no self row and no private authority of any kind. */
export interface AccessScope {
  userId: ID | null
  identityEpoch: number
  authorityEpoch: number
  admin: boolean
}

/** What a slice read answered. `absent` is a successful read that found no row,
 *  which is a different thing from `failed` and must stay different: a disabled
 *  account cannot read its own row, so `absent` is what a real disabled session
 *  looks like, and collapsing it into `failed` would sign out every account whose
 *  row is briefly unreadable. `not-requested` means this run did not ask, so it
 *  can neither certify nor revoke anything. */
export type SliceRead<T> =
  | { status: 'ok'; value: T }
  | { status: 'absent' }
  | { status: 'failed'; reason: string }
  | { status: 'not-requested' }

export interface CatalogReads {
  public: {
    users: PublicUser[]
    failed: boolean
    /** False for a DELTA — one live card, or a reconnect's single upsert — which
     *  mentions only the ids it carries and must not evict the rest. A full read
     *  (hydrate, anonymous hydrate, the public retry) is complete and does. */
    complete: boolean
  }
  self: SliceRead<PrivateUser>
  admin: SliceRead<readonly PrivateUser[]>
}

/** The catalogue this run is allowed to start from. `ownerUserId` is the identity
 *  the entries were collected under; a different account starts from nothing,
 *  because another account's private rows are not a fallback for this one.
 *  `authorityEpoch` is the revision they were collected UNDER, and it is the
 *  whole provenance story: an unchanged revision proves the admin authority is
 *  unchanged, so the private rows it unlocked are still unlocked. */
export interface PreviousCatalog {
  ownerUserId: ID | null
  authorityEpoch: number | null
  /** Whether the previous catalogue held a PRIVATE, authorised row for its owner. */
  selfAuthorized: boolean
  users: readonly CachedUser[]
}

export interface CatalogResult {
  users: CachedUser[]
  /** Per-slice verdicts, written beside the data they describe. A slice that was
   *  not requested emits NO verdict, so a public-only refresh cannot clear a
   *  private failure — the store merges these, it does not replace with them. */
  verdicts: Record<string, 'ok' | 'failed'>
  /** True when the self view holds a private row that is still authorised. */
  selfAuthorized: boolean
}

export const isSliceOk = <T>(read: SliceRead<T>): read is { status: 'ok'; value: T } => read.status === 'ok'

/** The reviewed public shape of an entry, for downgrading a private row whose
 *  authority has lapsed. This is the same projection the offline snapshot uses,
 *  so a downgraded row is byte-identical to a public card. */
export function publicOnly(user: CachedUser): PublicUser {
  return {
    id: user.id,
    kind: 'public',
    profile: {
      name: user.profile.name,
      avatarUrl: user.profile.avatarUrl,
      isCreator: user.profile.isCreator,
      creatorBio: user.profile.creatorBio,
      socialLinks: user.profile.socialLinks,
      creatorAvailable: user.profile.creatorAvailable,
    },
  }
}

/** Overlay a public card's reviewed fields onto an entry. A private entry keeps
 *  its private fields and takes the public ones, which is what makes a live
 *  rename reach the screen without widening the boundary. */
export function mergePublicCard(existing: CachedUser, card: PublicUser): CachedUser {
  if (existing.kind === 'public') return card
  return {
    ...existing,
    profile: { ...existing.profile, ...(card.profile as PublicUserProfile) } as PrivateUserProfile,
  }
}

/**
 * The one constructor.
 *
 * Order matters and is not arbitrary:
 *   1. Start from what this run READ. A failed public read falls back to the
 *      previous account's public cards only — never its private rows, because a
 *      public failure is not authority. A DELTA read keeps the entries it did
 *      not mention; a complete read replaces them.
 *   2. Apply the self outcome. A fresh success installs the row. Explicit absence
 *      removes stale self-private data, so a disabled account does not keep
 *      showing as enabled. A failure, or no read at all, keeps the previous
 *      private row ONLY while the same identity holds the same authority
 *      revision — a same-session fallback carries a failed verdict, and another
 *      account inherits nothing.
 *   3. Apply the admin batch. Every row in a successful batch is installed,
 *      including the caller's own, and that row supplies self success — a failed
 *      narrower self read must not defeat a successful wider one. A batch that
 *      omits self cannot invent self success. A batch that failed, or was not
 *      re-read at all, retains the previous other-account private rows only
 *      under the same uninterrupted admin authority revision.
 *   4. Downgrade everything the current authority does not cover. This is the
 *      step that makes an admin loss immediate: it runs on the final map, after
 *      every read outcome, so it cannot be skipped by a fallback path.
 */
export function buildCatalog(scope: AccessScope, reads: CatalogReads, previous: PreviousCatalog): CatalogResult {
  const sameOwner = scope.userId !== null && previous.ownerUserId === scope.userId
  // The uninterrupted-authority test. `authorityEpoch` moves on every observed
  // admin loss or regain, so an unchanged revision is proof the authority is
  // unchanged — and a changed one is proof it is not, whatever the user id says.
  const sameAuthority = sameOwner && previous.authorityEpoch !== null && previous.authorityEpoch === scope.authorityEpoch
  const previousEligible = sameOwner ? previous.users : []
  // A private entry wins over a public card for the same id, the same rule
  // `mergeUsers` applies — so the order the previous array happens to be in
  // cannot decide which one is the fallback.
  const previousById = new Map<ID, CachedUser>()
  for (const u of previousEligible) {
    const held = previousById.get(u.id)
    if (held?.kind === 'private' && u.kind === 'public') continue
    previousById.set(u.id, u)
  }

  // 1. The base set.
  const out = new Map<ID, CachedUser>()
  if (!reads.public.failed) for (const u of reads.public.users) out.set(u.id, u)
  // A failed read, or a delta that did not mention an id, falls back to the
  // previous PUBLIC cards. Never to a previous private row: a public failure is
  // not authority, and a delta is not a deletion.
  if (reads.public.failed || !reads.public.complete) {
    for (const u of previousEligible) if (!out.has(u.id)) out.set(u.id, publicOnly(u))
  }

  const verdicts: Record<string, 'ok' | 'failed'> = {}

  // 2. Self.
  let selfAuthorized = false
  const priorSelf = sameAuthority && previous.selfAuthorized ? previousById.get(scope.userId ?? '') : undefined
  if (reads.self.status === 'ok') {
    out.set(reads.self.value.id, reads.self.value)
    selfAuthorized = true
    verdicts['self profile'] = 'ok'
  } else if (reads.self.status === 'absent') {
    // Authoritative absence: the account has no readable private row. Drop any
    // stale self-private data rather than leaving it claiming to be current.
    if (scope.userId !== null) out.delete(scope.userId)
    verdicts['self profile'] = 'ok'
  } else if (reads.self.status === 'failed') {
    verdicts['self profile'] = 'failed'
    // A same-session fallback is ALLOWED, and it carries the failed verdict: the
    // account keeps its row so the settings page can show a failure with a retry
    // instead of silently reading as a public card. It is still AUTHORISED —
    // `sameAuthority` already proved the revision is unchanged — so the gate
    // below must not downgrade it.
    if (priorSelf?.kind === 'private') { out.set(priorSelf.id, priorSelf); selfAuthorized = true }
  } else {
    // Not requested. The previous verdict stands, and so does the previous
    // authorised row — this run has no evidence either way.
    if (priorSelf?.kind === 'private') { out.set(priorSelf.id, priorSelf); selfAuthorized = true }
  }

  // 3. Admin batch.
  let adminRows: readonly PrivateUser[] = []
  // A read outcome can only ever ADD data, so a batch that came back is
  // installed whether or not the caller still holds the authority that asked for
  // it. Step 4 is the ONLY place that decides what the current authority covers,
  // and it is what takes those rows away again on a loss. Pre-filtering here as
  // well would split one decision across two places, which is how the same-ID
  // loss used to survive.
  if (reads.admin.status === 'ok') {
    // The batch is the complete list. A previous private row the batch does not
    // return is gone: the read that saw everything did not see it.
    adminRows = reads.admin.value
  } else if (sameAuthority) {
    for (const u of previousEligible) {
      if (u.kind !== 'private' || u.id === scope.userId) continue
      out.set(u.id, u)
    }
  }
  for (const row of adminRows) out.set(row.id, row)

  // The batch's own row for the caller is authoritative self data. A batch that
  // omits self leaves `selfAuthorized` exactly where the self read put it.
  const selfFromBatch = scope.userId === null ? undefined : adminRows.find(u => u.id === scope.userId)
  if (selfFromBatch) {
    selfAuthorized = true
    verdicts['self profile'] = 'ok'
  }

  // The console's verdict is about the caller's authority AND the read: a batch
  // that came back for a caller who no longer holds the admin role is a failure,
  // because nothing it returned may be shown.
  if (reads.admin.status === 'ok' || reads.admin.status === 'failed') {
    verdicts['admin profiles'] = (reads.admin.status === 'ok' && scope.admin) ? 'ok' : 'failed'
  } else if (!scope.admin) {
    // Not requested, and the caller holds no admin authority: a stale 'ok' from
    // an earlier admin session must not be reported as current.
    verdicts['admin profiles'] = 'failed'
  }
  // Not requested while still an admin: no verdict at all, so the previous one
  // stands. A public-only refresh must not certify or revoke the bulk read.

  verdicts.profiles = reads.public.failed ? 'failed' : 'ok'

  // 4. Authority gate. Runs last, over the whole map, and it is the ONLY place
  //    that decides what the current authority covers. Steps 2 and 3 deliberately
  //    do not pre-filter: a read outcome can only ever add data, so a batch or a
  //    same-revision retention may put a private row in the map, and this gate is
  //    what takes it away again when the caller no longer holds the authority
  //    that unlocked it. Splitting that decision between "install it" and "maybe
  //    keep it" is how the same-ID loss used to survive.
  for (const [id, user] of [...out]) {
    if (user.kind !== 'private') continue
    if (id === scope.userId) {
      if (!selfAuthorized) out.set(id, publicOnly(user))
      continue
    }
    if (!scope.admin) out.set(id, publicOnly(user))
  }

  return { users: [...out.values()], verdicts, selfAuthorized }
}

/** Normalise an existing array under a new authority, with no new reads. Used by
 *  the auth callback to make a loss immediate: the projection happens before any
 *  network read can fail, so an other-account private row never survives long
 *  enough to be displayed. */
export function normalizeCatalog(scope: AccessScope, previous: PreviousCatalog): CatalogResult {
  return buildCatalog(scope, {
    public: { users: [], failed: true, complete: false },
    self: { status: 'not-requested' },
    admin: { status: 'not-requested' },
  }, previous)
}

/** The read a non-admin caller is allowed to ask for. */
export function adminReadAllowed(scope: AccessScope): boolean {
  return scope.admin
}

export type { PublicUser, PrivateUser, CachedUser }
