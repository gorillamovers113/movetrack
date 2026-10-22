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
