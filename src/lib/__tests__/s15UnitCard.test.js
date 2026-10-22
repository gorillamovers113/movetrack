/* The card is the progress bar.
 *
 * Casey, 2026-10-22, looking at the building graphic: "one unit has started
 * ... but i cant see what unit that is ... it should fill in the card as far
 * as the crew is on that unit, ie, if the users started unit xxxx and only
 * did step 1 the card should be a small persentage in green."
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { lastTouch, coatFor } from '../../s15/S15UnitCard.jsx'
import { doneCount, stepTotal, photoCount, stepsFor, weArePacking, materialsAnswered, readyToFinish, phaseOf, readyToFinishPacking, earlierSteps } from '../../s15/s15.js'

const CARD = readFileSync('src/s15/S15UnitCard.jsx', 'utf8')
const BUILDING = readFileSync('src/s15/S15Building.jsx', 'utf8')
const BVIEW = readFileSync('src/s15/S15BuildingView.jsx', 'utf8')
const BOARD = readFileSync('src/s15/Studio15.jsx', 'utf8')

const shot = (ts, name) => ({ url: 'x', uid: 'u', name, ts })

describe('how far along a unit is', () => {
  it('one of five photos is one fifth, on a tenant-packed unit', () => {
    const u = { service: 'tenant', shots: { door: [shot(1, 'a')] } }
    expect(stepTotal(u)).toBe(5)
    expect(doneCount(u)).toBe(1)
    expect(Math.round((1 / stepTotal(u)) * 100)).toBe(20)
  })

  it('and one of three on a unit being packed today', () => {
    /* The denominator is the unit's own and changes with the visit, because
       a packer cannot do the move-day steps and should not be measured
       against them. A card dividing by a constant would read 20% for
       somebody who is a third of the way through their actual job. */
    const u = { service: 'gorilla', shots: { door: [shot(1, 'a')] } }
    expect(phaseOf(u)).toBe('packing')
    expect(stepTotal(u)).toBe(3)
    expect(Math.round((1 / stepTotal(u)) * 100)).toBe(33)
  })

  it('the fill is proportional, not a fixed bar', () => {
    expect(CARD).toContain('width: `${pct}%`')
    expect(CARD).toContain('const pct = Math.round((n / total) * 100)')
  })

  it('and it sits behind the text rather than over it', () => {
    /* A card three fifths done still has to read as words. */
    expect(CARD).toContain('opacity: 0.16')
    expect(CARD).toContain('pointerEvents: \'none\'')
  })

  it('the exact count is printed too, because a bar alone is a guess', () => {
    /* Was '${n} of ${total} photos' until Casey read that as a cap on
       2026-10-22. Same number, wording that does not promise a limit. */
    expect(CARD).toContain('${n} of ${total} done')
  })

  it('an untouched unit gets no fill at all', () => {
    expect(CARD).toContain('{!unit.done && n > 0 && (')
  })
})

describe('who is on it', () => {
  it('the most recent photo wins, whichever step it belongs to', () => {
    const u = { shots: { door: [shot(100, 'Liv')], empty: [shot(900, 'Victoria')], before: [shot(500, 'Rogelio')] } }
    expect(lastTouch(u).name).toBe('Victoria')
  })

  it('a unit nobody has touched has no last touch', () => {
    expect(lastTouch({ shots: {} })).toBe(null)
    expect(lastTouch({})).toBe(null)
  })

  it('and the card names them, which is the answer to "is anyone in there"', () => {
    expect(CARD).toContain('{touch.name}')
  })
})

describe('finding the unit Casey could see but not identify', () => {
  it('a window on the drawing opens its own unit', () => {
    expect(BUILDING).toContain('onOpenUnit(u.id)')
  })

  it('and stops the floor band stealing the tap', () => {
    /* The band sits under every slot. Without this the only thing a tap did
       was select the floor, which is what made the orange slot a riddle. */
    const at = BUILDING.indexOf('onOpenUnit(u.id)')
    expect(BUILDING.slice(at - 320, at)).toContain('e.stopPropagation()')
  })

  it('the building view hands the drawing that handler', () => {
    expect(BVIEW).toContain('onOpenUnit={setOpenId}')
  })

  it('and lists what is being worked without anybody tapping a floor', () => {
    for (const src of [BVIEW, BOARD]) {
      expect(src).toContain('BEING WORKED NOW')
      expect(src).toContain('.filter((u) => !u.done && doneCount(u) > 0)')
    }
  })

  it('most recently touched first, so the live one is the first card', () => {
    for (const src of [BVIEW, BOARD]) {
      expect(src).toContain('(lastTouch(b)?.ts || 0) - (lastTouch(a)?.ts || 0)')
    }
  })
})

