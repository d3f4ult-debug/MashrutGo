/**
 * MashrutGo service worker.
 *
 * - App shell + build assets: cache-first with background refresh (installable, works offline).
 * - API: network-only for anything authenticated or mutating. Only anonymous, public GETs
 *   (routes, stoyankas, place search) are cached, so no personal data (wallet, payments, admin
 *   lists) is ever written to the device cache.
 */
const CACHE_NAME = 'mashrutgo-v2'
const STATIC_ASSETS = ['/', '/index.html', '/manifest.json', '/icons/icon-192.svg', '/icons/icon-512.svg']

/** Public, non-personal API reads that are safe to serve from cache while offline. */
const PUBLIC_API = [/^\/api\/v1\/routes(\/\d+)?$/, /^\/api\/v1\/parkings$/, /^\/api\/v1\/geo\/search$/]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch((err) => console.warn('Pre-cache error:', err))),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  )
  self.clients.claim()
})

function cachePut(request, response) {
  if (!response || response.status !== 200 || response.type === 'opaque') return
  const copy = response.clone()
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  // Never touch mutations (payments, watch updates, GPS) or non-GET requests
  if (request.method !== 'GET') return

  // App shell for SPA navigations
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match('/index.html')) || caches.match('/')))
    return
  }

  if (url.pathname.startsWith('/api/')) {
    const isPublicRead = url.origin === self.location.origin && !request.headers.get('Authorization') && PUBLIC_API.some((r) => r.test(url.pathname))
    if (!isPublicRead) return // authenticated or unknown API call: straight to the network, never cached
    event.respondWith(
      fetch(request)
        .then((response) => {
          cachePut(request, response)
          return response
        })
        .catch(() => caches.match(request)),
    )
    return
  }

  // Build assets, icons and fonts: cache-first, refreshed in the background
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'image' ||
    request.destination === 'font' ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/assets/')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          fetch(request)
            .then((response) => cachePut(request, response))
            .catch(() => undefined)
          return cached
        }
        return fetch(request).then((response) => {
          cachePut(request, response)
          return response
        })
      }),
    )
  }
})
