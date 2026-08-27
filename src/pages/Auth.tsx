// ============ Auth page ============
import { useEffect, useState } from 'react'
import { useDb, currentUser, login, signup } from '../store/store'
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
    try {
      if (mode === 'login') {
        const r = await login(email, password)
        if (!r.ok) { setError(r.error ?? 'Login failed'); return }
      } else {
        if (!name.trim()) { setError('Tell us your name.'); return }
        const r = await signup(name, email, password)
        if (!r.ok) { setError(r.error ?? 'Signup failed'); return }
      }
      onNavigate('/trips')
    } finally {
      setSaving(false)
    }
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

        <form onSubmit={submit}>
          {mode === 'signup' && (
            <Field label="Your name"><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Meera Nair" /></Field>
          )}
          <Field label="Email"><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></Field>
          <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters' : undefined}>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
          </Field>
          {error && <div className="err-text" style={{ marginBottom: 10 }}>⚠️ {error}</div>}
          <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={saving}>
            {saving ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>

        <p className="hint-text" style={{ textAlign: 'center', marginTop: 14 }}>
          Demo trips are added to your account automatically on first sign-in.
        </p>
      </div>
    </div>
  )
}
