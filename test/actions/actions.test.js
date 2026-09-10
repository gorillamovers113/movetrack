/* Real dispatch actions, run against the Firestore emulator.
 *
 * WHY THIS EXISTS
 * Two bugs shipped on 2026-09-10 that typechecked, built cleanly, and passed
 * every unit test, and still broke on a crew phone:
 *
 *   1. A file input was widened to accept video without the upload path being
 *      taught to handle an mp4.
 *   2. dispatch({ type: 'clockIn' }) threw "undefined is not an object
 *      (evaluating 'p.unitId')" before a single line of clock code ran,
 *      because dispatch reads p.unitId on its first line and clockIn has no
 *      payload.
 *
 * Both slipped through because the suite only covered pure functions in
 * src/lib. Nothing had ever called a real action. This file does.
 *
 * The bar here is deliberately low and broad: every action, called the way the
 * app calls it, must not blow up, and must write what it claims to write. It is
 * a smoke contract, not a substitute for the domain tests.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, getDocs, doc, setDoc } from 'firebase/firestore'

// The app's own firebase.js turns on IndexedDB-backed offline persistence,
// which does not exist in node. Swap it for a stub; everything else about the
// module graph stays real, including the dispatch code under test.
vi.mock('../../src/firebase.js', () => ({
  app: {}, auth: {}, db: {}, storage: {}, functions: {},
}))

const { makeDispatch } = await import('../../src/store.jsx')

// Security rules are deliberately OPEN here, on their own project id. What
// the rules permit is covered exhaustively in test/rules; mixing the two would
// mean every action test also had to seed a user document and satisfy
// isActive(), and a failure would not say which layer broke. This suite asks
// one question: does the action code run, and does it write what it claims to.
const OPEN_RULES = `rules_version = "2";
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if true; }
  }
}`

// The emulator can be slow on its first connection of a run.
vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 })

let testEnv
let db

const PACKER = { uid: 'packer-1', name: 'Liv Post', role: 'packer', status: 'active' }
const MOVER = { uid: 'mover-1', name: 'Ali Mover', role: 'mover', status: 'active' }
const ADMIN = { uid: 'admin-1', name: 'Casey P', role: 'admin', status: 'active' }

const UNIT = {
  id: 'unit-1', number: '906', tenant: 'Maria Ochoa', floor: 9, stage: 'not_started',
  crew: { packers: [], movers: [] }, containerIds: [], media: [], inventory: [], materials: {},
}

// Whatever the store would have read from its live subscriptions.
const makeState = (over = {}) => ({
  units: [UNIT], containers: [], overflow: [], events: [], users: [PACKER, MOVER, ADMIN],
  schedule: [], timeEntries: [], unitSessions: [], project: { returnPhase: false, name: 'T', address: 'A' },
  ...over,
})

const events = []
const ctx = (user, state) => ({
  db,   // assigned in beforeAll, read at call time
  currentUser: user,
  state: state || makeState(),
  ev: async (type, action, extra) => { events.push({ type, action, ...extra }) },
  attributeMedia: (arr = []) => arr.map((m) => ({ ...m, uid: user.uid, userName: user.name, ts: m.ts || Date.now() })),
})

const run = (user, action, state) => makeDispatch(ctx(user, state))(action)


beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'movetrack-actions-test',
    firestore: { rules: OPEN_RULES, host: '127.0.0.1', port: 8080 },
  })
  db = testEnv.unauthenticatedContext().firestore()
})
afterAll(async () => { await testEnv.cleanup() })
// clearFirestore is the emulator's own reset: one call, no round trips per
// document. Wiping collections through the client SDK instead made this suite
// flaky, six failures on one run and none on the next, which is worse than
// having no suite at all because nobody trusts a red that might be noise.
beforeEach(async () => {
  events.length = 0
  await testEnv.clearFirestore()
  await setDoc(doc(db, 'units', UNIT.id), UNIT)
})

const rows = async (name) => (await getDocs(collection(db, name))).docs.map((d) => ({ id: d.id, ...d.data() }))

/* ------------------------------------------------------------------ */

describe('the bug that shipped: an action with no payload', () => {
  // dispatch reads p.unitId on its first line. Any action called without a
  // payload used to throw before its own code ran. This is the regression.
  it('clockIn takes no payload and must not throw', async () => {
    await expect(run(PACKER, { type: 'clockIn' })).resolves.not.toThrow()
    const entries = await rows('timeEntries')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ uid: PACKER.uid, source: 'self', clockOut: null })
  })

  it('every payload-free action survives being called without one', async () => {
    for (const type of ['clockIn', 'closeUnitSession']) {
      await expect(run(PACKER, { type })).resolves.not.toThrow()
    }
  })
})

describe('clocking in and out', () => {
  it('refuses a second clock-in on the same day', async () => {
    await run(PACKER, { type: 'clockIn' })
    await expect(run(PACKER, { type: 'clockIn' }, makeState({ timeEntries: await rows('timeEntries') })))
      .rejects.toThrow(/already clocked in/i)
  })

  it('refuses roles that do not keep time', async () => {
    for (const who of [ADMIN, { uid: 'w', name: 'W', role: 'warehouse' }]) {
      await expect(run(who, { type: 'clockIn' })).rejects.toThrow(/packers and movers/i)
    }
  })

  it('clocking out closes the day and records the lunch decision', async () => {
    await run(PACKER, { type: 'clockIn' })
    const open = (await rows('timeEntries'))[0]
    await run(PACKER, { type: 'clockOut', p: { workedThroughLunch: true } },
      makeState({ timeEntries: [open] }))
    const closed = (await rows('timeEntries'))[0]
    expect(closed.clockOut).toBeGreaterThan(0)
    expect(closed.workedThroughLunch).toBe(true)
    expect(closed.lunchMinutes).toBe(0)
  })

  it('refuses to clock out when nothing is open', async () => {
    await expect(run(PACKER, { type: 'clockOut', p: {} })).rejects.toThrow(/not clocked in/i)
  })

  // The whole point of the design: the crew's hours must not appear in the
  // Activity feed the whole crew can read.
  it('writes no activity event for any clock action', async () => {
    await run(PACKER, { type: 'clockIn' })
    const open = (await rows('timeEntries'))[0]
    await run(PACKER, { type: 'clockOut', p: {} }, makeState({ timeEntries: [open] }))
    expect(events).toHaveLength(0)
  })
})

