// Firestore security-rules tests, run against the emulator via
// `npm run test:rules` (firebase emulators:exec --only firestore "vitest run test/rules").
// These are separate from `npm test` (src/lib), which needs no emulator.
//
// Every "allow" case here mirrors a real write from src/store.jsx's
// dispatch() switch, so a passing suite means the live crew flow still
// works under the hardened rules. Every "deny" case proves an out-of-role,
// out-of-stage, edit-after-submit, or identity-tampering write is blocked
// server-side, per docs/superpowers/specs/2026-08-26-security-lock-hardening-design.md.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, addDoc, collection, arrayUnion } from 'firebase/firestore'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const ADMIN = 'admin-1'
const PACKER = 'packer-1'
const MOVER = 'mover-1'
const WAREHOUSE = 'warehouse-1'
const VIEWER = 'viewer-1'
const PENDING = 'pending-1'
const OTHER_PACKER = 'packer-2' // for the "forged event uid" test

let testEnv

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'movetrack-rules-test',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  })
})

afterAll(async () => {
  await testEnv.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    const users = {
      [ADMIN]: { role: 'admin', status: 'active' },
      [PACKER]: { role: 'packer', status: 'active' },
      [MOVER]: { role: 'mover', status: 'active' },
      [WAREHOUSE]: { role: 'warehouse', status: 'active' },
      [VIEWER]: { role: 'viewer', status: 'active' },
      [PENDING]: { role: null, status: 'pending' },
      [OTHER_PACKER]: { role: 'packer', status: 'active' },
    }
    await Promise.all(
      Object.entries(users).map(([uid, u]) =>
        setDoc(doc(db, 'users', uid), { uid, name: `Test ${uid}`, email: `${uid}@test.dev`, ...u })
      )
    )
  })
})

// ---- helpers ----
function dbAs(uid) {
  return testEnv.authenticatedContext(uid).firestore()
}
async function seed(col, id, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), col, id), data)
  })
}
function baseUnit(overrides = {}) {
  return {
    number: 'A101',
    tenant: 'Tenant X',
    floor: 3,
    stage: 'not_started',
    crew: { packers: [], movers: [] },
    containerIds: [],
    media: [],
    inventory: [],
    materials: {},
    createdAt: 1000,
    ...overrides,
  }
}
function baseContainer(overrides = {}) {
  return { number: 'BB-1', status: 'empty', unitIds: [], deliveredAt: 1000, ...overrides }
}
function baseOverflow(overrides = {}) {
  return {
    unitId: 'unit-1',
    unitNumber: 'A101',
    unitTenant: 'Tenant X',
    floor: 3,
    description: 'Piano',
    stage: 'identified',
    media: [],
    createdBy: PACKER,
    createdAt: 1000,
    ...overrides,
  }
}

// =====================================================================
// 1. packer: start/finish packing allowed; loading (mover's job) denied;
//    editing a packed unit's tenant denied.
// =====================================================================
describe('units — packer', () => {
  it('startPacking: not_started -> packing allowed', async () => {
    await seed('units', 'u1', baseUnit({ stage: 'not_started' }))
    await assertSucceeds(
      updateDoc(doc(dbAs(PACKER), 'units', 'u1'), {
        stage: 'packing',
        'crew.packers': arrayUnion(PACKER),
        'times.packStart': 1,
      })
    )
  })

  it('finishPacking: packing -> packed allowed', async () => {
    await seed('units', 'u1', baseUnit({ stage: 'packing' }))
    await assertSucceeds(
      updateDoc(doc(dbAs(PACKER), 'units', 'u1'), {
        stage: 'packed',
        pieces: 12,
        'times.packEnd': 1,
        media: arrayUnion({ id: 'm1', kind: 'photo', url: 'x' }),
      })
    )
  })

  it('packer loading a packed unit (mover job) denied', async () => {
    await seed('units', 'u1', baseUnit({ stage: 'packed' }))
    await assertFails(
      updateDoc(doc(dbAs(PACKER), 'units', 'u1'), {
        stage: 'loaded',
        containerIds: arrayUnion('c1'),
        'crew.movers': arrayUnion(PACKER),
      })
    )
  })

  it('packer editing a packed unit tenant denied', async () => {
    await seed('units', 'u1', baseUnit({ stage: 'packed' }))
    await assertFails(updateDoc(doc(dbAs(PACKER), 'units', 'u1'), { tenant: 'New Name' }))
  })
})

