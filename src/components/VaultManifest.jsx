import React from 'react'
import { vaultsByUnit, vaultPhotoLabel } from '../lib/vaultExport.js'

/* The vault sheet as a document, for sending to BigBox or putting in a folder.
 *
 * Designed for ink, not for a screen. Browsers print with background colours
 * switched OFF by default, so a dark brand band would come out as white text
 * on white paper and the whole header would vanish. Everything here carries
 * its weight in text colour, borders and rules, which print either way. That
 * constraint is why it uses the dark wordmark on white rather than the
 * reversed one, and why the amber shows up as rules rather than fills.
 *
 * The number plates are the point. Every vault in the yard wears a printed
 * label on its door, white card with heavy black digits, and that is what the
 * crew and the warehouse both read a vault by. Setting the numbers the same
 * way groups an apartment's vaults into something you can check against the
 * doors without translating anything, which is how the "Asdoi" split got
 * caught: three plates under one name, two names on their sheet.
 */
export default function VaultManifest({ rows, stats, project, statusLabel, generatedBy, generatedAt = new Date() }) {
  const byUnit = vaultsByUnit(rows)
  const when = generatedAt.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="manifest">
      <header className="manifest-head">
        <img className="manifest-logo" src="gm-logo-dark.png" alt="Gorilla Movers" />
        <div className="manifest-title">
          <h1>Vault manifest</h1>
          <p>{project?.name || 'Trinity Manor'} · {project?.address || '3940 Park Blvd'}</p>
        </div>
        <div className="manifest-meta">
          <span>{when}</span>
          {generatedBy && <span>{generatedBy}</span>}
        </div>
      </header>

      <div className="manifest-stats">
        <span><b>{stats.vaults}</b> vaults</span>
        <span><b>{stats.inUse}</b> in use</span>
        <span><b>{stats.empty}</b> empty</span>
        <span><b>{stats.units}</b> apartments</span>
        {stats.spread > 0 && <span><b>{stats.spread}</b> across more than one vault</span>}
        {stats.perUnit != null && <span><b>{stats.perUnit}</b> vaults per apartment</span>}
      </div>

      <h2 className="manifest-h2">By apartment</h2>
      <div className="manifest-units">
        {byUnit.map((g) => (
          <div className="manifest-unit" key={g.id}>
            <div className="mu-who">
              <b>Unit {g.number}</b>
              <span>{g.tenant || '-'}</span>
            </div>
            <div className="mu-plates">
              {g.vaults.map((v) => (
                <span key={v.number} className={v.complete ? 'plate' : 'plate plate-gap'}>{v.number}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {byUnit.some((g) => g.vaults.some((v) => !v.complete)) && (
        <p className="manifest-legend">A dashed plate is a vault whose photo record is incomplete. Detail below.</p>
      )}

      <h2 className="manifest-h2">Every vault</h2>
      <table className="manifest-tbl">
        <thead>
          <tr><th>Vault</th><th>Unit</th><th>Customer</th><th>Of</th><th>Status</th><th>Photos</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="mt-num">{r.number}</td>
              <td>{r.on.map((x) => x.unit.number).join(', ') || '-'}</td>
              <td>{r.on.length ? r.on.map((x) => x.unit.tenant || '-').join(', ') : 'Empty'}</td>
              <td>{r.on.map((x) => (x.pos ? `${x.pos.nth} of ${x.pos.of}` : '')).filter(Boolean).join(', ') || '-'}</td>
              <td>{statusLabel(r.status)}</td>
              <td className={r.on.length && !r.complete ? 'mt-gap' : ''}>{vaultPhotoLabel(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer className="manifest-foot">
        <img src="favicon.png" alt="" className="manifest-mark" />
        <span>MoveTrack · a Gorilla Movers platform · every vault logged with name, date and time</span>
      </footer>
    </div>
  )
}
