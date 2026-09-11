/* The return leg, walked end to end.
 *
 * Written because none of it has ever run. The whole round trip exists in
 * code and has been carefully reasoned about in comments, but the building
 * does not come back until October, so every one of these actions is
 * untested against a real database. A first run in production, on a live job,
 * is the wrong place to discover a typo.
 *
 * This walks one unit from the warehouse all the way back into its apartment,
 * then does it again with the awkward cases: two units sharing a container,
 * a unit that returns in a different container than it left in, and a piece
 * count that does not match.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, getDocs, doc, setDoc } from 'firebase/firestore'

vi.mock('../../src/firebase.js', () => ({ app: {}, auth: {}, db: {}, storage: {}, functions: {} }))
const { makeDispatch } = await import('../../src/store.jsx')

const OPEN_RULES = `rules_version = "2";
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if true; }
  }
}`

vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 })

let testEnv
let db

const WAREHOUSE = { uid: 'wh-1', name: 'Jeremy Williams', role: 'warehouse', status: 'active' }
const MOVER = { uid: 'mv-1', name: 'Victor Mendez', role: 'mover', status: 'active' }
const PACKER = { uid: 'pk-1', name: 'Liv Post', role: 'packer', status: 'active' }
const CREW = { uid: 'cr-1', name: 'Aaron Soto', role: 'crew', status: 'active' }

const events = []
const ctx = (user, state) => ({
  db,
  currentUser: user,
  state,
  ev: async (type, action, extra) => { events.push({ type, action, ...extra }) },
  attributeMedia: (arr = []) => arr.map((m) => ({ ...m, uid: user.uid, userName: user.name, ts: m.ts || 1 })),
})
const run = (user, action, state) => makeDispatch(ctx(user, state))(action)

const unit = (over) => ({
  tenant: 'A Tenant', floor: 9, pieces: 20, crew: { packers: [], movers: [] },
  containerIds: [], media: [], steps: {}, vaults: [], inventory: [], materials: {},
  ...over,
})
const container = (over) => ({ unitIds: [], media: [], ...over })

const baseState = (over = {}) => ({
  units: [], containers: [], overflow: [], events: [], schedule: [],
  users: [WAREHOUSE, MOVER, PACKER, CREW],
  timeEntries: [], unitSessions: [],
  project: { returnPhase: true, name: 'T', address: 'A' },
  ...over,
})

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'movetrack-return-test',
    firestore: { rules: OPEN_RULES, host: '127.0.0.1', port: 8080 },
  })
  db = testEnv.unauthenticatedContext().firestore()
})
afterAll(async () => { await testEnv.cleanup() })
beforeEach(async () => { events.length = 0; await testEnv.clearFirestore() })

const rows = async (name) => (await getDocs(collection(db, name))).docs.map((d) => ({ id: d.id, ...d.data() }))
const unitRow = async (id) => (await rows('units')).find((u) => u.id === id)
const contRow = async (id) => (await rows('containers')).find((c) => c.id === id)

const seed = async (units, containers) => {
  for (const u of units) await setDoc(doc(db, 'units', u.id), u)
  for (const c of containers) await setDoc(doc(db, 'containers', c.id), c)
}

describe('a unit going home', () => {
  const U = unit({ id: 'u1', number: '906', stage: 'at_warehouse' })
  const C = container({ id: 'c1', number: 'BB-1', status: 'at_warehouse' })

  it('walks the whole way back without losing the thread', async () => {
    await seed([U], [C])
    let units = [U]
    let conts = [C]
    const state = () => baseState({ units, containers: conts })
    const refresh = async () => { units = await rows('units'); conts = await rows('containers') }

    await run(WAREHOUSE, { type: 'loadForReturn', p: { unitId: 'u1', containerId: 'c1', pieces: 20, media: [] } }, state())
    await refresh()
    expect((await unitRow('u1')).stage).toBe('return_loaded')
    expect((await contRow('c1')).status).toBe('return_filling')
    // The unit remembers which return trip it is on, separately from every
    // container it has ever ridden.
    expect((await unitRow('u1')).returnContainerId).toBe('c1')

    await run(WAREHOUSE, { type: 'markReturnFull', p: { containerId: 'c1' } }, state())
    await refresh()
    expect((await contRow('c1')).status).toBe('return_full')

    await run(WAREHOUSE, { type: 'dispatchReturn', p: { containerId: 'c1', driverName: 'J Ruiz', media: [] } }, state())
    await refresh()
    expect((await contRow('c1')).status).toBe('return_transit')
    expect((await unitRow('u1')).stage).toBe('return_transit')

    await run(MOVER, { type: 'deliverReturn', p: { containerId: 'c1', media: [] } }, state())
    await refresh()
    expect((await contRow('c1')).status).toBe('back_on_site')
    expect((await unitRow('u1')).stage).toBe('back_on_site')

    await run(MOVER, { type: 'unloadReturn', p: { unitId: 'u1', pieces: 20, media: [] } }, state())
    await refresh()
    expect((await unitRow('u1')).stage).toBe('unloaded')
    // Last unit off, so the container is empty and says so.
    expect((await contRow('c1')).status).toBe('returned_empty')

    await run(PACKER, { type: 'unpackUnit', p: { unitId: 'u1', media: [{ id: 'm1', url: 'x.jpg', kind: 'photo' }] } }, state())
    expect((await unitRow('u1')).stage).toBe('unpacked')
  })

  it('credits return work to its own crew lists, not the outbound ones', async () => {
    await seed([unit({ id: 'u1', number: '906', stage: 'back_on_site', returnContainerId: 'c1' })],
      [container({ id: 'c1', number: 'BB-1', status: 'back_on_site' })])
    const state = baseState({
      units: [unit({ id: 'u1', number: '906', stage: 'back_on_site', returnContainerId: 'c1' })],
      containers: [container({ id: 'c1', number: 'BB-1', status: 'back_on_site' })],
    })
    await run(MOVER, { type: 'unloadReturn', p: { unitId: 'u1', pieces: 20, media: [] } }, state)
    await run(PACKER, { type: 'unpackUnit', p: { unitId: 'u1', media: [] } }, state)

    const u = await unitRow('u1')
    expect(u.crew.unloaders).toEqual([MOVER.uid])
    expect(u.crew.unpackers).toEqual([PACKER.uid])
    // The outbound credit is untouched: a return unloader is not a mover who
    // loaded it, and Reports must not say they were.
    expect(u.crew.movers || []).not.toContain(MOVER.uid)
    expect(u.crew.packers || []).not.toContain(PACKER.uid)
  })
})

describe('two units sharing a container', () => {
  it('only empties the container when the last one is off', async () => {
    const a = unit({ id: 'u1', number: '901', stage: 'back_on_site', returnContainerId: 'c1' })
    const b = unit({ id: 'u2', number: '902', stage: 'back_on_site', returnContainerId: 'c1' })
    const c = container({ id: 'c1', number: 'BB-1', status: 'back_on_site' })
    await seed([a, b], [c])
    const state = () => baseState({ units: [a, b], containers: [c] })

    await run(MOVER, { type: 'unloadReturn', p: { unitId: 'u1', pieces: 20, media: [] } }, state())
    expect((await contRow('c1')).status).toBe('back_on_site')

    const afterFirst = await rows('units')
    await run(MOVER, { type: 'unloadReturn', p: { unitId: 'u2', pieces: 20, media: [] } },
      baseState({ units: afterFirst, containers: [c] }))
    expect((await contRow('c1')).status).toBe('returned_empty')
  })

  /* A unit can come home in a different container than it left in, and its
   * old cargo-mate must not be able to hold that container open forever. */
  it('ignores a former cargo-mate riding a different container home', async () => {
    const a = unit({ id: 'u1', number: '901', stage: 'back_on_site', returnContainerId: 'c1', containerIds: ['c0', 'c1'] })
    const stranger = unit({ id: 'u2', number: '902', stage: 'at_warehouse', returnContainerId: 'c2', containerIds: ['c0', 'c2'] })
    const c1 = container({ id: 'c1', number: 'BB-1', status: 'back_on_site', unitIds: ['u1', 'u2'] })
    await seed([a, stranger], [c1])
    await run(MOVER, { type: 'unloadReturn', p: { unitId: 'u1', pieces: 20, media: [] } },
      baseState({ units: [a, stranger], containers: [c1] }))
    expect((await contRow('c1')).status).toBe('returned_empty')
  })
})

