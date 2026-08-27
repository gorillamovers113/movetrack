import React, { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { Modal } from '../ui.jsx'
import { uploadImage } from '../lib/upload.js'

// "BigBox swap" — the driver hands off full containers and drops new empties,
// but never touches the app. The on-site mover is the custody witness: pick
// which full containers are going out, record the driver's name/truck,
// photograph the loaded containers, and log any new empties dropped in the
// same trip. One screen, big tap targets — self-gates for mover/admin.
export default function BigBoxSwapButton({ toast }) {
  const { state, currentUser, dispatch } = useStore()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState([])
  const [driverName, setDriverName] = useState('')
  const [rows, setRows] = useState(['', '', '', '', ''])
  const [busy, setBusy] = useState(false)

  const [preview, setPreview] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [photoUrl, setPhotoUrl] = useState(null)
  const [photoError, setPhotoError] = useState(null)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  if (!currentUser || !['admin', 'mover'].includes(currentUser.role)) return null

  const fulls = state.containers.filter((c) => c.status === 'full')

  const openModal = () => {
    setSelected([]); setDriverName(''); setRows(['', '', '', '', ''])
    setPreview(null); setUploading(false); setPhotoUrl(null); setPhotoError(null)
    setOpen(true)
  }
  const close = () => { if (!busy) setOpen(false) }
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const setRow = (i, v) => setRows((r) => r.map((x, idx) => (idx === i ? v : x)))
  const addRow = () => setRows((r) => [...r, ''])
  const removeRow = (i) => setRows((r) => r.filter((_, idx) => idx !== i))
  const newNumbers = rows.map((r) => r.trim()).filter(Boolean)

  const capturePhoto = async (file) => {
    setPhotoError(null); setPreview(URL.createObjectURL(file)); setPhotoUrl(null); setUploading(true)
    try {
      const url = await uploadImage(file, `containers/swaps/${Date.now()}-${currentUser.uid}.jpg`)
      setPhotoUrl(url)
    } catch (err) {
      setPhotoError(err.message || 'Upload failed — try again.')
    } finally {
      setUploading(false)
    }
  }

  const ready = selected.length > 0 && driverName.trim() && !!photoUrl && !uploading

  const submit = async () => {
    if (!ready) return
    setBusy(true)
    try {
      const media = photoUrl ? [{ id: `swap-${Date.now()}`, kind: 'photo', url: photoUrl, label: 'BigBox handoff' }] : []
      await dispatch({ type: 'bigboxSwap', p: { fullIds: selected, driverName: driverName.trim(), newEmptyNumbers: newNumbers, media } })
      setOpen(false)
      toast?.(`Swap logged with ${driverName.trim()} — ${selected.length} out${newNumbers.length ? `, ${newNumbers.length} new empt${newNumbers.length === 1 ? 'y' : 'ies'} in` : ''} ✓`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="btn btn-primary btn-lg" onClick={openModal}>🔄 BigBox swap</button>
      {open && (
        <Modal title="BigBox swap" sub="The driver never opens the app — you're the custody witness for this hand-off." onClose={close}>
          <div className="field">
            <label>Full containers going out</label>
            {fulls.length === 0 ? (
              <div className="empty" style={{ padding: '18px 0' }}>No containers are marked full yet.</div>
            ) : (
              <div className="pick-list">
                {fulls.map((c) => {
                  const units = c.unitIds || []
                  return (
                    <button type="button" key={c.id} className={`pick-row ${selected.includes(c.id) ? 'sel' : ''}`} onClick={() => toggle(c.id)}>
                      <span style={{ fontSize: 17 }}>{selected.includes(c.id) ? '✅' : '⬜'}</span>
                      <span className="cont-num grow">{c.number}</span>
                      <span className="muted">{units.length} unit{units.length === 1 ? '' : 's'}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="field"><label>Driver name / truck #</label>
            <input className="input" autoFocus placeholder="e.g. Mike, Truck 12" value={driverName} onChange={(e) => setDriverName(e.target.value)} /></div>

          <div className="field">
            <label>Photo of the loaded container(s) — required</label>
            <label className="dropzone camera-capture" style={{ display: 'block' }}>
              <input
                type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files[0]; if (f) capturePhoto(f); e.target.value = '' }}
              />
              {preview ? (
                <div className="inv-preview">
                  <img src={preview} alt="Loaded container" className="inv-thumb" />
                  <div className="muted" style={{ marginTop: 8 }}>
                    {uploading ? 'Uploading…' : photoUrl ? '✓ Uploaded — tap to retake' : photoError || 'Tap to retake'}
                  </div>
                </div>
              ) : <>📷 Tap to photograph the loaded container(s)</>}
            </label>
          </div>

          <div className="field">
            <label>New empties dropped off <span className="muted">(optional)</span></label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rows.map((v, i) => (
                <div className="row" key={i}>
                  <input className="input grow" placeholder={`e.g. BB-${2001 + i}`} value={v} onChange={(e) => setRow(i, e.target.value)} />
                  {rows.length > 1 && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeRow(i)}>✕</button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={addRow}>＋ Add another</button>
          </div>

          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={!ready || busy} onClick={submit}>
            {busy ? 'Logging swap…' : 'Confirm BigBox swap'}
          </button>
        </Modal>
      )}
    </>
  )
}
