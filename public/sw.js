// Service Worker for Nephtys PWA
// Version: 5.0.0 - CRITICAL FIX: Don't intercept Supabase requests

const CACHE_NAME = 'nephtys-app-v5';
const STATIC_CACHE = 'nephtys-static-v5';
const DYNAMIC_CACHE = 'nephtys-dynamic-v5';

// Static assets to cache immediately (shell)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg'
];

// Network timeout in milliseconds - REDUCED for faster fallback
const NETWORK_TIMEOUT = 2000; // 2 seconds for normal requests
const SUPABASE_TIMEOUT = 5000; // 5 seconds for Supabase (reduced from 10)

// Track if we should bypass cache (after app returns from background)
let bypassCache = false;
let lastActiveTime = Date.now();

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Static assets cached, skipping waiting');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Failed to cache static assets:', error);
        // Don't fail installation if caching fails
        return self.skipWaiting();
      })
  );
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    Promise.all([
      // Clean old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE && cacheName !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Take control of all clients immediately
      self.clients.claim()
    ])
  );
});

// Helper: Fetch with timeout
function fetchWithTimeout(request, timeout = NETWORK_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Network request timed out'));
    }, timeout);

    fetch(request)
      .then((response) => {
        clearTimeout(timeoutId);
        resolve(response);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

// Helper: Stale-while-revalidate strategy
async function staleWhileRevalidate(request, cacheName = DYNAMIC_CACHE) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  // Start network fetch in background
  const networkFetch = fetchWithTimeout(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch((error) => {
      console.log('[SW] Network fetch failed:', error.message);
      return null;
    });

  // Return cached response immediately if available, otherwise wait for network
  if (cachedResponse) {
    console.log('[SW] Returning cached response for:', request.url);
    return cachedResponse;
  }

  console.log('[SW] No cache, waiting for network:', request.url);
  const networkResponse = await networkFetch;
  if (networkResponse) {
    return networkResponse;
  }

  // Return offline fallback for navigation requests
  if (request.mode === 'navigate') {
    return caches.match('/index.html');
  }

  return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

// Helper: Network-first with cache fallback
async function networkFirst(request, cacheName = DYNAMIC_CACHE) {
  try {
    const response = await fetchWithTimeout(request);
    if (response && response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline fallback for navigation requests
    if (request.mode === 'navigate') {
      return caches.match('/index.html');
    }
    
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// Helper: Cache-first for static assets
async function cacheFirst(request, cacheName = STATIC_CACHE) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const response = await fetchWithTimeout(request);
    if (response && response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('[SW] Cache-first failed for:', request.url);
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// Fetch event - smart caching strategy optimized for PWA
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests - let them go directly to network
  if (request.method !== 'GET') {
    return;
  }

  // CRITICAL: NEVER intercept Supabase requests
  // Let them go directly to the network without any Service Worker involvement
  // This prevents the SW from blocking/delaying database requests after background
  if (url.hostname.includes('supabase')) {
    // Don't call event.respondWith() - this lets the request bypass the SW completely
    console.log('[SW] Bypassing Supabase request:', url.pathname);
    return;
  }

  // Skip other cross-origin requests
  if (url.origin !== location.origin) {
    return;
  }

  // Navigation requests - network-first for PWA to ensure fresh content
  // This is important when app returns from background
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstFast(request, STATIC_CACHE));
    return;
  }

  // Static assets (JS, CSS, images) - cache-first (these don't change often)
  if (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/) ||
    url.pathname.startsWith('/assets/')
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // API calls and other requests - network-first
  event.respondWith(networkFirst(request, DYNAMIC_CACHE));
});

// Helper: Fetch with AbortController for better timeout handling
async function fetchWithAbort(request, timeout) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  }
}

// Helper: Network-first with very fast fallback for navigation
async function networkFirstFast(request, cacheName = STATIC_CACHE) {
  // Try network first with short timeout
  try {
    const response = await fetchWithAbort(request, 1500); // 1.5 seconds for navigation
    if (response && response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('[SW] Network failed for navigation, using cache:', error.message);
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    // Return index.html for SPA routing
    return caches.match('/index.html');
  }
}

// Push notification event
self.addEventListener('push', (event) => {
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
      {
        action: 'open',
        title: 'Ouvrir',
      },
      {
        action: 'close',
        title: 'Fermer',
      },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          // Focus existing window if available
          for (const client of clientList) {
            if (client.url.includes(self.location.origin) && 'focus' in client) {
              return client.focus();
            }
          }
          // Open new window
          return clients.openWindow(event.notification.data.url || '/');
        })
    );
  }
});

// Background sync event (for offline messages)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncMessages());
  }
});

async function syncMessages() {
  console.log('[SW] Syncing offline messages...');
  
  try {
    const cache = await caches.open('offline-messages');
    const requests = await cache.keys();
    
    for (const request of requests) {
      const response = await cache.match(request);
      if (response) {
        const data = await response.json();
        try {
          await fetchWithTimeout(new Request('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          }), 10000);
          await cache.delete(request);
        } catch (error) {
          console.error('[SW] Failed to sync message:', error);
        }
      }
    }
  } catch (error) {
    console.error('[SW] Error syncing messages:', error);
  }
}

// Message event - for communication with the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      })
    );
  }
  
  // Handle app visibility change - when app returns from background
  if (event.data && event.data.type === 'APP_RESUMED') {
    console.log('[SW] App resumed from background, clearing dynamic cache');
    // Clear dynamic cache to force fresh data
    caches.open(DYNAMIC_CACHE).then((cache) => {
      cache.keys().then((keys) => {
        keys.forEach((key) => cache.delete(key));
      });
    });
    bypassCache = true;
    // Reset bypass flag after 5 seconds
    setTimeout(() => {
      bypassCache = false;
    }, 5000);
  }
  
  // Handle keepalive ping from app
  if (event.data && event.data.type === 'KEEPALIVE') {
    lastActiveTime = Date.now();
  }
});

// Periodic check for stale connections (every 30 seconds)
setInterval(() => {
  const now = Date.now();
  const timeSinceActive = now - lastActiveTime;
  
  // If no activity for more than 60 seconds, prepare for reconnection
  if (timeSinceActive > 60000) {
    console.log('[SW] No activity detected, preparing for reconnection');
    bypassCache = true;
  }
}, 30000);

console.log('[SW] Service worker loaded - v5.0.0 (Supabase bypass)');