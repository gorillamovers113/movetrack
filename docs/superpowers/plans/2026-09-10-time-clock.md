# Time Clock and Per-Unit Labour Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give packers and movers a daily clock in and out with an auto-deducted lunch, attribute their working time to the units they were in, and let an admin correct or back-enter days without the crew seeing the corrections.

**Architecture:** Pure domain logic in `src/lib/` (no Firebase, `now` passed in, unit-tested with vitest), Firestore writes through the existing `dispatch({ type, p })` switch in `src/store.jsx`, access enforced in `firestore.rules` and proved against the emulator. Two new collections, `timeEntries` and `unitSessions`, plus an admin-only `timeCorrections`. Reporting extends `src/lib/reports.js`.

**Tech Stack:** React 19, Vite, Firebase (Auth, Firestore), vitest, `@firebase/rules-unit-testing`, oxlint.

## Global Constraints

- **Never round any time value.** Store epoch milliseconds exactly; format for display only. Per *Camp v. Home Depot*, an app that can capture exact time must use it.
- **Day keys use `America/Los_Angeles`**, never the client's local zone and never UTC. `todayKey()` in `src/lib/schedule.js` is client-local and must NOT be reused here.
- **Clock applies to `packer` and `mover` roles only.** Never `viewer`, `warehouse`, `driver` or `admin` as subjects.
- **`EARLIEST_CLOCK_IN_HOUR = 8`** — one exported constant, used by UI, store and rules. No literal `8` anywhere else.
- **`LUNCH_MINUTES = 30`**, deducted only when the gross span (`clockOut - clockIn`) exceeds **5 hours**.
- **Correction history never lives on `timeEntries`.** Crew can read their own entries, so anything stored there is visible to them regardless of UI.
- Comments explain *why*, not *what*. Match the surrounding file's density.
- **No em-dashes** in any copy, comment or commit message.
- Run `npx oxlint src/` before every commit; the build runs it via `prebuild` and fails on errors.

---

### Task 1: Time domain logic

**Files:**
- Create: `src/lib/timeclock.js`
- Test: `src/lib/__tests__/timeclock.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `EARLIEST_CLOCK_IN_HOUR: number`, `LUNCH_MINUTES: number`, `LUNCH_THRESHOLD_MS: number`, `businessDayKey(ms: number) => string`, `earliestClockInMs(dayKey: string) => number`, `canClockInAt(ms: number) => boolean`, `lunchMinutesFor(grossMs: number, workedThroughLunch: boolean) => number`, `workedMs(entry) => number`, `CLOCK_ROLES: string[]`, `usesClock(role: string) => boolean`.

- [ ] **Step 1: Write the failing test**

```js
// src/lib/__tests__/timeclock.test.js
import { describe, it, expect } from 'vitest'
import {
  EARLIEST_CLOCK_IN_HOUR, LUNCH_MINUTES, businessDayKey, earliestClockInMs,
  canClockInAt, lunchMinutesFor, workedMs, usesClock,
} from '../timeclock.js'

const at = (iso) => Date.parse(iso)

describe('business day key', () => {
  it('uses Pacific time, not the machine timezone', () => {
    // 06:30 UTC on the 11th is still the 10th in California.
    expect(businessDayKey(at('2026-09-11T06:30:00Z'))).toBe('2026-09-10')
  })

  it('rolls over at Pacific midnight', () => {
    expect(businessDayKey(at('2026-09-11T06:59:59Z'))).toBe('2026-09-10')
    expect(businessDayKey(at('2026-09-11T07:00:00Z'))).toBe('2026-09-11')
  })
})

describe('the 8am floor', () => {
  it('refuses before 08:00 Pacific and allows from 08:00', () => {
    expect(EARLIEST_CLOCK_IN_HOUR).toBe(8)
    expect(canClockInAt(at('2026-09-10T14:59:59Z'))).toBe(false) // 07:59:59 PT
    expect(canClockInAt(at('2026-09-10T15:00:00Z'))).toBe(true)  // 08:00:00 PT
  })

  it('reports the exact moment the clock unlocks for a day', () => {
    const ms = earliestClockInMs('2026-09-10')
    expect(businessDayKey(ms)).toBe('2026-09-10')
    expect(canClockInAt(ms)).toBe(true)
    expect(canClockInAt(ms - 1)).toBe(false)
  })
})

describe('lunch', () => {
  const H = 3600000
  it('deducts nothing at or under five hours gross', () => {
    expect(lunchMinutesFor(5 * H, false)).toBe(0)
    expect(lunchMinutesFor(5 * H - 60000, false)).toBe(0)
  })

  it('deducts thirty minutes once the gross span passes five hours', () => {
    expect(lunchMinutesFor(5 * H + 1000, false)).toBe(LUNCH_MINUTES)
    expect(lunchMinutesFor(9 * H, false)).toBe(LUNCH_MINUTES)
  })

  it('deducts nothing when the person says they worked through it', () => {
    expect(lunchMinutesFor(9 * H, true)).toBe(0)
  })

  it('measures the threshold on the gross span, before any deduction', () => {
    // 5h10m gross stays over the line and pays 4h40m.
    const entry = { clockIn: at('2026-09-10T15:00:00Z'), clockOut: at('2026-09-10T20:10:00Z'), lunchMinutes: 30 }
    expect(workedMs(entry)).toBe(4 * H + 40 * 60000)
  })
})

describe('worked time', () => {
  it('is zero while the day is still open', () => {
    expect(workedMs({ clockIn: at('2026-09-10T15:00:00Z'), clockOut: null, lunchMinutes: 0 })).toBe(0)
  })

  it('never goes negative on a malformed entry', () => {
    expect(workedMs({ clockIn: 1000, clockOut: 500, lunchMinutes: 30 })).toBe(0)
  })
})

