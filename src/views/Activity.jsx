import React, { useMemo, useState } from 'react'
import { useStore, exportActivityCSV } from '../store.jsx'
import { EventRow, Lightbox } from '../ui.jsx'

const TYPES = { stage: 'Stage changes', media: 'Photos & video', note: 'Notes', flag: 'Flags', system: 'Admin & system' }

export default function Activity({ openUnit, openContainer }) {
  const { state } = useStore()
  const [who, setWho] = useState('')
  const [type, setType] = useState('')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(60)
  const [lightbox, setLightbox] = useState(null)

  const filtered = useMemo(() => {
    const s = q.toLowerCase()
    return [...state.events]
      .sort((a, b) => b.ts - a.ts)
      .filter((e) => (!who || e.userId === who) && (!type || e.type === type) && (!s || e.action.toLowerCase().includes(s) || e.userName.toLowerCase().includes(s)))
  }, [state.events, who, type, q])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Activity log</h1>
          <p>{state.events.length.toLocaleString()} actions on record — every one stamped with name, date & time</p>
        </div>
        <button className="btn btn-dark" onClick={() => exportActivityCSV(filtered, state.units, state.containers)}>⬇ Export CSV</button>
      </div>

      <div className="filters">
        <input className="search" placeholder="Search actions…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: 'auto' }} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Everyone</option>
          {state.users.filter((u) => u.status === 'active').map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="input" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {Object.entries(TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <span className="muted">{filtered.length.toLocaleString()} shown</span>
      </div>

      <div className="card" style={{ padding: '4px 20px' }}>
        <div className="timeline">
          {filtered.slice(0, limit).map((e) => (
            <EventRow key={e.id} e={e} onOpenMedia={setLightbox} linkUnit={openUnit} linkContainer={openContainer} />
          ))}
          {filtered.length === 0 && <div className="empty"><div className="big">🔎</div>Nothing matches those filters.</div>}
        </div>
        {filtered.length > limit && (
          <div style={{ padding: '14px 0 18px', textAlign: 'center' }}>
            <button className="btn btn-ghost" onClick={() => setLimit(limit + 100)}>Show more ({filtered.length - limit} remaining)</button>
          </div>
        )}
      </div>
      <Lightbox media={lightbox} onClose={() => setLightbox(null)} />
    </>
  )
}
