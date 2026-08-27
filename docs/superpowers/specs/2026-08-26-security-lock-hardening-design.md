# MoveTrack — Security-Lock Hardening (server-side rules) Design Spec

**Date:** 2026-08-26
**Status:** approved (Casey greenlit item #3) → build test-first
**Part of:** Sept 8 Trinity Manor readiness

## 1. Purpose

Casey's requirement, verbatim:

> "each user can only modify/change/add his or her own current part ... once everything is
> submitted, only the admin can update, fix, adjust an entry."

Today the Firestore rules let **any** active crew member write **any** field of **any**
unit/container/overflow doc at **any** stage. The role+stage gating lives only in the React UI
(`canAct`, `containerAction`, hidden buttons). This task moves that enforcement into the **Firestore
security rules** so it holds even if someone bypasses the UI. It must not break the live crew flow
(verified working today) — every legitimate dispatch write must still succeed.

**This is a hardening task, TDD with the Firestore emulator. No rule ships without a passing test
that proves both the allowed write succeeds and the disallowed write is denied.**

## 2. Principle

A non-admin write is allowed **only** if it is a valid **stage transition owned by that user's
current role**. Since each role owns only the transitions at its stage, this automatically means:

- You can only act on the **current** stage (your part), not rewrite an earlier one.
- Once a doc moves past your stage, your role no longer matches any transition on it, so it's
  **locked** to you.
- A pure edit (no stage advance) matches no non-admin transition, so **only admin can edit/fix/adjust**.

Admin can always write anything. The `events` log is **append-only** and every event's `uid` must be
the caller (no forging another person's action).

## 3. Exact transition tables (derived from `src/store.jsx` dispatch — do not deviate)

Let `before = resource.data.stage` (the doc's current stage) and `after =
request.resource.data.stage` (the incoming write). `role = me().role`.

### `units` (lifecycle: not_started → packing → packed → loaded → picked_up → at_warehouse)
| role | allowed (before → after) | dispatch action |
|---|---|---|
| packer | not_started → packing | startPacking |
| packer | packing → packed | finishPacking |
| mover | packed → loaded | loadUnit |
| mover | loaded → picked_up | bigboxSwap (units in a full container) |
| warehouse | picked_up → at_warehouse | warehouseReceive |

### `containers` (lifecycle: empty → filling → full → picked_up → at_warehouse)
Note: loading a unit sets status to `filling` whether the container was `empty` or already
`filling`, so the mover load transition must allow `before in [empty, filling]` → `after == filling`
(a second load is filling → filling, no status change — must still be allowed).
| role | allowed (before → after) | dispatch action |
|---|---|---|
| mover | (empty OR filling) → filling | loadUnit |
| mover | filling → full | markContainerFull |
| mover | full → picked_up | bigboxSwap |
| warehouse | picked_up → at_warehouse | warehouseReceive |

### `overflow` (lifecycle: identified → prepped → in_transit → at_warehouse)
| role | allowed (before → after) | dispatch action |
|---|---|---|
| mover | identified → prepped | prepOverflow |
| mover | prepped → in_transit | transportOverflow |
| warehouse | in_transit → at_warehouse | receiveOverflow |

(Packers do not *update* overflow — they only *create* it, see §4.)

## 4. Create rules (initial stage enforced)

- `units` create: `isAdmin()` or `hasRole('packer')`; must create at `stage == 'not_started'`.
  (NewUnitModal self-gates to admin+packer.)
- `containers` create: `isAdmin()` or `hasRole('mover')`; must create at `status == 'empty'` with
  `unitIds == []`. (logEmpties + bigboxSwap new-empties.)
- `overflow` create: `isAdmin()`, `hasRole('packer')`, or `hasRole('mover')`; must create at
  `stage == 'identified'`. (createOverflow.)

## 5. Immutable identity fields (non-admin writes)

On a non-admin **update**, the doc's identity fields may not change (a packer finishing packing
cannot also rename or re-floor the unit — "modify only your own current part"):

- `units`: `number`, `tenant`, `floor`, `createdAt` must equal their prior values.
- `containers`: `number`, `deliveredAt` unchanged.
- `overflow`: `unitId`, `unitNumber`, `createdBy`, `createdAt` unchanged.

Use direct equality (`request.resource.data.X == resource.data.X`) — simpler and safer than
`affectedKeys()` given nested `crew`/`times` maps. (Firestore rules see the full merged post-write
document in `request.resource.data`, so an unchanged field simply equals its prior value.)

## 6. Events, schedule, users

- `events`: read `isActive()`; **create** by `isAdmin() || isCrew()` AND
  `request.resource.data.uid == request.auth.uid` (can't forge another user's action); **update +
  delete: admin only** (append-only accountability log).
- `schedule`: unchanged — read `isActive()`, write `isAdmin()`.
- `users`: unchanged — the current signup/approve model is already correct; keep it exactly.
- `units`/`containers`/`overflow` **delete: admin only.**

## 7. Rule structure

Keep the existing helpers (`isSignedIn`, `me`, `isActive`, `hasRole`, `isAdmin`). Add small
transition helper functions per collection (e.g. `unitTransitionOK()`, `containerTransitionOK()`,
`overflowTransitionOK()`, plus `unitIdentityUnchanged()` etc.). Split each operational collection's
`allow write` into explicit `allow create`, `allow update`, `allow delete` rules. Watch the
per-request `get()` budget (max 10 document accesses) — `me()` does a `get`; don't call it
gratuitously inside loops. Keep it readable and commented.

## 8. Test matrix (emulator, `@firebase/rules-unit-testing` + vitest)

Set up the harness: add `@firebase/rules-unit-testing` as a devDependency, add a `firestore`
emulator block to `firebase.json`, and a test script that runs vitest under
`firebase emulators:exec --only firestore`. Seed each test with `withSecurityRulesDisabled` context
to plant the starting doc, then assert with a role-scoped context.

Cover, at minimum (each = one allowed assertion + one denied assertion):

1. packer start/finish packing on a not_started/packing unit → **allow**; packer loading a packed
   unit (mover's job) → **deny**; packer editing a *packed* unit's tenant → **deny**.
2. mover load (packed→loaded), markFull, swap, on the right stages → **allow**; mover doing a
   warehouse receive (picked_up→at_warehouse) → **deny**; mover editing a picked_up unit → **deny**.
3. warehouse receive (picked_up→at_warehouse) → **allow**; warehouse loading a unit → **deny**.
4. second load into an already-`filling` container (filling→filling) → **allow** (regression guard
   for the no-status-change case).
5. non-admin changing `number`/`tenant`/`floor` during an otherwise-valid transition → **deny**.
6. admin editing any doc at any stage → **allow**; admin resolving a flag (no stage change) →
   **allow**.
7. viewer writing anything → **deny**; pending user reading the board → **deny**.
8. unit/container/overflow create at the wrong initial stage → **deny**; at the right stage by the
   right role → **allow**; wrong role create → **deny**.
9. event create with `uid != auth.uid` → **deny**; with matching uid → **allow**; event
   update/delete by crew → **deny**, by admin → **allow**.
10. schedule write by non-admin → **deny**; by admin → **allow**.

## 9. Success criteria

- Every legitimate dispatch write in `src/store.jsx` still succeeds under the new rules (proven by
  "allow" tests mirroring each dispatch action). The live crew flow is unbroken.
- Every out-of-role, out-of-stage, edit-after-submit, identity-tampering, and forged-event write is
  denied server-side (proven by "deny" tests).
- `firebase emulators:exec --only firestore "vitest run"` passes 100%.
- `firebase deploy --only firestore:rules` succeeds; the deployed app still runs the full flow.

## 10. Non-goals

- No change to app UI or dispatch logic (rules only, plus the test harness). The UI already gates
  correctly; this is defense-in-depth behind it.
- No Storage-rules change (separate, already scoped).
- Not touching the `users` signup/approval rules (already correct).
