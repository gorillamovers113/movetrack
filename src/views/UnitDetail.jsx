import React, { useEffect, useMemo, useState } from 'react'
import { STAGES, stageOf } from '../seed.js'
import { useStore, canAct, filesToMedia, fmtTime, CONT_STATUS } from '../store.jsx'
import { Modal, Lightbox, Uploader, EventRow, Avatar, StagePill } from '../ui.jsx'
import { uploadImage } from '../lib/upload.js'
import ReportOverflowButton from '../components/ReportOverflowButton.jsx'

const WAIT_HINTS = {
  loaded: 'Waiting on driver: container pickup from site.',
  picked_up: 'On the truck — driver will check it into the warehouse.',
  at_warehouse: 'Safely stored in the warehouse. Full history preserved below.',
  return_loaded: 'Waiting on the warehouse to dispatch the return container back to site.',
  return_transit: 'On the truck, heading back to the building.',
  back_on_site: 'Back on site. Waiting on a mover to unload it into the apartment.',
  unloaded: 'Unloaded into the apartment. Waiting on a packer to unpack it.',
  unpacked: 'Complete. This unit has made its full round trip.',
}

export default function UnitDetail({ unitId, goBack, openContainer, toast }) {
  const { state, dispatch, currentUser } = useStore()
  const unit = state.units.find((u) => u.id === unitId)
  const [modal, setModal] = useState(null) // 'action' | 'media' | 'note' | 'resolve'
  const [lightbox, setLightbox] = useState(null)
  const [form, setForm] = useState({})
  const [pending, setPending] = useState([])
  // Guards every dispatch below from a double-tap firing the same write
  // twice, and gates the confirm buttons while a write is in flight.
  const [busy, setBusy] = useState(false)
  const SAVE_ERROR = "Couldn't save that. Check your signal and try again."

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

  const action = canAct(currentUser, unit, state.project?.returnPhase)
  const canContribute = currentUser && currentUser.role !== 'viewer'
  const stage = stageOf(unit.stage)
  const conts = (unit.containerIds || []).map((id) => state.containers.find((c) => c.id === id)).filter(Boolean)
  // On-site containers still available to load into — mover picks from
  // this list instead of typing a container number.
  const loadableContainers = state.containers.filter((c) => c.status === 'empty' || c.status === 'filling')
  // Return-leg mirror: return containers still open to load a unit back into
  // at the warehouse (docs/superpowers/specs/2026-08-26-return-phase-design.md §3).
  const returnLoadableContainers = state.containers.filter((c) => c.status === 'at_warehouse' || c.status === 'return_filling')
  // Outbound-only stepper (packing..at_warehouse) unless the return phase is
  // on, so the unit page looks exactly like it does today until the return
  // leg is actually in play.
  const stepperStages = STAGES.slice(1).filter((s) => state.project?.returnPhase || s.step <= 5)
  const crewName = (uid) => state.users.find((u) => u.id === uid)?.name
  const crewNames = (uids) => (uids || []).map(crewName).filter(Boolean).join(', ')

  const openAction = () => { setForm({}); setPending([]); resetInventoryCapture(); setModal('action') }
  const closeActionModal = () => { setModal(null); resetInventoryCapture() }

  const submitAction = async () => {
    if (busy) return
    const media = pending
    const needsPhoto = ['loadUnit', 'loadForReturn', 'unloadReturn', 'unpackUnit'].includes(action.key)
    if (needsPhoto && !media.some((m) => m.kind === 'photo')) {
      return alert('At least one photo is required to complete this step — the photo record is the whole point.')
    }
    // Client-side validation up front, same as before: nothing here talks to
    // Firestore, so it stays outside the busy/try below.
    const n = parseInt(form.pieces)
    if (action.key === 'finishPacking') {
      if (!n || n < 1) return alert('Enter the total pieces packed.')
      if (invUploading) return alert('Still uploading the inventory sheet photo — wait a moment and try again.')
      if (!invUrl) return alert('Take a photo of the paper inventory sheet to finish packing.')
    }
    if (action.key === 'loadUnit') {
      if (!form.containerId) return alert('Pick a container to load into.')
      if (!n || n < 1) return alert('Enter the piece count you verified while loading.')
    }
    if (action.key === 'loadForReturn') {
      if (!form.containerId) return alert('Pick a return container to load into.')
      if (!n || n < 1) return alert('Enter the piece count you verified while loading.')
    }
    if (action.key === 'unloadReturn') {
      if (!n || n < 1) return alert('Enter the piece count you verified while unloading.')
    }

    setBusy(true)
    try {
      if (action.key === 'startPacking') await dispatch({ type: 'startPacking', p: { unitId } })
      if (action.key === 'finishPacking') {
        const invMedia = [{ id: `inv-${Date.now()}`, kind: 'photo', url: invUrl, label: 'inventory', phase: 'inventory', uid: currentUser.uid, ts: Date.now() }]
        await dispatch({ type: 'finishPacking', p: { unitId, pieces: n, media: invMedia } })
      }
      if (action.key === 'loadUnit') {
        // loadUnit can throw if the picked container was just filled or
        // swapped out by someone else in the meantime (a real race, not a
        // bug): the catch below toasts instead of leaving the crew member
        // staring at a form that silently did nothing.
        await dispatch({ type: 'loadUnit', p: { unitId, containerId: form.containerId, pieces: n, media } })
      }
      if (action.key === 'loadForReturn') {
        // loadForReturn can throw if the picked container was just filled or
        // dispatched by someone else in the meantime (a real race, not a
        // bug): catch it and toast so the warehouse worker can refresh and
        // pick another container instead of the form silently doing nothing.
        await dispatch({ type: 'loadForReturn', p: { unitId, containerId: form.containerId, pieces: n, media } })
      }
      if (action.key === 'unloadReturn') {
        await dispatch({ type: 'unloadReturn', p: { unitId, pieces: n, media } })
      }
      if (action.key === 'unpackUnit') {
        await dispatch({ type: 'unpackUnit', p: { unitId, media } })
      }
      closeActionModal()
      const pieceCheckKeys = ['loadUnit', 'unloadReturn', 'loadForReturn']
      if (pieceCheckKeys.includes(action.key) && unit.pieces != null && n !== unit.pieces) {
        toast(`⚑ Piece count mismatch flagged (${n} vs ${unit.pieces})`)
      } else {
        toast('Logged, timestamped under your name ✓')
      }
    } catch (err) {
      toast(err.message || SAVE_ERROR)
    } finally {
      setBusy(false)
    }
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
          {stepperStages.map((s) => (
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
                if (!media.length) return
                try {
                  await dispatch({ type: 'addMedia', p: { unitId, media } })
                  toast(`${media.length} file${media.length > 1 ? 's' : ''} added to unit ${unit.number} ✓`)
                } catch (err) {
                  toast(err.message || SAVE_ERROR)
                }
              }} />
              <button className="btn btn-ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => { setForm({}); setModal('note') }}>📝 Add a note</button>
              <div style={{ marginTop: 10 }}>
                <ReportOverflowButton unitId={unitId} toast={toast} fullWidth />
              </div>
            </div>
          )}
        </div>
      </div>

      {modal === 'action' && action && (
        <Modal title={action.label} sub={`Unit ${unit.number} · ${unit.tenant} — logged as ${currentUser.name}, ${fmtTime(Date.now())}`} onClose={() => { if (!busy) closeActionModal() }}>
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
              <div className="field">
                <label>Load into which container?</label>
                {loadableContainers.length === 0 ? (
                  <div className="empty" style={{ padding: '22px 10px' }}>
                    <div className="big">📦</div>No containers on site yet — log empties in from the Containers page first.
                  </div>
                ) : (
                  <div className="pick-list">
                    {loadableContainers.map((c) => (
                      <button
                        type="button" key={c.id}
                        className={`pick-row ${form.containerId === c.id ? 'sel' : ''}`}
                        onClick={() => setForm({ ...form, containerId: c.id })}
                      >
                        <span className="cont-num grow">{c.number}</span>
                        <span className="badge" style={{ background: CONT_STATUS[c.status].color + '22', color: CONT_STATUS[c.status].color }}>{CONT_STATUS[c.status].label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="field"><label>Pieces counted while loading {unit.pieces != null && <span className="muted">(packer recorded {unit.pieces})</span>}</label>
                <input className="input" type="number" min="1" inputMode="numeric" placeholder={unit.pieces ?? 'count'} value={form.pieces || ''} onChange={(e) => setForm({ ...form, pieces: e.target.value })} /></div>
            </>
          )}
          {action.key === 'loadForReturn' && (
            <>
              <div className="field">
                <label>Load into which return container?</label>
                {returnLoadableContainers.length === 0 ? (
                  <div className="empty" style={{ padding: '22px 10px' }}>
                    <div className="big">📦</div>No return containers available yet at the warehouse.
                  </div>
                ) : (
                  <div className="pick-list">
                    {returnLoadableContainers.map((c) => (
                      <button
                        type="button" key={c.id}
                        className={`pick-row ${form.containerId === c.id ? 'sel' : ''}`}
                        onClick={() => setForm({ ...form, containerId: c.id })}
                      >
                        <span className="cont-num grow">{c.number}</span>
                        <span className="badge" style={{ background: CONT_STATUS[c.status].color + '22', color: CONT_STATUS[c.status].color }}>{CONT_STATUS[c.status].label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="field"><label>Pieces counted while loading for return {unit.pieces != null && <span className="muted">(left with {unit.pieces})</span>}</label>
                <input className="input" type="number" min="1" inputMode="numeric" placeholder={unit.pieces ?? 'count'} value={form.pieces || ''} onChange={(e) => setForm({ ...form, pieces: e.target.value })} /></div>
            </>
          )}
          {action.key === 'unloadReturn' && (
            <div className="field"><label>Pieces counted while unloading {unit.pieces != null && <span className="muted">(packed with {unit.pieces})</span>}</label>
              <input className="input" type="number" min="1" inputMode="numeric" autoFocus placeholder={unit.pieces ?? 'count'} value={form.pieces || ''} onChange={(e) => setForm({ ...form, pieces: e.target.value })} /></div>
          )}
          {action.key !== 'startPacking' && action.key !== 'finishPacking' && (
            <div className="field">
              <label>Photos required — video encouraged</label>
              <Uploader onFiles={async (files) => setPending([...pending, ...(await filesToMedia(files))])} />
              {pending.length > 0 && <div className="muted" style={{ marginTop: 6 }}>{pending.length} file{pending.length > 1 ? 's' : ''} attached</div>}
            </div>
          )}
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy || (action.key === 'finishPacking' && invUploading)} onClick={submitAction}>{busy ? 'Saving…' : `Confirm — ${action.label}`}</button>
        </Modal>
      )}

      {modal === 'note' && (
        <Modal title="Add a note" sub={`Unit ${unit.number} — logged as ${currentUser.name} with date & time`} onClose={() => { if (!busy) setModal(null) }}>
          <div className="field">
            <textarea className="input" rows="4" autoFocus placeholder="e.g. Tenant asked us to keep the bikes accessible…" value={form.text || ''} onChange={(e) => setForm({ ...form, text: e.target.value })} />
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || !form.text?.trim()} onClick={async () => {
            setBusy(true)
            try {
              await dispatch({ type: 'addNote', p: { unitId, text: form.text.trim() } })
              setModal(null); toast('Note added ✓')
            } catch (err) {
              toast(err.message || SAVE_ERROR)
            } finally {
              setBusy(false)
            }
          }}>{busy ? 'Saving…' : 'Save note'}</button>
        </Modal>
      )}

      {modal === 'edit' && (
        <Modal title={`Edit unit ${unit.number}`} sub="Admin only — the change itself gets logged in the activity record." onClose={() => { if (!busy) setModal(null) }}>
          <div className="field"><label>Tenant name</label>
            <input className="input" value={form.tenant || ''} onChange={(e) => setForm({ ...form, tenant: e.target.value })} /></div>
          <div className="field"><label>Phone</label>
            <input className="input" value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div className="field"><label>Special notes</label>
            <textarea className="input" rows="2" value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Piano — needs 4-person crew" /></div>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || !(form.tenant || '').trim()} onClick={async () => {
            setBusy(true)
            try {
              await dispatch({ type: 'editUnit', p: { unitId, patch: { tenant: (form.tenant || '').trim(), phone: (form.phone || '').trim(), note: (form.note || '').trim() } } })
              setModal(null); toast('Unit updated — edit logged ✓')
            } catch (err) {
              toast(err.message || SAVE_ERROR)
            } finally {
              setBusy(false)
            }
          }}>{busy ? 'Saving…' : 'Save changes'}</button>
        </Modal>
      )}

      {modal === 'resolve' && (
        <Modal title="Resolve flag" sub={unit.flag?.message} onClose={() => { if (!busy) setModal(null) }}>
          <div className="field"><label>How was it resolved?</label>
            <textarea className="input" rows="3" autoFocus value={form.text || ''} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="e.g. Recounted at warehouse — all 18 pieces present." /></div>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || !form.text?.trim()} onClick={async () => {
            setBusy(true)
            try {
              await dispatch({ type: 'resolveFlag', p: { unitId, note: form.text.trim() } })
              setModal(null); toast('Flag resolved ✓')
            } catch (err) {
              toast(err.message || SAVE_ERROR)
            } finally {
              setBusy(false)
            }
          }}>{busy ? 'Saving…' : 'Mark resolved'}</button>
        </Modal>
      )}

      <Lightbox media={lightbox} onClose={() => setLightbox(null)} />
    </>
  )
}
