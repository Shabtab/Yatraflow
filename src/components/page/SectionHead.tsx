// ============ Shared page components: section head ============
// The heading row above a section of a page, with optional actions on the right.
// It reuses the mt-section-head and mt-section-title classes, so no new CSS is needed.
import type { ReactNode } from 'react'

export function SectionHead({ title, actions, as = 'h2', id }: {
  title: ReactNode
  actions?: ReactNode
  as?: 'h2' | 'h3'
  id?: string
}) {
  const Heading = as
  return (
    <div className="mt-section-head">
      <Heading className="mt-section-title" id={id}>{title}</Heading>
      {actions && <div className="mt-head-actions">{actions}</div>}
    </div>
  )
}
