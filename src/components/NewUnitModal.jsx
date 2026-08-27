import React, { useState } from 'react'
import { useStore } from '../store.jsx'
import { Modal } from '../ui.jsx'

const FLOORS = Array.from({ length: 9 }, (_, i) => i + 1)

// Shared "＋ New unit" trigger + form, dropped into both the admin Dashboard
// and the packer's My queue — the only two landing views for roles that can
// create units. Self-hides for any other role, so callers don't need to gate.
export default function NewUnitButton({ toast }) {
  const { currentUser, dispatch } = useStore()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ number: '', tenant: '', floor: '' })
  const [busy, setBusy] = useState(false)

  if (!currentUser || !['admin', 'packer'].includes(currentUser.role)) return null

  const ready = form.number.trim() && form.tenant.trim() && form.floor

  const openModal = () => { setForm({ number: '', tenant: '', floor: '' }); setOpen(true) }
  const close = () => { if (!busy) setOpen(false) }

  const submit = async () => {
    const number = form.number.trim()
    const tenant = form.tenant.trim()
    const floor = Number(form.floor)
    if (!number || !tenant || !floor) return
    setBusy(true)
    try {
      await dispatch({ type: 'createUnit', p: { number, tenant, floor } })
      setOpen(false)
      setForm({ number: '', tenant: '', floor: '' })
      toast?.(`Unit ${number} created ✓`)
    } catch (err) {
      toast?.(err.message || "Couldn't save that. Check your signal and try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="btn btn-primary" onClick={openModal}>＋ New unit</button>
      {open && (
        <Modal title="Add a new unit" sub="Starts at Not started — a packer or admin can begin packing right away." onClose={close}>
          <div className="field">
            <label>Unit number</label>
            <input className="input" autoFocus placeholder="e.g. 5B" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
          </div>
          <div className="field">
            <label>Tenant last name</label>
            <input className="input" placeholder="e.g. Marsh" value={form.tenant} onChange={(e) => setForm({ ...form, tenant: e.target.value })} />
          </div>
          <div className="field">
            <label>Floor</label>
            <select className="input" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })}>
              <option value="">Select floor…</option>
              {FLOORS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={!ready || busy} onClick={submit}>
            {busy ? 'Creating…' : 'Create unit'}
          </button>
        </Modal>
      )}
    </>
  )
}
