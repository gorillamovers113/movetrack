/* Studio 15, as the property manager sees it.
 *
 * Casey, 2026-10-22: "this would be for the management and property managers
 * to use to track what we are doning. show them, nice stats, units
 * compleated. they can click on a unit for all of the details images, notes,
 * before and afters, etc. i want to look like a profeshinal relocation
 * company here, do a good job!!"
 *
 * WHAT THIS PAGE IS FOR. A property manager has one question, asked twenty
 * times a day by somebody else: where are you up to. Everything here answers
 * it at a different magnification - the headline count from across a room,
 * the building to find a floor, a unit to see the apartment itself. There is
 * no navigation to learn and nothing to configure.
 *
 * READ ONLY, AND NOT JUST ON THE SCREEN. A viewer may append a note and
 * nothing else, enforced in firestore.rules, because a hidden button is not
 * a lock. The note is there because the person watching usually knows
 * something the crew does not - a lift booking, a tenant who will not be in.
 *
 * WHY IT SHOWS THE WHOLE TIMELINE. Casey: "track everyting that happens who,
 * when and where for each unit." Every write the crew makes already logs who
 * and when; this is where that becomes something a client can read. It is
 * also the honest thing to publish: a record you would only show when it
 * flatters you is not a record.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import {
  subscribeUnits, subscribeEvents, doneCount, stepTotal, stepsFor, photoCount,
  shotsFor, weArePacking, weAreUnpacking, phaseOf, addNote,
} from './s15.js'
import S15Building from './S15Building.jsx'
import { T, NUM, when, toMs } from './s15Theme.js'
import { GorillaWordmark } from '../ui.jsx'

/* ── small pieces ──────────────────────────────────────────────── */

function Stat({ value, label, hint, accent }) {
  return (
    <div
      style={{
        background: T.ink2, border: `1px solid ${T.line}`, borderRadius: 14,
        padding: '18px 20px', minWidth: 0, flex: '1 1 150px',
      }}
    >
      <div style={{ ...NUM, fontSize: 38, fontWeight: 800, lineHeight: 1, color: accent || T.paper, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: T.muted, marginTop: 8 }}>
        {label}
      </div>
      {hint && <div style={{ fontSize: 12, color: T.muted, marginTop: 4, opacity: 0.85 }}>{hint}</div>}
    </div>
  )
}

/** The job in one bar. Complete, moving, and not started, to scale. */
function ProgressBar({ done, active, total }) {
  const pct = (n) => (total ? (n / total) * 100 : 0)
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: T.ink3 }}>
        <div style={{ width: `${pct(done)}%`, background: T.green }} />
        <div style={{ width: `${pct(active)}%`, background: T.orange }} />
      </div>
      <div className="row" style={{ gap: 18, marginTop: 10, flexWrap: 'wrap' }}>
        <Legend c={T.green} label={`${done} complete`} />
        <Legend c={T.orange} label={`${active} in progress`} />
        <Legend c={T.ink3} label={`${total - done - active} to come`} />
      </div>
    </div>
  )
}

function Legend({ c, label }) {
  return (
    <span className="row" style={{ gap: 7, alignItems: 'center' }}>
      <span style={{ width: 9, height: 9, borderRadius: 3, background: c, display: 'inline-block' }} />
      <span style={{ fontSize: 12.5, color: T.muted }}>{label}</span>
    </span>
  )
}

