import React, { useState } from 'react'
import { useStore } from '../store.jsx'
import { Modal } from '../ui.jsx'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'

/* Correcting one person's times for one day.
 *
 * Shared by the Timesheets page and the Schedule page so there is one way to
 * change a stamp, not two that could drift apart. Admin only: the button that
 * opens this is never rendered for anyone else, and the rules refuse the write
 * regardless.
 *
 * Works on an open day as well as a finished one. Adjusting a start time in the
 * middle of a shift is the common case, so leaving the finish field blank
 * leaves the day open rather than closing it at whatever the field happened to
 * contain.
 */

// A datetime-local input carries no timezone, so its value is read against the
// browser's. That is the crew's own machine in practice.
export const parseLocal = (s) => {
  if (!s) return null
  const ms = new Date(s).getTime()
  return Number.isFinite(ms) ? ms : null
}

export const localValue = (ms) => {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function TimeCorrectionModal({ row, onClose, toast }) {
  const { dispatch } = useStore()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    start: localValue(row.clockIn),
    end: localValue(row.clockOut),
    lunch: String(row.lunchMinutes ?? 0),
  })

  const save = async () => {
    if (busy) return
    const changes = {}
    const start = parseLocal(form.start)
    const end = parseLocal(form.end)
    if (start && start !== row.clockIn) changes.clockIn = start
    if (end && end !== row.clockOut) changes.clockOut = end
    if (form.lunch !== '' && Number(form.lunch) !== row.lunchMinutes) changes.lunchMinutes = Number(form.lunch)

    if (Object.keys(changes).length === 0) return toast('Nothing changed.')
    const finalStart = changes.clockIn || row.clockIn
    const finalEnd = changes.clockOut || row.clockOut
    if (finalEnd && finalEnd <= finalStart) return toast('Finish time must be after start time.')

    setBusy(true)
    try {
      const status = await submitWrite(dispatch({ type: 'adminCorrectTimeEntry', p: { entryId: row.entryId, changes } }))
      toast(status === 'queued' ? QUEUED_MESSAGE : `${row.userName}'s time updated ✓`)
      onClose()
    } catch (err) {
      toast(err.message || "Couldn't save that.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Adjust ${row.userName}`} sub={row.day} onClose={() => !busy && onClose()}>
      <div className="field">
        <label>Started</label>
        <input className="input" type="datetime-local" value={form.start}
          onChange={(e) => setForm({ ...form, start: e.target.value })} />
      </div>
      <div className="field">
        <label>Finished {row.open && <span className="muted">(leave blank to keep the day open)</span>}</label>
        <input className="input" type="datetime-local" value={form.end}
          onChange={(e) => setForm({ ...form, end: e.target.value })} />
      </div>
      <div className="field">
        <label>Lunch minutes</label>
        <input className="input" type="number" min="0" inputMode="numeric" value={form.lunch}
          onChange={(e) => setForm({ ...form, lunch: e.target.value })} />
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
        The old values are kept where only you can see them. The crew see the new time and nothing else.
      </div>
      <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </Modal>
  )
}
