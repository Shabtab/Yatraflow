// ============ Profile & settings ============
import { useEffect, useMemo, useRef, useState } from 'react'
import { InlineIcon } from '../components/icons'
import { Bell, LogOut, Mail, Moon, Sparkles, Sun } from 'lucide-react'
import { TravelStyle } from '../data/types'
import { TRAVEL_STYLES } from '../data/types'
import {
  useDb, currentUser, updateProfile, PROFILE_NOT_SAVED, tripsForUser, logout, notificationsFor, markAllNotificationsRead,
} from '../store/store'
import { Avatar, Chip, Field, toast, undoToast } from '../components/ui'
import { useTimeFormat, setTimeFormat, formatHM, type TimeFormat } from '../lib/timefmt'
import { isNative } from '../lib/native'
import { apkUpdateCheck } from '../lib/apkUpdateRuntime'
import { useApkUpdateStatus } from '../lib/useApkUpdate'
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
import { PageHeader } from '../components/page/PageHeader'
import { Surface } from '../components/page/Surface'
import { StateBlock } from '../components/page/StateBlock'
import { FilterChip } from '../components/filters/FilterChip'

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

/**
 * Android builds only: the installed native version, and the manual check.
 *
 * The states are the core's own, spoken plainly. Until boot answers, the panel
 * says it is reading the build — it never claims a configuration fault it has
 * not confirmed. A failed or offline check never blocks anything.
 * `unconfigured` disables the button, so a build with no feed never offers a
 * control that cannot work.
 */
