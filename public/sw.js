// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// Service Worker for Nephtys PWA
// Version: 7.1.0 - Minimal SW for maximum stability (WhatsApp-style)

const CACHE_NAME = 'nephtys-app-v7';
const STATIC_CACHE = 'nephtys-static-v7';

// Static assets to cache immediately (shell)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg'
];

// Install event - cache static assets
globalThis.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => globalThis.skipWaiting())
      .catch(() => globalThis.skipWaiting())
  );
});

// Activate event - clean old caches
globalThis.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== STATIC_CACHE) {
            return caches.delete(cacheName);
          }
          return Promise.resolve();
        })
      );
    }).then(() => globalThis.clients.claim())
  );
});

// Helper: Check if request is for Supabase API
function isSupabaseRequest(url) {
  return url.hostname.includes('supabase');
}

// Helper: Check if request is for media
function isMediaRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname.toLowerCase();
  const mediaExtensions = /\.(png|jpg|jpeg|gif|svg|webp|avif|ico|woff|woff2|ttf|eot|otf|mp3|mp4|webm|ogg|wav|pdf)$/;
  return mediaExtensions.test(pathname) ||
         pathname.includes('/storage/') ||
         url.hostname.includes('storage') ||
         url.hostname.includes('cdn');
}

// Fetch event - MINIMAL strategy (WhatsApp-style)
globalThis.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // WHATSAPP-LEVEL STABILITY: Don't intercept Supabase requests at all
  // Let them go directly to network for realtime performance
  if (isSupabaseRequest(url)) {
    return;
  }

  // Skip cross-origin requests (except media CDNs)
  if (url.origin !== globalThis.location.origin && !isMediaRequest(request)) {
    return;
  }

  // Media requests - simple cache-first
  if (isMediaRequest(request)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Navigation requests - network-first with cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        return caches.match('/index.html');
      })
    );
    return;
  }

  // Static assets - cache-first
  if (url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Default: network-first
  event.respondWith(
    fetch(request).then((response) => {
      return response;
    }).catch(() => {
      return caches.match(request);
    })
  );
});

// Push notification event
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

// Notification click event
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

// Message event - minimal handlers
globalThis.addEventListener('message', (event) => {
  if (!event.data || !event.data.type) return;

  if (event.data.type === 'SKIP_WAITING') {
    globalThis.skipWaiting();
  }
});
