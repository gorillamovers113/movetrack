import React, { useMemo, useState } from 'react'
import { ROLES } from '../seed.js'
import { useStore, fmtTime, fmtAgo } from '../store.jsx'
import { Avatar, EventRow, Lightbox } from '../ui.jsx'
import { computeAllReports, summarizeRoster, fmtDuration, reportsToCSV } from '../lib/reports.js'

// Small download helper mirroring the pattern in store.jsx's
// exportActivityCSV, kept here since Reports is pure read-only analytics
// and shouldn't need a store.jsx change to ship.
function downloadCSV(text, filename) {
  const blob = new Blob([text], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

const SORTS = [
  ['totalActions', 'Total actions'],
  ['unitsPackedCount', 'Units packed'],
  ['unitsLoadedCount', 'Units loaded'],
  ['piecesHandled', 'Pieces handled'],
  ['packTimeMs', 'Packing time'],
  ['mediaSubmitted', 'Photos & video'],
]

function Stat({ n, l }) {
  return (
    <div>
      <div className="n" style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{n}</div>
      <div className="l" style={{ fontSize: 11.5, color: 'var(--ink-3)', fontWeight: 500, marginTop: 2 }}>{l}</div>
    </div>
  )
}

function UserDetail({ r, events, openUnit, openContainer }) {
  const [lightbox, setLightbox] = useState(null)
  const recent = useMemo(
    () => events.filter((e) => e.uid === r.uid).sort((a, b) => b.ts - a.ts).slice(0, 25),
    [events, r.uid]
  )
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: '16px 18px', background: 'var(--bg-2, transparent)' }}>
      <div className="kpis" style={{ marginBottom: 16 }}>
        <div className="card kpi"><Stat n={r.piecesPacked.toLocaleString()} l="Pieces packed" /></div>
        <div className="card kpi"><Stat n={r.piecesLoaded.toLocaleString()} l="Pieces loaded" /></div>
        <div className="card kpi"><Stat n={fmtDuration(r.avgPackTimeMs)} l="Avg packing time / unit" /></div>
        <div className="card kpi"><Stat n={r.activeDays} l="Active days" /></div>
      </div>

      <div className="section-title" style={{ marginTop: 0 }}>Custody & handling</div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 18, marginBottom: 16 }}>
        <span className="muted">Overflow prepped <b style={{ color: 'var(--ink)' }}>{r.overflowPrepped}</b></span>
        <span className="muted">Overflow transported <b style={{ color: 'var(--ink)' }}>{r.overflowTransported}</b></span>
        <span className="muted">Overflow received <b style={{ color: 'var(--ink)' }}>{r.overflowReceived}</b></span>
        <span className="muted">Containers handed off <b style={{ color: 'var(--ink)' }}>{r.containersHandedOff}</b></span>
        <span className="muted">Containers received <b style={{ color: 'var(--ink)' }}>{r.containersReceived}</b></span>
      </div>

      <div className="section-title">Actions by type</div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 18, marginBottom: 16 }}>
        <span className="muted">Stage moves <b style={{ color: 'var(--ink)' }}>{r.actionTypes.stage}</b></span>
        <span className="muted">Photos/video <b style={{ color: 'var(--ink)' }}>{r.actionTypes.media}</b></span>
        <span className="muted">Notes <b style={{ color: 'var(--ink)' }}>{r.actionTypes.note}</b></span>
        <span className="muted">Flags <b style={{ color: 'var(--ink)' }}>{r.actionTypes.flag}</b></span>
        <span className="muted">Admin/system <b style={{ color: 'var(--ink)' }}>{r.actionTypes.system}</b></span>
      </div>

      <div className="muted" style={{ marginBottom: 14 }}>
        {r.firstActivityTs
          ? <>First action {fmtTime(r.firstActivityTs)} · Last action {fmtTime(r.lastActivityTs)} ({fmtAgo(r.lastActivityTs)})</>
          : 'No activity logged yet.'}
      </div>

      <div className="section-title">Recent actions</div>
      {recent.length === 0
        ? <div className="muted" style={{ padding: '10px 0' }}>No actions logged yet.</div>
        : recent.map((e) => <EventRow key={e.id} e={e} onOpenMedia={setLightbox} linkUnit={openUnit} linkContainer={openContainer} />)}

      <Lightbox media={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}

