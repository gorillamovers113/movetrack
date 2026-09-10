import React, { useState } from 'react'
import { useStore, fmtTime } from '../store.jsx'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'
import { surnameOf } from '../lib/mutations.js'

/* Putting a photo back on the apartment it was taken in.
 *
 * Liv had 906 and 902 open at once on 8 Sep and their packed photos ended up
 * swapped. She could not say how, which is exactly the point: the app asked
 * which unit while she was standing in a different one. One apartment at a
 * time makes that impossible from now on, but the units already packed still
 * need putting right, and there was no way to do it without a database write.
 *
 * Admin only, and collapsed by default. This is a repair tool, not part of
 * anybody's day: opening a unit should show the record, not invite editing it.
 */
export default function MediaFilingCard({ unit }) {
  const { state, currentUser, dispatch } = useStore()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(null)
  const [targets, setTargets] = useState({})
  const [msg, setMsg] = useState(null)

  if (!currentUser || currentUser.role !== 'admin') return null
  const media = (unit.media || []).filter(Boolean)
  if (media.length === 0) return null

  const others = state.units
    .filter((u) => u.id !== unit.id)
    .slice()
    .sort((a, b) => String(a.number).localeCompare(String(b.number), undefined, { numeric: true }))

  const move = async (item) => {
    const toUnitId = targets[item.id]
    if (!toUnitId) { setMsg('Pick the unit it belongs to.'); return }
    setBusy(item.id)
    setMsg(null)
    try {
      const status = await submitWrite(dispatch({
        type: 'adminMoveMedia', p: { mediaId: item.id, fromUnitId: unit.id, toUnitId },
      }))
      const to = others.find((u) => u.id === toUnitId)
      setMsg(status === 'queued' ? QUEUED_MESSAGE : `Moved to unit ${to ? to.number : ''} ✓`)
    } catch (err) {
      setMsg(err.message || "Couldn't move that.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: 0,
          background: 'none', border: 'none', fontFamily: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span className="section-title grow" style={{ margin: 0 }}>Filed on the wrong unit?</span>
        <span className="muted" style={{ fontWeight: 700 }}>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <>
          <div className="muted" style={{ fontSize: 12.5, margin: '6px 0 10px' }}>
            Moves a photo to the apartment it was actually taken in. Who took it and when do not change, and the
            move is logged on both units.
          </div>
          {media.map((m) => (
            <div
              key={m.id}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}
            >
              {m.kind === 'video'
                ? <span aria-hidden style={{ flex: 'none', width: 44, height: 44, borderRadius: 8, background: '#111827', color: '#fff', display: 'grid', placeItems: 'center' }}>▶</span>
                : <img src={m.url} alt={m.label || 'photo'} style={{ flex: 'none', width: 44, height: 44, objectFit: 'cover', borderRadius: 8 }} />}
              <span style={{ minWidth: 140, flex: 1, fontSize: 13 }}>
                <b>{m.label || m.phase || 'photo'}</b>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3, #9aa1ab)' }}>
                  {m.userName || 'Crew'}{m.ts ? ` · ${fmtTime(m.ts)}` : ''}
                </span>
              </span>
              <select
                className="input"
                style={{ width: 'auto', padding: '5px 9px', fontSize: 13 }}
                value={targets[m.id] || ''}
                onChange={(e) => setTargets({ ...targets, [m.id]: e.target.value })}
              >
                <option value="">Move to…</option>
                {others.map((u) => (
                  <option key={u.id} value={u.id}>{u.number} · {surnameOf(u.tenant)}</option>
                ))}
              </select>
              <button
                type="button" className="btn btn-ghost btn-sm"
                disabled={busy === m.id || !targets[m.id]}
                onClick={() => move(m)}
              >
                {busy === m.id ? 'Moving…' : 'Move'}
              </button>
            </div>
          ))}
          {msg && <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>{msg}</div>}
        </>
      )}
    </div>
  )
}
