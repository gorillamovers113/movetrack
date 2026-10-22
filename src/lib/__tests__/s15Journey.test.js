/* The whole job, walked end to end, the way the crew will walk it.
 *
 * Every other test here checks one predicate. These check that the gates
 * open IN ORDER, which is the thing that actually breaks: each piece can be
 * correct while the sequence still strands somebody on a landing with a
 * phone and a box, unable to finish a unit and unable to see why.
 *
 * Four journeys, which is all of them:
 *   1. a tenant-packed unit, the thirteen
 *   2. the same, with Gorilla unpacking
 *   3. a unit we pack, across its two visits
 *   4. packing turned on at the door, mid-job
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  stepsFor, stepTotal, doneCount, readyToFinish, readyToFinishPacking,
  blockedBy, phaseOf, materialsAnswered,
} from '../../s15/s15.js'

const shots = (n = 1) => Array.from({ length: n }, (_, i) => ({ url: 'u', name: 'Rogelio', ts: 1000 + i }))
const put = (u, k, n = 1) => ({ ...u, shots: { ...(u.shots || {}), [k]: shots(n) } })
const putAll = (u, keys) => keys.reduce((acc, k) => put(acc, k), u)

describe('journey 1: a tenant-packed unit', () => {
  it('walks from untouched to complete without a dead end', () => {
    let u = { number: '509', service: 'tenant', shots: {} }

    expect(stepTotal(u)).toBe(5)
    expect(blockedBy(u)).toMatch(/packed/i)

    u = { ...u, packedConfirmedAt: 1, packedConfirmedBy: 'Rogelio' }
    expect(blockedBy(u)).toMatch(/photo/i)

    u = putAll(u, ['door', 'before', 'empty', 'newDoor', 'newFull'])
    expect(doneCount(u)).toBe(5)
    expect(blockedBy(u)).toMatch(/unpack/i)

    u = { ...u, unpack: false }
    expect(readyToFinish(u)).toBe(true)
    expect(blockedBy(u)).toBeNull()
  })

  it('and never asks a tenant-packed unit for materials', () => {
    expect(materialsAnswered({ service: 'tenant' })).toBe(true)
  })
})

describe('journey 2: the same unit, but we unpack it', () => {
  it('adds two steps and will not finish until both are shot', () => {
    let u = {
      service: 'tenant', packedConfirmedAt: 1, unpack: true,
      shots: {},
    }
    u = putAll(u, ['door', 'before', 'empty', 'newDoor', 'newFull'])
    expect(stepTotal(u)).toBe(7)
    expect(readyToFinish(u)).toBe(false)

    u = putAll(u, ['unpackBefore', 'unpackAfter'])
    expect(readyToFinish(u)).toBe(true)
  })
})

describe('journey 3: a unit we pack, across two visits', () => {
  it('packs on day one and moves on day two, each with its own steps', () => {
    let g = { number: '508', service: 'gorilla', packers: 3, shots: {} }

    expect(phaseOf(g)).toBe('packing')
    expect(stepTotal(g)).toBe(3)

    g = { ...g, packedConfirmedAt: 1 }
    g = putAll(g, ['door', 'before', 'packed'])
    expect(readyToFinishPacking(g)).toBe(false)   // materials still open

    /* The property supplies the cartons on this job, so both are true. */
    g = { ...g, materials: { small: 40 }, materialsNone: true }
    expect(materialsAnswered(g)).toBe(true)
    expect(readyToFinishPacking(g)).toBe(true)

    /* The move has not happened. The unit must not close. */
    expect(readyToFinish(g)).toBe(false)

    g = { ...g, packingDoneAt: 2, packingDoneBy: 'Rogelio' }
    expect(phaseOf(g)).toBe('moving')
    expect(stepTotal(g)).toBe(4)
    expect(doneCount(g)).toBe(0)                  // move day starts at zero

    g = putAll(g, ['moveDoor', 'empty', 'newDoor', 'newFull'])
    g = { ...g, unpack: false }
    expect(readyToFinish(g)).toBe(true)
  })
})

describe('journey 4: packing turned on at the door', () => {
  it('keeps the photographs already taken', () => {
    /* A crew arrive on move day, open the door, find it unpacked. The two
       shots they have already taken must not be thrown away. */
    let t = { number: '513', service: 'tenant', packedConfirmedAt: 1, shots: {} }
    t = putAll(t, ['door', 'before'])
    expect(doneCount(t)).toBe(2)

    const flipped = { ...t, service: 'gorilla', packers: 2 }
    expect(phaseOf(flipped)).toBe('packing')
    expect(doneCount(flipped)).toBe(2)
    expect(stepsFor(flipped).map((s) => s.key)).toEqual(['door', 'before', 'packed'])
  })
})

describe('the finish button always explains itself', () => {
  it('never says nothing while it is still disabled', () => {
    /* A grey button with no reason is the thing that makes a packer ring
       Casey. Every incomplete state must name what is missing. */
    const states = [
      { service: 'tenant', shots: {} },
      { service: 'tenant', packedConfirmedAt: 1, shots: {} },
      { service: 'tenant', packedConfirmedAt: 1, shots: { door: shots() } },
      { service: 'gorilla', shots: {} },
      { service: 'gorilla', packedConfirmedAt: 1, shots: {} },
      { service: 'gorilla', packedConfirmedAt: 1, packingDoneAt: 1, shots: {} },
    ]
    for (const s of states) {
      if (readyToFinish(s)) continue
      const why = blockedBy(s)
      expect(why, JSON.stringify(s)).toBeTruthy()
      expect(why.length, JSON.stringify(s)).toBeGreaterThan(6)
    }
  })
})

/* ── Correcting an answer ───────────────────────────────────────────
 *
 * "Change" on the packed question used to call answerPacked with the
 * service INVERTED and a hardcoded two packers. So an admin who only wanted
 * to correct a crew size either could not, or silently changed it to two.
 * It cost unit 508 its third packer during a demo on 2026-10-22, on a unit
 * scheduled for three the next morning.
 */
describe('an answer can be corrected without being inverted', () => {
  const UNIT = readFileSync('src/s15/S15Unit.jsx', 'utf8')

  it('Change reopens the question instead of flipping the service', () => {
    expect(UNIT).toContain('onReopen={canSetService(unit, user) ? () => setReask(true) : null}')
    expect(UNIT).not.toContain('answer(!weArePacking(unit), 2)')
  })

  it('and the packer picker starts from what the unit already has', () => {
    /* Defaulting to a constant is how the count got overwritten. */
    expect(UNIT).toContain("useState(() => String(unit.packers || 2))")
  })

  it('re-asking does not count as unanswered for the finish gate', () => {
    /* `reask` is local screen state. The unit is still answered in the
       data, so a half-finished correction cannot strand the crew. */
    expect(UNIT).toContain('const answered = packedAnswered(unit) && !reask')
  })
})
