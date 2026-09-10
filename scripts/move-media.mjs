/* Move specific media records from one unit to another.
 *
 * Liv photographed 902 while 906 was also open, so two items landed on the
 * wrong unit. Authorship and timestamps are real and are preserved exactly:
 * this moves which apartment the record belongs to, and nothing else.
 *
 * Surgical on purpose. arrayRemove/arrayUnion match the whole object, so the
 * arrays are never retyped and nothing else in them can be disturbed.
 *
 * Usage: node scripts/move-media.mjs            (dry run, prints the plan)
 *        node scripts/move-media.mjs --commit
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const COMMIT = process.argv.includes('--commit')

const FROM = 'MPhaggcu4WqZRWCkhGMv'   // unit 906
const TO = 'VgaKl8cw5uSgrEmRdwxH'     // unit 902
const MEDIA_IDS = ['up-1788901954024-0', 'up-1788901997140-0']
const FROM_EVENT = '77oFky4fnHjfssBhWdNV'   // "Unit 906 fully packed"
const TO_EVENT = '8bLT2QRBaDZ7z61wDzy7'     // "Unit 902 fully packed"

initializeApp({ credential: applicationDefault(), projectId: 'movetrack-gorilla' })
const db = getFirestore()

const run = async () => {
  const fromSnap = await db.doc(`units/${FROM}`).get()
  const toSnap = await db.doc(`units/${TO}`).get()
  if (!fromSnap.exists || !toSnap.exists) throw new Error('One of the units is missing.')

  const moving = (fromSnap.data().media || []).filter((m) => MEDIA_IDS.includes(m.id))
  if (moving.length !== MEDIA_IDS.length) {
    throw new Error(`Expected ${MEDIA_IDS.length} items on ${FROM}, found ${moving.length}. Refusing to guess.`)
  }
  const alreadyThere = (toSnap.data().media || []).filter((m) => MEDIA_IDS.includes(m.id))
  if (alreadyThere.length) throw new Error('Already moved. Nothing to do.')

  console.log(`Moving ${moving.length} item(s) from unit ${fromSnap.data().number} to unit ${toSnap.data().number}:`)
  for (const m of moving) console.log(`  ${m.kind.padEnd(5)} ${m.id}  ${m.userName}  ${new Date(m.ts).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}`)

  const fromEvent = await db.doc(`events/${FROM_EVENT}`).get()
  const toEvent = await db.doc(`events/${TO_EVENT}`).get()
  console.log(`\nEvent ${FROM_EVENT}: ${(fromEvent.data()?.media || []).length} media -> ${(fromEvent.data()?.media || []).filter((m) => !MEDIA_IDS.includes(m.id)).length}`)
  console.log(`Event ${TO_EVENT}: ${(toEvent.data()?.media || []).length} media -> ${(toEvent.data()?.media || []).length + moving.length}`)

  if (!COMMIT) { console.log('\nDRY RUN. Re-run with --commit to apply.'); return }

  const batch = db.batch()
  batch.update(db.doc(`units/${FROM}`), { media: FieldValue.arrayRemove(...moving) })
  batch.update(db.doc(`units/${TO}`), { media: FieldValue.arrayUnion(...moving) })

  // The activity feed reads the event's own copy, so it moves too, otherwise
  // 906's timeline keeps showing 902's photos, which is the visible symptom.
  const fromEventMedia = (fromEvent.data()?.media || []).filter((m) => !MEDIA_IDS.includes(m.id))
  batch.update(db.doc(`events/${FROM_EVENT}`), { media: fromEventMedia })
  batch.update(db.doc(`events/${TO_EVENT}`), { media: [...(toEvent.data()?.media || []), ...moving] })

  // The correction is itself a fact, and gets recorded as one.
  batch.set(db.collection('events').doc(), {
    ts: Date.now(), type: 'system', uid: 'm2ztWuQD3zdBLreQ0S4CDs2RmT63', userName: 'Casey P', role: 'admin',
    action: `Moved ${moving.length} packed photo/video from unit ${fromSnap.data().number} to unit ${toSnap.data().number} (taken by Liv Post, wrong unit selected)`,
    unitId: TO,
  })

  await batch.commit()
  console.log('\nDone.')
}

run().catch((e) => { console.error(e.message); process.exit(1) })
