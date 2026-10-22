/* Studio 15 - the board.
 *
 * Deliberately one screen and one list. Trinity Manor's crew reach a unit
 * through a dashboard, a floor plate, a queue or a search depending on role;
 * here every unit on the job is a tile, biggest thing on the screen, sorted
 * by number. A packer opens the app and taps the door they are standing at.
 *
 * The detail view is held in local state rather than routed, so wiring this
 * whole project into the app costs App.jsx exactly one case.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import {
  subscribeUnits, doneCount, isAdmin, canAddUnit, seedUnits, addUnit, deleteUnit,
  STUDIO15_SCHEDULED, weArePacking, phaseOf,
} from './s15.js'
import S15Unit from './S15Unit.jsx'
import ClockCard from '../components/ClockCard.jsx'
import { S15UnitGrid, lastTouch } from './S15UnitCard.jsx'

export default function Studio15({ toast }) {
  const { currentUser } = useStore()
  const [units, setUnits] = useState([])
  const [openId, setOpenId] = useState(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const admin = isAdmin(currentUser)
  const mayAdd = canAddUnit(currentUser)

  useEffect(() => {
    if (!currentUser || currentUser.status !== 'active') return undefined
    return subscribeUnits(setUnits, (e) => setErr(e.message || 'Could not load the board.'))
  }, [currentUser && currentUser.uid, currentUser && currentUser.status])

  const open = useMemo(
    () => (openId ? units.find((u) => u.id === openId) : null),
    [openId, units],
  )

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return units
    return units.filter((u) => String(u.number).includes(t) || String(u.destination || '').includes(t))
  }, [units, q])

  const finished = units.filter((u) => u.done).length

  /* The key, and only when there is something to key. On a board of
     sixteen tenant-packed units it would be three lines explaining colours
     that are not on the screen. */
  const ours = units.filter((u) => weArePacking(u) && !u.done)
  const packToday = ours.filter((u) => phaseOf(u) === 'packing').length
  const packed = ours.length - packToday
  const working = useMemo(
    () => units
      .filter((u) => !u.done && doneCount(u) > 0)
      .sort((a, b) => (lastTouch(b)?.ts || 0) - (lastTouch(a)?.ts || 0)),
    [units],
  )

  if (open) {
    return (
      <S15Unit
        unit={{ ...open, __user: currentUser }}
        goBack={() => setOpenId(null)}
        toast={toast}
      />
    )
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div className="row" style={{ alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Studio 15</h1>
        <span className="muted">San Diego · unit to unit, in building</span>
      </div>

      {err && (
        <div className="card" style={{ padding: 12, marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca' }}>{err}</div>
      )}

      {/* THE WAY BACK OFF THE CLOCK.
          The welcome screen puts everyone ON the clock at sign-in, but it
          lives in Trinity's Dashboard and My-queue, neither of which is in
          Studio 15's nav. Without this, a crew member here clocks in every
          morning and can never clock out: the shift stays open for ever and
          Casey repairs every row by hand. ClockCard renders nothing for a
          role that keeps no time, so it costs a viewer nothing. */}
      <div style={{ marginTop: 14 }}>
        <ClockCard toast={toast} />
      </div>

      {units.length > 0 && (
        <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <div className="kpi card" style={{ padding: '12px 16px' }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{finished}<span className="muted" style={{ fontSize: 15 }}> /{units.length}</span></div>
            <div className="muted" style={{ fontSize: 12 }}>Units complete</div>
          </div>
        </div>
      )}

      {ours.length > 0 && (
        <div className="row" style={{ gap: 14, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {packToday > 0 && <Key c="#e9a21c" bg="#fffaf0" label={`${packToday} we pack today`} />}
          {packed > 0 && <Key c="#23409f" bg="#f5f8ff" label={`${packed} packed, ready to move`} />}
        </div>
      )}

      {units.length > 6 && (
        <input
          className="input"
          placeholder="Find a unit number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          inputMode="numeric"
          style={{ marginTop: 14, minHeight: 46, fontSize: 16, width: '100%' }}
        />
      )}

      {!units.length && (
        <div className="card" style={{ padding: 24, marginTop: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 34 }}>🏢</div>
          <p style={{ marginTop: 8 }}>No units on the board yet.</p>
          {admin && (
            <button
              className="btn btn-primary btn-lg"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const n = await seedUnits(STUDIO15_SCHEDULED, currentUser)
                  toast(n ? `Loaded ${n} units.` : 'Those units were already on the board.')
                } catch (e) { toast(e.message) } finally { setBusy(false) }
              }}
            >
              {busy ? 'Loading…' : `Load the ${STUDIO15_SCHEDULED.length} scheduled units`}
            </button>
          )}
        </div>
      )}

      {/* Started but not finished, first and biggest: on a 16-unit board
          the question is never "which units exist", it is "where is everyone
          right now". Most recently touched first. */}
      {working.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 18, marginBottom: 10 }}>
            BEING WORKED NOW · {working.length}
          </div>
          <S15UnitGrid units={working} onOpen={setOpenId} />
          <div className="section-title" style={{ marginTop: 20, marginBottom: 10 }}>ALL UNITS</div>
        </>
      )}

      <div style={{ marginTop: working.length ? 0 : 16 }}>
        <S15UnitGrid units={shown} onOpen={setOpenId} />
      </div>

      {mayAdd && units.length > 0 && (
        <div className="card" style={{ padding: 14, marginTop: 20 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            {admin ? 'ADMIN' : 'SUPERVISOR'}
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            A unit that is not on the list yet. Check the number on the door first.
          </div>
          <AddUnit currentUser={currentUser} toast={toast} />
          {admin && (
          <button
            className="btn btn-sm"
            style={{ marginTop: 10 }}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                const n = await seedUnits(STUDIO15_SCHEDULED, currentUser)
                toast(n ? `Added ${n} missing units.` : 'All scheduled units are already on the board.')
              } catch (e) { toast(e.message) } finally { setBusy(false) }
            }}
          >Re-check the scheduled list</button>
          )}
        </div>
      )}

      <div style={{ height: 40 }} />
    </div>
  )
}

