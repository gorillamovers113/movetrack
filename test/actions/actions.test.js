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
const { vaultComplete, completeVaults } = await import('../../src/lib/mutations.js')

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

  /* Everybody who works keeps time. This used to be packers and movers only,
   * and an admin who lost their clock lost an afternoon's hours with it. */
  it('lets everybody who works a shift clock in', async () => {
    for (const who of [ADMIN, { uid: 'w', name: 'Jeremy Williams', role: 'warehouse' }]) {
      await expect(run(who, { type: 'clockIn' })).resolves.not.toThrow()
    }
    expect(await rows('timeEntries')).toHaveLength(2)
  })

  it('refuses the viewer, who holds no shift', async () => {
    await expect(run({ uid: 'v', name: 'A Viewer', role: 'viewer' }, { type: 'clockIn' }))
      .rejects.toThrow(/keeps no time/i)
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

  it('refuses a back-entry for the viewer, who holds no shift', async () => {
    const viewer = { uid: 'v', name: 'A Viewer', role: 'viewer', status: 'active' }
    await expect(run(ADMIN, { type: 'adminAddTimeEntry', p: { uid: viewer.uid, ...day } },
      makeState({ users: [PACKER, MOVER, ADMIN, viewer] })))
      .rejects.toThrow(/keeps no time/i)
  })

  // An admin works a shift like anybody else, so their own day is enterable.
  it('accepts a back-entry for an admin', async () => {
    await expect(run(ADMIN, { type: 'adminAddTimeEntry', p: { uid: ADMIN.uid, ...day } }))
      .resolves.not.toThrow()
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

/* The vault flow, which is the one place two people work the same record.
 *
 * A vault is built up in three separate writes: the number when it is opened,
 * then a door-open photo, then a door-closed photo. The photos land on an
 * element that already exists, which arrayUnion cannot do, so that path reads
 * the array and writes it back. With up to three movers on a unit that is a
 * genuine lost-update risk, and these tests are what hold the transaction
 * honest. */
describe('logging a vault in three separate acts', () => {
  const packed = { ...UNIT, stage: 'packed' }
  const seedPacked = async () => setDoc(doc(db, 'units', UNIT.id), packed)
  const unitRow = async () => (await rows('units')).find((u) => u.id === UNIT.id)

  it('opening a vault records the number, the person and the time on its own', async () => {
    await seedPacked()
    await run(MOVER, { type: 'startVault', p: { unitId: UNIT.id, number: ' bb-1007 ' } },
      makeState({ units: [packed] }))

    const u = await unitRow()
    expect(u.vaults).toHaveLength(1)
    expect(u.vaults[0]).toMatchObject({ number: 'BB-1007', uid: MOVER.uid, userName: MOVER.name })
    expect(u.vaults[0].at).toBeGreaterThan(0)
    // No photos yet, and that is the whole point: the vault exists unfinished.
    expect(u.vaults[0].open).toBeUndefined()
    expect(u.vaults[0].closed).toBeUndefined()
    expect(u.crew.movers).toContain(MOVER.uid)
  })

  it('creates the container when the vault is not on the board yet', async () => {
    await seedPacked()
    await run(MOVER, { type: 'startVault', p: { unitId: UNIT.id, number: 'BB-2001' } },
      makeState({ units: [packed] }))
    const conts = await rows('containers')
    expect(conts).toHaveLength(1)
    expect(conts[0]).toMatchObject({ number: 'BB-2001', status: 'filling' })
    expect(conts[0].unitIds).toContain(UNIT.id)
  })

  it('each door photo saves on its own, stamped with whoever took it', async () => {
    await seedPacked()
    const state = makeState({ units: [packed] })
    await run(MOVER, { type: 'startVault', p: { unitId: UNIT.id, number: 'BB-1' } }, state)
    await run(MOVER, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-1', part: 'open', shots: [{ url: 'o.jpg', kind: 'photo' }] } }, state)

    let u = await unitRow()
    expect(u.vaults[0].open).toMatchObject({ url: 'o.jpg', kind: 'photo', userName: MOVER.name })
    expect(u.vaults[0].closed).toBeUndefined()

    // A different mover shuts it, and that is who the closed shot is credited to.
    const other = { uid: 'mover-2', name: 'Sam Diaz', role: 'mover', status: 'active' }
    await run(other, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'bb-1', part: 'closed', shots: [{ url: 'c.mp4', kind: 'video' }] } }, state)

    u = await unitRow()
    expect(u.vaults[0].open).toMatchObject({ userName: MOVER.name })
    expect(u.vaults[0].closed).toMatchObject({ url: 'c.mp4', kind: 'video', userName: 'Sam Diaz' })
    expect(u.crew.movers).toEqual(expect.arrayContaining([MOVER.uid, other.uid]))
  })

  it('a photo for a vault nobody opened is refused rather than silently dropped', async () => {
    await seedPacked()
    await expect(
      run(MOVER, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-9', part: 'open', shots: [{ url: 'o.jpg' }] } },
        makeState({ units: [packed] })),
    ).rejects.toThrow(/not on this unit/i)
  })

  it('refuses a part that is not one of the two doors, and a failed upload', async () => {
    await seedPacked()
    const state = makeState({ units: [packed] })
    await run(MOVER, { type: 'startVault', p: { unitId: UNIT.id, number: 'BB-1' } }, state)
    await expect(run(MOVER, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-1', part: 'side', shots: [{ url: 'x' }] } }, state))
      .rejects.toThrow(/unknown vault photo/i)
    await expect(run(MOVER, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-1', part: 'open', shots: [] } }, state))
      .rejects.toThrow(/did not upload/i)
    await expect(run(MOVER, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-1', part: 'open', shots: [{ url: null }] } }, state))
      .rejects.toThrow(/did not upload/i)
  })

  // The reason this path is a transaction at all.
  it('two movers photographing different vaults at once do not overwrite each other', async () => {
    await seedPacked()
    const state = makeState({ units: [packed] })
    await run(MOVER, { type: 'startVault', p: { unitId: UNIT.id, number: 'BB-1' } }, state)
    await run(MOVER, { type: 'startVault', p: { unitId: UNIT.id, number: 'BB-2' } }, state)

    const other = { uid: 'mover-2', name: 'Sam Diaz', role: 'mover', status: 'active' }
    await Promise.all([
      run(MOVER, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-1', part: 'open', shots: [{ url: 'a.jpg' }] } }, state),
      run(other, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-2', part: 'open', shots: [{ url: 'b.jpg' }] } }, state),
    ])

    const u = await unitRow()
    expect(u.vaults).toHaveLength(2)
    expect(u.vaults.find((v) => v.number === 'BB-1').open).toMatchObject({ url: 'a.jpg' })
    expect(u.vaults.find((v) => v.number === 'BB-2').open).toMatchObject({ url: 'b.jpg' })
  })

  it('will not close a unit whose vault count disagrees with what was logged', async () => {
    const steps = {
      load_unit_photo: { userName: MOVER.name, at: 1 },
      load_sticker: { userName: MOVER.name, at: 2, value: 'Pink', matched: true },
      load_number: { userName: MOVER.name, at: 3, value: '906', matched: true },
      load_vault_count: { userName: MOVER.name, at: 4, value: 3, matched: false },
      load_after_photo: { userName: MOVER.name, at: 5 },
    }
    const shot = { url: 'u', kind: 'photo', uid: MOVER.uid, userName: MOVER.name, at: 6 }
    const short = { ...packed, steps, vaults: [{ number: 'BB-1', uid: MOVER.uid, userName: MOVER.name, at: 1, open: shot, closed: shot }] }
    await setDoc(doc(db, 'units', UNIT.id), short)

    await expect(run(MOVER, { type: 'finishLoading', p: { unitId: UNIT.id } }, makeState({ units: [short] })))
      .rejects.toThrow(/counted 3 vaults but 1 is fully logged/i)
    expect((await unitRow()).stage).toBe('packed')
  })
})

/* More than one shot per door.
 *
 * A full vault photographed from one angle hides whatever is behind the front
 * row, so a door takes as many shots as the mover wants to send. The vault
 * record keeps the first as its representative image and the count; every shot
 * lands in unit.media, which is what the unit page and the reports read. */
describe('several photos on one vault door', () => {
  const packed = { ...UNIT, stage: 'packed' }

  it('keeps every shot, and names the first as the vault record', async () => {
    await setDoc(doc(db, 'units', UNIT.id), packed)
    const state = makeState({ units: [packed] })
    await run(MOVER, { type: 'startVault', p: { unitId: UNIT.id, number: 'BB-1' } }, state)
    await run(MOVER, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-1', part: 'open', shots: [
      { url: 'front.jpg', kind: 'photo' }, { url: 'back.jpg', kind: 'photo' }, { url: 'walkthrough.mp4', kind: 'video' },
    ] } }, state)

    const u = (await rows('units')).find((x) => x.id === UNIT.id)
    expect(u.vaults[0].open).toMatchObject({ url: 'front.jpg', count: 3, userName: MOVER.name })

    const shots = u.media.filter((m) => m.phase === 'vault_open')
    expect(shots.map((m) => m.url)).toEqual(['front.jpg', 'back.jpg', 'walkthrough.mp4'])
    expect(shots.every((m) => m.userName === MOVER.name)).toBe(true)
    expect(shots.find((m) => m.url === 'walkthrough.mp4').kind).toBe('video')
  })

  it('still counts as one finished door, so the checklist is unchanged', async () => {
    await setDoc(doc(db, 'units', UNIT.id), packed)
    const state = makeState({ units: [packed] })
    await run(MOVER, { type: 'startVault', p: { unitId: UNIT.id, number: 'BB-1' } }, state)
    for (const part of ['open', 'closed']) {
      await run(MOVER, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-1', part, shots: [{ url: `${part}-1.jpg` }, { url: `${part}-2.jpg` }] } }, state)
    }
    const u = (await rows('units')).find((x) => x.id === UNIT.id)
    expect(vaultComplete(u.vaults[0])).toBe(true)
    expect(completeVaults(u)).toHaveLength(1)
  })

  it('gives every shot a distinct id, so none is lost to a collision', async () => {
    await setDoc(doc(db, 'units', UNIT.id), packed)
    const state = makeState({ units: [packed] })
    await run(MOVER, { type: 'startVault', p: { unitId: UNIT.id, number: 'BB-1' } }, state)
    await run(MOVER, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-1', part: 'open', shots: [
      { url: 'a.jpg' }, { url: 'b.jpg' }, { url: 'c.jpg' }, { url: 'd.jpg' },
    ] } }, state)
    const u = (await rows('units')).find((x) => x.id === UNIT.id)
    const ids = u.media.filter((m) => m.phase === 'vault_open').map((m) => m.id)
    expect(new Set(ids).size).toBe(4)
  })
})

/* Coming back to the same door and adding more.
 *
 * The count used to be taken from the batch being saved, so a mover who added
 * two more shots to a door that already had three ended up with a record
 * saying two, and the first three looked lost. They were never lost, but a
 * count that goes backwards is a report nobody trusts. */
describe('adding more shots to a door already photographed', () => {
  const packed = { ...UNIT, stage: 'packed' }

  it('accumulates rather than replacing', async () => {
    await setDoc(doc(db, 'units', UNIT.id), packed)
    const state = makeState({ units: [packed] })
    await run(MOVER, { type: 'startVault', p: { unitId: UNIT.id, number: 'BB-1' } }, state)
    await run(MOVER, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-1', part: 'open', shots: [{ url: 'a.jpg' }, { url: 'b.jpg' }, { url: 'c.jpg' }] } }, state)
    await run(MOVER, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-1', part: 'open', shots: [{ url: 'd.jpg' }, { url: 'e.jpg' }] } }, state)

    const u = (await rows('units')).find((x) => x.id === UNIT.id)
    expect(u.vaults[0].open.count).toBe(5)
    expect(u.media.filter((m) => m.phase === 'vault_open').map((m) => m.url))
      .toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'])
  })

  it('keeps the original credit and adds who touched it last', async () => {
    await setDoc(doc(db, 'units', UNIT.id), packed)
    const state = makeState({ units: [packed] })
    const other = { uid: 'mover-2', name: 'Sam Diaz', role: 'mover', status: 'active' }
    await run(MOVER, { type: 'startVault', p: { unitId: UNIT.id, number: 'BB-1' } }, state)
    await run(MOVER, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-1', part: 'open', shots: [{ url: 'a.jpg' }] } }, state)
    await run(other, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-1', part: 'open', shots: [{ url: 'b.jpg' }] } }, state)

    const u = (await rows('units')).find((x) => x.id === UNIT.id)
    expect(u.vaults[0].open).toMatchObject({ url: 'a.jpg', userName: MOVER.name, count: 2, lastBy: 'Sam Diaz' })
  })

  it('counts each door separately', async () => {
    await setDoc(doc(db, 'units', UNIT.id), packed)
    const state = makeState({ units: [packed] })
    await run(MOVER, { type: 'startVault', p: { unitId: UNIT.id, number: 'BB-1' } }, state)
    await run(MOVER, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-1', part: 'open', shots: [{ url: 'a.jpg' }, { url: 'b.jpg' }] } }, state)
    await run(MOVER, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-1', part: 'closed', shots: [{ url: 'c.jpg' }] } }, state)

    const u = (await rows('units')).find((x) => x.id === UNIT.id)
    expect(u.vaults[0].open.count).toBe(2)
    expect(u.vaults[0].closed.count).toBe(1)
  })

  it('counts each vault separately, even on the same unit', async () => {
    await setDoc(doc(db, 'units', UNIT.id), packed)
    const state = makeState({ units: [packed] })
    await run(MOVER, { type: 'startVault', p: { unitId: UNIT.id, number: 'BB-1' } }, state)
    await run(MOVER, { type: 'startVault', p: { unitId: UNIT.id, number: 'BB-2' } }, state)
    await run(MOVER, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-1', part: 'open', shots: [{ url: 'a.jpg' }, { url: 'b.jpg' }] } }, state)
    await run(MOVER, { type: 'logVaultPhoto', p: { unitId: UNIT.id, number: 'BB-2', part: 'open', shots: [{ url: 'c.jpg' }] } }, state)

    const u = (await rows('units')).find((x) => x.id === UNIT.id)
    expect(u.vaults.find((v) => v.number === 'BB-1').open.count).toBe(2)
    expect(u.vaults.find((v) => v.number === 'BB-2').open.count).toBe(1)
  })
})

/* An admin fixing a value a crew member typed wrong.
 *
 * Aaron typed 901 on unit 902. The crew deliberately cannot retype a blind
 * check, because one you can retry until it passes is not a check, so a
 * genuine typo had no way back and left the unit flagged for something that
 * never happened. */
describe('correcting a mistyped checklist value', () => {
  const withTypo = (over = {}) => ({
    ...UNIT, stage: 'packed', number: '902', stickerColor: 'Green',
    steps: {
      load_number: { value: '901', matched: false, uid: MOVER.uid, userName: MOVER.name, at: 1000 },
      ...(over.steps || {}),
    },
    ...over,
  })
  const unitRow = async () => (await rows('units')).find((u) => u.id === UNIT.id)

  it('writes the new value and recomputes the match', async () => {
    const u = withTypo()
    await setDoc(doc(db, 'units', UNIT.id), u)
    await run(ADMIN, { type: 'adminCorrectStep', p: { unitId: UNIT.id, key: 'load_number', value: '902' } }, makeState({ units: [u] }))

    const after = await unitRow()
    expect(after.steps.load_number).toMatchObject({ value: '902', matched: true })
    // The person who actually typed it keeps the credit.
    expect(after.steps.load_number.userName).toBe(MOVER.name)
  })

  // The contract that makes this safe to use: every active user can read
  // units, so the original must not live there.
  it('keeps the original where only an admin can read it, never on the unit', async () => {
    const u = withTypo()
    await setDoc(doc(db, 'units', UNIT.id), u)
    await run(ADMIN, { type: 'adminCorrectStep', p: { unitId: UNIT.id, key: 'load_number', value: '902' } }, makeState({ units: [u] }))

    const after = await unitRow()
    const blob = JSON.stringify(after.steps.load_number)
    expect(blob).not.toMatch(/901/)
    expect(blob).not.toMatch(new RegExp(ADMIN.name))

    const [correction] = await rows('stepCorrections')
    expect(correction).toMatchObject({
      unitId: UNIT.id, key: 'load_number', oldValue: '901', newValue: '902',
      oldMatched: false, newMatched: true, byUid: ADMIN.uid, enteredByName: MOVER.name,
    })
  })

  it('still flags when the correction is itself wrong', async () => {
    const u = withTypo()
    await setDoc(doc(db, 'units', UNIT.id), u)
    await run(ADMIN, { type: 'adminCorrectStep', p: { unitId: UNIT.id, key: 'load_number', value: '905' } }, makeState({ units: [u] }))
    expect((await unitRow()).steps.load_number).toMatchObject({ value: '905', matched: false })
  })

  it('takes the flag down with the last mismatch', async () => {
    const u = withTypo({ flag: { message: 'Loaded with a mismatch on unit number.', ts: 1, by: 'Ali', open: true } })
    await setDoc(doc(db, 'units', UNIT.id), u)
    await run(ADMIN, { type: 'adminCorrectStep', p: { unitId: UNIT.id, key: 'load_number', value: '902' } }, makeState({ units: [u] }))
    expect((await unitRow()).flag).toMatchObject({ open: false, clearedBy: ADMIN.name })
  })

  it('leaves the flag up while something else still disagrees', async () => {
    const u = withTypo({
      flag: { message: 'two mismatches', ts: 1, by: 'Ali', open: true },
      steps: {
        load_number: { value: '901', matched: false, uid: MOVER.uid, userName: MOVER.name, at: 1000 },
        load_sticker: { value: 'Pink', matched: false, uid: MOVER.uid, userName: MOVER.name, at: 1001 },
      },
    })
    await setDoc(doc(db, 'units', UNIT.id), u)
    await run(ADMIN, { type: 'adminCorrectStep', p: { unitId: UNIT.id, key: 'load_number', value: '902' } }, makeState({ units: [u] }))
    expect((await unitRow()).flag.open).toBe(true)
  })

  it('matches a sticker colour the way a person reads it', async () => {
    const u = withTypo({ steps: { load_sticker: { value: 'Pink', matched: false, uid: MOVER.uid, userName: MOVER.name, at: 1 } } })
    await setDoc(doc(db, 'units', UNIT.id), u)
    await run(ADMIN, { type: 'adminCorrectStep', p: { unitId: UNIT.id, key: 'load_sticker', value: 'green' } }, makeState({ units: [u] }))
    expect((await unitRow()).steps.load_sticker).toMatchObject({ value: 'green', matched: true })
  })

  it('refuses an item nobody recorded, and a change that changes nothing', async () => {
    const u = withTypo()
    await setDoc(doc(db, 'units', UNIT.id), u)
    const state = makeState({ units: [u] })
    await expect(run(ADMIN, { type: 'adminCorrectStep', p: { unitId: UNIT.id, key: 'load_sticker', value: 'Green' } }, state))
      .rejects.toThrow(/not been recorded/i)
    await expect(run(ADMIN, { type: 'adminCorrectStep', p: { unitId: UNIT.id, key: 'load_number', value: '901' } }, state))
      .rejects.toThrow(/nothing changed/i)
    expect(await rows('stepCorrections')).toHaveLength(0)
  })
})

/* One apartment at a time, at the write path.
 *
 * The queue greys out the others and the banner says why, but the refusal has
 * to live where the write happens: a phone on a stale bundle still has the old
 * screen, and the whole point is that this cannot happen again. */
describe('starting a second unit while one is open', () => {
  const packing = { ...UNIT, id: 'unit-1', number: '906', stage: 'packing', crew: { packers: [PACKER.uid], movers: [] } }
  const fresh = { ...UNIT, id: 'unit-2', number: '902', stage: 'not_started', crew: { packers: [], movers: [] } }

  beforeEach(async () => { await setDoc(doc(db, 'units', 'unit-2'), fresh) })

  it('refuses, and names the unit in the way', async () => {
    await setDoc(doc(db, 'units', 'unit-1'), packing)
    await expect(
      run(PACKER, { type: 'completeStep', p: { unitId: 'unit-2', key: 'door' } }, makeState({ units: [packing, fresh] })),
    ).rejects.toThrow(/Finish unit 906 first/i)

    // And wrote nothing, which is the part that matters.
    const u = (await rows('units')).find((x) => x.id === 'unit-2')
    expect(u.steps || {}).toEqual({})
  })

  it('still lets them get on with the unit they have open', async () => {
    await setDoc(doc(db, 'units', 'unit-1'), packing)
    await expect(
      run(PACKER, { type: 'completeStep', p: { unitId: 'unit-1', key: 'rooms' } }, makeState({ units: [packing, fresh] })),
    ).resolves.not.toThrow()
  })

  it('lets the next one start once the first is finished', async () => {
    const done = { ...packing, stage: 'packed' }
    await setDoc(doc(db, 'units', 'unit-1'), done)
    await expect(
      run(PACKER, { type: 'completeStep', p: { unitId: 'unit-2', key: 'door' } }, makeState({ units: [done, fresh] })),
    ).resolves.not.toThrow()
  })

  // A note against a door nobody has opened is exactly what the optional item
  // is for, and it does not start a unit, so it cannot misfile a photo.
  it('never blocks the optional note', async () => {
    await setDoc(doc(db, 'units', 'unit-1'), packing)
    await expect(
      run(PACKER, { type: 'completeStep', p: { unitId: 'unit-2', key: 'notes', note: 'Tenant not home' } }, makeState({ units: [packing, fresh] })),
    ).resolves.not.toThrow()
  })

  it('holds on the mover side too, across every write a load can make', async () => {
    const loading = { ...UNIT, id: 'unit-1', number: '906', stage: 'packed', crew: { packers: [], movers: [MOVER.uid] }, steps: { load_unit_photo: { at: 1, userName: MOVER.name } } }
    const other = { ...UNIT, id: 'unit-2', number: '902', stage: 'packed', crew: { packers: [], movers: [] } }
    await setDoc(doc(db, 'units', 'unit-1'), loading)
    await setDoc(doc(db, 'units', 'unit-2'), other)
    const state = makeState({ units: [loading, other] })

    for (const action of [
      { type: 'completeLoadStep', p: { unitId: 'unit-2', key: 'load_number', value: '902', matched: true } },
      { type: 'startVault', p: { unitId: 'unit-2', number: 'BB-1' } },
      { type: 'logVaultPhoto', p: { unitId: 'unit-2', number: 'BB-1', part: 'open', shots: [{ url: 'a.jpg' }] } },
    ]) {
      await expect(run(MOVER, action, state)).rejects.toThrow(/Finish unit 906 first/i)
    }
  })

  it('does not block an admin, who is the one who untangles things', async () => {
    const adminPacking = { ...packing, crew: { packers: [ADMIN.uid], movers: [] } }
    await setDoc(doc(db, 'units', 'unit-1'), adminPacking)
    await expect(
      run(ADMIN, { type: 'completeStep', p: { unitId: 'unit-2', key: 'door' } }, makeState({ units: [adminPacking, fresh] })),
    ).resolves.not.toThrow()
  })
})

/* Putting a photo back on the apartment it was taken in. */
describe('moving a photo to the right unit', () => {
  const shotOn = (id, over = {}) => ({ id, kind: 'photo', url: `${id}.jpg`, label: 'packed', phase: 'packed', uid: PACKER.uid, userName: PACKER.name, ts: 1000, ...over })
  const A = { ...UNIT, id: 'unit-1', number: '906', media: [shotOn('m1'), shotOn('m2', { kind: 'video' })] }
  const B = { ...UNIT, id: 'unit-2', number: '902', media: [shotOn('m3')] }
  const seedBoth = async () => {
    await setDoc(doc(db, 'units', 'unit-1'), A)
    await setDoc(doc(db, 'units', 'unit-2'), B)
  }
  const unitRow = async (id) => (await rows('units')).find((u) => u.id === id)

  it('takes it off one unit and puts it on the other, unchanged', async () => {
    await seedBoth()
    await run(ADMIN, { type: 'adminMoveMedia', p: { mediaId: 'm1', fromUnitId: 'unit-1', toUnitId: 'unit-2' } }, makeState({ units: [A, B] }))

    expect((await unitRow('unit-1')).media.map((m) => m.id)).toEqual(['m2'])
    const moved = (await unitRow('unit-2')).media.find((m) => m.id === 'm1')
    // Authorship and time are true and must survive the move untouched.
    expect(moved).toMatchObject({ userName: PACKER.name, uid: PACKER.uid, ts: 1000, phase: 'packed' })
  })

  it('logs the move on the receiving unit', async () => {
    await seedBoth()
    await run(ADMIN, { type: 'adminMoveMedia', p: { mediaId: 'm2', fromUnitId: 'unit-1', toUnitId: 'unit-2' } }, makeState({ units: [A, B] }))
    // Written straight to the collection in the same batch as the move, so it
    // cannot land without the move landing too.
    const logged = (await rows('events')).find((e) => e.action && e.action.includes('Moved a video'))
    expect(logged.action).toMatch(/from unit 906 to unit 902/)
    expect(logged.unitId).toBe('unit-2')
    expect(logged.userName).toBe(ADMIN.name)
  })

  // The activity feed reads the event's own copy, so it has to move as well or
  // the old unit keeps showing the other apartment's photos.
  it('moves it on the owning event too, not just the unit', async () => {
    await seedBoth()
    await setDoc(doc(db, 'events', 'ev-a'), { unitId: 'unit-1', type: 'stage', step: 'packed', media: [shotOn('m1'), shotOn('m2')] })
    await setDoc(doc(db, 'events', 'ev-b'), { unitId: 'unit-2', type: 'stage', step: 'packed', media: [shotOn('m3')] })
    const evs = [
      { id: 'ev-a', unitId: 'unit-1', type: 'stage', step: 'packed', media: [shotOn('m1'), shotOn('m2')] },
      { id: 'ev-b', unitId: 'unit-2', type: 'stage', step: 'packed', media: [shotOn('m3')] },
    ]
    await run(ADMIN, { type: 'adminMoveMedia', p: { mediaId: 'm1', fromUnitId: 'unit-1', toUnitId: 'unit-2' } },
      makeState({ units: [A, B], events: evs }))

    const after = await rows('events')
    expect(after.find((e) => e.id === 'ev-a').media.map((m) => m.id)).toEqual(['m2'])
    expect(after.find((e) => e.id === 'ev-b').media.map((m) => m.id)).toEqual(['m3', 'm1'])
  })

  it('refuses to move it twice, or to the unit it is already on', async () => {
    await seedBoth()
    const state = makeState({ units: [A, B] })
    await expect(run(ADMIN, { type: 'adminMoveMedia', p: { mediaId: 'nope', fromUnitId: 'unit-1', toUnitId: 'unit-2' } }, state))
      .rejects.toThrow(/no longer on this unit/i)
    await expect(run(ADMIN, { type: 'adminMoveMedia', p: { mediaId: 'm1', fromUnitId: 'unit-1', toUnitId: 'unit-1' } }, state))
      .rejects.toThrow(/same unit/i)
  })

  it('is for the admin alone', async () => {
    await seedBoth()
    const state = makeState({ units: [A, B] })
    for (const who of [PACKER, MOVER]) {
      await expect(run(who, { type: 'adminMoveMedia', p: { mediaId: 'm1', fromUnitId: 'unit-1', toUnitId: 'unit-2' } }, state))
        .rejects.toThrow(/only an admin/i)
    }
    expect((await unitRow('unit-1')).media).toHaveLength(2)
  })
})

/* Removing a day an admin entered.
 *
 * Casey added Rogelio twice by mistake and one of those days never happened.
 * A back-entry is the admin's own data and has to have a way back; a punched
 * entry is the crew member's own record of their own shift and does not. */
describe('removing a back-entered day', () => {
  const day = {
    clockIn: Date.parse('2026-09-10T16:00:00Z'),
    clockOut: Date.parse('2026-09-10T23:00:00Z'),
    notes: 'Added twice by mistake',
  }

  it('removes it, and keeps what it said where only an admin can read it', async () => {
    await run(ADMIN, { type: 'adminAddTimeEntry', p: { uid: MOVER.uid, ...day } })
    const [entry] = await rows('timeEntries')

    await run(ADMIN, { type: 'adminDeleteTimeEntry', p: { entryId: entry.id } }, makeState({ timeEntries: [entry] }))

    expect(await rows('timeEntries')).toHaveLength(0)
    const [record] = await rows('timeCorrections')
    expect(record).toMatchObject({ entryId: entry.id, uid: MOVER.uid, field: 'deleted', byUid: ADMIN.uid })
    expect(JSON.parse(record.oldValue)).toMatchObject({ clockIn: day.clockIn, clockOut: day.clockOut, notes: day.notes })
  })

  // A punched shift can go too, because the employer keeps the records and
  // blocking it would push the fix somewhere with no trail. It still leaves
  // one, which is what makes it safe to allow.
  it('can remove a punched day, and records that it did', async () => {
    await run(MOVER, { type: 'clockIn' })
    const [punched] = await rows('timeEntries')
    expect(punched.source).toBe('self')

    await run(ADMIN, { type: 'adminDeleteTimeEntry', p: { entryId: punched.id } }, makeState({ timeEntries: [punched] }))

    expect(await rows('timeEntries')).toHaveLength(0)
    const [record] = await rows('timeCorrections')
    expect(record).toMatchObject({ field: 'deleted', uid: MOVER.uid, byUid: ADMIN.uid })
    expect(JSON.parse(record.oldValue).source).toBe('self')
  })

  it('removes only the duplicate, leaving the real one alone', async () => {
    await run(ADMIN, { type: 'adminAddTimeEntry', p: { uid: MOVER.uid, ...day } })
    await run(ADMIN, { type: 'adminAddTimeEntry', p: { uid: MOVER.uid, ...day } })
    const both = await rows('timeEntries')
    expect(both).toHaveLength(2)

    await run(ADMIN, { type: 'adminDeleteTimeEntry', p: { entryId: both[0].id } }, makeState({ timeEntries: both }))
    const left = await rows('timeEntries')
    expect(left).toHaveLength(1)
    expect(left[0].id).toBe(both[1].id)
  })

  it('says so plainly when the entry is already gone', async () => {
    await expect(
      run(ADMIN, { type: 'adminDeleteTimeEntry', p: { entryId: 'ghost' } }, makeState({ timeEntries: [] })),
    ).rejects.toThrow(/gone/i)
  })
})

/* One day per person per day.
 *
 * The picker hides anybody already on the day, but the refusal has to live at
 * the write too: a double-tap on a phone is two calls, and the screen that
 * would have stopped the second one has not re-rendered yet. */
describe('adding the same person to a day twice', () => {
  const day = {
    clockIn: Date.parse('2026-09-10T16:00:00Z'),
    clockOut: Date.parse('2026-09-10T23:00:00Z'),
  }

  it('refuses the second one, and says what to do instead', async () => {
    await run(ADMIN, { type: 'adminAddTimeEntry', p: { uid: MOVER.uid, ...day } })
    const after = await rows('timeEntries')

    await expect(
      run(ADMIN, { type: 'adminAddTimeEntry', p: { uid: MOVER.uid, ...day } }, makeState({ timeEntries: after })),
    ).rejects.toThrow(/already has a day/i)

    expect(await rows('timeEntries')).toHaveLength(1)
  })

  it('refuses even when the times are different, because it is the same day', async () => {
    await run(ADMIN, { type: 'adminAddTimeEntry', p: { uid: MOVER.uid, ...day } })
    const after = await rows('timeEntries')
    await expect(
      run(ADMIN, { type: 'adminAddTimeEntry', p: {
        uid: MOVER.uid, clockIn: Date.parse('2026-09-10T18:00:00Z'), clockOut: Date.parse('2026-09-10T20:00:00Z'),
      } }, makeState({ timeEntries: after })),
    ).rejects.toThrow(/already has a day/i)
  })

  it('refuses to double up on somebody who punched in themselves', async () => {
    await run(MOVER, { type: 'clockIn' })
    const punched = await rows('timeEntries')
    /* Anchored to the punch's own day rather than a fixed date. This used a
     * hard-coded 10 Sep and passed until the clock rolled past midnight, at
     * which point it was comparing two different days and asserting nothing. */
    const start = Date.parse(`${punched[0].day}T16:00:00Z`)
    await expect(
      run(ADMIN, { type: 'adminAddTimeEntry', p: { uid: MOVER.uid, clockIn: start, clockOut: start + 7 * 3600000 } },
        makeState({ timeEntries: punched })),
    ).rejects.toThrow(/already has a day/i)
  })

  it('still lets a different person onto the same day', async () => {
    await run(ADMIN, { type: 'adminAddTimeEntry', p: { uid: MOVER.uid, ...day } })
    const after = await rows('timeEntries')
    await expect(
      run(ADMIN, { type: 'adminAddTimeEntry', p: { uid: PACKER.uid, ...day } }, makeState({ timeEntries: after })),
    ).resolves.not.toThrow()
    expect(await rows('timeEntries')).toHaveLength(2)
  })

  it('still lets the same person onto a different day', async () => {
    await run(ADMIN, { type: 'adminAddTimeEntry', p: { uid: MOVER.uid, ...day } })
    const after = await rows('timeEntries')
    await expect(
      run(ADMIN, { type: 'adminAddTimeEntry', p: {
        uid: MOVER.uid, clockIn: Date.parse('2026-09-11T16:00:00Z'), clockOut: Date.parse('2026-09-11T23:00:00Z'),
      } }, makeState({ timeEntries: after })),
    ).resolves.not.toThrow()
    expect(await rows('timeEntries')).toHaveLength(2)
  })
})

/* The warehouse arrival check, vault by vault.
 *
 * A unit's vaults come off a truck one at a time, sometimes an hour apart, so
 * one box asking for the whole set forced the manager to either wait for the
 * last one or write down a number they had not yet seen. */
describe('booking vaults in at the dock', () => {
  const WAREHOUSE = { uid: 'wh-1', name: 'Jeremy Williams', role: 'warehouse', status: 'active' }
  const shot = { url: 'u', kind: 'photo', uid: MOVER.uid, userName: MOVER.name, at: 1 }
  const full = (n) => ({ number: n, uid: MOVER.uid, userName: MOVER.name, at: 1, open: shot, closed: shot })
  const loaded = { ...UNIT, stage: 'loaded', vaults: [full('BB-1007'), full('BB-1008')], received: [] }
  const unitRow = async () => (await rows('units')).find((u) => u.id === UNIT.id)
  const state = (over = {}) => makeState({ units: [loaded], users: [WAREHOUSE, MOVER, ADMIN], ...over })

  beforeEach(async () => { await setDoc(doc(db, 'units', UNIT.id), loaded) })

  it('records each one under whoever was standing there', async () => {
    await run(WAREHOUSE, { type: 'receiveVault', p: { unitId: UNIT.id, number: ' bb-1007 ' } }, state())
    const u = await unitRow()
    expect(u.received).toHaveLength(1)
    expect(u.received[0]).toMatchObject({ number: 'BB-1007', matched: true, userName: WAREHOUSE.name })
  })

  // The interesting case: a vault that is on the dock but was never logged
  // against this apartment on site.
  it('accepts a vault nobody logged, and flags it rather than refusing it', async () => {
    await run(WAREHOUSE, { type: 'receiveVault', p: { unitId: UNIT.id, number: 'BB-9999' } }, state())
    const u = await unitRow()
    expect(u.received[0]).toMatchObject({ number: 'BB-9999', matched: false })
    expect(events.find((e) => e.type === 'flag').action).toMatch(/UNEXPECTED vault on unit 906: BB-9999/)
  })

  it('refuses the same vault twice', async () => {
    await run(WAREHOUSE, { type: 'receiveVault', p: { unitId: UNIT.id, number: 'BB-1007' } }, state())
    const after = await unitRow()
    await expect(
      run(WAREHOUSE, { type: 'receiveVault', p: { unitId: UNIT.id, number: 'bb-1007' } }, state({ units: [after] })),
    ).rejects.toThrow(/already booked in/i)
  })

  it('will not book anything in on a unit that has not left the building', async () => {
    const stillPacked = { ...loaded, stage: 'packed' }
    await setDoc(doc(db, 'units', UNIT.id), stillPacked)
    await expect(
      run(WAREHOUSE, { type: 'receiveVault', p: { unitId: UNIT.id, number: 'BB-1007' } }, state({ units: [stillPacked] })),
    ).rejects.toThrow(/has not arrived/i)
  })

  it('will not book the unit in until every vault is accounted for', async () => {
    const partial = {
      ...loaded,
      steps: { recv_number: { at: 1, userName: WAREHOUSE.name }, recv_lastname: { at: 2, userName: WAREHOUSE.name } },
      received: [{ number: 'BB-1007', matched: true, at: 3 }],
    }
    await setDoc(doc(db, 'units', UNIT.id), partial)
    await expect(
      run(WAREHOUSE, { type: 'receiveUnit', p: { unitId: UNIT.id } }, state({ units: [partial] })),
    ).rejects.toThrow(/verify the unit number, last name and vault numbers/i)
    expect((await unitRow()).stage).toBe('loaded')
  })

  /* A unit sitting half-received forever is worse than one booked in short
   * with a flag on it, because only one of those gets chased. */
  it('lets the manager say the rest did not come, and raises it', async () => {
    const partial = { ...loaded, received: [{ number: 'BB-1007', matched: true, at: 3 }] }
    await setDoc(doc(db, 'units', UNIT.id), partial)
    await run(WAREHOUSE, { type: 'receiveVaultsShort', p: { unitId: UNIT.id, note: 'Still on the truck' } },
      state({ units: [partial] }))

    const u = await unitRow()
    expect(u.steps.recv_vaults_short).toMatchObject({ userName: WAREHOUSE.name, missing: ['BB-1008'], note: 'Still on the truck' })
    expect(events.find((e) => e.action?.startsWith('SHORT')).action)
      .toMatch(/SHORT on unit 906: 1 vault did not arrive \(BB-1008\).*Still on the truck/)
  })

  it('refuses to report short when everything is here', async () => {
    const all = { ...loaded, received: [{ number: 'BB-1007', at: 1 }, { number: 'BB-1008', at: 2 }] }
    await setDoc(doc(db, 'units', UNIT.id), all)
    await expect(
      run(WAREHOUSE, { type: 'receiveVaultsShort', p: { unitId: UNIT.id } }, state({ units: [all] })),
    ).rejects.toThrow(/every vault is accounted for/i)
  })

  it('books the unit in once all three checks are done', async () => {
    const ready = {
      ...loaded,
      steps: { recv_number: { at: 1, userName: WAREHOUSE.name }, recv_lastname: { at: 2, userName: WAREHOUSE.name } },
      received: [{ number: 'BB-1007', matched: true, at: 3 }, { number: 'BB-1008', matched: true, at: 4 }],
    }
    await setDoc(doc(db, 'units', UNIT.id), ready)
    await run(WAREHOUSE, { type: 'receiveUnit', p: { unitId: UNIT.id } }, state({ units: [ready] }))

    expect((await unitRow()).stage).toBe('at_warehouse')
    expect(events.find((e) => e.type === 'stage').action).toMatch(/2 of 2 vaults booked in/)
  })

  it('says how short it was when it goes in short', async () => {
    const short = {
      ...loaded,
      steps: {
        recv_number: { at: 1, userName: WAREHOUSE.name }, recv_lastname: { at: 2, userName: WAREHOUSE.name },
        recv_vaults_short: { at: 5, userName: WAREHOUSE.name, missing: ['BB-1008'] },
      },
      received: [{ number: 'BB-1007', matched: true, at: 3 }],
    }
    await setDoc(doc(db, 'units', UNIT.id), short)
    await run(WAREHOUSE, { type: 'receiveUnit', p: { unitId: UNIT.id } }, state({ units: [short] }))
    expect(events.find((e) => e.type === 'stage').action).toMatch(/1 of 2 vaults booked in, 1 short/)
  })
})
