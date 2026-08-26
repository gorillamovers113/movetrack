import React, { useMemo, useState } from 'react'
import { useStore, containerAction, CONT_LOC, filesToMedia } from '../store.jsx'
import { Modal, Lightbox, Uploader, EventRow, StagePill } from '../ui.jsx'

export default function Containers({ openUnit, focusId, clearFocus, toast }) {
  const { state, dispatch, currentUser } = useStore()
  const [locFilter, setLocFilter] = useState(null)
  const [openId, setOpenId] = useState(focusId || null)
  const [lightbox, setLightbox] = useState(null)
  const [bay, setBay] = useState('')
  const [pending, setPending] = useState([])
  const [verify, setVerify] = useState('')
  const [resolveNote, setResolveNote] = useState('')

  const used = state.containers.filter((c) => c.unitIds.length > 0)
  const groups = useMemo(() => {
    const g = {}
    for (const c of used) (g[c.location] = g[c.location] || []).push(c)
    return g
  }, [state.containers])

  const open = openId ? state.containers.find((c) => c.id === openId) : null
  const close = () => { setOpenId(null); setPending([]); setBay(''); setVerify(''); setResolveNote(''); clearFocus && clearFocus() }

  const locOrder = ['site', 'transit', 'warehouse']

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Containers</h1>
          <p>{used.length} in use — chain of custody for every container</p>
        </div>
      </div>

      <div className="filters">
        <button className={`chip ${!locFilter ? 'on' : ''}`} onClick={() => setLocFilter(null)}>All locations</button>
        {locOrder.filter((l) => groups[l]?.length).map((l) => (
          <button key={l} className={`chip ${locFilter === l ? 'on' : ''}`} onClick={() => setLocFilter(locFilter === l ? null : l)}>
            <i style={{ background: CONT_LOC[l].color }} />{CONT_LOC[l].label} · {groups[l].length}
          </button>
        ))}
      </div>

      <div className="cont-grid">
        {used.filter((c) => !locFilter || c.location === locFilter).map((c) => {
          const units = c.unitIds.map((id) => state.units.find((u) => u.id === id)).filter(Boolean)
          return (
            <div key={c.id} className="card cont-card" onClick={() => setOpenId(c.id)}>
              <div className="row">
                <span className="cont-num grow">{c.number}{c.flag?.open && <span style={{ color: 'var(--red)', marginLeft: 7 }}>⚑</span>}</span>
                <span className="badge" style={{ background: CONT_LOC[c.location].color + '22', color: CONT_LOC[c.location].color }}>
                  ● {CONT_LOC[c.location].label}{c.bay ? ` · ${c.bay}` : ''}
                </span>
              </div>
              <div className="cont-units">
                {units.map((u) => `Unit ${u.number}`).join(' · ')}
                <span className="muted"> — {units.reduce((n, u) => n + (u.boxCount || 0), 0)} boxes</span>
              </div>
            </div>
          )
        })}
        {used.length === 0 && <div className="empty card" style={{ gridColumn: '1/-1' }}><div className="big">📦</div>No containers in use yet.</div>}
      </div>

      {open && (
        <Modal title={`Container ${open.number}`} sub={`${CONT_LOC[open.location].label}${open.bay ? ' · ' + open.bay : ''}`} onClose={close}>
          <div className="section-title" style={{ marginTop: 0 }}>Units inside</div>
          {open.unitIds.map((id) => {
            const u = state.units.find((x) => x.id === id)
            return (
              <div className="row" key={id} style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <span className="linkish" onClick={() => { close(); openUnit(id) }}>Unit {u.number}</span>
                <span className="muted grow">{u.tenant || '—'} · {u.boxCount ?? '?'} boxes</span>
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

          {(() => {
            const act = containerAction(currentUser, open)
            if (!act) return null
            const expected = open.unitIds.reduce((n, id) => n + (state.units.find((u) => u.id === id)?.boxCount || 0), 0)
            const needsCount = ['pickup', 'checkin'].includes(act.move) && expected > 0
            return (
              <div style={{ marginTop: 16 }}>
                {act.move === 'checkin' && (
                  <div className="field"><label>Warehouse bay</label>
                    <input className="input" placeholder="e.g. Bay 4" value={bay} onChange={(e) => setBay(e.target.value)} /></div>
                )}
                {needsCount && (
                  <div className="field"><label>Boxes counted on board <span className="muted">({expected} on record)</span></label>
                    <input className="input" type="number" min="0" placeholder={expected} value={verify} onChange={(e) => setVerify(e.target.value)} /></div>
                )}
                <div className="field">
                  <label>Photo at handoff — required</label>
                  <Uploader onFiles={async (f) => setPending([...pending, ...(await filesToMedia(f, `Container ${open.number}`))])} label="Add handoff photo" />
                  {pending.length > 0 && <div className="muted" style={{ marginTop: 6 }}>{pending.length} attached</div>}
                </div>
                <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={() => {
                  if (!pending.some((m) => m.kind === 'photo')) return alert('A handoff photo is required — it closes the chain of custody.')
                  if (needsCount && (verify === '' || parseInt(verify) < 0)) return alert('Count the boxes on board and enter the number.')
                  const v = needsCount ? parseInt(verify) : null
                  dispatch({ type: 'containerMove', p: { containerId: open.id, move: act.move, bay: bay.trim() || undefined, media: pending, verifiedBoxes: v } })
                  toast(v != null && v !== expected ? `⚑ Mismatch flagged (${v} vs ${expected})` : `${open.number}: ${act.label} — logged ✓`)
                  close()
                }}>{act.label}</button>
              </div>
            )
          })()}

          <div className="section-title">Custody log</div>
          <div className="timeline">
            {state.events.filter((e) => e.containerId === open.id).sort((a, b) => b.ts - a.ts).map((e) => (
              <EventRow key={e.id} e={e} onOpenMedia={setLightbox} showTarget={false} />
            ))}
          </div>
        </Modal>
      )}
      <Lightbox media={lightbox} onClose={() => setLightbox(null)} />
    </>
  )
}
