//
// Every public shape of a cached identity is built here: the offline snapshot, the
// authority downgrade, the private-to-public mutation conversion and the public
// fallback card.
import type { CachedUser, PublicUser, PublicUserProfile } from '../data/types'

/** The reviewed nested social-links allowlist, rebuilt from an untrusted value.
 *  Only `youtube` and `instagram` survive, and only as non-empty strings. This is
 *  the client-side twin of `public.safe_social_links`, and it exists because a
 *  cached value is untrusted input: whatever the database rebuilt, a device may
 *  still hold an older object with extra keys. */
export function reviewedSocialLinks(value: unknown): PublicUserProfile['socialLinks'] {
  if (!value || typeof value !== 'object') return undefined
  const src = value as Record<string, unknown>
  const out: NonNullable<PublicUserProfile['socialLinks']> = {}
  for (const key of ['youtube', 'instagram'] as const) {
    const v = src[key]
    if (typeof v === 'string' && v.trim() !== '') out[key] = v
  }
  return Object.keys(out).length ? out : undefined
}

/** The reviewed public identity of a cached entry. A private entry is not
 *  dropped: it still has a public identity, and the offline directory needs it.
 *  What is dropped is the private DATA, by taking only the public shape and
 *  rebuilding the nested object from the allowlist. */
export function toPublicUser(user: CachedUser): PublicUser {
  return {
    id: user.id,
    kind: 'public',
    profile: {
      name: user.profile.name,
      avatarUrl: user.profile.avatarUrl,
      isCreator: user.profile.isCreator,
      creatorBio: user.profile.creatorBio,
      socialLinks: reviewedSocialLinks(user.profile.socialLinks),
      creatorAvailable: user.profile.creatorAvailable,
    },
  }
}
