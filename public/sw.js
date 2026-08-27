// MoveTrack service worker: installability plus a minimal app-shell cache.
//
// Goal: an installed PWA relaunched with zero signal (crew walks into a
// dead-zone stairwell, opens it from the home screen) still boots to a
// usable shell instead of a blank/error screen.
//
// This stays deliberately narrow:
//   - Navigations (loading index.html) are network-first, falling back to
//     the cached shell only when the network request fails outright.
//   - Same-origin static assets (hashed JS/CSS in /assets/*, icons, the
//     manifest) are stale-while-revalidate: answer from cache instantly if
//     we have it, refresh the cache in the background either way.
//   - Everything cross-origin (Firebase Auth, Firestore, Storage, the
//     googleapis.com family, Google Fonts) is left completely untouched.
//     Those already have their own offline/retry behavior (Firestore's
//     persistent local cache in particular, see src/firebase.js) and
//     intercepting them here would only risk stale or broken data.
//
// CACHE_NAME is versioned so activate can clean up the previous cache
// instead of it lingering forever. Bump it whenever this file's caching
// behavior changes.

const CACHE_NAME = 'movetrack-shell-v1'
const APP_SHELL = ['/', '/index.html']
const STATIC_ASSET_RE = /\.(js|css|png|jpg|jpeg|svg|webp|ico|woff2?)$/

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {
      // Precaching the shell is a nice-to-have, not a hard requirement:
      // don't let a failed addAll (offline first install, dev server, etc)
      // block the worker from installing.
    })
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Cross-origin (Firebase Auth/Firestore/Storage, googleapis.com, Google
  // Fonts, etc) is never same-origin with the app, so this one check keeps
  // all of it out of the service worker without an explicit denylist.
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    )
    return
  }

  if (url.pathname.startsWith('/assets/') || STATIC_ASSET_RE.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request)
        const networked = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone())
            return res
          })
          .catch(() => cached)
        return cached || networked
      })
    )
  }
})
