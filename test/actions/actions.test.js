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