// =====================================================================
// 2. mover: load/markFull/swap allowed on right stages; warehouse receive
//    denied; editing a picked_up unit denied.
// =====================================================================
describe('units/containers — mover', () => {
  it('loadUnit: unit packed -> loaded allowed', async () => {
    await seed('units', 'u1', baseUnit({ stage: 'packed', pieces: 5 }))
    await assertSucceeds(
      updateDoc(doc(dbAs(MOVER), 'units', 'u1'), {
        stage: 'loaded',
        containerIds: arrayUnion('c1'),
        'crew.movers': arrayUnion(MOVER),
      })
    )
  })

  it('loadUnit: container empty -> filling allowed', async () => {
    await seed('containers', 'c1', baseContainer({ status: 'empty', unitIds: [] }))
    await assertSucceeds(
      updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), {
        status: 'filling',
        unitIds: arrayUnion('u1'),
      })
    )
  })

  it('markContainerFull: filling -> full allowed', async () => {
    await seed('containers', 'c1', baseContainer({ status: 'filling', unitIds: ['u1'] }))
    await assertSucceeds(updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), { status: 'full' }))
  })

  it('bigboxSwap: container full -> picked_up allowed', async () => {
    await seed('containers', 'c1', baseContainer({ status: 'full', unitIds: ['u1'] }))
    await assertSucceeds(
      updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), {
        status: 'picked_up',
        driverName: 'Dave',
        pickedUpAt: 1,
        handoffBy: MOVER,
      })
    )
  })

  it('bigboxSwap: units inside a full container loaded -> picked_up allowed', async () => {
    await seed('units', 'u1', baseUnit({ stage: 'loaded' }))
    await assertSucceeds(updateDoc(doc(dbAs(MOVER), 'units', 'u1'), { stage: 'picked_up' }))
  })

  it('mover doing warehouse receive (picked_up -> at_warehouse) denied', async () => {
    await seed('containers', 'c1', baseContainer({ status: 'picked_up', unitIds: ['u1'] }))
    await assertFails(
      updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), {
        status: 'at_warehouse',
        bay: 'B1',
        verifiedPieces: 5,
        receivedBy: MOVER,
        warehouseAt: 1,
      })
    )
  })

  it('mover editing a picked_up unit (no stage change) denied', async () => {
    await seed('units', 'u1', baseUnit({ stage: 'picked_up' }))
    await assertFails(updateDoc(doc(dbAs(MOVER), 'units', 'u1'), { tenant: 'Renamed' }))
  })
})

// =====================================================================
// 3. warehouse: receive allowed; loading a unit denied.
// =====================================================================
describe('units/containers — warehouse', () => {
  it('warehouseReceive: container picked_up -> at_warehouse allowed', async () => {
    await seed('containers', 'c1', baseContainer({ status: 'picked_up', unitIds: ['u1'] }))
    await assertSucceeds(
      updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), {
        status: 'at_warehouse',
        bay: 'B1',
        verifiedPieces: 5,
        receivedBy: WAREHOUSE,
        warehouseAt: 1,
      })
    )
  })

  it('warehouseReceive: unit picked_up -> at_warehouse allowed', async () => {
    await seed('units', 'u1', baseUnit({ stage: 'picked_up' }))
    await assertSucceeds(updateDoc(doc(dbAs(WAREHOUSE), 'units', 'u1'), { stage: 'at_warehouse' }))
  })

  it('warehouse loading a unit (packed -> loaded) denied', async () => {
    await seed('units', 'u1', baseUnit({ stage: 'packed' }))
    await assertFails(updateDoc(doc(dbAs(WAREHOUSE), 'units', 'u1'), { stage: 'loaded' }))
  })
})

// =====================================================================
// 4. Regression guard: second load into an already-filling container
//    (filling -> filling, no status change) must still be allowed.
// =====================================================================
describe('containers — second load regression guard', () => {
  it('mover loading a second unit into a filling container allowed', async () => {
    await seed('containers', 'c1', baseContainer({ status: 'filling', unitIds: ['u1'] }))
    await assertSucceeds(
      updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), {
        status: 'filling',
        unitIds: arrayUnion('u2'),
      })
    )
  })
})

