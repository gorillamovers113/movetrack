import React, { useEffect, useState } from 'react'
import { StoreProvider, useStore } from './store.jsx'
import { ROLES } from './seed.js'
import { Avatar, Toast, GorillaMark, GorillaWordmark } from './ui.jsx'
import Login from './Login.jsx'
import Dashboard from './views/Dashboard.jsx'
import UnitDetail from './views/UnitDetail.jsx'
import Containers from './views/Containers.jsx'
import Overflow from './views/Overflow.jsx'
import Team from './views/Team.jsx'
import Activity from './views/Activity.jsx'
import MyWork from './views/MyWork.jsx'
import Schedule from './views/Schedule.jsx'
import Reports from './views/Reports.jsx'
import Timesheets from './views/Timesheets.jsx'
import Access from './views/Access.jsx'
import Studio15 from './s15/Studio15.jsx'
import S15BuildingView from './s15/S15BuildingView.jsx'
import ProjectPicker, { PROJECTS, PROJECT_KEY } from './ProjectPicker.jsx'
import { allowedProjects } from './lib/projectAccess.js'
import WelcomeStart, { shouldAskStart } from './WelcomeStart.jsx'
import UpdateBar from './components/UpdateBar.jsx'
import { recordSession } from './lib/telemetry.js'

// Packers reach Overflow via the "＋ Report overflow item" button on a unit,
// so it's left out of their nav to keep it lean (same reasoning as omitting
// Containers from theirs). Everyone else who touches the overflow lifecycle
// (or just needs to see it) gets it in the nav. Schedule is for every role
// (read-only for non-admins) since the crew needs to know today's floor.
const NAV_TRINITY = {
  admin: [['dashboard', '▦', 'Dashboard'], ['schedule', '📅', 'Schedule'], ['containers', '📦', 'Vaults'], ['overflow', '🛋️', 'Overflow'], ['team', '👥', 'Team'], ['reports', '📊', 'Reports'], ['timesheets', '⏱️', 'Timesheets'], ['activity', '🕘', 'Activity'], ['access', '🔎', 'Access log']],
  // Packers deliberately have no Dashboard or Activity: both list every
  // apartment and tenant in the building, and a packer needs the one door
  // they are standing at (reached by number from My queue). Their own recent
  // actions are shown inside My queue.
  packer: [['mywork', '✓', 'My queue'], ['schedule', '📅', 'Schedule']],
  mover: [['mywork', '✓', 'My queue'], ['dashboard', '▦', 'Dashboard'], ['schedule', '📅', 'Schedule'], ['containers', '📦', 'Vaults'], ['overflow', '🛋️', 'Overflow'], ['activity', '🕘', 'Activity']],
  // Packer + Mover in one person. Missing since the role was added, so every
  // crew member has been running on an empty sidebar.
  crew: [['mywork', '✓', 'My queue'], ['dashboard', '▦', 'Dashboard'], ['schedule', '📅', 'Schedule'], ['containers', '📦', 'Vaults'], ['overflow', '🛋️', 'Overflow'], ['activity', '🕘', 'Activity']],
  driver: [['mywork', '✓', 'My queue'], ['containers', '📦', 'Vaults'], ['dashboard', '▦', 'Dashboard'], ['schedule', '📅', 'Schedule'], ['activity', '🕘', 'Activity']],
  warehouse: [['mywork', '✓', 'My queue'], ['containers', '📦', 'Vaults'], ['overflow', '🛋️', 'Overflow'], ['dashboard', '▦', 'Dashboard'], ['schedule', '📅', 'Schedule'], ['activity', '🕘', 'Activity']],
  viewer: [['dashboard', '▦', 'Dashboard'], ['schedule', '📅', 'Schedule'], ['containers', '📦', 'Vaults'], ['overflow', '🛋️', 'Overflow'], ['reports', '📊', 'Reports'], ['activity', '🕘', 'Activity']],
}

/* Studio 15 is two screens and nothing else. Casey: the two jobs "should not
 * be on the same page". A packer here has no business scrolling past Vaults
 * and Overflow, which belong to a finished building across town.
 *
 * Team is the one exception for an admin: the crew roster is shared across
 * every job, so approving somebody should not mean switching projects. */
