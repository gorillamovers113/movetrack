# MoveTrack — Trinity Manor Relocation System (Design Spec)

**Date:** 2026-08-26
**Author:** Casey (Gorilla Movers) + Claude
**Hard deadline:** **live and usable on phones by Sept 8, 2026** (first pack day)
**Status:** approved design → ready for implementation plan

---

## 1. Purpose

MoveTrack is the organized, multi-user, double/triple-verified system of record for the
**Trinity Manor** building relocation. Gorilla Movers does the labor; the destination is
**BigBox** portable containers loaded on site and driven to the **BigBox warehouse**.

The app's job: keep every unit's move clean and accountable — inventory, photos, video,
packing, verified hand-offs, and who did what, when — from the crew's own phones, with a
live shared board and a real-time backup to a Google Sheet Casey owns.

The existing app already implements the core workflow engine (unit lifecycle, box-count
chain-of-custody with auto-flags, photo/video capture, roles, activity log, CSV export) but
stores everything in a single browser's `localStorage`. This project **replaces the data
layer with a real backend** so multiple people share one live board, and adds the missing
pieces (real auth, schedule, written inventory, materials, time, per-user metrics, BigBox
branding, Google Sheet backup).

## 2. Non-goals (explicitly out of scope for Sept 8)

- **No return / unpack phase.** Trinity Manor is one-way *out* to the BigBox warehouse. The
  lifecycle ends at "at warehouse." (The old app modeled a round trip; that is removed.)
- **No native iOS/Android app.** It's a mobile web app (installable PWA), not App Store builds.
- **No pre-loaded unit list.** Unit numbers and tenant names do not exist until the crew
  starts on the 8th — packers create units on the day.
- **No customer-facing / billing features.** Internal crew + viewer tool only.

## 3. Architecture & stack

- **Frontend:** the existing **React 19 + Vite** app is kept and extended (its reducer /
  workflow logic is largely reused). Installable as a **PWA** ("Add to Home Screen") so it
  behaves like an app on crew phones.
- **Auth:** **Firebase Authentication** — email/password sign-in + built-in password reset
  ("forgot password" emails a secure reset link). No passwords stored by us.
- **Database:** **Cloud Firestore** — the shared live board. **Offline persistence enabled**
  so the app keeps working in elevators / weak signal and syncs when back online (important
  inside a high-rise).
- **Media:** **Firebase Storage** — photos (client-resized) and short videos, one folder per
  unit. Firestore holds the media metadata + Storage URLs.
- **Google Sheet backup:** a **Firebase Cloud Function** fires on Firestore writes and POSTs
  each change to a **Google Apps Script Web App** bound to Casey's Sheet, which appends/updates
  rows. This keeps the Sheet **owned by Casey** with no service-account keys to manage.
  (Fallback if the webhook proves flaky: Cloud Function → Sheets API via a service account
  Casey shares the sheet with.)
- **Hosting:** **Firebase Hosting** (one platform for app + backend).
- **Security:** **Firestore Security Rules** enforce every role boundary server-side (see §9).

## 4. Roles & accounts

| Role | Who | Can do |
|---|---|---|
| **admin** | Casey | Everything: approve/remove users, change any user's role, edit schedule dates, edit/add units, resolve flags, see all reports + the Sheet |
| **packer** | pack crew | Create + pack units on scheduled PACK days (inventory, photos/video, materials, box count) |
| **mover** | move crew | Verify + load packed units into BigBox containers on MOVE-OUT days (label + photo) |
| **driver** | BigBox driver | Pick up containers, verify boxes on board, check in at the BigBox warehouse |
| **viewer** | onsite property manager, BigBox office | **Read-only** live board — done / in-progress / not-started. No action buttons, no edits |

**Account flow:** anyone signs up (name + email + password) → lands as **pending** (can log in
but sees only a "waiting for approval" screen) → **Casey approves** and assigns a role → active.
Casey can **remove** a user (revokes access) or **change their role any day** (e.g. Sam is a
packer on day 1, a mover on day 2) — role is a single admin-controlled field, changeable
instantly. Password reset is self-service via Firebase.

## 5. Data model (Firestore collections)