// =====================================================================
// 5. Identity-field tampering during an otherwise-valid transition denied.
// =====================================================================
describe('identity fields locked on non-admin update', () => {
  it('packer changing unit number while starting packing denied', async () => {
    await seed('units', 'u1', baseUnit({ stage: 'not_started' }))
    await assertFails(updateDoc(doc(dbAs(PACKER), 'units', 'u1'), { stage: 'packing', number: 'B999' }))
  })

  it('packer changing unit floor while finishing packing denied', async () => {
    await seed('units', 'u1', baseUnit({ stage: 'packing' }))
    await assertFails(updateDoc(doc(dbAs(PACKER), 'units', 'u1'), { stage: 'packed', floor: 9 }))
  })

  it('mover changing container number while loading denied', async () => {
    await seed('containers', 'c1', baseContainer({ status: 'empty' }))
    await assertFails(updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), { status: 'filling', number: 'ZZ-9' }))
  })

  it('mover changing overflow unitNumber while prepping denied', async () => {
    await seed('overflow', 'o1', baseOverflow({ stage: 'identified' }))
    await assertFails(
      updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), { stage: 'prepped', unitNumber: 'B999' })
    )
  })
})

// =====================================================================
// 6. Admin: edit any doc at any stage allowed; resolving a flag (no stage
//    change) allowed; admin is exempt from the identity-field lock.
// =====================================================================
describe('admin bypass', () => {
  it('admin editing a unit tenant at any stage allowed (editUnit)', async () => {
    await seed('units', 'u1', baseUnit({ stage: 'loaded' }))
    await assertSucceeds(updateDoc(doc(dbAs(ADMIN), 'units', 'u1'), { tenant: 'Corrected Name' }))
  })

  it('admin changing a unit number (identity field) allowed', async () => {
    await seed('units', 'u1', baseUnit({ stage: 'packed' }))
    await assertSucceeds(updateDoc(doc(dbAs(ADMIN), 'units', 'u1'), { number: 'A102' }))
  })

  it('admin resolving a unit flag (no stage change) allowed', async () => {
    await seed('units', 'u1', baseUnit({ stage: 'loaded', flag: { message: 'mismatch', open: true } }))
    await assertSucceeds(updateDoc(doc(dbAs(ADMIN), 'units', 'u1'), { 'flag.open': false }))
  })

  it('admin resolving a container flag (no status change) allowed', async () => {
    await seed('containers', 'c1', baseContainer({ status: 'at_warehouse', flag: { message: 'mismatch', open: true } }))
    await assertSucceeds(updateDoc(doc(dbAs(ADMIN), 'containers', 'c1'), { 'flag.open': false }))
  })

  it('admin resolving an overflow flag (no stage change) allowed', async () => {
    await seed('overflow', 'o1', baseOverflow({ stage: 'at_warehouse', flag: { message: 'mismatch', open: true } }))
    await assertSucceeds(updateDoc(doc(dbAs(ADMIN), 'overflow', 'o1'), { 'flag.open': false }))
  })

  it('admin editing overflow description (editOverflow) allowed', async () => {
    await seed('overflow', 'o1', baseOverflow({ stage: 'prepped' }))
    await assertSucceeds(updateDoc(doc(dbAs(ADMIN), 'overflow', 'o1'), { description: 'Grand piano' }))
  })

  it('admin deleting a unit allowed', async () => {
    await seed('units', 'u1', baseUnit())
    await assertSucceeds(deleteDoc(doc(dbAs(ADMIN), 'units', 'u1')))
  })
})

// =====================================================================
// 7. viewer writing anything denied; pending user reading the board denied.
// =====================================================================
describe('viewer / pending access', () => {
  it('viewer writing a unit denied', async () => {
    await seed('units', 'u1', baseUnit({ stage: 'not_started' }))
    await assertFails(updateDoc(doc(dbAs(VIEWER), 'units', 'u1'), { stage: 'packing' }))
  })

  it('viewer reading units allowed (read-only role)', async () => {
    await seed('units', 'u1', baseUnit())
    await assertSucceeds(getDoc(doc(dbAs(VIEWER), 'units', 'u1')))
  })

  it('pending user reading the board denied', async () => {
    await seed('units', 'u1', baseUnit())
    await assertFails(getDocs(collection(dbAs(PENDING), 'units')))
  })

  it('pending user writing a unit denied', async () => {
    await seed('units', 'u1', baseUnit({ stage: 'not_started' }))
    await assertFails(updateDoc(doc(dbAs(PENDING), 'units', 'u1'), { stage: 'packing' }))
  })
})

