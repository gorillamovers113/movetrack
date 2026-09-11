// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

/* Every page, rendered as every role.
 *
 * The worst bug this app has shipped was a white screen: useEffect used
 * without being imported, which typechecked, built, and killed the app for
 * every admin and viewer the moment they loaded it. No domain test could see
 * it, because nothing about it was domain logic.
 *
 * So this renders each page as each role, against state shaped like a real
 * job, and asserts it does not throw. It is a smoke test and makes no claim
 * about what a page says: the point is that a page nobody happened to open in
 * testing cannot take the whole app down on a crew phone.
 */

const users = [
  { id: 'a', uid: 'a', name: 'Casey P', role: 'admin', status: 'active' },
  { id: 'p', uid: 'p', name: 'Liv Post', role: 'packer', status: 'active' },
  { id: 'm', uid: 'm', name: 'Victor Mendez', role: 'mover', status: 'active' },
  { id: 'c', uid: 'c', name: 'Aaron Soto', role: 'crew', status: 'active' },
  { id: 'w', uid: 'w', name: 'Jeremy Williams', role: 'warehouse', status: 'active' },
  { id: 'v', uid: 'v', name: 'A Viewer', role: 'viewer', status: 'active' },
  { id: 'pend', uid: 'pend', name: 'New Person', role: null, status: 'pending' },
]

const shot = { url: 'u.jpg', kind: 'photo', uid: 'm', userName: 'Victor Mendez', at: 3 }
const unit = (over) => ({
  tenant: 'A Tenant', floor: 9, stage: 'not_started', pieces: null,
  stickerColor: null, inventoryFrom: null, inventoryTo: null,
  materials: {}, supplies: {}, steps: {}, vaults: [], received: [],
  media: [], containerIds: [], inventory: [], times: {},
  ...over,
  crew: { packers: [], movers: [], ...(over.crew || {}) },
})

// Deliberately messy: half-done units, one with nothing on it at all, and one
// carrying an open flag. A page that only survives tidy data is a page that
// breaks on a Tuesday.
const state = {
  units: [
    unit({ id: 'u1', number: '901', stage: 'packing', crew: { packers: ['p'] }, steps: { door: { uid: 'p', userName: 'Liv Post', at: 1 } } }),
    unit({ id: 'u2', number: '902', stage: 'packed', pieces: 109, stickerColor: 'Green',
      materials: { small: 50 }, supplies: { tape: 4 },
      vaults: [{ number: '8038', uid: 'm', userName: 'Victor Mendez', at: 2, open: shot, closed: shot }],
      times: { packStart: 1, packEnd: 2 } }),
    unit({ id: 'u3', number: '903', stage: 'loaded',
      vaults: [{ number: '7101', uid: 'm', userName: 'Victor Mendez', at: 2, open: shot, closed: shot }],
      flag: { message: 'Mismatch', ts: 1, by: 'Casey P', open: true } }),
    unit({ id: 'u4', number: '904' }),
  ],
  containers: [
    { id: 'c1', number: '8038', status: 'filling', unitIds: ['u2'], deliveredAt: 1 },
    { id: 'c2', number: '7101', status: 'full', unitIds: ['u3'], deliveredAt: 1 },
    { id: 'c3', number: '9000', status: 'empty', unitIds: [], deliveredAt: 1 },
  ],
  overflow: [{ id: 'o1', label: 'Piano', unitId: 'u2', stage: 'identified', media: [] }],
  events: [
    { id: 'e1', ts: 5, uid: 'p', userName: 'Liv Post', role: 'packer', type: 'step', action: 'Unit 901 done', unitId: 'u1', media: [] },
    { id: 'e2', ts: 6, uid: 'm', userName: 'Victor Mendez', role: 'mover', type: 'note', action: 'Tenant not home', unitId: 'u2' },
    { id: 'e3', ts: 7, uid: 'a', userName: 'Casey P', role: 'admin', type: 'flag', action: 'MISMATCH on unit 903', unitId: 'u3' },
  ],
  users,
  schedule: [
    { id: '2026-09-10', date: '2026-09-10', work: 'MOVEOUT', floor: 9, unitCount: 4 },
    { id: '2026-09-11', date: '2026-09-11', work: 'PACK', floor: 8, unitCount: 6 },
  ],
  timeEntries: [
    { id: 't1', uid: 'p', userName: 'Liv Post', role: 'packer', day: '2026-09-10', clockIn: 1, clockOut: 2, lunchMinutes: 0, source: 'self' },
    { id: 't2', uid: 'm', userName: 'Victor Mendez', role: 'mover', day: '2026-09-10', clockIn: 1, clockOut: null, lunchMinutes: 0, source: 'admin' },
  ],
  unitSessions: [
    { id: 's1', unitId: 'u2', uid: 'p', userName: 'Liv Post', role: 'packer', day: '2026-09-10', startedAt: 1, endedAt: 2 },
    { id: 's2', unitId: 'u3', uid: 'm', userName: 'Victor Mendez', role: 'mover', day: '2026-09-10', startedAt: 3, endedAt: null },
  ],
  project: { returnPhase: false, name: 'Trinity Manor', address: '3940 Park Blvd' },
}

