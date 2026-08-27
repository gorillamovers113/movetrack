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

  it('warehouse loading a second unit into a return_filling container allowed', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_filling', unitIds: ['u1'] }))
    await assertSucceeds(
      updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), {
        status: 'return_filling',
        unitIds: arrayUnion('u2'),
      })
    )
  })

  // Continuation (the container already entered the return leg to reach
  // return_filling in the first place): a second load stays allowed even if
  // an admin has since toggled returnPhase off
  // (docs/superpowers/specs/2026-08-27-return-leg-correctness-fixes.md #2).
  it('warehouse loading a second unit into a return_filling container, returnPhase OFF: still allowed', async () => {
    await setReturnPhase(false)
    await seed('containers', 'c1', baseContainer({ status: 'return_filling', unitIds: ['u1'] }))
    await assertSucceeds(
      updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), {
        status: 'return_filling',
        unitIds: arrayUnion('u2'),
      })
    )
  })
})

// =====================================================================
// 4b. Container self-loop lock: a filling->filling (or return_filling->
//     return_filling) no-op status write must only be able to touch the
//     fields the real second-load dispatch touches (status, unitIds), not
//     media/driverName/bay/flag, which would let a direct write alter an
//     already-filling container with no event trail.
// =====================================================================
describe('containers - self-loop field lock', () => {
  it('mover self-loop also changing media denied', async () => {
    await seed('containers', 'c1', baseContainer({ status: 'filling', unitIds: ['u1'] }))
    await assertFails(
      updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), {
        status: 'filling',
        unitIds: arrayUnion('u2'),
        media: arrayUnion({ id: 'm1', kind: 'photo', url: 'x' }),
      })
    )
  })

  it('mover self-loop also changing driverName denied', async () => {
    await seed('containers', 'c1', baseContainer({ status: 'filling', unitIds: ['u1'] }))
    await assertFails(
      updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), { status: 'filling', driverName: 'Dave' })
    )
  })

  it('mover self-loop also changing bay denied', async () => {
    await seed('containers', 'c1', baseContainer({ status: 'filling', unitIds: ['u1'] }))
    await assertFails(
      updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), { status: 'filling', bay: 'B1' })
    )
  })

  it('mover self-loop also opening a flag denied', async () => {
    await seed('containers', 'c1', baseContainer({ status: 'filling', unitIds: ['u1'] }))
    await assertFails(
      updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), {
        status: 'filling',
        flag: { message: 'tamper', ts: 1, by: 'x', open: true },
      })
    )
  })

  it('warehouse return self-loop also changing bay denied', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_filling', unitIds: ['u1'] }))
    await assertFails(
      updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), { status: 'return_filling', bay: 'B2' })
    )
  })

  it('warehouse return self-loop also changing media denied', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_filling', unitIds: ['u1'] }))
    await assertFails(
      updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), {
        status: 'return_filling',
        media: arrayUnion({ id: 'm1', kind: 'photo', url: 'x' }),
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
    await assertSucceeds(
      addDoc(collection(dbAs(MOVER), 'overflow'), baseOverflow({ stage: 'identified', createdBy: MOVER }))
    )
  })

  it('createOverflow: warehouse (wrong role) denied', async () => {
    await assertFails(
      addDoc(collection(dbAs(WAREHOUSE), 'overflow'), baseOverflow({ stage: 'identified', createdBy: WAREHOUSE }))
    )
  })

  it('createOverflow: wrong initial stage denied', async () => {
    await assertFails(addDoc(collection(dbAs(MOVER), 'overflow'), baseOverflow({ stage: 'prepped' })))
  })

  it('createOverflow: mover forging createdBy as another user denied', async () => {
    await assertFails(
      addDoc(collection(dbAs(MOVER), 'overflow'), baseOverflow({ stage: 'identified', createdBy: PACKER }))
    )
  })

  it('createOverflow: packer forging createdBy as another user denied', async () => {
    await assertFails(
      addDoc(collection(dbAs(PACKER), 'overflow'), baseOverflow({ stage: 'identified', createdBy: OTHER_PACKER }))
    )
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
// 9b. Custody attribution fields (receivedBy/handoffBy/prepBy/transportBy/
//     returnedBy) must equal the caller's own uid on a non-admin write.
//     Mirrors the events.uid guard, but for the fields that record who
//     physically handled a handoff on units/containers/overflow.
// =====================================================================
describe('custody attribution fields locked to the actor', () => {
  it('warehouseReceive: receivedBy == own uid allowed', async () => {
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

  it('warehouseReceive: receivedBy forged as another user denied', async () => {
    await seed('containers', 'c1', baseContainer({ status: 'picked_up', unitIds: ['u1'] }))
    await assertFails(
      updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), {
        status: 'at_warehouse',
        bay: 'B1',
        verifiedPieces: 5,
        receivedBy: PACKER,
        warehouseAt: 1,
      })
    )
  })

  it('bigboxSwap: handoffBy == own uid allowed', async () => {
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

  it('bigboxSwap: handoffBy forged as another user denied', async () => {
    await seed('containers', 'c1', baseContainer({ status: 'full', unitIds: ['u1'] }))
    await assertFails(
      updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), {
        status: 'picked_up',
        driverName: 'Dave',
        pickedUpAt: 1,
        handoffBy: OTHER_PACKER,
      })
    )
  })

  it('deliverReturn: returnReceivedBy forged as another user denied', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_transit', unitIds: ['u1'] }))
    await assertFails(
      updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), {
        status: 'back_on_site',
        returnReceivedBy: WAREHOUSE,
        returnDeliveredAt: 1,
      })
    )
  })

  it('deliverReturn: returnReceivedBy == own uid allowed', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_transit', unitIds: ['u1'] }))
    await assertSucceeds(
      updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), {
        status: 'back_on_site',
        returnReceivedBy: MOVER,
        returnDeliveredAt: 1,
      })
    )
  })

  it('dispatchReturn: returnHandoffBy forged as another user denied', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_full', unitIds: ['u1'] }))
    await assertFails(
      updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), {
        status: 'return_transit',
        returnDriverName: 'Dave',
        returnDispatchedAt: 1,
        returnHandoffBy: MOVER,
      })
    )
  })

  it('dispatchReturn: returnHandoffBy == own uid allowed', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_full', unitIds: ['u1'] }))
    await assertSucceeds(
      updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), {
        status: 'return_transit',
        returnDriverName: 'Dave',
        returnDispatchedAt: 1,
        returnHandoffBy: WAREHOUSE,
      })
    )
  })

  it('prepOverflow: prepBy == own uid allowed', async () => {
    await seed('overflow', 'o1', baseOverflow({ stage: 'identified' }))
    await assertSucceeds(
      updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), { stage: 'prepped', preppedAt: 1, prepBy: MOVER })
    )
  })

  it('prepOverflow: prepBy forged as another user denied', async () => {
    await seed('overflow', 'o1', baseOverflow({ stage: 'identified' }))
    await assertFails(
      updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), { stage: 'prepped', preppedAt: 1, prepBy: OTHER_PACKER })
    )
  })

  it('transportOverflow: transportBy == own uid allowed', async () => {
    await seed('overflow', 'o1', baseOverflow({ stage: 'prepped' }))
    await assertSucceeds(
      updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), { stage: 'in_transit', transitAt: 1, transportBy: MOVER })
    )
  })

  it('transportOverflow: transportBy forged as another user denied', async () => {
    await seed('overflow', 'o1', baseOverflow({ stage: 'prepped' }))
    await assertFails(
      updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), { stage: 'in_transit', transitAt: 1, transportBy: OTHER_PACKER })
    )
  })

  it('receiveOverflow: receivedBy forged as another user denied', async () => {
    await seed('overflow', 'o1', baseOverflow({ stage: 'in_transit' }))
    await assertFails(
      updateDoc(doc(dbAs(WAREHOUSE), 'overflow', 'o1'), {
        stage: 'at_warehouse',
        warehouseAt: 1,
        receivedBy: MOVER,
        warehouseLocation: 'Rack 4',
      })
    )
  })

  it('transportOverflowBack: returnTransportBy forged as another user denied', async () => {
    await setReturnPhase(true)
    await seed('overflow', 'o1', baseOverflow({ stage: 'at_warehouse' }))
    await assertFails(
      updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), { stage: 'rt_transit', rtTransitAt: 1, returnTransportBy: OTHER_PACKER })
    )
  })

  it('transportOverflowBack: returnTransportBy == own uid allowed', async () => {
    await setReturnPhase(true)
    await seed('overflow', 'o1', baseOverflow({ stage: 'at_warehouse' }))
    await assertSucceeds(
      updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), { stage: 'rt_transit', rtTransitAt: 1, returnTransportBy: MOVER })
    )
  })

  it('returnOverflow: returnedBy == own uid allowed', async () => {
    await setReturnPhase(true)
    await seed('overflow', 'o1', baseOverflow({ stage: 'rt_transit' }))
    await assertSucceeds(
      updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), { stage: 'returned', returnedAt: 1, returnedBy: MOVER })
    )
  })

  it('returnOverflow: returnedBy forged as another user denied', async () => {
    await setReturnPhase(true)
    await seed('overflow', 'o1', baseOverflow({ stage: 'rt_transit' }))
    await assertFails(
      updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), { stage: 'returned', returnedAt: 1, returnedBy: OTHER_PACKER })
    )
  })

  it('admin may set receivedBy to any uid (bypass)', async () => {
    await seed('containers', 'c1', baseContainer({ status: 'picked_up', unitIds: ['u1'] }))
    await assertSucceeds(
      updateDoc(doc(dbAs(ADMIN), 'containers', 'c1'), {
        status: 'at_warehouse',
        bay: 'B1',
        verifiedPieces: 5,
        receivedBy: WAREHOUSE,
        warehouseAt: 1,
      })
    )
  })

  // Regression: a custody field stamped by an earlier stage (by a different
  // actor) must not block a later, unrelated write that never touches that
  // field. Without diffing against the pre-write doc, request.resource.data
  // (the full post-write doc) still carries the old value forward, and a
  // naive "value == request.auth.uid" check would wrongly deny every later
  // step in the chain.
  it('warehouseReceive allowed even though the container already carries a different user\'s handoffBy from bigboxSwap', async () => {
    await seed('containers', 'c1', baseContainer({ status: 'picked_up', unitIds: ['u1'], handoffBy: MOVER, driverName: 'Dave', pickedUpAt: 1 }))
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

  it('deliverReturn allowed even though the container already carries a different user\'s returnHandoffBy from dispatchReturn', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_transit', unitIds: ['u1'], returnHandoffBy: WAREHOUSE, returnDriverName: 'Dave', returnDispatchedAt: 1 }))
    await assertSucceeds(
      updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), {
        status: 'back_on_site',
        returnReceivedBy: MOVER,
        returnDeliveredAt: 1,
      })
    )
  })

  it('receiveOverflow allowed even though the item already carries a different user\'s prepBy from prepOverflow', async () => {
    await seed('overflow', 'o1', baseOverflow({ stage: 'in_transit', prepBy: MOVER, preppedAt: 1, transportBy: MOVER, transitAt: 1 }))
    await assertSucceeds(
      updateDoc(doc(dbAs(WAREHOUSE), 'overflow', 'o1'), {
        stage: 'at_warehouse',
        warehouseAt: 1,
        receivedBy: WAREHOUSE,
        warehouseLocation: 'Rack 4',
      })
    )
  })

  it('a carried-over custody field still cannot be reassigned to a third uid in the same write', async () => {
    await seed('containers', 'c1', baseContainer({ status: 'picked_up', unitIds: ['u1'], handoffBy: MOVER, driverName: 'Dave', pickedUpAt: 1 }))
    await assertFails(
      updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), {
        status: 'at_warehouse',
        bay: 'B1',
        verifiedPieces: 5,
        receivedBy: WAREHOUSE,
        warehouseAt: 1,
        handoffBy: OTHER_PACKER,
      })
    )
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

