import React, { useState } from 'react'
import { useStore } from '../store.jsx'
import { Modal } from '../ui.jsx'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'

// "＋ Report overflow item" logs an oversized piece that won't fit inside a
// BigBox container; Gorilla Movers transports it to the warehouse directly
// (see docs/superpowers/specs/2026-08-26-overflow-items-design.md). Works two
// ways: dropped onto a specific unit (unitId prop set, no picker needed) or
// dropped onto the Overflow pool (no unitId, pick a unit first). Self-gates
// for packer/mover/admin so callers don't need to check the role first.
export default function ReportOverflowButton({ unitId, toast, fullWidth = false }) {
  const { state, currentUser, dispatch } = useStore()
  const [open, setOpen] = useState(false)
  const [pickUnitId, setPickUnitId] = useState(unitId || '')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  if (!currentUser || !['admin', 'packer', 'mover'].includes(currentUser.role)) return null

  const unit = unitId ? state.units.find((u) => u.id === unitId) : null
  const ready = pickUnitId && description.trim()

  const openModal = () => { setPickUnitId(unitId || ''); setDescription(''); setOpen(true) }
  const close = () => { if (!busy) setOpen(false) }

  const submit = async () => {
    if (!ready) return
    setBusy(true)
    try {
      const status = await submitWrite(dispatch({ type: 'createOverflow', p: { unitId: pickUnitId, description: description.trim() } }))
      setOpen(false)
      toast?.(status === 'queued' ? QUEUED_MESSAGE : 'Overflow item logged ✓')
    } catch (err) {
      toast?.(err.message || "Couldn't save that. Check your signal and try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="btn btn-dark" style={fullWidth ? { width: '100%' } : undefined} onClick={openModal}>＋ Report overflow item</button>
      {open && (
        <Modal
          title="Report an overflow item"
          sub="Too big for a BigBox container. Gorilla Movers will transport it to the warehouse directly."
          onClose={close}
        >
          {unitId ? (
            <div className="field"><label>Unit</label>
              <div className="muted">Unit {unit ? unit.number : '—'}{unit?.tenant ? ` · ${unit.tenant}` : ''}</div>
            </div>
          ) : (
            <div className="field">
              <label>Unit</label>
              {state.units.length === 0 ? (
                <div className="muted">No units yet.</div>
              ) : (
                <select className="input" autoFocus value={pickUnitId} onChange={(e) => setPickUnitId(e.target.value)}>
                  <option value="">Select unit…</option>
                  {state.units.map((u) => <option key={u.id} value={u.id}>Unit {u.number} · {u.tenant || '—'}</option>)}
                </select>
              )}
            </div>
          )}
          <div className="field">
            <label>Description</label>
            <textarea
              className="input" rows="3" autoFocus={!!unitId}
              placeholder="e.g. Large oak armoire, glass doors"
              value={description} onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={!ready || busy} onClick={submit}>
            {busy ? 'Logging…' : 'Log overflow item'}
          </button>
        </Modal>
      )}
    </>
  )
}
