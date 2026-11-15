import type { ReactNode } from 'react'

type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4'

/** Section head row (cr-head). The note and actions sit on the right at
 *  desktop width and under the title at phone width. */
export function CrSectionHead({
  kicker,
  title,
  as: Tag = 'h2',
  id,
  note,
  actions,
}: {
  kicker?: ReactNode
  title: ReactNode
  as?: HeadingLevel
  id?: string
  note?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="cr-head">
      <div>
        {kicker && <p className="cr-head__kicker">{kicker}</p>}
        <Tag id={id} className="cr-head__title">{title}</Tag>
      </div>
      {(note || actions) && (
        <div>
          {note && <p className="cr-head__note">{note}</p>}
          {actions}
        </div>
      )}
    </div>
  )
}
