# MoveTrack — Return Phase (exact reverse) Design Spec

**Date:** 2026-08-26
**Status:** approved (Casey: "it's an exact reverse", green-lit with a return schedule) → build
**This is the final MoveTrack feature.**

## 1. Purpose

When the building work is done, everything comes **back** to Trinity Manor. Casey: the return is an
**exact reverse** of the outbound move. Each item continues from where it stopped (`at_warehouse`)
and walks the same steps backward, the same roles doing the reverse of their action, with the **same
piece-count verification and photos** at every handoff, back into the **same apartments** (units keep
their number/tenant/floor, so nothing is re-entered). Every action keeps the name + date/time +
photo trail, and mismatches auto-flag to the admin, exactly like outbound.

## 2. Turning it on

A project-level switch, admin-only. Add a `meta` collection with a singleton doc `meta/project`:
`{ returnPhase: boolean, name, address }` (name/address replace the current hardcoded
"Trinity Manor"/"3940 Park Blvd" fallback in App.jsx). Subscribe to it in the store and expose as
`state.project`. An admin taps **"Begin return phase"** to set `returnPhase: true` (and can turn it
back off). Until then the outbound flow is entirely unaffected. When on, the board surfaces the
return actions and the return schedule.

## 3. The mirror (exact reverse of each step)

| Outbound action | stage change | ↔ | Return action | stage change | role |
|---|---|---|---|---|---|
| warehouseReceive | picked_up → at_warehouse | ↔ | **loadForReturn** (load unit back into a return container at the warehouse, piece verify) | at_warehouse → return_loaded | warehouse |
| (container filling→full) | | ↔ | **markReturnFull** | return_filling → return_full | warehouse |
| bigboxSwap (site handoff to driver) | loaded → picked_up | ↔ | **dispatchReturn** (hand the full return container to BigBox, driver name + photo) | return_full → return_transit; units return_loaded → return_transit | warehouse |
| (BigBox drives to warehouse) | | ↔ | **deliverReturn** (return container arrives back at the building) | return_transit → back_on_site; units → back_on_site | mover |
| loadUnit (load at apartment, piece verify) | packed → loaded | ↔ | **unloadReturn** (carry the unit off, into its apartment, piece verify) | back_on_site → unloaded | mover |
| finishPacking (pack in apartment, photo) | packing → packed | ↔ | **unpackUnit** (unpack in the apartment, photo) | unloaded → unpacked ✅ terminal | packer |

**Overflow return** (mirror of identified→prepped→in_transit→at_warehouse, simplified):

| Outbound | ↔ | Return | stage | role |
|---|---|---|---|---|
| transportOverflow / receive | ↔ | **transportOverflowBack** (Gorilla drives it back to site) | at_warehouse → rt_transit | mover |
| prep (wrap/label) | ↔ | **returnOverflow** (place it back in the apartment, unwrap, photo) | rt_transit → returned ✅ | mover/packer |

## 4. New stage vocabulary

Add to `src/seed.js` STAGES (continue the `step` ordering after at_warehouse = 5):

Units: `return_loaded` (6), `return_transit` (7), `back_on_site` (8), `unloaded` (9),
`unpacked` (10, terminal, the "complete" state). Give each a label + color (use a cool-to-warm
return palette distinct from outbound so the board reads direction at a glance).

Containers (`CONT_STATUS` in store.jsx): `return_filling`, `return_full`, `return_transit`,
`back_on_site`, `returned_empty`.

Overflow (`OVERFLOW_STATUS`): `rt_transit`, `returned`.

Keep the terminal display honest: a unit at `unpacked` and a container at `returned_empty` are DONE
(project fully reversed for that item).

## 5. Dispatch actions (in `src/store.jsx`)

Mirror the existing outbound actions' structure exactly (optimistic async, `arrayUnion`, `Date.now()`
timestamps, `attributeMedia()` on photos, an `events` doc per action via `ev()` carrying
unitId/containerId/overflowId + media, auto-flag on piece mismatch via `boxMismatch`):

- `setReturnPhase({ on })` — admin; writes `meta/project.returnPhase`; event.
- `loadForReturn({ unitId, containerId, pieces, media })` — unit at_warehouse → return_loaded (piece
  verify vs unit.pieces, auto-flag); return container at_warehouse|return_filling → return_filling,
  add unitId. (warehouse)
- `markReturnFull({ containerId })` — return_filling → return_full. (warehouse)
- `dispatchReturn({ containerId, driverName, newEmptyNumbers?, media })` — container return_full →
  return_transit (record driverName, handoffBy); its units return_loaded → return_transit.
  (warehouse) Mirror of bigboxSwap; the return does NOT necessarily bring new empties, so
  newEmptyNumbers is optional/omitted.
- `deliverReturn({ containerId, media })` — container return_transit → back_on_site (receivedBy on
  site); its units return_transit → back_on_site. (mover)
- `unloadReturn({ unitId, pieces, media })` — unit back_on_site → unloaded (piece verify vs
  unit.pieces, auto-flag), add mover to crew.movers. (mover) When a container's last unit is
  unloaded, set that container → returned_empty (mirror of a container emptying out).
