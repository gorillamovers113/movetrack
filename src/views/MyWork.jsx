import React from 'react'
import { nextPackingStep, packingProgress, PACKING_STEPS } from '../lib/mutations.js'
import { useStore, canAct, containerAction, CONT_STATUS } from '../store.jsx'
import { StagePill } from '../ui.jsx'
import FindUnitButton from '../components/FindUnitButton.jsx'

export default function MyWork({ openUnit, openContainer, toast }) {
  const { state, currentUser } = useStore()
  const role = currentUser.role
  const returnPhase = state.project?.returnPhase

  if (role === 'driver') {
    const actionable = state.containers.filter((c) => containerAction(currentUser, c, returnPhase))
    return (
      <>
        <div className="page-head">
          <div><h1>My queue</h1><p>Containers waiting on you, {currentUser.name.split(' ')[0]}</p></div>
        </div>
        {actionable.length === 0 && <div className="card empty"><div className="big">🚚</div>Nothing waiting on you right now.</div>}
        <div className="cont-grid">
          {actionable.map((c) => {
            const act = containerAction(currentUser, c, returnPhase)
            const units = c.unitIds.map((id) => state.units.find((u) => u.id === id)).filter(Boolean)
            return (
              <div key={c.id} className="card cont-card" onClick={() => openContainer(c.id)}>
                <div className="row">
                  <span className="cont-num grow">{c.number}</span>
                  <span className="badge" style={{ background: CONT_STATUS[c.status].color + '22', color: CONT_STATUS[c.status].color }}>{CONT_STATUS[c.status].label}</span>
                </div>
                <div className="cont-units">{units.map((u) => `Unit ${u.number}`).join(' · ')}</div>
                <button className="btn btn-primary btn-sm" style={{ marginTop: 10, width: '100%' }}>{act.label} →</button>
              </div>
            )
          })}
        </div>
      </>
    )
  }

  // Packers see the units they personally have open, not the whole building:
  // canAct() is true for every not-yet-packed unit, so listing it verbatim
  // put all fifty apartments and their tenants' names in front of someone who
  // needs one door at a time. They reach any other unit by typing its number.
  //
  // Movers are NOT narrowed this way. A mover has not touched a unit before
  // they load it, so the same filter would empty their queue: seeing what is
  // packed and waiting IS their job.
  const actionable = state.units.filter((u) => canAct(currentUser, u, returnPhase))
  const mine = role === 'packer'
    ? actionable.filter((u) => (u.crew?.packers || []).includes(currentUser.uid))
    : actionable
  const inProgress = mine.filter((u) => u.stage === 'packing')
  const ready = mine.filter((u) => u.stage !== 'packing')
  const myRecent = [...state.events].filter((e) => e.uid === currentUser.uid).sort((a, b) => b.ts - a.ts).slice(0, 5)

  // A packer's queue names the next checklist item rather than "Finish
  // packing", so someone glancing at their phone between apartments knows what
  // the unit is actually waiting on without opening it.
  const queueLabel = (u) => {
    const onChecklist = role === 'packer' && (u.stage === 'not_started' || u.stage === 'packing')
    if (!onChecklist) return canAct(currentUser, u, returnPhase).label
    const next = nextPackingStep(u, state.events.filter((e) => e.unitId === u.id))
    if (!next) return canAct(currentUser, u, returnPhase).label
    return `${next.label} (${packingProgress(u, state.events.filter((e) => e.unitId === u.id)).done}/${PACKING_STEPS.length})`
  }

  const Section = ({ title, units }) => units.length > 0 && (
    <>
      <div className="section-title">{title} · {units.length}</div>
      <div className="cont-grid" style={{ marginBottom: 8 }}>
        {units.map((u) => (
          <div key={u.id} className="card cont-card" onClick={() => openUnit(u.id)}>
            <div className="row">
              <span className="cont-num grow">Unit {u.number}</span>
              <StagePill stage={u.stage} short />
            </div>
            <div className="cont-units">{u.tenant || '-'} · Floor {u.floor}{u.pieces ? ` · ${u.pieces} pieces` : ''}</div>
            {u.note && <div className="muted" style={{ marginTop: 4 }}>⚠️ {u.note}</div>}
            <button className="btn btn-primary btn-sm" style={{ marginTop: 10, width: '100%' }}>{queueLabel(u)} →</button>
          </div>
        ))}
      </div>
    </>
  )

  return (
    <>
      <div className="page-head">
        <div><h1>My queue</h1><p>Units waiting on you, {currentUser.name.split(' ')[0]}</p></div>
        <FindUnitButton openUnit={openUnit} toast={toast} />
      </div>
      {mine.length === 0 && (
        <div className="card empty">
          <div className="big">🚪</div>
          Nothing open right now. Walk up to a unit and tap <b>Start a unit</b>, then type the number on the door.
        </div>
      )}
      <Section title="In progress: finish these" units={inProgress} />
      <Section title="Ready to start" units={ready} />
      {myRecent.length > 0 && (
        <>
          <div className="section-title">Your recent activity</div>
          <div className="card" style={{ padding: '10px 18px' }}>
            {myRecent.map((e) => (
              <div key={e.id} className="muted" style={{ padding: '6px 0', fontSize: 13.5 }}>
                {e.action} · <b>{new Date(e.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</b>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
