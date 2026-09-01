// ============ Auth page ============
import { useEffect, useState } from 'react'
import { useDb, currentUser, login, signup } from '../store/store'
import { isSupabaseConfigured } from '../lib/supabase'
import { MISSING_BACKEND_MESSAGE } from '../lib/authErrors'
import { Field } from '../components/ui'

export function AuthPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  const db = useDb()
  const me = currentUser(db)
  const [mode, setMode] = useState<'login' | 'signup'>(location.hash.includes('mode=signup') ? 'signup' : 'login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (me) onNavigate('/trips') // already logged in
  }, [me]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    // Safety net: if the session never materialises (e.g. hydration failure),
    // re-enable the form so the user isn't stuck on a disabled button.
    const failSafe = setTimeout(() => setSaving(false), 10000)
    if (mode === 'login') {
      const r = await login(email, password)
      if (!r.ok) { clearTimeout(failSafe); setError(r.error ?? 'Login failed'); setSaving(false); return }
    } else {
      if (!name.trim()) { clearTimeout(failSafe); setError('Tell us your name.'); setSaving(false); return }
      const r = await signup(name, email, password)
      if (!r.ok) { clearTimeout(failSafe); setError(r.error ?? 'Signup failed'); setSaving(false); return }
    }
    // Deliberately do NOT navigate here. The store hydrates asynchronously on
    // the auth event; navigating before `me` is set makes the router fall
    // through to the landing page. The `me` effect below navigates once the
    // session is actually visible to the app.
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1 style={{ fontSize: 26 }}>{mode === 'login' ? 'Welcome back 👋' : 'Create your account'}</h1>
        <p className="muted small" style={{ marginTop: 4 }}>
          {mode === 'login' ? 'Log in to your trip plans.' : 'Free forever for planning. No card needed.'}
        </p>

        <div className="tabbar" style={{ margin: '18px 0' }}>
          <button className={`tab-btn ${mode === 'login' ? 'active' : ''}`} onClick={() => { setMode('login'); setError(null) }}>Log in</button>
          <button className={`tab-btn ${mode === 'signup' ? 'active' : ''}`} onClick={() => { setMode('signup'); setError(null) }}>Sign up</button>
        </div>

        {/* Say so up front: a build with no Supabase project compiled in can
            only ever fail, and "Failed to fetch" blames the wrong thing. */}
        {!isSupabaseConfigured && (
          <div className="err-text" style={{ marginBottom: 12 }}>
            ⚠️ <strong>This build has no backend configured.</strong>
            <div className="small" style={{ marginTop: 4 }}>{MISSING_BACKEND_MESSAGE}</div>
          </div>
        )}

        <form onSubmit={submit}>
          {mode === 'signup' && (
            <Field label="Your name"><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Meera Nair" /></Field>
          )}
          <Field label="Email"><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
          <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters' : undefined}>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
          </Field>
          {error && <div className="err-text" role="alert" style={{ marginBottom: 10 }}>⚠️ {error}</div>}
          <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={saving}>
            {saving ? 'Signing in…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>

        <p className="hint-text" style={{ textAlign: 'center', marginTop: 14 }}>
          Demo trips are added to your account automatically on first sign-in.
        </p>
      </div>
    </div>
  )
}