/* ── The extra steps when Gorilla does the packing ──────────────────
 *
 * Casey, 2026-10-22: "if gorilla is packing, make sure to add extra steps.
 * matterical count, small, med, large, paper."
 *
 * Three of the sixteen are ours to pack - the disability units. The other
 * thirteen must never see any of this: the crew's complaint about the last
 * app was the number of boxes to fill in, and these are exactly that.
 */
describe('a unit Gorilla packs', () => {
  const tenant = { service: 'tenant', shots: {} }
  const ours = { service: 'gorilla', shots: {} }

  it('gains a packed-and-ready photo', () => {
    expect(stepsFor(ours).map((s) => s.key)).toContain('packed')
    expect(stepsFor(tenant).map((s) => s.key)).not.toContain('packed')
  })

  it('packed-and-ready is the last thing the pack crew do', () => {
    const keys = stepsFor(ours).map((s) => s.key)
    expect(keys).toEqual(['door', 'before', 'packed'])
  })

  it('a tenant-packed unit keeps exactly the five', () => {
    expect(stepsFor(tenant)).toHaveLength(5)
  })

  it('weArePacking reads the service field, nothing else', () => {
    expect(weArePacking({ service: 'gorilla' })).toBe(true)
    expect(weArePacking({ service: 'tenant' })).toBe(false)
    expect(weArePacking({ packers: 3 })).toBe(false)
    expect(weArePacking(null)).toBe(false)
  })
})

describe('materials must be answered before a packed unit is finished', () => {
  it('a tenant-packed unit is never asked', () => {
    expect(materialsAnswered({ service: 'tenant' })).toBe(true)
  })

  it('one of ours with nothing recorded is not answered', () => {
    expect(materialsAnswered({ service: 'gorilla' })).toBe(false)
    expect(materialsAnswered({ service: 'gorilla', materials: {} })).toBe(false)
  })

  it('any real count answers it', () => {
    expect(materialsAnswered({ service: 'gorilla', materials: { small: 4 } })).toBe(true)
  })

  it('and "we used none" is a real answer, not a missing one', () => {
    /* Forcing a false number is worse than an honest zero. */
    expect(materialsAnswered({ service: 'gorilla', materialsNone: true })).toBe(true)
  })

  it('but a zero typed into every box is not', () => {
    expect(materialsAnswered({ service: 'gorilla', materials: { small: 0, large: 0 } })).toBe(false)
  })

  it('the vocabulary is the one Trinity already bills from', () => {
    /* Not a second list that drifts. Casey asked for small, med, large and
       paper; all four are in it, plus what the crew actually stock. */
    const CARD2 = readFileSync('src/s15/s15.js', 'utf8')
    expect(CARD2).toContain("import { CARTON_TYPES, SUPPLY_TYPES } from '../lib/mutations.js'")
  })
})

describe('what it takes to finish a unit', () => {
  const allShots = (keys) => Object.fromEntries(keys.map((k) => [k, [shot(1, 'a')]]))
  const tenantKeys = ['door', 'before', 'empty', 'newDoor', 'newFull']
  const ourKeys = ['door', 'before', 'packed', 'moveDoor', 'empty', 'newDoor', 'newFull']

  it('a tenant-packed unit needs its five photos and nothing else', () => {
    expect(readyToFinish({ service: 'tenant', shots: allShots(tenantKeys) })).toBe(true)
  })

  it('and is not ready one short', () => {
    expect(readyToFinish({ service: 'tenant', shots: allShots(tenantKeys.slice(0, 4)) })).toBe(false)
  })

  /* The one the first four mutations missed: stripping materialsAnswered()
     out of readyToFinish left every other test passing. */
  it('a unit we packed is NOT ready on photos alone', () => {
    expect(readyToFinish({ service: 'gorilla', shots: allShots(ourKeys) })).toBe(false)
  })

  it('it is ready once the materials are recorded AND packing is signed off', () => {
    const packed = { service: 'gorilla', shots: allShots(ourKeys), materials: { small: 6, paper: 2 }, packingDoneAt: 1 }
    expect(readyToFinish(packed)).toBe(true)
  })

  it('or once somebody says we used none', () => {
    expect(readyToFinish({ service: 'gorilla', shots: allShots(ourKeys), materialsNone: true, packingDoneAt: 1 })).toBe(true)
  })

  it('but materials alone do not finish it either', () => {
    expect(readyToFinish({ service: 'gorilla', shots: allShots(ourKeys.slice(0, 3)), materials: { small: 6 } })).toBe(false)
  })
})