### `users`
`{ uid, name, email, role: 'admin'|'packer'|'mover'|'driver'|'viewer', status: 'pending'|'active'|'removed', createdAt, approvedBy, approvedAt }`

### `units` (created by a packer when they start a unit)
- `number` (unit #), `lastName` (tenant), `floor`
- `stage` — see §6 lifecycle
- `inventory[]` — `{ item, qty, condition, notes }` written item list
- `materials{}` — counts used: `{ smallBox, medBox, lgBox, wardrobe, tape, paper, bubble, other }`
- `boxCount` — final sealed boxes; the number every later step verifies against
- `containerId` — the BigBox container it was loaded into
- `crew{ packers:[uid], movers:[uid] }` — everyone who worked it
- `times{ packStart, packEnd, loadStart, loadEnd }` — auto-stamped timestamps → durations
- `media[]` — `{ id, kind:'photo'|'video', url, label, phase:'inventory'|'packed'|'loaded', uid, ts }`
- `flag` — `{ message, ts, by, open }` raised automatically on a box-count mismatch

### `containers` (BigBox containers)
`{ number, location: 'onsite'|'picked_up'|'warehouse', bay, unitIds:[], driver:uid, pickupTime, warehouseTime, verifiedBoxes, flag }`

### `schedule` (the floor-by-floor plan; only admin edits dates)
Array of days, seeded from Casey's calendar (§10): `{ date, work:'PACK'|'MOVEOUT', floor, unitCount }`

### `events` (immutable activity log — the backbone)
`{ id, ts, uid, userName, role, type:'stage'|'media'|'note'|'flag'|'system', action (human text), unitId?, containerId?, media? }`
Powers: live feed, per-unit history, per-user + per-unit metrics, and the Google Sheet rows.

## 6. Unit lifecycle (one-way, outbound)

```
not_started → packing → packed → loaded (in a BigBox container) → picked_up → at_warehouse ✓
```

Each transition is an action taken by the authorized role, is timestamped, and writes an
`event`. Box-count verification happens at load (mover vs. packer's sealed count) and at
pickup (driver vs. units on board); any mismatch auto-raises a `flag` visible to Casey.

## 7. Workflows (each step gated + verified)

**Packer — PACK days:** Add unit (# + tenant last name; floor from today's schedule) →
photograph & video the contents (inventory phase) → write the inventory → pack & log
materials → **Finish packing**: enter final sealed box count. The app blocks "finish" until
photos + inventory + box count exist. Auto-captures pack time + who packed. Unit → **packed**.

**Mover — MOVE-OUT days:** Open a packed unit → confirm # + last name → **verify box count**
against the packer's sealed count (mismatch → instant flag) → carry down, load into a BigBox
container (enter container #), **label the box**, photograph it. Captures load time, mover(s),
container. Unit → **loaded**.

**BigBox driver:** See onsite containers ready with their unit #s + last names → **pick up**
(verify boxes on board → flag if off) → drive to the **BigBox warehouse** → check in + assign
a bay. Container → **warehouse**; its units → **at_warehouse**. Driver + times recorded.

**Viewer (PM + BigBox office):** the whole live board, read-only. **Admin (Casey):** all of
the above + user management + schedule edits + flag resolution + reports + the Sheet.

## 8. Metrics & reports (computed from `events` + units/containers)

- **Per unit:** floor, #, tenant, stage, pack time, load time, box count (+ what was verified
  at each hand-off), materials used, # photos / # videos, packer(s)/mover(s)/driver, container,
  flags + resolution, full timeline.
- **Per user (Team view):** units packed, units loaded, containers driven, total time
  contributed, photos & videos taken, materials used, average time per unit.
- **Building dashboard (admin + viewers):** floors 9→1 with done / in-progress / not-started
  counts, boxes, containers, **progress vs. the schedule** (on pace for that floor's move-out
  day?), and open flags surfaced at the top.

## 9. Security (Firestore rules — enforced server-side)

- Unauthenticated: no access.
- `pending` users: read own user doc only; no board access.
- `viewer`: read board; no writes.
- `packer`/`mover`/`driver`: read board; write only the transitions their role owns, and only
  on units in the correct stage/day (the reducer's `canAct`/`containerAction` logic, enforced
  again in rules).
- `admin`: full read/write, user management, schedule edits.
- Media uploads: authenticated active users only; size caps (photos resized client-side,
  videos length/size-limited to control storage cost).

## 10. Schedule seed data (from Casey's calendar, Sept–Oct 2026)

| Date | Work | Floor | Units |
|---|---|---|---|
| Tue Sep 8 | PACK | 9 | 4 |
| Wed Sep 9 | PACK | 9 | 4 |
| Thu Sep 10 | MOVE-OUT | 9 | 4 |
| Fri Sep 11 | PACK | 8 | 6 |
| Sat Sep 12 | PACK | 8 | 6 |
| Mon Sep 14 | MOVE-OUT | 8 | 6 |
| Tue Sep 15 | PACK | 7 | 6 |
| Wed Sep 16 | PACK | 7 | 6 |
| Thu Sep 17 | MOVE-OUT | 7 | 6 |
| Fri Sep 18 | PACK | 6 | 6 |
| Sat Sep 19 | PACK | 6 | 6 |
| Mon Sep 21 | MOVE-OUT | 6 | 6 |
| Tue Sep 22 | PACK | 5 | 6 |
| Wed Sep 23 | PACK | 5 | 6 |
| Thu Sep 24 | MOVE-OUT | 5 | 6 |
| Fri Sep 25 | PACK | 4 | 5 |
| Sat Sep 26 | PACK | 4 | 5 |
| Mon Sep 28 | MOVE-OUT | 4 | 5 |
| Tue Sep 29 | PACK | 3 | 6 |
| Wed Sep 30 | PACK | 3 | 6 |
| Thu Oct 1 | MOVE-OUT | 3 | 6 |
| Fri Oct 2 | PACK | 2 | 6 |
| Sat Oct 3 | PACK | 2 | 6 |
| Mon Oct 5 | MOVE-OUT | 2 | 6 |
| Tue Oct 6 | PACK | 1 | 4 |
| Wed Oct 7 | PACK | 1 | 4 |
| Thu Oct 8 | MOVE-OUT | 1 | 4 |

(Pattern: work top-down, Floor 9 → Floor 1; each floor = pack days then a move-out day. Dates
are editable by admin only.)

## 11. Branding

Gorilla Movers does the labor (logo/branding stays Gorilla). Containers and the warehouse are
**BigBox** — replace the generic "warehouse"/"container" language with BigBox throughout the UI.

## 12. Google Sheet backup (detail)

Real-time server-side mirror to a Sheet Casey owns. Three tabs:
- **Activity** — append-only, one row per event: time, user, role, action, unit #, tenant,
  container, flag.
- **Units** — one row per unit, upserted as it progresses: floor, #, tenant, stage, box count,
  pack time, load time, materials (columns), photo/video counts + media link, crew, container,
  driver, flags.
- **Users** — one row per person, rolled up: units, time, photos, videos, materials.

Media isn't embedded (a Sheet can't hold video) — the Sheet carries counts + a clickable link
to the unit's media. Setup: Casey creates one blank Sheet, deploys a small bound Apps Script
(provided), and pastes the web-app URL into config. No Google-account access shared with us.

## 13. Dependencies from Casey (to guarantee Sept 8)

1. A **Firebase project** for MoveTrack (guided setup).
2. One blank **Google Sheet** + deploying the provided Apps Script (guided).
3. **A day or two of real testing** before the 8th — Casey + one crew member running a practice
   unit end-to-end on real phones.
   (Unit numbers / tenant names are NOT needed up front — packers enter them on the day.)

## 14. Success criteria

- Crew members sign up on their own phones, Casey approves + assigns roles, and everyone sees
  one shared live board.
- A packer creates a unit, adds inventory + photos/video + materials, and finishes with a box
  count; a mover verifies + loads it into a BigBox container with a label + photo; a driver
  picks up + checks the container into the BigBox warehouse — all from phones, with box-count
  mismatches auto-flagging to Casey.
- Per-unit and per-user metrics are accurate and live; the schedule shows progress vs. plan.
- Every action mirrors to Casey's Google Sheet within seconds.
- Works with spotty in-building signal (offline-tolerant) and is installable on a phone.
