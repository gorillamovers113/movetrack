/* Who sees which job.
 *
 * Casey, 2026-10-22: "for one user i want him to only see trinity mannor but
 * a different user to only see studio 15 and yet a different user i want them
 * to see none and lastly i want a user to see both."
 */
import { describe, it, expect } from 'vitest'
import { allowedProjects, canSeeProject, accessIsExplicit, PROJECT_KEYS } from '../projectAccess.js'

const user = (over = {}) => ({ uid: 'u', role: 'packer', status: 'active', ...over })

describe('the four states Casey asked for', () => {
  it('Trinity only', () => {
    expect(allowedProjects(user({ projects: ['trinity'] }))).toEqual(['trinity'])
  })

  it('Studio 15 only', () => {
    expect(allowedProjects(user({ projects: ['studio15'] }))).toEqual(['studio15'])
  })

  it('both', () => {
    expect(allowedProjects(user({ projects: ['trinity', 'studio15'] }))).toEqual(['trinity', 'studio15'])
  })

  it('none', () => {
    expect(allowedProjects(user({ projects: [] }))).toEqual([])
    expect(canSeeProject(user({ projects: [] }), 'trinity')).toBe(false)
  })
})

describe('absent is not empty', () => {
  /* The distinction that kept the live Trinity crew working. A missing list
     means nobody has decided; defaulting it to "none" would have emptied
     every crew phone on the job the moment this shipped. */
  it('a user from before the field sees everything', () => {
    expect(allowedProjects(user())).toEqual(PROJECT_KEYS)
  })

  it('and an explicit empty list sees nothing', () => {
    expect(allowedProjects(user({ projects: [] }))).toEqual([])
  })

  it('which the Team page can tell apart', () => {
    expect(accessIsExplicit(user())).toBe(false)
    expect(accessIsExplicit(user({ projects: [] }))).toBe(true)
  })
})

describe('the edges', () => {
  it('an admin is never gated out, even set to none', () => {
    expect(allowedProjects(user({ role: 'admin', projects: [] }))).toEqual(PROJECT_KEYS)
  })

  it('somebody not active sees nothing, whatever the list says', () => {
    expect(allowedProjects(user({ status: 'pending', projects: ['trinity'] }))).toEqual([])
    expect(allowedProjects(user({ status: 'removed', projects: ['trinity', 'studio15'] }))).toEqual([])
  })

  it('a junk entry is dropped rather than trusted', () => {
    expect(allowedProjects(user({ projects: ['trinity', 'not-a-job'] }))).toEqual(['trinity'])
  })

  it('and a non-list is treated as undecided, not as none', () => {
    expect(allowedProjects(user({ projects: 'trinity' }))).toEqual(PROJECT_KEYS)
  })
})

/* ── Who may put a new unit on the board ────────────────────────────
 *
 * Casey, 2026-10-22: "there is a supervisor check box in the admin setttings.
 * maybe the admin and supervisor will only have the ability to add a unit."
 *
 * The gap it closes: an apartment that turns up unlisted used to stop the
 * crew dead, because only Casey could add one. The gap it does NOT open:
 * every crew member typing unit numbers onto a shared board.
 */
import { canAddUnit } from '../../s15/s15.js'

describe('adding a unit', () => {
  const u = (over = {}) => ({ uid: 'u', role: 'packer', status: 'active', ...over })

  it('an admin may', () => {
    expect(canAddUnit(u({ role: 'admin' }))).toBe(true)
  })

  it('a supervisor may, whatever their role underneath', () => {
    expect(canAddUnit(u({ role: 'packer', supervisor: true }))).toBe(true)
    expect(canAddUnit(u({ role: 'crew', supervisor: true }))).toBe(true)
  })

  it('an ordinary crew member may not', () => {
    expect(canAddUnit(u())).toBe(false)
    expect(canAddUnit(u({ role: 'crew' }))).toBe(false)
    expect(canAddUnit(u({ role: 'mover' }))).toBe(false)
  })

  it('and supervisor:false is not supervisor', () => {
    /* me().get('supervisor', false) is how the rules read it, so an explicit
       false and an absent key have to mean the same thing here too. */
    expect(canAddUnit(u({ supervisor: false }))).toBe(false)
  })

  it('a non-boolean truthy flag does NOT count, because the rules say so', () => {
    /* firestore.rules reads me().get('supervisor', false) == true, which is
       a strict comparison. A client using !!user.supervisor would show the
       Add box to somebody the server then refuses, which reads as the app
       being broken rather than as them not having the permission. The two
       forms only diverge here, on a value that is truthy but not true. */
    expect(canAddUnit(u({ supervisor: 'yes' }))).toBe(false)
    expect(canAddUnit(u({ supervisor: 1 }))).toBe(false)
  })

  it('somebody not active may not, supervisor flag or not', () => {
    expect(canAddUnit(u({ status: 'removed', supervisor: true }))).toBe(false)
    expect(canAddUnit(u({ status: 'pending', role: 'admin' }))).toBe(false)
    expect(canAddUnit(null)).toBe(false)
  })
})
