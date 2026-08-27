# MoveTrack — Schedule (floor-by-floor plan) Design Spec

**Date:** 2026-08-26
**Status:** approved (Casey greenlit item #5) → build
**Part of:** Sept 8 Trinity Manor readiness

## 1. Purpose

Load the floor-by-floor relocation calendar (Floor 9 on Sep 8 down to Floor 1 on Oct 8, 27 working
days, from the system spec §10) into the app, show the crew **today's floor + work type** at a
glance, show **progress vs the plan**, and let the **admin edit the dates** (the real move will slip;
Casey needs to adjust days without a developer).

Today `state.schedule` is subscribed in the store but **no view consumes it**, and the 27 days are
only in a node seed script that needs a service-account key nobody has run. This task makes the
schedule real and useful, seeded through the app itself.

## 2. Seeding without a key: an in-app admin action

The Firestore rules already allow **admin** to write `schedule`, and Casey is an active admin. So
seeding is a one-tap in-app action, no service-account key or console needed:

- Extract the canonical 27-day plan into a shared ESM module **`src/lib/schedule.js`** exporting
  `DEFAULT_SCHEDULE` (array of `{ date:'YYYY-MM-DD', work:'PACK'|'MOVEOUT', floor:1..9, unitCount }`,
  exactly the rows in `scripts/seed-schedule.mjs` lines 61-89 / system spec §10). Update
  `scripts/seed-schedule.mjs` to import this module instead of its own inline copy (single source of
  truth; the script stays as a key-based fallback).
- Add a dispatch action **`seedSchedule`** (admin-only path): writes each `DEFAULT_SCHEDULE` day to
  `schedule/{date}` (deterministic doc id = the date, so it's an idempotent upsert, never a
  duplicate). Writes one summary `event` ("Loaded the floor plan: 27 days, Sep 8 to Oct 8").
- Add **`editScheduleDay`** (admin-only): update one day's `date`/`work`/`floor`/`unitCount`. Since
  the doc id is the date, a date change = delete old doc id + set new doc id (do both in the action);
  writes an `event`.

Guard both actions in the UI to admins. The rules already enforce admin-only server-side.

## 3. UI

### 3a. Today banner (everyone)
A compact banner near the top of the **Dashboard** (all roles see the Dashboard). It reads the
client's local date as `YYYY-MM-DD`, finds the matching `schedule` day, and shows:

- **Today: Floor N. PACK** (or MOVE-OUT), the planned unit count, and today's date.
- Progress vs plan for that floor: e.g. on a PACK day, "3 of 4 units packed"; on a MOVE-OUT day,
  "2 of 4 units loaded" (count units on that floor at/past the stage the day targets, over
  `unitCount`). A small progress bar reusing the existing `.progress-band`/`.bar` styles.
- If there is **no schedule day for today** (weekend, or before/after the run): a neutral "No
  scheduled work today. Next: Floor N, PACK, Mon Sep 8" line (compute the next upcoming day).
- If the **schedule is empty entirely**: show, to admins only, a "Load the Sept 8 to Oct 8 plan"
  button that dispatches `seedSchedule`; to non-admins, a quiet "Schedule not loaded yet" note.
  Never crash on an empty schedule.

Progress vs plan, stage mapping (units on the floor):
- PACK day target stage = `packed` (count units whose stage is `packed` or later in the lifecycle).
- MOVE-OUT day target stage = `loaded` (count `loaded` or later).
Use the lifecycle `step` ordering from `src/seed.js` STAGES to mean "at or past".

### 3b. Schedule list + admin editor (a new view)
A new nav view **`schedule`** (icon 📅, label "Schedule"), shown for **all roles** (read-only for
non-admins, editable for admin):

- The 27 days as a clean list grouped by floor (Floor 9 first, matching the top-down move), each row:
  date (formatted, with weekday), PACK/MOVE-OUT pill, floor, planned unit count, and a live "done"
  count vs plan. Today's row highlighted. Past days that hit their plan get a subtle check.
- **Admin only:** each row has an edit affordance (a small modal reusing the `Modal` pattern) to
  change date / work / floor / unit count, dispatching `editScheduleDay`. And when the schedule is
  empty, the same "Load default plan" button as the banner. A "Reset to default plan" admin action
  (re-runs `seedSchedule`) is fine to include (idempotent upsert), clearly labeled.
- Empty/partial states never crash; mobile-first; reuse existing card/pill/`.btn` styles.

## 4. Data + wiring

- `schedule` docs: `{ date, work, floor, unitCount }` (doc id = date). No schema change to units.
- `store.jsx`: import `DEFAULT_SCHEDULE`; add `seedSchedule` + `editScheduleDay` dispatch actions;
  optionally a tiny selector helper `todayKey()` (local `YYYY-MM-DD`) — but keep date logic in the
  view is fine too. Every action writes an `event` for the activity log/accountability.
- `App.jsx`: add the `schedule` nav entry for all roles and wire `case 'schedule'` in `page()`.
- Reuse `stageOf`/STAGES `step` for the at-or-past comparison.

## 5. Constraints

- **No em-dashes** in new code/copy/comments (commas/periods/parens); the existing `'—'`
  placeholder-glyph-as-data idiom is fine to match.
- Dead simple, touch-first, iPhone + Android; ≥44px tap targets; reuse existing styles.
- Do not change the container/overflow/unit lifecycles or the Firestore rules. Admin-gate the
  seed/edit UI (rules already enforce it server-side).
- The node seed script keeps working as a fallback (now importing the shared module).

## 6. Success criteria

- With an empty schedule, an admin taps "Load the plan" once and all 27 days appear (idempotent, no
  dupes); non-admins see them read-only.
- The Dashboard shows today's floor + work + progress vs plan, and a sensible "next day" line on
  off-days, and never crashes when the schedule is empty.
- An admin can change a day's date and it moves correctly (old date id removed, new one written).
- Progress vs plan reflects live unit stages (packed count on PACK days, loaded count on MOVE-OUT).
- `npx vitest run` green; `npm run build` passes; works on iOS Safari + Android Chrome.
