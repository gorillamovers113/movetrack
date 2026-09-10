import React, { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { fmtDuration } from '../lib/reports.js'
import { jobSummary, projection } from '../lib/unitSummary.js'
import { surnameOf } from '../lib/mutations.js'

/* The whole building, in the same shape as one apartment's card.
 *
 * Admin only, for the same reason the unit card's hours are: nobody else can
 * read the sessions this is built from.
 */

const MEANINGFUL_MS = 60000
const hrs = (ms) => (ms >= MEANINGFUL_MS ? fmtDuration(ms) : '—')

function Line({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '4px 0', fontSize: 13.5 }}>
      <span className="muted" style={{ flex: 'none', minWidth: 120 }}>{label}</span>
      <span style={{ minWidth: 0, flex: 1 }}>{children}</span>
    </div>
  )
}

// A rate is never shown without the sample it came from. Two apartments is a
// guess and fifty is a number, and the reader has to be able to tell which.
function Rate({ value, n, unit }) {
  if (value == null) return <span className="muted">Not enough finished yet</span>
  return (
    <>
      {unit === 'time' ? fmtDuration(value) : Math.round(value * 10) / 10}
      <span className="muted"> · across {n} unit{n === 1 ? '' : 's'}</span>
    </>
  )
}

function toCSV(job) {
  const head = [
    'Unit', 'Tenant', 'Floor', 'Stage',
    'Packing started', 'Packing finished', 'Packing hours',
    'Loading started', 'Loading finished', 'Loading hours', 'Total hours',
    'Packers', 'Movers', 'Pieces', 'Materials', 'Material breakdown',
    'Vaults', 'Vault numbers', 'Loaded by',
    'Photos', 'Videos', 'Mismatches',
  ]
  const iso = (ts) => (ts ? new Date(ts).toISOString() : '')
  const h = (ms) => (ms > 0 ? Math.round((ms / 3600000) * 100) / 100 : '')
  const cell = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = job.rows.map((r) => [
    r.unit.number, r.unit.tenant, r.unit.floor, r.unit.stage,
    iso(r.packing.startedAt), iso(r.packing.finishedAt), h(r.packing.totalMs),
    iso(r.loading.startedAt), iso(r.loading.finishedAt), h(r.loading.totalMs),
    h(r.packing.totalMs + r.loading.totalMs),
    r.crew.packers.map((p) => p.name).join('; '),
    r.crew.movers.map((p) => p.name).join('; '),
    r.inventory.pieces ?? '', r.materials.total || '',
    r.materials.lines.map((m) => `${m.count} ${m.label.toLowerCase()}`).join('; '),
    r.vaults.started || '', r.vaults.numbers.join('; '),
    [...new Set(r.vaults.list.flatMap((v) => v.by))].join('; '),
    r.media.photos || '', r.media.videos || '', r.mismatches.length || '',
  ].map(cell).join(','))
  return [head.join(','), ...lines].join('\n')
}

