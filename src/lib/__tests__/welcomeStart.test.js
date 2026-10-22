/* The welcome screen's rules about when to ask and what a start time may be.
 *
 * Casey, 2026-10-22: "for each user that logsin you should have a welcome
 * screen with a imput for there start time. add the defult current time
 * automaticaly."
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

/* These tests run in node, which has no localStorage. shouldAskStart wraps
   its read in try/catch so the app survives private mode, which also means a
   missing localStorage would make the skip tests pass for the wrong reason:
   the branch would never run at all. A stub makes them test something. */
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}
import { shouldAskStart, SKIP_KEY } from '../../WelcomeStart.jsx'
import { businessDayKey } from '../timeclock.js'

const today = () => businessDayKey(Date.now())
const crew = (over = {}) => ({ uid: 'u1', name: 'Aaron', role: 'crew', status: 'active', ...over })

beforeEach(() => { try { localStorage.clear() } catch { /* ignore */ } })

describe('who gets asked, and when', () => {
  it('a crew member with no entry today is asked', () => {
    expect(shouldAskStart(crew(), [])).toBe(true)
  })

  it('and is not asked again once they have started', () => {
    /* The phone sleeps in a pocket and this app is reopened twenty times a
       shift. Asking every load would make it the most tapped screen here. */
    expect(shouldAskStart(crew(), [{ uid: 'u1', day: today() }])).toBe(false)
  })

  it('yesterdayentry does not count for today', () => {
    expect(shouldAskStart(crew(), [{ uid: 'u1', day: '2000-01-01' }])).toBe(true)
  })

  it('somebody else entry does not count either', () => {
    expect(shouldAskStart(crew(), [{ uid: 'someone-else', day: today() }])).toBe(true)
  })

  it('a viewer keeps no time, so is never asked', () => {
    expect(shouldAskStart(crew({ role: 'viewer' }), [])).toBe(false)
  })

  it('nor is anyone who is not active', () => {
    expect(shouldAskStart(crew({ status: 'pending' }), [])).toBe(false)
    expect(shouldAskStart(null, [])).toBe(false)
  })

  it('"not working today" is remembered for the rest of the day', () => {
    localStorage.setItem(SKIP_KEY, today())
    expect(shouldAskStart(crew(), [])).toBe(false)
  })

  it('but only for that day', () => {
    localStorage.setItem(SKIP_KEY, '2000-01-01')
    expect(shouldAskStart(crew(), [])).toBe(true)
  })

  it('and a missing entries list does not throw', () => {
    expect(shouldAskStart(crew(), undefined)).toBe(true)
  })
})

describe('the screen cannot trap somebody on it', () => {
  /* The timeEntries subscription may not have landed when the app paints -
     a real possibility on a slow phone. shouldAskStart then sees no entry,
     asks, and the write is refused as a duplicate. Treating that refusal as
     an error left the person stuck on the welcome screen, whose only other
     exit says "Not working today" - which would then read, on Casey's
     timesheet, as somebody who never turned up. */
  const SRC = readFileSync('src/WelcomeStart.jsx', 'utf8')

  it('an "already clocked in" refusal lets them through', () => {
    expect(SRC).toContain("if (/already clocked in/i.test(msg))")
    const at = SRC.indexOf("if (/already clocked in/i.test(msg))")
    expect(SRC.slice(at, at + 220)).toContain('onDone()')
  })

  it('and the wording it matches is the wording the store throws', () => {
    /* Two files agreeing by coincidence is how this silently stops working.
       If the message is ever reworded, this fails rather than the phone. */
    const STORE = readFileSync('src/store.jsx', 'utf8')
    expect(STORE).toContain("'You are already clocked in for today.'")
    expect(/already clocked in/i.test('You are already clocked in for today.')).toBe(true)
  })

  it('every other failure still shows and keeps them put', () => {
    const at = SRC.indexOf("if (/already clocked in/i.test(msg))")
    expect(SRC.slice(at, at + 320)).toContain('toast(msg)')
  })
})
