// ============ Trip workspace — trip settings form (Share tab) ============
// Mechanical extraction from src/pages/TripWorkspace.tsx (M3.4) — no behavior changes.
import { useState, type ReactNode } from 'react'
import {
  Bike, Bus, Car, CarTaxiFront, ChevronDown, ChevronUp, Image as ImageIcon, MapPin,
  Plane, Route as RouteIcon, Shuffle, TrainFront, TriangleAlert, Users, X,
} from 'lucide-react'
import type { Trip, LatLngPoint, TransportMode } from '../../data/types'
import { TRANSPORT_MODES, TRAVEL_STYLES } from '../../data/types'
import { updateTrip } from '../../store/store'
import { FUEL_PRICE_INR_PER_L, MODE_SPEED, formatInr, isFuelEconomyMode, parseFuelEconomyKmL, isImplausibleFuelEconomy, parseFuelPricePerL } from '../../lib/engine'
import { cap } from '../../lib/labels'
import { Chip, CountStepper, Field, OptionTiles, RangeDial, SettingsGroup, StickyFormBar, toast } from '../../components/ui'
import { PillNav } from '../../components/PillNav'
import { LocationInput } from '../../components/LocationInput'
import { CoverImagePicker } from '../../components/CoverImagePicker'

/** Icon per transport mode — mirrors the bench's mode tiles. */
const MODE_ICON: Record<TransportMode, ReactNode> = {
  car: <Car size={15} />, motorcycle: <Bike size={15} />, train: <TrainFront size={15} />,
  bus: <Bus size={15} />, flight: <Plane size={15} />, taxi: <CarTaxiFront size={15} />,
  mixed: <Shuffle size={15} />,
}

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
    <div className="ts-form">
      <SettingsGroup icon={<ImageIcon size={15} />} title="Identity">
        <Field label="Trip name"><input className="input" disabled={!editable} value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} /></Field>
        <Field label="Cover image">
          <CoverImagePicker trip={trip} editable={editable} />
          <p className="hint-text">Pick a popular photo of your destination, paste your own image URL, or leave it to the emoji.</p>
        </Field>
      </SettingsGroup>

      <SettingsGroup icon={<RouteIcon size={15} />} title="Route">
        <Field label="Starting location">
          <LocationInput
            value={f.startLocation}
            onChange={v => setF(x => ({ ...x, startLocation: v }))}
            onPick={p => setStartCoords({ lat: p.latitude, lng: p.longitude })}
            placeholder="Search a city…"
          />
        </Field>
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
      </SettingsGroup>

      <SettingsGroup icon={<Users size={15} />} title="People & money">
        <Field label="Travellers">
          <CountStepper value={Math.min(12, Math.max(1, f.travellers))} min={1} max={12}
            ariaLabel="Number of travellers" disabled={!editable}
            onChange={v => setF(x => ({ ...x, travellers: v }))} />
        </Field>
        <Field label="Budget per person (₹)" hint="What one person can spend across the whole trip — the Budget tab's pacing tile reads this.">
          <RangeDial value={Math.min(300000, Math.max(0, f.budget))} min={0} max={300000} step={500}
            fmt={v => formatInr(v)} ends={['₹0', '₹3L']} ariaLabel="Budget per person in rupees"
            disabled={!editable} onChange={v => setF(x => ({ ...x, budget: v }))} />
        </Field>
      </SettingsGroup>

      <SettingsGroup icon={<Car size={15} />} title="Getting around"
        hint="Mode and style tune the suggestion engine — relaxed trips stop sooner than packed ones.">
        <Field label="Transport mode">
          <OptionTiles value={f.transportMode} disabled={!editable} ariaLabel="Transport mode"
            onChange={v => setF(x => ({ ...x, transportMode: v }))}
            options={TRANSPORT_MODES.map(m => ({ value: m, label: cap(m), icon: MODE_ICON[m], meta: `≈${MODE_SPEED[m] ?? 40} km/h` }))} />
        </Field>
        <div className="ts-stylefield">
          <span className="ts-fieldlabel">Travel style</span>
          <PillNav className="ts-stylebar" role="group" aria-label="Travel style" activeKey={f.travelStyle}>
            {TRAVEL_STYLES.map(s => (
              <button key={s} type="button" data-pill-key={s} disabled={!editable}
                aria-pressed={f.travelStyle === s}
                className={`chip clickable-chip${f.travelStyle === s ? ' on-teal' : ''}`}
                onClick={() => setF(x => ({ ...x, travelStyle: s }))}>
                {cap(s)}
              </button>
            ))}
          </PillNav>
        </div>
      {isFuelEconomyMode(f.transportMode) && (
        <>
        <div className="form-row">
          <Field label="Fuel economy (km per litre)" hint="Optional — transport cost becomes route distance ÷ economy × price per litre instead of the default ₹/km rate.">
            <input type="number" min={2} max={80} step={0.1} className="input" disabled={!editable} value={f.fuelEconomy}
              onChange={e => setF(x => ({ ...x, fuelEconomy: e.target.value }))} placeholder="e.g. 18" />
            {isImplausibleFuelEconomy(f.transportMode, parseFuelEconomyKmL(f.fuelEconomy)) && (
              <p className="hint-text ts-warn-note">
                <TriangleAlert size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />Unusual for a {f.transportMode} — most do far better. Double-check the value (km per litre).
              </p>
            )}
          </Field>
          <Field label="Fuel price (₹ per litre)" hint={`Optional — defaults to ₹${FUEL_PRICE_INR_PER_L}/L (indicative national average). Enter your local pump price for a sharper estimate.`}>
            <input type="number" min={50} max={250} step={0.1} className="input" disabled={!editable} value={f.fuelPrice}
              onChange={e => setF(x => ({ ...x, fuelPrice: e.target.value }))} placeholder="e.g. 105.5" />
          </Field>
        </div>
        <div className="chip-row">
          <Chip active={f.roundTrip} aria-pressed={f.roundTrip} onClick={editable ? () => setF(x => ({ ...x, roundTrip: !x.roundTrip })) : undefined}>
            Round trip — return to start
          </Chip>
        </div>
        <div className="vehicle-profile-form">
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
        </>
      )}
      </SettingsGroup>

      <StickyFormBar show={editable}>
        <button className="btn btn-primary" onClick={() => {
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
      </StickyFormBar>
    </div>
  )
}