export default function JobSummaryCard({ openUnit }) {
  const { state, currentUser } = useStore()
  const [now, setNow] = useState(() => Date.now())
  const [showUnits, setShowUnits] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  const admin = currentUser && currentUser.role === 'admin'
  const job = useMemo(
    () => (admin ? jobSummary({
      units: state.units, sessions: state.unitSessions, users: state.users,
      timeEntries: state.timeEntries, now,
    }) : null),
    [admin, state.units, state.unitSessions, state.users, state.timeEntries, now],
  )

  if (!admin) return null
  const ahead = projection(job)
  const touched = job.rows.filter((r) => r.totals.labourMs > 0 || r.packing.startedAt)

  const download = () => {
    const blob = new Blob([toCSV(job)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `trinity-manor-units-${new Date(now).toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="card" style={{ padding: '16px 20px', marginBottom: 16 }}>
      <div className="row" style={{ marginBottom: 4 }}>
        <div className="section-title grow" style={{ margin: 0 }}>The whole job</div>
        <span style={{ fontWeight: 700 }}>{hrs(job.labour.totalMs)}</span>
      </div>
      <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
        Crew hours across every apartment
        {job.span.elapsedMs >= MEANINGFUL_MS && ` · ${fmtDuration(job.span.elapsedMs)} since the job started`}
      </div>

      <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>Where the building is</div>
        <Line label="Units">
          <b>{job.units.packed}</b> packed <span className="muted">·</span> <b>{job.units.loaded}</b> loaded
          <span className="muted"> · {job.units.notStarted} not started, of {job.units.total}</span>
        </Line>
        <Line label="Packing hours">{hrs(job.labour.packingMs)}</Line>
        <Line label="Loading hours">{hrs(job.labour.loadingMs)}</Line>
      </div>

      <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>What a unit takes</div>
        <Line label="Packing"><Rate value={job.averages.packingMs.per} n={job.averages.packingMs.n} unit="time" /></Line>
        <Line label="Loading"><Rate value={job.averages.loadingMs.per} n={job.averages.loadingMs.n} unit="time" /></Line>
        <Line label="Pieces"><Rate value={job.averages.pieces.per} n={job.averages.pieces.n} /></Line>
        <Line label="Materials"><Rate value={job.averages.materials.per} n={job.averages.materials.n} /></Line>
        <Line label="Vaults"><Rate value={job.averages.vaults.per} n={job.averages.vaults.n} /></Line>
      </div>

      {(ahead.packingMs != null || ahead.loadingMs != null) && (
        <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>What is left, at this rate</div>
          {ahead.packingMs != null && (
            <Line label="Packing">
              {fmtDuration(ahead.packingMs)}
              <span className="muted"> of crew time, {ahead.remainingToPack} to go · from {ahead.packSample} unit{ahead.packSample === 1 ? '' : 's'}</span>
            </Line>
          )}
          {ahead.loadingMs != null && (
            <Line label="Loading">
              {fmtDuration(ahead.loadingMs)}
              <span className="muted"> of crew time, {ahead.remainingToLoad} to go · from {ahead.loadSample} unit{ahead.loadSample === 1 ? '' : 's'}</span>
            </Line>
          )}
          {ahead.materials != null && (
            <Line label="Materials">
              about {ahead.materials.toLocaleString()} more
              <span className="muted"> · from {ahead.materialSample} unit{ahead.materialSample === 1 ? '' : 's'}</span>
            </Line>
          )}
          {ahead.vaults != null && (
            <Line label="Vaults">
              about {ahead.vaults} more
              <span className="muted"> · from {ahead.vaultSample} unit{ahead.vaultSample === 1 ? '' : 's'}</span>
            </Line>
          )}
          <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
            {ahead.basedOn < 5
              ? 'A guess, not a forecast. Each line says how many finished units it rests on, and they get useful around five.'
              : 'Based on the units finished so far.'}
          </div>
        </div>
      )}

      {job.crew.length > 0 && (
        <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>Crew on the job</div>
          {job.crew.map((c) => (
            <div key={c.uid} style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '4px 0', fontSize: 13.5 }}>
              <span className="grow">
                {c.userName}
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {' · '}{c.units} unit{c.units === 1 ? '' : 's'}
                  {c.packingMs > 0 && ` · ${fmtDuration(c.packingMs)} packing`}
                  {c.loadingMs > 0 && ` · ${fmtDuration(c.loadingMs)} loading`}
                </span>
              </span>
              <b>{fmtDuration(c.totalMs)}</b>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>What has gone into the building</div>
        <Line label="Pieces">{job.totals.pieces.toLocaleString()}</Line>
        <Line label="Materials">
          {job.totals.materials.total > 0
            ? <>
                {job.totals.materials.total}
                <span className="muted"> · {job.totals.materials.lines.map((m) => `${m.count} ${m.label.toLowerCase()}`).join(', ')}</span>
              </>
            : <span className="muted">None recorded</span>}
        </Line>
        <Line label="Vaults">
          {job.totals.vaultsStarted > 0
            ? <>{job.totals.vaultsStarted} used <span className="muted">· {job.totals.vaultsComplete} fully logged</span></>
            : <span className="muted">None yet</span>}
        </Line>
        <Line label="Media">{job.totals.photos} photos, {job.totals.videos} videos</Line>
        {job.totals.mismatches > 0 && (
          <Line label="Mismatches">
            <b style={{ color: '#b91c1c' }}>{job.totals.mismatches}</b>
            <span className="muted"> across the job</span>
          </Line>
        )}
      </div>

      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowUnits((v) => !v)}>
          {showUnits ? 'Hide the unit list' : `Unit by unit (${touched.length} started)`}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={download}>⤓ Every unit as CSV</button>
      </div>

      {showUnits && (
        <div style={{ marginTop: 10, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--ink-3, #9aa1ab)' }}>
                <th style={{ padding: '6px 8px 6px 0', fontWeight: 600 }}>Unit</th>
                <th style={{ padding: '6px 8px', fontWeight: 600 }}>Packing</th>
                <th style={{ padding: '6px 8px', fontWeight: 600 }}>Loading</th>
                <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Pieces</th>
                <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right' }}>Materials</th>
                <th style={{ padding: '6px 0 6px 8px', fontWeight: 600, textAlign: 'right' }}>Vaults</th>
              </tr>
            </thead>
            <tbody>
              {touched.map((r) => (
                <tr
                  key={r.unit.id}
                  onClick={() => openUnit && openUnit(r.unit.id)}
                  style={{ borderTop: '1px solid var(--line)', cursor: openUnit ? 'pointer' : 'default' }}
                >
                  <td style={{ padding: '7px 8px 7px 0' }}>
                    <b>{r.unit.number}</b> <span className="muted">{surnameOf(r.unit.tenant)}</span>
                  </td>
                  <td style={{ padding: '7px 8px' }}>{hrs(r.packing.totalMs)}</td>
                  <td style={{ padding: '7px 8px' }}>{hrs(r.loading.totalMs)}</td>
                  <td style={{ padding: '7px 8px', textAlign: 'right' }}>{r.inventory.pieces ?? '—'}</td>
                  <td style={{ padding: '7px 8px', textAlign: 'right' }}>{r.materials.total || '—'}</td>
                  <td style={{ padding: '7px 0 7px 8px', textAlign: 'right' }}>{r.vaults.started || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {touched.length === 0 && (
            <div className="muted" style={{ fontSize: 13, padding: '8px 0' }}>Nothing started yet.</div>
          )}
        </div>
      )}
    </div>
  )
}