/* ── "0 of 5 photos" was never a limit ──────────────────────────────
 *
 * Casey, 2026-10-22: "i just noticed you have 0 of 5 photos on each card,
 * there should be no limit on how many photos are uploaded. i would prefrer
 * 5 or less, but some will need to be more, and some less."
 *
 * There was no cap. The five are the five SHOTS the record needs, and each
 * holds as many frames as the crew take - Rogelio had already put two on one
 * of them. But the label read as a quota to the person who commissioned the
 * app, which is as clear a verdict on the wording as you can get.
 */
describe('photos are uncapped, and the label now says so', () => {
  const UNIT = readFileSync('src/s15/S15Unit.jsx', 'utf8')
  const CARD3 = readFileSync('src/s15/S15UnitCard.jsx', 'utf8')

  it('a step holds as many photos as you put in it', () => {
    const u = { service: 'tenant', shots: { before: [shot(1,'a'), shot(2,'b'), shot(3,'c'), shot(4,'d')] } }
    expect(photoCount(u)).toBe(4)
    expect(doneCount(u)).toBe(1)
  })

  it('photos and steps are counted separately', () => {
    const u = { service: 'tenant', shots: { door: [shot(1,'a')], before: [shot(2,'b'), shot(3,'c')] } }
    expect(doneCount(u)).toBe(2)
    expect(photoCount(u)).toBe(3)
  })

  it('nothing says "of N photos" any more', () => {
    /* That phrasing is what made it sound like a ration. */
    expect(CARD3).not.toContain('${total} photos`')
    expect(UNIT).not.toContain('PHOTOS · {n} of {total}')
  })

  it('the card says how many are done AND how many photos exist', () => {
    expect(CARD3).toContain('${n} of ${total} done')
    expect(CARD3).toContain('{shots} photo')
  })

  it('and every step accepts several at once, not just the multi ones', () => {
    /* Three steps were single-select, so a packer with four shots of an
       empty room had to pick them one at a time. */
    expect(UNIT).toContain('            multiple\n')
    expect(UNIT).not.toContain('multiple={step.multi}')
  })

  it('an empty unit counts zero photos without throwing', () => {
    expect(photoCount({})).toBe(0)
    expect(photoCount({ shots: {} })).toBe(0)
  })
})

/* ── Two visits, when we do the packing ─────────────────────────────
 *
 * Casey, 2026-10-22: "when we do packing, its usualy done before the move.
 * so for the units 508 they are packing today, and tomorrow will be the move
 * ... when the packers finish today, now the movers will need to do that
 * same steps again."
 *
 * Unit 508 was being packed by Rogelio while this was written, which is why
 * `phase` is derived rather than stored: nothing had to be written to a
 * document somebody was holding.
 */
