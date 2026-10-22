/* The first thing you see after signing in: what time did you start?
 *
 * Casey, 2026-10-22: "for each user that logsin you should have a welcome
 * screen with a imput for there start time. add the defult current time
 * automaticaly."
 *
 * The default is now, so the common case is one tap and gone. The field is
 * there for the person who has been carrying boxes since six and is only now
 * getting their phone out, who until today was told the clock opens at eight
 * and to go and find Casey.
 *
 * ONCE A DAY, NOT ONCE A LOGIN. A packer re-opens this app twenty times a
 * shift as the phone sleeps in their pocket. Asking on every load would make
 * it the most tapped screen in the app, so it asks when there is no time
 * entry yet for today's business day and stays out of the way after that.
 *
 * SKIPPABLE, because the alternative is worse. Somebody who is not working -
 * Casey checking a unit on a Sunday, an office viewer - must not be forced to
 * open a shift to look at a photo. Skipping is remembered for the day.
 */
import React, { useMemo, useState } from 'react'
import { useStore } from './store.jsx'
import { GorillaWordmark } from './ui.jsx'
import { submitAction as submitWrite, QUEUED_MESSAGE } from './lib/submit.js'
import { usesClock, businessDayKey, EARLIEST_CLOCK_IN_HOUR } from './lib/timeclock.js'

export const SKIP_KEY = 'mt_start_skipped'

/** "08:47", in the local clock the person is reading off their own phone. */
function hhmm(ms) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Turn "06:15" back into a timestamp on today's date. */
function msFromHhmm(value, now) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim())
  if (!m) return NaN
  const h = Number(m[1]); const min = Number(m[2])
  if (h > 23 || min > 59) return NaN
  const d = new Date(now)
  d.setHours(h, min, 0, 0)
  return d.getTime()
}

/** Whether this person should be asked at all, today. */
export function shouldAskStart(user, timeEntries) {
  if (!user || user.status !== 'active') return false
  if (!usesClock(user.role)) return false
  try {
    if (localStorage.getItem(SKIP_KEY) === businessDayKey(Date.now())) return false
  } catch { /* private mode: just ask */ }
  const day = businessDayKey(Date.now())
  return !(timeEntries || []).some((e) => e.uid === user.uid && e.day === day)
}

export default function WelcomeStart({ onDone, toast }) {
  const { currentUser, dispatch } = useStore()
  const now = useMemo(() => Date.now(), [])
  const [value, setValue] = useState(() => hhmm(now))
  const [busy, setBusy] = useState(false)
  const first = String(currentUser?.name || '').split(' ')[0] || 'there'

  const chosen = msFromHhmm(value, now)
  const valid = Number.isFinite(chosen) && chosen <= now && now - chosen <= 18 * 60 * 60 * 1000
  const earlier = valid && now - chosen > 60 * 1000

  async function start() {
    if (!valid) { toast('Check that start time.'); return }
    setBusy(true)
    try {
      const status = await submitWrite(dispatch({ type: 'clockIn', p: { startedAt: chosen } }))
      toast(status === 'queued' ? QUEUED_MESSAGE : `Started at ${hhmm(chosen)}. Have a good one.`)
      onDone()
    } catch (e) {
      toast(e.message || 'Could not start your day.')
    } finally {
      setBusy(false)
    }
  }

  function skip() {
    try { localStorage.setItem(SKIP_KEY, businessDayKey(Date.now())) } catch { /* private mode */ }
    onDone()
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div className="card" style={{ width: '100%', maxWidth: 420, padding: 30 }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <GorillaWordmark width={180} onDark={false} />
        </div>

        <h1 style={{ margin: '0 0 4px', fontSize: 25, textAlign: 'center' }}>Morning, {first}</h1>
        <p className="muted" style={{ textAlign: 'center', marginTop: 0, marginBottom: 22 }}>
          What time did you start today?
        </p>

        <label className="muted" style={{ fontSize: 12, fontWeight: 650, letterSpacing: '.06em' }}>START TIME</label>
        <input
          className="input"
          type="time"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ width: '100%', minHeight: 58, fontSize: 26, textAlign: 'center', marginTop: 6, letterSpacing: '.02em' }}
        />

        {!valid && (
          <div className="muted" style={{ fontSize: 12.5, marginTop: 8, color: '#b45309' }}>
            {Number.isFinite(chosen) && chosen > now
              ? 'That is later than right now.'
              : 'That does not look like a time today.'}
          </div>
        )}
        {earlier && valid && (
          <div style={{ fontSize: 12.5, marginTop: 8, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px' }}>
            You are saying you started at {hhmm(chosen)}. That goes on your timesheet as your own word for it.
          </div>
        )}

        <button
          className="btn btn-primary btn-lg"
          onClick={start}
          disabled={busy || !valid}
          style={{ width: '100%', minHeight: 56, fontSize: 17, marginTop: 16 }}
        >
          {busy ? 'Starting…' : 'Start my day'}
        </button>

        <button className="btn" onClick={skip} disabled={busy} style={{ width: '100%', marginTop: 10 }}>
          Not working today
        </button>

        <p className="muted" style={{ fontSize: 11.5, textAlign: 'center', marginTop: 16, marginBottom: 0 }}>
          Clock out from your dashboard when you finish. The clock normally opens at {EARLIEST_CLOCK_IN_HOUR}:00am.
        </p>
      </div>
    </div>
  )
}
