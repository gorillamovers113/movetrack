# MoveTrack — Per-User Reports Design Spec

**Date:** 2026-08-26
**Status:** approved (Casey greenlit item #9) → build
**Part of:** Sept 8 Trinity Manor readiness

## 1. Purpose

Casey wants to see, per crew member, how much each person did: units packed / loaded, pieces handled,
photos submitted, time contributed. Everything is already captured in the append-only `events` log
(every action carries `uid`, `userName`, `role`, `type`, `ts`, `unitId`/`containerId`/`overflowId`,
and `media`), plus unit `crew` arrays, unit `pieces`, and pack timestamps (`times.packStart/packEnd`).
This task computes those into clean per-user reports. It is read-only analytics over existing data,
no new writes, no lifecycle or rules changes.

## 2. What the data supports (be honest about limits)

Computable accurately from current state:
- **Actions logged** (total events by the user) and a breakdown by type (stage moves, photos, notes,
  flags).
- **Units packed** = distinct units with this uid in `crew.packers` (or `finishPacking` events).
- **Units loaded** = distinct units with this uid in `crew.movers`.
- **Overflow handled** = overflow items where `prepBy`/`transportBy` == uid; **containers handed off /
  received** = containers where `handoffBy`/`receivedBy` == uid.
- **Pieces handled** = sum of `pieces` over the units they packed (and, separately, loaded).
- **Photos / videos submitted** = count of media objects across their events (by `kind`), using the
  attribution now stamped on media (`m.uid`), falling back to the event's `uid`.
- **Pack time contributed** = sum of `times.packEnd - times.packStart` over units they packed, and
  **avg pack time per unit**. (Loading is a single tap with no start/stop, so there is no load
  duration; report loads as counts/throughput, and do NOT invent a load duration.)
- **Active window**: first and last action timestamp, number of distinct active days.

Label the time metric clearly as "packing time" so no one reads it as total on-clock time.

## 3. Architecture

- **`src/lib/reports.js`** (pure, unit-tested): functions that take `state` (units, containers,
  overflow, events, users) and return per-user metric objects and a roster-level summary. Pure and
  deterministic (no `Date.now()` inside beyond an optional passed-in "now"); vitest tests in
  `src/lib/__tests__/reports.test.js` covering: a packer with N units + pieces + pack time, a mover
  with loads, a warehouse user with receives, a user with zero activity (all-zero, no crash),
  media counting by kind, and distinct-unit counting (no double count when a user has multiple events
  on one unit).
- **`src/views/Reports.jsx`**: the display. A roster of per-user cards/rows showing the headline
  metrics, sortable by a chosen metric (or just ordered by total actions). Tap a user to expand a
  detail panel: full breakdown + their recent actions (reuse `EventRow`, filtered to that uid). A
  **"Export CSV"** button (reuse the pattern in `exportActivityCSV` in `store.jsx`) that downloads a
  per-user summary (one row per user, the metric columns). Empty state (no events yet) renders a
  friendly "No activity logged yet" card, never crashes.

## 4. Access + nav

- New nav entry (icon 📊, label "Reports") wired in `App.jsx` `NAV` + `page()`.
- Show it to **admin** (Casey, the primary consumer) and **viewer** (PM / BigBox office observers) —
  the data is non-sensitive aggregate counts. Crew roles don't get the nav entry (keeps their nav
  lean); this is a management/oversight view.
- Read-only. No dispatch actions added.

## 5. Constraints

- **No em-dashes** in new code/copy/comments (commas/periods/parens); the `'—'` placeholder-glyph as
  data is fine.
- Dead simple, touch-first, iPhone + Android; reuse existing `.card`/`.tbl`/`.btn`/`Avatar`/`badge`
  styles. Numbers should be scannable (big, bold) on a phone.
- Pure aggregation only. Do NOT change lifecycles, dispatch, or `firestore.rules`. Do NOT touch
  `firestore.rules`/`firebase.json`.
- Handle old/partial data gracefully (a unit missing `pieces`, an event missing `media`, a user with
  no events) with zero-fallbacks, never a crash or `NaN`/`undefined` on screen.

## 6. Success criteria

- Casey opens Reports and sees, per crew member: units packed, units loaded, pieces handled, photos +
  videos submitted, packing time + avg per unit, and total actions, all live.
- Tapping a member shows their detailed breakdown and recent actions.
- CSV export downloads a correct per-user summary.
- A brand-new project (no events) shows a friendly empty state.
- `npx vitest run` green (new reports tests included); `npm run build` passes; works on iOS Safari +
  Android Chrome.
