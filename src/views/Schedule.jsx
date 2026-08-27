import React, { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { Modal } from '../ui.jsx'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'
import { fmtScheduleDate, todayKey, progressForDay, targetStageForWork, scheduleForPhase, DEFAULT_RETURN_SCHEDULE } from '../lib/schedule.js'
import ReturnPhaseToggle from '../components/ReturnPhaseToggle.jsx'

const FLOORS = Array.from({ length: 9 }, (_, i) => i + 1)

function WorkPill({ work }) {
  const color = work === 'MOVEOUT' ? '#8b5cf6' : work === 'RETURN' ? '#0ea5e9' : '#0d9488'
  const label = work === 'MOVEOUT' ? 'MOVE-OUT' : work === 'RETURN' ? 'RETURN' : 'PACK'
  return <span className="stage-pill" style={{ background: color }}>{label}</span>
}

// Admin-only per-row editor. Doc id = date, so a date change is a move
// (handled inside the editScheduleDay dispatch action, not here). Return
// days only ever edit within the RETURN work type (the return plan has no
// separate pack/move-out split, see DEFAULT_RETURN_SCHEDULE's comment), so
// the work-type dropdown is scoped to the day's own phase rather than
// letting an admin accidentally set an outbound work type on a return day.
function DayEditModal({ day, onClose, toast }) {
  const { dispatch } = useStore()
  const workTypes = day.phase === 'return' ? ['RETURN'] : ['PACK', 'MOVEOUT']
  const [form, setForm] = useState({ date: day.date, work: day.work, floor: String(day.floor), unitCount: String(day.unitCount) })
  const [busy, setBusy] = useState(false)

  const ready = form.date && form.work && form.floor && form.unitCount && Number(form.unitCount) > 0
  const close = () => { if (!busy) onClose() }

  const submit = async () => {
    if (!ready) return
    setBusy(true)
    try {
      const status = await submitWrite(dispatch({
        type: 'editScheduleDay',
        p: { dateId: day.id, patch: { date: form.date, work: form.work, floor: Number(form.floor), unitCount: Number(form.unitCount) } },
      }))
      toast?.(status === 'queued' ? QUEUED_MESSAGE : 'Schedule day updated ✓')
      onClose()
    } catch (err) {
      toast?.(err.message || "Couldn't save that. Check your signal and try again.")
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
          {workTypes.map((w) => <option key={w} value={w}>{w === 'MOVEOUT' ? 'MOVE-OUT' : w}</option>)}
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
  // Outbound / Return toggle (spec section 7). Defaults to whichever leg the
  // project is actually on, so an admin landing here mid-return doesn't have
  // to remember to flip the tab; still switchable either way regardless.
  const [phase, setPhase] = useState(state.project?.returnPhase ? 'return' : 'out')
  const isAdmin = currentUser?.role === 'admin'
  const key = todayKey()

  const phaseSchedule = useMemo(() => scheduleForPhase(state.schedule, phase), [state.schedule, phase])

  const byFloor = useMemo(() => {
    const groups = {}
    for (const day of phaseSchedule) {
      if (!groups[day.floor]) groups[day.floor] = []
      groups[day.floor].push(day)
    }
    for (const f of Object.keys(groups)) groups[f].sort((a, b) => a.date.localeCompare(b.date))
    return groups
  }, [phaseSchedule])

  // Outbound: floor 9 first, matching the top-down move-out order. Return:
  // floor 1 first, the reverse "rewind" reading (last floor moved out is the
  // last floor to come back), per DEFAULT_RETURN_SCHEDULE's comment.
  const floorsPresent = FLOORS.filter((f) => byFloor[f]?.length).sort((a, b) => (phase === 'return' ? a - b : b - a))

  const loadPlan = async () => {
    setBusy(true)
    try {
      if (phase === 'return') {
        const status = await submitWrite(dispatch({ type: 'seedReturnSchedule', p: {} }))
        toast?.(status === 'queued' ? QUEUED_MESSAGE : `Return floor plan loaded: ${DEFAULT_RETURN_SCHEDULE.length} days ✓`)
      } else {
        const status = await submitWrite(dispatch({ type: 'seedSchedule', p: {} }))
        toast?.(status === 'queued' ? QUEUED_MESSAGE : (phaseSchedule.length ? 'Reset to default plan ✓' : 'Schedule loaded: 27 days, Sep 8 to Oct 8 ✓'))
      }
    } catch (err) {
      toast?.(err.message || "Couldn't save that. Check your signal and try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Schedule</h1>
          <p>
            {phase === 'return'
              ? 'The return plan, floor by floor. Floor 1 first, the reverse of the move-out order.'
              : 'The floor-by-floor relocation plan, Sep 8 through Oct 8. Floor 9 first, matching the move-out order.'}
          </p>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div className="filters" style={{ margin: 0 }}>
            <button className={`chip ${phase === 'out' ? 'on' : ''}`} onClick={() => setPhase('out')}>Outbound</button>
            <button className={`chip ${phase === 'return' ? 'on' : ''}`} onClick={() => setPhase('return')}>Return</button>
          </div>
          {isAdmin && (
            <button className="btn btn-ghost" disabled={busy} onClick={loadPlan}>
              {busy ? 'Working…' : phaseSchedule.length ? `Reset ${phase === 'return' ? 'return ' : ''}plan` : phase === 'return' ? 'Load return template' : 'Load default plan'}
            </button>
          )}
          <ReturnPhaseToggle toast={toast} />
        </div>
      </div>

      {phaseSchedule.length === 0 && (
        <div className="card">
          <div className="empty">
            <div className="big">📅</div>
            {isAdmin
              ? phase === 'return'
                ? 'No return schedule loaded yet. Tap "Load return template" above to bring in the floor-by-floor return days.'
                : 'No schedule loaded yet. Tap "Load default plan" above to bring in all 27 days.'
              : `${phase === 'return' ? 'Return schedule' : 'Schedule'} not loaded yet. Check back once the admin loads the plan.`}
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
              const doneLabel = targetStageForWork(day.work)
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
