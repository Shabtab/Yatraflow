// ============ Auth page ============
import { useEffect, useRef, useState } from 'react'
import { InlineIcon } from '../components/icons'
import { TriangleAlert } from 'lucide-react'
import { PillNav } from '../components/PillNav'
import { useTablist } from '../hooks/useTablist'
import { useDb, currentUser, login, signup } from '../store/store'
import { isSupabaseConfigured } from '../lib/supabase'
import { currentQuery } from '../lib/router'
import { MISSING_BACKEND_MESSAGE } from '../lib/authErrors'
import { Field } from '../components/ui'

/** Post-login destination: the `next` param when the auth page was entered
 *  from a deep link (an invite), else My Trips. The param is
 *  attacker-controllable input, so it is validated as a same-app route:
 *  must start with a single "/" and contain only path characters — no
 *  scheme ("https:"), no protocol-relative "//host", no query injection. */
function nextRoute(): string {
  const raw = currentQuery().get('next')
  if (!raw) return '/trips'
  const decoded = (() => { try { return decodeURIComponent(raw) } catch { return raw } })()
  if (!/^\/[a-z0-9\-/]*$/i.test(decoded) || decoded.includes('//')) return '/trips'
  return decoded
}

const AUTH_MODES = ['login', 'signup'] as const

export function AuthPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const [mode, setMode] = useState<'login' | 'signup'>(currentQuery().get('mode') === 'signup' ? 'signup' : 'login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Field-scoped errors. The form-level `error` above is for failures with
   *  no single field to blame (bad credentials, network); a field's own
   *  failure (empty name, short password) belongs on that field, marked and
   *  focused (review finding 5 — the password check used to post to the
   *  form-level alert instead). */
  const [nameErr, setNameErr] = useState<string | null>(null)
  const [passwordErr, setPasswordErr] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
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
    setNameErr(null)
    setPasswordErr(null)
    setSaving(true)
    // Safety net: if the session never materialises (e.g. hydration failure),
    // re-enable the form so the user isn't stuck on a disabled button.
    const failSafe = setTimeout(() => setSaving(false), 10000)
    if (mode === 'login') {
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
      const r = await signup(name, email, password)
      if (!r.ok) { clearTimeout(failSafe); setError(r.error ?? 'Signup failed'); setSaving(false); return }
    }
    // Deliberately do NOT navigate here. The store hydrates asynchronously on
    // the auth event; navigating before `me` is set makes the router fall
    // through to the landing page. The `me` effect below navigates once the
    // session is actually visible to the app.
  }

  // #87: this was a role="tablist" whose children were aria-pressed buttons —
  // a spec mismatch. Now proper tabs: role="tab", aria-selected, roving
  // tabindex, arrow/Home/End. The form sits in one panel whose label follows the
  // active tab (the fields differ only by the name row).
  const { refs, tabProps } = useTablist(AUTH_MODES, mode, m => { setMode(m); setError(null); setNameErr(null); setPasswordErr(null) })

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1 className="auth-title">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="muted small" style={{ marginTop: 4 }}>
          {mode === 'login' ? 'Log in to your trip plans.' : 'Free to plan. No card needed.'}
        </p>

        <PillNav className="tabbar auth-tabs" role="tablist" aria-label="Login or sign up" activeKey={mode}>
          <button ref={refs(0)} className={`tab-btn${mode === 'login' ? ' active' : ''}`} type="button" role="tab" id="auth-tab-login" data-pill-key="login"
            aria-selected={mode === 'login'} aria-controls="auth-panel"
            onClick={() => { setMode('login'); setError(null); setNameErr(null); setPasswordErr(null) }} {...tabProps('login', 0)}>Log in</button>
          <button ref={refs(1)} className={`tab-btn${mode === 'signup' ? ' active' : ''}`} type="button" role="tab" id="auth-tab-signup" data-pill-key="signup"
            aria-selected={mode === 'signup'} aria-controls="auth-panel"
            onClick={() => { setMode('signup'); setError(null); setNameErr(null); setPasswordErr(null) }} {...tabProps('signup', 1)}>Create account</button>
        </PillNav>

        {/* Say so up front: a build with no Supabase project compiled in can
            only ever fail, and "Failed to fetch" blames the wrong thing. */}
        {!isSupabaseConfigured && (
          <div className="err-text" style={{ marginBottom: 12 }}>
            <InlineIcon icon={TriangleAlert} size={13} gap={4} /><strong>This build has no backend configured.</strong>
            <div className="small" style={{ marginTop: 4 }}>{MISSING_BACKEND_MESSAGE}</div>
          </div>
        )}

        {/* `role="tabpanel"` is not permitted on `<form>`, so the panel wrapper
            carries it (and the id the tablist's aria-controls points at); the
            form inside stays a plain form. */}
        <div id="auth-panel" role="tabpanel" aria-labelledby={mode === 'login' ? 'auth-tab-login' : 'auth-tab-signup'}>
        <form onSubmit={submit}>
          {mode === 'signup' && (
            <Field label="Your name" error={nameErr ?? undefined}>
              <input className="input" name="name" autoComplete="name" ref={nameRef} value={name}
                onChange={e => { setName(e.target.value); if (nameErr) setNameErr(null) }} placeholder="e.g. Meera Nair" />
            </Field>
          )}
          <Field label="Email"><input className="input" type="email" name="email" autoComplete="email" spellCheck={false} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
          <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters' : undefined} error={passwordErr ?? undefined}>
            <input className="input" type="password" name="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={mode === 'signup' ? 8 : undefined} value={password} onChange={e => { setPassword(e.target.value); if (passwordErr) setPasswordErr(null) }} placeholder="••••••••" ref={passwordRef} />
          </Field>
          {error && <div className="err-text" role="alert" tabIndex={-1} ref={errRef} style={{ marginBottom: 10 }}><InlineIcon icon={TriangleAlert} size={13} gap={4} />{error}</div>}
          <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={saving}>
            {saving ? (mode === 'login' ? 'Signing in…' : 'Creating account…') : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
          {mode === 'login' && (
            <p className="hint-text" style={{ margin: '10px 0 0', textAlign: 'center' }}>
              Forgot your password? Resets aren’t self-serve yet.{' '}
              <a className="text-link" href="mailto:support@yatraflow.app?subject=Reset%20my%20YatraFlow%20password">Mail support and we’ll reset it</a>.
            </p>
          )}
        </form>
        </div>

        <p className="hint-text" style={{ textAlign: 'center', marginTop: 14 }}>
          Three sample trips arrive in My Trips on first sign-in. Delete them any time.
        </p>
      </div>
    </div>
  )
}
