import React, { useState } from 'react'
import { ROLES } from '../seed.js'
import { useStore, fmtTime, fmtAgo } from '../store.jsx'
import { Avatar, Modal } from '../ui.jsx'

export default function Team({ toast }) {
  const { state, dispatch, currentUser } = useStore()
  const [approving, setApproving] = useState(null)
  const [role, setRole] = useState('packer')

  const ASSIGNABLE = Object.entries(ROLES).filter(([k]) => k !== 'admin')
  const pending = state.users.filter((u) => u.status === 'pending')
  const active = state.users.filter((u) => u.status === 'active')
  const actionCount = (uid) => state.events.filter((e) => e.uid === uid).length
  const isAdmin = currentUser?.role === 'admin'

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Team</h1>
          <p>Everyone with access — every action is logged under their name. Records are permanent; only the admin can amend anything.</p>
        </div>
      </div>

      {pending.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 0 }}>Awaiting approval</div>
          {pending.map((u) => (
            <div className="card row" key={u.id} style={{ padding: '14px 18px', marginBottom: 10 }}>
              <Avatar name={u.name} />
              <div className="grow">
                <b>{u.name}</b> <span className="muted">{u.email}{u.via === 'google' ? ' · via Google' : ''}</span>
                <div className="muted">Requested {u.requestedAt ? fmtAgo(u.requestedAt) : 'recently'}</div>
              </div>
              {isAdmin ? (
                <>
                  <button className="btn btn-primary btn-sm" onClick={() => { setRole('packer'); setApproving(u) }}>Approve…</button>
                  <button className="btn btn-danger btn-sm" onClick={() => { dispatch({ type: 'denyUser', p: { userId: u.id, byId: currentUser.uid } }); toast(`${u.name} denied`) }}>Deny</button>
                </>
              ) : <span className="badge" style={{ background: '#fffbeb', color: '#92400e' }}>Pending admin review</span>}
            </div>
          ))}
        </>
      )}

      <div className="section-title">Active roster · {active.length}</div>
      <div className="card">
        <table className="tbl">
          <thead><tr><th>Member</th><th>Role</th><th>Actions logged</th><th>Email</th>{isAdmin && <th></th>}</tr></thead>
          <tbody>
            {active.map((u) => (
              <tr key={u.id}>
                <td><div className="row"><Avatar name={u.name} size="sm" /><div><b>{u.name}</b>{u.title && <div className="muted">{u.title}</div>}</div></div></td>
                <td>
                  {isAdmin && u.id !== currentUser.uid ? (
                    <select className="input" style={{ width: 'auto', padding: '5px 9px', fontSize: 13 }} value={u.role}
                      onChange={(e) => { dispatch({ type: 'changeRole', p: { userId: u.id, role: e.target.value, byId: currentUser.uid } }); toast(`${u.name} → ${ROLES[e.target.value].label}`) }}>
                      {ASSIGNABLE.map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
                    </select>
                  ) : (
                    <span className="badge" style={{ background: ROLES[u.role].color + '22', color: ROLES[u.role].color }}>{ROLES[u.role].label}</span>
                  )}
                </td>
                <td><b>{actionCount(u.id)}</b></td>
                <td className="muted">{u.email}</td>
                {isAdmin && (
                  <td>
                    {u.id !== currentUser.uid && (
                      <button className="btn btn-danger btn-sm" onClick={() => {
                        if (confirm(`Remove ${u.name}'s access? They'll lose access to the board on next load.`)) {
                          dispatch({ type: 'removeUser', p: { userId: u.id, byId: currentUser.uid } })
                          toast(`${u.name} removed`)
                        }
                      }}>Remove</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {approving && (
        <Modal title={`Approve ${approving.name}`} sub="Pick the role — it controls exactly what they can see and do." onClose={() => setApproving(null)}>
          <div className="field">
            <label>Role</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              {ASSIGNABLE.map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
            </select>
            <div className="muted" style={{ marginTop: 6 }}>There is exactly one admin on this project: you.</div>
          </div>
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={() => {
            dispatch({ type: 'approveUser', p: { userId: approving.id, role, byId: currentUser.uid } })
            toast(`${approving.name} approved as ${ROLES[role].label} ✓`)
            setApproving(null)
          }}>Approve & activate</button>
        </Modal>
      )}
    </>
  )
}