function UpdatePanel() {
  const { booting, unavailable, installed, state } = useApkUpdateStatus()
  const [busy, setBusy] = useState(false)

  if (!isNative || unavailable === 'web' || unavailable === 'unsupported-app') return null

  const phase = state.phase
  const checking = busy || phase === 'checking'
  const line = booting
    ? 'Reading the installed build…'
    : unavailable === 'unconfigured'
      ? 'Update checks are not configured in this build.'
      : checking
        ? 'Checking for a newer build…'
        : phase === 'newer' && state.manifest
          ? `Version ${state.manifest.versionName} is available.`
          : phase === 'suppressed' && state.manifest
            ? `Version ${state.manifest.versionName} is available. Reminders are paused.`
            : phase === 'offline'
              ? 'No connection. You can check again later.'
              : phase === 'failed'
                ? 'The check failed. The app keeps working.'
                : phase === 'current'
                  ? 'You are on the newest build.'
                  : 'Check for a newer Android build.'

  async function run() {
    setBusy(true)
    await apkUpdateCheck({ manual: true })
    setBusy(false)
  }

  return (
    <Surface className="prof-panel">
      <h2 className="prof-panel-title">App updates</h2>
      <hr className="divider" />
      {installed && (
        <p className="small muted">
          Installed build {installed.versionName} (version code {installed.versionCode}).
        </p>
      )}
      <p className="hint-text prof-hint-tight" role="status" aria-live="polite">{line}</p>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={booting || checking || unavailable === 'unconfigured'}
        onClick={run}
      >
        Check for updates
      </button>
    </Surface>
  )
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
  // #704: the save button is disabled while the write is in flight, and a
  // refused save says why beside it. The typed values in `f` are never reset.
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
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
  // Shell-only relocated controls (the signed-in app hides the website
  // topnav): theme toggle, in-app notifications, account actions.
  // These hooks must stay ABOVE the `if (!me) return null` below. A hook that
  // sits under an early return crashes with "Rendered more hooks than during
  // the previous render" the moment the store hydrates after mount (CODING
  // STANDARDS rule 6e).
  const dark = useTheme()
  const notifs = useMemo(() => (me ? notificationsFor(me.id) : []), [me])
  // Not logged in: route to auth instead of rendering a blank page.
  const loggedIn = Boolean(me)
  useEffect(() => { if (!loggedIn) onNavigate('/auth') })
  if (!me) return null

  // `me` is non-null after the guard above, but TS drops the narrowing inside
  // a hoisted function declaration, so read it through a const it can follow.
  const me0 = me
  // Instant save: the chip takes the new value at once, because the store
  // applies the edit before the server answers. A refused write puts the saved
  // value back, so the chip reverts, and the toast says why.
  async function toggleStyle(s: TravelStyle) {
    const has = me0.profile.travelStyles.includes(s)
    const r = await updateProfile({ travelStyles: has ? me0.profile.travelStyles.filter(x => x !== s) : [...me0.profile.travelStyles, s] })
    if (!r.ok) toast(r.error ?? PROFILE_NOT_SAVED, 'err')
  }

  return (
    <div className="container form-page yf-page page-enter">
      <PageHeader
        headline={{ lead: 'Profile & settings' }}
        lede={<>{tripCount} trip{tripCount !== 1 ? 's' : ''} · {me.email}</>}
      />

      {/* #86: this page's content is a single column — the .two-col grid left
          a 340px empty gutter at desktop widths. A readable single column
          instead (max-width keeps line lengths sane on wide screens). */}
      <div className="profile-col">
        <div className="prof-col">
          <Surface className="prof-panel">
            <h2 className="prof-panel-title">Your details</h2>
            <hr className="divider" />
            <div className="creator-line prof-creator-lede">
              <Avatar user={me} size="lg" />
              <span className="small muted">Avatars use your initials in this MVP.</span>
            </div>
            <Field label="Display name" error={nameErr ?? undefined}><input className="input" ref={nameRef} autoComplete="name" value={f.name} onChange={e => { setF(x => ({ ...x, name: e.target.value })); if (nameErr) setNameErr(null) }} /></Field>
            <Field label="Home city"><input className="input" autoComplete="address-level2" value={f.homeCity} onChange={e => setF(x => ({ ...x, homeCity: e.target.value }))} placeholder="e.g. Kochi" /></Field>
            <Field label="Languages you speak" hint="Comma separated — e.g. en, hi, ml">
              <input className="input" value={f.languages} onChange={e => setF(x => ({ ...x, languages: e.target.value }))} />
            </Field>
          </Surface>

          <Surface className="prof-panel">
            <h2 className="prof-panel-title">Travel styles</h2>
            <p className="hint-text prof-hint-tight">Pick all that fit — helps collaborators know what kind of trip to invite you to.</p>
            <div className="chip-row">
              {TRAVEL_STYLES.map(s => (
                <FilterChip key={s} pressed={me.profile.travelStyles.includes(s)} onClick={() => toggleStyle(s)}>{cap(s)}</FilterChip>
              ))}
            </div>
          </Surface>

          <Surface className="prof-panel">
            <h2 className="prof-panel-title">Display preferences</h2>
            <hr className="divider" />
            <Field label="Clock format" hint={`Applies across the app. Example: ${formatHM('18:30', timeFormat)}`}>
              <div className="chip-row">
                {(['12h', '24h'] as TimeFormat[]).map(opt => (
                  <FilterChip key={opt} pressed={timeFormat === opt} onClick={() => setTimeFormat(opt)}>
                    {opt === '12h' ? '12h (AM/PM)' : '24h'}
                  </FilterChip>
                ))}
              </div>
            </Field>
          </Surface>

          {/* Android only: the installed build and the manual update check. */}
          <UpdatePanel />

          {/* The companion drawer mounts only under VITE_AI_COMPANION=on —
              its settings cards follow the same flag, so a build without the
              companion never shows settings for it. */}
          {AI_COMPANION_ENABLED && (
            <>
              <AiProviderCard />

              <JevCard />
            </>
          )}
        </div>

        <div className="prof-col">
          <Surface className="prof-panel">
            <div className="row-between">
              <h2 className="prof-panel-title">Creator hub</h2>
              <Chip tone={me.profile.isCreator ? 'ok' : 'info'}>{me.profile.isCreator ? 'Enabled' : 'Off'}</Chip>
            </div>
            <p className="hint-text prof-hint">
              {me.profile.isCreator
                ? 'Manage your creator profile, social links and published itineraries.'
                : 'A branding badge: your bio and social links appear on the itineraries you publish.'}
            </p>
            {me.profile.isCreator ? (
              <>
                <button className="btn btn-primary btn-sm" onClick={() => onNavigate('/creator-hub')}>Open creator hub</button>
                <a className="btn btn-outline btn-sm prof-btn-offset" {...appLink(`/creator/${me.id}`)}>View public page</a>
              </>
            ) : (
              <button className="btn btn-saffron" onClick={async () => {
                // The success line waits for the server. A refused write rolls
                // the creator state back to its saved value.
                const r = await updateProfile({ isCreator: true })
                if (r.ok) toast('Creator mode enabled — open the hub to add your bio and links.')
                else toast(r.error ?? PROFILE_NOT_SAVED, 'err')
              }}>
                Enable creator mode
              </button>
            )}
          </Surface>

          <Surface className="prof-panel">
            <h2 className="prof-panel-title">Save details</h2>
            <hr className="divider" />
            <button className="btn btn-primary" disabled={saving} onClick={async () => {
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
              setSaveErr(null)
              setSaving(true)
              // #704: "Profile saved" waits for the server. A refused save keeps
              // the typed values in the form and says why beside the button.
              const r = await updateProfile({
                name: f.name.trim(),
                homeCity: f.homeCity.trim() || undefined,
                languages: f.languages.split(',').map(s => s.trim()).filter(Boolean),
              })
              setSaving(false)
              if (r.ok) { toast('Profile saved'); return }
              setSaveErr(r.error ?? PROFILE_NOT_SAVED)
            }}>Save profile</button>
            {saveErr && <p className="err-text" role="alert">{saveErr}</p>}
            <button className="btn btn-ghost btn-sm prof-btn-offset" onClick={() => onNavigate('/trips')}>← Back to my trips</button>
          </Surface>

          <Surface className="prof-panel">
            <h2 className="prof-panel-title">Notifications</h2>
            <p className="hint-text prof-hint">
              Get an OS-level ping when a collaborator writes to you — even with
              YatraFlow in a background tab. The in-app bell always works; this
              just mirrors it to the system.
            </p>
            {!notifApi ? (
              <p className="hint-text">This browser doesn’t support notifications.</p>
            ) : notifPerm === 'denied' ? (
              <p className="hint-text">Notifications are blocked for this site — allow them in your browser’s site settings to turn this on.</p>
            ) : (
              <div className="row-between prof-notif-toggle">
                <span className="small prof-notif-label">
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
          </Surface>

          <Surface className="prof-panel">
            <h2 className="prof-panel-title">About your data</h2>
            <p className="hint-text prof-hint-mt">
              Your trips, votes and decisions are saved to your account, so they follow you between
              devices. Display preferences stay on this device. Costs and timings are transparent
              estimates — always verify prices before travelling.
            </p>
          </Surface>

          <InstallCard />

          {/* The signed-in Android shell hides the website topnav, so its
              controls relocate here — Profile is a bottom-nav destination. Each
              card is shell-only; the web keeps the topnav. */}
          {isNative && <>
            <Surface className="prof-panel">
              <h2 className="prof-panel-title">Appearance</h2>
              <p className="hint-text prof-hint">Light or dark — your choice sticks across trips.</p>
              <button
                className={`btn btn-sm ${dark ? 'btn-primary' : 'btn-outline'}`}
                aria-pressed={dark}
                onClick={() => setTheme(!dark)}
              >
                {dark ? <><InlineIcon icon={Sun} size={14} gap={6} />Light mode</> : <><InlineIcon icon={Moon} size={14} gap={6} />Dark mode</>}
              </button>
            </Surface>

            <Surface className="prof-panel">
              <div className="row-between prof-notif-head">
                <h2 className="prof-panel-title prof-notif-title">Notifications</h2>
                {notifs.length > 0 && notifs.some(n => !n.read) && (
                  <button className="btn btn-ghost btn-sm" onClick={() => markAllNotificationsRead(me.id)}>Mark all read</button>
                )}
              </div>
              {notifs.length === 0 ? (
                <StateBlock kind="empty" size="compact" title="No notifications yet" body="Collaborators writing to you will show up here." />
              ) : (
                <div className="prof-notif-list">
                  {notifs.slice(0, 8).map(n => (
                    <div key={n.id} className="row-between prof-notif-row">
                      <span style={{ opacity: n.read ? 0.6 : 1 }}>{n.text}</span>
                      <span className="muted small prof-notif-time">{formatTimeAgo(n.at)}</span>
                    </div>
                  ))}
                  {notifs.length > 8 && <span className="muted small">+{notifs.length - 8} older</span>}
                </div>
              )}
            </Surface>

            <Surface className="prof-panel">
              <h2 className="prof-panel-title">Account</h2>
              {me.profile.isCreator && (
                <button className="btn btn-outline btn-sm prof-btn-block" onClick={() => onNavigate('/creator-hub')}>
                  <InlineIcon icon={Sparkles} size={14} gap={6} />Creator hub
                </button>
              )}
              <div>
                <a className="btn btn-outline btn-sm prof-btn-block" href={feedbackHref()}>
                  <InlineIcon icon={Mail} size={14} gap={6} />Send feedback
                </a>
              </div>
              <button className="btn btn-danger btn-sm" onClick={() => { logout(); onNavigate('/') }}>
                <InlineIcon icon={LogOut} size={14} gap={6} />Log out
              </button>
            </Surface>
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
    <Surface className="prof-panel">
      <div className="row-between">
        <h2 className="prof-panel-title">AI companion</h2>
        <Chip tone={saved ? 'ok' : 'info'}>{saved ? 'LLM configured' : 'Not configured'}</Chip>
      </div>
      <p className="hint-text prof-hint-top">
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
      <p className="hint-text prof-status" role="status">{result}</p>
    </Surface>
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
    <Surface className="prof-panel">
      <div className="row-between">
        <h2 className="prof-panel-title">Jev intent router <span className="hint-text prof-heading-note">(faster answers)</span></h2>
        <Chip tone={saved ? 'ok' : 'info'}>{saved ? 'Routing via Jev' : 'Not configured'}</Chip>
      </div>
      <p className="hint-text prof-hint-top">
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
      <p className="hint-text prof-status" role="status">{result}</p>
    </Surface>
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
    <Surface className="prof-panel">
      <h2 className="prof-panel-title">Install YatraFlow</h2>
      <p className="hint-text prof-hint-tight">
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
    </Surface>
  )
}
