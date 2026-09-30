// ============ Profile & settings ============
import { useEffect, useMemo, useRef, useState } from 'react'
import { InlineIcon } from '../components/icons'
import { Bell, LogOut, Mail, Moon, Sparkles, Sun } from 'lucide-react'
import { TravelStyle } from '../data/types'
import { TRAVEL_STYLES } from '../data/types'
import {
  useDb, currentUser, updateProfile, tripsForUser, logout, notificationsFor, markAllNotificationsRead,
} from '../store/store'
import { Avatar, Chip, Field, toast, undoToast } from '../components/ui'
import { useTimeFormat, setTimeFormat, formatHM, type TimeFormat } from '../lib/timefmt'
import { isNative } from '../lib/native'
import { feedbackHref } from '../lib/feedback'
import { setTheme, useTheme } from '../lib/theme'
import {
  browserNotifEnabled, setBrowserNotifEnabled, browserNotifSupported,
  browserNotifPermission, requestBrowserNotifPermission,
} from '../lib/browserNotifications'
import {
  loadAiProviderConfig, saveAiProviderConfig, clearAiProviderConfig, testAiProviderConnection,
  loadJevConfig, saveJevConfig, clearJevConfig, testJevConnection,
  type AiProviderConfig, type JevConfig,
} from '../lib/aiProvider'
import { AI_COMPANION_ENABLED } from '../lib/featureFlags'
import { cap } from '../lib/labels'
import { isIosSafari, isStandalone, onInstallAvailability, promptInstall } from '../lib/pwaInstall'
import { scrollBehavior } from '../lib/motion'
import { appLink } from '../lib/appLink'

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
  // The Save details card sits well below "Your details" — the field this
  // button validates (Display name) is off-screen from it, so a failed save
  // rendered its error out of sight and the click read as "save did nothing".
  // F-15: hold the input so a failed save can take the user to the problem
  // (same as StopEditor).
  const nameRef = useRef<HTMLInputElement>(null)
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
            <Field label="Display name" error={nameErr ?? undefined}><input className="input" ref={nameRef} autoComplete="name" value={f.name} onChange={e => { setF(x => ({ ...x, name: e.target.value })); if (nameErr) setNameErr(null) }} /></Field>
            <Field label="Home city"><input className="input" autoComplete="address-level2" value={f.homeCity} onChange={e => setF(x => ({ ...x, homeCity: e.target.value }))} placeholder="e.g. Kochi" /></Field>
            <Field label="Languages you speak" hint="Comma separated — e.g. en, hi, ml">
              <input className="input" value={f.languages} onChange={e => setF(x => ({ ...x, languages: e.target.value }))} />
            </Field>
          </div>

          <div className="card stack-gap">
            <h3>Travel styles</h3>
            <p className="hint-text" style={{ margin: '6px 0 10px' }}>Pick all that fit — helps collaborators know what kind of trip to invite you to.</p>
            <div className="chip-row">
              {TRAVEL_STYLES.map(s => (
                <Chip key={s} active={me.profile.travelStyles.includes(s)} aria-pressed={me.profile.travelStyles.includes(s)} onClick={() => toggleStyle(s)}>{cap(s)}</Chip>
              ))}
            </div>
          </div>

          <div className="card stack-gap">
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

          {/* The companion drawer mounts only under VITE_AI_COMPANION=on
              (until M8) — its settings cards follow the same flag, so a build
              without the companion never shows settings for it. */}
          {AI_COMPANION_ENABLED && (
            <>
              <AiProviderCard />

              <JevCard />
            </>
          )}
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
                : 'A branding badge: your bio and social links appear on the itineraries you publish.'}
            </p>
            {me.profile.isCreator ? (
              <>
                <button className="btn btn-primary btn-sm" onClick={() => onNavigate('/creator-hub')}>Open creator hub</button>
                <a className="btn btn-outline btn-sm" style={{ marginLeft: 10 }} {...appLink(`/creator/${me.id}`)}>View public page</a>
              </>
            ) : (
              <button className="btn btn-saffron" onClick={() => { updateProfile({ isCreator: true }); toast('Creator mode enabled — open the hub to add your bio and links.') }}>
                Enable creator mode
              </button>
            )}
          </div>

          <div className="card stack-gap">
            <h3>Save details</h3>
            <hr className="divider" />
            <button className="btn btn-primary" onClick={() => {
              // Inline validation — the name silently reverting to the old one
              // read as "save doesn't work". Say so, next to the field.
              if (!f.name.trim()) {
                setNameErr('Pick a display name — it shows on shared trips.')
                // F-15: the message renders next to Display name, which this
                // button is scrolled away from — take the user to it (scroll,
                // then focus with preventScroll so the scroll is ours).
                const el = nameRef.current
                if (el) { el.scrollIntoView({ behavior: scrollBehavior(), block: 'center' }); el.focus({ preventScroll: true }) }
                return
              }
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

          <div className="card stack-gap">
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

          <div className="card stack-gap">
            <h3>About your data</h3>
            <p className="hint-text" style={{ marginTop: 6 }}>
              Your trips, votes and decisions are saved to your account, so they follow you between
              devices. Display preferences stay on this device. Costs and timings are transparent
              estimates — always verify prices before travelling.
            </p>
          </div>

          <InstallCard />

          {/* The signed-in Android shell hides the website topnav, so its
              controls relocate here — Profile is a bottom-nav destination. Each
              card is shell-only; the web keeps the topnav. */}
          {isNative && <>
            <div className="card stack-gap">
              <h3>Appearance</h3>
              <p className="hint-text" style={{ margin: '6px 0 12px' }}>Light or dark — your choice sticks across trips.</p>
              <button
                className={`btn btn-sm ${dark ? 'btn-primary' : 'btn-outline'}`}
                aria-pressed={dark}
                onClick={() => setTheme(!dark)}
              >
                {dark ? <><InlineIcon icon={Sun} size={14} gap={6} />Light mode</> : <><InlineIcon icon={Moon} size={14} gap={6} />Dark mode</>}
              </button>
            </div>

            <div className="card stack-gap">
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

            <div className="card stack-gap">
              <h3>Account</h3>
              {me.profile.isCreator && (
                <button className="btn btn-outline btn-sm" style={{ marginBottom: 8 }} onClick={() => onNavigate('/creator-hub')}>
                  <InlineIcon icon={Sparkles} size={14} gap={6} />Creator hub
                </button>
              )}
              <div>
                <a className="btn btn-outline btn-sm" href={feedbackHref()} style={{ marginBottom: 8 }}>
                  <InlineIcon icon={Mail} size={14} gap={6} />Send feedback
                </a>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => { logout(); onNavigate('/') }}>
                <InlineIcon icon={LogOut} size={14} gap={6} />Log out
              </button>
            </div>
          </>}
        </div>
      </div>
    </div>
  )
}

