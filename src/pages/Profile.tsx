// ============ Profile & settings ============
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { InlineIcon } from '../components/icons'
import {
  Bell, Bot, CreditCard, Download, Link2, LogOut, Mail, Moon, ShieldCheck,
  SlidersHorizontal, Sparkles, Sun, UserRound,
} from 'lucide-react'
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
import { watchSectionHash } from '../lib/sectionNavigation'
import { appLink } from '../lib/appLink'
import { PageHeader } from '../components/page/PageHeader'
import { Surface } from '../components/page/Surface'
import { StateBlock } from '../components/page/StateBlock'
import { FilterChip } from '../components/filters/FilterChip'

/** The sections this page draws, in reading order, with the rail's icon. The
 *  rail is an anchor list over one long page, not a tablist: every section is
 *  present at once and the marks follow the scroll. Ids are `prof-<key>`.
 *
 *  `gated` names the build conditions a section needs. The rail is drawn from
 *  the sections that actually render, so a build without the companion never
 *  offers a jump link to a card that is not on the page. */
const SECTIONS = [
  ['details', 'Your details', UserRound],
  ['styles', 'Travel styles', Sparkles],
  ['display', 'Display and appearance', SlidersHorizontal],
  ['notify', 'Notifications', Bell],
  ['accounts', 'Connected accounts', Link2],
  ['creator', 'Creator hub and payouts', CreditCard],
  ['ai', 'AI companion', Bot, 'ai'],
  ['install', 'Install and updates', Download, 'install'],
  ['data', 'About your data', ShieldCheck],
  ['account', 'Account', LogOut],
] as const

/** The rail's rows and the page's sections, for the conditions this build meets. */
function visibleSections(keeps: { ai: boolean; install: boolean }) {
  return SECTIONS.filter(([, , , gate]) => !gate || keeps[gate as 'ai' | 'install'])
}

/** One panel: the artboard's icon tile, a heading and an optional subtitle.
 *  The tile carries the section's own mark, so the rail and the card agree. */
function PanelHead({ icon: Icon, title, note, mark }: {
  icon: typeof UserRound
  title: string
  note?: ReactNode
  /** Right-hand content on the heading row, such as a count or a status chip. */
  mark?: ReactNode
}) {
  return (
    <div className="prof-head">
      <span className="prof-tile" aria-hidden="true"><Icon size={18} /></span>
      <div className="prof-head-copy">
        <h2 className="prof-panel-title">{title}</h2>
        {note ? <p className="prof-head-note">{note}</p> : null}
      </div>
      {mark ? <div className="prof-head-mark">{mark}</div> : null}
    </div>
  )
}

/** A section of the page. The id is the rail's target and the entrance cascade
 *  keys off it, so a section can never be drawn without both.
 *
 *  `hidden` uses the HTML attribute, never an unmount. A section whose cards are
 *  all conditional must keep them MOUNTED so they can report whether they drew;
 *  returning null here killed the reporters before they ran, which is why the
 *  install and update cards could never appear. The attribute removes the
 *  section from layout, the accessibility tree and the tab order at once, so the
 *  empty section is neither visible nor a focus target.
 *
 *  `accent` names the section's role so two cards do not read as one long slab:
 *  travel and your details take the brand teal, the creator hub the marigold it
 *  already uses for payouts, and the AI companion Jev's purple. It reaches CSS
 *  as a data attribute and only tints the icon tile and the card's own hairline
 *  border — text, surfaces and every shared component stay neutral. Three
 *  accents for ten sections is deliberate: a hue per card would imply a status
 *  the decoration cannot carry, and there is no green or red here because no
 *  setting on this page is healthy or alarming. */
