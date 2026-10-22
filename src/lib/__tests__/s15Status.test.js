/* The property manager's view of Studio 15.
 *
 * Casey, 2026-10-22: "it would be nice to make a badass theme that matches
 * gorillamovers.com with ads the shows our current status with studio 15
 * viewer mode. they cant make any changes, maybe add notes ... i want to
 * look like a profeshinal relocation company here, do a good job!!"
 *
 * These are source-reading tests. They cannot prove the page looks good -
 * only Casey can say that - but they can prove the things that would quietly
 * stop being true later: that it writes nothing but a note, that a viewer is
 * not handed the crew's screens, and that the brand values are the site's
 * own rather than a drift of approximations.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { T, NUM, when, dayOnly, toMs } from '../../s15/s15Theme.js'

const PAGE = readFileSync('src/s15/S15Status.jsx', 'utf8')
const APP = readFileSync('src/App.jsx', 'utf8')
const RULES = readFileSync('firestore.rules', 'utf8')

describe('the viewer can look, and leave a note, and nothing else', () => {
  /* Every write in the data layer. A viewer page importing any of these
     except addNote is a bug the rules would catch at runtime - as a broken
     button in front of a client, which is the worst place to find it. */
  const WRITES = [
    'addShot', 'removeShot', 'setDestination', 'removeNote', 'setMaterials',
    'setPackMinutes', 'finishPacking', 'reopenPacking', 'finishUnit',
    'reopenUnit', 'answerPacked', 'answerUnpack', 'setService', 'addUnit',
    'deleteUnit', 'seedUnits',
  ]

  it('imports no write but addNote', () => {
    const imports = PAGE.slice(PAGE.indexOf("from './s15.js'") - 700, PAGE.indexOf("from './s15.js'"))
    for (const w of WRITES) {
      expect(imports, `${w} must not reach the viewer page`).not.toMatch(new RegExp(`\\b${w}\\b`))
    }
    expect(imports).toContain('addNote')
  })

  it('and the rules back that up rather than trusting the page', () => {
    /* A hidden button is not a lock. */
    expect(RULES).toContain("|| (hasRole('viewer') && s15NoteAppendOnly())")
    expect(RULES).toContain("|| (isActive() && !hasRole('viewer') && resource.data.get('done', false) == false)")
  })

  it('a viewer is not given the crew screens', () => {
    expect(APP).toContain('viewer: S15_VIEWER,')
    expect(APP).toMatch(/const S15_VIEWER = \[\['s15status'/)
  })

  it('and the one screen they are given is actually routed', () => {
    /* A nav key with no case in the switch renders a blank page, which is
       how the crew role stranded people earlier today. */
    const keys = [...APP.matchAll(/\['([a-z0-9]+)', '[^']*', '[^']*'\]/g)].map((m) => m[1])
    for (const k of new Set(keys)) {
      expect(APP, `nav key "${k}" has no route`).toContain(`case '${k}':`)
    }
  })
})

describe('the brand is the website\'s, not an approximation of it', () => {
  it('uses the orange the site actually spends', () => {
    /* Read out of gorillamovers.com's stylesheet on 2026-10-22. If the site
       rebrands, this test is the reminder that two places now disagree. */
    expect(T.orange).toBe('#f5821f')
  })

  it('and its dark surfaces and warm neutral', () => {
    expect(T.ink).toBe('#0e0e14')
    expect(T.ink2).toBe('#181822')
    expect(T.navy).toBe('#0a2540')
  })

  it('carries progress green and the packed cobalt over from the crew app', () => {
    /* So a colour means the same thing to Casey and to the property
       manager, rather than being re-chosen per screen. */
    expect(T.green).toBe('#0fa968')
    expect(T.cobalt).toBe('#23409f')
  })

  it('spends the accent in one place, not everywhere', () => {
    /* If orange is on every surface it stops meaning "look here". */
    const orangeUses = (PAGE.match(/T\.orange/g) || []).length
    expect(orangeUses).toBeLessThan(14)
  })

  it('sets counts in tabular figures so columns line up', () => {
    /* A column of unit numbers that shimmies as it updates looks amateur,
       and this page is the one a client judges us by. */
    expect(NUM.fontVariantNumeric).toBe('tabular-nums')
    expect(PAGE).toContain('...NUM')
  })
})

describe('what the page has to show a client', () => {
  it('units complete, which is the number they are asking for', () => {
    expect(PAGE).toContain('Units complete')
  })

  it('the photographs, grouped by the step they belong to', () => {
    expect(PAGE).toContain('shotsFor(unit, s.key)')
  })

  it('the notes, with who left each one and when', () => {
    /* Was {nt.by}, which printed no name at all. */
    expect(PAGE).toContain("{nt.name || nt.by || 'someone'} · ")
  })

  it('and the whole timeline, not an edited one', () => {
    /* Casey: "track everyting that happens who, when and where for each
       unit." Published in full, including the corrections: a record you
       would only show when it flatters you is not a record. */
    expect(PAGE).toContain('Everything that happened')
    expect(PAGE).toContain('events.filter((e) => e.unitId === unit.id)')
    expect(PAGE).not.toMatch(/filter\([^)]*Reopened/)
    expect(PAGE).not.toMatch(/filter\([^)]*Removed/)
  })

  it('every photo and event is stamped with a name and a time', () => {
    expect(PAGE).toContain("{sh.name || 'someone'} · {when(sh.ts)}")
    expect(PAGE).toMatch(/\{e\.name\} · \{when\(e\.ts\)\}/)
  })
})

