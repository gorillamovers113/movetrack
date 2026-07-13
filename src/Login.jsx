import React, { useState } from 'react'
import { ROLES } from './seed.js'
import { useStore } from './store.jsx'
import { Avatar, GorillaWordmark } from './ui.jsx'

export default function Login() {
  const { state, dispatch, login } = useStore()
  const [mode, setMode] = useState('signin') // signin | register | requested
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  const demoUsers = state.users.filter((u) => ['u-casey', 'u-maria', 'u-jake', 'u-mike', 'u-dana', 'u-robbie'].includes(u.id))

  const register = (via) => {
    const n = name.trim(); const e = email.trim()
    if (!n || !e.includes('@')) return alert('Enter your name and a valid email.')
    dispatch({ type: 'register', p: { name: n, email: e, via } })
    setMode('requested')
  }

  return (
    <div className="login">
      <div className="login-hero">
        <GorillaWordmark width={280} />
        <div className="tagline">"When it comes to moving, we don't monkey around!"</div>
        <h1>Every unit.<br />Every box.<br /><em>On the record.</em></h1>
        <p>MoveTrack is our project command center for the Trinity Manor relocation — photos, videos, and notes at every handoff, timestamped under the name of the person who did the work.</p>
        <div className="trust-row">
          <span>✓ Licensed &amp; insured</span>
          <span>✓ BBB accredited</span>
          <span>✓ USDOT &amp; CAL-T</span>
          <span>✓ Full chain of custody</span>
        </div>
        <div className="hero-stats">
          <div><div className="n">100</div><div className="l">Units tracked</div></div>
          <div><div className="n">40</div><div className="l">Storage containers</div></div>
          <div><div className="n">100%</div><div className="l">Chain of custody</div></div>
        </div>
      </div>

      <div className="login-panel">
        <div className="login-card">
          {mode === 'requested' ? (
            <>
              <h2>Request sent ✓</h2>
              <p>Casey has to approve your account and assign your role before you can sign in. You'll be in the "Awaiting approval" queue.</p>
              <div className="pending-note">This keeps the record airtight — nobody touches the project until the admin says who they are and what they're allowed to do.</div>
              <button className="btn btn-ghost" style={{ width: '100%', marginTop: 16 }} onClick={() => setMode('signin')}>← Back to sign in</button>
            </>
          ) : mode === 'register' ? (
            <>
              <h2>Create an account</h2>
              <p>New crew members start as <b>pending</b> until the admin approves them and assigns a role.</p>
              <div className="field"><label>Full name</label>
                <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chris Alvarez" /></div>
              <div className="field"><label>Email</label>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /></div>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={() => register('email')}>Request access</button>
              <div className="divider">or</div>
              <button className="btn btn-ghost btn-lg" style={{ width: '100%' }} onClick={() => register('google')}>
                <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.7l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
                Continue with Google
              </button>
              <button className="btn btn-ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => setMode('signin')}>← Back</button>
            </>
          ) : (
            <>
              <h2>Sign in</h2>
              <p>Demo build — tap anyone to see the app exactly as their role sees it.</p>
              <div className="demo-users">
                {demoUsers.map((u) => (
                  <button key={u.id} className="demo-user" onClick={() => login(u.id)}>
                    <Avatar name={u.name} />
                    <div>
                      <b>{u.name}</b>
                      <span>{u.status === 'pending' ? 'Pending approval — see the wait screen' : (u.title || ROLES[u.role].label)}</span>
                    </div>
                    <span className="go">→</span>
                  </button>
                ))}
              </div>
              <div className="divider">new here?</div>
              <button className="btn btn-dark btn-lg" style={{ width: '100%' }} onClick={() => setMode('register')}>Create an account</button>
              <p className="muted" style={{ marginTop: 14, textAlign: 'center' }}>Passwords & Google sign-in go live with the production backend.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
