// ============ APK update React bindings ============
// Two hooks, so no component invents its own notice rule. The core documents
// the contract; `nextNoticeOffer` applies it, and the hook just holds the
// result. That split keeps the rule testable in the node environment, with no
// DOM and no React renderer.

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { UpdateManifest, UpdateState } from './apkUpdates'
import { apkUpdateStatus, subscribeApkUpdate, type UpdateRuntimeStatus } from './apkUpdateRuntime'

/** The runtime's status, re-rendered on every change. */
export function useApkUpdateStatus(): UpdateRuntimeStatus {
  return useSyncExternalStore(subscribeApkUpdate, apkUpdateStatus)
}

/**
 * The notice decision, as one pure step.
 *
 * The contract comes from the core:
 *   - offer on `newer` only — that is the one eligible phase;
 *   - keep what is already offered while a re-check runs, so the notice does
 *     not flicker away and back;
 *   - clear on every other phase, `suppressed` included. That phase carries a
 *     manifest too, so manifest presence alone is not a signal to show it.
 */
export function nextNoticeOffer(
  previous: UpdateManifest | null,
  state: UpdateState,
): UpdateManifest | null {
  if (state.phase === 'newer' && state.manifest) return state.manifest
  if (state.phase === 'checking') return previous
  return null
}

/** The release a notice may offer, or null when none may be shown. */
export function useUpdateNotice(): UpdateManifest | null {
  const { state } = useApkUpdateStatus()
  const [offer, setOffer] = useState<UpdateManifest | null>(null)

  useEffect(() => {
    setOffer(previous => nextNoticeOffer(previous, state))
  }, [state])

  return offer
}
