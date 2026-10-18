// ============ Date-of-birth picker (signup) ============
// Sign-up asks for a date of birth, where the year is the part that matters
// most. This control offers direct Year, Month and Day selects, so a birth year
// is one choice away.
//
// It keeps the 'YYYY-MM-DD' value that lib/ageGate reads. It blocks a future
// date. It clamps a 31st or a Feb-29 to the month. It stays reachable by
// keyboard and screen reader. Only the sign-up DOB field uses it.
import { useEffect, useMemo, useRef, useState, type Ref } from 'react'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The lower bound of the year list. This is an arbitrary entry limit, not an
 *  age rule — the 18+ minimum stays in lib/ageGate. It is wide enough for any
 *  realistic applicant; a birth year older than this is not offered. */
const YEAR_SPAN = 120

/** Last day of a 1-based month (day 0 of the next month is this month's end).
 *  Handles Feb 28/29 and every 30/31 boundary. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/** 'YYYY-MM-DD' from parts, or '' when any part is missing — a partial pick is
 *  never assembled into a complete-looking date. */
export function composeDob(y: number, mo: number, d: number): string {
  if (!y || !mo || !d) return ''
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Parse a 'YYYY-MM-DD' value into parts, or null when absent or the wrong
 *  shape. Calendar validity is ageGate's job, not this parser's. */
export function parseDob(value: string): { y: number; mo: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '')
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null
}

/** The largest month offered for a year, capped at `max` (today) so a future
 *  month is never selectable. */
export function monthCeiling(y: number, max: string): number {
  const maxY = Number(max.slice(0, 4))
  const maxMo = Number(max.slice(5, 7))
  return y === maxY ? maxMo : 12
}

/** The largest day offered for a year/month, capped at `max` (today) so no
 *  future date is selectable. `max` is 'YYYY-MM-DD' in the SAME local
 *  convention the age checks use. */
export function dayCeiling(y: number, mo: number, max: string): number {
  const maxY = Number(max.slice(0, 4))
  const maxMo = Number(max.slice(5, 7))
  const maxD = Number(max.slice(8, 10))
  let c = y && mo ? daysInMonth(y, mo) : 31
  if (y === maxY && mo === maxMo) c = Math.min(maxD, c)
  return c
}

/** Clamp the year, month and day TOGETHER against the future boundary and the
 *  real month length. The month clamps first, so a month the picker no longer
 *  offers can never stay held in state (that produced a future date with a
 *  blank month select). */
export function clampParts(y: number, mo: number, d: number, max: string): { y: number; mo: number; d: number } {
  const cmo = Math.min(mo, monthCeiling(y, max))
  const cd = Math.min(d, dayCeiling(y, cmo, max))
  return { y, mo: cmo, d: cd }
}

/** The value a Year/Month/Day pick commits: the parts clamped together, or ''
 *  while any part is missing. This is the single source of truth the selects
 *  commit through. */
export function resolveDob(y: number, mo: number, d: number, max: string): string {
  if (!y || !mo || !d) return ''
  const p = clampParts(y, mo, d, max)
  return composeDob(p.y, p.mo, p.d)
}

interface Props {
  value: string
  onChange: (v: string) => void
  /** Inclusive upper bound 'YYYY-MM-DD' (today, local) — no future dates. */
  max: string
  /** Injected by <Field>: id lands on the year select (so the "Date of birth"
   *  label focuses it); describedby + invalid go on all three. */
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
  /** A ref the page focuses when the field fails (mirrors the old input ref). */
  focusRef?: Ref<HTMLSelectElement>
}

export function DobPicker({ value, onChange, max, id, 'aria-describedby': describedBy, 'aria-invalid': invalid, focusRef }: Props) {
  const maxY = Number(max.slice(0, 4))
  const minY = maxY - YEAR_SPAN
  const parsed = useMemo(() => parseDob(value), [value])
  const [y, setY] = useState(parsed?.y ?? 0)
  const [mo, setMo] = useState(parsed?.mo ?? 0)
  const [d, setD] = useState(parsed?.d ?? 0)
  // Sync FROM the page value only when it actually changes externally (a reset
  // or autofill). A partial local pick leaves `value` at '' — without this guard
  // the effect would wipe the year the user just chose.
  const seen = useRef(value)
  // The draft parts follow the page value. React's own guidance covers this as
  // adjusting state after a prop change. The effect stays so an external reset
  // is observed. It is suppressed with this reason, not restructured.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (seen.current === value) return
    seen.current = value
    if (parsed) { setY(parsed.y); setMo(parsed.mo); setD(parsed.d) }
    else { setY(0); setMo(0); setD(0) }
  }, [value, parsed])
  /* eslint-enable react-hooks/set-state-in-effect */

  const years = useMemo(() => {
    const a: number[] = []
    for (let yy = maxY; yy >= minY; yy--) a.push(yy)
    return a
  }, [maxY, minY])

  const moCeiling = monthCeiling(y, max)
  const dCeiling = dayCeiling(y, mo, max)

  // Clamp and store the parts together, so the visible selects always match the
  // emitted value — a hidden month or an over-long day never survives.
  function pick(ny: number, nmo: number, nd: number) {
    const p = clampParts(ny, nmo, nd, max)
    setY(p.y); setMo(p.mo); setD(p.d)
    onChange(composeDob(p.y, p.mo, p.d))
  }

  const inv = invalid || undefined
  return (
    <div className="dob-picker" role="group" aria-label="Date of birth">
      <select ref={focusRef} id={id} className="select" aria-label="Birth year"
        aria-describedby={describedBy} aria-invalid={inv} autoComplete="bday-year"
        value={y || ''} onChange={e => pick(Number(e.target.value) || 0, mo, d)}>
        <option value="">Year</option>
        {years.map(yy => <option key={yy} value={yy}>{yy}</option>)}
      </select>
      <select className="select" aria-label="Birth month"
        aria-describedby={describedBy} aria-invalid={inv} autoComplete="bday-month"
        value={mo || ''} onChange={e => pick(y, Number(e.target.value) || 0, d)}>
        <option value="">Month</option>
        {MONTHS.map((mn, i) => { const v = i + 1; return v <= moCeiling ? <option key={v} value={v}>{mn}</option> : null })}
      </select>
      <select className="select" aria-label="Birth day"
        aria-describedby={describedBy} aria-invalid={inv} autoComplete="bday-day"
        value={d && d <= dCeiling ? d : ''} onChange={e => pick(y, mo, Number(e.target.value) || 0)}>
        <option value="">Day</option>
        {Array.from({ length: dCeiling }, (_, i) => i + 1).map(dd => <option key={dd} value={dd}>{dd}</option>)}
      </select>
    </div>
  )
}
