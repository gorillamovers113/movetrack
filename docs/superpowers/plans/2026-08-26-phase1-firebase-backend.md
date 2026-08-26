# MoveTrack Phase 1 — Real Backend + Accounts (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace MoveTrack's single-browser localStorage with a real Firebase backend so the crew shares one live board from their own phones, with real logins, admin approval, and role-based access — while keeping the existing UI and workflow logic.

**Architecture:** Keep the React 19 + Vite app and its views/reducer semantics. Introduce a Firebase layer: **Auth** (email/password + reset), **Firestore** (live shared state via `onSnapshot`), and role-based **Security Rules**. `store.jsx` keeps its public API (`state`, `dispatch`, `currentUser`, `login`, `logout`) but is re-backed by Firebase: `state` is assembled from Firestore subscriptions, and `dispatch(action)` performs targeted Firestore writes instead of a local reducer. Views are unchanged.

**Tech Stack:** React 19, Vite 8, Firebase JS SDK v10+ (`firebase/app`, `/auth`, `/firestore`, `/storage`), Vitest for unit tests, Firebase Hosting.

## Global Constraints

- **Deadline:** live on phones by **Sept 8, 2026**. Favor working + simple over clever.
- **Roles (exact):** `admin` · `packer` · `mover` · `driver` · `viewer`. Single role per user, admin-changeable.
- **Account states (exact):** `pending` → `active` → `removed`. New signups are `pending` until Casey approves.
- **One-way lifecycle (exact stages):** `not_started → packing → packed → loaded → picked_up → at_warehouse`. No return/unpack.
- **Preserve the public store API** so views don't change: `useStore()` returns `{ state, dispatch, currentUser, login, logout }`; `state = { users, units, containers, events, schedule }`; `dispatch({ type, p })`.
- **Secrets:** Firebase web config is public-by-design but lives in `.env.local` (VITE_ prefixed), never committed. `.env.local` is gitignored.
- **No new UI frameworks.** Keep the existing `ui.jsx` components and CSS.

---

## File structure (created/modified in Phase 1)

- Create `src/firebase.js` — Firebase app init; exports `auth`, `db`, `storage`.
- Create `src/lib/mutations.js` — pure helpers: event-doc builder, box-count mismatch detector (unit-tested).
- Modify `src/store.jsx` — re-back with Firebase: Firestore subscriptions → `state`; `dispatch` → Firestore writes; `login`/`logout` → Firebase Auth; `currentUser` from `users/{uid}` doc.
- Modify `src/Login.jsx` — real signup / login / forgot-password.
- Modify `src/views/Team.jsx` — approve/deny/remove/change-role call the Firebase-backed dispatch (API unchanged, verify wiring).
- Create `firestore.rules`, `storage.rules`, `firebase.json`, `.firebaserc` — hosting + rules config.
- Create `scripts/seed-schedule.mjs` — one-time seed of the schedule + bootstrap admin.
- Create `public/manifest.webmanifest` + service worker registration — installable PWA.
- Create test files under `src/lib/__tests__/`.

---

### Task 1: Firebase project + SDK + config module

**Files:**
- Create: `src/firebase.js`
- Create: `.env.local` (gitignored), `.env.example` (committed, no secrets)
- Modify: `package.json` (add `firebase`), `.gitignore` (ensure `.env.local`)

**Interfaces:**
- Produces: `auth`, `db`, `storage`, `app` exports from `src/firebase.js`.

**Prerequisite (Casey, guided):** create a Firebase project, add a Web App, enable Email/Password auth, create a Firestore database (production mode), enable Storage. Copy the web config into `.env.local`.

- [ ] **Step 1: Install the SDK**
  Run: `npm install firebase`

- [ ] **Step 2: Add env files**
  `.env.local` (real values from Firebase console):
  ```
  VITE_FB_API_KEY=...
  VITE_FB_AUTH_DOMAIN=movetrack-xxxx.firebaseapp.com
  VITE_FB_PROJECT_ID=movetrack-xxxx
  VITE_FB_STORAGE_BUCKET=movetrack-xxxx.appspot.com
  VITE_FB_MSG_SENDER_ID=...
  VITE_FB_APP_ID=...
  ```
  `.env.example`: same keys with empty values. Ensure `.gitignore` contains `.env.local`.

