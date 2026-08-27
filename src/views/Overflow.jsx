import React, { useMemo, useState } from 'react'
import { useStore, OVERFLOW_STATUS, overflowAction } from '../store.jsx'
import { Modal, Lightbox, EventRow, AttributedMedia } from '../ui.jsx'
import { uploadImage } from '../lib/upload.js'
import ReportOverflowButton from '../components/ReportOverflowButton.jsx'

// Lifecycle order the pool view groups by, matches OVERFLOW_STATUS in
// store.jsx: identified (needs prep) → prepped (ready to transport) →
// in_transit → at_warehouse, then the return leg's mirror: rt_transit
// (heading back to site) → returned. The return stages only ever have items
// in them once the return phase has actually been used.
const STAGE_ORDER = ['identified', 'prepped', 'in_transit', 'at_warehouse', 'rt_transit', 'returned']

export default function Overflow({ openUnit, focusId, clearFocus, toast }) {
  const { state, dispatch, currentUser } = useStore()
  const [openId, setOpenId] = useState(focusId || null)
  const [lightbox, setLightbox] = useState(null)
  const [resolveNote, setResolveNote] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  // Per-item busy set so a double-tap on the "load & transport" quick action
  // (rendered once per card) can't fire the same write twice.
  const [busyIds, setBusyIds] = useState(() => new Set())
  const SAVE_ERROR = "Couldn't save that. Check your signal and try again."

  // Prep photo (required) and receive photo (optional), same upload-as-you-go
  // capture pattern as Containers' warehouse-receive photo. The prep photo
  // slot is reused for the return-leg "unwrap & place back" photo (also
  // required, docs/superpowers/specs/2026-08-26-return-phase-design.md §3),
  // since an item is only ever at one of the two stages (identified or
  // rt_transit) at a time, never both.
  const [pPreview, setPPreview] = useState(null)
  const [pUploading, setPUploading] = useState(false)
  const [pUrl, setPUrl] = useState(null)
  const [pError, setPError] = useState(null)

  const [rPreview, setRPreview] = useState(null)
  const [rUploading, setRUploading] = useState(false)
  const [rUrl, setRUrl] = useState(null)
  const [rError, setRError] = useState(null)

  // Return-leg "load & transport back to site" photo (optional), the mirror
  // of the outbound transportOverflow one-tap step.
  const [bPreview, setBPreview] = useState(null)
  const [bUploading, setBUploading] = useState(false)
  const [bUrl, setBUrl] = useState(null)
  const [bError, setBError] = useState(null)

  const isMover = currentUser?.role === 'admin' || currentUser?.role === 'mover'
  const isWarehouse = currentUser?.role === 'admin' || currentUser?.role === 'warehouse'
  const isAdmin = currentUser?.role === 'admin'

  const groups = useMemo(() => {
    const g = {}
    for (const o of state.overflow) (g[o.stage] = g[o.stage] || []).push(o)
    return g
  }, [state.overflow])

  const open = openId ? state.overflow.find((o) => o.id === openId) : null
  const modalAct = open ? overflowAction(currentUser, open, state.project?.returnPhase) : null

  const close = () => {
    setOpenId(null); setResolveNote(''); setLocation(''); setBusy(false)
    setPPreview(null); setPUploading(false); setPUrl(null); setPError(null)
    setRPreview(null); setRUploading(false); setRUrl(null); setRError(null)
    setBPreview(null); setBUploading(false); setBUrl(null); setBError(null)
    clearFocus && clearFocus()
  }

  const capturePrepPhoto = async (file) => {
    setPError(null); setPPreview(URL.createObjectURL(file)); setPUrl(null); setPUploading(true)
    try {
      const url = await uploadImage(file, `overflow/${open.id}/prep/${Date.now()}-${currentUser.uid}.jpg`)
      setPUrl(url)
    } catch (err) {
      setPError(err.message || 'Upload failed, try again.')
    } finally {
      setPUploading(false)
    }
  }

  const captureReceivePhoto = async (file) => {
    setRError(null); setRPreview(URL.createObjectURL(file)); setRUrl(null); setRUploading(true)
    try {
      const url = await uploadImage(file, `overflow/${open.id}/receive/${Date.now()}-${currentUser.uid}.jpg`)
      setRUrl(url)
    } catch (err) {
      setRError(err.message || 'Upload failed, try again.')
    } finally {
      setRUploading(false)
    }
  }

  const captureTransportBackPhoto = async (file) => {
    setBError(null); setBPreview(URL.createObjectURL(file)); setBUrl(null); setBUploading(true)
    try {
      const url = await uploadImage(file, `overflow/${open.id}/transport-back/${Date.now()}-${currentUser.uid}.jpg`)
      setBUrl(url)
    } catch (err) {
      setBError(err.message || 'Upload failed, try again.')
    } finally {
      setBUploading(false)
    }
  }

  // Returns a success boolean (instead of throwing) so a modal-context
  // caller can decide whether to close the modal: close on success, stay
  // open with the error toast already shown on failure.
  const transport = async (item) => {
    if (busyIds.has(item.id)) return false
    setBusyIds((s) => new Set(s).add(item.id))
    try {
      await dispatch({ type: 'transportOverflow', p: { overflowId: item.id } })
      toast(`Unit ${item.unitNumber} overflow item: loaded for transport ✓`)
      return true
    } catch (err) {
      toast(err.message || SAVE_ERROR)
      return false
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(item.id); return n })
    }
  }

  const submitPrep = async () => {
    if (pUploading) return alert('Still uploading the prep photo, wait a moment and try again.')
    if (!pUrl) return alert('A photo of the padded, wrapped & labeled item is required.')
    setBusy(true)
    try {
      const media = [{ id: `prep-${Date.now()}`, kind: 'photo', url: pUrl, label: 'Padded, wrapped & labeled' }]
      await dispatch({ type: 'prepOverflow', p: { overflowId: open.id, media } })
      toast(`Unit ${open.unitNumber} overflow item: prepped ✓`)
      close()
    } catch (err) {
      toast(err.message || SAVE_ERROR)
    } finally {
      setBusy(false)
    }
  }

  const submitReceive = async () => {
    if (!location.trim()) return alert('Assign a warehouse location (e.g. Bay C, shelf 3).')
    setBusy(true)
    try {
      const media = rUrl ? [{ id: `recv-${Date.now()}`, kind: 'photo', url: rUrl, label: 'Received condition' }] : []
      await dispatch({ type: 'receiveOverflow', p: { overflowId: open.id, warehouseLocation: location.trim(), media } })
      toast(`Unit ${open.unitNumber} overflow item: received at ${location.trim()} ✓`)
      close()
    } catch (err) {
      toast(err.message || SAVE_ERROR)
    } finally {
      setBusy(false)
    }
  }

  const submitTransportBack = async () => {
    setBusy(true)
    try {
      const media = bUrl ? [{ id: `back-${Date.now()}`, kind: 'photo', url: bUrl, label: 'Loaded for return transport' }] : []
      await dispatch({ type: 'transportOverflowBack', p: { overflowId: open.id, media } })
      toast(`Unit ${open.unitNumber} overflow item: loaded for return transport ✓`)
      close()
    } catch (err) {
      toast(err.message || SAVE_ERROR)
    } finally {
      setBusy(false)
    }
  }

  const submitReturnOverflow = async () => {
    if (pUploading) return alert('Still uploading the photo, wait a moment and try again.')
    if (!pUrl) return alert('A photo of the unwrapped item back in place is required.')
    setBusy(true)
    try {
      const media = [{ id: `return-${Date.now()}`, kind: 'photo', url: pUrl, label: 'Unwrapped & placed back' }]
      await dispatch({ type: 'returnOverflow', p: { overflowId: open.id, media } })
      toast(`Unit ${open.unitNumber} overflow item: back in place ✓`)
      close()
    } catch (err) {
      toast(err.message || SAVE_ERROR)
    } finally {
      setBusy(false)
    }
  }

  const totalCount = state.overflow.length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overflow</h1>
          <p>{totalCount} item{totalCount === 1 ? '' : 's'} too big for a BigBox container. Gorilla Movers transports these directly to the warehouse</p>
        </div>
        <ReportOverflowButton toast={toast} />
      </div>

      {totalCount === 0 && (
        <div className="card empty">
          <div className="big">🛋️</div>
          No overflow items yet. Report one from a unit, or the button above, when something's too big for a container.
        </div>
      )}

      {STAGE_ORDER.filter((s) => groups[s]?.length).map((stage) => (
        <div key={stage}>
          <div className="section-title">{OVERFLOW_STATUS[stage].label} · {groups[stage].length}</div>
          <div className="cont-grid" style={{ marginBottom: 18 }}>
            {groups[stage].map((item) => {
              const act = overflowAction(currentUser, item, state.project?.returnPhase)
              return (
                <div key={item.id} className="card cont-card" onClick={() => setOpenId(item.id)}>
                  <div className="row">
                    <span className="cont-num grow">Unit {item.unitNumber}{item.flag?.open && <span style={{ color: 'var(--red)', marginLeft: 7 }}>⚑</span>}</span>
                    <span className="badge" style={{ background: OVERFLOW_STATUS[stage].color + '22', color: OVERFLOW_STATUS[stage].color }}>
                      ● {OVERFLOW_STATUS[stage].label}
                    </span>
                  </div>
                  <div className="cont-units">
                    {item.unitTenant || '—'} · Floor {item.floor}<br />{item.description}
                    {stage === 'at_warehouse' && item.warehouseLocation ? <><br />📍 {item.warehouseLocation}</> : null}
                  </div>
                  {stage === 'identified' && isMover && (
                    <button
                      className="btn btn-primary btn-sm" style={{ marginTop: 10, width: '100%' }}
                      onClick={(e) => { e.stopPropagation(); setOpenId(item.id) }}
                    >Pad, wrap & label →</button>
                  )}
                  {act && act.key === 'transportOverflow' && (
                    <button
                      className="btn btn-primary btn-sm" style={{ marginTop: 10, width: '100%' }}
                      disabled={busyIds.has(item.id)}
                      onClick={(e) => { e.stopPropagation(); transport(item) }}
                    >{busyIds.has(item.id) ? 'Saving…' : act.label}</button>
                  )}
                  {act && (act.key === 'transportOverflowBack' || act.key === 'returnOverflow') && (
                    <button
                      className="btn btn-primary btn-sm" style={{ marginTop: 10, width: '100%' }}
                      onClick={(e) => { e.stopPropagation(); setOpenId(item.id) }}
                    >{act.label} →</button>
                  )}
                  {stage === 'in_transit' && isWarehouse && (
                    <button
                      className="btn btn-dark btn-sm" style={{ marginTop: 10, width: '100%' }}
                      onClick={(e) => { e.stopPropagation(); setOpenId(item.id) }}
                    >Receive →</button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {open && (
        <Modal
          title={`Overflow item · Unit ${open.unitNumber}`}
          sub={`${OVERFLOW_STATUS[open.stage]?.label || open.stage} · ${open.unitTenant || '—'} · Floor ${open.floor}`}
          onClose={() => { if (!busy) close() }}
        >
          <div className="field"><label>Description</label><div>{open.description}</div></div>

          {open.warehouseLocation && (
            <div className="field"><label>Warehouse location</label><div>📍 {open.warehouseLocation}</div></div>
          )}

          {open.media?.length > 0 && (
            <div className="field">
              <label>Photos</label>
              <AttributedMedia media={open.media} onOpen={setLightbox} />
            </div>
          )}

          {open.flag && (
            <div className={`flagbox ${open.flag.open ? '' : 'closed'}`}>
              <b>{open.flag.open ? '⚑ Open flag' : '✓ Resolved flag'}</b>: {open.flag.message}
              {open.flag.open && isAdmin && (
                <div style={{ marginTop: 10 }}>
                  <input className="input" placeholder="How was it resolved?" value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} />
                  <button className="btn btn-dark btn-sm" style={{ marginTop: 8 }} disabled={busy || !resolveNote.trim()} onClick={async () => {
                    setBusy(true)
                    try {
                      await dispatch({ type: 'resolveOverflowFlag', p: { overflowId: open.id, note: resolveNote.trim() } })
                      setResolveNote(''); toast('Flag resolved ✓')
                    } catch (err) {
                      toast(err.message || SAVE_ERROR)
                    } finally {
                      setBusy(false)
                    }
                  }}>{busy ? 'Saving…' : 'Resolve flag'}</button>
                </div>
              )}
              {open.flag.open && !isAdmin && <div className="muted" style={{ marginTop: 6 }}>Only the admin can resolve flags.</div>}
            </div>
          )}

          {open.stage === 'identified' && isMover && (
            <div style={{ marginTop: 16 }}>
              <div className="section-title" style={{ marginTop: 0 }}>Pad, wrap & label</div>
              <div className="field">
                <label>Photo, required (proof of prep + the label)</label>
                <label className="dropzone camera-capture" style={{ display: 'block' }}>
                  <input
                    type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files[0]; if (f) capturePrepPhoto(f); e.target.value = '' }}
                  />
                  {pPreview ? (
                    <div className="inv-preview">
                      <img src={pPreview} alt="Padded, wrapped & labeled" className="inv-thumb" />
                      <div className="muted" style={{ marginTop: 8 }}>
                        {pUploading ? 'Uploading…' : pUrl ? '✓ Uploaded, tap to retake' : pError || 'Tap to retake'}
                      </div>
                    </div>
                  ) : <>📷 Tap to photograph the padded, wrapped & labeled item</>}
                </label>
              </div>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy || pUploading} onClick={submitPrep}>
                {busy ? 'Logging…' : 'Confirm prepped'}
              </button>
            </div>
          )}

          {open.stage === 'prepped' && isMover && (
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busyIds.has(open.id)} onClick={async () => { if (await transport(open)) close() }}>
                {busyIds.has(open.id) ? 'Saving…' : 'Load & transport to warehouse'}
              </button>
            </div>
          )}

          {open.stage === 'in_transit' && isWarehouse && (
            <div style={{ marginTop: 16 }}>
              <div className="section-title" style={{ marginTop: 0 }}>Receive at warehouse</div>
              <div className="field"><label>Warehouse location</label>
                <input className="input" placeholder="e.g. Bay C, shelf 3" value={location} onChange={(e) => setLocation(e.target.value)} /></div>
              <div className="field">
                <label>Photo <span className="muted">(optional)</span></label>
                <label className="dropzone camera-capture" style={{ display: 'block' }}>
                  <input
                    type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files[0]; if (f) captureReceivePhoto(f); e.target.value = '' }}
                  />
                  {rPreview ? (
                    <div className="inv-preview">
                      <img src={rPreview} alt="Received condition" className="inv-thumb" />
                      <div className="muted" style={{ marginTop: 8 }}>
                        {rUploading ? 'Uploading…' : rUrl ? '✓ Uploaded, tap to retake' : rError || 'Tap to retake'}
                      </div>
                    </div>
                  ) : <>📷 Tap to add a photo</>}
                </label>
              </div>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy || rUploading} onClick={submitReceive}>
                {busy ? 'Logging…' : 'Confirm receipt'}
              </button>
            </div>
          )}

          {open.stage === 'at_warehouse' && modalAct?.key === 'transportOverflowBack' && (
            <div style={{ marginTop: 16 }}>
              <div className="section-title" style={{ marginTop: 0 }}>Load & transport back to site</div>
              <div className="field">
                <label>Photo <span className="muted">(optional)</span></label>
                <label className="dropzone camera-capture" style={{ display: 'block' }}>
                  <input
                    type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files[0]; if (f) captureTransportBackPhoto(f); e.target.value = '' }}
                  />
                  {bPreview ? (
                    <div className="inv-preview">
                      <img src={bPreview} alt="Loaded for return transport" className="inv-thumb" />
                      <div className="muted" style={{ marginTop: 8 }}>
                        {bUploading ? 'Uploading…' : bUrl ? '✓ Uploaded, tap to retake' : bError || 'Tap to retake'}
                      </div>
                    </div>
                  ) : <>📷 Tap to add a photo</>}
                </label>
              </div>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy || bUploading} onClick={submitTransportBack}>
                {busy ? 'Logging…' : 'Confirm loaded for return'}
              </button>
            </div>
          )}

          {open.stage === 'rt_transit' && modalAct?.key === 'returnOverflow' && (
            <div style={{ marginTop: 16 }}>
              <div className="section-title" style={{ marginTop: 0 }}>Unwrap & place back</div>
              <div className="field">
                <label>Photo, required (proof it is back in place)</label>
                <label className="dropzone camera-capture" style={{ display: 'block' }}>
                  <input
                    type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                    onChange={(e) => { const f = e.target.files[0]; if (f) capturePrepPhoto(f); e.target.value = '' }}
                  />
                  {pPreview ? (
                    <div className="inv-preview">
                      <img src={pPreview} alt="Unwrapped and placed back" className="inv-thumb" />
                      <div className="muted" style={{ marginTop: 8 }}>
                        {pUploading ? 'Uploading…' : pUrl ? '✓ Uploaded, tap to retake' : pError || 'Tap to retake'}
                      </div>
                    </div>
                  ) : <>📷 Tap to photograph the item unwrapped and back in place</>}
                </label>
              </div>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy || pUploading} onClick={submitReturnOverflow}>
                {busy ? 'Logging…' : 'Confirm placed back'}
              </button>
            </div>
          )}

          <div className="section-title">Custody log</div>
          <div className="timeline">
            {state.events.filter((e) => e.overflowId === open.id).sort((a, b) => b.ts - a.ts).map((e) => (
              <EventRow key={e.id} e={e} onOpenMedia={setLightbox} linkUnit={openUnit} showTarget={!!openUnit} />
            ))}
            {state.events.filter((e) => e.overflowId === open.id).length === 0 && (
              <div className="muted" style={{ padding: '10px 0' }}>No activity logged against this item yet.</div>
            )}
          </div>
        </Modal>
      )}
      <Lightbox media={lightbox} onClose={() => setLightbox(null)} />
    </>
  )
}
