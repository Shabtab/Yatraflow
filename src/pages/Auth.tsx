// ============ Auth page ============
import { useEffect, useRef, useState } from 'react'
import { InlineIcon } from '../components/icons'
import { TriangleAlert } from 'lucide-react'
import { SegmentedTabs } from '../components/page/SegmentedTabs'
import { useDb, currentUser, login, signup } from '../store/store'
import { isSupabaseConfigured } from '../lib/supabase'
import { isAdultSignup } from '../lib/ageGate'
import { looksLikeEmail } from '../lib/emailShape'
import { currentQuery } from '../lib/router'
import { authNext } from '../lib/authNext'
import { MISSING_BACKEND_MESSAGE } from '../lib/authErrors'
import { Field } from '../components/ui'
import { DobPicker } from '../components/DobPicker'

/** Post-login destination: the `next` param when the auth page was entered
 *  from a deep link (an invite), else My Trips. The param is
 *  attacker-controllable input, so it is validated as a same-app route:
 *  must start with a single "/" and contain only path characters — no
 *  scheme ("https:"), no protocol-relative "//host", no query injection. */
function nextRoute(): string {
  return authNext(currentQuery().get('next'))
}

/** The two tabs of the form. Each tab names the panel it controls. */
const AUTH_TABS = [
  { key: 'login', label: 'Log in', id: 'auth-tab-login', controls: 'auth-panel' },
  { key: 'signup', label: 'Create account', id: 'auth-tab-signup', controls: 'auth-panel' },
] as const

/** The message shown after sign-up when the new account waits for its email
 *  link. The store reports that state as a field, and this page owns the copy.
 *  tests/auth-notice.test.ts pins the field. */
const CONFIRM_EMAIL_COPY = 'Check your email to confirm your account, then log in.'