function Section({ id, label, hidden, accent, children }: {
  id: string
  label: string
  hidden?: boolean
  accent?: 'teal' | 'marigold' | 'jev'
  children: ReactNode
}) {
  return (
    <section id={`prof-${id}`} className="prof-section" aria-label={label} hidden={hidden} data-accent={accent}>
      {children}
    </section>
  )
}

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
function UpdatePanel({ onRenderable }: { onRenderable: (renderable: boolean) => void }) {
  const { booting, unavailable, installed, state } = useApkUpdateStatus()
  const [busy, setBusy] = useState(false)

  // Read before the early return, so the hook order is stable and the page can
  // tell whether the section has anything to show.
  const renderable = !(!isNative || unavailable === 'web' || unavailable === 'unsupported-app')
  useEffect(() => { onRenderable(renderable) }, [onRenderable, renderable])
  if (!renderable) return null

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
  // The rail marks the section you are reading, not just the ones you edited:
  // one observer over every anchor, and the first one crossing the reading line
  // wins. Everything below stays above the guard, because a hook under an early
  // return crashes when the store hydrates after mount.
  const [activeSection, setActiveSection] = useState<string>('details')
  /** On a phone the rail is a sideways strip. Keep the marked item in view. */
  const navRef = useRef<HTMLElement>(null)
  // A rail click states an intent that geometry cannot always honour: on a short
  // page the document clamps at its bottom before the clicked section reaches
  // the reading line, so honest measurement would mark the row above it. The
  // flag holds the click's answer until the reader actually scrolls again.
  const railClick = useRef(false)
  useEffect(() => {
    const nav = navRef.current
    if (!nav || nav.scrollWidth <= nav.clientWidth) return
    const item = nav.querySelector<HTMLElement>('[aria-current="true"]')
    if (!item) return
    const rail = nav.getBoundingClientRect(), row = item.getBoundingClientRect()
    if (row.left < rail.left) nav.scrollLeft += row.left - rail.left
    else if (row.right > rail.right) nav.scrollLeft += row.right - rail.right
  }, [activeSection])

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
  // The two gated sections report whether they drew anything, and the rail
  // follows: an anchor to a card this build does not render is a link that goes
  // nowhere. The AI cards always draw when their flag is on, so only the install
  // section is conditional. These sit above the guard for the same reason every
  // other hook does (CODING STANDARDS rule 6e).
  const [installShown, setInstallShown] = useState(false)
  // Each card owns its own verdict. Two cards writing one boolean meant the
  // second write always won, so a build with updates but no install prompt
  // reported "nothing" (or the reverse, depending on effect order). The section
  // shows when EITHER card draws.
  const [updateShown, setUpdateShown] = useState(false)
  const installSectionShown = updateShown || installShown
  // The rail's rows, for the conditions this build and this mount meet.
  const shownSections = visibleSections({ ai: AI_COMPANION_ENABLED, install: installSectionShown })
  // The observer follows what is actually on the page, keyed on the signed-in
  // user and the rendered section ids. That fixes the hydration case: the store
  // can answer after the first paint, so an effect keyed on nothing (or on a
  // count that happens to be unchanged) never re-attached and the rail stayed
  // frozen on "Your details". The key is a string, so it changes only when the
  // identity or the section set changes — never on a keystroke.
  const sectionKey = me ? `${me.id}:${shownSections.map(([key]) => key).join(',')}` : ''
  useEffect(() => {
    if (!sectionKey) return
    const els = [...document.querySelectorAll<HTMLElement>('.prof-main > .prof-section:not([hidden])')]
    if (els.length === 0) return

    // Which section is being read, decided absolutely rather than from the last
    // intersection batch. "First intersecting section" was wrong twice: near the
    // foot of the page several sections intersect at once, and the earliest one
    // in document order kept the mark, so "Account" could never take it. The
    // reading line includes the document's header offset and any extra margin
    // the section needs for the phone rail. The mark follows anchor jumps.
    const mark = () => {
      if (railClick.current) return
      const raw = getComputedStyle(document.documentElement).scrollPaddingTop
      const sectionMargin = getComputedStyle(els[0]).scrollMarginTop
      const line = (Number.parseFloat(raw) || 0) + (Number.parseFloat(sectionMargin) || 0)
      let active = els[0]
      for (const el of els) if (el.getBoundingClientRect().top <= line + 1) active = el
      // At the foot of the page the document cannot scroll further, so the last
      // sections never cross the line, no matter how far the reader goes.
      // Whoever is at the bottom is reading the last section.
      const atBottom = Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 2
      if (atBottom) active = els[els.length - 1]
      setActiveSection(active.id.replace('prof-', ''))
    }

    const io = new IntersectionObserver(mark, { rootMargin: '-96px 0px -60% 0px', threshold: 0 })
    els.forEach(el => io.observe(el))
    const unwatchHash = watchSectionHash(els.map(el => el.id), id => {
      railClick.current = id !== null
      if (id) setActiveSection(id.replace('prof-', ''))
      else mark()
    })
    // An intersection fires only when a section crosses the band. Scrolling
    // between two crossings changes which section is at the line without any
    // crossing at all, so the scroll itself recomputes. `passive` and a plain
    // read mean this cannot cause a layout thrash loop, and it is torn down with
    // the observer.
    window.addEventListener('scroll', mark, { passive: true })
    window.addEventListener('resize', mark)
    // The reader's own gestures release the rail's click intent. A wheel, a
    // touch drag, a key press or a drag on the scrollbar is the reader taking
    // over; a smooth scroll from the jump is not, so it keeps the mark.
    const release = () => { railClick.current = false }
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) {
      window.addEventListener(type, release, { passive: true })
    }
    return () => {
      unwatchHash()
      io.disconnect()
      window.removeEventListener('scroll', mark)
      window.removeEventListener('resize', mark)
      for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) {
        window.removeEventListener(type, release)
      }
    }
  }, [sectionKey])
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

  const socialLinks = me.profile.socialLinks ?? {}
  const socialRows = ([
    ['YouTube', socialLinks.youtube],
    ['Instagram', socialLinks.instagram],
  ] as const).filter(([, url]) => Boolean(url))

  return (
    <div className="container form-page yf-page page-enter prof-page">
      <PageHeader
        headline={{ lead: 'Profile & settings' }}
        lede={<>{tripCount} trip{tripCount !== 1 ? 's' : ''} · {me.email}</>}
      />

      {/* The artboard's three columns: the rail, the form, the supporting rail.
          At 1180 the supporting rail drops under the form; at 860 the rail
          becomes a sticky strip, as the Settings tab's does. */}
      <div className="prof-grid">
        <nav ref={navRef} className="prof-nav yf-surface" aria-label="Settings sections">
          <span className="prof-nav-lbl">Profile and settings</span>
          {shownSections.map(([key, label, Icon]) => (
            <a key={key} href={`#prof-${key}`}
              className="prof-nav-item"
              onClick={() => {
                // The row stays marked until the reader gives an input that means
                // "I am scrolling on my own". A timer cannot tell a programmatic
                // jump from a real one, and this page is short enough that a jump
                // to a late section lands at the document foot, where honest
                // measurement would immediately mark the section below it.
                railClick.current = true
                setActiveSection(key)
              }}
              aria-current={activeSection === key ? 'true' : undefined}>
              <Icon size={16} aria-hidden />
              <span>{label}</span>
            </a>
          ))}
        </nav>

        <div className="prof-main">
          <Section id="details" label="Your details" accent="teal">
            <Surface className="prof-panel">
              <PanelHead icon={UserRound} title="Your details"
                note="Shown on trips you share and on the itineraries you publish." />
              <div className="prof-avatar-row">
                <Avatar user={me} size="lg" />
                <div className="prof-avatar-copy">
                  <b>Avatars use your initials in this MVP.</b>
                  <span className="muted small">Photo avatars are not built yet.</span>
                </div>
              </div>
              <div className="prof-pair">
                <Field label="Display name" error={nameErr ?? undefined}><input className="input" ref={nameRef} autoComplete="name" value={f.name} onChange={e => { setF(x => ({ ...x, name: e.target.value })); if (nameErr) setNameErr(null) }} /></Field>
                <Field label="Home city"><input className="input" autoComplete="address-level2" value={f.homeCity} onChange={e => setF(x => ({ ...x, homeCity: e.target.value }))} placeholder="e.g. Kochi" /></Field>
              </div>
              <Field label="Languages you speak" hint="Comma separated. E.g. en, hi, ml">
                <input className="input" value={f.languages} onChange={e => setF(x => ({ ...x, languages: e.target.value }))} />
              </Field>
              {/* The Save control sits beside the fields it validates. The
                  handler, the pending state, the refusal message and the
                  scroll-to-error are the ones this page always had. */}
              <div className="prof-save-row">
                <button className="btn btn-primary" disabled={saving} onClick={async () => {
                  // Inline validation — the name silently reverting to the old one
                  // read as "save doesn't work". Say so, next to the field.
                  if (!f.name.trim()) {
                    setNameErr('Pick a display name. It shows on shared trips.')
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
              </div>
            </Surface>
          </Section>

          <Section id="styles" label="Travel styles" accent="teal">
            <Surface className="prof-panel">
              <PanelHead icon={Sparkles} title="Travel styles"
                note="Pick all that fit. Helps collaborators know what kind of trip to invite you to."
                mark={<Chip tone="teal">{me.profile.travelStyles.length} picked</Chip>} />
              <div className="prof-style-grid">
                {TRAVEL_STYLES.map(s => (
                  <FilterChip key={s} className="prof-chip" pressed={me.profile.travelStyles.includes(s)} onClick={() => toggleStyle(s)}>{cap(s)}</FilterChip>
                ))}
              </div>
            </Surface>
          </Section>

          <Section id="display" label="Display and appearance">
            <Surface className="prof-panel">
              <PanelHead icon={SlidersHorizontal} title="Display and appearance"
                note="How the app reads. These stay on this device." />
              <Field label="Clock format" hint={`Applies across the app. Example: ${formatHM('18:30', timeFormat)}`}>
                <div className="chip-row">
                  {(['12h', '24h'] as TimeFormat[]).map(opt => (
                    <FilterChip key={opt} className="prof-chip" pressed={timeFormat === opt} onClick={() => setTimeFormat(opt)}>
                      {opt === '12h' ? '12h (AM/PM)' : '24h'}
                    </FilterChip>
                  ))}
                </div>
              </Field>
              {isNative && (
                <div className="row-between prof-notif-toggle">
                  <span className="small prof-notif-label"><Moon size={14} aria-hidden /> Dark theme</span>
                  <button
                    className={`btn btn-sm ${dark ? 'btn-primary' : 'btn-outline'}`}
                    aria-pressed={dark}
                    onClick={() => setTheme(!dark)}
                  >
                    {dark ? <><InlineIcon icon={Sun} size={14} gap={6} />Light mode</> : <><InlineIcon icon={Moon} size={14} gap={6} />Dark mode</>}
                  </button>
                </div>
              )}
            </Surface>
          </Section>

          <Section id="notify" label="Notifications">
            <Surface className="prof-panel">
              <PanelHead icon={Bell} title="Notifications"
                note="One per-tab ping, mirrored to the system while YatraFlow is open." />
              <p className="hint-text prof-hint">
                Get an OS-level ping when a collaborator writes to you. Even with
                YatraFlow in a background tab. The in-app bell always works; this
                just mirrors it to the system.
              </p>
              {!notifApi ? (
                <p className="hint-text">This browser doesn’t support notifications.</p>
              ) : notifPerm === 'denied' ? (
                <p className="hint-text">Notifications are blocked for this site. Allow them in your browser’s site settings to turn this on.</p>
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
                        toast('Browser notifications on. We’ll ping you from background tabs.')
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
              {/* The Android shell also keeps the in-app inbox here. */}
              {isNative && (
                <div className="prof-inbox">
                  <div className="row-between prof-notif-head">
                    <h3 className="prof-sub-title">In-app inbox</h3>
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
                </div>
              )}
            </Surface>
          </Section>

          <Section id="accounts" label="Connected accounts">
            <Surface className="prof-panel">
              <PanelHead icon={Link2} title="Connected accounts"
                note="The creator links you saved in Creator hub. They appear on the itineraries you publish." />
              {socialRows.length === 0 ? (
                <p className="hint-text">
                  {me.profile.isCreator
                    ? 'No creator links saved yet. Add YouTube or Instagram links in Creator hub.'
                    : 'Creator links appear here once you enable creator mode and save them in Creator hub.'}
                </p>
              ) : (
                <ul className="prof-link-list">
                  {socialRows.map(([label, url]) => (
                    <li key={label} className="prof-link-row">
                      <span className="prof-link-name">{label}</span>
                      <a className="prof-link-url" href={url} target="_blank" rel="noopener noreferrer">{url}</a>
                    </li>
                  ))}
                </ul>
              )}
              {me.profile.isCreator
                ? <button className="btn btn-outline btn-sm" onClick={() => onNavigate('/creator-hub')}>Edit links in Creator hub</button>
                : null}
            </Surface>
          </Section>

          <Section id="creator" label="Creator hub and payouts" accent="marigold">
            <Surface className="prof-panel">
              <PanelHead icon={CreditCard} title="Creator hub and payouts"
                mark={<Chip tone={me.profile.isCreator ? 'ok' : 'info'}>{me.profile.isCreator ? 'Enabled' : 'Off'}</Chip>} />
              <p className="hint-text prof-hint">
                {me.profile.isCreator
                  ? 'Manage your creator profile, social links and published itineraries.'
                  : 'A branding badge: your bio and social links appear on the itineraries you publish.'}
              </p>
              {me.profile.isCreator ? (
                <div className="prof-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => onNavigate('/creator-hub')}>Open creator hub</button>
                  <a className="btn btn-outline btn-sm" {...appLink(`/creator/${me.id}`)}>View public page</a>
                </div>
              ) : (
                <button className="btn btn-saffron" onClick={async () => {
                  // The success line waits for the server. A refused write rolls
                  // the creator state back to its saved value.
                  const r = await updateProfile({ isCreator: true })
                  if (r.ok) toast('Creator mode enabled. Open the hub to add your bio and links.')
                  else toast(r.error ?? PROFILE_NOT_SAVED, 'err')
                }}>
                  Enable creator mode
                </button>
              )}
            </Surface>
          </Section>

          {/* The companion drawer mounts only under VITE_AI_COMPANION=on —
              its settings cards follow the same flag, so a build without the
              companion never shows settings for it. */}
          {AI_COMPANION_ENABLED && (
            <Section id="ai" label="AI companion" accent="jev">
              <AiProviderCard />

              <JevCard />
            </Section>
          )}

          {/* Both cards stay MOUNTED so each can report whether it drew; the
              section carries `hidden`, so the rail never offers a jump link and
              the empty section takes no space and no tab stop. */}
          <Section id="install" label="Install and updates" hidden={!installSectionShown}>
            <UpdatePanel onRenderable={setUpdateShown} />
            <InstallCard onRenderable={setInstallShown} />
          </Section>

          <Section id="data" label="About your data">
            <Surface className="prof-panel">
              <PanelHead icon={ShieldCheck} title="About your data" note="Where each kind of thing lives." />
              <ul className="prof-data-rows">
                <li className="prof-data-row"><span className="prof-data-rail" aria-hidden="true" /><b>Trips, votes and decisions</b><span>Saved to your account, so they follow you between devices.</span></li>
                <li className="prof-data-row"><span className="prof-data-rail" aria-hidden="true" /><b>Display preferences</b><span>Stay on this device.</span></li>
                <li className="prof-data-row"><span className="prof-data-rail" aria-hidden="true" /><b>AI endpoint and key</b><span>Stored on this device only, never sent to YatraFlow’s servers.</span></li>
                <li className="prof-data-row"><span className="prof-data-rail" aria-hidden="true" /><b>Costs and timings</b><span>Transparent estimates. Always verify prices before travelling.</span></li>
              </ul>
            </Surface>
          </Section>

          <Section id="account" label="Account">
            <Surface className="prof-panel">
              <PanelHead icon={LogOut} title="Account" note={`Signed in as ${me.profile.name || me.email}.`} />
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
              <button className="btn btn-ghost btn-sm prof-btn-block" onClick={() => onNavigate('/trips')}>← Back to my trips</button>
              <button className="btn btn-danger btn-sm" onClick={() => { logout(); onNavigate('/') }}>
                <InlineIcon icon={LogOut} size={14} gap={6} />Log out
              </button>
            </Surface>
          </Section>
        </div>

        {/* The supporting rail. Everything here is drawn from the profile the
            user already saved — no score, no follower count, no timestamp. */}
        <aside className="prof-aside" aria-label="How others see you">
          <Surface className="prof-panel">
            <PanelHead icon={UserRound} title="How others see you"
              note="Collaborators see this on shared trips. Buyers see it on your routes." />
            <div className="prof-preview">
              <div className="prof-preview-head">
                <Avatar user={me} size="lg" />
                <div className="prof-preview-id">
                  <b>{me.profile.name || 'Your name'}</b>
                  <span className="muted small">
                    {[me.profile.homeCity, me.profile.languages.join(', ')].filter(Boolean).join(' · ') || 'Add a home city and your languages.'}
                  </span>
                </div>
                {me.profile.isCreator && <Chip tone="teal">Creator</Chip>}
              </div>
              {me.profile.travelStyles.length > 0
                ? <div className="chip-row prof-preview-chips">{me.profile.travelStyles.map(s => <span key={s} className="prof-tag">{cap(s)}</span>)}</div>
                : <p className="muted small">No travel styles picked yet.</p>}
              {me.profile.creatorBio && <p className="small prof-preview-bio">{me.profile.creatorBio}</p>}
            </div>
          </Surface>
        </aside>
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
        : 'Connected. The companion will answer with this model.')
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
    setResult('Cleared. The companion answers offline (deterministic) again.')
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
        Optional. Point the companion at any OpenAI-compatible endpoint and it answers with that model. Grounded in this
        trip's data. Without one it uses the built-in deterministic assistant. The key is stored on this device only and
        is never sent to YatraFlow's servers.
      </p>
      <Field label="Endpoint base URL" hint="e.g. https://api.openai.com/v1. Everything before /chat/completions">
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
        : 'Connected. Companion answers route through Jev.')
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
    setResult('Cleared. Companion answers come from the LLM or offline router again.')
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
        analysis to run. The answer itself is then computed on-device, so replies arrive after one small request
        instead of a full model generation. When configured it takes precedence over the LLM endpoint. The key is
        stored on this device only.
      </p>
      <Field label="Endpoint base URL" hint="e.g. https://api.typesafe.ai/v1. Everything before /systemone">
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
function InstallCard({ onRenderable }: { onRenderable: (renderable: boolean) => void }) {
  const [available, setAvailable] = useState(false)
  const [installed, setInstalled] = useState(false)

  useEffect(() => onInstallAvailability(setAvailable), [])

  // Every condition is read before any early return, so the hooks above always
  // run in the same order and the page can tell whether the section has content.
  const ios = isIosSafari()
  const renderable = !isNative && !installed && !isStandalone() && (available || ios)
  useEffect(() => { onRenderable(renderable) }, [onRenderable, renderable])
  if (!renderable) return null

  return (
    <Surface className="prof-panel">
      <h2 className="prof-panel-title">Install YatraFlow</h2>
      <p className="hint-text prof-hint-tight">
        {ios
          ? 'On iPhone and iPad: tap Share, then “Add to Home Screen”. It opens in its own window, like an app.'
          : 'Adds YatraFlow to your home screen. Its own window, its own icon, and a faster start.'}
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
