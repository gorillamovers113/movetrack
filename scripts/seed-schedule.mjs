#!/usr/bin/env node
// MoveTrack — schedule seed + admin bootstrap.
//
// Writes the 27 scheduled days for the Trinity Manor relocation (spec §10,
// docs/superpowers/specs/2026-08-26-movetrack-relocation-system-design.md)
// into the `schedule` collection, and can promote one existing `users/{uid}`
// doc to `{ role: 'admin', status: 'active' }` so the first admin can log in
// and start approving the rest of the crew.
//
// This uses the Firebase Admin SDK, which bypasses Firestore security rules —
// that's the whole point (there's no signed-in admin yet on day one). It is
// NOT run automatically as part of deploy; it needs a service-account key
// that must never be committed to git.
//
// ── HOW TO RUN THIS (one-time, by whoever has console access) ─────────────
//
// 1. Generate a service-account key:
//      Firebase console → movetrack-gorilla → Project settings (gear icon)
//      → Service accounts tab → "Generate new private key" → confirm.
//      This downloads a JSON file (e.g. movetrack-gorilla-firebase-adminsdk-xxxxx.json).
//      Save it somewhere OUTSIDE this repo (e.g. ~/secrets/) — never inside
//      the movetrack/ working tree, so it can't be accidentally committed.
//
// 2. Install the one extra dependency this script needs (already declared in
//    package.json devDependencies, so a normal install picks it up):
//      npm install
//
// 3. Seed the schedule collection only:
//      GOOGLE_APPLICATION_CREDENTIALS=~/secrets/movetrack-gorilla-firebase-adminsdk-xxxxx.json \
//        node scripts/seed-schedule.mjs
//
// 4. Bootstrap the first admin — AFTER that person has signed up once through
//    the app's normal signup flow (so their `users/{uid}` doc already exists
//    in the pending state). Find their uid in the Firebase console under
//    Authentication → Users (or Firestore → users collection), then run:
//      GOOGLE_APPLICATION_CREDENTIALS=~/secrets/movetrack-gorilla-firebase-adminsdk-xxxxx.json \
//        node scripts/seed-schedule.mjs --admin-uid=THEIR_UID_HERE
//
//    You can do both in one run:
//      GOOGLE_APPLICATION_CREDENTIALS=~/secrets/movetrack-gorilla-firebase-adminsdk-xxxxx.json \
//        node scripts/seed-schedule.mjs --admin-uid=THEIR_UID_HERE
//
// Re-running the schedule seed is safe — days are written with deterministic
// doc IDs (`YYYY-MM-DD`), so it's an idempotent upsert, not an append.
//
// Alternative (no script at all): both of these can be done by hand in the
// Firebase console's Firestore data tab — create a `schedule` collection with
// one doc per row from spec §10, or edit a `users/{uid}` doc's `role` and
// `status` fields directly. This script just makes it repeatable/scriptable.
// ────────────────────────────────────────────────────────────────────────

import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { DEFAULT_SCHEDULE as SCHEDULE } from '../src/lib/schedule.js'

const PROJECT_ID = 'movetrack-gorilla'

// 27 scheduled days, Sep 8 -> Oct 8 2026, floor 9 down to floor 1.
// Source: spec §10 ("Schedule seed data (from Casey's calendar, Sept-Oct 2026)").
// Pattern per floor: PACK, PACK, MOVEOUT, then the next floor down.
// Canonical copy now lives in src/lib/schedule.js (DEFAULT_SCHEDULE) so the
// in-app admin "Load the plan" action and this key-based fallback script
// can never drift apart.

function parseArgs(argv) {
  const out = {}
  for (const arg of argv) {
    const m = /^--admin-uid=(.+)$/.exec(arg)
    if (m) out.adminUid = m[1]
  }
  return out
}

function initAdminApp() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (!keyPath) {
    console.error(
      'Missing GOOGLE_APPLICATION_CREDENTIALS.\n' +
        'Run this script as:\n' +
        '  GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node scripts/seed-schedule.mjs\n' +
        'See the header comment in this file for how to generate that key.'
    )
    process.exit(1)
  }
  try {
    // Fail fast with a clear message if the path is wrong, rather than letting
    // applicationDefault() surface an opaque ADC error.
    JSON.parse(readFileSync(keyPath, 'utf8'))
  } catch (err) {
    console.error(`Could not read/parse service account key at ${keyPath}: ${err.message}`)
    process.exit(1)
  }
  return initializeApp({
    credential: cert(keyPath),
    projectId: PROJECT_ID,
  })
}

async function seedSchedule(db) {
  const batch = db.batch()
  for (const day of SCHEDULE) {
    const ref = db.collection('schedule').doc(day.date)
    batch.set(ref, day, { merge: true })
  }
  await batch.commit()
  console.log(`Seeded ${SCHEDULE.length} schedule days into 'schedule' (Sep 8 - Oct 8, 2026).`)
}

async function bootstrapAdmin(db, uid) {
  const ref = db.collection('users').doc(uid)
  const snap = await ref.get()
  if (!snap.exists) {
    console.error(
      `No users/${uid} doc found. That person must sign up in the app first ` +
        `(which creates their pending user doc) before you can promote them here.`
    )
    process.exit(1)
  }
  await ref.set({ role: 'admin', status: 'active' }, { merge: true })
  const after = (await ref.get()).data()
  console.log(`Promoted users/${uid} to admin:`, { name: after.name, email: after.email, role: after.role, status: after.status })
}

async function main() {
  const { adminUid } = parseArgs(process.argv.slice(2))
  const app = initAdminApp()
  const db = getFirestore(app)

  await seedSchedule(db)
  if (adminUid) {
    await bootstrapAdmin(db, adminUid)
  } else {
    console.log('No --admin-uid passed, skipping admin bootstrap. See header comment for usage.')
  }
}

main().catch((err) => {
  console.error('Seed script failed:', err)
  process.exit(1)
})
