// ============ Shared page components: state block ============
// The block a page shows in place of content while it loads, when a read
// fails, or when there is nothing to show. The copy comes from the page, so
// each state says only what that page has read. Styles: the yf-state rules
// in src/styles.css.
//
// The compact size is for a block inside a workspace tab or a card (ruling
// R22). It keeps the same roles and kinds, and it has no dashed border.
import type { ReactNode } from 'react'

/** A kept note sits above rows on screen. It announces as a status, not an alert (#704). */
export type StateKind = 'loading' | 'failed' | 'empty' | 'kept'
/** The full block fills a page. The compact block sits inside a tab or a card. */
export type StateSize = 'full' | 'compact'

/** The ARIA role a state announces with. Loading and a kept note are a polite status. A failed read is an alert. An empty state stays silent. */
export function stateBlockRole(kind: StateKind): 'status' | 'alert' | undefined {
  if (kind === 'loading' || kind === 'kept') return 'status'
  if (kind === 'failed') return 'alert'
  return undefined
}

/** The class of the block root. The compact size adds its modifier. The full size keeps the base class alone. */
export function stateBlockRootClass(size: StateSize = 'full'): string {
  return size === 'compact' ? 'yf-state yf-state--compact' : 'yf-state'
}

/** True when the body has copy to show. An empty string, null, undefined or false shows no paragraph. */
export function stateBlockHasBody(body: ReactNode): boolean {
  return body !== undefined && body !== null && body !== false && body !== ''
}

export function StateBlock({ kind, art, icon, title, body, actions, titleLevel = 'h3', size = 'full' }: {
  kind: StateKind
  art?: ReactNode
  icon?: ReactNode
  title: string
  /** The copy under the title. A string, or a ReactNode when the copy needs inline markup such as a `<b>`. */
  body?: ReactNode
  actions?: ReactNode
  /** The heading level of the title. Use h2 on a page whose block sits right under the h1. */
  titleLevel?: 'h2' | 'h3'
  /** The size of the block. Use compact inside a workspace tab or a card. */
  size?: StateSize
}) {
  const role = stateBlockRole(kind)
  const isLoading = kind === 'loading'
  const TitleTag = titleLevel
  return (
    <div className={stateBlockRootClass(size)} data-kind={kind} role={role} aria-live={isLoading ? 'polite' : undefined}>
      {art && <div className="yf-state-art">{art}</div>}
      {icon && <div className="yf-state-icon">{icon}</div>}
      <TitleTag className="yf-state-title">{title}</TitleTag>
      {stateBlockHasBody(body) && <p className="yf-state-body">{body}</p>}
      {actions && <div className="yf-state-actions">{actions}</div>}
    </div>
  )
}
