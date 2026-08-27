import React, { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { Modal } from '../ui.jsx'
import { captureMedia } from '../lib/upload.js'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'
import { matchContainerByNumber } from '../lib/mutations.js'

// "Receive incoming BigBox": the blind container-number check on the
// outbound warehouse-receive step, mirroring DeliverReturnButton.jsx's
// return-leg check (matchContainerByNumber was written general on purpose
// so it could be reused here, see its comment in lib/mutations.js). The
// mover already typed the container number once at empties-in; the
// warehouse reads it again off the physical container, cold, and types it
// in here. Nothing on this screen shows or pre-fills any container number
// before the check runs, on purpose, so this catches both a mover typo at
// empties-in and the wrong physical container showing up. Self-gates for
// warehouse/admin. Replaces the old card-click "Receive" entry, which
// showed the container number before the count was taken (not blind).
export default function ReceiveContainerButton({ toast }) {
  const { state, currentUser, dispatch } = useStore()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const [matched, setMatched] = useState(null)
  const [busy, setBusy] = useState(false)

  const [verify, setVerify] = useState('')
  const [bay, setBay] = useState('')

  const [preview, setPreview] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [photoUrl, setPhotoUrl] = useState(null)
  const [photoError, setPhotoError] = useState(null)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  if (!currentUser || !['admin', 'warehouse'].includes(currentUser.role)) return null

  const openModal = () => {
    setTyped(''); setMismatch(false); setMatched(null); setBusy(false)
    setVerify(''); setBay('')
    setPreview(null); setUploading(false); setPhotoUrl(null); setPhotoError(null)
    setOpen(true)
  }
  const close = () => { if (!busy) setOpen(false) }

  const capturePhoto = async (file) => {
    setPhotoError(null); setPreview(URL.createObjectURL(file)); setPhotoUrl(null); setUploading(true)
    try {
      const { url } = await captureMedia(file, `containers/${matched.id}/receive/${Date.now()}-${currentUser.uid}.jpg`)
      setPhotoUrl(url)
    } catch (err) {
      setPhotoError(err.message || 'Capture failed, try again.')
    } finally {
      setUploading(false)
    }
  }

  const checkNumber = () => {
    const number = typed.trim()
    if (!number) return
    const found = matchContainerByNumber(state.containers, number, 'picked_up')
    if (!found) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    setMatched(found)
  }

  const submit = async () => {
    if (!matched) return
    const n = parseInt(verify)
    if (!bay.trim()) return alert('Assign a warehouse bay.')
    if (verify === '' || isNaN(n) || n < 0) return alert('Enter the pieces counted at receiving.')
    setBusy(true)
    try {
      const media = photoUrl ? [{ id: `recv-${Date.now()}`, kind: 'photo', url: photoUrl, label: `Container ${matched.number} received` }] : []
      const status = await submitWrite(dispatch({ type: 'warehouseReceive', p: { containerId: matched.id, verifiedPieces: n, bay: bay.trim(), media } }))
      const expected = matched.unitIds.reduce((sum, id) => sum + (state.units.find((u) => u.id === id)?.pieces || 0), 0)
      setOpen(false)
      if (status === 'queued') {
        toast?.(QUEUED_MESSAGE)
      } else {
        toast?.(expected && n !== expected ? `Mismatch flagged (${n} vs ${expected}) ⚑` : `Verified, BigBox ${matched.number} received at ${bay.trim()} ✓`)
      }
    } catch (err) {
      toast?.(err.message || "Couldn't save that. Check your signal and try again.")
    } finally {
      setBusy(false)
    }
  }

  // No match on the typed number: log it for the admin (reusing the
  // existing addNote event mechanism, same as DeliverReturnButton, since a
  // mismatch has no container to attach to) instead of dropping the
  // discrepancy on the floor.
  const reportDiscrepancy = async () => {
    setBusy(true)
    try {
      const status = await submitWrite(dispatch({
        type: 'addNote',
        p: { containerId: '', text: `Warehouse receive check: typed container number "${typed.trim()}" did not match any incoming BigBox expected at warehouse. Flagged for admin review.` },
      }))
      setOpen(false)
      toast?.(status === 'queued' ? QUEUED_MESSAGE : 'Discrepancy reported to admin ✓')
    } catch (err) {
      toast?.(err.message || "Couldn't save that. Check your signal and try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="btn btn-primary btn-lg" onClick={openModal}>📥 Receive incoming BigBox</button>
      {open && (
        <Modal title="Receive incoming BigBox" sub="Type the number off the physical container, cold. Numbers are never shown here on purpose." onClose={close}>
          {!matched && (
            <>
              <div className="field">
                <label>Container number</label>
                <input
                  className="input" autoFocus inputMode="text" autoCapitalize="characters"
                  placeholder="e.g. BB-1007" value={typed}
                  onChange={(e) => { setTyped(e.target.value); setMismatch(false) }}
                />
              </div>

              {mismatch && (
                <div className="flagbox" style={{ marginBottom: 14 }}>
                  <b>No match.</b> No incoming BigBox with that number is expected. Double-check the number on the container.
                  <div className="row" style={{ marginTop: 10, gap: 8 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setMismatch(false)}>Re-type</button>
                    <button className="btn btn-danger btn-sm" disabled={busy} onClick={reportDiscrepancy}>{busy ? 'Reporting…' : 'Report discrepancy'}</button>
                  </div>
                </div>
              )}

              {!mismatch && (
                <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={!typed.trim()} onClick={checkNumber}>
                  Check number
                </button>
              )}
            </>
          )}

          {matched && (
            <>
              <div className="muted" style={{ marginBottom: 12 }}>Matched: BigBox {matched.number}, in transit.</div>
              <div className="field">
                <label>Pieces counted{(() => {
                  const expected = matched.unitIds.reduce((sum, id) => sum + (state.units.find((u) => u.id === id)?.pieces || 0), 0)
                  return expected > 0 ? <span className="muted"> ({expected} on record)</span> : null
                })()}</label>
                <input className="input" type="number" min="0" inputMode="numeric" placeholder="count" value={verify} onChange={(e) => setVerify(e.target.value)} />
              </div>
              <div className="field"><label>Warehouse bay</label>
                <input className="input" placeholder="e.g. Bay 4" value={bay} onChange={(e) => setBay(e.target.value)} /></div>
              <div className="field">
                <label>Photo <span className="muted">(optional)</span></label>
                <label className="dropzone camera-capture" style={{ display: 'block' }}>
                  <input
                    type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files[0]; if (f) capturePhoto(f); e.target.value = '' }}
                  />
                  {preview ? (
                    <div className="inv-preview">
                      <img src={preview} alt="Received container" className="inv-thumb" />
                      <div className="muted" style={{ marginTop: 8 }}>
                        {uploading ? 'Saving…' : photoUrl ? '✓ Photo saved, tap to retake' : photoError || 'Tap to retake'}
                      </div>
                    </div>
                  ) : <>📷 Tap to add a photo</>}
                </label>
              </div>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy || uploading} onClick={submit}>
                {busy ? 'Logging…' : 'Confirm receipt'}
              </button>
            </>
          )}
        </Modal>
      )}
    </>
  )
}
