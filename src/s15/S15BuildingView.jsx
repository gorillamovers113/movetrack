/* The Studio 15 building screen: the elevation, and the floor you tapped.
 *
 * Same idea as Trinity Manor's - the drawing is a way to find a door. Tap a
 * floor, get that floor's units; tap a unit, you are in the five photos.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { subscribeUnits, doneCount, S15_STEPS } from './s15.js'
import S15Building, { floorOf, UNITS_PER_FLOOR } from './S15Building.jsx'
import S15Unit from './S15Unit.jsx'

export default function S15BuildingView({ toast }) {
  const { currentUser } = useStore()
  const [units, setUnits] = useState([])
  const [floor, setFloor] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!currentUser || currentUser.status !== 'active') return undefined
    return subscribeUnits(setUnits, (e) => setErr(e.message || 'Could not load the building.'))
  }, [currentUser && currentUser.uid, currentUser && currentUser.status])

  const open = useMemo(() => (openId ? units.find((u) => u.id === openId) : null), [openId, units])
  const onFloor = useMemo(
    () => (floor ? units.filter((u) => floorOf(u.number) === floor) : []),
    [units, floor],
  )

  if (open) {
    return <S15Unit unit={{ ...open, __user: currentUser }} goBack={() => setOpenId(null)} toast={toast} />
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ margin: 0 }}>Studio 15</h1>
      <div className="muted" style={{ marginBottom: 14 }}>1475 Imperial Ave · five floors · {UNITS_PER_FLOOR} units a floor · tap a floor</div>

      {err && <div className="card" style={{ padding: 12, marginBottom: 12, background: '#fef2f2', border: '1px solid #fecaca' }}>{err}</div>}

      <div className="card" style={{ padding: 16 }}>
        <S15Building units={units} selected={floor} onSelect={setFloor} />
        <div className="legend row" style={{ gap: 14, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap', fontSize: 12 }}>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#1d2733', opacity: 0.42, marginRight: 5 }} />Not on the list</span>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#fff', border: '1px solid #bbb', marginRight: 5 }} />Not started</span>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#f0a81e', marginRight: 5 }} />In progress</span>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#16a34a', marginRight: 5 }} />Complete</span>
        </div>
      </div>

      {floor && (
        <>
          <div className="row" style={{ alignItems: 'baseline', marginTop: 18 }}>
            <div className="section-title grow" style={{ margin: 0 }}>
              FLOOR {floor} · {onFloor.length} of {UNITS_PER_FLOOR} on the list · {onFloor.filter((u) => u.done).length} done
            </div>
            <button className="btn btn-sm" onClick={() => setFloor(null)}>Clear</button>
          </div>
          {!onFloor.length && <div className="muted" style={{ marginTop: 10 }}>No units from this floor are on the board yet.</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginTop: 12 }}>
            {onFloor.map((u) => (
              <button
                key={u.id}
                className="tile"
                onClick={() => setOpenId(u.id)}
                style={{
                  padding: 14, textAlign: 'left', minHeight: 86, borderRadius: 12, cursor: 'pointer',
                  border: '1px solid var(--line, #e4e7ee)',
                  background: u.done ? '#16a34a' : '#fff', color: u.done ? '#fff' : 'inherit',
                }}
              >
                <div style={{ fontSize: 20, fontWeight: 700 }}>{u.number}</div>
                <div style={{ fontSize: 12, opacity: u.done ? 0.9 : 0.6, marginTop: 2 }}>
                  {u.destination ? `→ ${u.destination}` : 'destination tbd'}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, fontWeight: 650 }}>
                  {u.done ? '✓ Complete' : `${doneCount(u)} of ${S15_STEPS.length} photos`}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ height: 40 }} />
    </div>
  )
}