export function AuthPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const [mode, setMode] = useState<'login' | 'signup'>(currentQuery().get('mode') === 'signup' ? 'signup' : 'login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Success or info copy for the form, such as "check your email". It is kept
   *  apart from `error`: a new error clears it, and a new notice clears an error. */
  const [notice, setNotice] = useState<string | null>(null)
  /** Field-scoped errors. The form-level `error` above is for failures with
   *  no single field to blame (bad credentials, network); a field's own
   *  failure (empty name, short password) belongs on that field, marked and
   *  focused (review finding 5 — the password check used to post to the
   *  form-level alert instead). */
  const [nameErr, setNameErr] = useState<string | null>(null)
  const [passwordErr, setPasswordErr] = useState<string | null>(null)
  const [dob, setDob] = useState('')
  const [dobErr, setDobErr] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const dobRef = useRef<HTMLSelectElement>(null)
  // Today as YYYY-MM-DD (local): the date input's max, so the picker cannot
  // offer a future day.
  const now = new Date()
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  /** The form-level alert, for failures no single field owns. */
  const errRef = useRef<HTMLDivElement>(null)

  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (me) onNavigate(nextRoute()) // already logged in — back to where the link pointed
  }, [me]) // eslint-disable-line react-hooks/exhaustive-deps

  // A form-level failure has no single field to blame, and the submit is the
  // last control in the card — so without this the next Tab leaves the form and
  // a screen reader hears an alert the keyboard never reaches. CreateTrip's
  // F-15 rule focuses its alert for exactly this case.
  useEffect(() => {
    if (error) errRef.current?.focus()
  }, [error])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setNameErr(null)
    setPasswordErr(null)
    setDobErr(null)
    setSaving(true)
    // Safety net: if the session never materialises (e.g. hydration failure),
    // re-enable the form so the user isn't stuck on a disabled button.
    const failSafe = setTimeout(() => setSaving(false), 10000)
    // The form sets noValidate, so the browser shows no bubble of its own. A
    // filled email field with the wrong shape gets the form error line here.
    if (email.trim() && !looksLikeEmail(email)) {
      clearTimeout(failSafe)
      setError('Enter a valid email address.')
      setSaving(false)
      return
    }
    if (mode === 'login') {
      // The server answers an empty request with its own text. The page
      // asks for the fields first, so an empty form never reaches the server.
      if (!email.trim() || !password) {
        clearTimeout(failSafe)
        setError('Enter your email and password.')
        setSaving(false)
        return
      }
      const r = await login(email, password)
      if (!r.ok) { clearTimeout(failSafe); setError(r.error ?? 'Login failed'); setSaving(false); return }
    } else {
      if (!name.trim()) {
        clearTimeout(failSafe)
        setNameErr('Tell us your name.')
        setSaving(false)
        // Field-level error + focus, matching CreateTrip's F-15 rule: the
        // message goes on the field that failed, and focus follows it, so
        // nobody has to hunt for what broke.
        nameRef.current?.focus()
        return
      }
      if (password.length < 8) {
        clearTimeout(failSafe)
        setPasswordErr('Passwords need at least 8 characters.')
        setSaving(false)
        // Field-level, like the name check above: the message goes on the
        // field that failed and focus follows it.
        passwordRef.current?.focus()
        return
      }
      // Adults-only signup (see lib/ageGate for the why). The date of birth
      // is checked here and never stored.
      if (!isAdultSignup(dob, new Date())) {
        clearTimeout(failSafe)
        setDobErr('You need to be 18 or older to create an account.')
        setSaving(false)
        // Field-level, like the checks above: the message goes on the field
        // that failed and focus follows it.
        dobRef.current?.focus()
        return
      }
      const r = await signup(name, email, password)
      if (!r.ok) { clearTimeout(failSafe); setError(r.error ?? 'Signup failed'); setSaving(false); return }
      // The account waits for its email link. That is a notice, not a failure.
      if (r.needsConfirmation) { clearTimeout(failSafe); setNotice(CONFIRM_EMAIL_COPY); setSaving(false); return }
    }
    // Deliberately do NOT navigate here. The store hydrates asynchronously on
    // the auth event; navigating before `me` is set makes the router fall
    // through to the landing page. The `me` effect below navigates once the
    // session is actually visible to the app.
  }

  // The tab row is SegmentedTabs in its tablist variant. It gives role="tab",
  // aria-selected, a roving tabindex, and the arrow, Home and End keys. The form
  // sits in one panel whose label follows the active tab. Every switch clears
  // every message. A stale error never follows the user to the other form.
  function switchMode(key: string) {
    setMode(key === 'signup' ? 'signup' : 'login')
    setError(null); setNotice(null); setNameErr(null); setPasswordErr(null); setDobErr(null)
  }

  return (
    <div className="auth-wrap page-enter">
      <div className="card auth-card">
        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="muted small auth-description">
          {mode === 'login' ? 'Log in to your trip plans.' : 'Free to plan. No card needed.'}
        </p>

        <SegmentedTabs semantics="tablist" className="tabbar auth-tabs" label="Login or sign up" items={AUTH_TABS} value={mode} onChange={switchMode} />

        {/* Say so up front: a build with no Supabase project compiled in can
            only ever fail, and "Failed to fetch" blames the wrong thing. */}
        {!isSupabaseConfigured && (
          <div className="err-text auth-backend-warning" role="status">
            <InlineIcon icon={TriangleAlert} size={13} gap={4} /><strong>This build has no backend configured.</strong>
            <div className="small auth-backend-detail">{MISSING_BACKEND_MESSAGE}</div>
          </div>
        )}

        {/* `role="tabpanel"` is not permitted on `<form>`, so the panel wrapper
            carries it (and the id the tablist's aria-controls points at); the
            form inside stays a plain form. */}
        <div id="auth-panel" role="tabpanel" aria-labelledby={mode === 'login' ? 'auth-tab-login' : 'auth-tab-signup'}>
        <form onSubmit={submit} noValidate>
          {mode === 'signup' && (
            <Field label="Your name" error={nameErr ?? undefined}>
              <input className="input" name="name" autoComplete="name" ref={nameRef} value={name}
                onChange={e => { setName(e.target.value); if (nameErr) setNameErr(null) }} placeholder="e.g. Meera Nair" />
            </Field>
          )}
          {mode === 'signup' && (
            <Field label="Date of birth" hint="Checked at signup. Never stored." error={dobErr ?? undefined}>
              <DobPicker focusRef={dobRef} value={dob} max={todayISO}
                onChange={v => { setDob(v); if (dobErr) setDobErr(null) }} />
            </Field>
          )}
          <Field label="Email"><input className="input" type="email" name="email" autoComplete="email" spellCheck={false} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
          <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters' : undefined} error={passwordErr ?? undefined}>
            <input className="input" type="password" name="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={mode === 'signup' ? 8 : undefined} value={password} onChange={e => { setPassword(e.target.value); if (passwordErr) setPasswordErr(null) }} placeholder="••••••••" ref={passwordRef} />
          </Field>
          {/* A live region that stays in the DOM. A status node inserted with
              its text is announced unreliably, so only its copy changes. */}
          <div role="status" aria-live="polite">
            {notice && <div className="hub-note auth-submit-notice">{notice}</div>}
          </div>
          {error && <div className="err-text auth-submit-error" role="alert" tabIndex={-1} ref={errRef}><InlineIcon icon={TriangleAlert} size={13} gap={4} />{error}</div>}
          <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={saving}>
            {saving ? (mode === 'login' ? 'Signing in…' : 'Creating account…') : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
          {mode === 'login' && (
            <p className="hint-text auth-reset-help">
              Forgot your password? Resets aren’t self-serve yet.{' '}
              <a className="text-link" href="mailto:support@yatraflow.app?subject=Reset%20my%20YatraFlow%20password">Mail support and we’ll reset it</a>.
            </p>
          )}
        </form>
        </div>

        <p className="hint-text auth-sample-note">
          Three sample trips arrive in My Trips on first sign-in. Delete them any time.
        </p>
      </div>
    </div>
  )
}
