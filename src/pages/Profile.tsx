// ============ Profile & settings ============
import { useEffect, useMemo, useState } from 'react'
import { Bell, LogOut, Mail, Moon, Sparkles, Sun } from 'lucide-react'
import { TravelStyle } from '../data/types'
import { TRAVEL_STYLES } from '../data/types'
import {
  useDb, currentUser, updateProfile, tripsForUser, logout, notificationsFor, markAllNotificationsRead,
} from '../store/store'
import { Avatar, Chip, Field, toast } from '../components/ui'
import { useTimeFormat, setTimeFormat, formatHM, type TimeFormat } from '../lib/timefmt'
import { isNative } from '../lib/native'
import { feedbackHref } from '../lib/feedback'
import { setTheme, useTheme } from '../lib/theme'
import {
  browserNotifEnabled, setBrowserNotifEnabled, browserNotifSupported,
  browserNotifPermission, requestBrowserNotifPermission,
} from '../lib/browserNotifications'
import { cap } from '../lib/labels'

/** Compact relative timestamp for the notifications list ("3m ago"). */
function formatTimeAgo(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

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
  // Browser push opt-in (local Notification API — no server, no background
  // delivery; pings only while the app is open in a background tab).
  const [notifApi] = useState(() => browserNotifSupported())
  const [notifOn, setNotifOn] = useState(() => browserNotifEnabled())
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | 'unsupported'>(() => browserNotifPermission())
  useEffect(() => { setNotifPerm(browserNotifPermission()) }, [notifOn])
  // Not logged in: route to auth instead of rendering a blank page.
  const loggedIn = Boolean(me)
  useEffect(() => { if (!loggedIn) onNavigate('/auth') })
  if (!me) return null

  function toggleStyle(s: TravelStyle) {
    const has = me!.profile.travelStyles.includes(s)
    updateProfile({ travelStyles: has ? me!.profile.travelStyles.filter(x => x !== s) : [...me!.profile.travelStyles, s] })
  }

  // Shell-only relocated controls (the signed-in app hides the website
  // topnav): theme toggle, in-app notifications, account actions.
  const dark = useTheme()
  const notifs = useMemo(() => notificationsFor(me.id), [me])

  return (
    <div className="container form-page">
      <h1>Profile & settings</h1>
      <p className="muted small" style={{ marginBottom: 20 }}>{tripCount} trip{tripCount !== 1 ? 's' : ''} · {me.email}</p>

      {/* #86: this page's content is a single column — the .two-col grid left
          a 340px empty gutter at desktop widths. A readable single column
          instead (max-width keeps line lengths sane on wide screens). */}
      <div className="profile-col">
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
            <h3>Notifications</h3>
            <p className="hint-text" style={{ margin: '6px 0 12px' }}>
              Get an OS-level ping when a collaborator writes to you — even with
              YatraFlow in a background tab. The in-app bell always works; this
              just mirrors it to the system.
            </p>
            {!notifApi ? (
              <p className="hint-text">This browser doesn’t support notifications.</p>
            ) : notifPerm === 'denied' ? (
              <p className="hint-text">Notifications are blocked for this site — allow them in your browser’s site settings to turn this on.</p>
            ) : (
              <div className="row-between" style={{ gap: 10 }}>
                <span className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Bell size={14} aria-hidden /> Browser notifications
                </span>
                <button
                  className={`btn btn-sm ${notifOn && notifPerm === 'granted' ? 'btn-primary' : 'btn-outline'}`}
                  aria-pressed={notifOn && notifPerm === 'granted'}
                  onClick={async () => {
                    // requestPermission MUST run in the click handler — browsers
                    // ignore it outside a user gesture.
                    if (!notifOn) {
                      const perm = await requestBrowserNotifPermission()
                      setNotifPerm(perm)
                      if (perm !== 'granted') { toast('Browser notifications need permission to ping you.', 'err'); return }
                      setBrowserNotifEnabled(true)
                      setNotifOn(true)
                      toast('Browser notifications on — we’ll ping you from background tabs.')
                    } else {
                      setBrowserNotifEnabled(false)
                      setNotifOn(false)
                      toast('Browser notifications off.')
                    }
                  }}
                >
                  {notifOn && notifPerm === 'granted' ? 'On' : 'Off'}
                </button>
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3>About your data</h3>
            <p className="hint-text" style={{ marginTop: 6 }}>
              This MVP stores everything locally in your browser. Costs and timings are transparent
              estimates — always verify prices before travelling.
            </p>
          </div>

          {/* The signed-in Android shell hides the website topnav, so its
              controls relocate here — Profile is a bottom-nav destination. Each
              card is shell-only; the web keeps the topnav. */}
          {isNative && <>
            <div className="card" style={{ marginTop: 16 }}>
              <h3>Appearance</h3>
              <p className="hint-text" style={{ margin: '6px 0 12px' }}>Light or dark — your choice sticks across trips.</p>
              <button
                className={`btn btn-sm ${dark ? 'btn-primary' : 'btn-outline'}`}
                aria-pressed={dark}
                onClick={() => setTheme(!dark)}
              >
                {dark ? <><Sun size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />Light mode</> : <><Moon size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />Dark mode</>}
              </button>
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <div className="row-between" style={{ marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>Notifications</h3>
                {notifs.length > 0 && notifs.some(n => !n.read) && (
                  <button className="btn btn-ghost btn-sm" onClick={() => markAllNotificationsRead(me.id)}>Mark all read</button>
                )}
              </div>
              {notifs.length === 0 ? (
                <p className="hint-text" style={{ marginTop: 0 }}>No notifications yet — collaborators writing to you will show up here.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {notifs.slice(0, 8).map(n => (
                    <div key={n.id} className="row-between" style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                      <span style={{ opacity: n.read ? 0.6 : 1 }}>{n.text}</span>
                      <span className="muted small" style={{ flex: '0 0 auto', marginLeft: 8 }}>{formatTimeAgo(n.at)}</span>
                    </div>
                  ))}
                  {notifs.length > 8 && <span className="muted small">+{notifs.length - 8} older</span>}
                </div>
              )}
            </div>

            <div className="card" style={{ marginTop: 16 }}>
              <h3>Account</h3>
              {me.profile.isCreator && (
                <button className="btn btn-outline btn-sm" style={{ marginBottom: 8 }} onClick={() => onNavigate('/creator-hub')}>
                  <Sparkles size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />Creator hub
                </button>
              )}
              <div>
                <a className="btn btn-outline btn-sm" href={feedbackHref()} style={{ marginBottom: 8 }}>
                  <Mail size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />Send feedback
                </a>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => { logout(); onNavigate('/') }}>
                <LogOut size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 6 }} />Log out
              </button>
            </div>
          </>}
        </div>
      </div>
    </div>
  )
}
