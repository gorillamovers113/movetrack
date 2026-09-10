import React, { useEffect, useState } from 'react'
import { useStore, fmtTime } from '../store.jsx'
import { fmtDuration } from '../lib/reports.js'
import { unitSummary } from '../lib/unitSummary.js'

/* The job card for one apartment: what it took, who did it, what went into it.
 *
 * Hours are admin only, and not by preference. A crew member can only read
 * their own unitSessions, so for anybody else the per-person breakdown would
 * render as a row of zeroes beside real names, which is worse than not showing
 * it. Everything that is not hours is visible to viewers as well.
 */

// fmtTime already carries the date.
const stamp = (ts) => (ts ? fmtTime(ts) : '—')

// Under a minute is noise, not a measurement, and "0m start to finish" beside
// an hour of crew time reads as a bug rather than a short gap.
const MEANINGFUL_MS = 60000

function Line({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '4px 0', fontSize: 13.5 }}>
      <span className="muted" style={{ flex: 'none', minWidth: 104 }}>{label}</span>
      <span style={{ minWidth: 0, flex: 1 }}>{children}</span>
    </div>
  )
}

function Phase({ title, phase, showHours, endLabel }) {
  if (!phase.startedAt && phase.people.length === 0) {
    return (
      <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>{title}</div>
        <div className="muted" style={{ fontSize: 13 }}>Not started.</div>
      </div>
    )
  }
  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <div className="row" style={{ marginBottom: 2 }}>
        <span className="grow" style={{ fontWeight: 700, fontSize: 13.5 }}>{title}</span>
        {showHours && phase.totalMs > 0 && <b style={{ fontSize: 13.5 }}>{fmtDuration(phase.totalMs)}</b>}
      </div>
      <Line label="Started">{stamp(phase.startedAt)}</Line>
      <Line label={endLabel}>{stamp(phase.finishedAt || phase.lastActivityAt)}</Line>
      {phase.elapsedMs >= MEANINGFUL_MS && (
        <Line label="On the clock">
          {fmtDuration(phase.elapsedMs)} <span className="muted">start to finish</span>
        </Line>
      )}
      {showHours && phase.people.map((p) => (
        <Line key={p.uid} label="">
          <span style={{ display: 'flex', gap: 8 }}>
            <span className="grow">{p.userName}{p.open && <span className="muted"> · still on it</span>}</span>
            <b>{fmtDuration(p.ms)}</b>
          </span>
        </Line>
      ))}
      {showHours && phase.people.length === 0 && phase.startedAt && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
          No unit time recorded. The crew logged the work but were not checked into the unit.
        </div>
      )}
    </div>
  )
}

export default function UnitSummaryCard({ unit }) {
  const { state, currentUser } = useStore()
  const [now, setNow] = useState(() => Date.now())

  // Somebody may be on this unit right now; a frozen total would read as done.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  if (!currentUser || !['admin', 'viewer'].includes(currentUser.role)) return null

  const showHours = currentUser.role === 'admin'
  const s = unitSummary({
    unit, sessions: state.unitSessions, users: state.users, timeEntries: state.timeEntries, now,
  })
  const names = (list) => (list.length ? list.map((p) => p.name).join(', ') : null)

  return (
    <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
      <div className="row" style={{ marginBottom: 4 }}>
        <div className="section-title grow" style={{ margin: 0 }}>The job on this unit</div>
        {showHours && s.totals.labourMs > 0 && (
          <span style={{ fontWeight: 700 }}>{fmtDuration(s.totals.labourMs)}</span>
        )}
      </div>
      {showHours && s.totals.labourMs > 0 && (
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 6 }}>
          Crew hours, everyone added together
          {s.totals.elapsedMs >= MEANINGFUL_MS && ` · ${fmtDuration(s.totals.elapsedMs)} from first touch to last`}
        </div>
      )}

      <Phase title="Packing" phase={s.packing} showHours={showHours} endLabel="Finished" />
      <Phase
        title="Loading" phase={s.loading} showHours={showHours}
        endLabel={s.loading.finishedAt ? 'Finished' : 'Last activity'}
      />

      <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>Crew</div>
        <Line label="Packers">{names(s.crew.packers) || <span className="muted">None yet</span>}</Line>
        <Line label="Movers">{names(s.crew.movers) || <span className="muted">None yet</span>}</Line>
      </div>

      <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2 }}>What went into it</div>
        <Line label="Pieces">
          {s.inventory.pieces != null ? s.inventory.pieces : <span className="muted">Not counted yet</span>}
          {s.inventory.range && <span className="muted"> · stickers #{s.inventory.range}</span>}
          {s.inventory.stickerColor && <span className="muted"> · {s.inventory.stickerColor}</span>}
        </Line>
        <Line label="Cartons">
          {s.materials.cartons > 0
            ? <>{s.materials.cartons} <span className="muted">· {s.materials.cartonSummary}</span></>
            : <span className="muted">None recorded</span>}
        </Line>
        <Line label="Materials">
          {s.materials.supplies > 0
            ? <>{s.materials.supplies} <span className="muted">· {s.materials.supplySummary}</span></>
            : <span className="muted">None recorded</span>}
        </Line>
        <Line label="Vaults">
          {s.vaults.started > 0
            ? <>
                {s.vaults.complete} of {s.vaults.started} finished
                <span className="muted"> · {s.vaults.numbers.join(', ')}</span>
              </>
            : <span className="muted">None yet</span>}
        </Line>
        <Line label="Media">
          {s.media.photos + s.media.videos > 0
            ? `${s.media.photos} photo${s.media.photos === 1 ? '' : 's'}, ${s.media.videos} video${s.media.videos === 1 ? '' : 's'}`
            : <span className="muted">None yet</span>}
        </Line>
      </div>

      {s.mismatches.length > 0 && (
        <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)' }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 2, color: '#b91c1c' }}>
            Did not match the packer's record
          </div>
          {s.mismatches.map((m) => (
            <Line key={m.key} label={m.label}>
              entered “{String(m.value)}”
              <span className="muted"> · {m.by || 'Crew'}{m.at ? ` · ${stamp(m.at)}` : ''}</span>
            </Line>
          ))}
        </div>
      )}

      {!showHours && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
          Crew hours are on the admin view.
        </div>
      )}
    </div>
  )
}
