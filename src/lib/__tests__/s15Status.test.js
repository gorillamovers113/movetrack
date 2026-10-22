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
import { T, NUM, PROOF, ADS, when, dayOnly, toMs } from '../../s15/s15Theme.js'

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
  /* These assertions used to require #f5821f, an ORANGE, and they passed.
     They were locking in a mistake: I had read gorillamovers.com's
     stylesheet, found an orange somewhere in it, and never looked at the
     site. The site is navy and blue. Casey, 2026-10-22: "style it like
     gorillamovers.com (view the site to see for yourself)."

     The values below were read off the live site: the custom properties it
     sets on :root, and the blues its own CSS spends most. A test that
     encodes a guess is worse than no test, because it defends the guess. */

  it('uses the site\'s own ink, text and hairline', () => {
    expect(T.ink).toBe('#0a2540')
    expect(T.text).toBe('#425466')
    expect(T.muted).toBe('#5d6e86')
    expect(T.line).toBe('#e6ebf1')
  })

  it('and its blue family, not an orange', () => {
    expect(T.blue).toBe('#2a6cc4')
    expect(T.blueDeep).toBe('#1b55a5')
    expect(T.blueLink).toBe('#0c6b9d')
  })

  it('the page is built on blue, with orange nowhere near the chrome', () => {
    /* The earlier version made orange the accent of every surface. */
    const orangeUses = (PAGE.match(/T\.amber/g) || []).length
    const blueUses = (PAGE.match(/T\.blue/g) || []).length
    expect(orangeUses).toBe(0)
    expect(blueUses).toBeGreaterThan(12)
  })

  it('sets Inter, because that is what the site sets', () => {
    expect(T.font).toContain('Inter')
  })

  it('and headlines at weight 800, like the site\'s', () => {
    expect(PAGE).toContain('fontWeight: 800')
  })

  it('keeps progress green meaning the same as in the crew app', () => {
    expect(T.green).toBe('#0fa968')
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
    expect(PAGE).toContain('<GorillaWordmark width={200} onDark />')
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

/* ── The adverts ────────────────────────────────────────────────────
 *
 * Casey, 2026-10-22: "add some ads for other gorilla movers services."
 *
 * Chosen for the person actually reading this page, which is a property
 * manager and not a householder: turnovers, storage gaps, their own office.
 */
describe('the service adverts', () => {
  it('every link points at a real page on the site', () => {
    /* Each href was checked for a 200 before shipping. A dead link on the
       page a client judges us by is worse than no link at all. */
    for (const ad of ADS) {
      expect(ad.href, ad.key).toMatch(/^https:\/\/gorillamovers\.com\/[a-z0-9-]+$/)
    }
  })

  it('and nowhere else, so an ad can never leave the brand', () => {
    for (const ad of ADS) {
      expect(new URL(ad.href).hostname).toBe('gorillamovers.com')
    }
  })

  it('leads with what a property manager actually buys', () => {
    /* Turnovers and storage gaps come first; a resident referral is last. */
    expect(ADS[0].key).toBe('junk')
    expect(ADS[1].key).toBe('storage')
    expect(ADS.map((a) => a.key)).toContain('commercial')
  })

  it('each one carries a concrete proof line, not an adjective', () => {
    for (const ad of ADS) {
      expect(ad.proof, ad.key).toBeTruthy()
      expect(ad.proof.length, ad.key).toBeLessThan(60)
    }
  })

  it('opens the site in a new tab, so nobody loses the status page', () => {
    expect(PAGE).toContain('target="_blank"')
    expect(PAGE).toContain('rel="noopener"')
  })

  it('and no advert uses an em dash', () => {
    /* Casey's standing rule for shipped copy. */
    for (const ad of ADS) {
      expect(ad.body + ad.proof + ad.title, ad.key).not.toContain('—')
    }
  })
})

describe('the proof a client reads', () => {
  it('lives in one place, so a number moves once', () => {
    expect(PROOF.cal).toBe('CAL T-192729')
    expect(PROOF.usdot).toBe('USDOT 3801918')
    expect(PROOF.phone).toBe('619.600.5000')
  })

  it('and the page renders it from there, not from a literal', () => {
    expect(PAGE).toContain('{PROOF.cal}')
    expect(PAGE).toContain('{PROOF.usdot}')
    expect(PAGE).toContain('{PROOF.phone}')
    expect(PAGE).not.toContain('619.600.5000')
  })

  it('the phone link is dialable', () => {
    expect(PROOF.phoneHref).toBe('tel:+16196005000')
  })

  it('the vendor line names the three it actually names', () => {
    /* Straight off the site. This is the single most persuasive line on
       the page for the person reading it. */
    expect(PROOF.vendorFor).toContain('Irvine Company')
    expect(PROOF.vendorFor).toContain('H.G. Fenton')
    expect(PROOF.vendorFor).toContain('Greystar')
  })
})

describe('no em dashes anywhere in the page copy', () => {
  it('because Casey has banned them in shipped copy', () => {
    const THEME = readFileSync('src/s15/s15Theme.js', 'utf8')
    expect(PAGE).not.toContain('—')
    expect(THEME).not.toContain('—')
  })
})

describe('the advert grid holds its line', () => {
  it('cards are columns that fill the row height', () => {
    /* Storage runs to four lines where its neighbours run to three. Without
       this the "Learn more" links sat at three different heights, which
       reads as a broken grid. */
    expect(PAGE).toContain("flexDirection: 'column', height: '100%'")
    expect(PAGE).toContain("alignItems: 'stretch'")
  })

  it('and the link is pushed to the bottom of each', () => {
    expect(PAGE).toContain("marginBottom: 'auto'")
  })
})
