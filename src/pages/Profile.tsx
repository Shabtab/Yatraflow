// ============ Profile & settings ============
import { useEffect, useState } from 'react'
import { ExternalLink, Pencil } from 'lucide-react'
import type { PublishedItinerary, TravelStyle } from '../data/types'
import { TRAVEL_STYLES } from '../data/types'
import { useDb, currentUser, updateProfile, tripsForUser, unpublishItinerary, tripById } from '../store/store'
import { Avatar, Chip, ConfirmDialog, Field, toast } from '../components/ui'
import { useTimeFormat, setTimeFormat, formatHM, type TimeFormat } from '../lib/timefmt'

export function ProfilePage({ onNavigate }: { onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const timeFormat = useTimeFormat()
  const tripCount = tripsForUser(me?.id ?? null).length
  const myPubs = me ? db.published.filter(p => p.creatorId === me.id) : []

  const [f, setF] = useState(() => ({
    name: me?.profile.name ?? '',
    homeCity: me?.profile.homeCity ?? '',
    languages: (me?.profile.languages ?? ['en']).join(', '),
  }))
  const [creatorBio, setCreatorBio] = useState(me?.profile.creatorBio ?? '')
  const [youtube, setYoutube] = useState(me?.profile.socialLinks?.youtube ?? '')
  const [instagram, setInstagram] = useState(me?.profile.socialLinks?.instagram ?? '')
  const [nameErr, setNameErr] = useState<string | null>(null)
  // Disable-creator-mode + Unpublish both go through a confirm dialog.
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [unpubTarget, setUnpubTarget] = useState<PublishedItinerary | null>(null)
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
              <h3>Creator mode</h3>
              <Chip tone={me.profile.isCreator ? 'ok' : 'info'}>{me.profile.isCreator ? 'Enabled' : 'Off'}</Chip>
            </div>
            <p className="hint-text" style={{ margin: '6px 0 12px' }}>
              Publishing to Explore is open to everyone — do it from any trip&apos;s Share tab.
              Creator mode is a trust and branding badge: your bio and social links appear
              on the itineraries you publish.
            </p>
            {me.profile.isCreator ? (
              <>
                <Field label="Creator bio"><textarea className="textarea" value={creatorBio} onChange={e => setCreatorBio(e.target.value)} placeholder="Tell readers who you are and why they should trust your routes." /></Field>
                <div className="form-row">
                  <Field label="YouTube link"><input className="input" type="url" inputMode="url" value={youtube} onChange={e => setYoutube(e.target.value)} placeholder="https://youtube.com/@…" /></Field>
                  <Field label="Instagram link"><input className="input" type="url" inputMode="url" value={instagram} onChange={e => setInstagram(e.target.value)} placeholder="https://instagram.com/…" /></Field>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => {
                  updateProfile({
                    creatorBio: creatorBio.trim() || undefined,
                    socialLinks: (youtube.trim() || instagram.trim())
                      ? { youtube: youtube.trim() || undefined, instagram: instagram.trim() || undefined }
                      : undefined,
                  })
                  toast('Creator profile saved')
                }}>Save creator profile</button>
                <button className="btn btn-outline btn-sm" style={{ marginLeft: 10 }}
                  onClick={() => onNavigate(`/creator/${me.id}`)}>View your public page</button>
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: 10 }}
                  onClick={() => setConfirmDisable(true)}>Disable creator mode</button>
              </>
            ) : (
              <button className="btn btn-saffron" onClick={() => { updateProfile({ isCreator: true }); toast('Creator mode enabled ✨ Your bio and links now show on published itineraries.') }}>
                Enable creator mode
              </button>
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="row-between">
              <h3>My publications</h3>
              {myPubs.length > 0 && (
                <a className="small" href={`#/creator/${me.id}`} style={{ fontWeight: 650 }}>
                  <ExternalLink size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />View public page
                </a>
              )}
            </div>
            <hr className="divider" />
            {myPubs.length === 0 ? (
              <p className="hint-text" style={{ margin: '6px 0 0' }}>
                Nothing published yet — list a trip on Explore from its Share tab.
              </p>
            ) : (
              <div style={{ marginTop: 4 }}>
                {myPubs.map(p => {
                  const trip = tripById(p.tripId)
                  // "Page behind itinerary": the trip changed after the last
                  // publish/refresh. refreshedAt is absent on pre-v0.37 rows.
                  const stale = !!trip && trip.updatedAt > (p.refreshedAt ?? p.publishedAt)
                  return (
                    <div key={p.id} className="pub-row">
                      <div className="pub-row-main">
                        <span className="pub-row-title">
                          <a href={`#/pub/${p.id}`}>{p.title}</a>
                          {stale && <Chip tone="saffron">Page behind itinerary</Chip>}
                        </span>
                        <span className="small muted">{p.views} view{p.views === 1 ? '' : 's'} · {p.copies} fork{p.copies === 1 ? '' : 's'}</span>
                      </div>
                      <span className="pub-row-actions">
                        {stale && (
                          <button className="btn btn-saffron btn-sm" onClick={() => onNavigate(`/trip/${p.tripId}/share`)}>Update page</button>
                        )}
                        <button className="btn btn-outline btn-sm" aria-label={`Edit ${p.title}`} onClick={() => onNavigate(`/trip/${p.tripId}/share`)}>
                          <Pencil size={13} aria-hidden style={{ verticalAlign: '-2px', marginRight: 3 }} />Edit
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setUnpubTarget(p)}>Unpublish</button>
                      </span>
                    </div>
                  )
                })}
              </div>
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

      <ConfirmDialog
        open={confirmDisable}
        title="Disable creator mode?"
        body="Your bio and social links stop showing on your published itineraries and the creator badge is removed. Your publications stay live — you can re-enable the badge anytime."
        confirmLabel="Disable"
        danger
        onConfirm={() => {
          updateProfile({ isCreator: false })
          setConfirmDisable(false)
          toast('Creator mode disabled — your publications stay live.')
        }}
        onClose={() => setConfirmDisable(false)}
      />
      <ConfirmDialog
        open={!!unpubTarget}
        title={`Unpublish “${unpubTarget?.title ?? ''}”?`}
        body="It is removed from Explore immediately and its public page stops working. The trip itself is not touched — you can publish it again from its Share tab."
        confirmLabel="Unpublish"
        danger
        onConfirm={() => {
          if (!unpubTarget) return
          unpublishItinerary(unpubTarget.tripId)
          setUnpubTarget(null)
          toast('Unpublished — removed from Explore')
        }}
        onClose={() => setUnpubTarget(null)}
      />
    </div>
  )
}

function cap(s: string): string { return s[0].toUpperCase() + s.slice(1) }
