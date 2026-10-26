//
// `buildCatalog` decides the final contents of `cache.users` from the read
// outcomes, the authority those reads were taken under, and the catalogue they
// are replacing. The store's installer is the only writer.
import type { CachedUser, ID, PrivateUser, PublicUser } from '../data/types'
import { toPublicUser } from '../lib/publicProfile'

/** The authority a read was taken under. Both epochs are captured BEFORE any
 *  await, so a transition during a read cannot reauthorize that read's result.
 *
 *  `authorityEpoch` moves on every observed admin loss or regain, including a
 *  same-ID transition. `identityEpoch` moves on every identity change. They are
 *  separate on purpose: an admin true → false → true cycle keeps the same user,
 *  so an identity check alone would treat the old read as current.
 *
 *  `userId` is null for the anonymous catalogue: there is no account, so there is
 *  no self row and no private authority of any kind. */
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
     *  mentions only the ids it carries and must not evict the rest. A complete
     *  read (hydrate, anonymous hydrate, the public retry) does. */
    complete: boolean
    /** True when this run read the public catalogue, so its outcome is
     *  authoritative for the `profiles` verdict. A run that never asked — a
     *  private-only refresh, an optimistic edit, a reprojection — must not
     *  certify or revoke a slice it did not read. */
    requested: boolean
  }
  self: SliceRead<PrivateUser>
  admin: SliceRead<readonly PrivateUser[]>
}

/** The catalogue a run is allowed to start from. `ownerUserId` is the identity
 *  the entries were collected under; a different account starts from nothing,
 *  because another account's private rows are not a fallback for this one.
 *  `authorityEpoch` is the revision they were collected UNDER, and an unchanged
 *  revision is proof the admin authority is unchanged. */
export interface PreviousCatalog {
  ownerUserId: ID | null
  /** The identity generation the entries were collected under. A new login with
   *  the SAME id moves it, so self provenance cannot be inherited across one. */
  identityEpoch: number | null
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

/** Overlay a fresh public card's reviewed fields onto a retained private row.
 *  The private fields survive and the public ones are refreshed, which is what
 *  keeps a remote rename or an availability change visible without widening the
 *  boundary. */
function overlayPublic(held: PrivateUser, card: PublicUser): PrivateUser {
  return {
    ...held,
    profile: {
      ...held.profile,
      name: card.profile.name,
      avatarUrl: card.profile.avatarUrl,
      isCreator: card.profile.isCreator,
      creatorBio: card.profile.creatorBio,
      socialLinks: card.profile.socialLinks,
      creatorAvailable: card.profile.creatorAvailable,
    },
  }
}

/** The entry a retained private row becomes when this run read a fresh public
 *  card for the same id: the private row with the card's reviewed fields laid
 *  over it. With no fresh card the private row stands as it was. */
function retainPrivate(held: PrivateUser, fresh: PublicUser | undefined): PrivateUser {
  return fresh ? overlayPublic(held, fresh) : held
}

export function buildCatalog(scope: AccessScope, reads: CatalogReads, previous: PreviousCatalog): CatalogResult {
  const sameOwner = scope.userId !== null && previous.ownerUserId === scope.userId
  // Self provenance and the admin lease are separate, and must be. A same-session
  // admin loss keeps the caller's own authorised row while converting every other
  // account's private row to public identity; a new login with the same id
  // inherits neither.
  const sameSession = sameOwner && previous.identityEpoch !== null && previous.identityEpoch === scope.identityEpoch
  // An unchanged revision is proof the admin authority is unchanged — and a
  // changed one is proof it is not, whatever the user id says.
  const sameAuthority = sameSession && previous.authorityEpoch !== null && previous.authorityEpoch === scope.authorityEpoch
  const previousEligible = sameOwner ? previous.users : []
  // A private entry wins over a public card for the same id, so the order the
  // previous array happens to be in cannot decide which one is the fallback.
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
    for (const u of previousEligible) if (!out.has(u.id)) out.set(u.id, toPublicUser(u))
  }

