import React, { useState } from 'react'
import { useStore } from '../store.jsx'
import { Modal } from '../ui.jsx'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'
import { usesClock } from '../lib/timeclock.js'
import { fmtScheduleDate } from '../lib/schedule.js'
import { parseLocal } from './TimeCorrectionModal.jsx'

/* Recording a day somebody worked but did not clock.
 *
 * Shared by Timesheets and the Schedule page, for the same reason
 * TimeCorrectionModal is: two forms writing pay records would drift, and the
 * one that drifted would be the one nobody was looking at.
 *
 * Admin only. The button that opens it is never rendered for anyone else, and
 * the rules refuse the write regardless.
 *
 * When a date is passed in, the time fields are pre-filled to that day and the
 * date is fixed. That is the Schedule case: you are looking at Tuesday and you
 * want to add somebody to Tuesday, and having to retype the date you are
 * already looking at is how the wrong date gets entered.
 */
export default function AddTimeEntryModal({ date, onClose, toast }) {
  const { state, dispatch } = useStore()
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    uid: '', start: date ? `${date}T08:00` : '', end: date ? `${date}T16:30` : '', lunch: '', notes: '',
  })

  /* Somebody already on this day is not in the list.
   *
   * Offering a name that cannot be added is how Rogelio ended up on Thursday
   * twice: the picker was happy to take him again and nothing downstream
   * disagreed until the totals were wrong. */
  const taken = new Set(
    state.timeEntries.filter((e) => e && e.day === date).map((e) => e.uid),
  )
  const crew = state.users.filter((u) => usesClock(u.role) && u.status === 'active' && !taken.has(u.uid || u.id))
  const allCrew = state.users.filter((u) => usesClock(u.role) && u.status === 'active')

  const save = async () => {
    if (busy) return
    const clockIn = parseLocal(form.start)
    const clockOut = parseLocal(form.end)
    if (!form.uid) return toast('Pick a packer or mover.')
    if (!clockIn || !clockOut) return toast('Enter a start and a finish time.')
    if (clockOut <= clockIn) return toast('Finish time must be after start time.')

    setBusy(true)
    try {
      const status = await submitWrite(dispatch({ type: 'adminAddTimeEntry', p: {
        uid: form.uid, clockIn, clockOut, notes: form.notes,
        lunchMinutes: form.lunch === '' || form.lunch == null ? null : Number(form.lunch),
      } }))
      const who = crew.find((u) => (u.uid || u.id) === form.uid)
      toast(status === 'queued' ? QUEUED_MESSAGE : `${who ? who.name : 'Day'} added ✓`)
      onClose()
    } catch (err) {
      toast(err.message || "Couldn't save that.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={date ? `Add someone to ${fmtScheduleDate(date)}` : 'Add a day'}
      sub="For somebody who worked but did not clock in"
      onClose={() => !busy && onClose()}
    >
      <div className="field">
        <label>Who</label>
        <select className="input" value={form.uid} onChange={(e) => setForm({ ...form, uid: e.target.value })}>
          <option value="">{crew.length ? 'Pick a packer or mover…' : 'Everybody is already on this day'}</option>
          {crew.map((u) => <option key={u.id} value={u.uid || u.id}>{u.name}</option>)}
        </select>
        {taken.size > 0 && (
          <div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
            {allCrew.length - crew.length} already on this day
            {crew.length === 0 && '. Tap a name on the day to change or remove their hours.'}
          </div>
        )}
      </div>
      <div className="field">
        <label>Started</label>
        <input className="input" type="datetime-local" value={form.start}
          onChange={(e) => setForm({ ...form, start: e.target.value })} />
      </div>
      <div className="field">
        <label>Finished</label>
        <input className="input" type="datetime-local" value={form.end}
          onChange={(e) => setForm({ ...form, end: e.target.value })} />
      </div>
      <div className="field">
        <label>Lunch minutes <span className="muted">(blank uses the five hour rule)</span></label>
        <input className="input" type="number" min="0" inputMode="numeric" placeholder="30"
          value={form.lunch} onChange={(e) => setForm({ ...form, lunch: e.target.value })} />
      </div>
      <div className="field">
        <label>Notes</label>
        <textarea className="input" rows={2} placeholder="Worked before the app was in use"
          value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
        This is recorded as entered by you, not as a punch. It carries hours but no unit time, because nobody can
        reconstruct which apartment somebody was standing in.
      </div>
      <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Add this day'}
      </button>
    </Modal>
  )
}