/** One entry in the key. The swatch carries the rail colour and the tint
 *  together, so it reads as the card it stands for rather than as a dot. */
function Key({ c, bg, label }) {
  return (
    <span className="row" style={{ gap: 7, alignItems: 'center' }}>
      <span style={{ width: 22, height: 15, borderRadius: 4, background: bg, border: '1px solid var(--line, #e4e7ee)', boxShadow: `inset 4px 0 0 ${c}` }} />
      <span className="muted" style={{ fontSize: 12 }}>{label}</span>
    </span>
  )
}

function AddUnit({ currentUser, toast }) {
  const [num, setNum] = useState('')
  const [packers, setPackers] = useState('0')
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {/* 16px and 44px on both: under 16 iOS zooms the page the moment a
          supervisor taps the field, and they are doing this one-handed in a
          corridor. */}
      <input className="input" placeholder="Unit #" value={num} inputMode="numeric" onChange={(e) => setNum(e.target.value)} style={{ width: 110, minHeight: 44, fontSize: 16 }} />
      <select className="input" value={packers} onChange={(e) => setPackers(e.target.value)} style={{ width: 150, minHeight: 44, fontSize: 16 }}>
        <option value="0">Tenant packs</option>
        <option value="1">1 packer</option>
        <option value="2">2 packers</option>
        <option value="3">3 packers</option>
      </select>
      <button
        className="btn"
        disabled={!num.trim()}
        onClick={async () => {
          try {
            await addUnit({ number: num, packers: Number(packers), service: Number(packers) ? 'gorilla' : 'tenant' }, currentUser)
            setNum(''); setPackers('0'); toast(`Unit ${num} added.`)
          } catch (e) { toast(e.message) }
        }}
      >Add unit</button>
    </div>
  )
}
