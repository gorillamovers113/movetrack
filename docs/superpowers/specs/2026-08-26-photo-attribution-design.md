# MoveTrack — Photo Attribution Display Design Spec

**Date:** 2026-08-26
**Status:** approved (Casey greenlit item #4) → build
**Part of:** Sept 8 Trinity Manor readiness

## 1. Purpose

Casey's requirement, verbatim:

> "each users submissions ie photos show the photo, users name, time, date stamp."

Every photo/video anywhere in the app must display, together with the image: **who submitted it** and
**the date + time** it was submitted. Today only the Overflow view does this (a local
`AttributedMedia` component). Packing-inventory photos, load photos, BigBox handoff/receive photos,
and every photo in the Activity feed render as bare thumbnails with no per-photo attribution.

## 2. Two halves

**(A) Data — stamp attribution onto every media object at creation.** Media objects have an
inconsistent shape today: Overflow media carry `{ uid, userName, ts }`; media built by
`filesToMedia()` (packing inventory) and some `uploadImage()` capture sites carry only
`{ id, kind, label, url }`. Standardize so **every** persisted media object carries `uid`,
`userName`, and `ts`.

**(B) Display — one shared attributed renderer used everywhere.** Promote the Overflow
`AttributedMedia` pattern into a single shared component and use it in every place media renders.

## 3. Data side (in `src/store.jsx`)

- Add a helper that stamps attribution onto an incoming media array using the current user:
  ```
  const attributeMedia = (arr = []) => arr.map((m) => ({
    ...m,
    uid: m.uid || currentUser.uid,
    userName: m.userName || currentUser.name,
    ts: m.ts || Date.now(),
  }))
  ```
  (Preserve any value already present so Overflow's already-stamped media stay identical and this is
  idempotent.)
- Apply it to `p.media` at the top of **every** dispatch action that persists media, so both the
  entity doc (`media: arrayUnion(...)`) and the `ev(..., { media })` event carry the stamped array:
  `finishPacking`, `loadUnit`, `bigboxSwap`, `warehouseReceive`, `addMedia`, `prepOverflow`,
  `receiveOverflow`. (createOverflow has no media.)
- Since stamping is now central, **remove the now-redundant client-side stamping** in
  `src/views/Overflow.jsx`'s `submitPrep`/`submitReceive` (they can pass the raw
  `{ id, kind, label, url }`; dispatch stamps). Verify the `AttributedMedia` still shows name/time
  after this (it will, from the stamped stored doc).
- Media created before this change (existing Firestore test data) lack these fields; the renderer
  must fall back gracefully (see §4), never crash.

## 4. Display side (shared component in `src/ui.jsx`)

- Add an exported `AttributedMedia({ media, onOpen })` to `src/ui.jsx` (move/generalize the one from
  Overflow). Each item: the thumbnail (or a ▶ tile for video) with, directly beneath it, a small
  caption line: **submitter name** and **date · time** (`fmtTime(m.ts)`). Fallbacks: `userName ||
  'Unknown'`, `m.ts ? fmtTime(m.ts) : '—'`. Wrap-friendly, mobile-first, reuse `.media-row` /
  `.media-thumb` / `.muted` styles already in `styles.css`.
- Replace the bare `MediaRow` usage inside `EventRow` (`src/ui.jsx`) with `AttributedMedia` so every
  photo in the **Activity feed, the unit timeline, and My queue** shows per-photo name + date/time.
  (Keep the row-level `userName · role — time` line; that's the event actor. The per-photo caption is
  what Casey asked for and covers cases where a photo's submitter differs from the row actor.)
- Update `src/views/Overflow.jsx` to import and use the shared `AttributedMedia`; delete its local
  copy (no behavior change there).
- **Lightbox** (`src/ui.jsx`): extend the caption to include submitter + date/time under the label
  (`{label} — {userName} · {fmtTime(ts)}`, using the same graceful fallbacks), so the full-size view
  is attributed too.
- Leave the pre-submit local *preview* thumbnails (`inv-thumb` in UnitDetail/Containers/
  BigBoxSwapButton, shown before the user taps submit) as-is — those are the just-captured image
  before it is stored/attributed, not persisted media.

## 5. Constraints

- **No em-dashes** in new code/copy/comments (commas/periods/parens). Hard house rule. (Note the
  existing "missing value" placeholder idiom uses a literal `—` glyph as data, e.g. `ts ? ... : '—'`;
  that pre-existing UI-placeholder glyph is fine to match, it is not prose punctuation.)
- Dead simple, touch-first, iPhone + Android. Don't shrink tap targets. The caption text is small
  (~11px) but must stay legible.
- No change to the Firestore rules, the container/overflow lifecycles, or dispatch semantics beyond
  adding attribution to media. Reuse existing styles; do not restructure unrelated code.
- Photos already go to Storage via `uploadImage()`; this task does not change upload/storage.

## 6. Success criteria

- Every rendered photo/video in Activity, a unit's timeline, My queue, the Containers screens, and
  the Overflow screens shows the image plus the submitter's name and the date + time beneath it.
- The Lightbox (full-size view) shows the submitter + date/time.
- A newly submitted packing-inventory photo (via `filesToMedia`) and a newly submitted load/handoff/
  receive photo all carry `uid`/`userName`/`ts` and display attribution.
- Old, pre-existing media without attribution render with "Unknown / —" fallbacks and never crash.
- `npx vitest run` stays green; `npm run build` passes; the deployed app renders attributed media on
  iOS Safari + Android Chrome.
