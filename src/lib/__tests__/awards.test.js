import { describe, it, expect } from 'vitest'
import { hasStar, starReason, nameWithStar, STAR } from '../awards.js'

/* Recognition, kept in the app rather than in a thank-you nobody sees again.
 *
 * Deliberately small: a mark beside a name, the reason behind it, the date.
 * Not points, not a leaderboard, not a score anybody could game. */
describe('the star', () => {
  const aaron = { uid: 'a', name: 'Aaron Soto Castro', award: { star: true, reason: 'Found two workflow bugs', at: 1 } }
  const plain = { uid: 'b', name: 'Liv Post' }

  it('is on whoever earned it, and nobody else', () => {
    expect(hasStar(aaron)).toBe(true)
    expect(hasStar(plain)).toBe(false)
  })

  // A star nobody can explain is decoration. The reason travels with it.
  it('carries the reason it was given for', () => {
    expect(starReason(aaron)).toBe('Found two workflow bugs')
    expect(starReason(plain)).toBe('')
  })

  it('prints beside the name where a name is plain text', () => {
    expect(nameWithStar(aaron)).toBe(`Aaron Soto Castro ${STAR}`)
    expect(nameWithStar(plain)).toBe('Liv Post')
  })

  it('does not fall over on junk', () => {
    expect(hasStar(null)).toBe(false)
    expect(hasStar({ award: {} })).toBe(false)
    expect(hasStar({ award: { star: false } })).toBe(false)
    expect(nameWithStar(null)).toBe('')
    expect(nameWithStar({})).toBe('')
  })
})
