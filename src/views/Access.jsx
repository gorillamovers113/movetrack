import React, { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore'
import { db } from '../firebase.js'
import { useStore, fmtTime, fmtAgo } from '../store.jsx'
import { Avatar } from '../ui.jsx'
import { fmtDuration } from '../lib/reports.js'

/* Who is in the app, on what, and what they are looking at.
 *
 * Admin only, and the crew are told it exists. Monitoring a work tool is
 * ordinary and lawful; doing it covertly is what creates exposure, and the
 * people in this list have a right under California's CPRA to know what is
 * collected about them.
 *
 * Read-only by construction. Everything here is written by a Cloud Function
 * with the Admin SDK, and the rules let nobody write these collections at all.
 * The IP and the identity are worth reading precisely because no client could
 * have put them there.
 *
 * Subscribed here rather than in the store: nobody but an admin can read it,
 * and it should not be sitting in every crew phone's memory.
 */

const LIVE_MS = 10 * 60 * 1000

const VIEW_NAMES = {
  dashboard: 'Dashboard', schedule: 'Schedule', containers: 'Vaults', overflow: 'Overflow',
  team: 'Team', reports: 'Reports', timesheets: 'Timesheets', activity: 'Activity',
  mywork: 'My queue', unit: 'A unit', container: 'A container', access: 'Access log',
}
const viewName = (v) => VIEW_NAMES[v] || v || '—'

function Line({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '3px 0', fontSize: 13 }}>
      <span className="muted" style={{ flex: 'none', minWidth: 92 }}>{label}</span>
      <span style={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  )
}

