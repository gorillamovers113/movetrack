import React from 'react'
import { nextPackingStep, packingProgress, loadingChecklist, loadingProgress, receivingChecklist, receivingProgress } from '../lib/mutations.js'
import { useStore, canAct, containerAction, CONT_STATUS } from '../store.jsx'
import { StagePill } from '../ui.jsx'
import FindUnitButton from '../components/FindUnitButton.jsx'
import ClockCard from '../components/ClockCard.jsx'
import { canPack, canLoad, canReceive } from '../lib/roles.js'
import { openPackingUnit, openLoadingUnit, isPaused } from '../lib/focus.js'

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
  // The narrowing is a property of the PACKING queue, not of the person. Somebody
  // who can both pack and load needs their own apartments while packing and the
  // whole ready-to-load pile while loading, and keying it off the unit's stage
  // gives all three roles the right answer without any of them naming a role.
  const mine = actionable.filter((u) => {
    if (canPack(role) && (u.stage === 'not_started' || u.stage === 'packing')) {
      return (u.crew?.packers || []).includes(currentUser.uid)
    }
    return true
  })
  // "In progress" means something different per role: a packer's own open
  // apartments, and for a mover any packed unit they have already started
  // loading. Without this a mover's half-loaded unit sits in "Ready to start"
  // looking untouched.
  const started = (u) => {
    if (u.stage === 'packed') return loadingProgress(u).done > 0
    if (u.stage === 'loaded' || u.stage === 'picked_up') return receivingProgress(u).done > 0
    return u.stage === 'packing'
  }
  /* One apartment at a time, said out loud rather than only enforced.
   *
   * Refusing the write is not enough on its own: somebody who taps a second
   * unit and gets an error learns the app is broken, not that they have work
   * open. So the queue names what is holding them and greys the rest. */
  const openPacking = openPackingUnit(state.units, currentUser)
  const openLoading = openLoadingUnit(state.units, currentUser)
  const lockFor = (u) => {
    if (currentUser.role === 'admin') return null
    if (u.stage === 'not_started' || u.stage === 'packing') {
      return openPacking && openPacking.id !== u.id ? openPacking : null
    }
    if (u.stage === 'packed') {
      return openLoading && openLoading.id !== u.id ? openLoading : null
    }
    return null
  }

  /* Paused work is not in-progress work.
   *
   * A parked unit sat in "In progress: finish these" looking like something
   * somebody was actively on, which is exactly the impression pausing exists
   * to remove. It gets its own section, carrying the reason, so the queue
   * reads as what is live and what is waiting on somebody else. */
  const parked = mine.filter(isPaused)
  const live = mine.filter((u) => !isPaused(u))
  const inProgress = live.filter(started)
  const ready = live.filter((u) => !started(u))
  // Somebody who packs and loads has both kinds of work waiting in one list,
  // and "Ready to start" cannot describe both. Splitting by the unit's stage
  // names each pile correctly and, as a side effect, removes the per-role
  // heading that only ever had one right answer.
  const readyToPack = ready.filter((u) => u.stage === 'not_started' || u.stage === 'packing')
  const readyToLoad = ready.filter((u) => u.stage === 'packed')
  const readyToReceiveIn = ready.filter((u) => u.stage === 'loaded' || u.stage === 'picked_up')
  const readyOther = ready.filter((u) => !readyToPack.includes(u) && !readyToLoad.includes(u) && !readyToReceiveIn.includes(u))

  // Units this packer has already finished. They drop out of the queue above
  // the moment they are packed (canAct stops being true), which left no way
  // back to a unit to check what was recorded on it. Read-only: the work is
  // done and handed to the movers, so nothing here is editable.
  // Units this person worked that have moved past them. They drop out of the
  // queue above the moment they are handed on, which left no way back to check
  // what was recorded. Read-only: the work is done.
  const finishedByMe = state.units
    .filter((u) => {
      const packed = (u.crew?.packers || []).includes(currentUser.uid)
        && u.stage !== 'not_started' && u.stage !== 'packing'
      const loaded = (u.crew?.movers || []).includes(currentUser.uid)
        && u.stage !== 'not_started' && u.stage !== 'packing' && u.stage !== 'packed'
      return packed || loaded
    })
    .sort((a, b) => (b.times?.packEnd || 0) - (a.times?.packEnd || 0))
  const myRecent = [...state.events].filter((e) => e.uid === currentUser.uid).sort((a, b) => b.ts - a.ts).slice(0, 5)

  // A packer's queue names the next checklist item rather than "Finish
  // packing", so someone glancing at their phone between apartments knows what
  // the unit is actually waiting on without opening it.
  const queueLabel = (u) => {
    if (isPaused(u)) return u.paused.reason || 'Paused'
    if (canReceive(role) && (u.stage === 'loaded' || u.stage === 'picked_up')) {
      const next = receivingChecklist(u).find((s) => !s.done)
      const p = receivingProgress(u)
      return next ? `${next.label} (${p.done}/${p.total})` : `Book unit ${u.number} in`
    }
    if (canLoad(role) && u.stage === 'packed') {
      const next = loadingChecklist(u).find((s) => !s.done)
      const p = loadingProgress(u)
      return next ? `${next.label} (${p.done}/${p.total})` : `Close out unit ${u.number}`
    }
    const onChecklist = canPack(role) && (u.stage === 'not_started' || u.stage === 'packing')
    if (!onChecklist) return canAct(currentUser, u, returnPhase).label
    const unitEvents = state.events.filter((e) => e.unitId === u.id)
    const next = nextPackingStep(u, unitEvents)
    if (!next) return canAct(currentUser, u, returnPhase).label
    // Denominator comes from the progress itself, which counts the seven
    // required items. Using the full step list would read "3/8" and imply the
    // optional note was outstanding work.
    const p = packingProgress(u, unitEvents)
    return `${next.label} (${p.done}/${p.total})`
  }

  const Section = ({ title, units, done = false }) => units.length > 0 && (
    <>
      <div className="section-title">{title} · {units.length}</div>
      <div className="cont-grid" style={{ marginBottom: 8 }}>
        {units.map((u) => {
          const lock = lockFor(u)
          return (
          <div
            key={u.id}
            className="card cont-card"
            onClick={() => openUnit(u.id)}
            style={lock ? { opacity: .55 } : undefined}
            title={lock ? `Finish unit ${lock.number} first` : undefined}
          >
            <div className="row">
              <span className="cont-num grow">Unit {u.number}</span>
              <StagePill stage={u.stage} short />
            </div>
            <div className="cont-units">{u.tenant || '-'} · Floor {u.floor}{u.pieces ? ` · ${u.pieces} pieces` : ''}</div>
            {u.note && <div className="muted" style={{ marginTop: 4 }}>⚠️ {u.note}</div>}
            {done ? (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 10, width: '100%' }}>View what you recorded →</button>
            ) : lock ? (
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 10, width: '100%' }} disabled>
                Finish unit {lock.number} first
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" style={{ marginTop: 10, width: '100%' }}>{queueLabel(u)} →</button>
            )}
          </div>
          )
        })}
      </div>
    </>
  )

  return (
    <>
      {/* Returns null for every role except packer and mover, so no guard here. */}
      <ClockCard toast={toast} />
      <div className="page-head">
        <div><h1>My queue</h1><p>Units waiting on you, {currentUser.name.split(' ')[0]}</p></div>
        <FindUnitButton openUnit={openUnit} toast={toast} />
      </div>
      {(openPacking || openLoading) && currentUser.role !== 'admin' && (
        <div
          className="card"
          onClick={() => openUnit((openPacking || openLoading).id)}
          style={{ padding: '12px 16px', marginBottom: 12, cursor: 'pointer', borderLeft: '3px solid var(--brand, #f59e0b)' }}
        >
          <b>Unit {(openPacking || openLoading).number} is open</b>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            Finish it before starting another. One apartment at a time is what keeps a photo on the right unit.
          </div>
        </div>
      )}
      {mine.length === 0 && finishedByMe.length === 0 && (
        <div className="card empty">
          <div className="big">🚪</div>
          {canReceive(role)
            ? <>Nothing has arrived yet. Units appear here once the movers close them out on site.</>
            : canPack(role)
              ? <>Nothing open right now. Walk up to a unit and tap <b>Start a unit</b>, then type the number on the door.</>
              : <>No units are packed and waiting yet. They turn green on the board the moment the packers finish one.</>}
        </div>
      )}
      <Section title="In progress: finish these" units={inProgress} />
      <Section title="Paused, waiting on somebody else" units={parked} />
      <Section title="Ready to start" units={readyToPack} />
      <Section title="Packed and ready to load" units={readyToLoad} />
      <Section title="Arrived, waiting to be checked in" units={readyToReceiveIn} />
      <Section title="Waiting on you" units={readyOther} />
      <Section title="Finished by you · view only" units={finishedByMe} done />
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
