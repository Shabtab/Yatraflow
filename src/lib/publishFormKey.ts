// ============ The publish form's identity (#704) ============
// The publish form reads its fields once, when it mounts. Its key names the
// publication those fields were read from. A new key remounts the form with
// that publication's values. `new` stands for "no publication yet".
import type { PublishedItinerary } from '../data/types'

export function publishFormKey(
  pub: Pick<PublishedItinerary, 'id' | 'publishedAt' | 'refreshedAt'> | undefined,
): string {
  if (!pub) return 'new'
  return `${pub.id}:${pub.refreshedAt ?? pub.publishedAt}`
}
