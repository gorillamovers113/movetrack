# MoveTrack — Design + Gorilla Branding Polish Design Spec

**Date:** 2026-08-26
**Status:** approved (Casey greenlit item #7) → build (conservative, regression-safe)
**Part of:** Sept 8 Trinity Manor readiness

## 1. Purpose

Casey wants MoveTrack to feel **beautiful and clearly Gorilla-branded**, not just functional, and to
look great **on a phone** (the crew's primary device). The app already has a real design system
(amber Gorilla brand `#f59e0b`, dark sidebar, Inter/Space Grotesk, cards, pills, the Gorilla
wordmark/mark, a Gorilla-awning BuildingView). This task is a **cohesion + polish pass**, not a
rebrand and not a rebuild.

## 2. Guardrails (this is a live app, do not regress it)

- **CSS-first.** Prefer changes in `src/styles.css` (the shared classes every view already uses) and
  small, safe `className` additions. Do NOT restructure component logic, change dispatch/props, or
  rewrite JSX beyond wrapper elements / className changes needed for styling.
- Every existing screen must still lay out correctly on a narrow phone (~360px) and desktop. Do not
  break the sidebar, bottom-nav, topbar, tables, modals, or the BuildingView SVG.
- `npm run build` must stay clean; `npx vitest run` must stay green (styling shouldn't touch tested
  logic).
- **No em-dashes** in new code/copy/comments (the `'—'` placeholder-glyph-as-data idiom is fine).

## 3. What to polish

### 3a. Cohesion (highest value)
The newer screens (`Overflow.jsx`, `Schedule.jsx`, `Reports.jsx`) were built reusing styles but
should be visually audited to match the established `Dashboard`/`Containers` language exactly: same
page-head treatment, section titles, card padding/radius, pill/badge shapes, KPI number styling,
empty-state cards, spacing rhythm. Fix any drift so the whole app feels like one product.

### 3b. Design-token refinement (subtle, global)
Refine the shared tokens/utilities for a more premium, considered feel without changing the hue
identity: consistent radius, a cleaner shadow scale, a tighter spacing rhythm, better type scale and
line-heights, refined `--ink`/line/muted contrast, nicer focus states (visible, accessible),
`:active`/tap feedback on buttons, and `prefers-reduced-motion` respect for any transitions. Keep the
amber brand as the single accent, used with restraint (don't amber-wash everything).

### 3c. Phone-first details
Safe-area insets (`env(safe-area-inset-*)`) for the bottom-nav and topbar on notched iPhones, >=44px
tap targets everywhere, comfortable thumb reach for primary actions, no hover-only affordances, and
legible minimum font sizes. Make the bottom-nav and mobile topbar feel crisp and branded.

### 3d. Branded moments
- **Login/signup** (`src/Login.jsx`): a polished, on-brand entry screen (Gorilla mark/wordmark,
  confident hero treatment, clear "MoveTrack" identity, the project name). First thing every crew
  member sees.
- **App header / sidebar**: tighten the Gorilla wordmark + "project command center" lockup and the
  project chip so the brand reads clearly.
- **Empty states**: give the friendly empty states (no units yet, no schedule, no overflow, no
  reports) a consistent, warm, on-brand treatment (a small Gorilla touch, clear next action).

## 4. Explicitly NOT in scope

- No new fonts requiring external CDNs (CSP/offline safe). If a font is added it must be
  self-hosted/bundled; otherwise keep Inter/Space Grotesk (already wired).
- No dark-mode theme toggle (out of scope; the app has a fixed light content area + dark sidebar).
- No logic, data, lifecycle, rules, or copy-meaning changes. No `firestore.rules`/`firebase.json`.
- No dependency additions.

## 5. Success criteria

- The five main screens (Dashboard, Containers, Overflow, Schedule, Reports) plus Team, Activity,
  My queue, UnitDetail, Login read as one cohesive, premium, Gorilla-branded product on a phone.
- Nothing regresses: every screen lays out correctly at ~360px and on desktop; build clean; tests
  green.
- The login screen and empty states feel intentional and branded.
- Deploys live and returns HTTP/2 200; ready for Casey to react to on his phone.

## 6. Notes for the reviewer / Casey

Because visual taste is subjective and cannot be verified from code alone, this pass will be put in
front of Casey to react to on-device. The reviewer's job is to confirm **no regressions** (layout,
build, tests, guardrails) rather than to adjudicate aesthetics.
