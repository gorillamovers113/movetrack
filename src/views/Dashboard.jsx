import React, { useMemo, useState } from 'react'
import { STAGES, stageOf } from '../seed.js'
import { useStore } from '../store.jsx'
import { todayKey, findScheduleDay, nextScheduleDay, fmtScheduleDate, progressForDay, scheduleForPhase, targetStageForWork } from '../lib/schedule.js'
import BuildingView from './BuildingView.jsx'
import NewUnitButton from '../components/NewUnitModal.jsx'
import ReturnPhaseToggle from '../components/ReturnPhaseToggle.jsx'

// Compact "today" banner: floor + work type + progress vs plan, or a
// sensible off-day / empty-schedule fallback. Never crashes on an empty
// schedule (day 1, before anyone has tapped "Load the plan").
function TodayBanner({ toast }) {
  const { state, currentUser, dispatch } = useStore()
  const [busy, setBusy] = useState(false)
  const isAdmin = currentUser?.role === 'admin'
  // Once the return phase is on, the "what's happening today" banner should
  // track the return plan instead of the (by then finished) outbound one, so
  // it stays useful through the whole project instead of going stale after
  // the last outbound day.
  const phase = state.project?.returnPhase ? 'return' : 'out'
  const phaseSchedule = useMemo(() => scheduleForPhase(state.schedule, phase), [state.schedule, phase])

  if (phaseSchedule.length === 0) {
    return (
      <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
        {isAdmin ? (
          <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div className="grow">
              <b>{phase === 'return' ? 'Return schedule not loaded yet.' : 'Schedule not loaded yet.'}</b>
              <div className="muted" style={{ marginTop: 2 }}>
                {phase === 'return'
                  ? 'Load the return floor plan (floor 1 through floor 9, dates to be edited once known).'
                  : 'Load the 27-day floor plan (Sep 8, Floor 9 through Oct 8, Floor 1).'}
              </div>
            </div>
            <button className="btn btn-primary" disabled={busy} onClick={async () => {
              setBusy(true)
              try {
                if (phase === 'return') {
                  await dispatch({ type: 'seedReturnSchedule', p: {} })
                  toast?.('Return schedule loaded ✓')
                } else {
                  await dispatch({ type: 'seedSchedule', p: {} })
                  toast?.('Schedule loaded: 27 days, Sep 8 to Oct 8 ✓')
                }
              } catch (err) {
                toast?.(err?.message || "Couldn't load the plan. Check your signal and try again.")
              } finally {
                setBusy(false)
              }
            }}>{busy ? 'Loading…' : phase === 'return' ? 'Load the return plan' : 'Load the Sept 8 to Oct 8 plan'}</button>
          </div>
        ) : (
          <div className="muted">{phase === 'return' ? 'Return schedule not loaded yet.' : 'Schedule not loaded yet.'}</div>
        )}
      </div>
    )
  }

  const key = todayKey()
  const day = findScheduleDay(phaseSchedule, key)
  const shown = day || nextScheduleDay(phaseSchedule, key)

  if (!shown) {
    return (
      <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
        <div className="muted">No more scheduled {phase === 'return' ? 'return ' : ''}work. The plan ran through {fmtScheduleDate([...phaseSchedule].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.date)}.</div>
      </div>
    )
  }

  const isToday = !!day
  const { done, planned } = progressForDay(shown, state.units)
  const pct = planned > 0 ? Math.min(100, Math.round((done / planned) * 100)) : 0
  const workLabel = shown.work === 'MOVEOUT' ? 'MOVE-OUT' : shown.work === 'RETURN' ? 'RETURN' : 'PACK'
  const doneLabel = targetStageForWork(shown.work)

  return (
    <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
      {isToday ? (
        <b>Today: Floor {shown.floor}. {workLabel} · {planned} unit{planned === 1 ? '' : 's'} planned · {fmtScheduleDate(shown.date)}</b>
      ) : (
        <>
          <div className="muted">No scheduled work today.</div>
          <b>Next: Floor {shown.floor}, {workLabel}, {fmtScheduleDate(shown.date)}</b>
        </>
      )}
      <div className="progress-band" style={{ background: 'var(--line)' }}>
        <div style={{ width: `${pct}%`, background: stageOf(doneLabel).color }} />
      </div>
      <div className="muted">{done} of {planned} units {doneLabel}</div>
    </div>
  )
}

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

  const piecesTracked = state.units.reduce((n, u) => n + (u.pieces || 0), 0)
  const openFlags = state.units.filter((u) => u.flag?.open).length + state.containers.filter((c) => c.flag?.open).length

  const match = (u) => {
    if (stageFilter && u.stage !== stageFilter) return false
    if (q) {
      const s = q.toLowerCase()
      const contNums = (u.containerIds || []).map((id) => state.containers.find((c) => c.id === id)?.number.toLowerCase() || '')
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
          <ReturnPhaseToggle toast={toast} />
        </div>
      </div>

      <TodayBanner toast={toast} />

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
        <div className="card kpi"><div className="n">{piecesTracked.toLocaleString()}</div><div className="l">Pieces tracked</div></div>
        <div className={`card kpi ${openFlags ? 'alert' : ''}`}><div className="n">{openFlags}</div><div className="l">Open flags</div></div>
        {state.project?.returnPhase && (
          <div className="card kpi"><div className="n"><span className="dot" style={{ background: stageOf('unpacked').color }} />{counts.unpacked}</div><div className="l">Back home, unpacked</div></div>
        )}
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
