// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// Service Worker for Nephtys PWA
// Version: 8.1.0 - Network-only for app shell. Cache only media (offline).
// Avoids stale JS/HTML on deploys. App is always fresh from network.
// Immediate takeover: skipWaiting() on install + clients.claim() on activate,
// so a new deploy's SW takes control right away; the page then reloads once
// via the 'controllerchange' handler in main.tsx (guarded against loops).

const MEDIA_CACHE = 'nephtys-media-v8';

// Bornes du cache média : on ne laisse pas le cache grandir sans limite ni
// conserver des entrées périmées indéfiniment (éviction).
const MEDIA_MAX_ENTRIES = 80;
const MEDIA_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 jours

// Évince d'abord les entrées trop anciennes (via l'en-tête Date de la
// réponse), puis applique une limite de nombre d'entrées (FIFO par ordre
// d'insertion). Best-effort : ne doit jamais faire échouer le fetch.
async function trimMediaCache() {
  try {
    const cache = await caches.open(MEDIA_CACHE);
    const now = Date.now();
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      if (!response) continue;
      const dateHeader = response.headers.get('date');
      const storedAt = dateHeader ? Date.parse(dateHeader) : NaN;
      if (!Number.isNaN(storedAt) && now - storedAt > MEDIA_MAX_AGE_MS) {
        await cache.delete(request);
      }
    }
    let keys = await cache.keys();
    while (keys.length > MEDIA_MAX_ENTRIES) {
      await cache.delete(keys[0]);
      keys = await cache.keys();
    }
  } catch {
    /* cache indisponible — best-effort */
  }
}

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
      .then(() => trimMediaCache())
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
    // On ne met en cache QUE les médias de même origine : évite qu'un hôte
    // tiers (nom contenant "cdn"/"storage") empoisonne le cache durablement.
    const cacheable = url.origin === globalThis.location.origin;
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (cacheable && response.ok && response.status !== 206) {
            const clone = response.clone();
            caches.open(MEDIA_CACHE)
              .then((cache) => cache.put(request, clone))
              .then(() => trimMediaCache())
              .catch(() => { /* best-effort */ });
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
    icon: data.icon || '/icon-192x192.png',
    badge: '/icon-192x192.png',
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
          // N'ouvre QUE des URLs de même origine (le payload de notification
          // peut être contrôlé → éviter un open-redirect / phishing).
          let target = '/';
          try {
            const candidate = new URL(event.notification.data?.url || '/', globalThis.location.origin);
            if (candidate.origin === globalThis.location.origin) {
              target = candidate.pathname + candidate.search + candidate.hash;
            }
          } catch {
            target = '/';
          }
          return clients.openWindow(target);
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
