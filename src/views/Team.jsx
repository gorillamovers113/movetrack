import React, { useState } from 'react'
import { ROLES } from '../seed.js'
import { useStore, fmtTime, fmtAgo } from '../store.jsx'
import { Avatar, Modal } from '../ui.jsx'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'

export default function Team({ toast }) {
  const { state, dispatch, currentUser } = useStore()
  const [approving, setApproving] = useState(null)
  const [role, setRole] = useState('packer')
  const [busy, setBusy] = useState(false)
  // Per-user busy set so a double-tap on deny/change-role/remove (each
  // rendered once per row) can't fire the same write twice.
  const [busyIds, setBusyIds] = useState(() => new Set())
  const SAVE_ERROR = "Couldn't save that. Check your signal and try again."

  // driver is a legacy role with no action anywhere in canAct/containerAction/
  // overflowAction: filtered out here so admins can't newly assign a dead
  // login. Existing driver users, if any, are left untouched.
  const ASSIGNABLE = Object.entries(ROLES).filter(([k]) => k !== 'admin' && k !== 'driver')
  const pending = state.users.filter((u) => u.status === 'pending')
  const active = state.users.filter((u) => u.status === 'active')
  const actionCount = (uid) => state.events.filter((e) => e.uid === uid).length
  const isAdmin = currentUser?.role === 'admin'

  const withUserBusy = async (userId, fn) => {
    if (busyIds.has(userId)) return
    setBusyIds((s) => new Set(s).add(userId))
    try {
      await fn()
    } catch (err) {
      toast(err.message || SAVE_ERROR)
    } finally {
      setBusyIds((s) => { const n = new Set(s); n.delete(userId); return n })
    }
  }

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
                  <button className="btn btn-primary btn-sm" disabled={busyIds.has(u.id)} onClick={() => { setRole('packer'); setApproving(u) }}>Approve…</button>
                  <button className="btn btn-danger btn-sm" disabled={busyIds.has(u.id)} onClick={() => withUserBusy(u.id, async () => {
                    const status = await submitWrite(dispatch({ type: 'denyUser', p: { userId: u.id, byId: currentUser.uid } }))
                    toast(status === 'queued' ? QUEUED_MESSAGE : `${u.name} denied`)
                  })}>{busyIds.has(u.id) ? 'Working…' : 'Deny'}</button>
                </>
              ) : <span className="badge" style={{ background: '#fffbeb', color: '#92400e' }}>Pending admin review</span>}
            </div>
          ))}
        </>
      )}

      <div className="section-title">Active roster · {active.length}</div>
      <div className="card">
        <div className="table-scroll">
          <table className="tbl">
            <thead><tr><th>Member</th><th>Role</th><th>Actions logged</th><th>Email</th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {active.map((u) => (
                <tr key={u.id}>
                  <td><div className="row"><Avatar name={u.name} size="sm" /><div><b>{u.name}</b>{u.title && <div className="muted">{u.title}</div>}</div></div></td>
                  <td>
                    {isAdmin && u.id !== currentUser.uid ? (
                      <select className="input" style={{ width: 'auto', padding: '5px 9px', fontSize: 13 }} value={u.role} disabled={busyIds.has(u.id)}
                        onChange={(e) => { const nextRole = e.target.value; withUserBusy(u.id, async () => {
                          const status = await submitWrite(dispatch({ type: 'changeRole', p: { userId: u.id, role: nextRole, byId: currentUser.uid } }))
                          toast(status === 'queued' ? QUEUED_MESSAGE : `${u.name} → ${ROLES[nextRole].label}`)
                        }) }}>
                        {ASSIGNABLE.map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
                      </select>
                    ) : (
                      <span className="badge" style={{ background: (ROLES[u.role]?.color || '#8a93a2') + '22', color: ROLES[u.role]?.color || '#8a93a2' }}>{ROLES[u.role]?.label || u.role}</span>
                    )}
                  </td>
                  <td><b>{actionCount(u.id)}</b></td>
                  <td className="muted">{u.email}</td>
                  {isAdmin && (
                    <td>
                      {u.id !== currentUser.uid && (
                        <button className="btn btn-danger btn-sm" disabled={busyIds.has(u.id)} onClick={() => {
                          if (confirm(`Remove ${u.name}'s access? They'll lose access to the board on next load.`)) {
                            withUserBusy(u.id, async () => {
                              const status = await submitWrite(dispatch({ type: 'removeUser', p: { userId: u.id, byId: currentUser.uid } }))
                              toast(status === 'queued' ? QUEUED_MESSAGE : `${u.name} removed`)
                            })
                          }
                        }}>{busyIds.has(u.id) ? 'Working…' : 'Remove'}</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {approving && (
        <Modal title={`Approve ${approving.name}`} sub="Pick the role — it controls exactly what they can see and do." onClose={() => { if (!busy) setApproving(null) }}>
          <div className="field">
            <label>Role</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              {ASSIGNABLE.map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
            </select>
            <div className="muted" style={{ marginTop: 6 }}>There is exactly one admin on this project: you.</div>
          </div>
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy} onClick={async () => {
            setBusy(true)
            try {
              const status = await submitWrite(dispatch({ type: 'approveUser', p: { userId: approving.id, role, byId: currentUser.uid } }))
              toast(status === 'queued' ? QUEUED_MESSAGE : `${approving.name} approved as ${ROLES[role].label} ✓`)
              setApproving(null)
            } catch (err) {
              toast(err.message || SAVE_ERROR)
            } finally {
              setBusy(false)
            }
          }}>{busy ? 'Working…' : 'Approve & activate'}</button>
        </Modal>
      )}
    </>
  )
}
