import type { ReactNode } from 'react'

/** Stat tile (cr-tile). A null value is not a number: it shows "Unavailable". */
export function CrStatTile({
  icon,
  value,
  label,
  note,
  soft = false,
}: {
  icon?: ReactNode
  value: ReactNode | null
  label: ReactNode
  note?: ReactNode
  soft?: boolean
}) {
  return (
    <div className={soft ? 'cr-tile cr-tile--soft' : 'cr-tile'}>
      {icon && <span className="cr-tile__icon" aria-hidden="true">{icon}</span>}
      <div>
        {value === null ? (
          <div className="cr-tile__value cr-tile__value--none">Unavailable</div>
        ) : (
          <div className="cr-tile__value">{value}</div>
        )}
        <div className="cr-tile__label">{label}</div>
        {note && <div className="cr-tile__note">{note}</div>}
      </div>
    </div>
  )
}
