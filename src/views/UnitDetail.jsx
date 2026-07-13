import React, { useMemo, useState } from 'react'
import { STAGES, stageOf } from '../seed.js'
import { useStore, canAct, filesToMedia, fmtTime } from '../store.jsx'
import { Modal, Lightbox, Uploader, EventRow, Avatar, StagePill } from '../ui.jsx'

const WAIT_HINTS = {
  staged: 'Waiting on driver: container pickup from site.',
  in_transit: 'On the truck — driver will check it into the warehouse.',
  warehouse: 'Safely stored. Driver dispatches it back when the return phase starts.',
  return_transit: 'On the truck heading back to the site.',
  complete: 'All done. Full history preserved below.',
}

export default function UnitDetail({ unitId, goBack, openContainer, toast }) {
  const { state, dispatch, currentUser } = useStore()
  const unit = state.units.find((u) => u.id === unitId)
  const [modal, setModal] = useState(null) // 'action' | 'media' | 'note' | 'resolve'
  const [lightbox, setLightbox] = useState(null)
  const [form, setForm] = useState({})
  const [pending, setPending] = useState([])

  const events = useMemo(() => state.events.filter((e) => e.unitId === unitId).sort((a, b) => b.ts - a.ts), [state.events, unitId])
  if (!unit) return null

  const action = canAct(currentUser, unit)
  const canContribute = currentUser && currentUser.role !== 'viewer'
  const stage = stageOf(unit.stage)
  const conts = unit.containerIds.map((id) => state.containers.find((c) => c.id === id)).filter(Boolean)
  const crewName = (uid) => state.users.find((u) => u.id === uid)?.name

  const openAction = () => { setForm({}); setPending([]); setModal('action') }

  const submitAction = () => {
    const byId = currentUser.id
    const media = pending
    const needsPhoto = ['finishPacking', 'loadUnit', 'finishUnload', 'signOff'].includes(action.key)
    if (needsPhoto && !media.some((m) => m.kind === 'photo')) {
      return alert('At least one photo is required to complete this step — the photo record is the whole point.')
    }
    if (action.key === 'startPacking') dispatch({ type: 'startPacking', p: { unitId, byId } })
    if (action.key === 'finishPacking') {
      const n = parseInt(form.boxCount)
      if (!n || n < 1) return alert('Enter the number of boxes packed.')
      dispatch({ type: 'finishPacking', p: { unitId, byId, boxCount: n, media } })
    }
    if (action.key === 'loadUnit') {
      const cn = (form.containerNumber || '').trim()
      const n = parseInt(form.boxCount)
      if (!cn) return alert('Enter the container number.')
      if (!n || n < 1) return alert('Enter the box count you verified while loading.')
      dispatch({ type: 'loadUnit', p: { unitId, byId, containerNumber: cn, boxCount: n, media } })
      if (unit.boxCount != null && n !== unit.boxCount) toast(`⚑ Box count mismatch flagged (${n} vs ${unit.boxCount})`)
    }
    if (action.key === 'finishUnload') dispatch({ type: 'finishUnload', p: { unitId, byId, boxCount: parseInt(form.boxCount) || unit.boxCount, media } })
    if (action.key === 'signOff') dispatch({ type: 'signOff', p: { unitId, byId, media } })
    setModal(null)
    if (action.key !== 'loadUnit' || unit.boxCount == null || parseInt(form.boxCount) === unit.boxCount) toast('Logged — timestamped under your name ✓')
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
          <p>{unit.tenant} · Floor {unit.floor}{unit.boxCount ? ` · ${unit.boxCount} boxes` : ''}</p>
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
              <dt>Tenant</dt><dd>{unit.tenant}</dd>
              <dt>Phone</dt><dd>{unit.phone}</dd>
              <dt>Floor</dt><dd>{unit.floor}</dd>
              <dt>Boxes packed</dt><dd>{unit.boxCount ?? '—'}</dd>
              <dt>Container</dt>
              <dd>
                {conts.length === 0 && '—'}
                {conts.map((c) => (
                  <span key={c.id} className="linkish" onClick={() => openContainer(c.id)} style={{ marginRight: 10 }}>{c.number}{c.bay ? ` (${c.bay})` : ''}</span>
                ))}
              </dd>
              <dt>Packer</dt><dd>{crewName(unit.crew.packer) || '—'}</dd>
              <dt>Mover</dt><dd>{crewName(unit.crew.mover) || '—'}</dd>
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
                if (media.length) { dispatch({ type: 'addMedia', p: { unitId, byId: currentUser.id, media } }); toast(`${media.length} file${media.length > 1 ? 's' : ''} added to unit ${unit.number} ✓`) }
              }} />
              <button className="btn btn-ghost" style={{ width: '100%', marginTop: 10 }} onClick={() => { setForm({}); setModal('note') }}>📝 Add a note</button>
            </div>
          )}
        </div>
      </div>

      {modal === 'action' && action && (
        <Modal title={action.label} sub={`Unit ${unit.number} · ${unit.tenant} — logged as ${currentUser.name}, ${fmtTime(Date.now())}`} onClose={() => setModal(null)}>
          {action.key === 'finishPacking' && (
            <div className="field"><label>Boxes packed, sealed & labeled</label>
              <input className="input" type="number" min="1" autoFocus placeholder="e.g. 18" value={form.boxCount || ''} onChange={(e) => setForm({ ...form, boxCount: e.target.value })} /></div>
          )}
          {action.key === 'loadUnit' && (
            <>
              <div className="field"><label>Container number</label>
                <input className="input" autoFocus placeholder="e.g. C-21" value={form.containerNumber || ''} onChange={(e) => setForm({ ...form, containerNumber: e.target.value })} /></div>
              <div className="field"><label>Boxes counted while loading {unit.boxCount != null && <span className="muted">(packer recorded {unit.boxCount})</span>}</label>
                <input className="input" type="number" min="1" placeholder={unit.boxCount ?? 'count'} value={form.boxCount || ''} onChange={(e) => setForm({ ...form, boxCount: e.target.value })} /></div>
            </>
          )}
          {action.key === 'finishUnload' && (
            <div className="field"><label>Boxes returned to unit {unit.boxCount != null && <span className="muted">(expected {unit.boxCount})</span>}</label>
              <input className="input" type="number" min="1" autoFocus placeholder={unit.boxCount ?? 'count'} value={form.boxCount || ''} onChange={(e) => setForm({ ...form, boxCount: e.target.value })} /></div>
          )}
          {action.key !== 'startPacking' && (
            <div className="field">
              <label>Photos required — video encouraged</label>
              <Uploader onFiles={async (files) => setPending([...pending, ...(await filesToMedia(files))])} />
              {pending.length > 0 && <div className="muted" style={{ marginTop: 6 }}>{pending.length} file{pending.length > 1 ? 's' : ''} attached</div>}
            </div>
          )}
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={submitAction}>Confirm — {action.label}</button>
        </Modal>
      )}

      {modal === 'note' && (
        <Modal title="Add a note" sub={`Unit ${unit.number} — logged as ${currentUser.name} with date & time`} onClose={() => setModal(null)}>
          <div className="field">
            <textarea className="input" rows="4" autoFocus placeholder="e.g. Tenant asked us to keep the bikes accessible…" value={form.text || ''} onChange={(e) => setForm({ ...form, text: e.target.value })} />
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={!form.text?.trim()} onClick={() => {
            dispatch({ type: 'addNote', p: { unitId, byId: currentUser.id, text: form.text.trim() } })
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
            dispatch({ type: 'editUnit', p: { unitId, byId: currentUser.id, patch: { tenant: form.tenant.trim(), phone: form.phone.trim(), note: (form.note || '').trim() } } })
            setModal(null); toast('Unit updated — edit logged ✓')
          }}>Save changes</button>
        </Modal>
      )}

      {modal === 'resolve' && (
        <Modal title="Resolve flag" sub={unit.flag?.message} onClose={() => setModal(null)}>
          <div className="field"><label>How was it resolved?</label>
            <textarea className="input" rows="3" autoFocus value={form.text || ''} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="e.g. Recounted at warehouse — all 18 boxes present." /></div>
          <button className="btn btn-primary" style={{ width: '100%' }} disabled={!form.text?.trim()} onClick={() => {
            dispatch({ type: 'resolveFlag', p: { unitId, byId: currentUser.id, note: form.text.trim() } })
            setModal(null); toast('Flag resolved ✓')
          }}>Mark resolved</button>
        </Modal>
      )}

      <Lightbox media={lightbox} onClose={() => setLightbox(null)} />
    </>
  )
}
