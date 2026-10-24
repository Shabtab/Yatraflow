import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fmtDay, isoDay } from './DateRangeCalendar'

/** The guided flow keeps the dates in view while the traveller selects a range. */
export function CreateFlowCalendar({ start, end, error, registerRef, onChange }: {
  start: string
  end: string
  error?: string
  registerRef: (el: HTMLButtonElement | null) => void
  onChange: (next: { startDate: string; endDate: string }) => void
}) {
  const [month, setMonth] = useState(() => {
    const date = start ? new Date(`${start}T12:00:00`) : new Date()
    return new Date(date.getFullYear(), date.getMonth(), 1)
  })
  const [hover, setHover] = useState('')
  const preview = end || (hover > start ? hover : '')
  return (
    <div className="gcf-dates">
      <div className="gcf-date-label"><b>Dates</b><span>{start && end ? `${fmtDay(start)} to ${fmtDay(end)}` : 'Pick the first and last day'}</span></div>
      <div className="gcf-calendar" role="group" aria-label="Trip dates" aria-describedby={error ? 'gcf-date-error' : undefined}>
        {[0, 1].map(offset => {
          const date = new Date(month.getFullYear(), month.getMonth() + offset, 1)
          const count = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
          return <div className="gcf-month" key={offset}>
            <div className="gcf-month-head">
              {offset === 0 && <button type="button" ref={registerRef} aria-label="Previous month" onClick={() => { setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)) }}><ChevronLeft size={18} aria-hidden /></button>}
              <b>{date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</b>
              <button type="button" className="gcf-month-next" aria-label={offset === 0 ? 'Next month' : 'Show later months'} onClick={() => { setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)) }}><ChevronRight size={18} aria-hidden /></button>
            </div>
            <div className="gcf-day-grid">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`w${index}`} aria-hidden>{day}</span>)}
              {Array.from({ length: date.getDay() }, (_, index) => <span key={`p${index}`} />)}
              {Array.from({ length: count }, (_, index) => {
                const iso = isoDay(new Date(date.getFullYear(), date.getMonth(), index + 1))
                const edge = iso === start || iso === end
                return <button type="button" key={iso} aria-label={iso} aria-pressed={edge}
                  className={`${edge ? 'edge' : ''}${start && preview && iso > start && iso < preview ? ' in-range' : ''}`}
                  onMouseEnter={() => { setHover(iso) }} onMouseLeave={() => { setHover('') }}
                  onClick={() => { onChange(!start || end || iso < start ? { startDate: iso, endDate: '' } : { startDate: start, endDate: iso }) }}>{index + 1}</button>
              })}
            </div>
          </div>
        })}
      </div>
      {error && <p id="gcf-date-error" className="err-text" role="status">{error}</p>}
      <p className="hint-text">{start && !end ? 'Now pick the last day of the trip.' : 'Pick a start day, then an end day.'}</p>
    </div>
  )
}
