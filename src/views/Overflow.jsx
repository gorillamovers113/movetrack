import React, { useMemo, useState } from 'react'
import { useStore, OVERFLOW_STATUS, overflowAction, fmtTime } from '../store.jsx'
import { Modal, Lightbox, EventRow } from '../ui.jsx'
import { uploadImage } from '../lib/upload.js'
import ReportOverflowButton from '../components/ReportOverflowButton.jsx'

// Lifecycle order the pool view groups by, matches OVERFLOW_STATUS in
// store.jsx: identified (needs prep) → prepped (ready to transport) →
// in_transit → at_warehouse.
const STAGE_ORDER = ['identified', 'prepped', 'in_transit', 'at_warehouse']

// Photo thumbnails with a submitter-name + date/time caption underneath.
// Overflow photos need visible attribution per the spec (each item is
// padded/wrapped/labeled by a specific crew member and that has to show).
function AttributedMedia({ media, onOpen }) {
  if (!media || !media.length) return null
  return (
    <div className="media-row" style={{ flexWrap: 'wrap' }}>
      {media.map((m) => (
        <div key={m.id} style={{ textAlign: 'center', width: 92 }}>
          {m.kind === 'video'
            ? <div className="media-video" onClick={() => onOpen(m)} title={m.label}>▶</div>
            : <img className="media-thumb" src={m.url} alt={m.label} onClick={() => onOpen(m)} />}
          <div className="muted" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.3 }}>
            {m.userName || 'Unknown'}<br />{m.ts ? fmtTime(m.ts) : '—'}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function Overflow({ openUnit, focusId, clearFocus, toast }) {
  const { state, dispatch, currentUser } = useStore()
  const [openId, setOpenId] = useState(focusId || null)
  const [lightbox, setLightbox] = useState(null)
  const [resolveNote, setResolveNote] = useState('')
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)

  // Prep photo (required) and receive photo (optional), same upload-as-you-go
  // capture pattern as Containers' warehouse-receive photo.
  const [pPreview, setPPreview] = useState(null)
  const [pUploading, setPUploading] = useState(false)
  const [pUrl, setPUrl] = useState(null)
  const [pError, setPError] = useState(null)

  const [rPreview, setRPreview] = useState(null)
  const [rUploading, setRUploading] = useState(false)
  const [rUrl, setRUrl] = useState(null)
  const [rError, setRError] = useState(null)

  const isMover = currentUser?.role === 'admin' || currentUser?.role === 'mover'
  const isWarehouse = currentUser?.role === 'admin' || currentUser?.role === 'warehouse'
  const isAdmin = currentUser?.role === 'admin'

  const groups = useMemo(() => {
    const g = {}
    for (const o of state.overflow) (g[o.stage] = g[o.stage] || []).push(o)
    return g
  }, [state.overflow])

  const open = openId ? state.overflow.find((o) => o.id === openId) : null

  const close = () => {
    setOpenId(null); setResolveNote(''); setLocation(''); setBusy(false)
    setPPreview(null); setPUploading(false); setPUrl(null); setPError(null)
    setRPreview(null); setRUploading(false); setRUrl(null); setRError(null)
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

  const transport = (item) => {
    dispatch({ type: 'transportOverflow', p: { overflowId: item.id } })
    toast(`Unit ${item.unitNumber} overflow item: loaded for transport ✓`)
  }

  const submitPrep = async () => {
    if (pUploading) return alert('Still uploading the prep photo, wait a moment and try again.')
    if (!pUrl) return alert('A photo of the padded, wrapped & labeled item is required.')
    setBusy(true)
    try {
      const media = [{ id: `prep-${Date.now()}`, kind: 'photo', url: pUrl, label: 'Padded, wrapped & labeled', uid: currentUser.uid, userName: currentUser.name, ts: Date.now() }]
      await dispatch({ type: 'prepOverflow', p: { overflowId: open.id, media } })
      toast(`Unit ${open.unitNumber} overflow item: prepped ✓`)
      close()
    } finally {
      setBusy(false)
    }
  }

  const submitReceive = async () => {
    if (!location.trim()) return alert('Assign a warehouse location (e.g. Bay C, shelf 3).')
    setBusy(true)
    try {
      const media = rUrl ? [{ id: `recv-${Date.now()}`, kind: 'photo', url: rUrl, label: 'Received condition', uid: currentUser.uid, userName: currentUser.name, ts: Date.now() }] : []
      await dispatch({ type: 'receiveOverflow', p: { overflowId: open.id, warehouseLocation: location.trim(), media } })
      toast(`Unit ${open.unitNumber} overflow item: received at ${location.trim()} ✓`)
      close()
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
              const act = overflowAction(currentUser, item)
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
                  {act && (
                    <button
                      className="btn btn-primary btn-sm" style={{ marginTop: 10, width: '100%' }}
                      onClick={(e) => { e.stopPropagation(); transport(item) }}
                    >{act.label}</button>
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
          onClose={close}
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
                  <button className="btn btn-dark btn-sm" style={{ marginTop: 8 }} disabled={!resolveNote.trim()} onClick={() => {
                    dispatch({ type: 'resolveOverflowFlag', p: { overflowId: open.id, note: resolveNote.trim() } })
                    setResolveNote(''); toast('Flag resolved ✓')
                  }}>Resolve flag</button>
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
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={() => { transport(open); close() }}>Load & transport to warehouse</button>
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