function Session({ s, now, expanded, onToggle }) {
  const live = now - (s.lastSeenAt || 0) < LIVE_MS
  const span = Math.max(0, (s.lastSeenAt || 0) - (s.startedAt || 0))
  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: 0, textAlign: 'left',
          background: 'none', border: 'none', fontFamily: 'inherit', color: 'inherit', cursor: 'pointer',
        }}
      >
        <span aria-hidden style={{
          flex: 'none', width: 8, height: 8, borderRadius: 4,
          background: live ? '#16a34a' : 'var(--ink-3, #9aa1ab)',
        }} />
        <span className="grow" style={{ fontSize: 13.5 }}>
          <b>{s.device || 'Unknown device'}</b>
          <span className="muted"> · {s.browser || 'Unknown browser'}{s.os ? ` ${s.os}` : ''}</span>
        </span>
        <span className="muted" style={{ fontSize: 12.5 }}>
          {live ? `on ${viewName(s.view)}` : fmtAgo(s.lastSeenAt || 0)}
        </span>
        <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{expanded ? '−' : '+'}</span>
      </button>

      {expanded && (
        <div style={{ marginTop: 6 }}>
          <Line label="Opened">{fmtTime(s.startedAt)}</Line>
          <Line label="Last seen">{fmtTime(s.lastSeenAt)}{live && <span className="muted"> · still open</span>}</Line>
          {span > 60000 && <Line label="Open for">{fmtDuration(span)}</Line>}
          <Line label="IP">{s.ip || <span className="muted">not recorded</span>}</Line>
          {s.screen && <Line label="Screen">{s.screen}</Line>}
          {s.build && <Line label="App build">{s.build}</Line>}
          <Line label="Screens">{s.viewCount || 0} opened</Line>
          {(s.views || []).length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div className="muted" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.04em', marginBottom: 4 }}>
                WHERE THEY WENT
              </div>
              {[...s.views].reverse().map((v, i) => (
                <div key={`${v.at}-${i}`} style={{ display: 'flex', gap: 10, fontSize: 12.5, padding: '2px 0' }}>
                  <span className="muted" style={{ minWidth: 92 }}>{fmtTime(v.at)}</span>
                  <span>{viewName(v.view)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Access() {
  const { state, currentUser } = useStore()
  const [sessions, setSessions] = useState([])
  const [resets, setResets] = useState([])
  const [now, setNow] = useState(() => Date.now())
  const [openId, setOpenId] = useState(null)
  const [err, setErr] = useState(null)

  const admin = currentUser && currentUser.role === 'admin'

  useEffect(() => {
    if (!admin) return undefined
    const unsubs = [
      onSnapshot(
        query(collection(db, 'sessions'), orderBy('lastSeenAt', 'desc'), limit(300)),
        (s) => setSessions(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (e) => setErr(e.message),
      ),
      onSnapshot(
        query(collection(db, 'authEvents'), orderBy('at', 'desc'), limit(100)),
        (s) => setResets(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (e) => setErr(e.message),
      ),
    ]
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => { unsubs.forEach((u) => u()); clearInterval(t) }
  }, [admin])

  const byUser = useMemo(() => {
    const m = new Map()
    for (const s of sessions) {
      const row = m.get(s.uid) || { uid: s.uid, userName: s.userName, role: s.role, sessions: [] }
      row.sessions.push(s)
      if (!row.userName && s.userName) row.userName = s.userName
      m.set(s.uid, row)
    }
    // Whoever was here most recently, first.
    return [...m.values()].sort((a, b) => (b.sessions[0]?.lastSeenAt || 0) - (a.sessions[0]?.lastSeenAt || 0))
  }, [sessions])

  if (!admin) return null

  const nameFor = (uid, fallback) =>
    state.users.find((u) => (u.uid || u.id) === uid)?.name || fallback || 'Unknown'
  const liveCount = sessions.filter((s) => now - (s.lastSeenAt || 0) < LIVE_MS).length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Access log</h1>
          <p>
            Who has the app open, on what, and where they are in it.
            {liveCount > 0 && <> <b>{liveCount} open right now.</b></>}
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: '12px 16px', marginBottom: 14 }}>
        <div className="muted" style={{ fontSize: 12.5 }}>
          Recorded by the server, not the phone, so the IP and the name cannot be faked. It covers MoveTrack only:
          no location, and nothing outside this app. The crew need to be told it exists, which is both the decent
          thing and what California asks of an employer collecting this.
        </div>
      </div>

      {err && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 14 }}>
          <b>Could not load the log.</b>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{err}</div>
        </div>
      )}

      {sessions.length === 0 && !err && (
        <div className="card empty">
          <div className="big">🕵️</div>
          Nothing recorded yet. Sessions appear as people open the app.
        </div>
      )}

      {byUser.map((row) => {
        const live = row.sessions.filter((s) => now - (s.lastSeenAt || 0) < LIVE_MS).length
        return (
          <div key={row.uid} className="card" style={{ padding: '14px 20px', marginBottom: 12 }}>
            <div className="row" style={{ gap: 10 }}>
              <Avatar name={nameFor(row.uid, row.userName)} size="sm" />
              <span className="grow">
                <b>{nameFor(row.uid, row.userName)}</b>
                <span className="muted" style={{ fontSize: 12.5 }}> · {row.role || 'unknown role'}</span>
              </span>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {live > 0
                  ? <b style={{ color: '#16a34a' }}>{live} open now</b>
                  : `last seen ${fmtAgo(row.sessions[0]?.lastSeenAt || 0)}`}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              {row.sessions.length} session{row.sessions.length === 1 ? '' : 's'} recorded
            </div>
            {row.sessions.map((s) => (
              <Session
                key={s.id} s={s} now={now}
                expanded={openId === s.id}
                onToggle={() => setOpenId(openId === s.id ? null : s.id)}
              />
            ))}
          </div>
        )
      })}

      {resets.length > 0 && (
        <div className="card" style={{ padding: '14px 20px', marginBottom: 14 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Password resets</div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
            Including attempts on addresses with no account, which is what somebody guessing looks like.
          </div>
          {resets.map((r) => (
            <div key={r.id} style={{ padding: '7px 0', borderTop: '1px solid var(--line)', fontSize: 13.5 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="grow">
                  <b>{r.email}</b>
                  {r.outcome !== 'sent' && (
                    <span style={{ color: r.outcome === 'no-account' ? '#b45309' : '#b91c1c' }}>
                      {' · '}{r.outcome === 'no-account' ? 'no account with that address' : r.outcome}
                    </span>
                  )}
                </span>
                <span className="muted" style={{ fontSize: 12.5 }}>{fmtTime(r.at)}</span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {r.ip || 'no IP'} · {r.device || 'unknown device'} · {r.browser || 'unknown browser'}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