describe('unit sessions', () => {
  it('opening a unit opens a session', async () => {
    await run(PACKER, { type: 'openUnitSession', p: { unitId: 'unit-1' } })
    const list = await rows('unitSessions')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ unitId: 'unit-1', uid: PACKER.uid, endedAt: null })
  })

  it('opening a second unit closes the first, so sessions never overlap', async () => {
    await run(PACKER, { type: 'openUnitSession', p: { unitId: 'unit-1' } })
    const first = await rows('unitSessions')
    await run(PACKER, { type: 'openUnitSession', p: { unitId: 'unit-2' } },
      makeState({ unitSessions: first }))
    const list = await rows('unitSessions')
    expect(list).toHaveLength(2)
    expect(list.filter((s) => !s.endedAt)).toHaveLength(1)
    expect(list.find((s) => s.unitId === 'unit-1').endedReason).toBe('switched')
  })

  it('reopening the same unit does not stack a second session', async () => {
    await run(PACKER, { type: 'openUnitSession', p: { unitId: 'unit-1' } })
    const first = await rows('unitSessions')
    await run(PACKER, { type: 'openUnitSession', p: { unitId: 'unit-1' } },
      makeState({ unitSessions: first }))
    expect(await rows('unitSessions')).toHaveLength(1)
  })

  it('clocking out closes an open session, so a day never ends mid-unit', async () => {
    await run(PACKER, { type: 'clockIn' })
    const entry = (await rows('timeEntries'))[0]
    await run(PACKER, { type: 'openUnitSession', p: { unitId: 'unit-1' } })
    const sessions = await rows('unitSessions')
    await run(PACKER, { type: 'clockOut', p: {} },
      makeState({ timeEntries: [entry], unitSessions: sessions }))
    const after = await rows('unitSessions')
    expect(after[0].endedAt).toBeGreaterThan(0)
    expect(after[0].endedReason).toBe('clockOut')
  })

  it('is a no-op for a role that does not keep time', async () => {
    await run(ADMIN, { type: 'openUnitSession', p: { unitId: 'unit-1' } })
    expect(await rows('unitSessions')).toHaveLength(0)
  })
})

describe('admin back-entry and corrections', () => {
  const day = { clockIn: Date.parse('2026-09-09T18:30:00Z'), clockOut: Date.parse('2026-09-09T20:00:00Z') }

  it('adds a past day marked as entered by the admin', async () => {
    await run(ADMIN, { type: 'adminAddTimeEntry', p: { uid: PACKER.uid, ...day, notes: 'Waited on site' } })
    const [entry] = await rows('timeEntries')
    expect(entry).toMatchObject({
      uid: PACKER.uid, day: '2026-09-09', source: 'admin',
      enteredBy: ADMIN.uid, notes: 'Waited on site', lunchMinutes: 0,
    })
  })

  it('refuses a finish time at or before the start', async () => {
    await expect(run(ADMIN, { type: 'adminAddTimeEntry', p: { uid: PACKER.uid, clockIn: day.clockOut, clockOut: day.clockIn } }))
      .rejects.toThrow(/after start time/i)
  })

  it('refuses somebody who does not keep time', async () => {
    await expect(run(ADMIN, { type: 'adminAddTimeEntry', p: { uid: ADMIN.uid, ...day } }))
      .rejects.toThrow(/packers and movers/i)
  })

  // Casey's requirement, end to end: the entry shows the new time and the old
  // one lives somewhere the crew cannot read.
  it('a correction writes history to timeCorrections, not onto the entry', async () => {
    await run(ADMIN, { type: 'adminAddTimeEntry', p: { uid: PACKER.uid, ...day } })
    const [entry] = await rows('timeEntries')
    const corrected = Date.parse('2026-09-09T18:00:00Z')
    await run(ADMIN, { type: 'adminCorrectTimeEntry', p: { entryId: entry.id, changes: { clockIn: corrected } } },
      makeState({ timeEntries: [entry] }))

    const [after] = await rows('timeEntries')
    expect(after.clockIn).toBe(corrected)
    for (const leak of ['correctedBy', 'corrections', 'oldValue']) {
      expect(after[leak]).toBeUndefined()
    }

    const [correction] = await rows('timeCorrections')
    expect(correction).toMatchObject({
      entryId: entry.id, field: 'clockIn', oldValue: day.clockIn, newValue: corrected, byUid: ADMIN.uid,
    })
  })

  it('records nothing when a correction changes nothing', async () => {
    await run(ADMIN, { type: 'adminAddTimeEntry', p: { uid: PACKER.uid, ...day } })
    const [entry] = await rows('timeEntries')
    await run(ADMIN, { type: 'adminCorrectTimeEntry', p: { entryId: entry.id, changes: { clockIn: day.clockIn } } },
      makeState({ timeEntries: [entry] }))
    expect(await rows('timeCorrections')).toHaveLength(0)
  })
})