/** A unit, as a row. Readable at arm's length, no controls. */
function UnitRow({ unit, onOpen }) {
  const n = doneCount(unit)
  const total = stepTotal(unit)
  const shots = photoCount(unit)
  const pct = total ? Math.round((n / total) * 100) : 0
  const state = unit.done
    ? { label: 'Complete', fg: T.green, bg: 'rgba(15,169,104,0.12)' }
    : n > 0
      ? { label: weArePacking(unit) && phaseOf(unit) === 'packing' ? 'Packing' : 'In progress', fg: T.orange, bg: T.orangeSoft }
      : { label: 'Scheduled', fg: T.muted, bg: 'rgba(141,141,162,0.12)' }

  return (
    <button
      onClick={() => onOpen(unit.id)}
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer', position: 'relative',
        background: T.paper, border: `1px solid ${T.stone}`, borderRadius: 12,
        padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14,
        flexWrap: 'wrap', font: 'inherit', overflow: 'hidden',
      }}
    >
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: state.fg }} />
      <span style={{ ...NUM, fontSize: 21, fontWeight: 800, color: T.navy, minWidth: 58, paddingLeft: 6 }}>
        {unit.number}
      </span>
      <span style={{ flex: '1 1 150px', minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, color: T.mutedLight }}>
          {unit.destination ? `moving to ${unit.destination}` : 'destination to be confirmed'}
        </span>
        <span style={{ display: 'block', fontSize: 12, color: T.mutedLight, opacity: 0.8, marginTop: 2 }}>
          {shots > 0 ? `${shots} photo${shots === 1 ? '' : 's'} on file` : 'no photos yet'}
          {weArePacking(unit) && ' · we are packing it'}
          {weAreUnpacking(unit) && ' · we are unpacking it'}
        </span>
      </span>
      <span style={{ ...NUM, fontSize: 12.5, color: T.mutedLight, minWidth: 54, textAlign: 'right' }}>{pct}%</span>
      <span style={{ fontSize: 11.5, fontWeight: 750, color: state.fg, background: state.bg, padding: '4px 10px', borderRadius: 999, letterSpacing: '.02em' }}>
        {state.label}
      </span>
    </button>
  )
}

/* ── one unit, in full ─────────────────────────────────────────── */

