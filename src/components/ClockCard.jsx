import React, { useEffect, useState } from 'react'
import { useStore, fmtTime } from '../store.jsx'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'
import { fmtDuration } from '../lib/reports.js'
import { businessDayKey, canClockInAt, workedMs, usesClock, EARLIEST_CLOCK_IN_HOUR } from '../lib/timeclock.js'

/* The crew's clock, at the top of their queue because it is the first and last
 * thing they touch each day.
 *
 * Three states and no more: not started, running, done. Clocking out asks for
 * confirmation because it is the one action here that cannot be undone from a
 * phone, and it is where the lunch question belongs.
 */
export default function ClockCard({ toast }) {
  const { state, dispatch, currentUser } = useStore()
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [confirmOut, setConfirmOut] = useState(false)
  const [throughLunch, setThroughLunch] = useState(false)

  // A running total that stood still would look broken.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  if (!currentUser || !usesClock(currentUser.role)) return null

  const day = businessDayKey(now)
  const today = state.timeEntries.find((e) => e.uid === currentUser.uid && e.day === day)
  const open = today && !today.clockOut
  const tooEarly = !today && !canClockInAt(now)

  const run = async (fn, done) => {
    if (busy) return
    setBusy(true)
    try {
      const status = await submitWrite(fn())
      toast(status === 'queued' ? QUEUED_MESSAGE : done)
      setConfirmOut(false)
    } catch (err) {
      toast(err.message || "Couldn't save that. Check your signal and try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <div className="section-title grow" style={{ margin: 0 }}>Your day</div>
        {open && <span className="muted" style={{ fontWeight: 700 }}>{fmtDuration(now - today.clockIn)}</span>}
      </div>

      {!today && (
        <>
          <button
            className="btn btn-primary btn-lg" style={{ width: '100%' }}
            disabled={busy || tooEarly}
            onClick={() => run(() => dispatch({ type: 'clockIn' }), 'Clocked in ✓')}
          >
            {busy ? 'Saving…' : tooEarly ? `Opens at ${EARLIEST_CLOCK_IN_HOUR}:00am` : 'Clock in'}
          </button>
          {tooEarly && (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              The clock opens at {EARLIEST_CLOCK_IN_HOUR}:00am. If you are already working, tell Casey and he will add the time.
            </div>
          )}
        </>
      )}

      {open && !confirmOut && (
        <>
          <div className="muted" style={{ fontSize: 13.5, marginBottom: 10 }}>
            Started {fmtTime(today.clockIn)}.
          </div>
          <button className="btn btn-dark btn-lg" style={{ width: '100%' }} onClick={() => setConfirmOut(true)}>
            Clock out
          </button>
        </>
      )}

      {open && confirmOut && (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', fontSize: 13.5 }}>
            <input type="checkbox" checked={throughLunch} onChange={(e) => setThroughLunch(e.target.checked)} />
            I worked through lunch
          </label>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            Thirty minutes comes off automatically on a day over five hours. Tick the box only if you did not stop.
          </div>
          <button
            className="btn btn-primary btn-lg" style={{ width: '100%' }}
            disabled={busy}
            onClick={() => run(() => dispatch({ type: 'clockOut', p: { workedThroughLunch: throughLunch } }), 'Clocked out ✓')}
          >
            {busy ? 'Saving…' : 'Confirm clock out'}
          </button>
          <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setConfirmOut(false)}>
            Not yet
          </button>
        </>
      )}

      {today && today.clockOut && (
        <div style={{ fontSize: 13.5 }}>
          <b>{fmtDuration(workedMs(today))}</b> today
          <div className="muted" style={{ marginTop: 4 }}>
            {fmtTime(today.clockIn)} to {fmtTime(today.clockOut)}
            {today.lunchMinutes > 0 ? `, less ${today.lunchMinutes} min lunch` : ''}
          </div>
        </div>
      )}
    </div>
  )
}