describe('when the count does not match', () => {
  it('flags a short load on the way out of the warehouse', async () => {
    const u = unit({ id: 'u1', number: '906', stage: 'at_warehouse', pieces: 20 })
    const c = container({ id: 'c1', number: 'BB-1', status: 'at_warehouse' })
    await seed([u], [c])
    await run(WAREHOUSE, { type: 'loadForReturn', p: { unitId: 'u1', containerId: 'c1', pieces: 18, media: [] } },
      baseState({ units: [u], containers: [c] }))

    expect((await unitRow('u1')).flag).toMatchObject({ open: true })
    expect(events.find((e) => e.type === 'flag').action).toMatch(/piece count mismatch on return load \(18\/20\)/)
  })

  it('flags a short unload on the way into the apartment', async () => {
    const u = unit({ id: 'u1', number: '906', stage: 'back_on_site', returnContainerId: 'c1', pieces: 20 })
    await seed([u], [container({ id: 'c1', number: 'BB-1', status: 'back_on_site' })])
    await run(MOVER, { type: 'unloadReturn', p: { unitId: 'u1', pieces: 19, media: [] } },
      baseState({ units: [u], containers: [container({ id: 'c1', number: 'BB-1', status: 'back_on_site' })] }))
    expect((await unitRow('u1')).flag).toMatchObject({ open: true })
  })

  // An unresolved flag from the outbound leg must survive the return leg.
  it('never overwrites a flag that is already open', async () => {
    const existing = { message: 'Outbound mismatch, unresolved', ts: 1, by: 'Casey P', open: true }
    const u = unit({ id: 'u1', number: '906', stage: 'at_warehouse', pieces: 20, flag: existing })
    const c = container({ id: 'c1', number: 'BB-1', status: 'at_warehouse' })
    await seed([u], [c])
    await run(WAREHOUSE, { type: 'loadForReturn', p: { unitId: 'u1', containerId: 'c1', pieces: 15, media: [] } },
      baseState({ units: [u], containers: [c] }))
    expect((await unitRow('u1')).flag.message).toBe(existing.message)
  })
})

