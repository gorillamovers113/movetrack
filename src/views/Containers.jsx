import React, { useMemo, useState } from 'react'
import { useStore, CONT_STATUS } from '../store.jsx'
import { Modal, Lightbox, EventRow, StagePill } from '../ui.jsx'
import { uploadImage } from '../lib/upload.js'
import EmptiesInButton from '../components/EmptiesInButton.jsx'
import BigBoxSwapButton from '../components/BigBoxSwapButton.jsx'

// Lifecycle order the pool view groups by — matches CONT_STATUS in store.jsx:
// empty (on site) → filling → full/ready → picked_up (in transit) → at_warehouse.
const STATUS_ORDER = ['empty', 'filling', 'full', 'picked_up', 'at_warehouse']

export default function Containers({ openUnit, focusId, clearFocus, toast }) {
  const { state, dispatch, currentUser } = useStore()
  const [openId, setOpenId] = useState(focusId || null)
  const [lightbox, setLightbox] = useState(null)
  const [resolveNote, setResolveNote] = useState('')
  const [bay, setBay] = useState('')
  const [verify, setVerify] = useState('')
  const [busy, setBusy] = useState(false)

  // Warehouse-receive photo capture (optional) — same upload-as-you-go
  // pattern as the packing inventory photo in UnitDetail.
  const [rPreview, setRPreview] = useState(null)
  const [rUploading, setRUploading] = useState(false)
  const [rUrl, setRUrl] = useState(null)
  const [rError, setRError] = useState(null)

  const isMover = currentUser?.role === 'admin' || currentUser?.role === 'mover'
  const isWarehouse = currentUser?.role === 'admin' || currentUser?.role === 'warehouse'

  const groups = useMemo(() => {
    const g = {}
    for (const c of state.containers) (g[c.status] = g[c.status] || []).push(c)
    return g
  }, [state.containers])

  const open = openId ? state.containers.find((c) => c.id === openId) : null

  const close = () => {
    setOpenId(null); setResolveNote(''); setBay(''); setVerify('')
    setRPreview(null); setRUploading(false); setRUrl(null); setRError(null)
    clearFocus && clearFocus()
  }

  const captureReceivePhoto = async (file) => {
    setRError(null); setRPreview(URL.createObjectURL(file)); setRUrl(null); setRUploading(true)
    try {
      const url = await uploadImage(file, `containers/${open.id}/receive/${Date.now()}-${currentUser.uid}.jpg`)
      setRUrl(url)
    } catch (err) {
      setRError(err.message || 'Upload failed — try again.')
    } finally {
      setRUploading(false)
    }
  }

  const markFull = (c) => {
    dispatch({ type: 'markContainerFull', p: { containerId: c.id } })
    toast(`${c.number}: marked full — ready for pickup ✓`)
  }

  const submitReceive = async () => {
    const n = parseInt(verify)
    if (!bay.trim()) return alert('Assign a warehouse bay.')
    if (verify === '' || isNaN(n) || n < 0) return alert('Enter the pieces counted at receiving.')
    setBusy(true)
    try {
      const media = rUrl ? [{ id: `recv-${Date.now()}`, kind: 'photo', url: rUrl, label: `Container ${open.number} received` }] : []
      await dispatch({ type: 'warehouseReceive', p: { containerId: open.id, verifiedPieces: n, bay: bay.trim(), media } })
      const expected = open.unitIds.reduce((sum, id) => sum + (state.units.find((u) => u.id === id)?.pieces || 0), 0)
      toast(expected && n !== expected ? `⚑ Mismatch flagged (${n} vs ${expected})` : `${open.number}: received at ${bay.trim()} ✓`)
      close()
    } finally {
      setBusy(false)
    }
  }

  const totalCount = state.containers.length

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Containers</h1>
          <p>{totalCount} on the board — chain of custody for every BigBox container</p>
        </div>
        {isMover && (
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <EmptiesInButton toast={toast} />
            <BigBoxSwapButton toast={toast} />
          </div>
        )}
      </div>

      {totalCount === 0 && (
        <div className="card empty">
          <div className="big">📦</div>
          No containers on site yet.{isMover ? ' Log the empties BigBox dropped off to get started.' : ''}
        </div>
      )}

      {STATUS_ORDER.filter((s) => groups[s]?.length).map((status) => (
        <div key={status}>
          <div className="section-title">{CONT_STATUS[status].label} · {groups[status].length}</div>
          <div className="cont-grid" style={{ marginBottom: 18 }}>
            {groups[status].map((c) => {
              const units = c.unitIds.map((id) => state.units.find((u) => u.id === id)).filter(Boolean)
              return (
                <div key={c.id} className="card cont-card" onClick={() => setOpenId(c.id)}>
                  <div className="row">
                    <span className="cont-num grow">{c.number}{c.flag?.open && <span style={{ color: 'var(--red)', marginLeft: 7 }}>⚑</span>}</span>
                    <span className="badge" style={{ background: CONT_STATUS[status].color + '22', color: CONT_STATUS[status].color }}>
                      ● {units.length} unit{units.length === 1 ? '' : 's'}{c.bay ? ` · ${c.bay}` : ''}
                    </span>
                  </div>
                  <div className="cont-units">
                    {units.length > 0
                      ? units.map((u) => `Unit ${u.number} — ${u.tenant || '—'}`).join(' · ')
                      : (status === 'empty' ? 'Empty — nothing loaded yet' : '—')}
                  </div>
                  {status === 'filling' && isMover && (
                    <button
                      className="btn btn-primary btn-sm" style={{ marginTop: 10, width: '100%' }}
                      onClick={(e) => { e.stopPropagation(); markFull(c) }}
                    >Full — ready for pickup</button>
                  )}
                  {status === 'picked_up' && isWarehouse && (
                    <button
                      className="btn btn-dark btn-sm" style={{ marginTop: 10, width: '100%' }}
                      onClick={(e) => { e.stopPropagation(); setOpenId(c.id) }}
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
          title={`Container ${open.number}`}
          sub={`${CONT_STATUS[open.status]?.label || open.status}${open.bay ? ' · ' + open.bay : ''}${open.driverName ? ' · driver: ' + open.driverName : ''}`}
          onClose={close}
        >
          <div className="section-title" style={{ marginTop: 0 }}>Units inside</div>
          {open.unitIds.length === 0 && <div className="muted" style={{ padding: '6px 0' }}>No units loaded yet.</div>}
          {open.unitIds.map((id) => {
            const u = state.units.find((x) => x.id === id)
            if (!u) return null
            return (
              <div className="row" key={id} style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <span className="linkish" onClick={() => { close(); openUnit(id) }}>Unit {u.number}</span>
                <span className="muted grow">{u.tenant || '—'} · {u.pieces ?? '?'} pieces</span>
                <StagePill stage={u.stage} short />
              </div>
            )
          })}

          {open.flag && (
            <div className={`flagbox ${open.flag.open ? '' : 'closed'}`}>
              <b>{open.flag.open ? '⚑ Open flag' : '✓ Resolved flag'}</b> — {open.flag.message}
              {open.flag.open && currentUser?.role === 'admin' && (
                <div style={{ marginTop: 10 }}>
                  <input className="input" placeholder="How was it resolved?" value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} />
                  <button className="btn btn-dark btn-sm" style={{ marginTop: 8 }} disabled={!resolveNote.trim()} onClick={() => {
                    dispatch({ type: 'resolveContainerFlag', p: { containerId: open.id, note: resolveNote.trim() } })
                    setResolveNote(''); toast('Flag resolved ✓')
                  }}>Resolve flag</button>
                </div>
              )}
              {open.flag.open && currentUser?.role !== 'admin' && <div className="muted" style={{ marginTop: 6 }}>Only the admin can resolve flags.</div>}
            </div>
          )}

          {open.status === 'filling' && isMover && (
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={() => { markFull(open); close() }}>Full — ready for pickup</button>
            </div>
          )}

          {open.status === 'picked_up' && isWarehouse && (
            <div style={{ marginTop: 16 }}>
              <div className="section-title" style={{ marginTop: 0 }}>Receive at warehouse</div>
              <div className="field">
                <label>Pieces counted{(() => {
                  const expected = open.unitIds.reduce((sum, id) => sum + (state.units.find((u) => u.id === id)?.pieces || 0), 0)
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
                    onChange={(e) => { const f = e.target.files[0]; if (f) captureReceivePhoto(f); e.target.value = '' }}
                  />
                  {rPreview ? (
                    <div className="inv-preview">
                      <img src={rPreview} alt="Received container" className="inv-thumb" />
                      <div className="muted" style={{ marginTop: 8 }}>
                        {rUploading ? 'Uploading…' : rUrl ? '✓ Uploaded — tap to retake' : rError || 'Tap to retake'}
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
            {state.events.filter((e) => e.containerId === open.id).sort((a, b) => b.ts - a.ts).map((e) => (
              <EventRow key={e.id} e={e} onOpenMedia={setLightbox} showTarget={false} />
            ))}
            {state.events.filter((e) => e.containerId === open.id).length === 0 && (
              <div className="muted" style={{ padding: '10px 0' }}>No activity logged against this container yet.</div>
            )}
          </div>
        </Modal>
      )}
      <Lightbox media={lightbox} onClose={() => setLightbox(null)} />
    </>
  )
}
