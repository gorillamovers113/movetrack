# MoveTrack — Return-Leg Correctness Fixes (from the full-app audit)

**Date:** 2026-08-27
**Status:** approved (part of Casey's "fix issues" from the audit) → build
**Timeline:** the return leg runs in October, so these are important but not Sept-8-blocking.

The flow-correctness auditor found the return leg mistracks reality in several ways because it was
built as a mirror of outbound but reuses outbound data structures that don't hold on the way back.
Fix all of the following; each has an emulator/unit test where it touches testable logic.

## 1. (CRITICAL) Return promotion uses stale cross-container `unitIds`.
`dispatchReturn`/`deliverReturn`/`unloadReturn` (store.jsx) decide which units to promote by iterating
`cont.unitIds`. That array is a permanent `arrayUnion` of every unit the container ever carried
**outbound**, and on return a unit can be loaded into a DIFFERENT container than it left in
(`loadForReturn` allows any at_warehouse/return_filling container). So dispatching container BB-01 can
force-promote a unit that is actually sitting in BB-05, and the `returned_empty` check can stall.

**Fix:** track the unit's CURRENT return container explicitly.
- `loadForReturn` sets `unit.returnContainerId = p.containerId` on the unit patch (in addition to
  `stage:'return_loaded'`). `returnContainerId` is NOT a rules-guarded identity field, so the unit
  update still passes the transition + identity rules unchanged (verify).
- `dispatchReturn` promotes only units where `unit.returnContainerId === cont.id AND unit.stage ===
  'return_loaded'` (not the raw `cont.unitIds`). `deliverReturn` likewise filters on
  `returnContainerId === cont.id AND stage === 'return_transit'`.
- `unloadReturn`'s "last unit unloaded → `returned_empty`" check counts only units with
  `returnContainerId === cont.id` (the units actually on THIS return trip), so a former outbound
  cargo-mate riding a different return box can't block it.
- Keep the batch-atomicity from the reliability pass (these are writeBatch actions).

## 2. (CRITICAL) Turning `returnPhase` OFF strands every mid-return item, unrecoverably.
Today `canAct`/`containerAction`/`overflowAction` only offer return actions when `returnPhase` is
true, and the rules gate ALL return transitions on `returnPhaseOn()`. So flipping the toggle off
mid-return leaves items at `return_loaded`/`return_transit`/`back_on_site`/`unloaded` (and containers/
overflow mid-return) with no action for any role, admin included.

**Fix: gate only the ENTRY into the return leg on `returnPhase`, never the continuation.**
- In the selectors (store.jsx `canAct`/`containerAction`/`overflowAction`): the transition FROM
  `at_warehouse` into the return leg (unit at_warehouse→return_loaded; container
  at_warehouse→return_filling; overflow at_warehouse→rt_transit) requires `returnPhase` on. Every
  transition where the item is ALREADY on a return stage is offered regardless of `returnPhase`.
- In `firestore.rules`: change the return-transition gating so only the entry transitions are wrapped
  in `returnPhaseOn()`; the continuation transitions (return_loaded→return_transit, ... ,
  unloaded→unpacked; return_filling→return_full→...→returned_empty; rt_transit→returned) are allowed
  without the returnPhase gate (still role+stage gated). Update/extend the emulator tests: entry
  transition denied when returnPhase off + allowed when on; continuation transitions allowed
  regardless of returnPhase. Keep all existing tests green.
- (This means an admin can safely toggle the phase off without stranding in-progress work.)

## 3. Custody fields overwrite the outbound record on the same doc.
Outbound `bigboxSwap`(handoffBy/driverName) and `warehouseReceive`(receivedBy) write the SAME container
fields that return `dispatchReturn`(handoffBy/driverName) and `deliverReturn`(receivedBy) overwrite;
same for overflow `transportBy`. The events log keeps history, but the container/overflow summary and
Reports read the current field, so the outbound worker's credit vanishes.

**Fix:** the return actions write RETURN-prefixed fields instead of reusing the outbound ones:
`returnHandoffBy`/`returnDriverName`/`returnDispatchedAt` (dispatchReturn), `returnReceivedBy`/
`returnDeliveredAt`... (deliverReturn), `returnTransportBy` (transportOverflowBack). Do NOT overwrite
the outbound `handoffBy`/`driverName`/`receivedBy`/`transportBy`. Update `Containers.jsx` (and any
overflow display) to show both the outbound and the return driver/handler when present. These new
fields are non-guarded, so rules pass; the custody-attribution uid-pin from the rules-hardening pass
must ALSO cover the new return-prefixed *By fields (add them to the pinned set + tests) so they can't
be forged either.

## 4. Reports mislabel return work as outbound "packed"/"loaded".
`unpackUnit` adds the packer to `crew.packers` and `unloadReturn` adds the mover to `crew.movers` —
the exact arrays Reports uses for "Units packed"/"Units loaded", so return-only workers show as having
packed/loaded, and `piecesPacked` credits the outbound piece count to a return-only unpacker.

**Fix:** the return actions add crew to SEPARATE arrays (`crew.unpackers` for `unpackUnit`,
`crew.unloaders` for `unloadReturn`), not `crew.packers`/`crew.movers`. Add honest return metrics to
`src/lib/reports.js` (e.g. `unitsUnpacked`, `unitsUnloaded` counted from the new arrays) and surface
them in `Reports.jsx` (a couple of return columns/stats). Keep the outbound metrics counting only
outbound crew. Add reports.js unit tests for the new metrics + that outbound counts are unaffected by
return work.

## 5. Return schedule can never reach 100%.
`DEFAULT_RETURN_SCHEDULE` (lib/schedule.js) sets each day's `unitCount` from `FLOOR_UNITS` (8-12/floor,
100 total) while the outbound `DEFAULT_SCHEDULE` uses the real per-day occupied counts (4-6/floor, 49
total). Only ~49 real units ever move, so return `progressForDay` never hits its planned count and the
"hit plan" check never appears.

