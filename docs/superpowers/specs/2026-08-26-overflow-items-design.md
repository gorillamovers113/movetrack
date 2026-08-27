# MoveTrack — Overflow Items (Gorilla-transported) Design Spec

**Date:** 2026-08-26
**Status:** approved (Casey greenlit item #2) → build
**Part of:** Sept 8 Trinity Manor readiness

## 1. Purpose

Some items are **too big to fit inside a BigBox container** (armoires, large dressers,
headboards, sofas, appliances, mirrors, art). Those do **not** go into BigBox. **Gorilla Movers
transports them directly** to the BigBox warehouse. Casey's requirement, verbatim:

> "there can be overflow items, if something is too big to fit into a bigbox container,
> gorillamovers will transport, to the warehouse. it must be padded, wrapped, labeled, with
> pictures and locations for each items."

So each overflow item needs its own chain of custody: **describe → pad/wrap/label (photo) →
Gorilla transports → placed at the warehouse with a per-item location.** Same accountability rules
as the rest of MoveTrack: every action logs a user + timestamp, every photo carries the submitter's
name and date/time.

## 2. Where it fits

It is a **per-item** parallel to the BigBox container flow. A unit's *normal* pieces ride BigBox
containers (existing flow, untouched). A unit's *oversized* pieces become individual **overflow
items** tracked one by one, because each is padded/wrapped/labeled and placed at its own warehouse
spot. Overflow items belong to a unit (so they stay tied to the tenant/apartment) but move on their
own lifecycle.

## 3. Lifecycle

```
identified → prepped (padded/wrapped/labeled + photo) → in_transit (on Gorilla truck) → at_warehouse (location assigned)
```

- **identified** — a crew member logs an oversized item on a unit (name/description). It exists,
  nothing done yet.
- **prepped** — Gorilla crew pads, wraps, and labels it; a **photo is required** here (proof of prep
  + the label). This is the "must be padded, wrapped, labeled, with pictures" step.
- **in_transit** — loaded onto the **Gorilla** truck (not BigBox) and driven to the warehouse.
- **at_warehouse** — warehouse staff receive it and assign a **specific per-item location** (bay /
  shelf / spot). An optional received-condition photo. Custody closed.

## 4. Data model

New Firestore collection **`overflow`**, one doc per item:

```
{
  id,                     // Firestore doc id
  unitId, unitNumber, unitTenant, floor,   // denormalized from the unit at creation for display
  description,            // free text, e.g. "Large oak armoire, glass doors"
  stage,                  // 'identified' | 'prepped' | 'in_transit' | 'at_warehouse'
  warehouseLocation,      // string, set at receive, e.g. "Bay C, shelf 3"
  media: [],              // { id, kind:'photo'|'video', url, label, uid, userName, ts } — Storage URLs
  flag,                   // optional { message, ts, by, open }
  createdBy,              // uid of the crew member who logged it
  prepBy, transportBy, receivedBy,          // uids at each step
  createdAt, preppedAt, transitAt, warehouseAt   // Date.now() timestamps
}
```

`units` unchanged. Every action still writes an `events` doc (type/action/media), so overflow shows
up in the global Activity feed and per-user metrics like everything else. Event docs reference the
item via a new optional `overflowId` field (mirrors how events carry `unitId`/`containerId`).

## 5. dispatch actions (in `src/store.jsx`)

- `createOverflow({ unitId, description })` — creates the doc at `stage:'identified'`, denormalizing
  `unitNumber/unitTenant/floor` from the unit; event: "Logged overflow item on unit N: <desc>".
- `prepOverflow({ overflowId, media })` — **media required** (padded/wrapped/labeled photo,
  already uploaded to Storage via `uploadImage()`); sets `stage:'prepped'`, `preppedAt`, `prepBy`;
  arrayUnion the media onto the item; event carries the media so it shows in Activity.
- `transportOverflow({ overflowId })` — `stage:'in_transit'`, `transitAt`, `transportBy`; event:
  "Gorilla loaded overflow item … for transport to warehouse".
- `receiveOverflow({ overflowId, warehouseLocation, media })` — `stage:'at_warehouse'`,
  `warehouseAt`, `receivedBy`, `warehouseLocation`; optional received photo; event:
  "Overflow item … received at warehouse — <location>".
- `editOverflow({ overflowId, patch })` — admin-only correction after submit.
- `addOverflowNote` / `resolveOverflowFlag` — parallel to the unit/container note+flag helpers.

Follow the exact patterns already in `store.jsx` for containers (optimistic `dispatch`, `ev()`
helper, `arrayUnion`, `Date.now()` timestamps). Media objects must carry `uid`, `userName`, and `ts`
so photo attribution (item #4 on the roadmap) can render name + date/time on every image.

## 6. Roles & permissions

| Role | Overflow actions |
|---|---|
| admin | everything + edit/resolve |
| packer | log (identify) an overflow item while packing |
| mover | log, prep (pad/wrap/label + photo), transport |
| warehouse | receive + assign per-item location |
| viewer | read-only |
| driver (legacy) | none |

Firestore rules (`firestore.rules`): `overflow` is writable by the same active crew set that may
write `containers` (packer/mover/warehouse/admin via the existing `isCrew()`/`isAdmin()` helpers),
readable by any active user. No self role/status change. Keep it consistent with the container
rules block — do not invent a new permission model.

## 7. UI

- **New view `src/views/Overflow.jsx`** — a status-grouped pool, same visual language as
  `Containers.jsx`: sections **Needs prep · Ready to transport · In transit · At warehouse**, each
  item a tappable card showing unit # + tenant + floor, the description, its photos (with submitter
  name + date/time), and the one role-appropriate action button. Empty states never crash (friendly
  "No overflow items yet"). Mobile-first, ≥44px tap targets, reuse existing `.card`/`.btn` styles.
- **"＋ Report overflow item"** entry point: a button on `UnitDetail.jsx` (visible to
  packer/mover/admin) that opens a small modal (description textarea → create), and the same
  create affordance at the top of the Overflow view. Reuse the `NewUnitModal.jsx` modal pattern.
- **Prep / Transport / Receive** each are one tap → short form (photo capture for prep via
  `uploadImage()`; location text for receive) → done. No nested menus.
- **Nav:** add an `overflow` entry (icon 🛋️, label "Overflow") to the `NAV` map in `App.jsx` for
  **admin, mover, warehouse, viewer** (packers reach it via the unit button, so it's optional in
  their nav — omit to keep their nav lean). Wire the `case 'overflow'` route in the `page()` switch.
- Action buttons are **hidden** (not disabled) for roles that can't use them, matching the container
  UI convention. Gate with `isMover`/`isWarehouse`/admin booleans.

## 8. Non-goals (this build)

- No separate "overflow truck" entity or driver accounts — Gorilla movers do it; `transportBy` (the
  mover's uid) is the record.
- No QR/barcode scanning (future).
- No change to the BigBox container flow.
- Reverse/return phase is a later roadmap item (#10), not here.

## 9. Success criteria

- A packer logs an oversized armoire on unit 902; a mover preps it (photo of it padded, wrapped, and
  labeled — the photo shows the mover's name + date/time); a mover marks it in transit; warehouse
  receives it and assigns "Bay C, shelf 3" — all in a few taps on a phone.
- The item appears in the Overflow pool grouped by stage, in the global Activity feed, and in the
  submitting users' per-user metrics.
- Every overflow photo displays the image + submitter name + date/time.
- Empty states never crash on iOS Safari or Android Chrome.