let currentUser = users[0]
vi.mock('../../store.jsx', async () => {
  const actual = await vi.importActual('../../store.jsx')
  return { ...actual, useStore: () => ({ state, currentUser, dispatch: async () => {}, logout: () => {} }) }
})
vi.mock('../../firebase.js', () => ({ app: {}, auth: {}, db: {}, storage: {}, functions: {} }))
vi.mock('firebase/firestore', () => ({
  collection: () => ({}), onSnapshot: () => () => {}, query: () => ({}), orderBy: () => ({}), limit: () => ({}),
}))

const Dashboard = (await import('../Dashboard.jsx')).default
const Schedule = (await import('../Schedule.jsx')).default
const Containers = (await import('../Containers.jsx')).default
const Overflow = (await import('../Overflow.jsx')).default
const Team = (await import('../Team.jsx')).default
const Reports = (await import('../Reports.jsx')).default
const Activity = (await import('../Activity.jsx')).default
const MyWork = (await import('../MyWork.jsx')).default
const Timesheets = (await import('../Timesheets.jsx')).default
const Access = (await import('../Access.jsx')).default
const UnitDetail = (await import('../UnitDetail.jsx')).default

const noop = () => {}
const PAGES = {
  Dashboard: () => <Dashboard openUnit={noop} openContainer={noop} toast={noop} />,
  Schedule: () => <Schedule toast={noop} />,
  Vaults: () => <Containers openUnit={noop} toast={noop} clearFocus={noop} />,
  Overflow: () => <Overflow openUnit={noop} toast={noop} clearFocus={noop} />,
  Team: () => <Team toast={noop} />,
  Reports: () => <Reports openUnit={noop} openContainer={noop} toast={noop} />,
  Activity: () => <Activity openUnit={noop} openContainer={noop} />,
  MyWork: () => <MyWork openUnit={noop} openContainer={noop} toast={noop} />,
  Timesheets: () => <Timesheets toast={noop} />,
  Access: () => <Access />,
}

const ROLES = ['admin', 'packer', 'mover', 'crew', 'warehouse', 'viewer']

beforeEach(() => {
  URL.createObjectURL = () => 'blob:x'
  URL.revokeObjectURL = () => {}
})
afterEach(cleanup)

describe('every page renders for every role', () => {
  for (const [name, Page] of Object.entries(PAGES)) {
    for (const role of ROLES) {
      it(`${name} as ${role}`, () => {
        currentUser = users.find((u) => u.role === role)
        expect(() => render(<Page />)).not.toThrow()
      })
    }
  }
})

describe('a unit opens for every role, at every stage', () => {
  for (const u of state.units) {
    for (const role of ROLES) {
      it(`unit ${u.number} (${u.stage}) as ${role}`, () => {
        currentUser = users.find((x) => x.role === role)
        expect(() => render(
          <UnitDetail unitId={u.id} back={noop} openUnit={noop} openContainer={noop} toast={noop} />,
        )).not.toThrow()
      })
    }
  }

  it('does not explode on a unit that is gone', () => {
    currentUser = users[0]
    expect(() => render(
      <UnitDetail unitId="does-not-exist" back={noop} openUnit={noop} openContainer={noop} toast={noop} />,
    )).not.toThrow()
  })
})