**Fix:** make `DEFAULT_RETURN_SCHEDULE`'s per-floor `unitCount` match the real counts the outbound plan
uses for that floor (the MOVE-OUT day's count per floor), so return progress can reach 100%. Update
the schedule.js test if it asserts on the old numbers.

## Constraints
- **No em-dashes** anywhere (the app was just swept clean; do not reintroduce any).
- Keep outbound behavior identical. Every legit dispatch write must still pass the rules (run the
  emulator suite). Keep the reliability pass's writeBatch atomicity + await/submitAction wiring intact.
- Reuse existing patterns; touch-first UI. `npx vitest run src` + `npm run test:rules` must stay green
  (extend them for the new logic). Never commit `.env.local`.

## Build order (one branch, sequential-ish, commit in chunks)
1. store.jsx: returnContainerId tracking (#1) + returnPhase entry-gating in selectors (#2 store side) +
   return-prefixed custody fields (#3) + separate return crew arrays (#4).
2. firestore.rules + emulator tests: entry-only returnPhase gating (#2 rules side) + pin the new
   return *By fields (#3 rules side). Deploy rules.
3. lib/schedule.js return unitCounts (#5) + lib/reports.js return metrics (#4) + Reports.jsx +
   Containers.jsx display (#3). Deploy hosting.

## Success criteria
- A unit that returns in a different container than it left in is tracked correctly; `returned_empty`
  fires based on the actual return manifest.
- An admin can toggle returnPhase off with items mid-return; those items remain actionable and reach
  `unpacked`/`returned`.
- The container/overflow summary shows both outbound and return driver/handler; Reports credits return
  work as return work (not as packing/loading), outbound metrics unchanged.
- Return schedule progress can reach 100%.
- All unit + rules tests green; outbound flow byte-for-byte unchanged; deploys live.
