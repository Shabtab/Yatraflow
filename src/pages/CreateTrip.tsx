// ============ Create trip ============
import { useRef, useState } from 'react'
import type { FixedCommitment, LatLngPoint, TransportMode, TravelStyle } from '../data/types'
import { TRANSPORT_MODES, TRAVEL_STYLES } from '../data/types'
import { useDb, currentUser, createTrip } from '../store/store'
import { FUEL_PRICE_INR_PER_L, isFuelEconomyMode, parseFuelEconomyKmL, parseFuelPricePerL, isImplausibleFuelEconomy } from '../lib/engine'
import { Field, Chip, toast } from '../components/ui'
import { useTimeFormat, formatHM } from '../lib/timefmt'
import { LocationInput } from '../components/LocationInput'
import type { PlaceHit } from '../components/LocationInput'

interface CommitDraft {
  title: string
  type: FixedCommitment['type']
  dayIndex: number
  time: string
}

/** A destination picked (or typed) for the route. */
interface DestDraft {
  name: string
  lat?: number
  lng?: number
}

export function CreateTripPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const timeFormat = useTimeFormat()

  const [f, setF] = useState({
    name: '', startLocation: '',
    startDate: '', endDate: '', travellers: 2,
    transportMode: 'car' as TransportMode,
    fuelEconomy: '',
    fuelPrice: '',
    roundTrip: true,
    budgetPerPersonInr: 15000,
    travelStyle: 'balanced' as TravelStyle,
    coverEmoji: '🧭',
  })
  const [dests, setDests] = useState<DestDraft[]>([])
  const [destInput, setDestInput] = useState('')
  const [startCoords, setStartCoords] = useState<LatLngPoint | null>(null)
  const [commitments, setCommitments] = useState<CommitDraft[]>([])
  const [c, setC] = useState<CommitDraft>({ title: '', type: 'hotel-checkin', dayIndex: 0, time: '14:00' })
  const [errs, setErrs] = useState<Record<string, string>>({})
  /** first-invalid focus targets (F-15) — plain inputs only register here */
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({})

  function addDest(d: DestDraft) {
    const name = d.name.trim()
    if (!name) return
    if (dests.some(x => x.name.toLowerCase() === name.toLowerCase())) {
      toast('That destination is already on the route.', 'err'); return
    }
    setDests(list => [...list, d])
    setDestInput('')
  }
  function removeDest(i: number) { setDests(list => list.filter((_, j) => j !== i)) }
  function moveDest(i: number, dir: -1 | 1) {
    setDests(list => {
      const j = i + dir
      if (j < 0 || j >= list.length) return list
      const copy = [...list]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })
  }

  const dayCount = f.startDate && f.endDate ? Math.round((new Date(f.endDate).getTime() - new Date(f.startDate).getTime()) / 86400000) + 1 : 0

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!me) return
    const next: Record<string, string> = {}
    if (!f.name.trim()) next.name = 'Name your trip.'
    if (!f.startLocation.trim()) next.startLocation = 'Where does the journey start?'
    if (dests.length === 0) next.destinations = 'Add at least one destination.'
    if (!f.startDate) next.startDate = 'Pick a start date.'
    if (!f.endDate) next.endDate = 'Pick an end date.'
    else if (f.startDate && new Date(f.endDate) < new Date(f.startDate)) next.endDate = 'End date must be after the start date.'
    if (f.travellers < 1) next.travellers = 'At least one traveller!'
    if (f.budgetPerPersonInr <= 0) next.budgetPerPersonInr = 'Give a per-person budget in ₹.'
    setErrs(next)
    if (Object.keys(next).length) {
      // F-15: move focus to the first invalid field so keyboard / screen-reader
      // users don't have to hunt for what failed (the Field error span carries
      // role="alert", so the message itself is announced on arrival). Fields
      // rendered through LocationInput don't register a ref — the first
      // focusable invalid input wins in that case.
      const first = Object.keys(next).find(k => fieldRefs.current[k])
      if (first) fieldRefs.current[first]!.focus()
      return
    }

    const trip = createTrip(me.id, {
      name: f.name.trim(),
      startLocation: f.startLocation.trim(),
      startLocationCoords: startCoords ?? undefined,
      destinations: dests.map(d => d.name),
      destinationCoords: dests.map(d => (d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : null)),
      startDate: f.startDate, endDate: f.endDate,
      travellers: f.travellers,
      transportMode: f.transportMode,
      fuelEconomyKmL: isFuelEconomyMode(f.transportMode) ? parseFuelEconomyKmL(f.fuelEconomy) : undefined,
      fuelPricePerL: isFuelEconomyMode(f.transportMode) ? parseFuelPricePerL(f.fuelPrice) : undefined,
      roundTrip: isFuelEconomyMode(f.transportMode) ? f.roundTrip : undefined,
      budgetPerPersonInr: f.budgetPerPersonInr,
      travelStyle: f.travelStyle,
      fixedCommitments: commitments.filter(x => x.title.trim()),
      coverEmoji: f.coverEmoji,
    })
    toast('Trip created — add your first stop! 🎉')
    onNavigate(`/trip/${trip.id}`)
  }

  function addCommitment() {
    if (!c.title.trim()) { toast('Name the commitment first (e.g. "Train 12626").', 'err'); return }
    if (!dayCount || c.dayIndex >= dayCount) { toast('Pick a day within the trip dates.', 'err'); return }
    setCommitments(list => [...list, { ...c, title: c.title.trim() }])
    setC({ title: '', type: 'hotel-checkin', dayIndex: 0, time: '14:00' })
  }

  return (
    <div className="container form-page">
      <h1>Plan a new trip</h1>
      <p className="muted small" style={{ marginBottom: 20 }}>
        You can change all of this later. The more you tell us, the sharper the schedule warnings.
      </p>

      <form onSubmit={submit}>
        <div className="two-col" style={{ alignItems: 'start' }}>
          <div className="card">
            <h3>The basics</h3>
            <hr className="divider" />
            <Field label="Trip name" error={errs.name}>
              <input className="input" autoComplete="off" ref={el => (fieldRefs.current.name = el)} aria-invalid={!!errs.name} value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} placeholder="e.g. Kerala monsoon escape" />
            </Field>
            <div className="form-row">
              <Field label="Starting location" error={errs.startLocation}>
                <LocationInput
                  value={f.startLocation}
                  onChange={v => setF(x => ({ ...x, startLocation: v }))}
                  onPick={p => setStartCoords({ lat: p.latitude, lng: p.longitude })}
                  placeholder="Search a city, e.g. Kochi"
                />
              </Field>
            </div>
            <Field label={`Destinations${dests.length ? ` (${dests.length})` : ''}`} hint="Search and add in travel order — drag-free reorder with the arrows" error={errs.destinations}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <LocationInput
                    value={destInput}
                    onChange={setDestInput}
                    onPick={p => addDest({ name: p.name + (p.admin1 ? `, ${p.admin1}` : ''), lat: p.latitude, lng: p.longitude })}
                    placeholder={dests.length === 0 ? 'Search your first stop, e.g. Munnar' : 'Add another destination…'}
                  />
                </div>
              </div>
              {dests.length > 0 && (
                <div className="dest-chips">
                  {dests.map((d, i) => (
                    <span key={`${d.name}-${i}`} className="dest-chip">
                      <span className="dest-order">{i + 1}</span>
                      {d.name}
                      <button type="button" aria-label={`Move ${d.name} earlier`} disabled={i === 0}
                        onClick={() => moveDest(i, -1)} style={{ opacity: i === 0 ? .25 : undefined }}>↑</button>
                      <button type="button" aria-label={`Move ${d.name} later`} disabled={i === dests.length - 1}
                        onClick={() => moveDest(i, 1)} style={{ opacity: i === dests.length - 1 ? .25 : undefined }}>↓</button>
                      <button type="button" aria-label={`Remove ${d.name}`} onClick={() => removeDest(i)}>✕</button>
                    </span>
                  ))}
                </div>
              )}
              {dests.length === 0 && !errs.destinations && (
                <p className="hint-text" style={{ marginTop: 8 }}>e.g. Munnar → Thekkady → Alleppey. Add them in the order you’ll visit.</p>
              )}
            </Field>
            <div className="form-row">
              <Field label="Start date" error={errs.startDate}>
                <input className="input" type="date" ref={el => (fieldRefs.current.startDate = el)} aria-invalid={!!errs.startDate} value={f.startDate} onChange={e => setF(x => ({ ...x, startDate: e.target.value }))} />
              </Field>
              <Field label="End date" error={errs.endDate}>
                <input className="input" type="date" ref={el => (fieldRefs.current.endDate = el)} aria-invalid={!!errs.endDate} value={f.endDate} onChange={e => setF(x => ({ ...x, endDate: e.target.value }))} />
              </Field>
            </div>
            {dayCount > 0 && (
              <p className="hint-text">📅 That’s {dayCount} day{dayCount !== 1 ? 's' : ''} of planning.</p>
            )}
          </div>

          <div className="card">
            <h3>Crew & budget</h3>
            <hr className="divider" />
            <div className="form-row">
              <Field label="Travellers" error={errs.travellers}>
                <input className="input" type="number" min={1} max={30} ref={el => (fieldRefs.current.travellers = el)} aria-invalid={!!errs.travellers} value={f.travellers} onChange={e => setF(x => ({ ...x, travellers: Number(e.target.value) }))} />
              </Field>
              <Field label="Budget per person (₹)" error={errs.budgetPerPersonInr}>
                <input className="input" type="number" min={500} step={500} ref={el => (fieldRefs.current.budgetPerPersonInr = el)} aria-invalid={!!errs.budgetPerPersonInr} value={f.budgetPerPersonInr} onChange={e => setF(x => ({ ...x, budgetPerPersonInr: Number(e.target.value) }))} />
              </Field>
            </div>
            <Field label="Transport mode">
              <select className="select" value={f.transportMode} onChange={e => setF(x => ({ ...x, transportMode: e.target.value as TransportMode }))}>
                {TRANSPORT_MODES.map(m => <option key={m} value={m}>{cap(m)}</option>)}
              </select>
            </Field>
            {isFuelEconomyMode(f.transportMode) && (
              <>
              <div className="form-row">
                <Field label="Fuel economy (km per litre)" hint="Optional — makes fuel costs accurate: route distance ÷ economy × price per litre. Cars typically do 12–25 km/L, bikes 25–45.">
                  <input className="input" type="number" min={2} max={80} step={0.1} value={f.fuelEconomy}
                    onChange={e => setF(x => ({ ...x, fuelEconomy: e.target.value }))} placeholder="e.g. 18" />
                  {isImplausibleFuelEconomy(f.transportMode, parseFuelEconomyKmL(f.fuelEconomy)) && (
                    <p className="hint-text" style={{ marginTop: 5, color: '#b45309' }}>
                      ⚠️ Unusual for a {f.transportMode} — most do far better. Double-check the value (km per litre).
                    </p>
                  )}
                </Field>
                <Field label="Fuel price (₹ per litre)" hint={`Optional — defaults to ₹${FUEL_PRICE_INR_PER_L}/L (indicative national average). Enter your local pump price for a sharper estimate.`}>
                  <input className="input" type="number" min={50} max={250} step={0.1} value={f.fuelPrice}
                    onChange={e => setF(x => ({ ...x, fuelPrice: e.target.value }))} placeholder="e.g. 105.5" />
                </Field>
              </div>
              <div className="chip-row" style={{ margin: '4px 0 12px' }}>
                <Chip active={f.roundTrip} onClick={() => setF(x => ({ ...x, roundTrip: !x.roundTrip }))}>
                  Round trip — return to start
                </Chip>
              </div>
              </>
            )}
            <Field label="Travel style">
              <select className="select" value={f.travelStyle} onChange={e => setF(x => ({ ...x, travelStyle: e.target.value as TravelStyle }))}>
                {TRAVEL_STYLES.map(s => <option key={s} value={s}>{cap(s)}</option>)}
              </select>
            </Field>
            <Field label="Trip emoji">
              <div className="chip-row" style={{ marginTop: 6 }}>
                {['🧭', '🏔️', '🏖️', '🛕', '🚗', '🚂', '🌴', '🎒'].map(em => (
                  <Chip key={em} active={f.coverEmoji === em} onClick={() => setF(x => ({ ...x, coverEmoji: em }))}>
                    <span style={{ fontSize: 18 }}>{em}</span>
                  </Chip>
                ))}
              </div>
            </Field>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <h3>Fixed commitments</h3>
          <p className="hint-text" style={{ margin: '6px 0 12px' }}>
            Hotel check-ins, train or flight departures, events. The planner protects these when it warns about tight schedules.
          </p>
          {commitments.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {commitments.map((x, i) => (
                <div key={i} className="warn-item sev-low" style={{ marginBottom: 7 }}>
                  <span className="warn-icon">📌</span>
                  <div style={{ flex: 1 }}>
                    <div className="warn-title">{x.title}</div>
                    <div className="warn-fix">Day {x.dayIndex + 1} at {formatHM(x.time, timeFormat)}</div>
                  </div>
                  <button type="button" className="icon-btn" aria-label={`Remove ${x.title}`} onClick={() => setCommitments(l => l.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="form-row" style={{ gridTemplateColumns: '2fr 1fr .8fr .8fr auto', alignItems: 'end', gap: 10 }}>
            <Field label="What"><input className="input" value={c.title} onChange={e => setC(x => ({ ...x, title: e.target.value }))} placeholder="e.g. Houseboat boarding" /></Field>
            <Field label="Type">
              <select className="select" value={c.type} onChange={e => setC(x => ({ ...x, type: e.target.value as FixedCommitment['type'] }))}>
                <option value="hotel-checkin">Hotel check-in</option>
                <option value="train-departure">Train departure</option>
                <option value="flight-departure">Flight departure</option>
                <option value="event">Event</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Day">
              <select className="select" value={c.dayIndex} disabled={!dayCount}
                onChange={e => setC(x => ({ ...x, dayIndex: Number(e.target.value) }))}>
                {Array.from({ length: Math.max(1, dayCount) }, (_, i) => <option key={i} value={i}>Day {i + 1}</option>)}
              </select>
            </Field>
            <Field label="Time"><input className="input" type="time" value={c.time} onChange={e => setC(x => ({ ...x, time: e.target.value }))} /></Field>
            <button type="button" className="btn btn-outline" onClick={addCommitment} style={{ height: 42 }}>Add</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button type="button" className="btn btn-outline" onClick={() => onNavigate('/trips')}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-lg">Create trip →</button>
        </div>
      </form>
    </div>
  )
}

function cap(s: string): string { return s[0].toUpperCase() + s.slice(1) }