  const verdicts: Record<string, 'ok' | 'failed'> = {}

  // 2. Self.
  let selfAuthorized = false
  const priorSelf = sameSession && previous.selfAuthorized ? previousById.get(scope.userId ?? '') : undefined
  if (reads.self.status === 'ok') {
    out.set(reads.self.value.id, reads.self.value)
    selfAuthorized = true
    verdicts['self profile'] = 'ok'
  } else if (reads.self.status === 'absent') {
    // Authoritative absence: the account has no readable private row. Remove the
    // PRIVATE state, and keep any public card this run successfully read — a
    // disabled account still has a safe name and avatar.
    if (scope.userId !== null) {
      const held = out.get(scope.userId)
      if (held?.kind === 'private') out.delete(scope.userId)
    }
    verdicts['self profile'] = 'ok'
  } else if (reads.self.status === 'failed') {
    verdicts['self profile'] = 'failed'
    // A same-session fallback is allowed, and it carries the failed verdict: the
    // account keeps its row so the settings page can show a failure with a retry
    // instead of silently reading as a public card. It is still AUTHORISED —
    // The self row belongs to this session, independently of its admin revision.
    if (priorSelf?.kind === 'private') {
      out.set(priorSelf.id, retainPrivate(priorSelf, freshCard(out, priorSelf.id)))
      selfAuthorized = true
    }
  } else {
    // Not requested. The previous verdict stands, and so does the previous
    // authorised row — this run has no evidence either way.
    if (priorSelf?.kind === 'private') {
      out.set(priorSelf.id, retainPrivate(priorSelf, freshCard(out, priorSelf.id)))
      selfAuthorized = true
    }
  }

  // 3. Admin batch.
  let adminRows: readonly PrivateUser[] = []
  // A read outcome can only ever ADD data, so a batch that came back is
  // installed whether or not the caller still holds the authority that asked for
  // it. Step 4 is the only place that decides what the current authority covers,
  // and it is what takes those rows away again on a loss.
  if (reads.admin.status === 'ok') {
    // The batch is the complete list. A previous private row the batch does not
    // return is gone: the read that saw everything did not see it.
    adminRows = reads.admin.value
  } else if (sameAuthority) {
    for (const u of previousEligible) {
      if (u.kind !== 'private' || u.id === scope.userId) continue
      out.set(u.id, retainPrivate(u, freshCard(out, u.id)))
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
  } else if (!scope.admin && previousEligible.some(u => u.kind === 'private' && u.id !== scope.userId)) {
    // Not re-read, and the caller holds no admin authority while the catalogue it
    // replaces still held other-account private rows: those rows were just taken
    // away, so the console's bulk read is no longer current. A caller who never
    // held admin authority gets no verdict at all.
    verdicts['admin profiles'] = 'failed'
  }
  // Not requested while still an admin: no verdict at all, so the previous one
  // stands. A public-only refresh must not certify or revoke the bulk read.

  // A run that did not read the public catalogue emits no verdict for it, so a
  // private-only refresh cannot turn a real public failure into a ready one.
  if (reads.public.requested) {
    verdicts.profiles = reads.public.failed ? 'failed' : 'ok'
  }

  // 4. Authority gate. Runs last, over the whole map, and it is the only place
  //    that decides what the current authority covers.
  for (const [id, user] of [...out]) {
    if (user.kind !== 'private') continue
    if (id === scope.userId) {
      if (!selfAuthorized) out.set(id, toPublicUser(user))
      continue
    }
    if (!scope.admin) out.set(id, toPublicUser(user))
  }

  return { users: [...out.values()], verdicts, selfAuthorized }
}

/** The fresh public card this run read for an id, if it read one. */
function freshCard(out: Map<ID, CachedUser>, id: ID): PublicUser | undefined {
  const held = out.get(id)
  return held?.kind === 'public' ? held : undefined
}