// =====================================================================
// 8. create rules: wrong initial stage denied; right stage + right role
//    allowed; wrong role denied.
// =====================================================================
describe('create rules', () => {
  it('createUnit: packer at not_started allowed', async () => {
    await assertSucceeds(addDoc(collection(dbAs(PACKER), 'units'), baseUnit({ stage: 'not_started' })))
  })

  it('createUnit: admin at not_started allowed', async () => {
    await assertSucceeds(addDoc(collection(dbAs(ADMIN), 'units'), baseUnit({ stage: 'not_started' })))
  })

  it('createUnit: packer at wrong initial stage denied', async () => {
    await assertFails(addDoc(collection(dbAs(PACKER), 'units'), baseUnit({ stage: 'packing' })))
  })

  it('createUnit: mover (wrong role) denied', async () => {
    await assertFails(addDoc(collection(dbAs(MOVER), 'units'), baseUnit({ stage: 'not_started' })))
  })

  it('logEmpties: mover creating an empty container allowed', async () => {
    await assertSucceeds(addDoc(collection(dbAs(MOVER), 'containers'), baseContainer({ status: 'empty', unitIds: [] })))
  })

  it('createContainer: admin allowed', async () => {
    await assertSucceeds(addDoc(collection(dbAs(ADMIN), 'containers'), baseContainer({ status: 'empty', unitIds: [] })))
  })

  it('createContainer: wrong initial status denied', async () => {
    await assertFails(addDoc(collection(dbAs(MOVER), 'containers'), baseContainer({ status: 'filling', unitIds: [] })))
  })

  it('createContainer: packer (wrong role) denied', async () => {
    await assertFails(addDoc(collection(dbAs(PACKER), 'containers'), baseContainer({ status: 'empty', unitIds: [] })))
  })

  it('createOverflow: packer at identified allowed', async () => {
    await assertSucceeds(addDoc(collection(dbAs(PACKER), 'overflow'), baseOverflow({ stage: 'identified' })))
  })

  it('createOverflow: mover at identified allowed', async () => {
    await assertSucceeds(addDoc(collection(dbAs(MOVER), 'overflow'), baseOverflow({ stage: 'identified' })))
  })

  it('createOverflow: warehouse (wrong role) denied', async () => {
    await assertFails(addDoc(collection(dbAs(WAREHOUSE), 'overflow'), baseOverflow({ stage: 'identified' })))
  })

  it('createOverflow: wrong initial stage denied', async () => {
    await assertFails(addDoc(collection(dbAs(MOVER), 'overflow'), baseOverflow({ stage: 'prepped' })))
  })
})

// =====================================================================
// 9. events: forged uid denied; own uid allowed; update/delete admin only.
// =====================================================================
describe('events — append-only accountability log', () => {
  it('crew logging its own event allowed', async () => {
    await assertSucceeds(
      addDoc(collection(dbAs(PACKER), 'events'), {
        uid: PACKER,
        userName: 'Test packer-1',
        role: 'packer',
        type: 'stage',
        action: 'Started packing unit A101',
        ts: 1,
      })
    )
  })

  it('crew forging another user uid on an event denied', async () => {
    await assertFails(
      addDoc(collection(dbAs(PACKER), 'events'), {
        uid: OTHER_PACKER,
        userName: 'Test packer-2',
        role: 'packer',
        type: 'stage',
        action: 'Started packing unit A101',
        ts: 1,
      })
    )
  })

  it('admin logging an event with its own uid allowed', async () => {
    await assertSucceeds(
      addDoc(collection(dbAs(ADMIN), 'events'), {
        uid: ADMIN,
        userName: 'Test admin-1',
        role: 'admin',
        type: 'system',
        action: 'Admin edited unit details',
        ts: 1,
      })
    )
  })

  it('crew updating an existing event denied', async () => {
    await seed('events', 'e1', { uid: PACKER, userName: 'Test packer-1', role: 'packer', type: 'stage', action: 'x', ts: 1 })
    await assertFails(updateDoc(doc(dbAs(PACKER), 'events', 'e1'), { action: 'edited' }))
  })

  it('crew deleting an existing event denied', async () => {
    await seed('events', 'e1', { uid: PACKER, userName: 'Test packer-1', role: 'packer', type: 'stage', action: 'x', ts: 1 })
    await assertFails(deleteDoc(doc(dbAs(PACKER), 'events', 'e1')))
  })

  it('admin updating an existing event allowed', async () => {
    await seed('events', 'e1', { uid: PACKER, userName: 'Test packer-1', role: 'packer', type: 'stage', action: 'x', ts: 1 })
    await assertSucceeds(updateDoc(doc(dbAs(ADMIN), 'events', 'e1'), { action: 'corrected' }))
  })

  it('admin deleting an existing event allowed', async () => {
    await seed('events', 'e1', { uid: PACKER, userName: 'Test packer-1', role: 'packer', type: 'stage', action: 'x', ts: 1 })
    await assertSucceeds(deleteDoc(doc(dbAs(ADMIN), 'events', 'e1')))
  })
})