// =====================================================================
// 11. Return phase (docs/superpowers/specs/2026-08-26-return-phase-design.md
//     §6). Every new return dispatch action from src/store.jsx must be
//     permitted only when meta/project.returnPhase is true, by the exact
//     role that owns that reverse step, and only from the right before-stage.
//     Outbound rules above must stay untouched (regression coverage lives
//     in the sections above; this section is additive).
// =====================================================================

async function setReturnPhase(on) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'meta', 'project'), { returnPhase: on, name: 'Trinity Manor', address: '3940 Park Blvd' })
  })
}

describe('meta/project — return phase switch', () => {
  it('admin writing meta/project (setReturnPhase on) allowed', async () => {
    await assertSucceeds(
      setDoc(doc(dbAs(ADMIN), 'meta', 'project'), { returnPhase: true, name: 'Trinity Manor', address: '3940 Park Blvd' })
    )
  })

  it('non-admin writing meta/project denied', async () => {
    await assertFails(
      setDoc(doc(dbAs(WAREHOUSE), 'meta', 'project'), { returnPhase: true, name: 'Trinity Manor', address: '3940 Park Blvd' })
    )
  })

  it('viewer writing meta/project denied', async () => {
    await assertFails(
      setDoc(doc(dbAs(VIEWER), 'meta', 'project'), { returnPhase: true, name: 'Trinity Manor', address: '3940 Park Blvd' })
    )
  })

  it('active user reading meta/project allowed', async () => {
    await setReturnPhase(true)
    await assertSucceeds(getDoc(doc(dbAs(WAREHOUSE), 'meta', 'project')))
  })

  it('pending user reading meta/project denied', async () => {
    await setReturnPhase(true)
    await assertFails(getDoc(doc(dbAs(PENDING), 'meta', 'project')))
  })
})

