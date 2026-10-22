/* Every role that can sign in gets a usable nav on every project.
 *
 * Found on 2026-10-22 while testing Studio 15 for the first live day: `crew`
 * - the combined "Packer + Mover" role, which several of the crew actually
 * hold - had no NAV entry and never had one. NAV[undefined] is undefined,
 * which fell through to `[]`, which made `first` default to 'dashboard'.
 *
 * On Trinity that was an empty sidebar on a page that still rendered. On
 * Studio 15 it was worse: 'dashboard' is Trinity's screen, so a crew member
 * who picked Studio 15 would land on the other job's home page with no way
 * to reach their own board.
 *
 * This reads the real NAV tables out of App.jsx rather than a copy, so the
 * next role somebody adds fails here instead of on a phone in a stairwell.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ROLES } from '../../seed.js'

const APP = readFileSync('src/App.jsx', 'utf8')

function navKeys(tableName) {
  const at = APP.indexOf(`const ${tableName} = {`)
  expect(at, `${tableName} not found`).toBeGreaterThan(0)
  const body = APP.slice(at, APP.indexOf('\n}', at))
  return [...body.matchAll(/^\s{2}([a-z]+):/gm)].map((m) => m[1])
}

describe('nav coverage', () => {
  const roles = Object.keys(ROLES)

  it('every role in ROLES has a Trinity nav', () => {
    const keys = navKeys('NAV_TRINITY')
    expect(roles.filter((r) => !keys.includes(r))).toEqual([])
  })

  it('every role in ROLES has a Studio 15 nav', () => {
    const keys = navKeys('NAV_STUDIO15')
    expect(roles.filter((r) => !keys.includes(r))).toEqual([])
  })

  it('crew specifically, because that is the one that was missing', () => {
    expect(navKeys('NAV_TRINITY')).toContain('crew')
    expect(navKeys('NAV_STUDIO15')).toContain('crew')
  })

  it('and an unknown role still lands inside the project it picked', () => {
    /* The net under the table: never fall through to a hard-coded
       'dashboard', which is one project's screen and not the other's. */
    expect(APP).toContain("navsFor[currentUser.role] || navsFor.crew || navsFor.viewer || []")
  })

  it("Studio 15's nav never offers a Trinity Manor screen", () => {
    /* Casey: the two jobs "should not be on the same page".
     *
     * Reads S15_CREW TOO, not just the NAV_STUDIO15 table. Every entry in
     * that table is the bare identifier `S15_CREW`, so a Trinity screen
     * appended to the shared list was invisible to a check that only looked
     * at the table body - proved by adding 'overflow' to S15_CREW and
     * watching this pass. */
    const at = APP.indexOf('const S15_CREW =')
    const body = APP.slice(at, APP.indexOf('\n}', APP.indexOf('const NAV_STUDIO15 = {')))
    for (const trinityOnly of ['containers', 'overflow', 'mywork', 'schedule', 'reports', 'access', 'activity']) {
      expect(body, `${trinityOnly} leaked into Studio 15`).not.toContain(`'${trinityOnly}'`)
    }
  })
})
