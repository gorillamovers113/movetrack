import React, { useEffect, useState } from 'react'
import { useStore } from '../store.jsx'
import { Modal } from '../ui.jsx'
import { uploadImage } from '../lib/upload.js'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'
import { matchContainerByNumber } from '../lib/mutations.js'

// "Receive returning BigBox": the blind container-number check on the
// return leg's deliver step (docs/superpowers/specs/2026-08-26-return-phase-design.md,
// "Blind container-number check on deliverReturn"). The mover reads the
// number off the physical container, cold, and types it in here. Nothing
// on this screen shows or pre-fills any container number, on purpose, so a
// genuine misread gets caught instead of silently rubber-stamped. Self-gates
// for mover/admin, and only shows once the return phase is on (return_transit
// containers only exist then).
export default function DeliverReturnButton({ toast }) {
  const { state, currentUser, dispatch } = useStore()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const [busy, setBusy] = useState(false)

  const [preview, setPreview] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [photoUrl, setPhotoUrl] = useState(null)
  const [photoError, setPhotoError] = useState(null)

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  if (!currentUser || !['admin', 'mover'].includes(currentUser.role)) return null
  if (!state.project?.returnPhase) return null

  const openModal = () => {
    setTyped(''); setMismatch(false); setBusy(false)
    setPreview(null); setUploading(false); setPhotoUrl(null); setPhotoError(null)
    setOpen(true)
  }
  const close = () => { if (!busy) setOpen(false) }

  const capturePhoto = async (file) => {
    setPhotoError(null); setPreview(URL.createObjectURL(file)); setPhotoUrl(null); setUploading(true)
    try {
      const url = await uploadImage(file, `containers/returns/${Date.now()}-${currentUser.uid}.jpg`)
      setPhotoUrl(url)
    } catch (err) {
      setPhotoError(err.message || 'Upload failed, try again.')
    } finally {
      setUploading(false)
    }
  }

  const submit = async () => {
    const number = typed.trim()
    if (!number) return
    const match = matchContainerByNumber(state.containers, number, 'return_transit')
    if (!match) {
      setMismatch(true)
      return
    }
    setBusy(true)
    try {
      const media = photoUrl ? [{ id: `deliver-${Date.now()}`, kind: 'photo', url: photoUrl, label: `Container ${match.number} back on site` }] : []
      const status = await submitWrite(dispatch({ type: 'deliverReturn', p: { containerId: match.id, media } }))
      setOpen(false)
      toast?.(status === 'queued' ? QUEUED_MESSAGE : `Verified, BigBox ${match.number} is back on site ✓`)
    } catch (err) {
      toast?.(err.message || "Couldn't save that. Check your signal and try again.")
    } finally {
      setBusy(false)
    }
  }

  // No match on the typed number: log it for the admin (reusing the
  // existing addNote event mechanism, since a mismatch has no container to
  // attach to) instead of dropping the discrepancy on the floor.
  const reportDiscrepancy = async () => {
    setBusy(true)
    try {
      const status = await submitWrite(dispatch({
        type: 'addNote',
        p: { containerId: '', text: `Return delivery check: typed container number "${typed.trim()}" did not match any container expected back on site. Flagged for admin review.` },
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
      <button className="btn btn-primary btn-lg" onClick={openModal}>📥 Receive returning BigBox</button>
      {open && (
        <Modal title="Receive returning BigBox" sub="Type the number off the physical container, cold. Numbers are never shown here on purpose." onClose={close}>
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
              <b>No match.</b> No returning BigBox with that number is expected. Double-check the number on the container.
              <div className="row" style={{ marginTop: 10, gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setMismatch(false)}>Re-type</button>
                <button className="btn btn-danger btn-sm" disabled={busy} onClick={reportDiscrepancy}>{busy ? 'Reporting…' : 'Report discrepancy'}</button>
              </div>
            </div>
          )}

          {!mismatch && (
            <>
              <div className="field">
                <label>Photo <span className="muted">(optional)</span></label>
                <label className="dropzone camera-capture" style={{ display: 'block' }}>
                  <input
                    type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files[0]; if (f) capturePhoto(f); e.target.value = '' }}
                  />
                  {preview ? (
                    <div className="inv-preview">
                      <img src={preview} alt="Returning container" className="inv-thumb" />
                      <div className="muted" style={{ marginTop: 8 }}>
                        {uploading ? 'Uploading…' : photoUrl ? '✓ Uploaded, tap to retake' : photoError || 'Tap to retake'}
                      </div>
                    </div>
                  ) : <>📷 Tap to add a photo</>}
                </label>
              </div>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={!typed.trim() || busy || uploading} onClick={submit}>
                {busy ? 'Checking…' : 'Verify & receive'}
              </button>
            </>
          )}
        </Modal>
      )}
    </>
  )
}
