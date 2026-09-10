# Time clock and per-unit labour time

Design, 2026-09-10. Requested by the crew after the first pack day at Trinity Manor.

## What this is for

Two things Casey asked for, which turn out to be one system:

1. A daily record of every packer and mover: when they started, when they
   finished, less lunch.
2. How long each unit took, and which people contributed to it.

The second falls out of the first once time is attributed to units rather than
just to the day.

## Why it has to be built carefully

The crew are 1099 contractors supplied by a labour contractor, but Casey is
keeping records on that company's behalf and wants them held to a W-2 standard.
Under California's client-employer rules a business shares liability with its
labour contractor for wage compliance, so accurate records protect Casey rather
than merely inform him.

Three findings from the research shape the design, and none of them are
negotiable:

**No rounding, anywhere.** In *Camp v. Home Depot* the court held that where an
employer *can* capture the exact time worked, it *must* pay the exact time
worked. An app captures exact time by definition, so rounding punches would be
indefensible. Every timestamp is stored to the millisecond and displayed to the
minute without rounding.

**Meal periods are precise and unforgiving.** A meal break is owed once a shift
passes five hours, must begin before the end of the fifth hour, and must run a
full thirty minutes. Compliance is judged on actual time with no rounding
permitted.

**A bad record is evidence against you.** Records showing a short, late or
missing meal period raise a rebuttable presumption that the break was not
provided. The burden then falls on the employer to show the employee chose it.
This is the reason the design does not silently assert that lunch happened.