describe('return phase — loadForReturn (warehouse: unit at_warehouse -> return_loaded)', () => {
  it('warehouse, returnPhase on, right stage: allowed', async () => {
    await setReturnPhase(true)
    await seed('units', 'u1', baseUnit({ stage: 'at_warehouse', pieces: 12 }))
    await assertSucceeds(
      updateDoc(doc(dbAs(WAREHOUSE), 'units', 'u1'), {
        stage: 'return_loaded',
        containerIds: arrayUnion('c1'),
      })
    )
  })

  it('warehouse, returnPhase OFF: denied', async () => {
    await setReturnPhase(false)
    await seed('units', 'u1', baseUnit({ stage: 'at_warehouse', pieces: 12 }))
    await assertFails(
      updateDoc(doc(dbAs(WAREHOUSE), 'units', 'u1'), { stage: 'return_loaded', containerIds: arrayUnion('c1') })
    )
  })

  it('wrong role (mover), returnPhase on: denied', async () => {
    await setReturnPhase(true)
    await seed('units', 'u1', baseUnit({ stage: 'at_warehouse', pieces: 12 }))
    await assertFails(updateDoc(doc(dbAs(MOVER), 'units', 'u1'), { stage: 'return_loaded' }))
  })

  it('wrong before-stage (packed), returnPhase on: denied', async () => {
    await setReturnPhase(true)
    await seed('units', 'u1', baseUnit({ stage: 'packed', pieces: 12 }))
    await assertFails(updateDoc(doc(dbAs(WAREHOUSE), 'units', 'u1'), { stage: 'return_loaded' }))
  })

  // returnContainerId (docs/superpowers/specs/2026-08-27-return-leg-correctness-fixes.md
  // #1) is not a rules-guarded identity field, so loadForReturn's write
  // setting it still passes the transition + identity rules unchanged.
  it('warehouse, returnPhase on: setting returnContainerId alongside the transition allowed', async () => {
    await setReturnPhase(true)
    await seed('units', 'u1', baseUnit({ stage: 'at_warehouse', pieces: 12 }))
    await assertSucceeds(
      updateDoc(doc(dbAs(WAREHOUSE), 'units', 'u1'), {
        stage: 'return_loaded',
        containerIds: arrayUnion('c1'),
        returnContainerId: 'c1',
      })
    )
  })
})