describe('who uses the clock', () => {
  it('is packers and movers only', () => {
    expect(usesClock('packer')).toBe(true)
    expect(usesClock('mover')).toBe(true)
    for (const r of ['viewer', 'warehouse', 'driver', 'admin', '', null]) {
      expect(usesClock(r)).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/timeclock.test.js`
Expected: FAIL, "Failed to resolve import ../timeclock.js".

- [ ] **Step 3: Write minimal implementation**

```js
// src/lib/timeclock.js
/* Time clock domain logic. Pure: no Firebase, no Date.now(), every moment is
 * passed in, so the whole thing is testable and cannot drift with the machine
 * clock. See docs/superpowers/specs/2026-09-10-time-clock-design.md.
 */

// The crew work in San Diego. A day key derived from the browser's timezone
// would put an evening shift on the wrong date for anyone whose laptop is set
// elsewhere, and a UTC key would do it for everyone after 5pm. This is the same
// mistake the dispatch lockouts hit once already.
const BUSINESS_TZ = 'America/Los_Angeles'

export const EARLIEST_CLOCK_IN_HOUR = 8
export const LUNCH_MINUTES = 30
export const LUNCH_THRESHOLD_MS = 5 * 60 * 60 * 1000

export const CLOCK_ROLES = ['packer', 'mover']
export function usesClock(role) {
  return CLOCK_ROLES.indexOf(role) !== -1
}

export function businessDayKey(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms))
}

// The wall-clock hour in California at a given instant.
function businessHour(ms) {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TZ, hour: '2-digit', hour12: false,
  }).format(new Date(ms))
  return Number(s)
}

export function canClockInAt(ms) {
  return businessHour(ms) >= EARLIEST_CLOCK_IN_HOUR
}

// The first instant of a day at which clocking in is allowed. Found by probing
// rather than by arithmetic on an offset, because the offset changes twice a
// year and hard-coding it would break for one night each spring and autumn.
export function earliestClockInMs(dayKey) {
  const noonUtc = Date.parse(`${dayKey}T12:00:00Z`)
  let ms = noonUtc - 12 * 3600000
  for (let i = 0; i < 48; i++) {
    const t = ms + i * 3600000
    if (businessDayKey(t) === dayKey && businessHour(t) >= EARLIEST_CLOCK_IN_HOUR) {
      // Walk back to the exact minute the hour begins.
      let exact = t
      while (businessHour(exact - 60000) >= EARLIEST_CLOCK_IN_HOUR
             && businessDayKey(exact - 60000) === dayKey) {
        exact -= 60000
      }
      return exact - (exact % 60000)
    }
  }
  return noonUtc
}

export function lunchMinutesFor(grossMs, workedThroughLunch) {
  if (workedThroughLunch) return 0
  return grossMs > LUNCH_THRESHOLD_MS ? LUNCH_MINUTES : 0
}

export function workedMs(entry) {
  if (!entry || !entry.clockIn || !entry.clockOut) return 0
  const gross = entry.clockOut - entry.clockIn
  const net = gross - (Number(entry.lunchMinutes) || 0) * 60000
  return net > 0 ? net : 0
}
```

- [ ] **Step 4: Run tests and lint**

Run: `TZ=UTC npx vitest run src/lib/__tests__/timeclock.test.js && TZ=Australia/Sydney npx vitest run src/lib/__tests__/timeclock.test.js && npx oxlint src/`
Expected: PASS under both timezones, 0 lint errors. Running under two zones is the point: the day-key bug this guards against only appears when the machine is not in California.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeclock.js src/lib/__tests__/timeclock.test.js
git commit -m "Time clock domain logic: business day keys, the 8am floor, lunch rule"
```

---

### Task 2: Unit session domain logic

**Files:**
- Modify: `src/lib/timeclock.js`
- Modify: `src/lib/__tests__/timeclock.test.js`

**Interfaces:**
- Consumes: `businessDayKey` from Task 1.
- Produces: `sessionMs(session, now) => number`, `openSessionFor(sessions, uid) => session|null`, `unitLabourMs(sessions, unitId) => number`, `unitLabourByPerson(sessions, unitId) => Array<{uid, userName, ms, sessions: number}>`, `dayLabourMs(sessions, uid, dayKey) => number`.

- [ ] **Step 1: Write the failing test**

```js
// append to src/lib/__tests__/timeclock.test.js
import { sessionMs, openSessionFor, unitLabourMs, unitLabourByPerson, dayLabourMs } from '../timeclock.js'

const S = (over = {}) => ({
  unitId: 'u1', uid: 'liv', userName: 'Liv Post', day: '2026-09-10',
  startedAt: at('2026-09-10T16:00:00Z'), endedAt: at('2026-09-10T17:00:00Z'), ...over,
})

describe('unit sessions', () => {
  it('measures a closed session exactly', () => {
    expect(sessionMs(S(), 0)).toBe(3600000)
  })

  it('measures an open session up to now, and not into the future', () => {
    const open = S({ endedAt: null })
    expect(sessionMs(open, at('2026-09-10T16:30:00Z'))).toBe(1800000)
    expect(sessionMs(open, at('2026-09-10T15:00:00Z'))).toBe(0)
  })

  it('treats a backwards session as zero, never negative', () => {
    expect(sessionMs(S({ endedAt: at('2026-09-10T15:00:00Z') }), 0)).toBe(0)
  })

  it('finds the one open session for a person', () => {
    const list = [S(), S({ unitId: 'u2', endedAt: null })]
    expect(openSessionFor(list, 'liv').unitId).toBe('u2')
    expect(openSessionFor(list, 'ana')).toBe(null)
  })

  it('sums every session on a unit, including repeat visits', () => {
    const list = [
      S({ startedAt: at('2026-09-10T16:00:00Z'), endedAt: at('2026-09-10T17:00:00Z') }),
      S({ startedAt: at('2026-09-10T19:00:00Z'), endedAt: at('2026-09-10T19:30:00Z') }),
      S({ unitId: 'other', startedAt: at('2026-09-10T18:00:00Z'), endedAt: at('2026-09-10T18:30:00Z') }),
    ]
    expect(unitLabourMs(list, 'u1', 0)).toBe(5400000)
  })

  it('breaks a unit down by person, newest contribution first', () => {
    const list = [
      S({ uid: 'liv', userName: 'Liv Post' }),
      S({ uid: 'ana', userName: 'Ana Ruiz', startedAt: at('2026-09-10T18:00:00Z'), endedAt: at('2026-09-10T20:00:00Z') }),
    ]
    const rows = unitLabourByPerson(list, 'u1', 0)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ userName: 'Ana Ruiz', ms: 7200000, sessions: 1 })
    expect(rows[1]).toMatchObject({ userName: 'Liv Post', ms: 3600000, sessions: 1 })
  })

  it('sums a person day across units, which is what reconciles against the clock', () => {
    const list = [S({ unitId: 'u1' }), S({ unitId: 'u2', startedAt: at('2026-09-10T18:00:00Z'), endedAt: at('2026-09-10T18:30:00Z') })]
    expect(dayLabourMs(list, 'liv', '2026-09-10', 0)).toBe(5400000)
    expect(dayLabourMs(list, 'liv', '2026-09-11', 0)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/timeclock.test.js`
Expected: FAIL, "sessionMs is not a function".

- [ ] **Step 3: Write minimal implementation**

```js
// append to src/lib/timeclock.js

/* Unit sessions. A person is checked into at most one unit at a time, so these
 * never overlap and their totals can be added without double counting. That
 * constraint is the whole reason the numbers mean anything: on the first pack
 * day two units held open at once produced 7h44m of unit time from about five
 * and a half hours of work.
 */
export function sessionMs(session, now = 0) {
  if (!session || !session.startedAt) return 0
  const end = session.endedAt || now
  const ms = end - session.startedAt
  return ms > 0 ? ms : 0
}

export function openSessionFor(sessions, uid) {
  return (sessions || []).find((s) => s && s.uid === uid && !s.endedAt) || null
}

export function unitLabourMs(sessions, unitId, now = 0) {
  return (sessions || [])
    .filter((s) => s && s.unitId === unitId)
    .reduce((n, s) => n + sessionMs(s, now), 0)
}

export function unitLabourByPerson(sessions, unitId, now = 0) {
  const by = new Map()
  for (const s of sessions || []) {
    if (!s || s.unitId !== unitId) continue
    const row = by.get(s.uid) || { uid: s.uid, userName: s.userName || 'Crew', ms: 0, sessions: 0 }
    row.ms += sessionMs(s, now)
    row.sessions += 1
    by.set(s.uid, row)
  }
  return [...by.values()].sort((a, b) => b.ms - a.ms)
}

export function dayLabourMs(sessions, uid, dayKey, now = 0) {
  return (sessions || [])
    .filter((s) => s && s.uid === uid && s.day === dayKey)
    .reduce((n, s) => n + sessionMs(s, now), 0)
}
```

- [ ] **Step 4: Run tests and lint**

Run: `npx vitest run src/lib && npx oxlint src/`
Expected: PASS, 0 lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timeclock.js src/lib/__tests__/timeclock.test.js
git commit -m "Unit session totals that cannot double count"
```

---

### Task 3: Security rules

**Files:**
- Modify: `firestore.rules`
- Modify: `test/rules/security.rules.test.js`

**Interfaces:**
- Consumes: existing rules helpers `isActive()`, `hasRole(r)`, `isAdmin()`.
- Produces: read/write rules for `timeEntries`, `unitSessions`, `timeCorrections`.

Note the existing test file already defines `ADMIN`, `PACKER`, `MOVER`, `WAREHOUSE`, `VIEWER`, `OTHER_PACKER`, `seed()` and `dbAs()`. Reuse them.

- [ ] **Step 1: Write the failing test**

```js
// append inside test/rules/security.rules.test.js, at top level
describe('timeEntries', () => {
  const entry = (over = {}) => ({
    uid: PACKER, userName: 'Test packer-1', role: 'packer', day: '2026-09-10',
    clockIn: Date.parse('2026-09-10T16:00:00Z'), clockOut: null,
    lunchMinutes: 0, workedThroughLunch: false, source: 'self', ...over,
  })

  it('a packer may open their own day', async () => {
    await assertSucceeds(addDoc(collection(dbAs(PACKER), 'timeEntries'), entry()))
  })

  it('a mover may open their own day', async () => {
    await assertSucceeds(addDoc(collection(dbAs(MOVER), 'timeEntries'),
      entry({ uid: MOVER, userName: 'Test mover-1', role: 'mover' })))
  })

  it('a packer may not open a day for somebody else', async () => {
    await assertFails(addDoc(collection(dbAs(PACKER), 'timeEntries'), entry({ uid: OTHER_PACKER })))
  })

  it('a packer may not clock in before 8am Pacific', async () => {
    // 14:59Z is 07:59 PT.
    await assertFails(addDoc(collection(dbAs(PACKER), 'timeEntries'),
      entry({ clockIn: Date.parse('2026-09-10T14:59:00Z') })))
  })

  it('a packer may not create a day already marked as admin-entered', async () => {
    await assertFails(addDoc(collection(dbAs(PACKER), 'timeEntries'), entry({ source: 'admin' })))
  })

  it('a viewer and a warehouse user may not create days at all', async () => {
    for (const who of [VIEWER, WAREHOUSE]) {
      await assertFails(addDoc(collection(dbAs(who), 'timeEntries'), entry({ uid: who })))
    }
  })

  it('a packer may close their own open day', async () => {
    await seed('timeEntries', 't1', entry())
    await assertSucceeds(updateDoc(doc(dbAs(PACKER), 'timeEntries', 't1'), {
      clockOut: Date.parse('2026-09-10T23:00:00Z'), lunchMinutes: 30, workedThroughLunch: false,
    }))
  })

  it('a packer may not move their own clock-in while closing', async () => {
    await seed('timeEntries', 't1', entry())
    await assertFails(updateDoc(doc(dbAs(PACKER), 'timeEntries', 't1'), {
      clockOut: Date.parse('2026-09-10T23:00:00Z'), clockIn: Date.parse('2026-09-10T15:00:00Z'),
    }))
  })

  it('a packer may not reopen or edit a day that is already closed', async () => {
    await seed('timeEntries', 't1', entry({ clockOut: Date.parse('2026-09-10T23:00:00Z'), lunchMinutes: 30 }))
    await assertFails(updateDoc(doc(dbAs(PACKER), 'timeEntries', 't1'), { clockOut: null }))
    await assertFails(updateDoc(doc(dbAs(PACKER), 'timeEntries', 't1'), { lunchMinutes: 0 }))
  })

  it('a packer may not touch another packer day', async () => {
    await seed('timeEntries', 't1', entry({ uid: OTHER_PACKER }))
    await assertFails(updateDoc(doc(dbAs(PACKER), 'timeEntries', 't1'), {
      clockOut: Date.parse('2026-09-10T23:00:00Z'),
    }))
  })

  it('a packer reads their own days and nobody else', async () => {
    await seed('timeEntries', 'mine', entry())
    await seed('timeEntries', 'theirs', entry({ uid: OTHER_PACKER }))
    await assertSucceeds(getDoc(doc(dbAs(PACKER), 'timeEntries', 'mine')))
    await assertFails(getDoc(doc(dbAs(PACKER), 'timeEntries', 'theirs')))
  })

  it('an admin may back-enter a past day for someone, before 8am, marked as admin', async () => {
    await assertSucceeds(addDoc(collection(dbAs(ADMIN), 'timeEntries'), entry({
      day: '2026-09-09',
      clockIn: Date.parse('2026-09-09T14:30:00Z'),
      clockOut: Date.parse('2026-09-09T23:00:00Z'),
      lunchMinutes: 30, source: 'admin', enteredBy: ADMIN, notes: 'Worked before the app existed',
    })))
  })

  it('an admin may edit a closed day', async () => {
    await seed('timeEntries', 't1', entry({ clockOut: Date.parse('2026-09-10T23:00:00Z'), lunchMinutes: 30 }))
    await assertSucceeds(updateDoc(doc(dbAs(ADMIN), 'timeEntries', 't1'), {
      clockOut: Date.parse('2026-09-10T22:30:00Z'),
    }))
  })
})

describe('timeCorrections', () => {
  const corr = { entryId: 't1', uid: PACKER, day: '2026-09-10', field: 'clockOut',
    oldValue: 1, newValue: 2, byUid: ADMIN, byName: 'Casey P', at: 1 }

  it('an admin may write one', async () => {
    await assertSucceeds(addDoc(collection(dbAs(ADMIN), 'timeCorrections'), corr))
  })

  it('a packer may not write one', async () => {
    await assertFails(addDoc(collection(dbAs(PACKER), 'timeCorrections'), corr))
  })

  // This is the test that makes the hiding real rather than cosmetic: a crew
  // member cannot read the correction history even for their own day.
  it('a packer may not read corrections, their own included', async () => {
    await seed('timeCorrections', 'c1', corr)
    await assertFails(getDoc(doc(dbAs(PACKER), 'timeCorrections', 'c1')))
  })

  it('a viewer may not read corrections either', async () => {
    await seed('timeCorrections', 'c1', corr)
    await assertFails(getDoc(doc(dbAs(VIEWER), 'timeCorrections', 'c1')))
  })

  // A corrected entry must look exactly like an uncorrected one to its owner:
  // the new value, and nothing saying it used to be something else.
  it('a corrected entry carries no trace of the correction', async () => {
    await seed('timeEntries', 't1', {
      uid: PACKER, userName: 'Test packer-1', role: 'packer', day: '2026-09-10',
      clockIn: Date.parse('2026-09-10T16:00:00Z'), clockOut: Date.parse('2026-09-11T00:00:00Z'),
      lunchMinutes: 30, workedThroughLunch: false, source: 'self',
    })
    await assertSucceeds(updateDoc(doc(dbAs(ADMIN), 'timeEntries', 't1'), {
      clockIn: Date.parse('2026-09-10T15:45:00Z'),
    }))
    const snap = await getDoc(doc(dbAs(PACKER), 'timeEntries', 't1'))
    const data = snap.data()
    expect(data.clockIn).toBe(Date.parse('2026-09-10T15:45:00Z'))
    for (const leak of ['correctedBy', 'correctedAt', 'corrections', 'oldValue', 'previousClockIn']) {
      expect(data[leak]).toBeUndefined()
    }
  })
})

describe('unitSessions', () => {
  const sess = (over = {}) => ({
    unitId: 'u1', uid: PACKER, userName: 'Test packer-1', day: '2026-09-10',
    startedAt: Date.parse('2026-09-10T16:00:00Z'), endedAt: null, endedReason: null, ...over,
  })

  it('a packer may open and close their own session', async () => {
    await assertSucceeds(addDoc(collection(dbAs(PACKER), 'unitSessions'), sess()))
    await seed('unitSessions', 's1', sess())
    await assertSucceeds(updateDoc(doc(dbAs(PACKER), 'unitSessions', 's1'), {
      endedAt: Date.parse('2026-09-10T17:00:00Z'), endedReason: 'switched',
    }))
  })

  it('a packer may not open a session as someone else', async () => {
    await assertFails(addDoc(collection(dbAs(PACKER), 'unitSessions'), sess({ uid: OTHER_PACKER })))
  })

  it('a packer may not close somebody else session', async () => {
    await seed('unitSessions', 's1', sess({ uid: OTHER_PACKER }))
    await assertFails(updateDoc(doc(dbAs(PACKER), 'unitSessions', 's1'), {
      endedAt: Date.parse('2026-09-10T17:00:00Z'),
    }))
  })

  it('a packer may not move the start of a session while closing it', async () => {
    await seed('unitSessions', 's1', sess())
    await assertFails(updateDoc(doc(dbAs(PACKER), 'unitSessions', 's1'), {
      endedAt: Date.parse('2026-09-10T17:00:00Z'),
      startedAt: Date.parse('2026-09-10T15:00:00Z'),
    }))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:rules`
Expected: FAIL. Every new assertion fails because no rule grants access to the new collections, so even the allowed writes are denied.

- [ ] **Step 3: Write the rules**

Add before the closing `}` of `match /databases/{database}/documents`:

```
    // ---- time clock ----
    // Only packers and movers keep time. Everyone else is either not on the
    // clock or is the person reviewing it.
    function onTheClock() {
      return isActive() && (hasRole('packer') || hasRole('mover'));
    }

    // 08:00 America/Los_Angeles, expressed as the UTC hour, because rules have
    // no timezone library. Pacific is UTC-7 in daylight time and UTC-8 in
    // standard time, so 08:00 local is 15:00Z or 16:00Z. Accepting the later
    // of the two would let someone clock in an hour early for half the year,
    // so this takes the earlier boundary and the client enforces the exact
    // minute. The rule is the floor, not the whole story.
    function afterEarliestClockIn(ms) {
      return (ms % 86400000) >= 15 * 3600000;
    }

    match /timeEntries/{entryId} {
      allow read: if isAdmin()
        || (onTheClock() && resource.data.uid == request.auth.uid);

      // Crew open their own day, always as 'self', never before the floor,
      // and always open (clockOut null) so a day cannot be fabricated whole.
      allow create: if isAdmin()
        ? request.resource.data.source == 'admin'
          && request.resource.data.enteredBy == request.auth.uid
        : onTheClock()
          && request.resource.data.uid == request.auth.uid
          && request.resource.data.source == 'self'
          && request.resource.data.clockOut == null
          && afterEarliestClockIn(request.resource.data.clockIn);

      // Crew close their own open day and touch nothing else on it. An admin
      // may edit anything, at any age, and is the only role that can.
      allow update: if isAdmin()
        || (onTheClock()
            && resource.data.uid == request.auth.uid
            && resource.data.clockOut == null
            && request.resource.data.uid == resource.data.uid
            && request.resource.data.day == resource.data.day
            && request.resource.data.clockIn == resource.data.clockIn
            && request.resource.data.source == resource.data.source
            && request.resource.data.clockOut != null
            && request.resource.data.diff(resource.data).affectedKeys()
                 .hasOnly(['clockOut', 'lunchMinutes', 'workedThroughLunch']));

      allow delete: if isAdmin();
    }

    // The correction history lives here and not on the entry, because crew can
    // read their own entries and anything stored there would be readable by
    // them whatever the interface renders. Admin only, both ways.
    match /timeCorrections/{correctionId} {
      allow read, write: if isAdmin();
    }

    match /unitSessions/{sessionId} {
      allow read: if isAdmin()
        || (onTheClock() && resource.data.uid == request.auth.uid);

      allow create: if isAdmin()
        || (onTheClock()
            && request.resource.data.uid == request.auth.uid
            && request.resource.data.endedAt == null);

      allow update: if isAdmin()
        || (onTheClock()
            && resource.data.uid == request.auth.uid
            && request.resource.data.uid == resource.data.uid
            && request.resource.data.startedAt == resource.data.startedAt
            && request.resource.data.diff(resource.data).affectedKeys()
                 .hasOnly(['endedAt', 'endedReason']));

      allow delete: if isAdmin();
    }
```

- [ ] **Step 4: Run the rules tests**

Run: `npm run test:rules`
Expected: PASS, all existing tests plus the new ones.

If the admin-read tests on `unitSessions` fail because a report needs to list every session, note that `allow read` above is per-document; the admin branch already covers collection queries. Do not widen the crew branch to fix a report.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules test/rules/security.rules.test.js
git commit -m "Rules for time entries, unit sessions and admin-only corrections"
```

---

### Task 4: Store actions

**Files:**
- Modify: `src/store.jsx`

**Interfaces:**
- Consumes: `businessDayKey`, `canClockInAt`, `lunchMinutesFor`, `openSessionFor`, `usesClock` from `src/lib/timeclock.js`.
- Produces: dispatch actions `clockIn`, `clockOut`, `openUnitSession`, `closeUnitSession`, `adminAddTimeEntry`, `adminCorrectTimeEntry`.

- [ ] **Step 1: Add the subscriptions**

In the subscription effect (the array of `onSnapshot` calls keyed on `sessionKey`), add two more and their state. Crew rules only permit reading their own rows, so the query must be scoped for them or the listener is denied and dies permanently, which is the exact bug that broke the board on the first morning.

```js
const [timeEntries, setTimeEntries] = useState([])
const [unitSessions, setUnitSessions] = useState([])
```

```js
// Admin sees everyone; crew see only their own rows, because that is all the
// rules allow. An unscoped query for a packer is denied, and a denied listener
// never retries.
const mineOnly = (col) => (currentUser.role === 'admin'
  ? collection(db, col)
  : query(collection(db, col), where('uid', '==', currentUser.uid)))

onSnapshot(mineOnly('timeEntries'), (s) => setTimeEntries(s.docs.map((d) => ({ id: d.id, ...d.data() }))), onErr('timeEntries')),
onSnapshot(mineOnly('unitSessions'), (s) => setUnitSessions(s.docs.map((d) => ({ id: d.id, ...d.data() }))), onErr('unitSessions')),
```

Add `where` to the `firebase/firestore` import, add both arrays to the `state` object, and clear both in the signed-out branch alongside the existing `setUnits([])` line.

- [ ] **Step 2: Add the clock actions**

Insert these cases into the `dispatch` switch, next to the other unit cases.

**None of these write an `events` document, and that is deliberate.** Every
other action in this app logs to `/events`, whose read rule is `isActive()`,
meaning the whole crew sees it in the Activity feed. Logging a correction there
would announce "Corrected Liv's time for 2026-09-10" to everyone, which is the
exact opposite of what was asked for, and logging clock-ins would put every
person's hours in front of every other person when the spec makes time reports
admin only. The time collections are their own audit trail. Do not add `ev(...)`
calls to any of these cases.

```js
      case 'clockIn': {
        // The floor is enforced here and in the rules. The client check exists
        // to give a reason; the rule exists because a client check is a
        // suggestion.
        const now = Date.now()
        if (!usesClock(currentUser.role)) throw new Error('Only packers and movers clock in.')
        if (!canClockInAt(now)) throw new Error('The clock opens at 8:00am.')
        const day = businessDayKey(now)
        const already = state.timeEntries.find((e) => e.uid === currentUser.uid && e.day === day)
        if (already) throw new Error('You are already clocked in for today.')
        await addDoc(collection(db, 'timeEntries'), {
          uid: currentUser.uid, userName: currentUser.name, role: currentUser.role,
          day, clockIn: now, clockOut: null,
          lunchMinutes: 0, workedThroughLunch: false, source: 'self',
        })
        return
      }
      case 'clockOut': {
        const now = Date.now()
        const day = businessDayKey(now)
        const open = state.timeEntries.find((e) => e.uid === currentUser.uid && !e.clockOut)
        if (!open) throw new Error('You are not clocked in.')

        // Close whatever unit they were still standing in, so a day never ends
        // with a session running.
        const session = openSessionFor(state.unitSessions, currentUser.uid)
        if (session) {
          await updateDoc(doc(db, 'unitSessions', session.id), { endedAt: now, endedReason: 'clockOut' })
        }

        const lunch = lunchMinutesFor(now - open.clockIn, !!p.workedThroughLunch)
        await updateDoc(doc(db, 'timeEntries', open.id), {
          clockOut: now, lunchMinutes: lunch, workedThroughLunch: !!p.workedThroughLunch,
        })
        return
      }
      case 'openUnitSession': {
        // One unit at a time. Opening another closes the last, because the
        // person has physically walked to a different apartment and the old
        // one ended whether or not anybody tapped anything.
        const now = Date.now()
        if (!usesClock(currentUser.role)) return
        const open = openSessionFor(state.unitSessions, currentUser.uid)
        if (open && open.unitId === p.unitId) return
        if (open) {
          await updateDoc(doc(db, 'unitSessions', open.id), { endedAt: now, endedReason: 'switched' })
        }
        await addDoc(collection(db, 'unitSessions'), {
          unitId: p.unitId, uid: currentUser.uid, userName: currentUser.name,
          day: businessDayKey(now), startedAt: now, endedAt: null, endedReason: null,
        })
        return
      }
      case 'closeUnitSession': {
        const open = openSessionFor(state.unitSessions, currentUser.uid)
        if (!open) return
        await updateDoc(doc(db, 'unitSessions', open.id), { endedAt: Date.now(), endedReason: 'manual' })
        return
      }
      case 'adminAddTimeEntry': {
        // Back-entry for a day the app was not used. No 8am floor: this records
        // history, and history does not become false because it started early.
        const target = state.users.find((u) => u.uid === p.uid || u.id === p.uid)
        if (!target) throw new Error('Pick a packer or mover.')
        if (!usesClock(target.role)) throw new Error('Only packers and movers keep time.')
        if (!p.clockIn || !p.clockOut || p.clockOut <= p.clockIn) throw new Error('Finish time must be after start time.')
        const lunch = p.lunchMinutes != null
          ? Math.max(0, Math.floor(p.lunchMinutes))
          : lunchMinutesFor(p.clockOut - p.clockIn, false)
        await addDoc(collection(db, 'timeEntries'), {
          uid: target.uid || target.id, userName: target.name, role: target.role,
          day: businessDayKey(p.clockIn), clockIn: p.clockIn, clockOut: p.clockOut,
          lunchMinutes: lunch, workedThroughLunch: false,
          source: 'admin', notes: (p.notes || '').trim(),
          enteredBy: currentUser.uid, enteredAt: Date.now(),
        })
        return
      }
      case 'adminCorrectTimeEntry': {
        // The old value is written to timeCorrections, never onto the entry.
        // Crew can read their own entries, so a history stored there would be
        // readable by them however the screen chooses to render it.
        const entry = state.timeEntries.find((e) => e.id === p.entryId)
        if (!entry) throw new Error('That entry is gone. Refresh and try again.')
        const now = Date.now()
        for (const field of Object.keys(p.changes || {})) {
          if (entry[field] === p.changes[field]) continue
          await addDoc(collection(db, 'timeCorrections'), {
            entryId: entry.id, uid: entry.uid, day: entry.day, field,
            oldValue: entry[field] === undefined ? null : entry[field],
            newValue: p.changes[field],
            byUid: currentUser.uid, byName: currentUser.name, at: now,
          })
        }
        await updateDoc(doc(db, 'timeEntries', p.entryId), p.changes)
        return
      }
```

- [ ] **Step 3: Wire sessions into opening a unit**

In `src/App.jsx`, `openUnit` already pushes history and sets the view. Add the session open alongside it, fire and forget so a slow write never delays the screen:

```js
  const openUnit = (unitId) => {
    // Checking into the unit is a side effect of opening it, so the crew never
    // have to remember a separate action. Failures are swallowed: a missing
    // session is a reporting gap, and blocking someone from opening a unit
    // because of one would be worse.
    Promise.resolve(dispatch({ type: 'openUnitSession', p: { unitId } })).catch(() => {})
    setView((v) => {
```

`dispatch` comes from `useStore()`, which `Shell` already calls; add `dispatch` to that destructure if it is not there.

- [ ] **Step 4: Verify nothing regressed**

Run: `npx oxlint src/ && npx vitest run src && npm run build`
Expected: 0 lint errors, 206+ tests passing, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/store.jsx src/App.jsx
git commit -m "Clock in and out, unit sessions, admin back-entry and corrections"
```

---

### Task 5: The crew clock card

**Files:**
- Create: `src/components/ClockCard.jsx`
- Modify: `src/views/MyWork.jsx`

**Interfaces:**
- Consumes: `dispatch` actions `clockIn` / `clockOut`; `businessDayKey`, `canClockInAt`, `workedMs`, `usesClock`, `EARLIEST_CLOCK_IN_HOUR` from `src/lib/timeclock.js`; `fmtDuration` from `src/lib/reports.js`.
- Produces: `<ClockCard toast={fn} />`, rendered at the top of My queue for packers and movers.

- [ ] **Step 1: Write the component**

```jsx
// src/components/ClockCard.jsx
import React, { useEffect, useState } from 'react'
import { useStore, fmtTime } from '../store.jsx'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'
import { fmtDuration } from '../lib/reports.js'
import { businessDayKey, canClockInAt, workedMs, usesClock, EARLIEST_CLOCK_IN_HOUR } from '../lib/timeclock.js'

/* The crew's clock, at the top of their queue because it is the first and last
 * thing they touch each day. Deliberately three states and no more: not started,
 * running, done. */
export default function ClockCard({ toast }) {
  const { state, dispatch, currentUser } = useStore()
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [confirmOut, setConfirmOut] = useState(false)
  const [throughLunch, setThroughLunch] = useState(false)

  // A running total that stands still would look broken.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  if (!currentUser || !usesClock(currentUser.role)) return null

  const day = businessDayKey(now)
  const today = state.timeEntries.find((e) => e.uid === currentUser.uid && e.day === day)
  const open = today && !today.clockOut
  const tooEarly = !today && !canClockInAt(now)

  const run = async (fn, done) => {
    if (busy) return
    setBusy(true)
    try {
      const status = await submitWrite(fn())
      toast(status === 'queued' ? QUEUED_MESSAGE : done)
      setConfirmOut(false)
    } catch (err) {
      toast(err.message || "Couldn't save that. Check your signal and try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <div className="section-title grow" style={{ margin: 0 }}>Your day</div>
        {open && <span className="muted" style={{ fontWeight: 700 }}>{fmtDuration(now - today.clockIn)}</span>}
      </div>

      {!today && (
        <>
          <button
            className="btn btn-primary btn-lg" style={{ width: '100%' }}
            disabled={busy || tooEarly}
            onClick={() => run(() => dispatch({ type: 'clockIn' }), 'Clocked in ✓')}
          >
            {busy ? 'Saving…' : tooEarly ? `Opens at ${EARLIEST_CLOCK_IN_HOUR}:00am` : 'Clock in'}
          </button>
          {tooEarly && (
            <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
              The clock opens at {EARLIEST_CLOCK_IN_HOUR}:00am. If you are already working, tell Casey so he can add the time.
            </div>
          )}
        </>
      )}

      {open && !confirmOut && (
        <>
          <div className="muted" style={{ fontSize: 13.5, marginBottom: 10 }}>
            Started {fmtTime(today.clockIn)}.
          </div>
          <button className="btn btn-dark btn-lg" style={{ width: '100%' }} onClick={() => setConfirmOut(true)}>
            Clock out
          </button>
        </>
      )}

      {open && confirmOut && (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', fontSize: 13.5 }}>
            <input type="checkbox" checked={throughLunch} onChange={(e) => setThroughLunch(e.target.checked)} />
            I worked through lunch
          </label>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            Thirty minutes comes off automatically on a day over five hours. Tick the box only if you did not stop.
          </div>
          <button
            className="btn btn-primary btn-lg" style={{ width: '100%' }}
            disabled={busy}
            onClick={() => run(() => dispatch({ type: 'clockOut', p: { workedThroughLunch: throughLunch } }), 'Clocked out ✓')}
          >
            {busy ? 'Saving…' : 'Confirm clock out'}
          </button>
          <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setConfirmOut(false)}>
            Not yet
          </button>
        </>
      )}

      {today && today.clockOut && (
        <div style={{ fontSize: 13.5 }}>
          <b>{fmtDuration(workedMs(today))}</b> today
          <div className="muted" style={{ marginTop: 4 }}>
            {fmtTime(today.clockIn)} to {fmtTime(today.clockOut)}
            {today.lunchMinutes > 0 ? `, less ${today.lunchMinutes} min lunch` : ''}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Mount it**

In `src/views/MyWork.jsx`, import it and render it as the first element inside the returned fragment, above the `page-head`:

```jsx
import ClockCard from '../components/ClockCard.jsx'
```
```jsx
      <ClockCard toast={toast} />
```

The component returns `null` for every role except packer and mover, so no role check is needed at the call site.

- [ ] **Step 3: Verify**

Run: `npx oxlint src/ && npm run build`
Expected: 0 lint errors, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/ClockCard.jsx src/views/MyWork.jsx
git commit -m "Crew clock card at the top of My queue"
```

---

### Task 6: Reports

**Files:**
- Modify: `src/lib/reports.js`
- Modify: `src/lib/__tests__/reports.test.js`

**Interfaces:**
- Consumes: `workedMs`, `dayLabourMs`, `unitLabourByPerson`, `unitLabourMs` from `src/lib/timeclock.js`.
- Produces: `timesheet(timeEntries, sessions, dayKey, now) => Array<row>`, `unitLabour(sessions, unitId, now) => {totalMs, people}`.

- [ ] **Step 1: Write the failing test**

```js
// append to src/lib/__tests__/reports.test.js
import { timesheet, unitLabour } from '../reports.js'

describe('timesheet', () => {
  const at = (iso) => Date.parse(iso)
  const entry = (over = {}) => ({
    id: 'e1', uid: 'liv', userName: 'Liv Post', role: 'packer', day: '2026-09-10',
    clockIn: at('2026-09-10T16:00:00Z'), clockOut: at('2026-09-11T01:00:00Z'),
    lunchMinutes: 30, workedThroughLunch: false, source: 'self', ...over,
  })
  const sess = (over = {}) => ({
    unitId: 'u1', uid: 'liv', userName: 'Liv Post', day: '2026-09-10',
    startedAt: at('2026-09-10T16:00:00Z'), endedAt: at('2026-09-10T20:00:00Z'), ...over,
  })

  it('reports one row per person with worked time net of lunch', () => {
    const rows = timesheet([entry()], [], '2026-09-10', 0)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userName: 'Liv Post', workedMs: 8.5 * 3600000, lunchMinutes: 30 })
  })

  it('flags an open day and does not guess its length', () => {
    const rows = timesheet([entry({ clockOut: null, lunchMinutes: 0 })], [], '2026-09-10', 0)
    expect(rows[0]).toMatchObject({ open: true, workedMs: 0 })
  })

  it('flags a day the admin entered, and carries its note', () => {
    const rows = timesheet([entry({ source: 'admin', notes: 'Before the app' })], [], '2026-09-10', 0)
    expect(rows[0]).toMatchObject({ adminEntered: true, notes: 'Before the app' })
  })

  it('flags a worked-through-lunch day', () => {
    const rows = timesheet([entry({ workedThroughLunch: true, lunchMinutes: 0 })], [], '2026-09-10', 0)
    expect(rows[0].workedThroughLunch).toBe(true)
  })

  // The reconciliation the spec promises: unit time explains part of the day,
  // and whatever is left over is reported rather than hidden.
  it('splits the day into time attributed to units and time not', () => {
    const rows = timesheet([entry()], [sess()], '2026-09-10', 0)
    expect(rows[0].unitMs).toBe(4 * 3600000)
    expect(rows[0].unattributedMs).toBe(4.5 * 3600000)
  })

  it('reports a back-entered day as entirely unattributed, not as a shortfall', () => {
    const rows = timesheet([entry({ source: 'admin' })], [], '2026-09-10', 0)
    expect(rows[0].unitMs).toBe(0)
    expect(rows[0].unattributedMs).toBe(8.5 * 3600000)
    expect(rows[0].adminEntered).toBe(true)
  })

  it('ignores other days entirely', () => {
    expect(timesheet([entry({ day: '2026-09-09' })], [], '2026-09-10', 0)).toEqual([])
  })
})

describe('unitLabour', () => {
  const at = (iso) => Date.parse(iso)
  const sess = (over = {}) => ({
    unitId: 'u1', uid: 'liv', userName: 'Liv Post', day: '2026-09-10',
    startedAt: at('2026-09-10T16:00:00Z'), endedAt: at('2026-09-10T17:00:00Z'), ...over,
  })

  it('totals a unit and breaks it down by person', () => {
    const out = unitLabour([sess(), sess({ uid: 'ana', userName: 'Ana Ruiz' })], 'u1', 0)
    expect(out.totalMs).toBe(7200000)
    expect(out.people).toHaveLength(2)
  })

  it('is zero for a unit nobody has worked', () => {
    expect(unitLabour([], 'u9', 0)).toEqual({ totalMs: 0, people: [] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/reports.test.js`
Expected: FAIL, "timesheet is not a function".

- [ ] **Step 3: Write the implementation**

```js
// append to src/lib/reports.js
import { workedMs, dayLabourMs, unitLabourMs, unitLabourByPerson } from './timeclock.js'

/* One row per person for a given day. Admin only: individual hours are a more
 * sensitive record than the productivity reports viewers can already read. */
export function timesheet(timeEntries = [], sessions = [], dayKey, now = 0) {
  return (timeEntries || [])
    .filter((e) => e && e.day === dayKey)
    .map((e) => {
      const worked = workedMs(e)
      const unit = dayLabourMs(sessions, e.uid, dayKey, now)
      // Unit time can only explain time that was actually worked. A
      // back-entered day has hours and no sessions, and the remainder is
      // reported as unattributed rather than shown as a silent shortfall.
      const attributed = Math.min(unit, worked)
      return {
        entryId: e.id,
        uid: e.uid,
        userName: e.userName || 'Crew',
        role: e.role || '',
        clockIn: e.clockIn,
        clockOut: e.clockOut || null,
        lunchMinutes: Number(e.lunchMinutes) || 0,
        workedMs: worked,
        unitMs: attributed,
        unattributedMs: worked - attributed,
        open: !e.clockOut,
        adminEntered: e.source === 'admin',
        workedThroughLunch: !!e.workedThroughLunch,
        notes: e.notes || '',
      }
    })
    .sort((a, b) => (a.userName || '').localeCompare(b.userName || ''))
}

export function unitLabour(sessions = [], unitId, now = 0) {
  return {
    totalMs: unitLabourMs(sessions, unitId, now),
    people: unitLabourByPerson(sessions, unitId, now),
  }
}
```

- [ ] **Step 4: Run tests and lint**

Run: `npx vitest run src && npx oxlint src/`
Expected: PASS, 0 lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports.js src/lib/__tests__/reports.test.js
git commit -m "Timesheet and per-unit labour reporting"
```

---

### Task 7: Admin timesheet screen

**Files:**
- Create: `src/views/Timesheets.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `timesheet` from `src/lib/reports.js`; dispatch actions `adminAddTimeEntry`, `adminCorrectTimeEntry`; `businessDayKey` from `src/lib/timeclock.js`.
- Produces: a `timesheets` view registered in `NAV.admin` and in the `page()` switch.

- [ ] **Step 1: Write the screen**

```jsx
// src/views/Timesheets.jsx
import React, { useState } from 'react'
import { useStore, fmtTime } from '../store.jsx'
import { Modal } from '../ui.jsx'
import { submitAction as submitWrite, QUEUED_MESSAGE } from '../lib/submit.js'
import { timesheet, fmtDuration } from '../lib/reports.js'
import { businessDayKey, usesClock } from '../lib/timeclock.js'

// 'YYYY-MM-DDTHH:mm' from a datetime-local input, read as Pacific wall time.
// The input has no timezone, so it is parsed against the browser's, which is
// the crew's own machine in practice. An admin working from another timezone
// should set the day explicitly and check the result.
const parseLocal = (s) => (s ? new Date(s).getTime() : null)

export default function Timesheets({ toast }) {
  const { state, dispatch, currentUser } = useStore()
  const [day, setDay] = useState(businessDayKey(Date.now()))
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)

  if (currentUser.role !== 'admin') return null

  const rows = timesheet(state.timeEntries, state.unitSessions, day, Date.now())
  const crew = state.users.filter((u) => usesClock(u.role) && u.status === 'active')

  const run = async (fn, done) => {
    if (busy) return
    setBusy(true)
    try {
      const status = await submitWrite(fn())
      toast(status === 'queued' ? QUEUED_MESSAGE : done)
      setAdding(false); setEditing(null); setForm({})
    } catch (err) {
      toast(err.message || "Couldn't save that.")
    } finally {
      setBusy(false)
    }
  }

  const saveNew = () => {
    const clockIn = parseLocal(form.start)
    const clockOut = parseLocal(form.end)
    if (!form.uid) return toast('Pick a packer or mover.')
    if (!clockIn || !clockOut) return toast('Enter a start and a finish time.')
    if (clockOut <= clockIn) return toast('Finish time must be after start time.')
    return run(() => dispatch({ type: 'adminAddTimeEntry', p: {
      uid: form.uid, clockIn, clockOut, notes: form.notes,
      lunchMinutes: form.lunch === '' || form.lunch == null ? null : Number(form.lunch),
    } }), 'Time entry added ✓')
  }

  const saveEdit = () => {
    const changes = {}
    const start = parseLocal(form.start)
    const end = parseLocal(form.end)
    if (start && start !== editing.clockIn) changes.clockIn = start
    if (end && end !== editing.clockOut) changes.clockOut = end
    if (form.lunch !== '' && Number(form.lunch) !== editing.lunchMinutes) changes.lunchMinutes = Number(form.lunch)
    if (Object.keys(changes).length === 0) return toast('Nothing changed.')
    return run(() => dispatch({ type: 'adminCorrectTimeEntry', p: { entryId: editing.entryId, changes } }), 'Corrected ✓')
  }

  const localValue = (ms) => {
    if (!ms) return ''
    const d = new Date(ms)
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Timesheets</h1><p>Packers and movers, one row per person per day.</p></div>
        <button className="btn btn-primary" onClick={() => { setForm({}); setAdding(true) }}>＋ Add a day</button>
      </div>

      <div className="card" style={{ padding: '14px 20px', marginBottom: 14 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Day</label>
          <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
      </div>

      {rows.length === 0 && (
        <div className="card empty"><div className="big">🕘</div>Nobody clocked in on this day.</div>
      )}

      {rows.map((r) => (
        <div key={r.entryId} className="card" style={{ padding: '14px 20px', marginBottom: 10 }}>
          <div className="row">
            <span className="grow"><b>{r.userName}</b> <span className="muted">· {r.role}</span></span>
            <b>{r.open ? 'still open' : fmtDuration(r.workedMs)}</b>
          </div>
          <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
            {fmtTime(r.clockIn)} {r.clockOut ? `to ${fmtTime(r.clockOut)}` : '· not clocked out'}
            {r.lunchMinutes > 0 ? ` · less ${r.lunchMinutes} min lunch` : ''}
          </div>
          <div className="muted" style={{ marginTop: 4, fontSize: 12.5 }}>
            {fmtDuration(r.unitMs)} on units
            {r.unattributedMs > 0 ? ` · ${fmtDuration(r.unattributedMs)} not attributed to a unit` : ''}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {r.open && <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>Open</span>}
            {r.adminEntered && <span className="badge" style={{ background: '#e0e7ff', color: '#3730a3' }}>Added by you</span>}
            {r.workedThroughLunch && <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>Worked through lunch</span>}
          </div>
          {r.notes && <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>{r.notes}</div>}
          <button
            className="btn btn-ghost btn-sm" style={{ marginTop: 10 }}
            onClick={() => { setEditing(r); setForm({ start: localValue(r.clockIn), end: localValue(r.clockOut), lunch: String(r.lunchMinutes) }) }}
          >✎ Correct</button>
        </div>
      ))}

      {adding && (
        <Modal title="Add a day" sub="For a day the app was not used" onClose={() => !busy && setAdding(false)}>
          <div className="field">
            <label>Who</label>
            <select className="input" value={form.uid || ''} onChange={(e) => setForm({ ...form, uid: e.target.value })}>
              <option value="">Pick a packer or mover…</option>
              {crew.map((u) => <option key={u.id} value={u.uid || u.id}>{u.name} · {u.role}</option>)}
            </select>
          </div>
          <div className="field"><label>Started</label>
            <input className="input" type="datetime-local" value={form.start || ''} onChange={(e) => setForm({ ...form, start: e.target.value })} /></div>
          <div className="field"><label>Finished</label>
            <input className="input" type="datetime-local" value={form.end || ''} onChange={(e) => setForm({ ...form, end: e.target.value })} /></div>
          <div className="field"><label>Lunch minutes <span className="muted">(blank uses the five hour rule)</span></label>
            <input className="input" type="number" min="0" inputMode="numeric" placeholder="30" value={form.lunch || ''} onChange={(e) => setForm({ ...form, lunch: e.target.value })} /></div>
          <div className="field"><label>Notes</label>
            <textarea className="input" rows={2} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy} onClick={saveNew}>
            {busy ? 'Saving…' : 'Add this day'}
          </button>
        </Modal>
      )}

      {editing && (
        <Modal title={`Correct ${editing.userName}`} sub={editing.day} onClose={() => !busy && setEditing(null)}>
          <div className="field"><label>Started</label>
            <input className="input" type="datetime-local" value={form.start || ''} onChange={(e) => setForm({ ...form, start: e.target.value })} /></div>
          <div className="field"><label>Finished</label>
            <input className="input" type="datetime-local" value={form.end || ''} onChange={(e) => setForm({ ...form, end: e.target.value })} /></div>
          <div className="field"><label>Lunch minutes</label>
            <input className="input" type="number" min="0" inputMode="numeric" value={form.lunch || ''} onChange={(e) => setForm({ ...form, lunch: e.target.value })} /></div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            The old values are kept in the record. The crew do not see corrections.
          </div>
          <button className="btn btn-primary btn-lg" style={{ width: '100%' }} disabled={busy} onClick={saveEdit}>
            {busy ? 'Saving…' : 'Save correction'}
          </button>
        </Modal>
      )}
    </>
  )
}
```

- [ ] **Step 2: Register the view**

In `src/App.jsx`: import `Timesheets`, add `['timesheets', '🕘', 'Timesheets']` to `NAV.admin` after the `reports` entry, and add to the `page()` switch:

```jsx
      case 'timesheets': return <Timesheets toast={toast} />
```

Do not add it to any other role's nav. `Timesheets` also returns `null` for non-admins, so the guard holds even if the nav is edited later.

- [ ] **Step 3: Verify**

Run: `npx oxlint src/ && npx vitest run src && npm run build`
Expected: 0 lint errors, all tests pass, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/views/Timesheets.jsx src/App.jsx
git commit -m "Admin timesheets: review, correct and back-enter days"
```

---

### Task 8: Unit labour on the unit page

**Files:**
- Modify: `src/views/UnitDetail.jsx`

**Interfaces:**
- Consumes: `unitLabour` from `src/lib/reports.js`.
- Produces: a labour panel in the unit detail sidebar, admin only.

- [ ] **Step 1: Add the panel**

Import `unitLabour` and `fmtDuration` from `../lib/reports.js`, then render after the Details card:

```jsx
      {currentUser.role === 'admin' && (() => {
        const labour = unitLabour(state.unitSessions, unitId, Date.now())
        if (labour.totalMs === 0) return null
        return (
          <div className="card" style={{ padding: '16px 20px', marginBottom: 14 }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <div className="section-title grow" style={{ margin: 0 }}>Time on this unit</div>
              <span className="muted" style={{ fontWeight: 700 }}>{fmtDuration(labour.totalMs)}</span>
            </div>
            {labour.people.map((p) => (
              <div key={p.uid} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 0', fontSize: 13.5 }}>
                <span className="grow">{p.userName}</span>
                <span className="muted">{p.sessions} visit{p.sessions === 1 ? '' : 's'}</span>
                <b style={{ marginLeft: 10 }}>{fmtDuration(p.ms)}</b>
              </div>
            ))}
          </div>
        )
      })()}
```

- [ ] **Step 2: Verify**

Run: `npx oxlint src/ && npm run build`
Expected: 0 lint errors, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/views/UnitDetail.jsx
git commit -m "Show time spent on a unit, broken down by person"
```

---

### Task 9: Deploy and verify against production

**Files:** none changed.

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run src && npm run test:rules && npm run build`
Expected: all unit tests pass, all rules tests pass, build succeeds.

- [ ] **Step 2: Deploy rules first, then the app**

Rules must land before the client that depends on them, or the first crew write is denied.

```bash
npx firebase deploy --only firestore:rules
npx firebase deploy --only hosting
```

- [ ] **Step 3: Verify on the live site**

Sign in as an admin and confirm:
- Timesheets appears in the nav and loads.
- Adding a day for a packer works, and the row shows the "Added by you" badge.
- Correcting that row succeeds, and a `timeCorrections` document exists for it.
- No clock card appears for the admin.

Then confirm in the browser console, signed in as a packer, that reading `timeCorrections` is denied. That single check is what proves the hiding is real rather than cosmetic, and it is the one thing a passing test suite cannot demonstrate about production.

- [ ] **Step 4: Push**

```bash
git push origin main
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: scope and the clock roles to Tasks 1 and 5; the 8am floor to Tasks 1, 3 and 5; lunch and the worked-through toggle to Tasks 1, 4 and 5; unit sessions and auto-close to Tasks 2 and 4; working without being clocked in is handled by `openUnitSession` returning early for non-clock roles and by the crew card being the first thing on their queue; a day left open from yesterday is handled because `clockIn` keys on today's day and only blocks on an entry for the same day; forgetting to clock out surfaces as the `open` flag in Task 6 and the Open badge in Task 7; admin back-entry to Tasks 4 and 7; corrections and their invisibility to Tasks 3, 4 and 7; the data model to Tasks 3 and 4; reports to Tasks 6, 7 and 8; testing throughout.

**One gap found and closed.** The spec says a packer opening a unit without being clocked in is prompted to clock in first. `openUnitSession` returns early rather than prompting, which records nothing but does not nag. The prompt belongs with the checklist, not the session, so it is deliberately left to a follow-up rather than half-built here: the clock card sits at the top of the same screen the packer starts from, which covers the common case. Flagging this rather than silently dropping it.

**Placeholders.** None. Every code step carries the code.

**Type consistency.** `businessDayKey`, `canClockInAt`, `lunchMinutesFor`, `workedMs`, `usesClock`, `openSessionFor`, `sessionMs`, `unitLabourMs`, `unitLabourByPerson`, `dayLabourMs` are defined in Tasks 1 and 2 and used with those exact names in Tasks 4, 5, 6, 7 and 8. `timesheet` and `unitLabour` are defined in Task 6 and consumed in Tasks 7 and 8. Field names (`clockIn`, `clockOut`, `lunchMinutes`, `workedThroughLunch`, `source`, `notes`, `enteredBy`, `startedAt`, `endedAt`, `endedReason`) match the spec's data model and the rules in Task 3.

**A leak found and closed during review.** The first draft of Task 4 wrote an
`ev('system', ...)` line on every clock action, following the pattern every
other action in this app uses. `/events` is readable by any active user, so that
would have announced each correction, and each person's clock-in and clock-out,
to the whole crew's Activity feed. The clock actions now write no events at all,
and Task 4 says why so nobody helpfully adds them back.

**One thing that is visible and cannot easily not be.** A crew member can read
their own `timeEntries` document, so the `source` field is visible to them if
they inspect it: a back-entered day can be identified as one the office created.
The correction history, the old values, and who changed what are all in
`timeCorrections` and are not readable by them at all. Hiding `source` too would
mean a second admin-only document per entry for a single string, which is not
worth it, but the distinction is stated rather than glossed: what is hidden is
the fact and content of changes, not the fact that the office can enter a day.

**One risk worth naming.** The rules cannot evaluate a timezone, so `afterEarliestClockIn` uses 15:00Z, which is 08:00 Pacific during daylight time and 07:00 during standard time. For the winter months the rule is an hour looser than the client. The client enforces the exact minute and the rule stops the gross case, which is the right split of responsibility, but it is a real gap rather than a tidy one and Task 3's comment says so.