const S15_CREW = [['studio15', '🏢', 'Units'], ['s15building', '🏗️', 'Building']]
const NAV_STUDIO15 = {
  admin: [...S15_CREW, ['team', '👥', 'Team'], ['timesheets', '⏱️', 'Timesheets']],
  packer: S15_CREW,
  mover: S15_CREW,
  crew: S15_CREW,
  driver: S15_CREW,
  warehouse: S15_CREW,
  viewer: S15_CREW,
}

const NAV_BY_PROJECT = { trinity: NAV_TRINITY, studio15: NAV_STUDIO15 }

function PendingScreen() {
  const { currentUser, logout } = useStore()
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div className="card" style={{ maxWidth: 430, padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>⏳</div>
        <h2 style={{ fontFamily: 'var(--display)', marginBottom: 8 }}>Hi {currentUser.name.split(' ')[0]}, you're almost in</h2>
        <p style={{ color: 'var(--ink-2)', marginBottom: 18 }}>Your account is waiting for the admin to approve it and assign your role. Nothing in this project moves without a name attached, including access.</p>
        <button className="btn btn-ghost" onClick={logout}>← Back to sign in</button>
      </div>
    </div>
  )
}

function RemovedScreen() {
  const { currentUser, logout } = useStore()
  // denyUser sets denied: true so a denied signup request sees copy that
  // doesn't imply they ever had access, distinct from an admin actually
  // pulling access with removeUser.
  const denied = currentUser?.denied === true
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div className="card" style={{ maxWidth: 430, padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>🚫</div>
        <h2 style={{ fontFamily: 'var(--display)', marginBottom: 8 }}>{denied ? 'Your access request was not approved' : 'Your access has been removed'}</h2>
        <p style={{ color: 'var(--ink-2)', marginBottom: 18 }}>
          {denied
            ? "The admin didn't approve your request to join this project. If you think this is a mistake, reach out to your admin directly."
            : 'An admin removed your access to this project. If you think this is a mistake, reach out to your admin directly.'}
        </p>
        <button className="btn btn-ghost" onClick={logout}>← Back to sign in</button>
      </div>
    </div>
  )
}

function Shell() {
  const { state, currentUser, logout, dispatch } = useStore()
  // Defensive: Gate should only ever hand us an active, roled user, but guard
  // against a missing/unknown NAV[role] anyway rather than throwing.
  // Which job. Remembered so a packer on Studio 15 all week is not asked
  // every morning; the sidebar chip is the way back to the picker.
  /* Asked once per business day, before the job picker: the clock is the
     whole crew's, the job is today's. Held in state so answering it moves
     straight on without a reload. */
  const [startAsked, setStartAsked] = useState(false)
  const [project, setProject] = useState(() => {
    try { return localStorage.getItem(PROJECT_KEY) || null } catch { return null }
  })
  const allowed = allowedProjects(currentUser)
  /* The remembered choice is only as good as today's access. If Casey takes
     somebody off Trinity overnight, the phone that still has 'trinity' in
     localStorage has to fall back to the picker rather than render a board
     whose every read the rules will now deny. And when exactly one job is
     left there is nothing to choose, so it opens straight into it. */
  const effectiveProject = project && allowed.includes(project)
    ? project
    : (allowed.length === 1 ? allowed[0] : null)
  const pickProject = (key) => {
    try { localStorage.setItem(PROJECT_KEY, key) } catch { /* private mode */ }
    setProject(key)
    // The view has to travel with the project. useState's initialiser runs
    // once, so leaving Trinity on 'dashboard' would otherwise render Trinity's
    // dashboard inside Studio 15 - the exact mixing Casey asked to end.
    const nextNav = (NAV_BY_PROJECT[key] || NAV_TRINITY)[currentUser.role] || []
    setView({ name: nextNav[0]?.[0] || 'dashboard' })
  }
  const navsFor = NAV_BY_PROJECT[effectiveProject] || NAV_TRINITY
  /* A role with no entry used to fall through to `first = 'dashboard'`, which
     belongs to Trinity: on Studio 15 that stranded the person on another
     project's home screen with no way back. Falling back to the project's own
     crew nav keeps them inside the job they picked. */
  const nav = navsFor[currentUser.role] || navsFor.crew || navsFor.viewer || []
  const first = nav[0]?.[0] || 'dashboard'
  const [view, setView] = useState({ name: first })
  const [toastMsg, setToastMsg] = useState(null)

  /* Session telemetry: who has the app open, on what, and which screen.
   *
   * The heartbeat exists so a session that is sitting open still reads as
   * open. Without it somebody who opened the app at 8am and left it on one
   * screen would look like they stopped at 8am. */
  useEffect(() => {
    recordSession(view.name, { force: true })
    const t = setInterval(() => recordSession(view.name), 4 * 60 * 1000)
    const onVisible = () => { if (document.visibilityState === 'visible') recordSession(view.name, { force: true }) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [view.name])

  const toast = (msg) => {
    setToastMsg(msg)
    clearTimeout(toast._t)
    toast._t = setTimeout(() => setToastMsg(null), 2600)
  }

  // Opening a unit pushes a history entry so the phone's own back button
  // returns to the list instead of leaving the app. The app has no router
  // and never touched history, so on an installed PWA a crew member's
  // instinctive back press dropped them out of MoveTrack entirely, mid-unit.
  const openUnit = (unitId) => {
    // Checking into the unit is a side effect of opening it, so the crew never
    // have to remember a separate action. Fire and forget, and failures are
    // swallowed: a missing session is a reporting gap, and blocking somebody
    // from opening a unit because of one would be a great deal worse.
    Promise.resolve(dispatch({ type: 'openUnitSession', p: { unitId } })).catch(() => { /* reporting only */ })
    setView((v) => {
      if (v.name !== 'unit') {
        try { window.history.pushState({ mtUnit: true }, '') } catch { /* history unavailable */ }
        return { name: 'unit', unitId, back: v }
      }
      // Already on a unit (e.g. jumped from one to another): replace rather
      // than stack, so one back press still returns to the list.
      return { name: 'unit', unitId, back: v.back }
    })
  }
  const openContainer = (containerId) => setView({ name: 'containers', focusId: containerId })

  // A back press while on a unit returns to wherever they came from. Anywhere
  // else, let the browser do its normal thing (leave the app).
  useEffect(() => {
    const onPop = () => {
      setView((v) => (v.name === 'unit' ? (v.back || { name: first }) : v))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [first])

  // Every screen change starts at the top. Without this the browser keeps the
  // scroll position across a view swap, so a packer who taps a unit from
  // halfway down the board lands halfway down the unit page, below the
  // checklist they opened it for. On a phone that reads as the tap having
  // done nothing.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view.name, view.unitId])

  // The in-app Back button consumes the same history entry, so the two stay
  // in step: tapping Back then pressing the phone's back button doesn't
  // replay the unit screen.
  const goBackFromUnit = () => {
    if (window.history.state && window.history.state.mtUnit) {
      window.history.back()   // popstate handler above restores the parent view
      return
    }
    setView(view.back || { name: first })
  }
  const pendingCount = state.users.filter((u) => u.status === 'pending').length

  const page = () => {
    switch (view.name) {
      case 'dashboard': return <Dashboard openUnit={openUnit} toast={toast} />
      case 'schedule': return <Schedule toast={toast} />
      case 'unit': return <UnitDetail unitId={view.unitId} goBack={goBackFromUnit} openContainer={openContainer} toast={toast} />
      case 'containers': return <Containers openUnit={openUnit} focusId={view.focusId} clearFocus={() => setView((v) => ({ ...v, focusId: null }))} toast={toast} />
      case 'overflow': return <Overflow openUnit={openUnit} focusId={view.focusId} clearFocus={() => setView((v) => ({ ...v, focusId: null }))} toast={toast} />
      case 'team': return <Team toast={toast} />
      case 'reports': return <Reports openUnit={openUnit} openContainer={openContainer} toast={toast} />
      // Admin only, and Timesheets itself also returns null for anyone else,
      // so the guard holds even if this nav list is edited later.
      case 'timesheets': return <Timesheets toast={toast} />
      case 'access': return <Access />
      case 'activity': return <Activity openUnit={openUnit} openContainer={openContainer} />
      case 'mywork': return <MyWork openUnit={openUnit} openContainer={openContainer} toast={toast} />
      case 'studio15': return <Studio15 toast={toast} />
      case 's15building': return <S15BuildingView toast={toast} />
      default: return null
    }
  }

  const NavButtons = ({ mobile }) => nav.map(([key, ico, label]) => (
    <button key={key} className={view.name === key ? 'on' : ''} onClick={() => setView({ name: key })}>
      <span className="ico">{ico}</span>{mobile ? <span>{label}</span> : label}
      {!mobile && key === 'team' && pendingCount > 0 && <span className="count">{pendingCount}</span>}
    </button>
  ))

  // Casey, 2026-10-22: "for each user that logsin you should have a welcome
  // screen with a imput for there start time."
  if (!startAsked && shouldAskStart(currentUser, state.timeEntries)) {
    return <WelcomeStart onDone={() => setStartAsked(true)} toast={toast} />
  }

  // Casey: "the user would click on one or the other at the starting page."
  if (!effectiveProject) return <ProjectPicker onPick={pickProject} />

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          <GorillaWordmark width={168} />
          <div className="logo-sub" style={{ textAlign: 'center' }}>MoveTrack · project command center</div>
        </div>
        <button
          className="project-chip"
          onClick={() => { if (allowed.length > 1) setProject(null) }}
          title={allowed.length > 1 ? 'Switch project' : undefined}
          style={{ cursor: 'pointer', textAlign: 'left', width: '100%', border: 'none' }}
        >
          <b>{PROJECTS.find((p) => p.key === effectiveProject)?.name || state.project?.name || 'Trinity Manor'}</b>
          <span>{PROJECTS.find((p) => p.key === effectiveProject)?.address || state.project?.address || '3940 Park Blvd'}</span>
          {allowed.length > 1 && (
            <span style={{ display: 'block', marginTop: 4, fontSize: 10.5, opacity: 0.75 }}>Switch project ⇄</span>
          )}
        </button>
        <nav className="nav"><NavButtons /></nav>
        <div className="side-user">
          <Avatar name={currentUser.name} size="sm" />
          <div className="who">
            <b>{currentUser.name}</b>
            <span>{ROLES[currentUser.role]?.label || 'Unknown role'}</span>
          </div>
          <button className="out" onClick={logout}>Sign out</button>
        </div>
      </aside>

      <div className="grow" style={{ minWidth: 0 }}>
        <div className="topbar-mobile">
          <GorillaMark height={26} />
          <b style={{ fontFamily: 'var(--display)' }}>Gorilla Movers</b>
          <span className="grow" />
          <Avatar name={currentUser.name} size="sm" />
          <button style={{ color: '#a6aebb', fontSize: 12, fontWeight: 600 }} onClick={logout}>Sign out</button>
        </div>
        <main className="main">
          {state.project?.returnPhase && (
            <div className="return-banner">↩ RETURN PHASE. {state.project?.name || 'Trinity Manor'} items are heading back home.</div>
          )}
          {page()}
          <div className="brandfoot">MoveTrack · a Gorilla Movers platform · every action logged with name, date &amp; time</div>
        </main>
      </div>

      <nav className="bottom-nav"><NavButtons mobile /></nav>
      <UpdateBar />
      <Toast msg={toastMsg} />
    </div>
  )
}

function Gate() {
  const { currentUser } = useStore()
  if (!currentUser) return <Login />
  if (currentUser.status === 'pending') return <PendingScreen />
  // I1 fix: anything that isn't an active, roled user (removed, denied, or
  // any other non-active status / null role) gets a clean access-revoked
  // screen instead of falling through to Shell, which would crash on
  // NAV[null]. This also covers a brief active-but-role:null window.
  if (currentUser.status !== 'active' || !currentUser.role) return <RemovedScreen />
  return <Shell />
}

export default function App() {
  return (
    <StoreProvider>
      <Gate />
    </StoreProvider>
  )
}