describe('return phase — loadForReturn (warehouse: container at_warehouse|return_filling -> return_filling)', () => {
  it('warehouse, returnPhase on, container at_warehouse: allowed', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'at_warehouse', unitIds: [] }))
    await assertSucceeds(
      updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), { status: 'return_filling', unitIds: arrayUnion('u1') })
    )
  })

  it('warehouse, returnPhase on, container already return_filling (second load): allowed', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_filling', unitIds: ['u1'] }))
    await assertSucceeds(
      updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), { status: 'return_filling', unitIds: arrayUnion('u2') })
    )
  })

  it('warehouse, returnPhase OFF: denied', async () => {
    await setReturnPhase(false)
    await seed('containers', 'c1', baseContainer({ status: 'at_warehouse', unitIds: [] }))
    await assertFails(
      updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), { status: 'return_filling', unitIds: arrayUnion('u1') })
    )
  })

  it('wrong role (mover), returnPhase on: denied', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'at_warehouse', unitIds: [] }))
    await assertFails(
      updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), { status: 'return_filling', unitIds: arrayUnion('u1') })
    )
  })

  it('wrong before-stage (empty), returnPhase on: denied', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'empty', unitIds: [] }))
    await assertFails(
      updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), { status: 'return_filling', unitIds: arrayUnion('u1') })
    )
  })
})