describe('a container that cannot take the load', () => {
  it('refuses before writing anything, so a unit is never orphaned', async () => {
    const u = unit({ id: 'u1', number: '906', stage: 'at_warehouse' })
    const gone = container({ id: 'c1', number: 'BB-1', status: 'return_transit' })
    await seed([u], [gone])
    await expect(
      run(WAREHOUSE, { type: 'loadForReturn', p: { unitId: 'u1', containerId: 'c1', pieces: 20, media: [] } },
        baseState({ units: [u], containers: [gone] })),
    ).rejects.toThrow(/no longer accepting items for return/i)

    // The unit must be exactly as it was: a half-applied load is the failure
    // this guard exists to prevent.
    expect((await unitRow('u1')).stage).toBe('at_warehouse')
    expect((await unitRow('u1')).returnContainerId).toBeUndefined()
  })

  it('accepts a second unit onto a container already filling for return', async () => {
    const u = unit({ id: 'u2', number: '902', stage: 'at_warehouse' })
    const c = container({ id: 'c1', number: 'BB-1', status: 'return_filling', unitIds: ['u1'] })
    await seed([u], [c])
    await run(WAREHOUSE, { type: 'loadForReturn', p: { unitId: 'u2', containerId: 'c1', pieces: 20, media: [] } },
      baseState({ units: [u], containers: [c] }))
    expect((await unitRow('u2')).stage).toBe('return_loaded')
    expect((await contRow('c1')).unitIds).toEqual(expect.arrayContaining(['u1', 'u2']))
  })
})

