import React, { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { Modal } from '../ui.jsx'
import { fmtScheduleDate, todayKey, progressForDay, targetStageForWork } from '../lib/schedule.js'

const FLOORS = Array.from({ length: 9 }, (_, i) => i + 1)
const WORK_TYPES = ['PACK', 'MOVEOUT']

function WorkPill({ work }) {
  const isMoveout = work === 'MOVEOUT'
  return <span className="stage-pill" style={{ background: isMoveout ? '#8b5cf6' : '#0d9488' }}>{isMoveout ? 'MOVE-OUT' : 'PACK'}</span>
}

// Admin-only per-row editor. Doc id = date, so a date change is a move
// (handled inside the editScheduleDay dispatch action, not here).
function DayEditModal({ day, onClose, toast }) {
  const { dispatch } = useStore()
  const [form, setForm] = useState({ date: day.date, work: day.work, floor: String(day.floor), unitCount: String(day.unitCount) })
  const [busy, setBusy] = useState(false)

  const ready = form.date && form.work && form.floor && form.unitCount && Number(form.unitCount) > 0
  const close = () => { if (!busy) onClose() }

  const submit = async () => {
    if (!ready) return
    setBusy(true)
    try {
      await dispatch({
        type: 'editScheduleDay',
        p: { dateId: day.id, patch: { date: form.date, work: form.work, floor: Number(form.floor), unitCount: Number(form.unitCount) } },
      })
      toast?.('Schedule day updated ✓')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`Edit ${fmtScheduleDate(day.date)}`} sub="Changing the date moves this day to a new slot; the old one is removed." onClose={close}>
      <div className="field">
        <label>Date</label>
        <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
      </div>
      <div className="field">
        <label>Work</label>
        <select className="input" value={form.work} onChange={(e) => setForm({ ...form, work: e.target.value })}>
          {WORK_TYPES.map((w) => <option key={w} value={w}>{w === 'MOVEOUT' ? 'MOVE-OUT' : 'PACK'}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Floor</label>
        <select className="input" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })}>
          {FLOORS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Planned unit count</label>
        <input className="input" type="number" min="1" inputMode="numeric" value={form.unitCount} onChange={(e) => setForm({ ...form, unitCount: e.target.value })} />
      </div>
      <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={!ready || busy} onClick={submit}>
        {busy ? 'Saving…' : 'Save changes'}
      </button>
    </Modal>
  )
}

export default function Schedule({ toast }) {
  const { state, currentUser, dispatch } = useStore()
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const isAdmin = currentUser?.role === 'admin'
  const key = todayKey()

  const byFloor = useMemo(() => {
    const groups = {}
    for (const day of state.schedule) {
      if (!groups[day.floor]) groups[day.floor] = []
      groups[day.floor].push(day)
    }
    for (const f of Object.keys(groups)) groups[f].sort((a, b) => a.date.localeCompare(b.date))
    return groups
  }, [state.schedule])

  // Floor 9 first, matching the top-down move order; skip floors with no
  // rows (never guess at empty groups).
  const floorsPresent = FLOORS.filter((f) => byFloor[f]?.length).sort((a, b) => b - a)

  const loadPlan = async (successMsg) => {
    setBusy(true)
    try {
      await dispatch({ type: 'seedSchedule', p: {} })
      toast?.(successMsg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Schedule</h1>
          <p>The floor-by-floor relocation plan, Sep 8 through Oct 8. Floor 9 first, matching the move-out order.</p>
        </div>
        {isAdmin && (
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => loadPlan(state.schedule.length ? 'Reset to default plan ✓' : 'Schedule loaded: 27 days, Sep 8 to Oct 8 ✓')}
          >
            {busy ? 'Working…' : state.schedule.length ? 'Reset to default plan' : 'Load default plan'}
          </button>
        )}
      </div>

      {state.schedule.length === 0 && (
        <div className="card">
          <div className="empty">
            <div className="big">📅</div>
            {isAdmin
              ? 'No schedule loaded yet. Tap "Load default plan" above to bring in all 27 days.'
              : 'Schedule not loaded yet. Check back once the admin loads the plan.'}
          </div>
        </div>
      )}

      {floorsPresent.map((f) => (
        <div key={f}>
          <div className="section-title">Floor {f}</div>
          <div className="card" style={{ padding: 0, marginBottom: 14, overflow: 'hidden' }}>
            {byFloor[f].map((day, i) => {
              const isToday = day.date === key
              const isPast = day.date < key
              const { done, planned } = progressForDay(day, state.units)
              const hitPlan = isPast && planned > 0 && done >= planned
              const doneLabel = targetStageForWork(day.work) === 'loaded' ? 'loaded' : 'packed'
              return (
                <div
                  key={day.id}
                  className="row"
                  style={{
                    padding: '14px 18px',
                    borderBottom: i < byFloor[f].length - 1 ? '1px solid var(--line)' : 'none',
                    background: isToday ? '#fffbeb' : 'transparent',
                  }}
                >
                  <div style={{ width: 130, flexShrink: 0 }}>
                    <b>{fmtScheduleDate(day.date)}</b>
                    {isToday && <div style={{ color: 'var(--brand-ink)', fontSize: 12, fontWeight: 700 }}>Today</div>}
                  </div>
                  <WorkPill work={day.work} />
                  <div className="grow muted">{done} of {planned} {doneLabel}{hitPlan ? ' ✓' : ''}</div>
                  {isAdmin && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(day)}>Edit</button>}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {editing && <DayEditModal day={editing} onClose={() => setEditing(null)} toast={toast} />}
    </>
  )
}
