// ============ Explore — loading, failed and empty states ============
// One block for every state the grid can show in place of cards. The copy comes
// from the page, so each state says only what that page has read. The markup
// lives in the shared StateBlock; this wrapper keeps Explore's call sites short.
import type { ReactNode } from 'react'
import { StateBlock, type StateKind } from '../page/StateBlock'

export function ExploreStateBlock({ kind = 'empty', art, icon, title, body, actions }: {
  kind?: StateKind
  /** The page-level vignette. The icon stays as its loading and error floor. */
  art?: ReactNode
  icon?: ReactNode
  title: string
  body?: string
  actions?: ReactNode
}) {
  return <StateBlock kind={kind} art={art} icon={icon} title={title} body={body} actions={actions} />
}
