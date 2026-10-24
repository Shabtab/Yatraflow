// ============ Collab outcome feedback ============
//
// One mapping from a #832 stage-A receipt outcome to what the user sees.
// Every caller of a contribution writer routes its outcome through here, so
// "no optimistic success" is enforced in one place: a refused write never
// shows a success toast, and a conflict says the local work was kept.
import { toast } from '../components/ui'
import type { CollabOutcome } from '../store/collabCommand'

/** Show the outcome. `successMessage` (when given) shows only on an applied
 *  or alreadyApplied receipt — never before, never on a failure. */
export function reportCollabOutcome(outcome: CollabOutcome, successMessage?: string): void {
  switch (outcome.status) {
    case 'applied':
    case 'alreadyApplied':
      if (successMessage) toast(successMessage)
      return
    case 'conflict':
      toast('A crew update conflicts with this change. Your input is kept; the latest version is loading.', 'err')
      return
    case 'invalid':
      toast(outcome.reason
        ? `That change was not accepted: ${outcome.reason}.`
        : 'That change was not accepted here.', 'err')
      return
    case 'forbidden':
      toast('You need editor access to do that.', 'err')
      return
    case 'unavailable':
      toast('Could not reach the server. Your change was not saved — try again.', 'err')
      return
  }
}
