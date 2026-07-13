import React, { useState } from 'react'
import { StoreProvider, useStore } from './store.jsx'
import { ROLES } from './seed.js'
import { Avatar, Toast, GorillaMark, GorillaWordmark } from './ui.jsx'
import Login from './Login.jsx'
import Dashboard from './views/Dashboard.jsx'
import UnitDetail from './views/UnitDetail.jsx'
import Containers from './views/Containers.jsx'
import Team from './views/Team.jsx'
import Activity from './views/Activity.jsx'
import MyWork from './views/MyWork.jsx'

const NAV = {
  admin: [['dashboard', '▦', 'Dashboard'], ['containers', '📦', 'Containers'], ['team', '👥', 'Team'], ['activity', '🕘', 'Activity']],
  packer: [['mywork', '✓', 'My queue'], ['dashboard', '▦', 'Dashboard'], ['activity', '🕘', 'Activity']],
  mover: [['mywork', '✓', 'My queue'], ['dashboard', '▦', 'Dashboard'], ['containers', '📦', 'Containers'], ['activity', '🕘', 'Activity']],
  driver: [['mywork', '✓', 'My queue'], ['containers', '📦', 'Containers'], ['dashboard', '▦', 'Dashboard'], ['activity', '🕘', 'Activity']],
  viewer: [['dashboard', '▦', 'Dashboard'], ['containers', '📦', 'Containers'], ['activity', '🕘', 'Activity']],
}

function PendingScreen() {
  const { currentUser, logout } = useStore()
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div className="card" style={{ maxWidth: 430, padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>⏳</div>
        <h2 style={{ fontFamily: 'var(--display)', marginBottom: 8 }}>Hi {currentUser.name.split(' ')[0]} — you're almost in</h2>
        <p style={{ color: 'var(--ink-2)', marginBottom: 18 }}>Your account is waiting for the admin to approve it and assign your role. Nothing in this project moves without a name attached — including access.</p>
        <button className="btn btn-ghost" onClick={logout}>← Back to sign in</button>
      </div>
    </div>
  )
}

function Shell() {
  const { state, currentUser, logout } = useStore()
  const first = NAV[currentUser.role][0][0]
  const [view, setView] = useState({ name: first })
  const [toastMsg, setToastMsg] = useState(null)

  const toast = (msg) => {
    setToastMsg(msg)
    clearTimeout(toast._t)
    toast._t = setTimeout(() => setToastMsg(null), 2600)
  }

  const openUnit = (unitId) => setView((v) => ({ name: 'unit', unitId, back: v.name === 'unit' ? v.back : v }))
  const openContainer = (containerId) => setView({ name: 'containers', focusId: containerId })
  const nav = NAV[currentUser.role]
  const pendingCount = state.users.filter((u) => u.status === 'pending').length

  const page = () => {
    switch (view.name) {
      case 'dashboard': return <Dashboard openUnit={openUnit} />
      case 'unit': return <UnitDetail unitId={view.unitId} goBack={() => setView(view.back || { name: first })} openContainer={openContainer} toast={toast} />
      case 'containers': return <Containers openUnit={openUnit} focusId={view.focusId} clearFocus={() => setView((v) => ({ ...v, focusId: null }))} toast={toast} />
      case 'team': return <Team toast={toast} />
      case 'activity': return <Activity openUnit={openUnit} openContainer={openContainer} />
      case 'mywork': return <MyWork openUnit={openUnit} openContainer={openContainer} />
      default: return null
    }
  }

  const NavButtons = ({ mobile }) => nav.map(([key, ico, label]) => (
    <button key={key} className={view.name === key ? 'on' : ''} onClick={() => setView({ name: key })}>
      <span className="ico">{ico}</span>{mobile ? <span>{label}</span> : label}
      {!mobile && key === 'team' && pendingCount > 0 && <span className="count">{pendingCount}</span>}
    </button>
  ))

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <GorillaWordmark width={176} ink="#ffffff" highlight="#15181d" />
          <div className="logo-sub" style={{ textAlign: 'center' }}>MoveTrack — project command center</div>
        </div>
        <div className="project-chip">
          <b>{state.project.name}</b>
          <span>{state.project.address}</span>
        </div>
        <nav className="nav"><NavButtons /></nav>
        <div className="side-user">
          <Avatar name={currentUser.name} size="sm" />
          <div className="who">
            <b>{currentUser.name}</b>
            <span>{ROLES[currentUser.role].label}</span>
          </div>
          <button className="out" onClick={logout}>Sign out</button>
        </div>
      </aside>

      <div className="grow" style={{ minWidth: 0 }}>
        <div className="topbar-mobile">
          <GorillaMark height={26} body="#ffffff" highlight="#15181d" />
          <b style={{ fontFamily: 'var(--display)' }}>Gorilla Movers</b>
          <span className="grow" />
          <Avatar name={currentUser.name} size="sm" />
          <button style={{ color: '#a6aebb', fontSize: 12, fontWeight: 600 }} onClick={logout}>Sign out</button>
        </div>
        <main className="main">
          {page()}
          <div className="brandfoot">MoveTrack — a Gorilla Movers platform · every action logged with name, date &amp; time</div>
        </main>
      </div>

      <nav className="bottom-nav"><NavButtons mobile /></nav>
      <Toast msg={toastMsg} />
    </div>
  )
}

function Gate() {
  const { currentUser } = useStore()
  if (!currentUser) return <Login />
  if (currentUser.status === 'pending') return <PendingScreen />
  return <Shell />
}

export default function App() {
  return (
    <StoreProvider>
      <Gate />
    </StoreProvider>
  )
}