/* ── Two kinds of timestamp reach this page ─────────────────────────
 *
 * The first version printed "Invalid Date" to a client, which is exactly the
 * kind of thing that undoes a professional impression.
 *
 * Photographs carry Date.now() from the phone that took them, because a shot
 * has to appear the instant it is taken, offline, with no round trip. Events
 * carry serverTimestamp(), because the ORDER of a record must not depend on
 * whose phone clock is wrong. So one is a number and the other is a
 * Firestore Timestamp - and a serverTimestamp is additionally null for a
 * moment on the writer's own screen, between the local write landing and the
 * server's value coming back.
 */
describe('dates a client reads', () => {
  it('a phone timestamp is a plain number', () => {
    const ms = Date.UTC(2026, 9, 22, 17, 20)
    expect(toMs(ms)).toBe(ms)
    expect(when(ms)).not.toMatch(/invalid/i)
  })

  it('a Firestore Timestamp comes through toMillis', () => {
    const ms = Date.UTC(2026, 9, 22, 17, 20)
    expect(toMs({ toMillis: () => ms })).toBe(ms)
    expect(when({ toMillis: () => ms })).not.toMatch(/invalid/i)
  })

  it('and a raw {seconds} shape, which is what a cached read can give', () => {
    expect(toMs({ seconds: 1800000000 })).toBe(1800000000000)
  })

  it('a pending serverTimestamp prints nothing, never "Invalid Date"', () => {
    /* Null for a moment on the writer's own screen. Blank is the one safe
       thing to show a client; "Invalid Date" is the worst. */
    expect(when(null)).toBe('')
    expect(when(undefined)).toBe('')
    expect(dayOnly(null)).toBe('')
  })

  it('and so does anything unreadable', () => {
    expect(when('not a date')).toBe('')
    expect(when({})).toBe('')
    expect(toMs({})).toBe(0)
  })

  it('the page never calls new Date on a timestamp directly', () => {
    /* That is the bug. Everything goes through toMs. */
    expect(PAGE).not.toMatch(/new Date\((?!\))/)
    expect(PAGE).toContain('toMs')
  })

  it('last activity is the newest event, not the first in the array', () => {
    /* Subscription order is not guaranteed to be clock order. */
    expect(PAGE).toContain('Math.max(best, toMs(e.ts))')
  })
})

describe('the logo on a dark ground', () => {
  it('uses the wordmark drawn for it, not an inverted black PNG', () => {
    /* invert(1) on the black logo produced a grey smudge in the corner of
       the page a client judges us by. */
    expect(PAGE).toContain('<GorillaWordmark width={190} onDark />')
    expect(PAGE).not.toContain('invert(1)')
  })
})

/* ── A blur is not a change ─────────────────────────────────────────
 *
 * The materials fields save on blur, which is right: a packer who closes
 * the app mid-count has not lost it. But blur fires when you merely TAB
 * THROUGH a field, and when React re-renders under you, so an unconditional
 * save wrote two "Materials: nothing" lines into unit 508's record a second
 * apart. They were found on the CLIENT page, which is the one place a stray
 * write is read by somebody who is paying us.
 */
describe('the record does not fill up with writes nobody made', () => {
  const UNITJSX = readFileSync('src/s15/S15Unit.jsx', 'utf8')

  it('materials only save when the answer actually changed', () => {
    expect(UNITJSX).toContain('if (normal(counts, none) === normal(unit.materials, unit.materialsNone)) return')
  })

  it('and packing minutes likewise', () => {
    expect(UNITJSX).toMatch(/if \(next === Math\.max\(0, Math\.floor\(Number\(unit\.packMinutes\)/)
  })

  it('the comparison normalises, so "0" and "" and absent all match', () => {
    /* Otherwise clearing a field to empty would look like a change from
       zero and write anyway. */
    expect(UNITJSX).toContain('const v = Math.max(0, Math.floor(Number(c[k]) || 0))')
    expect(UNITJSX).toContain('if (v > 0) out[k] = v')
  })
})

/* ── Who said it ────────────────────────────────────────────────────
 *
 * Found by demoing the page, not by testing it: a note posted on unit 508
 * read "· Oct 22, 12:13 PM" with nobody against it. The data layer stores a
 * note's author as `name`; the page was reading `by`.
 *
 * On this page that is not cosmetic. Casey: "track everyting that happens
 * who, when and where for each unit." A record with the WHO missing is the
 * one thing it exists to carry.
 */
describe('every line on the client page names a person', () => {
  const S15SRC = readFileSync('src/s15/s15.js', 'utf8')

  it('the page reads the field the data layer actually writes', () => {
    expect(S15SRC).toMatch(/notes: arrayUnion\(\{[\s\S]{0,120}name: user\.name/)
    expect(PAGE).toContain('{nt.name || nt.by || \'someone\'}')
  })

  it('a photograph names its photographer', () => {
    expect(S15SRC).toMatch(/const shot = \{[\s\S]{0,420}name: user\.name/)
    expect(PAGE).toContain("{sh.name || 'someone'}")
  })

  it('and an event names who caused it', () => {
    expect(S15SRC).toMatch(/addDoc\(collection\(db, S15_EVENTS\), \{[\s\S]{0,200}name: user\.name/)
    expect(PAGE).toMatch(/\{e\.name\} · \{when\(e\.ts\)\}/)
  })

  it('nothing on the page reads a byline field that is never written', () => {
    /* `by` was the invented one. If a future shape adds it, the fallback
       above still works, but nothing may depend on it alone. */
    expect(PAGE).not.toMatch(/\{nt\.by\}/)
    expect(PAGE).not.toMatch(/\{sh\.by\}/)
    expect(PAGE).not.toMatch(/\{e\.by\}/)
  })
})
