// ============ Profile & settings ============
import { useEffect, useState } from 'react'
import { TravelStyle } from '../data/types'
import { TRAVEL_STYLES } from '../data/types'
import { useDb, currentUser, updateProfile, tripsForUser } from '../store/store'
import { Avatar, Chip, Field, toast } from '../components/ui'
import { useTimeFormat, setTimeFormat, formatHM, type TimeFormat } from '../lib/timefmt'

export function ProfilePage({ onNavigate }: { onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const timeFormat = useTimeFormat()
  const tripCount = tripsForUser(me?.id ?? null).length

  const [f, setF] = useState(() => ({
    name: me?.profile.name ?? '',
    homeCity: me?.profile.homeCity ?? '',
    languages: (me?.profile.languages ?? ['en']).join(', '),
  }))
  const [nameErr, setNameErr] = useState<string | null>(null)
  // Not logged in: route to auth instead of rendering a blank page.
  const loggedIn = Boolean(me)
  useEffect(() => { if (!loggedIn) onNavigate('/auth') })
  if (!me) return null

  function toggleStyle(s: TravelStyle) {
    const has = me!.profile.travelStyles.includes(s)
    updateProfile({ travelStyles: has ? me!.profile.travelStyles.filter(x => x !== s) : [...me!.profile.travelStyles, s] })
  }

  return (
    <div className="container form-page">
      <h1>Profile & settings</h1>
      <p className="muted small" style={{ marginBottom: 20 }}>{tripCount} trip{tripCount !== 1 ? 's' : ''} · {me.email}</p>

      <div className="two-col" style={{ alignItems: 'start' }}>
        <div>
          <div className="card">
            <h3>Your details</h3>
            <hr className="divider" />
            <div className="creator-line" style={{ marginBottom: 14 }}>
              <Avatar user={me} size="lg" />
              <span className="small muted">Avatars use your initials in this MVP.</span>
            </div>
            <Field label="Display name" error={nameErr ?? undefined}><input className="input" autoComplete="name" value={f.name} onChange={e => { setF(x => ({ ...x, name: e.target.value })); if (nameErr) setNameErr(null) }} /></Field>
            <Field label="Home city"><input className="input" autoComplete="address-level2" value={f.homeCity} onChange={e => setF(x => ({ ...x, homeCity: e.target.value }))} placeholder="e.g. Kochi" /></Field>
            <Field label="Languages you speak" hint="Comma separated — e.g. en, hi, ml">
              <input className="input" value={f.languages} onChange={e => setF(x => ({ ...x, languages: e.target.value }))} />
            </Field>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3>Travel styles</h3>
            <p className="hint-text" style={{ margin: '6px 0 10px' }}>Pick all that fit — helps collaborators know what kind of trip to invite you to.</p>
            <div className="chip-row">
              {TRAVEL_STYLES.map(s => (
                <Chip key={s} active={me.profile.travelStyles.includes(s)} aria-pressed={me.profile.travelStyles.includes(s)} onClick={() => toggleStyle(s)}>{cap(s)}</Chip>
              ))}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3>Display preferences</h3>
            <hr className="divider" />
            <Field label="Clock format" hint={`Applies across the app. Example: ${formatHM('18:30', timeFormat)}`}>
              <div className="chip-row">
                {(['12h', '24h'] as TimeFormat[]).map(opt => (
                  <Chip key={opt} active={timeFormat === opt} aria-pressed={timeFormat === opt} onClick={() => setTimeFormat(opt)}>
                    {opt === '12h' ? '12h (AM/PM)' : '24h'}
                  </Chip>
                ))}
              </div>
            </Field>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="row-between">
              <h3>Creator hub</h3>
              <Chip tone={me.profile.isCreator ? 'ok' : 'info'}>{me.profile.isCreator ? 'Enabled' : 'Off'}</Chip>
            </div>
            <p className="hint-text" style={{ margin: '6px 0 12px' }}>
              {me.profile.isCreator
                ? 'Manage your creator profile, social links and published itineraries.'
                : 'A trust and branding badge: your bio and social links appear on the itineraries you publish.'}
            </p>
            {me.profile.isCreator ? (
              <>
                <button className="btn btn-primary btn-sm" onClick={() => onNavigate('/creator-hub')}>Open creator hub</button>
                <a className="btn btn-outline btn-sm" style={{ marginLeft: 10 }} href={`#/creator/${me.id}`}>View public page</a>
              </>
            ) : (
              <button className="btn btn-saffron" onClick={() => { updateProfile({ isCreator: true }); toast('Creator mode enabled — open the hub to add your bio and links.') }}>
                Enable creator mode
              </button>
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3>Save details</h3>
            <hr className="divider" />
            <button className="btn btn-primary" onClick={() => {
              // Inline validation — the name silently reverting to the old one
              // read as "save doesn't work". Say so, next to the field.
              if (!f.name.trim()) { setNameErr('Pick a display name — it shows on shared trips.'); return }
              setNameErr(null)
              updateProfile({
                name: f.name.trim(),
                homeCity: f.homeCity.trim() || undefined,
                languages: f.languages.split(',').map(s => s.trim()).filter(Boolean),
              })
              toast('Profile saved')
            }}>Save profile</button>
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 10 }} onClick={() => onNavigate('/trips')}>← Back to my trips</button>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3>About your data</h3>
            <p className="hint-text" style={{ marginTop: 6 }}>
              This MVP stores everything locally in your browser. Costs and timings are transparent
              estimates — always verify prices before travelling.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function cap(s: string): string { return s[0].toUpperCase() + s.slice(1) }
