// ============ Trip workspace — trip settings form (Share tab) ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
import { useState } from 'react'
import { ChevronDown, ChevronUp, TriangleAlert, X } from 'lucide-react'
import type { Trip, LatLngPoint } from '../../data/types'
import { TRANSPORT_MODES, TRAVEL_STYLES } from '../../data/types'
import { updateTrip } from '../../store/store'
import { FUEL_PRICE_INR_PER_L, isFuelEconomyMode, parseFuelEconomyKmL, isImplausibleFuelEconomy, parseFuelPricePerL } from '../../lib/engine'
import { Chip, Field, toast } from '../../components/ui'
import { LocationInput } from '../../components/LocationInput'
import { CoverImagePicker } from '../../components/CoverImagePicker'

export function TripSettingsForm({ trip, editable }: { trip: Trip; editable: boolean }) {
  const [f, setF] = useState({
    name: trip.name, startLocation: trip.startLocation,
    destinations: [...trip.destinations],
    travellers: trip.travellers, budget: trip.budgetPerPersonInr,
    transportMode: trip.transportMode, travelStyle: trip.travelStyle,
    fuelEconomy: trip.fuelEconomyKmL?.toString() ?? '',
    fuelPrice: trip.fuelPricePerL?.toString() ?? '',
    roundTrip: trip.roundTrip ?? true,
    vehicleType: trip.vehicleProfile?.vehicleType ?? 'car',
    fuelType: trip.vehicleProfile?.fuelType ?? 'petrol',
    capacity: trip.vehicleProfile?.capacity?.toString() ?? '',
    vehicleEconomy: trip.vehicleProfile?.economy?.toString() ?? '',
  })
  const [startCoords, setStartCoords] = useState<LatLngPoint | null>(trip.startLocationCoords ?? null)
  const [destCoords, setDestCoords] = useState<(LatLngPoint | null)[]>(trip.destinationCoords ?? [])
  const [destInput, setDestInput] = useState('')

  function addDest(name: string, coords: LatLngPoint | null) {
    const clean = name.trim()
    if (!clean) return
    if (f.destinations.some(d => d.toLowerCase() === clean.toLowerCase())) {
      toast('Already on the route.', 'err'); return
    }
    setF(x => ({ ...x, destinations: [...x.destinations, clean] }))
    setDestCoords(list => [...list, coords])
    setDestInput('')
  }

  return (
    <div>
      <Field label="Cover image">
        <CoverImagePicker trip={trip} editable={editable} />
        <p className="hint-text" style={{ marginTop: 6 }}>
          Pick a popular photo of your destination, paste your own image URL, or leave it to the emoji.
        </p>
      </Field>
      <Field label="Trip name"><input className="input" disabled={!editable} value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} /></Field>
      <div className="form-row">
        <Field label="Starting location">
          <LocationInput
            value={f.startLocation}
            onChange={v => setF(x => ({ ...x, startLocation: v }))}
            onPick={p => setStartCoords({ lat: p.latitude, lng: p.longitude })}
            placeholder="Search a city…"
          />
        </Field>
      </div>
      <Field label={`Destinations (${f.destinations.length})`} hint="Search to add — arrows reorder the route">
        <LocationInput
          value={destInput}
          onChange={setDestInput}
          onPick={p => addDest(p.name + (p.admin1 ? `, ${p.admin1}` : ''), { lat: p.latitude, lng: p.longitude })}
          placeholder={f.destinations.length ? 'Add another destination…' : 'Add your first destination…'}
        />
        {f.destinations.length > 0 && (
          <div className="dest-chips">
            {f.destinations.map((d, i) => (
              <span key={`${d}-${i}`} className="dest-chip">
                <span className="dest-order">{i + 1}</span>{d}
                <button type="button" aria-label={`Move ${d} earlier`} disabled={!editable || i === 0}
                  onClick={() => setF(x => {
                    const list = [...x.destinations]; if (i === 0) return x
                    ;[list[i - 1], list[i]] = [list[i], list[i - 1]]
                    const dc = [...destCoords]; [dc[i - 1], dc[i]] = [dc[i], dc[i - 1]]; setDestCoords(dc)
                    return { ...x, destinations: list }
                  })} style={{ opacity: i === 0 ? .25 : undefined }}><ChevronUp size={12} aria-hidden /></button>
                <button type="button" aria-label={`Move ${d} later`} disabled={!editable || i === f.destinations.length - 1}
                  onClick={() => setF(x => {
                    const list = [...x.destinations]; if (i >= list.length - 1) return x
                    ;[list[i + 1], list[i]] = [list[i], list[i + 1]]
                    const dc = [...destCoords]; [dc[i + 1], dc[i]] = [dc[i], dc[i + 1]]; setDestCoords(dc)
                    return { ...x, destinations: list }
                  })} style={{ opacity: i === f.destinations.length - 1 ? .25 : undefined }}><ChevronDown size={12} aria-hidden /></button>
                {editable && (
                  <button type="button" aria-label={`Remove ${d}`}
                    onClick={() => {
                      setF(x => ({ ...x, destinations: x.destinations.filter((_, j) => j !== i) }))
                      setDestCoords(list => list.filter((_, j) => j !== i))
                    }}><X size={12} aria-hidden /></button>
                )}
              </span>
            ))}
          </div>
        )}
      </Field>
      <div className="form-row">
        <Field label="Travellers"><input type="number" min={1} className="input" disabled={!editable} value={f.travellers} onChange={e => setF(x => ({ ...x, travellers: Number(e.target.value) }))} /></Field>
        <Field label="Budget/person (₹)"><input type="number" min={0} className="input" disabled={!editable} value={f.budget} onChange={e => setF(x => ({ ...x, budget: Number(e.target.value) }))} /></Field>
      </div>
      <div className="form-row">
        <Field label="Transport mode">
          <select className="select" disabled={!editable} value={f.transportMode} onChange={e => setF(x => ({ ...x, transportMode: e.target.value as never }))}>
            {TRANSPORT_MODES.map(m => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Travel style">
          <select className="select" disabled={!editable} value={f.travelStyle} onChange={e => setF(x => ({ ...x, travelStyle: e.target.value as never }))}>
            {TRAVEL_STYLES.map(s => <option key={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      {isFuelEconomyMode(f.transportMode) && (
        <div className="form-row">
          <Field label="Fuel economy (km per litre)" hint="Optional — transport cost becomes route distance ÷ economy × price per litre instead of the default ₹/km rate.">
            <input type="number" min={2} max={80} step={0.1} className="input" disabled={!editable} value={f.fuelEconomy}
              onChange={e => setF(x => ({ ...x, fuelEconomy: e.target.value }))} placeholder="e.g. 18" />
            {isImplausibleFuelEconomy(f.transportMode, parseFuelEconomyKmL(f.fuelEconomy)) && (
              <p className="hint-text" style={{ marginTop: 5, color: 'var(--warn-600)' }}>
                <TriangleAlert size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />Unusual for a {f.transportMode} — most do far better. Double-check the value (km per litre).
              </p>
            )}
          </Field>
          <Field label="Fuel price (₹ per litre)" hint={`Optional — defaults to ₹${FUEL_PRICE_INR_PER_L}/L (indicative national average). Enter your local pump price for a sharper estimate.`}>
            <input type="number" min={50} max={250} step={0.1} className="input" disabled={!editable} value={f.fuelPrice}
              onChange={e => setF(x => ({ ...x, fuelPrice: e.target.value }))} placeholder="e.g. 105.5" />
          </Field>
        </div>
      )}
      {isFuelEconomyMode(f.transportMode) && (
        <div className="chip-row" style={{ margin: '4px 0 12px' }}>
          <Chip active={f.roundTrip} aria-pressed={f.roundTrip} onClick={editable ? () => setF(x => ({ ...x, roundTrip: !x.roundTrip })) : undefined}>
            Round trip — return to start
          </Chip>
        </div>
      )}
      {isFuelEconomyMode(f.transportMode) && (
        <div className="vehicle-profile-form" style={{ margin: '4px 0 16px' }}>
          <div className="form-row">
            <Field label="Vehicle type">
              <select className="select" disabled={!editable} value={f.vehicleType} onChange={e => setF(x => ({ ...x, vehicleType: e.target.value as never }))}>
                <option value="car">Car</option>
                <option value="motorcycle">Motorcycle</option>
                <option value="ev">Electric (EV)</option>
              </select>
            </Field>
            <Field label="Fuel / energy">
              <select className="select" disabled={!editable} value={f.fuelType} onChange={e => setF(x => ({ ...x, fuelType: e.target.value as never }))}>
                <option value="petrol">Petrol</option>
                <option value="diesel">Diesel</option>
                <option value="electric">Electric</option>
                <option value="cng">CNG</option>
              </select>
            </Field>
          </div>
          <div className="form-row">
            <Field label={f.fuelType === 'electric' ? 'Battery (kWh)' : 'Tank capacity (L)'} hint={f.fuelType === 'electric' ? 'e.g. 50' : 'e.g. 45'}>
              <input type="number" min={1} max={300} step={0.5} className="input" disabled={!editable} value={f.capacity}
                onChange={e => setF(x => ({ ...x, capacity: e.target.value }))} placeholder={f.fuelType === 'electric' ? '50' : '45'} />
            </Field>
            <Field label={f.fuelType === 'electric' ? 'Efficiency (km / kWh)' : 'Economy (km / L)'} hint={f.fuelType === 'electric' ? 'e.g. 6' : 'e.g. 15'}>
              <input type="number" min={1} max={200} step={0.1} className="input" disabled={!editable} value={f.vehicleEconomy}
                onChange={e => setF(x => ({ ...x, vehicleEconomy: e.target.value }))} placeholder={f.fuelType === 'electric' ? '6' : '15'} />
            </Field>
          </div>
        </div>
      )}
      {editable && (
        <button className="btn btn-primary btn-sm" onClick={() => {
          updateTrip(trip.id, {
            name: f.name, startLocation: f.startLocation,
            startLocationCoords: startCoords ?? undefined,
            destinations: f.destinations.map(s => s.trim()).filter(Boolean),
            destinationCoords: destCoords,
            travellers: Math.max(1, f.travellers),
            budgetPerPersonInr: Math.max(0, f.budget),
            transportMode: f.transportMode, travelStyle: f.travelStyle,
            fuelEconomyKmL: isFuelEconomyMode(f.transportMode) ? parseFuelEconomyKmL(f.fuelEconomy) : undefined,
            fuelPricePerL: isFuelEconomyMode(f.transportMode) ? parseFuelPricePerL(f.fuelPrice) : undefined,
            roundTrip: isFuelEconomyMode(f.transportMode) ? f.roundTrip : undefined,
            vehicleProfile: isFuelEconomyMode(f.transportMode) ? {
              vehicleType: f.vehicleType as 'car' | 'motorcycle' | 'ev',
              fuelType: f.fuelType as 'petrol' | 'diesel' | 'electric' | 'cng',
              capacity: Number(f.capacity) || 45,
              economy: Number(f.vehicleEconomy) || 15,
            } : undefined,
          })
          toast('Trip settings updated')
        }}>Save settings</button>
      )}
    </div>
  )
}
