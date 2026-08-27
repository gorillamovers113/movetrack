import React, { useState } from 'react'
import { useStore } from './store.jsx'
import { GorillaWordmark } from './ui.jsx'

function friendlyError(code) {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email or password is wrong.'
    case 'auth/invalid-email':
      return "That email address doesn't look right."
    case 'auth/email-already-in-use':
      return 'An account already exists for that email. Try signing in instead.'
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.'
    case 'auth/missing-password':
      return 'Enter a password.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a bit and try again.'
    case 'auth/network-request-failed':
      return 'Network error, check your connection and try again.'
    default:
      return 'Something went wrong. Try again.'
  }
}

export default function Login() {
  const { login, signup, resetPassword } = useStore()
  const [mode, setMode] = useState('signin') // signin | register | forgot | forgot-sent
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const switchMode = (m) => { setMode(m); setError('') }

  const doSignIn = async () => {
    const e = email.trim()
    if (!e || !password) return setError('Enter your email and password.')
    setError(''); setBusy(true)
    try {
      await login(e, password)
    } catch (err) {
      setError(friendlyError(err.code))
    } finally {
      setBusy(false)
    }
  }

  const doRegister = async () => {
    const n = name.trim(); const e = email.trim()
    if (!n) return setError('Enter your full name.')
    if (!e.includes('@')) return setError('Enter a valid email.')
    if (password.length < 6) return setError('Password should be at least 6 characters.')
    setError(''); setBusy(true)
    try {
      await signup({ name: n, email: e, password })
      // On success, onAuthStateChanged picks up the new (pending) user and
      // the app switches to the PendingScreen automatically.
    } catch (err) {
      setError(friendlyError(err.code))
      setBusy(false)
    }
  }

  const doReset = async () => {
    const e = email.trim()
    if (!e.includes('@')) return setError('Enter a valid email.')
    setError(''); setBusy(true)
    try {
      await resetPassword(e)
      setMode('forgot-sent')
    } catch (err) {
      setError(friendlyError(err.code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="login-hero">
        <div className="hero-brand">
          <GorillaWordmark width={280} />
          <div className="hero-kicker">MoveTrack &middot; project command center</div>
          <div className="tagline">"When it comes to moving, we don't monkey around!"</div>
        </div>
        <h1>Every unit.<br />Every box.<br /><em>On the record.</em></h1>
        <p>MoveTrack is our project command center for the Trinity Manor relocation: photos, videos, and notes at every handoff, timestamped under the name of the person who did the work.</p>
        <div className="trust-row">
          <span>✓ Licensed &amp; insured</span>
          <span>✓ BBB accredited</span>
          <span>✓ USDOT &amp; CAL-T</span>
          <span>✓ Full chain of custody</span>
        </div>
        {/* I6: these are static marketing facts about the Trinity Manor building
            (its real unit/container counts), not a live KPI, Login renders
            pre-auth, before Firestore reads are allowed, so it can't reflect
            live board state the way Dashboard now does. */}
        <div className="hero-stats">
          <div><div className="n">100</div><div className="l">Units tracked</div></div>
          <div><div className="n">200+</div><div className="l">Storage containers</div></div>
          <div><div className="n">100%</div><div className="l">Chain of custody</div></div>
        </div>
      </div>

      <div className="login-panel">
        <div className="login-card">
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: 'var(--red)', borderRadius: 12, padding: '10px 14px', fontSize: 13.5, marginBottom: 14 }}>
              {error}
            </div>
          )}

          {mode === 'forgot-sent' ? (
            <>
              <h2>Check your email ✓</h2>
              <p>We sent a password reset link to <b>{email}</b>. Follow it to set a new password, then come back and sign in.</p>
              <button className="btn btn-ghost" style={{ width: '100%', marginTop: 16 }} onClick={() => switchMode('signin')}>← Back to sign in</button>
            </>
          ) : mode === 'forgot' ? (
            <>
              <h2>Reset your password</h2>
              <p>Enter the email on your account and we'll send you a reset link.</p>
              <div className="field"><label>Email</label>
                <input className="input" autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" onKeyDown={(e) => e.key === 'Enter' && doReset()} /></div>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy} onClick={doReset}>{busy ? 'Sending…' : 'Send reset link'}</button>
              <button className="btn btn-ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => switchMode('signin')}>← Back to sign in</button>
            </>
          ) : mode === 'register' ? (
            <>
              <h2>Create an account</h2>
              <p>New crew members start as <b>pending</b> until the admin approves them and assigns a role.</p>
              <div className="field"><label>Full name</label>
                <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chris Alvarez" /></div>
              <div className="field"><label>Email</label>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></div>
              <div className="field"><label>Password</label>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" onKeyDown={(e) => e.key === 'Enter' && doRegister()} /></div>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy} onClick={doRegister}>{busy ? 'Creating account…' : 'Request access'}</button>
              <button className="btn btn-ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => switchMode('signin')}>← Back</button>
            </>
          ) : (
            <>
              <h2>Sign in</h2>
              <p>Sign in with the email and password on your MoveTrack account.</p>
              <div className="field"><label>Email</label>
                <input className="input" autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></div>
              <div className="field"><label>Password</label>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === 'Enter' && doSignIn()} /></div>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy} onClick={doSignIn}>{busy ? 'Signing in…' : 'Sign in'}</button>
              <button className="btn btn-ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => switchMode('forgot')}>Forgot password?</button>
              <div className="divider">new here?</div>
              <button className="btn btn-dark btn-lg" style={{ width: '100%' }} onClick={() => switchMode('register')}>Create an account</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