Sources: [DIR meal periods FAQ](https://www.dir.ca.gov/dlse/faq_mealperiods.htm),
[CalChamber on meal and rest breaks](https://www.calchamber.com/california-labor-law/meal-and-rest-breaks),
[SHRM on California time rounding](https://www.shrm.org/topics-tools/employment-law-compliance/california-court-limits-permissibility-time-rounding).

This is a design document, not legal advice. Casey should have the contractor
company's own advisor confirm the meal-break handling before it is relied on in
a dispute.

## Scope

Applies to **packers and movers only**. They are the people who clock in and
the only people who appear in the records. Viewers, warehouse staff and admins
never clock in and never appear as subjects, though an admin reads the reports
(see Reports below). Drivers are excluded too:
they do not use the app at all, so a clock they never touch would produce
misleading gaps rather than useful records.

## The working day

One clock-in and one clock-out per person per day. The day is keyed in
`America/Los_Angeles`, the same business timezone the rest of the app uses, so a
shift never lands on the wrong date because a server is on UTC.

**Clock-in is refused before 08:00 local**, a single constant
(`EARLIEST_CLOCK_IN_HOUR`) shared by the UI, the write path and the security
rules, so the three can never disagree. The button is visible but disabled,
showing the reason and the time it unlocks, rather than being absent or silently
inert. If someone is genuinely working before eight, that is a scheduling
conversation, not something the app should paper over by back-dating a punch.

**Lunch is auto-deducted, thirty minutes, on any day whose worked span exceeds
five hours.** The threshold is measured on the gross span, `clockOut` minus
`clockIn`, before any deduction, because that is the period the meal-break rule
is written against. A 5h10m gross day therefore deducts thirty minutes and pays
4h40m. Under five hours gross, nothing is deducted, because no meal break is
owed. Casey chose auto-deduction over clocking out and back in, with the
trade-off understood.

The safety valve on that choice: clock-out carries an **"I worked through
lunch"** toggle. Setting it removes the deduction and flags the day for Casey's
review. The record then reflects what happened instead of asserting a break
nobody took, which is precisely the assertion that creates a presumption of
violation.

## Unit sessions

Opening a unit checks the person into it. **Opening another unit auto-closes the
first**, because they have physically walked to a different apartment and the
previous one ended whether or not anybody tapped anything. Clocking out closes
whatever session is open.

A person therefore has at most one open unit session at any moment. This was
Casey's call and it is what makes the numbers reconcile: on day one Liv had two
units open at once and produced 7h44m of unit time from about five and a half
hours of work. Sessions that cannot overlap cannot double-count.

A unit's labour time is the sum of its sessions across everyone who worked it.
A unit may have many sessions from the same person on the same day, which is the
correct representation of leaving and coming back.

## Working without being clocked in

A packer who opens a unit without having clocked in is prompted to clock in
first, in one tap, and then continues. The app does not silently clock them in,
because a punch nobody made is exactly the kind of invented record this design
avoids elsewhere; and it does not block them from working, because refusing to
let someone start a unit they are standing in front of would get the app put
down.

Before 08:00 that prompt cannot be satisfied, so the unit work is refused with
the same reason the clock button gives. This is the one place the 08:00 floor
has teeth, and it is the intended consequence of the rule Casey asked for.

## A day left open from yesterday

Clocking in today is never blocked by an unclosed day from an earlier date. The
new day starts normally and the stale one goes to Casey's review queue. Blocking
someone's morning because of a record only an admin can fix would punish the
wrong person.

## Admin back-entry

Casey must be able to add a day for a packer or mover after the fact, for any
past date, with a start time, a finish time and a note. The immediate need is
real: the crew worked before the app existed, and days like that have to end up
in the record rather than being lost because nobody tapped anything.

**A back-entered day is marked as such and never disguised as a punch.** Every
entry carries `source`, either `self` or `admin`. This is not decoration. A
record the worker created and a record the boss created on their behalf are
different kinds of evidence, and a system that renders them identically is worth
less than one that admits the difference. Reports label them, and the person
they belong to can see them.

The 08:00 floor does **not** apply to back-entry. The floor is a control on when
crew may start their own day; back-entry is recording what already happened, and
history does not become false because it began at half past seven.

Lunch on a back-entered day follows the same five-hour rule by default, and
Casey can override the deducted minutes when he knows what actually happened. He
is entering a fact he has other knowledge of, which is precisely the situation
the auto-deduction is a poor substitute for.

**A back-entered day carries no unit sessions.** Nobody can reconstruct which
apartment someone was standing in at 11:40 last Tuesday, and inventing that
attribution would poison the per-unit numbers to make a report look complete.
The day contributes to that person's hours and to nothing else. See the
reconciliation note under Reports.

Back-entered days are corrected through the same admin path as any other, with
the same audit trail.

## Forgetting to clock out

The app invents nothing. The day stays open and appears in Casey's review queue,
pre-filled with that person's **last recorded activity** as a suggested end
time. He confirms or edits it, and the correction is logged like any other.

Guessing an end time and writing it as though the person had punched it would be
the single easiest way to turn this system into a liability.

## Who may change what

Crew may start and end their own entries. That is all. They cannot edit a closed
day, cannot alter a timestamp, and cannot touch anyone else's record. A time
record that its subject can quietly revise is worth nothing in a dispute.

Only an admin may correct a record. Every correction writes an audit event
carrying the admin's name, the field, the old value and the new one.

## Data model

Two new collections, both flat and append-mostly.

```
timeEntries/{id}
  uid, userName, role          who, denormalised for reporting
  day            'YYYY-MM-DD'  business-timezone day key
  clockIn        number        ms epoch, exact
  clockOut       number|null   null while the day is open
  lunchMinutes   number        0 or 30 by rule, or set by an admin
  workedThroughLunch  boolean
  source         'self' | 'admin'   who created it, never inferred
  notes          string        admin back-entry only, free text
  enteredBy, enteredAt          the admin, when source is 'admin'
  correctedBy, correctedAt, corrections[]   admin edits, if any

unitSessions/{id}
  unitId, uid, userName
  day            'YYYY-MM-DD'
  startedAt      number
  endedAt        number|null
  endedReason    'manual' | 'switched' | 'clockOut' | 'adminCorrection'
```

`endedReason` exists so a reviewer can tell a deliberate check-out from one the
app closed on the person's behalf. Those are different facts and collapsing them
would hide how the number was produced.

Denormalising `userName` follows the existing pattern in `units.steps` and
`events`: reports must stay readable if a person is later removed from the
roster.

## Security rules

Mirrors the shape already used for `unitStepWriteOK` and `unitLoadWriteOK`.

- **create** a `timeEntry`: only `hasRole('packer')` or `hasRole('mover')`, only
  with `uid == request.auth.uid`, only with `clockOut == null`, and only when
  `clockIn` is at or after 08:00 local for that day.
- **update** a `timeEntry`: the owner may set `clockOut`, `lunchMinutes` and
  `workedThroughLunch`, once, on an entry where `clockOut` is currently null.
  They may never change `clockIn`, `uid` or `day`.
- **admin** may update anything, and is the only role that may modify a closed
  entry.
- **admin** may create an entry for any packer or mover, on any date, with
  `source == 'admin'`, `enteredBy == request.auth.uid`, and no 08:00 floor. Crew
  may never create an entry with `source == 'admin'`, which is what stops the
  marker being forged from a phone.
- `unitSessions` follow the same ownership rule: create and close your own,
  never anyone else's.

The 08:00 floor is enforced in the rules and not only in the UI, because a rule
that exists only in the client is a suggestion.

## Reports

**Per person, per day:** clock-in, clock-out, lunch deducted, total worked,
and any flags (open day, worked through lunch, admin-entered, admin-corrected).
An admin-entered day shows its note.

**Per unit:** total labour time, broken down by person, with each session
listed. This is the answer to "how long did 906 take and who did it".

**Reconciliation, honestly stated.** Unit time sums to the day's worked time
only for days recorded through the app. A back-entered day has hours but no unit
sessions, so any view that compares the two must say so rather than showing a
silent shortfall that looks like missing work. The per-day report carries the
unattributed remainder as its own line.

**Per day, all crew:** the roll-up Casey asked for, one row per person.

**Admin only.** A packer or mover sees their own day and nothing else. Viewers
do not see time records at all: they can already see the board and the
productivity reports, and individual hours are a more sensitive record than
either. This is narrower than the existing Reports page, which viewers can
read, and the difference is deliberate.

Both reports extend `src/lib/reports.js`, which is already pure and unit-tested
with `now` passed in rather than read from the clock.

## Error handling

- Clock-in attempted twice in a day: the second is refused, and the UI shows the
  existing entry rather than an error.
- Clock-out with no open entry: refused, nothing written.
- Offline: writes queue through `src/lib/submit.js` like every other action, so
  a punch made in a stairwell lands when signal returns. The timestamp recorded
  is the moment of the tap, not the moment of the sync.
- A unit session whose `startedAt` is after its `endedAt` is treated as
  zero-length and flagged, never negative.

## Testing

Pure logic in `src/lib/` with vitest, following the existing suite:

- day-key derivation across the 8am boundary and across midnight, with `TZ=UTC`
  forced, because the last timezone bug in this codebase only appeared that way
- the five-hour threshold: 4h59m deducts nothing, 5h01m deducts thirty minutes
- worked-through-lunch removes the deduction
- session summing, including several sessions per unit per person
- that switching units closes the previous session exactly once
- that totals across units reconcile with the day's worked time for app-recorded
  days, and that a back-entered day reports its hours as unattributed rather
  than as a reconciliation failure

Rules tests in `test/rules/` against the emulator, following the existing
pattern of proving both the allowed write and the abuse:

- a packer may open and close their own entry
- a packer may not create one for another uid
- a packer may not clock in before 08:00
- a packer may not alter `clockIn` when closing
- a packer may not reopen or edit a closed entry
- a viewer, warehouse user or admin-less caller may not create entries at all
- an admin may create a back-dated entry for another user, before 08:00, with
  `source: 'admin'`
- a packer may not create an entry carrying `source: 'admin'`, for themselves or
  anyone else

## Out of scope

Deliberately not in this iteration:

- Pay rates, money, or any calculation of what is owed. This records time.
- Rest breaks. They are paid, ten minutes per four hours, and are not clocked;
  recording them would add noise without adding a record anyone needs.
- Geofencing or photo verification of punches. Worth revisiting if punches are
  ever disputed, not worth the friction before then.
- Editing history by the crew. Corrections and back-entry are admin functions by
  design.
- Back-filling unit sessions for days worked before the app. The hours are
  recoverable, the apartment-by-apartment attribution is not, and guessing it
  would corrupt the only numbers this system exists to produce.
- Exporting to the contractor company's payroll system. The reports and the
  existing Google Sheet mirror cover the immediate need.
