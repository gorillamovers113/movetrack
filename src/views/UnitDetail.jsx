import React, { useEffect, useMemo, useState } from 'react'
import { STAGES, stageOf } from '../seed.js'
import { useStore, canAct, filesToMedia, fmtTime } from '../store.jsx'
import { Modal, Lightbox, Uploader, EventRow, Avatar, StagePill } from '../ui.jsx'
import { uploadImage } from '../lib/upload.js'

const WAIT_HINTS = {
  loaded: 'Waiting on driver: container pickup from site.',
  picked_up: 'On the truck — driver will check it into the warehouse.',
  at_warehouse: 'Safely stored in the warehouse. Full history preserved below.',
}

export default function UnitDetail({ unitId, goBack, openContainer, toast }) {
  const { state, dispatch, currentUser } = useStore()
  const unit = state.units.find((u) => u.id === unitId)
  const [modal, setModal] = useState(null) // 'action' | 'media' | 'note' | 'resolve'
  const [lightbox, setLightbox] = useState(null)
  const [form, setForm] = useState({})
  const [pending, setPending] = useState([])

  // Packer "Finish packing" inventory-sheet photo: captured via the device
  // camera, resized + uploaded to Storage as soon as it's picked so the
  // upload runs while the packer is still filling in the piece count.
  const [invPreview, setInvPreview] = useState(null)
  const [invUploading, setInvUploading] = useState(false)
  const [invUrl, setInvUrl] = useState(null)
  const [invError, setInvError] = useState(null)

  useEffect(() => () => { if (invPreview) URL.revokeObjectURL(invPreview) }, [invPreview])

  const resetInventoryCapture = () => {
    setInvPreview(null)
    setInvUploading(false)
    setInvUrl(null)
    setInvError(null)
  }

  const captureInventoryPhoto = async (file) => {
    setInvError(null)
    setInvPreview(URL.createObjectURL(file))
    setInvUrl(null)
    setInvUploading(true)
    try {
      const path = `units/${unitId}/inventory/${Date.now()}-${currentUser.uid}.jpg`
      const url = await uploadImage(file, path)
      setInvUrl(url)
    } catch (err) {
      setInvError(err.message || 'Upload failed — try again.')
    } finally {
      setInvUploading(false)
    }
  }

  const events = useMemo(() => state.events.filter((e) => e.unitId === unitId).sort((a, b) => b.ts - a.ts), [state.events, unitId])
  if (!unit) return null

  const action = canAct(currentUser, unit)
  const canContribute = currentUser && currentUser.role !== 'viewer'
  const stage = stageOf(unit.stage)
  const conts = unit.containerIds.map((id) => state.containers.find((c) => c.id === id)).filter(Boolean)
  const crewName = (uid) => state.users.find((u) => u.id === uid)?.name
  const crewNames = (uids) => (uids || []).map(crewName).filter(Boolean).join(', ')

  const openAction = () => { setForm({}); setPending([]); resetInventoryCapture(); setModal('action') }
  const closeActionModal = () => { setModal(null); resetInventoryCapture() }

  const submitAction = () => {
    const media = pending
    const needsPhoto = ['loadUnit'].includes(action.key)
    if (needsPhoto && !media.some((m) => m.kind === 'photo')) {
      return alert('At least one photo is required to complete this step — the photo record is the whole point.')
    }
    if (action.key === 'startPacking') dispatch({ type: 'startPacking', p: { unitId } })
    if (action.key === 'finishPacking') {
      const n = parseInt(form.pieces)
      if (!n || n < 1) return alert('Enter the total pieces packed.')
      if (invUploading) return alert('Still uploading the inventory sheet photo — wait a moment and try again.')
      if (!invUrl) return alert('Take a photo of the paper inventory sheet to finish packing.')
      const invMedia = [{ id: `inv-${Date.now()}`, kind: 'photo', url: invUrl, label: 'inventory', phase: 'inventory', uid: currentUser.uid, ts: Date.now() }]
      dispatch({ type: 'finishPacking', p: { unitId, pieces: n, media: invMedia } })
    }
    if (action.key === 'loadUnit') {
      const cn = (form.containerNumber || '').trim()
      const n = parseInt(form.pieces)
      if (!cn) return alert('Enter the container number.')
      if (!n || n < 1) return alert('Enter the piece count you verified while loading.')
      dispatch({ type: 'loadUnit', p: { unitId, containerNumber: cn, pieces: n, media } })
      if (unit.pieces != null && n !== unit.pieces) toast(`⚑ Piece count mismatch flagged (${n} vs ${unit.pieces})`)
    }
    closeActionModal()
    if (action.key !== 'loadUnit' || unit.pieces == null || parseInt(form.pieces) === unit.pieces) toast('Logged — timestamped under your name ✓')
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn btn-ghost btn-sm" onClick={goBack}>← Back</button>
      </div>

      <div className="page-head" style={{ marginBottom: 14 }}>
        <div>
          <div className="row" style={{ gap: 12 }}>
            <h1>Unit {unit.number}</h1>
            <StagePill stage={unit.stage} />
          </div>
          <p>{unit.tenant || '—'} · Floor {unit.floor}{unit.pieces ? ` · ${unit.pieces} pieces` : ''}</p>
        </div>
        <div className="row">
          {action && <button className="btn btn-primary btn-lg" onClick={openAction}>{action.label}</button>}
          {!action && WAIT_HINTS[unit.stage] && <span className="muted" style={{ maxWidth: 300, textAlign: 'right' }}>{WAIT_HINTS[unit.stage]}</span>}
        </div>
      </div>

      <div className="card" style={{ padding: '14px 20px 16px', marginBottom: 18 }}>
        <div className="stepper">
          {STAGES.slice(1).map((s) => (
            <div key={s.key} className={`step ${stage.step >= s.step ? 'done' : ''} ${stage.step === s.step ? 'now' : ''}`} style={{ '--stage-c': s.color }}>
              <div className="bar" />
              <div className="cap">{s.short}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="detail-grid">
        <div>
          <div className="card" style={{ padding: '6px 20px' }}>
            <div className="section-title" style={{ marginTop: 14 }}>Activity — who, what, when</div>
            <div className="timeline">
              {events.length === 0 && <div className="empty"><div className="big">🗂️</div>No activity yet. It starts when a packer opens this unit.</div>}
              {events.map((e) => <EventRow key={e.id} e={e} onOpenMedia={setLightbox} showTarget={false} />)}
            </div>
          </div>
        </div>

        <div>
          <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
            <div className="row" style={{ marginBottom: 2 }}>
              <div className="section-title grow" style={{ margin: 0 }}>Details</div>
              {currentUser.role === 'admin' && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ tenant: unit.tenant, phone: unit.phone, note: unit.note }); setModal('edit') }}>✎ Edit</button>
              )}
            </div>
            <dl className="info-rows">
              <dt>Tenant</dt><dd>{unit.tenant || '—'}</dd>
              <dt>Phone</dt><dd>{unit.phone}</dd>
              <dt>Floor</dt><dd>{unit.floor}</dd>
              <dt>Pieces packed</dt><dd>{unit.pieces ?? '—'}</dd>
              <dt>Container</dt>
              <dd>
                {conts.length === 0 && '—'}
                {conts.map((c) => (
                  <span key={c.id} className="linkish" onClick={() => openContainer(c.id)} style={{ marginRight: 10 }}>{c.number}{c.bay ? ` (${c.bay})` : ''}</span>
                ))}
              </dd>
              <dt>Packer</dt><dd>{crewNames(unit.crew?.packers) || '—'}</dd>
              <dt>Mover</dt><dd>{crewNames(unit.crew?.movers) || '—'}</dd>
            </dl>
            {unit.note && <div style={{ marginTop: 10, fontSize: 13.5, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '9px 12px' }}>⚠️ {unit.note}</div>}

            {unit.flag && (
              <div className={`flagbox ${unit.flag.open ? '' : 'closed'}`}>
                <b>{unit.flag.open ? '⚑ Open flag' : '✓ Resolved flag'}</b> — {unit.flag.message}
                <div className="muted" style={{ marginTop: 4 }}>Raised by {unit.flag.by} · {fmtTime(unit.flag.ts)}</div>
                {unit.flag.open && currentUser.role === 'admin' && (
                  <button className="btn btn-dark btn-sm" style={{ marginTop: 10 }} onClick={() => { setForm({}); setModal('resolve') }}>Resolve flag</button>
                )}
                {unit.flag.open && currentUser.role !== 'admin' && <div className="muted" style={{ marginTop: 8 }}>Only the admin can resolve flags.</div>}
              </div>
            )}
          </div>

          {canContribute && (
            <div className="card" style={{ padding: '16px 20px' }}>
              <div className="section-title" style={{ marginTop: 0 }}>Add to the record</div>
              <Uploader onFiles={async (files) => {
                const media = await filesToMedia(files)
                if (media.length) { dispatch({ type: 'addMedia', p: { unitId, media } }); toast(`${media.length} file${media.length > 1 ? 's' : ''} added to unit ${unit.number} ✓`) }
              }} />
              <button className="btn btn-ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => { setForm({}); setModal('note') }}>📝 Add a note</button>
            </div>
          )}
        </div>
      </div>

      {modal === 'action' && action && (
        <Modal title={action.label} sub={`Unit ${unit.number} · ${unit.tenant} — logged as ${currentUser.name}, ${fmtTime(Date.now())}`} onClose={closeActionModal}>
          {action.key === 'finishPacking' && (
            <>
              <div className="field"><label>Total pieces packed</label>
                <input className="input" type="number" min="1" inputMode="numeric" autoFocus placeholder="e.g. 42" value={form.pieces || ''} onChange={(e) => setForm({ ...form, pieces: e.target.value })} /></div>
              <div className="field">
                <label>Photo of the paper inventory sheet — required</label>
                <label className="dropzone camera-capture" style={{ display: 'block' }}>
                  <input
                    type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files[0]; if (f) captureInventoryPhoto(f); e.target.value = '' }}
                  />
                  {invPreview ? (
                    <div className="inv-preview">
                      <img src={invPreview} alt="Inventory sheet" className="inv-thumb" />
                      <div className="muted" style={{ marginTop: 8 }}>
                        {invUploading ? 'Uploading…' : invUrl ? '✓ Uploaded — tap to retake' : invError || 'Tap to retake'}
                      </div>
                    </div>
                  ) : <>📷 Tap to photograph the inventory sheet</>}
                </label>
              </div>
            </>
          )}
          {action.key === 'loadUnit' && (
            <>
              <div className="field"><label>Container number</label>
                <input className="input" autoFocus placeholder="e.g. C-21" value={form.containerNumber || ''} onChange={(e) => setForm({ ...form, containerNumber: e.target.value })} /></div>
              <div className="field"><label>Pieces counted while loading {unit.pieces != null && <span className="muted">(packer recorded {unit.pieces})</span>}</label>
                <input className="input" type="number" min="1" placeholder={unit.pieces ?? 'count'} value={form.pieces || ''} onChange={(e) => setForm({ ...form, pieces: e.target.value })} /></div>
            </>
          )}
          {action.key !== 'startPacking' && action.key !== 'finishPacking' && (
            <div className="field">
              <label>Photos required — video encouraged</label>
              <Uploader onFiles={async (files) => setPending([...pending, ...(await filesToMedia(files))])} />
              {pending.length > 0 && <div className="muted" style={{ marginTop: 6 }}>{pending.length} file{pending.length > 1 ? 's' : ''} attached</div>}
            </div>
          )}
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={action.key === 'finishPacking' && invUploading} onClick={submitAction}>Confirm — {action.label}</button>
        </Modal>
      )}

      {modal === 'note' && (
        <Modal title="Add a note" sub={`Unit ${unit.number} — logged as ${currentUser.name} with date & time`} onClose={() => setModal(null)}>
          <div className="field">
            <textarea className="input" rows="4" autoFocus placeholder="e.g. Tenant asked us to keep the bikes accessible…" value={form.text || ''} onChange={(e) => setForm({ ...form, text: e.target.value })} />
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={!form.text?.trim()} onClick={() => {
            dispatch({ type: 'addNote', p: { unitId, text: form.text.trim() } })
            setModal(null); toast('Note added ✓')
          }}>Save note</button>
        </Modal>
      )}

      {modal === 'edit' && (
        <Modal title={`Edit unit ${unit.number}`} sub="Admin only — the change itself gets logged in the activity record." onClose={() => setModal(null)}>
          <div className="field"><label>Tenant name</label>
            <input className="input" value={form.tenant || ''} onChange={(e) => setForm({ ...form, tenant: e.target.value })} /></div>
          <div className="field"><label>Phone</label>
            <input className="input" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="field"><label>Special notes</label>
            <textarea className="input" rows="2" value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Piano — needs 4-person crew" /></div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => {
            dispatch({ type: 'editUnit', p: { unitId, patch: { tenant: form.tenant.trim(), phone: form.phone.trim(), note: (form.note || '').trim() } } })
            setModal(null); toast('Unit updated — edit logged ✓')
          }}>Save changes</button>
        </Modal>
      )}

      {modal === 'resolve' && (
        <Modal title="Resolve flag" sub={unit.flag?.message} onClose={() => setModal(null)}>
          <div className="field"><label>How was it resolved?</label>
            <textarea className="input" rows="3" autoFocus value={form.text || ''} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="e.g. Recounted at warehouse — all 18 pieces present." /></div>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={!form.text?.trim()} onClick={() => {
            dispatch({ type: 'resolveFlag', p: { unitId, note: form.text.trim() } })
            setModal(null); toast('Flag resolved ✓')
          }}>Mark resolved</button>
        </Modal>
      )}

      <Lightbox media={lightbox} onClose={() => setLightbox(null)} />
    </>
  )
}
