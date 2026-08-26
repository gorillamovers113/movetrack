# MoveTrack — BigBox Container Logistics + Warehouse Role + Driver-Gap Fix (Design Spec)

**Date:** 2026-08-26
**Status:** approved (Casey) → build next
**Hard deadline:** part of the Sept 8 Trinity Manor readiness

## 1. Purpose

Model how BigBox containers *actually* move, close the "BigBox driver won't use the app" gap, and
add the warehouse to the chain — all while keeping it **dead simple, clean, and touch-first on
iPhone and Android**.

**Operational reality (from Casey + BigBox, 2026-08-26):**
- BigBox delivers **5 empty containers** at a time to the site.
- Gorilla movers load units into those on-site empties.
- BigBox returns and **swaps: drops 5 empties, picks up 5 full** containers, drives them to the
  BigBox warehouse.
- The **BigBox driver will NOT use the app** ("too hard for them").
- The **BigBox warehouse staff CAN use the app.**

## 2. The driver-gap fix (core idea)

The driver is only the courier *between* two people who ARE on the app. So those two log the
hand-off; the driver touches nothing:
- **Pickup:** the on-site **mover** logs the hand-off (records the driver's name / truck #).
- **Arrival:** the **warehouse** person logs receipt + verifies the box count + assigns a bay.

Chain of custody stays unbroken (box-count verified at both ends). **No driver accounts.** The
`driver` role is retired from the required flow (a legacy `driver` role may remain but is not part
of the day-to-day path).

## 3. Container lifecycle (replaces the ad-hoc create-on-type model)

```
empty (on site) → filling → full / ready → picked_up (handed to BigBox) → at_warehouse ✓
```

- **empty** — BigBox dropped it off; on site, nothing loaded yet; available to load into.
- **filling** — at least one unit loaded; more can be added.
- **full / ready** — movers marked it done, waiting for BigBox pickup.
- **picked_up** — handed off to the BigBox driver (driver name/truck recorded); in transit.
- **at_warehouse** — warehouse received + verified + assigned a bay.

## 4. Data model changes

`containers`:
- `number`, `status` (the lifecycle above), `unitIds[]` (multiple units per container — already so)
- `driverName` (free text, recorded at hand-off; NOT an app user)
- `bay` (warehouse slot), `verifiedBoxes`, `flag` (box-count mismatch)
- timestamps: `deliveredAt`, `pickedUpAt`, `warehouseAt`; `handoffBy`/`receivedBy` (uid of the app user who logged it)
- `media[]` (hand-off + receive photos — see §7, gated on Storage/Blaze)

`users` role enum gains **`warehouse`**. `units` unchanged. Every action still writes an `events` doc (per-user accountability, unchanged).

## 5. Workflows (each is 1–2 taps, big buttons)

1. **Log empties delivered** (mover / admin): "＋ Empties in" → enter/scan the container numbers
   (5 at a time, but any count) → creates `containers` with `status:'empty'`. One screen, one list.
2. **Load a unit into a container** (mover): on a packed unit, "Load into BigBox" → **pick from the
   on-site empty/filling containers** (a big tappable list) instead of typing a number → box-count
   verify (auto-flag mismatch, unchanged) → unit `stage:'loaded'`, container → `filling`.
3. **Mark full / ready** (mover): a `filling` container → "Full — ready for pickup" → `full`.
4. **BigBox swap** (mover / admin): "BigBox swap" → (a) select the **full** containers being handed
   off, record **driver name / truck**, (b) enter the **new empties** dropped. Batch, one screen.
   Selected fulls → `picked_up`; new empties created.
5. **Warehouse receive** (warehouse role): a `picked_up` container → "Receive" → **verify box count**
   (auto-flag mismatch) → assign **bay** → `at_warehouse`.

## 6. Roles & permissions (updated)

| Role | Container actions |
|---|---|
| admin | everything |
| packer | (none on containers) |
| mover | log empties, load units, mark full, log the swap/hand-off |
| **warehouse** (new) | receive + verify + bay at the warehouse |
| viewer | read-only |
| driver (legacy) | not used in the day-to-day flow |

Firestore rules: `warehouse` is an active crew-like role that may write `containers`/`events` (read the board); still no self role/status change; admin-only for schedule + user mgmt.

## 7. Photos (honest scope note)

Hand-off and receive **photos need Firebase Storage = the Blaze upgrade** (same as packing photos).
This build ships the full logistics + **driver-name capture + box-count verification** (all text /
numbers, no Storage) so custody is solid **now**; the camera/photo attach points are wired but the
actual upload turns on when Blaze + Storage are enabled (its own follow-up). No fake/base64-in-
Firestore photos.

## 8. UX constraints (non-negotiable)

- **Dead simple:** each action is a big labeled button → a short form → done. No nested menus.
- **Touch-first, iPhone + Android:** large tap targets (min ~44px), thumb-reachable primary
  actions, native-feeling selects, no hover-only controls. It's already an installable PWA; keep it
  working offline-tolerant (Firestore persistence).
- **Container pool view:** one clean screen grouping containers by status (Empty on site · Filling ·
  Full/ready · In transit · At warehouse) so anyone can see the state at a glance.
- Reuse existing styles/components; match the current look.

## 9. Non-goals (this build)

- Real photo/video upload (needs Blaze — separate follow-up; attach points only).
- QR/barcode scanning (great future add; typing/tapping numbers for now, "scan" is a later layer).
- Per-user reporting dashboards (Phase 3; data already captured in events).

## 10. Success criteria

- A mover logs 5 empties, loads units into them by tapping (not typing), marks them full, and logs a
  BigBox swap (5 out with driver name + 5 new empties in) — all in a few taps on a phone.
- A warehouse user receives each full container, the box count is verified (mismatch auto-flags to
  admin), and a bay is assigned.
- The BigBox driver never opens the app, yet every container's custody is fully logged end-to-end.
- Works cleanly on iOS Safari and Android Chrome; empty states never crash.