describe('return phase — markReturnFull (warehouse: container return_filling -> return_full)', () => {
  it('warehouse, returnPhase on: allowed', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_filling', unitIds: ['u1'] }))
    await assertSucceeds(updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), { status: 'return_full' }))
  })

  // Continuation transition (the container already entered the return leg
  // to reach return_filling in the first place): allowed regardless of
  // returnPhase, so toggling the phase off can't strand it here
  // (docs/superpowers/specs/2026-08-27-return-leg-correctness-fixes.md #2).
  it('warehouse, returnPhase OFF: still allowed (continuation, not entry)', async () => {
    await setReturnPhase(false)
    await seed('containers', 'c1', baseContainer({ status: 'return_filling', unitIds: ['u1'] }))
    await assertSucceeds(updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), { status: 'return_full' }))
  })

  it('wrong role (mover), returnPhase on: denied', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_filling', unitIds: ['u1'] }))
    await assertFails(updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), { status: 'return_full' }))
  })

  it('wrong before-stage (return_full, self-loop not a transition), returnPhase on: denied', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_full', unitIds: ['u1'] }))
    await assertFails(updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), { status: 'return_full' }))
  })
})

describe('return phase — dispatchReturn (warehouse: container return_full -> return_transit; units return_loaded -> return_transit)', () => {
  it('warehouse, returnPhase on, container return_full: allowed', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_full', unitIds: ['u1'] }))
    await assertSucceeds(
      updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), {
        status: 'return_transit',
        returnDriverName: 'Dave',
        returnDispatchedAt: 1,
        returnHandoffBy: WAREHOUSE,
      })
    )
  })

  it('warehouse, returnPhase on, unit return_loaded: allowed', async () => {
    await setReturnPhase(true)
    await seed('units', 'u1', baseUnit({ stage: 'return_loaded' }))
    await assertSucceeds(updateDoc(doc(dbAs(WAREHOUSE), 'units', 'u1'), { stage: 'return_transit' }))
  })

  // Continuation transitions (return_loaded/return_full are only reachable
  // by having already entered the return leg): allowed regardless of
  // returnPhase, so toggling the phase off can't strand them mid-dispatch.
  it('warehouse, returnPhase OFF: still allowed (continuation, container)', async () => {
    await setReturnPhase(false)
    await seed('containers', 'c1', baseContainer({ status: 'return_full', unitIds: ['u1'] }))
    await assertSucceeds(updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), { status: 'return_transit' }))
  })

  it('warehouse, returnPhase OFF: still allowed (continuation, unit)', async () => {
    await setReturnPhase(false)
    await seed('units', 'u1', baseUnit({ stage: 'return_loaded' }))
    await assertSucceeds(updateDoc(doc(dbAs(WAREHOUSE), 'units', 'u1'), { stage: 'return_transit' }))
  })

  it('wrong role (mover), returnPhase on: denied (container)', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_full', unitIds: ['u1'] }))
    await assertFails(updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), { status: 'return_transit' }))
  })

  it('wrong before-stage (return_filling), returnPhase on: denied (container)', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_filling', unitIds: ['u1'] }))
    await assertFails(updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), { status: 'return_transit' }))
  })

  it('wrong role (mover), returnPhase on: denied (unit)', async () => {
    await setReturnPhase(true)
    await seed('units', 'u1', baseUnit({ stage: 'return_loaded' }))
    await assertFails(updateDoc(doc(dbAs(MOVER), 'units', 'u1'), { stage: 'return_transit' }))
  })

  it('wrong before-stage (at_warehouse), returnPhase on: denied (unit)', async () => {
    await setReturnPhase(true)
    await seed('units', 'u1', baseUnit({ stage: 'at_warehouse' }))
    await assertFails(updateDoc(doc(dbAs(WAREHOUSE), 'units', 'u1'), { stage: 'return_transit' }))
  })
})