- [ ] **Step 3: Write `src/firebase.js`**
  ```js
  import { initializeApp } from 'firebase/app'
  import { getAuth } from 'firebase/auth'
  import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'
  import { getStorage } from 'firebase/storage'

  const cfg = {
    apiKey: import.meta.env.VITE_FB_API_KEY,
    authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FB_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FB_MSG_SENDER_ID,
    appId: import.meta.env.VITE_FB_APP_ID,
  }
  export const app = initializeApp(cfg)
  export const auth = getAuth(app)
  // Offline persistence so the app keeps working in elevators / weak signal.
  export const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
  export const storage = getStorage(app)
  ```

- [ ] **Step 4: Verify it boots**
  Add a temporary `console.log('fb project', app.options.projectId)` in `main.jsx`, run `npm run dev`, confirm the project id prints with no errors, then remove the log.

- [ ] **Step 5: Commit**
  ```bash
  git add package.json package-lock.json src/firebase.js .env.example .gitignore
  git commit -m "feat(fb): add Firebase SDK + config module with offline persistence"
  ```

---

### Task 2: Pure mutation helpers (unit-tested)

**Files:**
- Create: `src/lib/mutations.js`
- Create: `src/lib/__tests__/mutations.test.js`
- Modify: `package.json` (add `vitest`, `"test": "vitest run"`)

**Interfaces:**
- Produces:
  - `makeEvent({ uid, userName, role }, type, action, extra?) → eventDoc` (no `id`/no write; caller adds to Firestore which assigns id; includes `ts: Date.now()`).
  - `boxMismatch(expected, counted) → boolean` (true when both are numbers and differ).
  - `STAGES` (ordered array) and `nextStage(stage) → string|null`.

- [ ] **Step 1: Write failing tests**
  ```js
  import { describe, it, expect } from 'vitest'
  import { makeEvent, boxMismatch, nextStage } from '../mutations.js'

  describe('boxMismatch', () => {
    it('flags a real mismatch', () => expect(boxMismatch(6, 5)).toBe(true))
    it('passes when equal', () => expect(boxMismatch(6, 6)).toBe(false))
    it('ignores missing counts', () => expect(boxMismatch(null, 5)).toBe(false))
  })
  describe('nextStage', () => {
    it('advances', () => expect(nextStage('packed')).toBe('loaded'))
    it('ends at warehouse', () => expect(nextStage('at_warehouse')).toBe(null))
  })
  describe('makeEvent', () => {
    it('stamps user + action', () => {
      const e = makeEvent({ uid: 'u1', userName: 'Sam', role: 'packer' }, 'stage', 'Started packing', { unitId: 'x' })
      expect(e).toMatchObject({ uid: 'u1', userName: 'Sam', role: 'packer', type: 'stage', action: 'Started packing', unitId: 'x' })
      expect(typeof e.ts).toBe('number')
    })
  })
  ```

- [ ] **Step 2: Run to confirm fail** — `npx vitest run src/lib/__tests__/mutations.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/mutations.js`**
  ```js
  export const STAGES = ['not_started', 'packing', 'packed', 'loaded', 'picked_up', 'at_warehouse']
  export function nextStage(stage) {
    const i = STAGES.indexOf(stage)
    return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null
  }
  export function boxMismatch(expected, counted) {
    return typeof expected === 'number' && typeof counted === 'number' && expected !== counted
  }
  export function makeEvent(user, type, action, extra = {}) {
    return { ts: Date.now(), uid: user.uid, userName: user.userName || user.name || 'Unknown', role: user.role || 'pending', type, action, ...extra }
  }
  ```

