const GLYPH = new Map([
  ['up', '▲'],
  ['down', '▼'],
  ['flat', '–'],
] as const)

/** Change marker (cr-delta). The direction is shown by the glyph and the
 *  signed text, never by colour alone. The screen reader hears "up 3" or
 *  "down 2" once, so the aria-hidden glyph and signed text are not read. */
export function CrDelta({ value, unit }: { value: number; unit?: string }) {
  // A missing change is not zero: show no marker rather than a placeholder.
  if (!Number.isFinite(value)) return null

  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat'
  const amount = Math.abs(value)
  const suffix = unit ? ` ${unit}` : ''
  // The signed text uses the true minus sign (U+2212), not a hyphen.
  const signed = dir === 'up' ? `+${amount}` : dir === 'down' ? `−${amount}` : '0'
  const spoken = dir === 'flat' ? 'no change' : `${dir} ${amount}${suffix}`

  return (
    <span className={`cr-delta cr-delta--${dir}`}>
      <span aria-hidden="true">{GLYPH.get(dir)}</span>
      <span aria-hidden="true">{`${signed}${suffix}`}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  )
}