describe('a unit we pack has two visits', () => {
  const packDay = { service: 'gorilla', shots: {} }
  const moveDay = { service: 'gorilla', shots: {}, packingDoneAt: 1, packingDoneBy: 'Rogelio' }
  const tenant = { service: 'tenant', shots: {} }

  it('starts on packing day', () => {
    expect(phaseOf(packDay)).toBe('packing')
  })

  it('and moves to move day only once packing is signed off', () => {
    expect(phaseOf(moveDay)).toBe('moving')
  })

  it('a tenant-packed unit is never on packing day', () => {
    expect(phaseOf(tenant)).toBe('moving')
  })

  it('the packers see three steps, and none they cannot do today', () => {
    const keys = stepsFor(packDay).map((s) => s.key)
    expect(keys).toEqual(['door', 'before', 'packed'])
    expect(keys).not.toContain('empty')
    expect(keys).not.toContain('newDoor')
  })

  it('the movers see four, and none that were done without them', () => {
    const keys = stepsFor(moveDay).map((s) => s.key)
    expect(keys).toEqual(['moveDoor', 'empty', 'newDoor', 'newFull'])
    expect(keys).not.toContain('packed')
    expect(keys).not.toContain('before')
  })

  it('the door is shot on both days, which is deliberate', () => {
    /* Cheapest proof of which apartment and which day, and the two visits
       are a night apart. */
    expect(stepsFor(packDay).map((s) => s.key)).toContain('door')
    expect(stepsFor(moveDay).map((s) => s.key)).toContain('moveDoor')
  })

  it('but a tenant-packed unit photographs it once, not twice', () => {
    /* One visit. A second door shot would be the same door, same morning. */
    const keys = stepsFor(tenant).map((s) => s.key)
    expect(keys).toEqual(['door', 'before', 'empty', 'newDoor', 'newFull'])
  })

  it('packing cannot be signed off without its photos AND materials', () => {
    const shots = { door: [shot(1,'a')], before: [shot(2,'a')], packed: [shot(3,'a')] }
    expect(readyToFinishPacking({ service: 'gorilla', shots })).toBe(false)
    expect(readyToFinishPacking({ service: 'gorilla', shots, materialsNone: true })).toBe(true)
  })

  it('and the unit cannot be COMPLETED while it is still being packed', () => {
    /* The move has not happened. Completing here would close a unit whose
       contents are still in the old apartment. */
    const everything = { service: 'gorilla', materialsNone: true,
      shots: Object.fromEntries(['door','before','packed','moveDoor','empty','newDoor','newFull'].map(k => [k, [shot(1,'a')]])) }
    expect(readyToFinish({ ...everything, packingDoneAt: null })).toBe(false)
    expect(readyToFinish({ ...everything, packingDoneAt: 1 })).toBe(true)
  })

  it('move day can still see what the packers left', () => {
    expect(earlierSteps(moveDay).map((s) => s.key)).toEqual(['door', 'before', 'packed'])
  })

  it('but packing day has no earlier visit to show', () => {
    expect(earlierSteps(packDay)).toEqual([])
    expect(earlierSteps(tenant)).toEqual([])
  })
})

/* ── The colour coat ────────────────────────────────────────────────
 *
 * Casey, 2026-10-22: "color coat the cards, for gorillla pack"
 *
 * Green was already the progress fill and had to stay it, so the coat is a
 * second channel: a tint and a left rail the green sits on top of.
 */
describe('cards are coated by who packs, and which visit', () => {
  const CARD4 = readFileSync('src/s15/S15UnitCard.jsx', 'utf8')

  it('a tenant-packed unit stays white with no rail', () => {
    const c = coatFor({ service: 'tenant' })
    expect(c.bg).toBe('#fff')
    expect(c.rail).toBeNull()
  })

  it('one we pack today is gold', () => {
    const c = coatFor({ service: 'gorilla' })
    expect(c.rail).toBe('#e9a21c')
  })

  it('one we have packed turns cobalt for the movers', () => {
    const c = coatFor({ service: 'gorilla', packingDoneAt: 1 })
    expect(c.rail).toBe('#23409f')
  })

  it('the two visits never share a colour', () => {
    /* The whole point is telling them apart across a room. */
    expect(coatFor({ service: 'gorilla' }).rail)
      .not.toBe(coatFor({ service: 'gorilla', packingDoneAt: 1 }).rail)
  })

  it('green is left alone, because it still means progress', () => {
    for (const u of [{ service: 'tenant' }, { service: 'gorilla' }, { service: 'gorilla', packingDoneAt: 1 }]) {
      expect(coatFor(u).rail).not.toBe('#16a34a')
      expect(coatFor(u).bg).not.toBe('#16a34a')
    }
  })

  it('every coat says it in words too, not only in colour', () => {
    /* Colour alone fails a colour-blind crew member and fails a phone in
       direct sun on a loading dock. */
    expect(coatFor({ service: 'gorilla' }).chip.text).toMatch(/we pack/i)
    expect(coatFor({ service: 'gorilla', packingDoneAt: 1 }).chip.text).toMatch(/packed/i)
  })

  it('a finished unit is solid green whoever packed it', () => {
    expect(CARD4).toContain("background: unit.done ? '#16a34a' : coat.bg")
  })

  it('the rail does not sit under the progress fill', () => {
    /* inset box-shadow, with the padding moved to match, so the green bar
       still starts at the card edge and the two read as separate facts. */
    expect(CARD4).toContain('inset 5px 0 0')
    expect(CARD4).toContain('paddingLeft: coat.rail && !unit.done ? 18 : 14')
  })
})