describe('return phase — deliverReturn (mover: container return_transit -> back_on_site; units return_transit -> back_on_site)', () => {
  it('mover, returnPhase on, container return_transit: allowed', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_transit', unitIds: ['u1'] }))
    await assertSucceeds(
      updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), { status: 'back_on_site', returnReceivedBy: MOVER, returnDeliveredAt: 1 })
    )
  })

  it('mover, returnPhase on, unit return_transit: allowed', async () => {
    await setReturnPhase(true)
    await seed('units', 'u1', baseUnit({ stage: 'return_transit' }))
    await assertSucceeds(updateDoc(doc(dbAs(MOVER), 'units', 'u1'), { stage: 'back_on_site' }))
  })

  // Continuation transitions (return_transit is only reachable by having
  // already entered the return leg): allowed regardless of returnPhase, so
  // toggling the phase off mid-delivery can't strand the container/unit.
  it('mover, returnPhase OFF: still allowed (continuation, container)', async () => {
    await setReturnPhase(false)
    await seed('containers', 'c1', baseContainer({ status: 'return_transit', unitIds: ['u1'] }))
    await assertSucceeds(updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), { status: 'back_on_site' }))
  })

  it('mover, returnPhase OFF: still allowed (continuation, unit)', async () => {
    await setReturnPhase(false)
    await seed('units', 'u1', baseUnit({ stage: 'return_transit' }))
    await assertSucceeds(updateDoc(doc(dbAs(MOVER), 'units', 'u1'), { stage: 'back_on_site' }))
  })

  it('wrong role (warehouse), returnPhase on: denied (container)', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_transit', unitIds: ['u1'] }))
    await assertFails(updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), { status: 'back_on_site' }))
  })

  it('wrong before-stage (return_full), returnPhase on: denied (container)', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_full', unitIds: ['u1'] }))
    await assertFails(updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), { status: 'back_on_site' }))
  })

  it('wrong role (warehouse), returnPhase on: denied (unit)', async () => {
    await setReturnPhase(true)
    await seed('units', 'u1', baseUnit({ stage: 'return_transit' }))
    await assertFails(updateDoc(doc(dbAs(WAREHOUSE), 'units', 'u1'), { stage: 'back_on_site' }))
  })

  it('wrong before-stage (return_loaded), returnPhase on: denied (unit)', async () => {
    await setReturnPhase(true)
    await seed('units', 'u1', baseUnit({ stage: 'return_loaded' }))
    await assertFails(updateDoc(doc(dbAs(MOVER), 'units', 'u1'), { stage: 'back_on_site' }))
  })
})

