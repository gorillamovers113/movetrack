import React, { useMemo, useState } from 'react'
import { STAGES, stageOf } from '../seed.js'
import { useStore } from '../store.jsx'
import BuildingView from './BuildingView.jsx'
import NewUnitButton from '../components/NewUnitModal.jsx'

export default function Dashboard({ openUnit, toast }) {
  const { state } = useStore()
  const [stageFilter, setStageFilter] = useState(null)
  const [floorSel, setFloorSel] = useState(null)
  const [q, setQ] = useState('')

  const counts = useMemo(() => {
    const c = Object.fromEntries(STAGES.map((s) => [s.key, 0]))
    for (const u of state.units) c[u.stage]++
    return c
  }, [state.units])

  const boxesTracked = state.units.reduce((n, u) => n + (u.boxCount || 0), 0)
  const openFlags = state.units.filter((u) => u.flag?.open).length + state.containers.filter((c) => c.flag?.open).length

  const match = (u) => {
    if (stageFilter && u.stage !== stageFilter) return false
    if (q) {
      const s = q.toLowerCase()
      const contNums = u.containerIds.map((id) => state.containers.find((c) => c.id === id)?.number.toLowerCase() || '')
      if (!u.number.includes(s) && !(u.tenant || '').toLowerCase().includes(s) && !contNums.some((c) => c.includes(s))) return false
    }
    return true
  }

  // C1 fix: skip floors with zero units (day 1, an empty board has all nine
  // floors empty) — an empty array would otherwise crash the `units[0].floor`
  // read below. Track the floor number alongside its units instead.
  const floors = []
  for (let f = 9; f >= 1; f--) {
    if (floorSel && f !== floorSel) continue
    const us = state.units.filter((u) => u.floor === f)
    if (us.length) floors.push({ floor: f, units: us })
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{state.project?.name || 'Trinity Manor'}</h1>
          <p>{state.project?.address || '3940 Park Blvd'}{state.units.length > 0 ? ` — ${state.units.length}-unit relocation` : ''} — live status</p>
        </div>
        <div className="row">
          <input className="search" placeholder="Search unit, tenant, container…" value={q} onChange={(e) => setQ(e.target.value)} />
          <NewUnitButton toast={toast} />
        </div>
      </div>

      <div className="kpis">
        {/* I6 fix: denominator/count come from live state.units, not a hardcoded 100 */}
        <div className="card kpi">
          <div className="n">
            {state.units.length === 0 ? '0' : state.units.length - counts.not_started}
            {state.units.length > 0 && <span style={{ fontSize: 16, color: 'var(--ink-3)' }}> /{state.units.length}</span>}
          </div>
          <div className="l">Units started</div>
        </div>
        <div className="card kpi"><div className="n"><span className="dot" style={{ background: stageOf('at_warehouse').color }} />{counts.at_warehouse}</div><div className="l">In warehouse</div></div>
        <div className="card kpi"><div className="n">{boxesTracked.toLocaleString()}</div><div className="l">Boxes tracked</div></div>
        <div className={`card kpi ${openFlags ? 'alert' : ''}`}><div className="n">{openFlags}</div><div className="l">Open flags</div></div>
      </div>

      <div className="dash-cols">
        <div className="card" style={{ padding: '14px 14px 8px' }}>
          <div className="section-title" style={{ margin: '2px 6px 0' }}>The building — tap a floor</div>
          <BuildingView selected={floorSel} onSelect={(f) => setFloorSel(floorSel === f ? null : f)} />
        </div>

        <div>
          <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
            <div className="progress-band">
              {STAGES.filter((s) => counts[s.key] > 0).map((s) => (
                <div key={s.key} style={{ width: `${counts[s.key]}%`, background: s.color }} title={`${s.label}: ${counts[s.key]}`} />
              ))}
            </div>
            <div className="legend">
              {STAGES.filter((s) => counts[s.key] > 0).map((s) => (
                <span key={s.key}><i style={{ background: s.color }} />{s.short} · {counts[s.key]}</span>
              ))}
            </div>
          </div>

          <div className="filters">
            {floorSel && <button className="chip on" onClick={() => setFloorSel(null)}>Floor {floorSel} ✕</button>}
            <button className={`chip ${!stageFilter && !floorSel ? 'on' : ''}`} onClick={() => { setStageFilter(null); setFloorSel(null) }}>All</button>
            {STAGES.filter((s) => counts[s.key] > 0).map((s) => (
              <button key={s.key} className={`chip ${stageFilter === s.key ? 'on' : ''}`} onClick={() => setStageFilter(stageFilter === s.key ? null : s.key)}>
                <i style={{ background: s.color }} />{s.short}
              </button>
            ))}
          </div>

          <div className="card gridwrap">
            {/* C1 fix: friendly empty state instead of crashing when the board has no units yet */}
            {floors.length === 0 && (
              <div className="empty"><div className="big">🏢</div>No units yet. They'll show up here as soon as they're created.</div>
            )}
            {floors.map(({ floor, units }) => (
              <div className="floor-row" key={floor}>
                <div className="floor-label">Fl {floor}</div>
                <div className="unit-tiles">
                  {units.map((u) => {
                    const on = match(u)
                    // C2 fix: unit.tenant is guarded — a hand-created unit doc
                    // may not have it yet (see the field-naming note in seed.js).
                    const tenant = u.tenant || ''
                    return (
                      <button
                        key={u.id} className={`tile ${on ? '' : 'dim'}`}
                        style={{ background: stageOf(u.stage).color }}
                        onClick={() => openUnit(u.id)}
                        title={`Unit ${u.number} — ${tenant || 'no tenant on file'} — ${stageOf(u.stage).label}`}
                      >
                        {u.number}
                        <small>{tenant.split(' ')[1] || tenant || '—'}</small>
                        {u.flag?.open && <span className="flagdot" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
