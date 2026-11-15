import type { CSSProperties, ReactNode } from 'react'

/** Fill colour per row. Each name maps to one token in the CSS:
 *  route → --pw-route, lagoon → --pw-lagoon-400,
 *  lagoon-deep → --pw-lagoon-600, marigold → --pw-marigold-ink. */
export type MeterTone = 'route' | 'lagoon' | 'lagoon-deep' | 'marigold'

/** Meter row (cr-meter). The bar is decorative: the shown value carries the
 *  information, so the track is hidden from the screen reader. The bar is
 *  clamped to 0-100; the shown value is printed exactly as given. */
export function CrMeterRow({
  label,
  value,
  pct,
  note,
  tone,
}: {
  label: ReactNode
  value: ReactNode
  pct: number
  note?: ReactNode
  tone: MeterTone
}) {
  const bar = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0
  return (
    <div className="cr-meter">
      <div className="cr-meter__label">{label}</div>
      <div className="cr-meter__track" aria-hidden="true">
        <div
          className="cr-meter__fill"
          data-tone={tone}
          style={{ '--pct': bar } as CSSProperties}
        />
      </div>
      <div className="cr-meter__value">{value}</div>
      {note && <div className="cr-tile__note">{note}</div>}
    </div>
  )
}
