// ============ Explore — loading, failed and empty states ============
// One block for every state the grid can show in place of cards. The copy comes
// from the page, so each state says only what that page has read.
import type { ReactNode } from 'react'

export function ExploreStateBlock({ icon, title, body, actions }: {
  icon?: ReactNode
  title: string
  body?: string
  actions?: ReactNode
}) {
  return (
    <div className="ex-state">
      {icon && <div className="ex-state-icon">{icon}</div>}
      <h3 className="ex-state-title">{title}</h3>
      {body && <p className="ex-state-body">{body}</p>}
      {actions && <div className="ex-state-actions">{actions}</div>}
    </div>
  )
}