// =====================================================================
// 10. schedule: non-admin write denied; admin write allowed.
// =====================================================================
describe('schedule — admin only (unchanged)', () => {
  it('non-admin writing schedule denied', async () => {
    await assertFails(setDoc(doc(dbAs(PACKER), 'schedule', 's1'), { title: 'Move day', date: '2026-09-08' }))
  })

  it('admin writing schedule allowed', async () => {
    await assertSucceeds(setDoc(doc(dbAs(ADMIN), 'schedule', 's1'), { title: 'Move day', date: '2026-09-08' }))
  })
})

// =====================================================================
// Extra dispatch-parity coverage: overflow prep/transport/receive, and
// user-management writes, mirroring the remaining store.jsx actions.
// =====================================================================
describe('overflow lifecycle — dispatch parity', () => {
  it('prepOverflow: identified -> prepped allowed for mover', async () => {
    await seed('overflow', 'o1', baseOverflow({ stage: 'identified' }))
    await assertSucceeds(
      updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), {
        stage: 'prepped',
        preppedAt: 1,
        prepBy: MOVER,
        media: arrayUnion({ id: 'm1', kind: 'photo', url: 'x' }),
      })
    )
  })

  it('transportOverflow: prepped -> in_transit allowed for mover', async () => {
    await seed('overflow', 'o1', baseOverflow({ stage: 'prepped' }))
    await assertSucceeds(
      updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), { stage: 'in_transit', transitAt: 1, transportBy: MOVER })
    )
  })

  it('receiveOverflow: in_transit -> at_warehouse allowed for warehouse', async () => {
    await seed('overflow', 'o1', baseOverflow({ stage: 'in_transit' }))
    await assertSucceeds(
      updateDoc(doc(dbAs(WAREHOUSE), 'overflow', 'o1'), {
        stage: 'at_warehouse',
        warehouseAt: 1,
        receivedBy: WAREHOUSE,
        warehouseLocation: 'Rack 4',
      })
    )
  })

  it('packer cannot update overflow at all (create-only role)', async () => {
    await seed('overflow', 'o1', baseOverflow({ stage: 'identified' }))
    await assertFails(updateDoc(doc(dbAs(PACKER), 'overflow', 'o1'), { stage: 'prepped' }))
  })
})

describe('user management — admin only (unchanged)', () => {
  it('admin approving a pending user allowed', async () => {
    await assertSucceeds(updateDoc(doc(dbAs(ADMIN), 'users', PENDING), { status: 'active', role: 'packer' }))
  })

  it('non-admin approving a pending user denied', async () => {
    await assertFails(updateDoc(doc(dbAs(PACKER), 'users', PENDING), { status: 'active', role: 'packer' }))
  })

  it('signup: a user creating their own pending doc allowed', async () => {
    await assertSucceeds(
      setDoc(doc(dbAs('new-user-1'), 'users', 'new-user-1'), {
        uid: 'new-user-1',
        name: 'New Person',
        email: 'new@test.dev',
        role: null,
        status: 'pending',
      })
    )
  })
})
