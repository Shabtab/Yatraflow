// ============ Shared page components: state block ============
// The block a page shows in place of content while it loads, when a read
// fails, or when there is nothing to show. The copy comes from the page, so
// each state says only what that page has read. Styles: the yf-state rules
// in src/styles.css.
import type { ReactNode } from 'react'

export type StateKind = 'loading' | 'failed' | 'empty'

/** The ARIA role a state announces with. Loading is a polite status, a failed read is an alert, and an empty state stays silent. */
export function stateBlockRole(kind: StateKind): 'status' | 'alert' | undefined {
  if (kind === 'loading') return 'status'
  if (kind === 'failed') return 'alert'
  return undefined
}

export function StateBlock({ kind, art, icon, title, body, actions, titleLevel = 'h3' }: {
  kind: StateKind
  art?: ReactNode
  icon?: ReactNode
  title: string
  body?: string
  actions?: ReactNode
  /** The heading level of the title. Use h2 on a page whose block sits right under the h1. */
  titleLevel?: 'h2' | 'h3'
}) {
  const role = stateBlockRole(kind)
  const isLoading = kind === 'loading'
  const TitleTag = titleLevel
  return (
    <div className="yf-state" data-kind={kind} role={role} aria-live={isLoading ? 'polite' : undefined}>
      {art && <div className="yf-state-art">{art}</div>}
      {icon && <div className="yf-state-icon">{icon}</div>}
      <TitleTag className="yf-state-title">{title}</TitleTag>
      {body && <p className="yf-state-body">{body}</p>}
      {actions && <div className="yf-state-actions">{actions}</div>}
    </div>
  )
}
