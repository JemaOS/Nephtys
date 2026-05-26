// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// Service Worker for Nephtys PWA
// Version: 8.0.0 - Network-only for app shell. Cache only media (offline).
// Avoids stale JS/HTML on deploys. App is always fresh from network.

const MEDIA_CACHE = 'nephtys-media-v8';

// Install: take over immediately
globalThis.addEventListener('install', () => {
  globalThis.skipWaiting();
});

// Activate: claim all clients and purge all old app/static caches.
// We only keep the media cache.
globalThis.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((cacheName) =>
            cacheName === MEDIA_CACHE
              ? Promise.resolve()
              : caches.delete(cacheName)
          )
        )
      )
      .then(() => globalThis.clients.claim())
  );
});

// Helper: Supabase API/realtime — never intercept
function isSupabaseRequest(url) {
  return url.hostname.includes('supabase');
}

// Helper: media request (images, video, audio, fonts, pdf)
function isMediaRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname.toLowerCase();
  const mediaExtensions = /\.(png|jpg|jpeg|gif|svg|webp|avif|ico|woff|woff2|ttf|eot|otf|mp3|mp4|webm|ogg|wav|pdf)$/;
  return mediaExtensions.test(pathname) ||
         pathname.includes('/storage/') ||
         url.hostname.includes('storage') ||
         url.hostname.includes('cdn');
}

// Fetch: only intercept media for offline cache. Everything else goes to
// network so deploys are always picked up.
globalThis.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (isSupabaseRequest(url)) return;

  // Cross-origin non-media → don't touch
  if (url.origin !== globalThis.location.origin && !isMediaRequest(request)) {
    return;
  }

  // Media: cache-first for offline support
  if (isMediaRequest(request)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok && response.status !== 206) {
            const clone = response.clone();
            caches.open(MEDIA_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Everything else (HTML, JS, CSS, app shell) → network-only.
  // No respondWith → browser handles it directly. Always fresh on deploy.
});

// Push notifications
globalThis.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const title = data.title || 'Nouveau message';
  const options = {
    body: data.body || 'Vous avez reçu un nouveau message',
    icon: data.icon || '/icon.svg',
    badge: '/icon.svg',
    tag: data.tag || 'message',
    data: data.data || {},
    vibrate: [200, 100, 200],
    requireInteraction: false,
    actions: [
      { action: 'open', title: 'Ouvrir' },
      { action: 'close', title: 'Fermer' },
    ],
  };
  event.waitUntil(globalThis.registration.showNotification(title, options));
});

globalThis.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          for (const client of clientList) {
            if (client.url.includes(globalThis.location.origin) && 'focus' in client) {
              return client.focus();
            }
          }
          return clients.openWindow(event.notification.data.url || '/');
        })
    );
  }
});

globalThis.addEventListener('message', (event) => {
  if (!event.data || !event.data.type) return;
  if (event.data.type === 'SKIP_WAITING') {
    globalThis.skipWaiting();
  }
});
