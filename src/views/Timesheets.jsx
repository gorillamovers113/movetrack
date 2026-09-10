import React, { useState } from 'react'
import { useStore, fmtTime } from '../store.jsx'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'
import { timesheet, fmtDuration } from '../lib/reports.js'
import { businessDayKey, usesClock } from '../lib/timeclock.js'
import TimeCorrectionModal from '../components/TimeCorrectionModal.jsx'
import AddTimeEntryModal from '../components/AddTimeEntryModal.jsx'

/* Admin timesheets: review a day, correct a stamp, or enter a day the app was
 * not used for.
 *
 * Admin only, deliberately narrower than the Reports page a viewer can read.
 * Individual hours are a more sensitive record than productivity numbers.
 */

export default function Timesheets({ toast }) {
  const { state, dispatch, currentUser } = useStore()
  const [day, setDay] = useState(businessDayKey(Date.now()))
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)

  if (currentUser.role !== 'admin') return null

  const rows = timesheet(state.timeEntries, state.unitSessions, day, Date.now())
  const crew = state.users.filter((u) => usesClock(u.role) && u.status === 'active')

  const run = async (fn, done) => {
    if (busy) return
    setBusy(true)
    try {
      const status = await submitWrite(fn())
      toast(status === 'queued' ? QUEUED_MESSAGE : done)
      setAdding(false); setEditing(null)
    } catch (err) {
      toast(err.message || "Couldn't save that.")
    } finally {
      setBusy(false)
    }
  }

  const totalMs = rows.reduce((n, r) => n + r.workedMs, 0)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Timesheets</h1>
          <p>Packers and movers, one row per person per day.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>＋ Add a day</button>
      </div>

      <div className="card" style={{ padding: '14px 20px', marginBottom: 14 }}>
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field grow" style={{ margin: 0 }}>
            <label>Day</label>
            <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          {rows.length > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div className="muted" style={{ fontSize: 12 }}>{rows.length} on the clock</div>
              <b style={{ fontSize: 18 }}>{fmtDuration(totalMs)}</b>
            </div>
          )}
        </div>
      </div>

      {rows.length === 0 && (
        <div className="card empty"><div className="big">🕘</div>Nobody clocked in on this day.</div>
      )}

      {rows.map((r) => (
        <div key={r.entryId} className="card" style={{ padding: '14px 20px', marginBottom: 10 }}>
          <div className="row">
            <span className="grow"><b>{r.userName}</b> <span className="muted">· {r.role}</span></span>
            <b>{r.open ? 'still open' : fmtDuration(r.workedMs)}</b>
          </div>
          <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
            {fmtTime(r.clockIn)} {r.clockOut ? `to ${fmtTime(r.clockOut)}` : '· not clocked out'}
            {r.lunchMinutes > 0 ? ` · less ${r.lunchMinutes} min lunch` : ''}
          </div>
          {!r.open && (
            <div className="muted" style={{ marginTop: 4, fontSize: 12.5 }}>
              {fmtDuration(r.unitMs)} on units
              {r.unattributedMs > 0 ? ` · ${fmtDuration(r.unattributedMs)} not attributed to a unit` : ''}
            </div>
          )}
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {r.open && <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>Open</span>}
            {r.adminEntered && <span className="badge" style={{ background: '#e0e7ff', color: '#3730a3' }}>Added by you</span>}
            {r.workedThroughLunch && <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>Worked through lunch</span>}
          </div>
          {r.notes && <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>{r.notes}</div>}
          <button
            className="btn btn-ghost btn-sm" style={{ marginTop: 10 }}
            onClick={() => setEditing(r)}
          >✎ Correct</button>
        </div>
      ))}

      {adding && <AddTimeEntryModal onClose={() => setAdding(false)} toast={toast} />}

      {editing && (
        <TimeCorrectionModal row={editing} toast={toast} onClose={() => setEditing(null)} />
      )}
    </>
  )
}