// ============ AI companion endpoint card (M5) ============
// Per-device LLM configuration. The key lives in localStorage only — it never
// enters the database, a snapshot or a share. Inputs are disabled while a
// connection test is in flight (the repo's async-input guard rule), and the
// result is shown inline rather than toasted so it can be re-read.

function AiProviderCard() {
  const [cfg, setCfg] = useState<AiProviderConfig>(() => loadAiProviderConfig() ?? { baseUrl: '', apiKey: '', model: '' })
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const saved = loadAiProviderConfig()
  const testAbort = useRef<AbortController | null>(null)

  useEffect(() => () => {
    testAbort.current?.abort()
  }, [])

  const set = (patch: Partial<AiProviderConfig>) => setCfg(c => ({ ...c, ...patch }))

  async function onTest() {
    if (testing) return
    // An empty key field with a config already saved means "keep the saved
    // key" — matching the field's own hint. Nothing stored yet stays an error.
    const key = cfg.apiKey.trim() || loadAiProviderConfig()?.apiKey || ''
    const err = saveAiProviderConfig({ ...cfg, apiKey: key })
    if (err) { setResult(err); return }
    testAbort.current?.abort()
    const abort = new AbortController()
    testAbort.current = abort
    setTesting(true)
    setResult('')
    try {
      const failure = await testAiProviderConnection(loadAiProviderConfig()!, testAbort.current.signal)
      if (abort.signal.aborted) return
      setResult(failure
        ? `Saved, but the endpoint did not answer: ${failure} Until it connects, answers fall back to the offline router.`
        : 'Connected — the companion will answer with this model.')
    } catch {
      if (abort.signal.aborted) return
      setResult('Could not reach the endpoint.')
    } finally {
      if (!abort.signal.aborted) {
        setTesting(false)
      }
    }
  }

  function onClear() {
    if (testing) return
    // A saved endpoint is a secret the user pasted in from somewhere else — not
    // something they can retype from memory — so clearing it offers the same
    // Undo the app's other destructive actions do (#424).
    const previous = cfg
    clearAiProviderConfig()
    setCfg({ baseUrl: '', apiKey: '', model: '' })
    setResult('Cleared — the companion answers offline (deterministic) again.')
    undoToast('Saved endpoint cleared', () => {
      saveAiProviderConfig(previous)
      setCfg(previous)
      setResult('Restored the endpoint you had saved.')
    })
  }

  return (
    <div className="card stack-gap">
      <div className="row-between">
        <h3>AI companion</h3>
        <Chip tone={saved ? 'ok' : 'info'}>{saved ? 'LLM configured' : 'Not configured'}</Chip>
      </div>
      <p className="hint-text" style={{ margin: '6px 0 0' }}>
        Optional. Point the companion at any OpenAI-compatible endpoint and it answers with that model — grounded in this
        trip's data. Without one it uses the built-in deterministic assistant. The key is stored on this device only and
        is never sent to YatraFlow's servers.
      </p>
      <Field label="Endpoint base URL" hint="e.g. https://api.openai.com/v1 — everything before /chat/completions">
        <input
          className="input" type="url" inputMode="url" autoComplete="off" spellCheck={false}
          placeholder="https://api.openai.com/v1"
          value={cfg.baseUrl} disabled={testing} onChange={e => set({ baseUrl: e.target.value })}
        />
      </Field>
      <Field label="API key" hint="Stored locally on this device; leave blank to keep the saved one.">
        <input
          className="input" type="password" autoComplete="off" spellCheck={false}
          placeholder={saved ? '•••••••• (saved)' : 'sk-…'}
          value={cfg.apiKey} disabled={testing} onChange={e => set({ apiKey: e.target.value })}
        />
      </Field>
      <Field label="Model" hint="e.g. gpt-4o-mini">
        <input
          className="input" type="text" autoComplete="off" spellCheck={false}
          placeholder="gpt-4o-mini"
          value={cfg.model} disabled={testing} onChange={e => set({ model: e.target.value })}
        />
      </Field>
      <div className="chip-row">
        <button className="btn btn-primary btn-sm" onClick={onTest} disabled={testing}>{testing ? 'Testing…' : 'Save & test connection'}</button>
        {saved && <button className="btn btn-outline btn-sm" onClick={onClear} disabled={testing}>Clear</button>}
      </div>
      {/* A stable empty live region: dynamically inserted status nodes are
          announced unreliably, an always-present one is not (a11y rule). */}
      <p className="hint-text" role="status" style={{ margin: 0 }}>{result}</p>
    </div>
  )
}

