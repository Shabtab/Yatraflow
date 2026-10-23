import { Calendar, Clock, Route, Users, Wallet } from 'lucide-react'
import { modeIcon } from './icons'
import type { ReactNode } from 'react'
import type { TransportMode } from '../data/types'
import type { CreateStep } from '../lib/createSteps'

export interface CreateFlowTicketProps {
  title: string
  route: string
  dates: string
  departure: string
  mode: TransportMode
  travel: string
  fuel: string
  party: string
  budget: string
  total: number | null
  perHead: number | null
  failed: boolean
  review: boolean
  onChange: (step: CreateStep) => void
}

export function CreateFlowTicket(p: CreateFlowTicketProps) {
  const rows: { step: CreateStep; icon: ReactNode; label: string; value: string }[] = [
    { step: 'where', icon: <Route size={16} />, label: 'Route', value: p.route },
    { step: 'when', icon: <Calendar size={16} />, label: 'Dates', value: p.dates },
    { step: 'when', icon: <Clock size={16} />, label: 'Departure time', value: p.departure || '08:30 by default' },
    { step: 'how', icon: modeIcon(p.mode, 16), label: p.travel, value: p.fuel || p.travel },
    { step: 'who', icon: <Users size={16} />, label: 'Party', value: p.party },
    { step: 'budget', icon: <Wallet size={16} />, label: 'Budget', value: p.budget },
  ]
  return <div className="gcf-ticket">
    <div className="gcf-ticket-head"><b>YatraFlow</b><span>Trip ticket</span></div>
    <svg className="gcf-ticket-art" viewBox="0 0 320 76" preserveAspectRatio="none" aria-hidden="true">
      <rect width="320" height="76" fill="var(--teal-soft)" />
      <path d="M0 55 Q45 27 90 48 T180 48 T320 34 V76 H0Z" fill="var(--teal)" opacity=".35" />
      <circle cx="260" cy="23" r="13" fill="var(--saffron)" />
      <path d="M0 66 Q70 49 150 64 T320 58 V76 H0Z" fill="var(--teal)" opacity=".65" />
    </svg>
    <div className="gcf-ticket-body">
      <h3>{p.title}</h3>
      <svg className="gcf-route-line" viewBox="0 0 280 32" aria-hidden="true"><path d="M8 16H272" stroke="currentColor" strokeWidth="2" /><circle cx="8" cy="16" r="5" fill="currentColor" /><circle cx="140" cy="16" r="5" fill="var(--card)" stroke="currentColor" strokeWidth="2" /><circle cx="272" cy="16" r="5" fill="var(--saffron)" /></svg>
      <dl className="gcf-ticket-rows">{rows.map((row, i) => <div className="gcf-ticket-row" key={i}>
        <span className="gcf-ticket-icon" aria-hidden>{row.icon}</span>
        <div><dt>{row.label}</dt><dd>{row.value}</dd></div>
        {p.review && <button type="button" onClick={() => p.onChange(row.step)}>Change<span className="sr-only"> {row.label}</span></button>}
      </div>)}</dl>
    </div>
    <div className="gcf-ticket-bill" role="status">
      {p.failed ? <><b>Trip not created yet</b><p>Your answers are still here. Try again.</p></> : p.perHead != null && p.total != null ? <>
        <div className="gcf-ticket-total"><span>Total for {p.party}</span><b>₹{Math.round(p.total).toLocaleString('en-IN')}</b></div>
        <p className="gcf-ticket-price">₹{Math.round(p.perHead).toLocaleString('en-IN')} <span>per person</span></p>
        <p>An estimate for planning. It is not a booking.</p>
      </> : <><b>Not priced yet</b><p>Add dates and a mapped stop to see the bill.</p></>}
    </div>
  </div>
}
