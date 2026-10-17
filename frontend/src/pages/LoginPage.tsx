import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { backend, type Role } from '../data'

export default function LoginPage() {
  const { profile } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<Role>('patient')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  if (profile) return <Navigate to="/" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setBusy(true)
    try {
      if (mode === 'signin') {
        await backend.signIn(email, password)
      } else {
        const { needsConfirmation } = await backend.signUp(email, password, fullName, role)
        if (needsConfirmation) setInfo('Check your email to confirm your account, then sign in.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-card card">
      <h1>{mode === 'signin' ? 'Sign in' : 'Create an account'}</h1>
      <p className="muted">Exercise at home with instant feedback, checked by a physiotherapist.</p>
      <form onSubmit={submit} className="form">
        {mode === 'signup' && (
          <label>
            Full name
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
        )}
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
        </label>
        {mode === 'signup' && backend.mode === 'demo' && (
          <label>
            I am a
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="patient">Patient</option>
              <option value="physio">Physiotherapist</option>
            </select>
          </label>
        )}
        {mode === 'signup' && backend.mode === 'supabase' && (
          <p className="muted small">New accounts are patient accounts. Physiotherapist accounts are enabled by an administrator.</p>
        )}
        {error && <p className="error">{error}</p>}
        {info && <p className="info">{info}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <button type="button" className="link" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
        {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
      </button>
      {backend.mode === 'demo' && (
        <div className="demo-hint">
          <strong>Demo mode</strong> - data stays in this browser. Try <code>patient@demo.local</code> or{' '}
          <code>physio@demo.local</code> with password <code>password123</code>.
        </div>
      )}
    </div>
  )
}
