/* The starting page: which job are you on today?
 *
 * Casey, 2026-10-22: "both trinity mannor and studio 15 should not be on the
 * same page. the user would click on one or the other at the starting page."
 *
 * Two jobs now, more later, and they have nothing to do with each other
 * beyond sharing the crew. Mixing both boards into one nav would mean a
 * packer at Studio 15 scrolling past Vaults and Overflow, which belong to a
 * finished building across town.
 *
 * The choice is remembered, because a packer working Studio 15 all week
 * should not pick it every morning. The chip in the sidebar is the way back.
 */
import React from 'react'
import { useStore } from './store.jsx'
import { allowedProjects } from './lib/projectAccess.js'
import { GorillaWordmark } from './ui.jsx'

export const PROJECTS = [
  {
    key: 'trinity',
    name: 'Trinity Manor',
    address: '3940 Park Blvd',
    blurb: '50-unit relocation, out to BigBox storage',
    accent: '#c05b3a',
  },
  {
    key: 'studio15',
    name: 'Studio 15',
    address: '1475 Imperial Ave',
    blurb: '275 units, moving within the building',
    accent: '#23409f',
  },
]

export const PROJECT_KEY = 'mt_project'

export default function ProjectPicker({ onPick }) {
  const { currentUser, logout } = useStore()
  const allowed = allowedProjects(currentUser)
  const mine = PROJECTS.filter((p) => allowed.includes(p.key))

  /* Casey can set somebody to no jobs at all. They are a real, approved
     member of the crew who simply is not on anything today, so this says
     that rather than showing an empty page or bouncing them to the login. */
  if (!mine.length) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
        <div className="card" style={{ maxWidth: 420, padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 38, marginBottom: 10 }}>🔑</div>
          <h2 style={{ margin: '0 0 8px' }}>No jobs assigned yet</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            You are signed in, but Casey has not put you on a project. Ask him to add you.
          </p>
          <button className="btn" onClick={logout} style={{ marginTop: 14 }}>Sign out</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 680 }}>
        <div style={{ textAlign: 'center', marginBottom: 6 }}>
          <GorillaWordmark width={210} onDark={false} />
        </div>
        <div className="muted" style={{ textAlign: 'center', marginBottom: 26, letterSpacing: '.04em' }}>
          MOVETRACK · PROJECT COMMAND CENTER
        </div>

        <h1 style={{ textAlign: 'center', margin: '0 0 4px', fontSize: 25 }}>
          Which job today{currentUser && currentUser.name ? `, ${String(currentUser.name).split(' ')[0]}` : ''}?
        </h1>
        <p className="muted" style={{ textAlign: 'center', marginTop: 0, marginBottom: 24 }}>
          Pick one. You can switch any time from the sidebar.
        </p>

        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {mine.map((p) => (
            <button
              key={p.key}
              className="card"
              onClick={() => onPick(p.key)}
              style={{
                textAlign: 'left', padding: 22, cursor: 'pointer', borderRadius: 14,
                borderLeft: `6px solid ${p.accent}`, minHeight: 150,
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 750, letterSpacing: '-.02em' }}>{p.name}</div>
              <div className="muted" style={{ marginTop: 3, fontSize: 13 }}>{p.address}</div>
              <div style={{ marginTop: 12, fontSize: 13.5, lineHeight: 1.45 }}>{p.blurb}</div>
              <div style={{ marginTop: 14, fontWeight: 650, color: p.accent, fontSize: 14 }}>Open →</div>
            </button>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: 26 }}>
          <button className="btn btn-sm" onClick={logout}>Sign out</button>
        </div>
      </div>
    </div>
  )
}