- `unpackUnit({ unitId, media })` — unit unloaded → unpacked (photo, add packer to crew.packers).
  (packer) Terminal.
- `transportOverflowBack({ overflowId, media })` — overflow at_warehouse → rt_transit. (mover)
- `returnOverflow({ overflowId, media })` — overflow rt_transit → returned (photo). (mover or packer)
- Return schedule: `seedReturnSchedule` / `editScheduleDay` reused with a `phase` field (see §7).

Extend `canAct(user, unit)` and `containerAction(user, cont)` to return the correct next return
action when `state.project.returnPhase` is on and the item is on the return leg, gated to the role
that owns that reverse step. (Pass the project/returnPhase in, or read it where these are called.)

## 6. Security rules (firestore.rules) — MUST ship with the backend

The hardened outbound rules will DENY every new return transition. Extend them, test-first with the
emulator (same harness as the security-lock task, `test/rules/`):

- Add the return transitions to `unitTransitionOK` / `containerTransitionOK` / `overflowTransitionOK`
  with the correct role per §3 (warehouse: at_warehouse→return_loaded, return_filling→return_full,
  return_full→return_transit; mover: return_transit→back_on_site, back_on_site→unloaded; packer:
  unloaded→unpacked; container/overflow return transitions likewise; the container
  return_transit→back_on_site and →returned_empty by mover).
- Gate the return transitions on `returnPhase` being true: a return transition is only allowed when
  `get(/meta/project).returnPhase == true` (mirror the existing get budget care; this is one extra
  get — keep total under ~10). Outbound transitions remain always-allowed.
- `meta/project`: read by any active user; write admin-only.
- Identity-immutability guards still apply (number/tenant/floor never change on the return leg).
- Add allow + deny tests for every new transition (right role + returnPhase on = allow; wrong role,
  or returnPhase off, or out-of-stage = deny). Keep all existing 58 tests green.

## 7. Return schedule

The return runs in October on its own timeline. Reuse the `schedule` collection with a new `phase`
field: `'out'` (default, backfilled for existing days) | `'return'`. Add `DEFAULT_RETURN_SCHEDULE` to
`src/lib/schedule.js`: a template of return days the admin dates + edits (floors in the order Casey
will bring them back; use placeholder October dates clearly marked as editable, since exact dates are
TBD). The Schedule view gets an **Outbound / Return** toggle; each phase shows its own days, today
banner, and progress vs plan (return progress = units at `unpacked` per floor vs plan). Admin can
"Load return template", edit days, same as outbound. `seedSchedule` writes `phase:'out'`;
`seedReturnSchedule` writes `phase:'return'`.

## 8. UI

- **"Begin / End return phase"** admin control (on the Dashboard and/or a settings spot), clearly
  labeled, with a confirm.
- When `returnPhase` on, the board and unit/container/overflow screens surface the **return** actions
  (the mirrored buttons) for items on the return leg, using the same big-button + short-form + photo
  pattern as outbound. Reuse the existing components/screens; add the return actions alongside, gated
  by stage + role + returnPhase. A unit's detail shows its full timeline out AND back.
- Direction is visually clear (return stages use the distinct return palette; a small "Return"
  banner when the phase is on).
- Dashboard/BuildingView reflect return progress when in return phase (e.g. floors light up as units
  reach `unpacked`).
- Reports count return work too (units unpacked, return loads, etc.) — at minimum don't break; ideally
  add return columns. Keep it honest.
- Everything stays dead-simple, touch-first, iPhone + Android; empty states never crash; no em-dashes.

## 9. Constraints

- No em-dashes in shipped code/copy/comments. Reuse existing styles/components. No new deps/CDN fonts.
- Do not break the outbound flow: with `returnPhase` off, behavior is identical to today.
- Photos to Storage via `uploadImage()`; media carry uid/userName/ts. Every action writes an event.
- Keep the Firestore get() budget under ~10 per rules evaluation.

## 10. Build order (sequential, one `return-phase` branch)

1. **Backend + stages + meta flag + return schedule data/actions** (store.jsx, seed.js,
   lib/schedule.js, lib helpers + tests). No deploy yet (rules would block live writes).
2. **Security rules for the return transitions + returnPhase gating** (firestore.rules + emulator
   tests); deploy rules.
3. **Return UI** (toggle, mirrored return actions on the screens, return schedule toggle, board
   reflects return progress); deploy hosting.

## 11. Success criteria

- Admin taps "Begin return phase"; each `at_warehouse` unit can be loaded for return (piece verify),
  dispatched from the warehouse (driver + photo), delivered back to site, unloaded into its **same
  apartment** (piece verify), and unpacked (photo) to `unpacked` = complete. Overflow returns and is
  placed back. Containers walk the mirrored container lifecycle to `returned_empty`.
- Every return step is name/date/time/photo stamped; mismatches auto-flag; rules enforce role+stage+
  returnPhase server-side (emulator-tested); outbound flow unchanged when the phase is off.
- The return schedule shows its own today-floor + progress vs plan; admin can date/edit it.
- All tests green (lib + rules); build clean; deploys live 200; works on iOS Safari + Android Chrome.
