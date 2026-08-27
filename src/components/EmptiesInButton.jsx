import React, { useState } from 'react'
import { useStore } from '../store.jsx'
import { Modal } from '../ui.jsx'

// "＋ Empties in" — BigBox drops off a batch of empty containers on site
// (5 at a time is the norm, but any count works). One screen: add rows,
// type each container number, log the batch. Self-gates for mover/admin
// so callers can drop it in without checking the role first.
export default function EmptiesInButton({ toast }) {
  const { currentUser, dispatch } = useStore()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState(['', '', '', '', ''])
  const [busy, setBusy] = useState(false)

  if (!currentUser || !['admin', 'mover'].includes(currentUser.role)) return null

  const openModal = () => { setRows(['', '', '', '', '']); setOpen(true) }
  const close = () => { if (!busy) setOpen(false) }
  const setRow = (i, v) => setRows((r) => r.map((x, idx) => (idx === i ? v : x)))
  const addRow = () => setRows((r) => [...r, ''])
  const removeRow = (i) => setRows((r) => r.filter((_, idx) => idx !== i))

  const numbers = rows.map((r) => r.trim()).filter(Boolean)

  const submit = async () => {
    if (numbers.length === 0) return
    setBusy(true)
    try {
      await dispatch({ type: 'logEmpties', p: { numbers } })
      setOpen(false)
      toast?.(`${numbers.length} empty container${numbers.length === 1 ? '' : 's'} logged ✓`)
    } catch (err) {
      toast?.(err.message || "Couldn't save that. Check your signal and try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="btn btn-dark btn-lg" onClick={openModal}>＋ Empties in</button>
      {open && (
        <Modal title="Log empties delivered" sub="BigBox dropped these off on site — enter each container number, one per row." onClose={close}>
          <div className="field">
            <label>Container numbers</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rows.map((v, i) => (
                <div className="row" key={i}>
                  <input
                    className="input grow" autoFocus={i === 0} inputMode="text"
                    placeholder={`e.g. BB-${1001 + i}`} value={v}
                    onChange={(e) => setRow(i, e.target.value)}
                  />
                  {rows.length > 1 && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeRow(i)}>✕</button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={addRow}>＋ Add another</button>
          </div>
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={numbers.length === 0 || busy} onClick={submit}>
            {busy ? 'Logging…' : 'Log empties in'}
          </button>
        </Modal>
      )}
    </>
  )
}