- [ ] **Step 4: Run tests** — `npx vitest run` → PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add src/lib/mutations.js src/lib/__tests__/mutations.test.js package.json package-lock.json
  git commit -m "feat(lib): pure mutation helpers (events, stage, box mismatch) + tests"
  ```

---

### Task 3: Auth layer (signup / login / reset / logout + currentUser)

**Files:**
- Modify: `src/store.jsx` (auth portion), `src/Login.jsx`

**Interfaces:**
- Consumes: `auth`, `db` (Task 1); `makeEvent` (Task 2).
- Produces (from `useStore()`): `login(email, password)`, `signup({ name, email, password })`, `resetPassword(email)`, `logout()`, `currentUser` = `users/{uid}` doc (`{ uid, name, email, role, status }`) or `null`.

- [ ] **Step 1: Auth wiring in `store.jsx`**
  Replace the sessionStorage `login(userId)` with Firebase Auth. On `onAuthStateChanged`, subscribe to `doc(db, 'users', uid)` and set `currentUser` from it. `signup` creates the Auth user, then creates `users/{uid}` with `{ uid, name, email, role: null, status: 'pending', createdAt: serverTimestamp() }`. `resetPassword` calls `sendPasswordResetEmail`. `logout` calls `signOut`.
  ```js
  import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, updateProfile } from 'firebase/auth'
  import { doc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore'
  import { auth, db } from './firebase.js'
  // ...inside provider:
  const signup = async ({ name, email, password }) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(cred.user, { displayName: name })
    await setDoc(doc(db, 'users', cred.user.uid), { uid: cred.user.uid, name, email, role: null, status: 'pending', createdAt: serverTimestamp() })
  }
  const login = (email, password) => signInWithEmailAndPassword(auth, email, password)
  const resetPassword = (email) => sendPasswordResetEmail(auth, email)
  const logout = () => signOut(auth)
  ```

- [ ] **Step 2: Update `Login.jsx`** — three modes: Sign in (email+password), Create account (name+email+password → `signup`), Forgot password (email → `resetPassword`, show "check your email"). Surface Firebase error messages (`err.code`) in plain language (e.g. `auth/invalid-credential` → "Email or password is wrong").

- [ ] **Step 3: Manual verification**
  Run `npm run dev`. (a) Create account → appears in Firebase Auth console + a `users` doc with `status:'pending'`; app shows the existing PendingScreen. (b) Log out, log back in. (c) Forgot password → reset email arrives. (d) Wrong password → friendly error.

- [ ] **Step 4: Commit**
  ```bash
  git add src/store.jsx src/Login.jsx
  git commit -m "feat(auth): real Firebase email/password login, signup, password reset"
  ```

---

### Task 4: Firestore live state subscriptions

**Files:**
- Modify: `src/store.jsx` (state portion), `src/seed.js` (repurpose `buildSeed` for a one-time seed script only, not runtime)

**Interfaces:**
- Consumes: `db` (Task 1).
- Produces: `state = { users, units, containers, events, schedule }` assembled from live `onSnapshot` listeners; each is an array of docs (with `id`).

- [ ] **Step 1: Replace `load()`/localStorage with subscriptions**
  On mount, open `onSnapshot(collection(db, 'units'))`, `containers`, `events` (ordered by `ts`), `users`, `schedule`. Store each array in React state; compose into `state`. Remove the localStorage read/write effect.
  ```js
  import { collection, onSnapshot, query, orderBy } from 'firebase/firestore'
  const [units, setUnits] = React.useState([])
  const [containers, setContainers] = React.useState([])
  const [events, setEvents] = React.useState([])
  const [users, setUsers] = React.useState([])
  const [schedule, setSchedule] = React.useState([])
  React.useEffect(() => {
    const subs = [
      onSnapshot(collection(db, 'units'), s => setUnits(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'containers'), s => setContainers(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, 'events'), orderBy('ts', 'desc')), s => setEvents(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'users'), s => setUsers(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'schedule'), s => setSchedule(s.docs.map(d => ({ id: d.id, ...d.data() })))),
    ]
    return () => subs.forEach(u => u())
  }, [])
  const state = { units, containers, events, users, schedule }
  ```

- [ ] **Step 2: Manual verification**
  With the app open + logged in, add a `units` doc in the Firestore console (`{ number:'901', lastName:'Test', floor:9, stage:'not_started' }`). It appears live in the Dashboard within a second. Open a second browser → same board.

- [ ] **Step 3: Commit**
  ```bash
  git add src/store.jsx
  git commit -m "feat(data): live Firestore subscriptions replace localStorage state"
  ```

---

### Task 5: `dispatch` → Firestore writes (port the reducer actions)

**Files:**
- Modify: `src/store.jsx` (dispatch), `src/lib/mutations.js` (add write helpers if useful)

**Interfaces:**
- Consumes: `db`, `currentUser`, `makeEvent`, `boxMismatch` (Tasks 1–2).
- Produces: `dispatch({ type, p })` async; supports the Phase-1 action set: `startPacking`, `finishPacking`, `loadUnit`, `containerMove` (moves `pickup`/`checkin` only, per one-way lifecycle), `editUnit`, `addMedia`, `addNote`, `resolveFlag`, `resolveContainerFlag`. (Registration/approval actions handled in Task 6.)

- [ ] **Step 1: Implement `dispatch` as targeted writes**
  Each action does the specific `updateDoc`/`addDoc`, mirroring the current reducer's logic, and always writes an `event` via `addDoc(collection(db,'events'), makeEvent(...))`. Box-count mismatch at `loadUnit` and container `checkin` sets a `flag` on the doc AND writes a `flag` event. Example:
  ```js
  import { doc, updateDoc, addDoc, arrayUnion, collection } from 'firebase/firestore'
  const ev = (type, action, extra) => addDoc(collection(db, 'events'), makeEvent(actor(), type, action, extra))
  const actor = () => ({ uid: currentUser.uid, userName: currentUser.name, role: currentUser.role })

  async function dispatch({ type, p }) {
    const unit = state.units.find(u => u.id === p.unitId)
    switch (type) {
      case 'startPacking':
        await updateDoc(doc(db,'units',p.unitId), { stage:'packing', 'crew.packers': arrayUnion(currentUser.uid), 'times.packStart': Date.now() })
        return ev('stage', `Started packing unit ${unit.number}`, { unitId: p.unitId, to:'packing' })
      case 'finishPacking':
        await updateDoc(doc(db,'units',p.unitId), { stage:'packed', boxCount:p.boxCount, 'times.packEnd': Date.now() })
        return ev('stage', `Finished packing unit ${unit.number} — ${p.boxCount} boxes sealed`, { unitId:p.unitId, to:'packed' })
      case 'loadUnit': { /* find/create container, verify box count, set flag on mismatch, unit→loaded */ }
      // ...remaining cases mirror src/store.jsx reducer, writing to Firestore
    }
  }
  ```
  Port each remaining case from the existing reducer in `store.jsx` (they already encode the correct behavior — reuse the message strings and mismatch logic).

- [ ] **Step 2: Manual verification (the core loop)**
  In two browser windows logged in as an admin: create a unit (console or a quick admin add), Start packing → Finish packing (enter box count) → Load into container "BB-01" with a WRONG box count → confirm a red flag appears and an event logs; pick the container up. Both windows stay in sync; the Activity view shows every step with the actor's name.

- [ ] **Step 3: Commit**
  ```bash
  git add src/store.jsx src/lib/mutations.js
  git commit -m "feat(data): dispatch performs Firestore writes + event log + mismatch flags"
  ```

---

### Task 6: Admin user management (approve / deny / remove / change role)

**Files:**
- Modify: `src/store.jsx` (admin actions), `src/views/Team.jsx` (verify wiring)

**Interfaces:**
- Produces (via `dispatch`): `approveUser({ userId, role })`, `denyUser({ userId })`, `changeRole({ userId, role })`, `removeUser({ userId })`.

- [ ] **Step 1: Implement admin actions**
  ```js
  case 'approveUser': await updateDoc(doc(db,'users',p.userId), { status:'active', role:p.role }); return ev('system', `Approved ${name} as ${p.role}`)
  case 'changeRole':  await updateDoc(doc(db,'users',p.userId), { role:p.role });                return ev('system', `Changed ${name}'s role to ${p.role}`)
  case 'removeUser':  await updateDoc(doc(db,'users',p.userId), { status:'removed', role:null }); return ev('system', `Removed ${name}'s access`)
  case 'denyUser':    await updateDoc(doc(db,'users',p.userId), { status:'removed' });            return ev('system', `Denied ${name}'s request`)
  ```
  (Note: fully deleting the Auth user requires Admin SDK; `status:'removed'` + rules blocking removed users is the Phase-1 approach — access is revoked immediately.)

- [ ] **Step 2: Confirm Team.jsx uses these** — it already calls `approveUser`/`denyUser`/`changeRole`; add a Remove button that dispatches `removeUser`. Verify the pending-count badge and role dropdown work against Firestore.

- [ ] **Step 3: Manual verification**
  As admin, approve a pending user and assign `packer`; the user's app flips from PendingScreen to the packer queue live. Change them to `mover`; their nav updates. Remove them; they lose board access on next load.

- [ ] **Step 4: Commit**
  ```bash
  git add src/store.jsx src/views/Team.jsx
  git commit -m "feat(admin): approve/deny/remove/change-role wired to Firestore"
  ```

---

### Task 7: Security rules (Firestore + Storage)

**Files:**
- Create: `firestore.rules`, `storage.rules`

**Interfaces:** none (enforcement layer).

- [ ] **Step 1: Write `firestore.rules`**
  Helpers: `isSignedIn()`, `me()` = `get(/databases/$(database)/documents/users/$(request.auth.uid)).data`, `isActive()` = `me().status == 'active'`, `hasRole(r)` = `isActive() && me().role == r`, `isAdmin()` = `hasRole('admin')`.
  - `users/{uid}`: a user may `create` their own doc only with `status=='pending'` and `role==null`; may `read` their own doc; `admin` may read/write any. Non-admins cannot change their own `role`/`status`.
  - `units`, `containers`, `events`, `schedule`: `read` if `isActive()`. `write` if `isAdmin()` OR (`hasRole('packer'|'mover'|'driver')` for the specific fields their workflow owns). `schedule` write: `isAdmin()` only. `viewer`: read only (no write anywhere).
  Copy exact stage/role gating from `canAct`/`containerAction` in `store.jsx`.

- [ ] **Step 2: Write `storage.rules`** — read/write only for `isActive()` users; enforce content-type image/video and a size cap (e.g. 15 MB) on writes.

- [ ] **Step 3: Verify with the emulator (or manual)**
  Preferred: `firebase emulators:start` + a rules test that a `viewer` write is denied and a `pending` read of `units` is denied. Manual fallback: log in as a viewer account, confirm no action buttons appear and a console write attempt is rejected.

- [ ] **Step 4: Commit**
  ```bash
  git add firestore.rules storage.rules
  git commit -m "feat(security): role-based Firestore + Storage rules"
  ```

---

### Task 8: Seed schedule + bootstrap admin, then deploy (Hosting + PWA)

**Files:**
- Create: `scripts/seed-schedule.mjs`, `firebase.json`, `.firebaserc`, `public/manifest.webmanifest`
- Modify: `index.html` (manifest link + theme), `src/main.jsx` (SW registration)

**Interfaces:** none.

- [ ] **Step 1: Seed script** — `scripts/seed-schedule.mjs` writes the 27 schedule days from the spec (§10) into `schedule`, and sets Casey's `users/{uid}` to `{ role:'admin', status:'active' }` (run after Casey signs up once). Use the Firebase Admin SDK with a service-account key kept out of git, OR do it from the Firestore console. Document the exact steps in the script's header comment.

- [ ] **Step 2: `firebase.json` + `.firebaserc`** — hosting serves `dist/`, rewrites all routes to `/index.html` (SPA), and wires `firestore.rules` + `storage.rules`.

- [ ] **Step 3: PWA** — `public/manifest.webmanifest` (name "MoveTrack", icons from `public/`, `display: standalone`, theme color), linked in `index.html`; register a minimal service worker in `main.jsx` for installability. (Offline data is already handled by Firestore persistence from Task 1.)

- [ ] **Step 4: Build + deploy**
  Run: `npm run build && npx firebase deploy` → confirm the live URL loads, install-to-home-screen works on a phone, and a second device sees the same live board.

- [ ] **Step 5: Manual verification (end-to-end on two phones)**
  Casey (admin) + one tester each open the live URL on their phones, sign up, Casey approves the tester as a packer, the tester creates + packs a unit, Casey sees it live and the Activity log names the tester. Airplane-mode the tester mid-pack → the app keeps working and syncs when back online.

- [ ] **Step 6: Commit**
  ```bash
  git add firebase.json .firebaserc public/manifest.webmanifest index.html src/main.jsx scripts/seed-schedule.mjs
  git commit -m "feat(deploy): Firebase Hosting + PWA manifest + schedule seed"
  ```

---

## Self-Review (against the spec)

- **Multi-user shared board** — Tasks 3–5 (subscriptions + Firestore dispatch). ✓
- **Secure login + reset + approval + role change + remove** — Tasks 3, 6. ✓
- **Roles + one-way lifecycle** — Global Constraints + Task 5 (`STAGES`). ✓
- **Security enforced server-side** — Task 7. ✓
- **Schedule seeded, admin-editable** — Task 8 seed (editing UI is Phase 2). ✓
- **Offline-tolerant + installable** — Tasks 1, 8. ✓
- **Deferred to Phase 2/3 (intentionally):** BigBox rebrand, packer-creates-unit UI, written inventory, materials, richer time capture, viewer polish, metrics/reports, Google Sheet backup. Phase 1 delivers the existing workflows on the real backend — a working multi-user app.

**Placeholder scan:** none — every step has concrete code or an explicit action + verification.