describe('return phase — unloadReturn (mover: unit back_on_site -> unloaded; container -> returned_empty)', () => {
  it('mover, returnPhase on, unit back_on_site: allowed', async () => {
    await setReturnPhase(true)
    await seed('units', 'u1', baseUnit({ stage: 'back_on_site', pieces: 12 }))
    await assertSucceeds(
      updateDoc(doc(dbAs(MOVER), 'units', 'u1'), { stage: 'unloaded', 'crew.movers': arrayUnion(MOVER) })
    )
  })

  it('mover, returnPhase on, last unit out flips container back_on_site -> returned_empty: allowed', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'back_on_site', unitIds: ['u1'] }))
    await assertSucceeds(updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), { status: 'returned_empty' }))
  })

  // Continuation transitions (back_on_site is only reachable by having
  // already entered the return leg): allowed regardless of returnPhase, so
  // toggling the phase off mid-unload can't strand the unit/container.
  it('mover, returnPhase OFF: still allowed (continuation, unit)', async () => {
    await setReturnPhase(false)
    await seed('units', 'u1', baseUnit({ stage: 'back_on_site', pieces: 12 }))
    await assertSucceeds(updateDoc(doc(dbAs(MOVER), 'units', 'u1'), { stage: 'unloaded' }))
  })

  it('mover, returnPhase OFF: still allowed (continuation, container)', async () => {
    await setReturnPhase(false)
    await seed('containers', 'c1', baseContainer({ status: 'back_on_site', unitIds: ['u1'] }))
    await assertSucceeds(updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), { status: 'returned_empty' }))
  })

  it('wrong role (warehouse), returnPhase on: denied (unit)', async () => {
    await setReturnPhase(true)
    await seed('units', 'u1', baseUnit({ stage: 'back_on_site', pieces: 12 }))
    await assertFails(updateDoc(doc(dbAs(WAREHOUSE), 'units', 'u1'), { stage: 'unloaded' }))
  })

  it('wrong before-stage (return_transit), returnPhase on: denied (unit)', async () => {
    await setReturnPhase(true)
    await seed('units', 'u1', baseUnit({ stage: 'return_transit' }))
    await assertFails(updateDoc(doc(dbAs(MOVER), 'units', 'u1'), { stage: 'unloaded' }))
  })

  it('wrong role (warehouse), returnPhase on: denied (container)', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'back_on_site', unitIds: ['u1'] }))
    await assertFails(updateDoc(doc(dbAs(WAREHOUSE), 'containers', 'c1'), { status: 'returned_empty' }))
  })
})

describe('return phase — unpackUnit (packer: unit unloaded -> unpacked, terminal)', () => {
  it('packer, returnPhase on: allowed', async () => {
    await setReturnPhase(true)
    await seed('units', 'u1', baseUnit({ stage: 'unloaded' }))
    await assertSucceeds(
      updateDoc(doc(dbAs(PACKER), 'units', 'u1'), {
        stage: 'unpacked',
        'crew.packers': arrayUnion(PACKER),
        media: arrayUnion({ id: 'm1', kind: 'photo', url: 'x' }),
      })
    )
  })

  // Continuation transition (unloaded is only reachable by having already
  // entered the return leg): allowed regardless of returnPhase, so toggling
  // the phase off can't strand the unit one step before its terminal stage.
  it('packer, returnPhase OFF: still allowed (continuation, terminal)', async () => {
    await setReturnPhase(false)
    await seed('units', 'u1', baseUnit({ stage: 'unloaded' }))
    await assertSucceeds(updateDoc(doc(dbAs(PACKER), 'units', 'u1'), { stage: 'unpacked' }))
  })

  it('wrong role (mover), returnPhase on: denied', async () => {
    await setReturnPhase(true)
    await seed('units', 'u1', baseUnit({ stage: 'unloaded' }))
    await assertFails(updateDoc(doc(dbAs(MOVER), 'units', 'u1'), { stage: 'unpacked' }))
  })

  it('wrong before-stage (back_on_site), returnPhase on: denied', async () => {
    await setReturnPhase(true)
    await seed('units', 'u1', baseUnit({ stage: 'back_on_site' }))
    await assertFails(updateDoc(doc(dbAs(PACKER), 'units', 'u1'), { stage: 'unpacked' }))
  })
})