export default function Reports({ openUnit, openContainer }) {
  const { state } = useStore()
  const [sortBy, setSortBy] = useState('totalActions')
  const [expanded, setExpanded] = useState(null)

  const reports = useMemo(() => computeAllReports(state, state.users), [state])
  const sorted = useMemo(() => [...reports].sort((a, b) => (b[sortBy] || 0) - (a[sortBy] || 0)), [reports, sortBy])
  const summary = useMemo(() => summarizeRoster(reports), [reports])

  const noActivity = state.events.length === 0

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p>Per-person productivity, computed live from the activity log. Packing time is time spent packing only, not total time on site.</p>
        </div>
        <button
          className="btn btn-dark"
          disabled={reports.length === 0}
          onClick={() => downloadCSV(reportsToCSV(sorted), `movetrack-reports-${new Date().toISOString().slice(0, 10)}.csv`)}
        >⬇ Export CSV</button>
      </div>

      {reports.length === 0 ? (
        <div className="card"><div className="empty"><div className="big">📊</div>No team members yet. Reports will fill in once the roster is active.</div></div>
      ) : noActivity ? (
        <div className="card"><div className="empty"><div className="big">📊</div>No activity logged yet. Reports will fill in as the crew starts packing, loading & moving units.</div></div>
      ) : (
        <>
          <div className="kpis">
            <div className="card kpi"><Stat n={summary.people} l="Team members" /></div>
            <div className="card kpi"><Stat n={summary.totalActions.toLocaleString()} l="Total actions" /></div>
            <div className="card kpi"><Stat n={summary.piecesHandled.toLocaleString()} l="Pieces handled" /></div>
            <div className="card kpi"><Stat n={summary.mediaSubmitted.toLocaleString()} l="Photos & video" /></div>
          </div>

          <div className="row" style={{ marginBottom: 12, gap: 10 }}>
            <span className="muted">Sort by</span>
            <select className="input" style={{ width: 'auto' }} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>

          <div className="card">
            {sorted.map((r, i) => {
              const isOpen = expanded === r.uid
              return (
                <div key={r.uid} style={{ borderBottom: i < sorted.length - 1 || isOpen ? '1px solid var(--line)' : 'none' }}>
                  <div
                    className="row"
                    role="button"
                    tabIndex={0}
                    style={{ padding: '14px 18px', cursor: 'pointer', minHeight: 44, flexWrap: 'wrap', gap: 14 }}
                    onClick={() => setExpanded(isOpen ? null : r.uid)}
                  >
                    <Avatar name={r.name} />
                    <div style={{ minWidth: 140 }}>
                      <b>{r.name}</b>
                      <div>
                        <span className="badge" style={{ background: (ROLES[r.role]?.color || '#8a93a2') + '22', color: ROLES[r.role]?.color || '#8a93a2' }}>
                          {ROLES[r.role]?.label || 'Unknown role'}
                        </span>
                      </div>
                    </div>
                    <div className="grow" style={{ display: 'flex', flexWrap: 'wrap', gap: 22, justifyContent: 'flex-end' }}>
                      <Stat n={r.unitsPackedCount} l="Units packed" />
                      <Stat n={r.unitsLoadedCount} l="Units loaded" />
                      <Stat n={r.piecesHandled.toLocaleString()} l="Pieces handled" />
                      <Stat n={r.mediaSubmitted} l="Photos & video" />
                      <Stat n={fmtDuration(r.packTimeMs)} l="Packing time" />
                      <Stat n={r.totalActions} l="Total actions" />
                    </div>
                    <span className="muted" style={{ fontSize: 16 }}>{isOpen ? '▲' : '▼'}</span>
                  </div>
                  {isOpen && <UserDetail r={r} events={state.events} openUnit={openUnit} openContainer={openContainer} />}
                </div>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