// ============ Jev (TypeSafe System One) card ============
// The speed option: Jev only CLASSIFIES which capability the question needs
// (one tiny network call); the local deterministic handler then answers
// instantly. Faster than a full LLM answer, more intent-accurate than keyword
// matching. Falls back through LLM → offline exactly like the other paths.

function JevCard() {
  const [cfg, setCfg] = useState<JevConfig>(() => loadJevConfig() ?? { baseUrl: '', apiKey: '' })
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const saved = loadJevConfig()
  const testAbort = useRef<AbortController | null>(null)

  useEffect(() => () => {
    testAbort.current?.abort()
  }, [])

  async function onTest() {
    if (testing) return
    const err = saveJevConfig(cfg)
    if (err) { setResult(err); return }
    testAbort.current?.abort()
    const abort = new AbortController()
    testAbort.current = abort
    setTesting(true)
    setResult('')
    try {
      const failure = await testJevConnection(loadJevConfig()!, testAbort.current.signal)
      if (abort.signal.aborted) return
      setResult(failure
        ? `Saved, but the endpoint did not answer: ${failure} Until it connects, answers fall back to the LLM or the offline router.`
        : 'Connected — companion answers route through Jev.')
    } catch {
      if (abort.signal.aborted) return
      setResult('Could not reach the endpoint.')
    } finally {
      if (!abort.signal.aborted) {
        setTesting(false)
      }
    }
  }

  function onClear() {
    if (testing) return
    // Same deal as the endpoint above: the key came from elsewhere, so the clear
    // is undoable rather than final (#424).
    const previous = cfg
    clearJevConfig()
    setCfg({ baseUrl: '', apiKey: '' })
    setResult('Cleared — companion answers come from the LLM or offline router again.')
    undoToast('Saved router cleared', () => {
      saveJevConfig(previous)
      setCfg(previous)
      setResult('Restored the router you had saved.')
    })
  }

  return (
    <div className="card stack-gap">
      <div className="row-between">
        <h3>Jev intent router <span className="hint-text" style={{ fontWeight: 400 }}>(faster answers)</span></h3>
        <Chip tone={saved ? 'ok' : 'info'}>{saved ? 'Routing via Jev' : 'Not configured'}</Chip>
      </div>
      <p className="hint-text" style={{ margin: '6px 0 0' }}>
        Optional, and independent of the LLM above. Jev (TypeSafe System One) reads the question and picks which
        analysis to run — the answer itself is then computed on-device, so replies arrive after one small request
        instead of a full model generation. When configured it takes precedence over the LLM endpoint. The key is
        stored on this device only.
      </p>
      <Field label="Endpoint base URL" hint="e.g. https://api.typesafe.ai/v1 — everything before /systemone">
        <input
          className="input" type="url" inputMode="url" autoComplete="off" spellCheck={false}
          placeholder="https://api.typesafe.ai/v1"
          value={cfg.baseUrl} disabled={testing} onChange={e => setCfg(c => ({ ...c, baseUrl: e.target.value }))}
        />
      </Field>
      <Field label="TypeSafe API key" hint="Stored locally on this device only.">
        <input
          className="input" type="password" autoComplete="off" spellCheck={false}
          placeholder={saved ? '•••••••• (saved)' : 'ts-…'}
          value={cfg.apiKey} disabled={testing} onChange={e => setCfg(c => ({ ...c, apiKey: e.target.value }))}
        />
      </Field>
      <div className="chip-row">
        <button className="btn btn-primary btn-sm" onClick={onTest} disabled={testing}>{testing ? 'Testing…' : 'Save & test connection'}</button>
        {saved && <button className="btn btn-outline btn-sm" onClick={onClear} disabled={testing}>Clear</button>}
      </div>
      <p className="hint-text" role="status" style={{ margin: 0 }}>{result}</p>
    </div>
  )
}

// ============ Install card (PWA, web only) ============
// One honest affordance, only when it can actually do something: Chromium's
// captured install prompt, or the iOS Share-sheet hint. In the Capacitor shell
// (already an app) and once installed, the card renders nothing at all — and
// it says what installing DOES, not what we wish it did: offline reading of a
// saved plan is phase 2 and is deliberately not claimed here.
function InstallCard() {
  const [available, setAvailable] = useState(false)
  const [installed, setInstalled] = useState(false)

  useEffect(() => onInstallAvailability(setAvailable), [])

  if (isNative || installed || isStandalone()) return null
  const ios = isIosSafari()
  if (!available && !ios) return null

  return (
    <div className="card stack-gap">
      <h3>Install YatraFlow</h3>
      <p className="hint-text" style={{ margin: '6px 0 10px' }}>
        {ios
          ? 'On iPhone and iPad: tap Share, then “Add to Home Screen”. It opens in its own window, like an app.'
          : 'Adds YatraFlow to your home screen — its own window, its own icon, and a faster start.'}
      </p>
      {available && (
        <div className="chip-row">
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { void promptInstall().then(ok => { if (ok) setInstalled(true) }) }}
          >
            Install app
          </button>
        </div>
      )}
    </div>
  )
}