describe('dispatch and delivery only move their own units', () => {
  it('leaves a unit on a different return trip alone', async () => {
    const mine = unit({ id: 'u1', number: '901', stage: 'return_loaded', returnContainerId: 'c1' })
    const theirs = unit({ id: 'u2', number: '902', stage: 'return_loaded', returnContainerId: 'c2' })
    const c1 = container({ id: 'c1', number: 'BB-1', status: 'return_full', unitIds: ['u1', 'u2'] })
    await seed([mine, theirs], [c1])
    await run(WAREHOUSE, { type: 'dispatchReturn', p: { containerId: 'c1', driverName: 'J Ruiz', media: [] } },
      baseState({ units: [mine, theirs], containers: [c1] }))

    expect((await unitRow('u1')).stage).toBe('return_transit')
    expect((await unitRow('u2')).stage).toBe('return_loaded')
  })

  it('keeps the outbound custody credit intact on the same container', async () => {
    const u = unit({ id: 'u1', number: '901', stage: 'return_loaded', returnContainerId: 'c1' })
    const c = container({ id: 'c1', number: 'BB-1', status: 'return_full', handoffBy: 'outbound-mover', driverName: 'Outbound Driver', receivedBy: 'outbound-warehouse' })
    await seed([u], [c])
    await run(WAREHOUSE, { type: 'dispatchReturn', p: { containerId: 'c1', driverName: 'Return Driver', media: [] } },
      baseState({ units: [u], containers: [c] }))
    const after = await contRow('c1')
    expect(after.driverName).toBe('Outbound Driver')
    expect(after.returnDriverName).toBe('Return Driver')
    expect(after.receivedBy).toBe('outbound-warehouse')
  })
})

describe('overflow coming home', () => {
  it('goes from the warehouse to the apartment', async () => {
    const item = { id: 'o1', unitId: 'u1', unitNumber: '906', description: 'Piano', stage: 'at_warehouse', media: [] }
    await setDoc(doc(db, 'overflow', 'o1'), item)
    const state = baseState({ overflow: [item] })

    await run(MOVER, { type: 'transportOverflowBack', p: { overflowId: 'o1', media: [] } }, state)
    let o = (await rows('overflow'))[0]
    expect(o.stage).toBe('rt_transit')
    expect(o.returnTransportBy).toBe(MOVER.uid)

    const mid = (await rows('overflow'))
    await run(PACKER, { type: 'returnOverflow', p: { overflowId: 'o1', media: [{ id: 'm', url: 'x.jpg', kind: 'photo' }] } },
      baseState({ overflow: mid }))
    o = (await rows('overflow'))[0]
    expect(o.stage).toBe('returned')
    expect(o.returnedBy).toBe(PACKER.uid)
    expect(o.media).toHaveLength(1)
  })

  it('lets somebody who packs and loads do either end of it', async () => {
    const item = { id: 'o1', unitId: 'u1', unitNumber: '906', description: 'Piano', stage: 'at_warehouse', media: [] }
    await setDoc(doc(db, 'overflow', 'o1'), item)
    await run(CREW, { type: 'transportOverflowBack', p: { overflowId: 'o1', media: [] } }, baseState({ overflow: [item] }))
    expect((await rows('overflow'))[0].stage).toBe('rt_transit')
  })
})

describe('the return phase switch', () => {
  it('keeps the project name and address when it is flipped', async () => {
    await setDoc(doc(db, 'meta', 'project'), { returnPhase: false, name: 'Trinity Manor', address: '3940 Park Blvd' })
    await run({ uid: 'a', name: 'Casey P', role: 'admin' }, { type: 'setReturnPhase', p: { on: true } },
      baseState({ project: { returnPhase: false, name: 'Trinity Manor', address: '3940 Park Blvd' } }))

    const meta = (await getDocs(collection(db, 'meta'))).docs.find((d) => d.id === 'project').data()
    expect(meta).toMatchObject({ returnPhase: true, name: 'Trinity Manor', address: '3940 Park Blvd' })
  })
})