describe('return phase — transportOverflowBack (mover: overflow at_warehouse -> rt_transit)', () => {
  it('mover, returnPhase on: allowed', async () => {
    await setReturnPhase(true)
    await seed('overflow', 'o1', baseOverflow({ stage: 'at_warehouse' }))
    await assertSucceeds(
      updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), { stage: 'rt_transit', rtTransitAt: 1, returnTransportBy: MOVER })
    )
  })

  it('mover, returnPhase OFF: denied', async () => {
    await setReturnPhase(false)
    await seed('overflow', 'o1', baseOverflow({ stage: 'at_warehouse' }))
    await assertFails(updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), { stage: 'rt_transit' }))
  })

  it('wrong role (warehouse), returnPhase on: denied', async () => {
    await setReturnPhase(true)
    await seed('overflow', 'o1', baseOverflow({ stage: 'at_warehouse' }))
    await assertFails(updateDoc(doc(dbAs(WAREHOUSE), 'overflow', 'o1'), { stage: 'rt_transit' }))
  })

  it('wrong before-stage (in_transit), returnPhase on: denied', async () => {
    await setReturnPhase(true)
    await seed('overflow', 'o1', baseOverflow({ stage: 'in_transit' }))
    await assertFails(updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), { stage: 'rt_transit' }))
  })
})

describe('return phase — returnOverflow (mover or packer: overflow rt_transit -> returned)', () => {
  it('mover, returnPhase on: allowed', async () => {
    await setReturnPhase(true)
    await seed('overflow', 'o1', baseOverflow({ stage: 'rt_transit' }))
    await assertSucceeds(
      updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), {
        stage: 'returned',
        returnedAt: 1,
        returnedBy: MOVER,
        media: arrayUnion({ id: 'm1', kind: 'photo', url: 'x' }),
      })
    )
  })

  it('packer, returnPhase on: allowed', async () => {
    await setReturnPhase(true)
    await seed('overflow', 'o1', baseOverflow({ stage: 'rt_transit' }))
    await assertSucceeds(
      updateDoc(doc(dbAs(PACKER), 'overflow', 'o1'), {
        stage: 'returned',
        returnedAt: 1,
        returnedBy: PACKER,
        media: arrayUnion({ id: 'm1', kind: 'photo', url: 'x' }),
      })
    )
  })

  // Continuation transition (rt_transit is only reachable by having already
  // entered the return leg): allowed regardless of returnPhase.
  it('returnPhase OFF: still allowed (continuation)', async () => {
    await setReturnPhase(false)
    await seed('overflow', 'o1', baseOverflow({ stage: 'rt_transit' }))
    await assertSucceeds(updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), { stage: 'returned' }))
  })

  it('wrong role (warehouse), returnPhase on: denied', async () => {
    await setReturnPhase(true)
    await seed('overflow', 'o1', baseOverflow({ stage: 'rt_transit' }))
    await assertFails(updateDoc(doc(dbAs(WAREHOUSE), 'overflow', 'o1'), { stage: 'returned' }))
  })

  it('wrong before-stage (at_warehouse), returnPhase on: denied', async () => {
    await setReturnPhase(true)
    await seed('overflow', 'o1', baseOverflow({ stage: 'at_warehouse' }))
    await assertFails(updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), { stage: 'returned' }))
  })
})

describe('return phase — identity guards still apply on return transitions', () => {
  it('warehouse changing unit number during loadForReturn denied', async () => {
    await setReturnPhase(true)
    await seed('units', 'u1', baseUnit({ stage: 'at_warehouse', pieces: 12 }))
    await assertFails(updateDoc(doc(dbAs(WAREHOUSE), 'units', 'u1'), { stage: 'return_loaded', number: 'B999' }))
  })

  it('mover changing container number during deliverReturn denied', async () => {
    await setReturnPhase(true)
    await seed('containers', 'c1', baseContainer({ status: 'return_transit', unitIds: ['u1'] }))
    await assertFails(updateDoc(doc(dbAs(MOVER), 'containers', 'c1'), { status: 'back_on_site', number: 'ZZ-9' }))
  })

  it('mover changing overflow unitId during returnOverflow denied', async () => {
    await setReturnPhase(true)
    await seed('overflow', 'o1', baseOverflow({ stage: 'rt_transit' }))
    await assertFails(updateDoc(doc(dbAs(MOVER), 'overflow', 'o1'), { stage: 'returned', unitId: 'other-unit' }))
  })
})