function UnitDetail({ unit, events, onBack, user, toast }) {
  const steps = stepsFor(unit)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const notes = [...(unit.notes || [])].sort((a, b) => toMs(b.ts) - toMs(a.ts))
  const log = events.filter((e) => e.unitId === unit.id)

  async function send() {
    const t = note.trim()
    if (!t) return
    setBusy(true)
    try { await addNote(unit, t, user); setNote(''); toast('Note added.') }
    catch (e) { toast(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      <button
        onClick={onBack}
        style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', color: T.orange, fontWeight: 650, fontSize: 14, padding: 0, marginBottom: 18 }}
      >
        ← All units
      </button>

      <div className="row" style={{ alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ ...NUM, margin: 0, fontSize: 40, fontWeight: 800, color: T.navy, letterSpacing: '-0.025em' }}>
          Unit {unit.number}
        </h1>
        {unit.done && (
          <span style={{ fontSize: 12, fontWeight: 750, color: T.green, background: 'rgba(15,169,104,0.12)', padding: '5px 12px', borderRadius: 999 }}>
            ✓ Complete
          </span>
        )}
      </div>
      <p style={{ color: T.mutedLight, marginTop: 6, fontSize: 14.5 }}>
        {unit.destination ? `Moving to unit ${unit.destination}.` : 'Destination to be confirmed.'}
        {weArePacking(unit) && ' Gorilla Movers packed this unit.'}
        {weAreUnpacking(unit) && ' Gorilla Movers unpacked it.'}
      </p>

      {/* The photographs, in the order the work happened. */}
      {steps.map((s) => {
        const shots = shotsFor(unit, s.key)
        if (!shots.length) return null
        return (
          <section key={s.key} style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: 13, fontWeight: 750, letterSpacing: '.08em', textTransform: 'uppercase', color: T.mutedLight, margin: '0 0 12px' }}>
              {s.label}
            </h2>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))' }}>
              {shots.map((sh, i) => (
                <a
                  key={i}
                  href={sh.url}
                  target="_blank"
                  rel="noopener"
                  style={{ display: 'block', borderRadius: 12, overflow: 'hidden', border: `1px solid ${T.stone}`, background: T.paper }}
                >
                  <img src={sh.url} alt={s.label} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }} />
                  <span style={{ display: 'block', padding: '8px 10px', fontSize: 11.5, color: T.mutedLight }}>
                    {sh.name} · {when(sh.ts)}
                  </span>
                </a>
              ))}
            </div>
          </section>
        )
      })}

      {/* Notes: the one thing a viewer may add, because the person watching
          usually knows something the crew does not. */}
      <section style={{ marginTop: 34 }}>
        <h2 style={{ fontSize: 13, fontWeight: 750, letterSpacing: '.08em', textTransform: 'uppercase', color: T.mutedLight, margin: '0 0 12px' }}>
          Notes
        </h2>
        <div style={{ background: T.paper, border: `1px solid ${T.stone}`, borderRadius: 12, padding: 16 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send() }}
              placeholder="Anything the crew should know about this unit"
              style={{ flex: '1 1 240px', minHeight: 46, fontSize: 16, padding: '0 14px', borderRadius: 10, border: `1px solid ${T.stone}`, font: 'inherit', color: T.navy }}
            />
            <button
              onClick={send}
              disabled={busy || !note.trim()}
              style={{ minHeight: 46, padding: '0 20px', borderRadius: 10, border: 'none', cursor: note.trim() ? 'pointer' : 'default', background: note.trim() ? T.orange : T.stone, color: note.trim() ? '#fff' : T.mutedLight, fontWeight: 700, font: 'inherit', fontSize: 15 }}
            >
              {busy ? 'Adding…' : 'Add note'}
            </button>
          </div>
          {notes.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'grid', gap: 12 }}>
              {notes.map((nt, i) => (
                <li key={i} style={{ borderTop: `1px solid ${T.stone}`, paddingTop: 12 }}>
                  <div style={{ fontSize: 14.5, color: T.navy }}>{nt.text}</div>
                  <div style={{ fontSize: 11.5, color: T.mutedLight, marginTop: 3 }}>{nt.by} · {when(nt.ts)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* THE RECORD. Casey: "track everyting that happens who, when and
          where for each unit." Published in full, including the corrections,
          because a record you would only show when it flatters you is not a
          record. */}
      <section style={{ marginTop: 34, marginBottom: 50 }}>
        <h2 style={{ fontSize: 13, fontWeight: 750, letterSpacing: '.08em', textTransform: 'uppercase', color: T.mutedLight, margin: '0 0 12px' }}>
          Everything that happened
        </h2>
        {log.length === 0 ? (
          <p style={{ color: T.mutedLight, fontSize: 14 }}>Nothing recorded on this unit yet.</p>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderLeft: `2px solid ${T.stone}` }}>
            {log.map((e) => (
              <li key={e.id} style={{ position: 'relative', padding: '0 0 18px 20px' }}>
                <span style={{ position: 'absolute', left: -5, top: 5, width: 8, height: 8, borderRadius: 999, background: T.orange }} />
                <div style={{ fontSize: 14.5, color: T.navy }}>{e.action}</div>
                <div style={{ fontSize: 11.5, color: T.mutedLight, marginTop: 2 }}>
                  {e.name} · {when(e.ts)}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

/* ── the page ──────────────────────────────────────────────────── */

export default function S15Status({ toast }) {
  const { currentUser } = useStore()
  const [units, setUnits] = useState([])
  const [events, setEvents] = useState([])
  const [openId, setOpenId] = useState(null)
  const [floor, setFloor] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!currentUser || currentUser.status !== 'active') return undefined
    return subscribeUnits(setUnits, (e) => setErr(e.message || 'Could not load the board.'))
  }, [currentUser && currentUser.uid, currentUser && currentUser.status])

  useEffect(() => {
    if (!currentUser || currentUser.status !== 'active') return undefined
    return subscribeEvents(setEvents, () => {})
  }, [currentUser && currentUser.uid, currentUser && currentUser.status])

  const open = useMemo(() => (openId ? units.find((u) => u.id === openId) : null), [openId, units])

  const stats = useMemo(() => {
    const done = units.filter((u) => u.done).length
    const active = units.filter((u) => !u.done && doneCount(u) > 0).length
    const photos = units.reduce((n, u) => n + photoCount(u), 0)
    const packing = units.filter((u) => weArePacking(u)).length
    /* The newest event, by the server's clock rather than by whatever
       order the subscription happened to deliver them in. */
    const lastTs = events.reduce((best, e) => Math.max(best, toMs(e.ts)), 0) || null
    return { done, active, photos, packing, total: units.length, lastTs }
  }, [units, events])

  const shown = useMemo(() => {
    const list = [...units].sort((a, b) =>
      String(a.number).localeCompare(String(b.number), undefined, { numeric: true }))
    if (!floor) return list
    return list.filter((u) => String(u.number).startsWith(String(floor)))
  }, [units, floor])

  return (
    <div style={{ font: `15px/1.5 ${T.font}`, color: T.navy, background: T.bone, minHeight: '100vh' }}>
      {/* ── the dark head: the answer, before anything else ───────── */}
      <header style={{ background: T.ink, color: T.paper, padding: '34px 22px 30px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <GorillaWordmark width={190} onDark />
              <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.16em', textTransform: 'uppercase', color: T.orange, marginTop: 12 }}>
                Relocation in progress
              </div>
              <h1 style={{ margin: '8px 0 0', fontSize: 40, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05 }}>
                Studio 15
              </h1>
              <p style={{ margin: '6px 0 0', color: T.muted, fontSize: 14.5 }}>
                1475 Imperial Avenue, San Diego · unit to unit, in building
              </p>
            </div>
            <div style={{ textAlign: 'right', minWidth: 160 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: T.muted }}>
                Last activity
              </div>
              <div style={{ fontSize: 14.5, marginTop: 5, color: T.paper }}>
                {stats.lastTs ? when(stats.lastTs) : 'Not started yet'}
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: 12, marginTop: 28, flexWrap: 'wrap' }}>
            <Stat value={stats.done} label="Units complete" accent={T.green} hint={`of ${stats.total} on this job`} />
            <Stat value={stats.active} label="In progress" accent={T.orange} hint="being worked right now" />
            <Stat value={stats.photos} label="Photographs" hint="every unit, before and after" />
            <Stat value={stats.packing} label="We pack" hint="units our crew packs" />
          </div>

          <ProgressBar done={stats.done} active={stats.active} total={stats.total} />
        </div>
      </header>

      <main style={{ maxWidth: 1040, margin: '0 auto', padding: '30px 22px 60px' }}>
        {err && (
          <div style={{ background: '#fff5f5', border: `1px solid ${T.red}`, color: T.red, borderRadius: 12, padding: 14, marginBottom: 20 }}>
            {err}
          </div>
        )}

        {open ? (
          <UnitDetail
            unit={open}
            events={events}
            user={currentUser}
            toast={toast}
            onBack={() => setOpenId(null)}
          />
        ) : (
          <>
            <section>
              <h2 style={{ fontSize: 13, fontWeight: 750, letterSpacing: '.08em', textTransform: 'uppercase', color: T.mutedLight, margin: '0 0 14px' }}>
                The building
              </h2>
              <div style={{ background: T.ink, borderRadius: 16, padding: 14, overflow: 'hidden' }}>
                <S15Building units={units} selected={floor} onSelect={setFloor} />
              </div>
              <p style={{ fontSize: 12.5, color: T.mutedLight, marginTop: 10 }}>
                {floor ? `Showing floor ${floor}. Tap it again for the whole building.` : 'Tap a floor to filter the list below.'}
              </p>
            </section>

            <section style={{ marginTop: 34 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                <h2 style={{ fontSize: 13, fontWeight: 750, letterSpacing: '.08em', textTransform: 'uppercase', color: T.mutedLight, margin: 0 }}>
                  {floor ? `Floor ${floor}` : 'Every unit'}
                </h2>
                <span style={{ fontSize: 12.5, color: T.mutedLight }}>Tap a unit for photographs and its full record</span>
              </div>

              {shown.length === 0 ? (
                <p style={{ color: T.mutedLight }}>No units on this job yet.</p>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {shown.map((u) => <UnitRow key={u.id} unit={u} onOpen={setOpenId} />)}
                </div>
              )}
            </section>

            <footer style={{ marginTop: 44, paddingTop: 22, borderTop: `1px solid ${T.stone}`, color: T.mutedLight, fontSize: 12.5 }}>
              <div style={{ fontWeight: 700, color: T.navy, fontSize: 13.5 }}>Gorilla Movers of San Diego</div>
              <div style={{ marginTop: 4 }}>
                Every unit is photographed before and after, and every action on this page is recorded with a name and a time.
              </div>
            </footer>
          </>
        )}
      </main>
    </div>
  )
}
