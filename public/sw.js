// MoveTrack service worker — installability only.
//
// This worker intentionally does NOT implement a fetch handler or any caching
// strategy. Its only job is to satisfy the "installable PWA" criteria (a
// registered, active service worker + a linked web manifest) so the app can be
// added to a phone's home screen and launched in standalone mode.
//
// Offline DATA handling is already covered by Firestore's persistent local
// cache (see src/firebase.js, persistentLocalCache + persistentMultipleTabManager
// from Task 1) — that's what lets the app keep working with spotty in-building
// signal and sync when back online. Adding app-shell caching here on top of
// that would only add risk (stale bundles, intercepted Firestore/Auth network
// calls) for no real benefit at this stage, so we keep it deliberately a no-op.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
