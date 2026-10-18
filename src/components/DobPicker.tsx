// ============ Date-of-birth picker (signup) ============
// The Android WebView date picker has no year jump. It steps back one month per
// tap, so a birth year takes hundreds of taps. This control uses three native
// selects — Year, Month and Day — so the year is one choice away.
//
// It keeps the 'YYYY-MM-DD' value that lib/ageGate reads. It blocks a future
// date. It clamps a 31st or a Feb-29 to the month. It stays reachable by
// keyboard and screen reader. Only the sign-up DOB field uses it.
import { useEffect, useMemo, useRef, useState, type Ref } from 'react'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** An entry bound for the year list — roughly the oldest verified human
 *  lifespan — NOT the signup age gate, which stays 18 in lib/ageGate. Kept
 *  generous so the control itself never screens out a real applicant. */
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

/** Parse a 'YYYY-MM-DD' value into parts, or null when absent/malformed. */
export function parseDob(value: string): { y: number; mo: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '')
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null
}

/** The largest day selectable for a year/month, capped at `max` (today) so no
 *  future date is offered. `max` is 'YYYY-MM-DD' in the SAME local convention
 *  the age checks use. */
export function dayCeiling(y: number, mo: number, max: string): number {
  const maxY = Number(max.slice(0, 4))
  const maxMo = Number(max.slice(5, 7))
  const maxD = Number(max.slice(8, 10))
  let c = y && mo ? daysInMonth(y, mo) : 31
  if (y === maxY && mo === maxMo) c = Math.min(maxD, c)
  return c
}

/** The value a Year/Month/Day pick produces: the day clamped to the month (so a
 *  31st or a Feb-29 never rolls into the next month), and '' while any part is
 *  missing. This is the single source of truth the selects commit through. */
export function resolveDob(y: number, mo: number, d: number, max: string): string {
  return composeDob(y, mo, Math.min(d, dayCeiling(y, mo, max)))
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
  const maxMo = Number(max.slice(5, 7))
  const minY = maxY - YEAR_SPAN
  const parsed = useMemo(() => parseDob(value), [value])
  const [y, setY] = useState(parsed?.y ?? 0)
  const [mo, setMo] = useState(parsed?.mo ?? 0)
  const [d, setD] = useState(parsed?.d ?? 0)
  // Sync FROM the page value only when it actually changes externally (a reset
  // or autofill). A partial local pick leaves `value` at '' — without this guard
  // the effect would wipe the year the user just chose.
  const seen = useRef(value)
  useEffect(() => {
    if (seen.current === value) return
    seen.current = value
    if (parsed) { setY(parsed.y); setMo(parsed.mo); setD(parsed.d) }
    else { setY(0); setMo(0); setD(0) }
  }, [value, parsed])

  const years = useMemo(() => {
    const a: number[] = []
    for (let yy = maxY; yy >= minY; yy--) a.push(yy)
    return a
  }, [maxY, minY])

  const monthCeiling = y === maxY ? maxMo : 12
  const dCeiling = dayCeiling(y, mo, max)

  function commit(ny: number, nmo: number, nd: number) {
    onChange(resolveDob(ny, nmo, nd, max)) // clamp — never roll over
  }

  const inv = invalid || undefined
  return (
    <div className="dob-picker" role="group" aria-label="Date of birth">
      <select ref={focusRef} id={id} className="select" aria-label="Birth year"
        aria-describedby={describedBy} aria-invalid={inv} autoComplete="bday-year"
        value={y || ''} onChange={e => { const ny = Number(e.target.value) || 0; setY(ny); commit(ny, mo, d) }}>
        <option value="">Year</option>
        {years.map(yy => <option key={yy} value={yy}>{yy}</option>)}
      </select>
      <select className="select" aria-label="Birth month"
        aria-describedby={describedBy} aria-invalid={inv} autoComplete="bday-month"
        value={mo || ''} onChange={e => { const nmo = Number(e.target.value) || 0; setMo(nmo); commit(y, nmo, d) }}>
        <option value="">Month</option>
        {MONTHS.map((mn, i) => { const v = i + 1; return v <= monthCeiling ? <option key={v} value={v}>{mn}</option> : null })}
      </select>
      <select className="select" aria-label="Birth day"
        aria-describedby={describedBy} aria-invalid={inv} autoComplete="bday-day"
        value={d && d <= dCeiling ? d : ''} onChange={e => { const nd = Number(e.target.value) || 0; setD(nd); commit(y, mo, nd) }}>
        <option value="">Day</option>
        {Array.from({ length: dCeiling }, (_, i) => i + 1).map(dd => <option key={dd} value={dd}>{dd}</option>)}
      </select>
    </div>
  )
}
