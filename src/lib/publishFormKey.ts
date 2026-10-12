// ============ The publish form's identity and mount (#704) ============
// The publish form reads its fields once, when it mounts. Its key names the
// publication those fields were read from. A new key remounts the form with
// that publication's values. `new` stands for "no publication yet".
import type { PublishedItinerary } from '../data/types'
import type { ReadState } from './readState'

export function publishFormKey(
  pub: Pick<PublishedItinerary, 'id' | 'publishedAt' | 'refreshedAt'> | undefined,
): string {
  if (!pub) return 'new'
  return `${pub.id}:${pub.refreshedAt ?? pub.publishedAt}`
}

/** Whether the publish form is mounted now, and the key it was last shown with.
 *
 *  The first showing waits for a read that succeeded. Once shown, the form stays
 *  shown for the same key while a later read is pending or failed, so the user's
 *  edits survive a refresh. Only a different key remounts it, and that key waits
 *  for a read that succeeded too. */
export function publishFormMount(input: {
  read: ReadState
  formKey: string
  shownKey: string | null
}): { mounted: boolean; shownKey: string | null } {
  if (input.read === 'ready') return { mounted: true, shownKey: input.formKey }
  if (input.shownKey === input.formKey) return { mounted: true, shownKey: input.formKey }
  return { mounted: false, shownKey: null }
}
