// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// Service Worker for Nephtys PWA
// Version: 7.0.0 - Optimized caching for offline + performance

const CACHE_NAME = 'nephtys-app-v7';
const STATIC_CACHE = 'nephtys-static-v7';
const DYNAMIC_CACHE = 'nephtys-dynamic-v7';
const SUPABASE_CACHE = 'nephtys-supabase-v7';
const MEDIA_CACHE = 'nephtys-media-v7';

// Static assets to cache immediately (shell)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg'
];

// Network timeout in milliseconds
const NETWORK_TIMEOUT = 3000; // 3 seconds for normal requests
const SUPABASE_TIMEOUT = 8000; // 8 seconds for Supabase (gives time for fresh data)
const MEDIA_TIMEOUT = 5000; // 5 seconds for media

// Cache expiration times (in milliseconds)
const SUPABASE_CACHE_MAX_AGE = 5 * 60 * 1000; // 5 minutes for Supabase data
const MEDIA_CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours for media
const STATIC_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days for static assets

// Track if we should bypass cache (after app returns from background)
let bypassCache = false;
let lastActiveTime = Date.now();

// Install event - cache static assets
globalThis.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker v7...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Static assets cached, skipping waiting');
        return globalThis.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Failed to cache static assets:', error);
        // Don't fail installation if caching fails
        return globalThis.skipWaiting();
      })
  );
});

// Activate event - clean old caches
globalThis.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker v7...');
  event.waitUntil(
    Promise.all([
      // Clean old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== STATIC_CACHE && cacheName !== DYNAMIC_CACHE && 
                cacheName !== CACHE_NAME && cacheName !== SUPABASE_CACHE && 
                cacheName !== MEDIA_CACHE) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
            return Promise.resolve();
          })
        );
      }),
      // Take control of all clients immediately
      globalThis.clients.claim()
    ])
  );
});

// Helper: Check if cache is expired
function isCacheExpired(cachedResponse) {
  if (!cachedResponse) return true;
  
  const dateHeader = cachedResponse.headers.get('date');
  if (!dateHeader) return true;
  
  const cachedTime = new Date(dateHeader).getTime();
  const now = Date.now();
  return (now - cachedTime) > SUPABASE_CACHE_MAX_AGE;
}

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

// Helper: Stale-while-revalidate strategy
async function staleWhileRevalidate(request, cacheName = DYNAMIC_CACHE, timeout = NETWORK_TIMEOUT) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  
  // Start network fetch in background
  const networkFetch = fetchWithTimeout(request, timeout)
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
    // Also update cache in background - don't await, fire and forget
    networkFetch.catch(() => {});
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
async function networkFirst(request, cacheName = DYNAMIC_CACHE, timeout = NETWORK_TIMEOUT) {
  try {
    const response = await fetchWithTimeout(request, timeout);
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

// Helper: Network-first specifically for Supabase
// Let Supabase requests go directly to network - no caching needed for realtime data
async function networkFirstSupabase(request) {
  try {
    const response = await fetchWithTimeout(request, SUPABASE_TIMEOUT);
    return response;
  } catch (error) {
    console.log('[SW] Supabase network failed:', request.url);
    
    // Try cache as fallback
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('[SW] Returning cached Supabase response:', request.url);
      return cachedResponse;
    }
    
    // Return empty array so Supabase client doesn't crash
    return new Response(
      JSON.stringify([]),
      { 
        status: 200, 
        statusText: 'OK', 
        headers: { 'Content-Type': 'application/json' } 
      }
    );
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

// Helper: Determine if request is for Supabase API
function isSupabaseRequest(url) {
  return url.hostname.includes('supabase');
}

// Helper: Determine if request is for media (images, files, avatars)
function isMediaRequest(request) {
  const url = new URL(request.url);
  const pathname = url.pathname.toLowerCase();
  
  // Check for media file extensions
  const mediaExtensions = /\.(png|jpg|jpeg|gif|svg|webp|avif|ico|woff|woff2|ttf|eot|otf|mp3|mp4|webm|ogg|wav|pdf|doc|docx|xls|xlsx|zip|rar)$/;
  
  // Check for common media/storage paths
  const mediaPaths = [
    '/storage/',
    '/avatars/',
    '/files/',
    '/media/',
    '/attachments/',
    '/uploads/'
  ];
  
  return mediaExtensions.test(pathname) || 
         mediaPaths.some(path => pathname.includes(path)) ||
         url.hostname.includes('storage') ||
         url.hostname.includes('cdn');
}

// Fetch event - smart caching strategy optimized for PWA
globalThis.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests - let them go directly to network
  if (request.method !== 'GET') {
    return;
  }

  // Handle Supabase API requests - Network-first with cache fallback
  // This gives fresh data while providing offline support
  if (isSupabaseRequest(url)) {
    event.respondWith(networkFirstSupabase(request));
    return;
  }

  // Skip other cross-origin requests (except media CDNs we want to cache)
  if (url.origin !== globalThis.location.origin && !isMediaRequest(request)) {
    return;
  }

  // Media requests (images, files, avatars) - Stale-While-Revalidate
  // Shows cached content immediately while updating in background
  if (isMediaRequest(request)) {
    event.respondWith(staleWhileRevalidate(request, MEDIA_CACHE, MEDIA_TIMEOUT));
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
    globalThis.registration.showNotification(title, options)
  );
});

// Notification click event
globalThis.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          // Focus existing window if available
          for (const client of clientList) {
            if (client.url.includes(globalThis.location.origin) && 'focus' in client) {
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
globalThis.addEventListener('sync', (event) => {
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

// Message handlers
const handleSkipWaiting = () => globalThis.skipWaiting();

const handleClearCache = (event) => {
  console.log('[SW] Clearing ALL caches (force reload requested)');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          console.log('[SW] Deleting cache:', cacheName);
          return caches.delete(cacheName);
        })
      );
    }).then(() => {
      console.log('[SW] All caches cleared');
    })
  );
};

const handleAppResumed = () => {
  console.log('[SW] App resumed from background, clearing dynamic cache');
  // Clear dynamic cache to force fresh data
  caches.open(DYNAMIC_CACHE).then((cache) => {
    cache.keys().then((keys) => {
      keys.forEach((key) => cache.delete(key));
    });
  });
  // Also clear Supabase cache to get fresh data
  caches.open(SUPABASE_CACHE).then((cache) => {
    cache.keys().then((keys) => {
      keys.forEach((key) => cache.delete(key));
    });
  });
  bypassCache = true;
  // Reset bypass flag after 5 seconds
  setTimeout(() => {
    bypassCache = false;
  }, 5000);
};

const handleKeepAlive = () => {
  lastActiveTime = Date.now();
};

const handleForceReload = (event) => {
  console.log('[SW] Force reload requested - clearing all caches');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName))
      );
    }).then(() => {
      console.log('[SW] All caches cleared for force reload');
      // Notify all clients to reload
      return globalThis.clients.matchAll();
    }).then((clients) => {
      clients.forEach((client) => {
        client.postMessage({ type: 'RELOAD_NOW' });
      });
    })
  );
};

const handleHealthCheck = (event) => {
  // Respond immediately to confirm SW is alive
  if (event.ports && event.ports[0]) {
    event.ports[0].postMessage({ status: 'alive', timestamp: Date.now() });
  }
};

const handleCacheUrl = (event) => {
  const url = event.data.url;
  if (url) {
    console.log('[SW] Caching URL on demand:', url);
    event.waitUntil(
      fetch(url).then((response) => {
        if (response.ok) {
          const cacheName = isSupabaseRequest(new URL(url)) ? SUPABASE_CACHE : 
                            isMediaRequest(new Request(url)) ? MEDIA_CACHE : DYNAMIC_CACHE;
          return caches.open(cacheName).then((cache) => {
            return cache.put(url, response);
          });
        }
      }).catch((err) => {
        console.error('[SW] Failed to cache URL:', err);
      })
    );
  }
};

// Message event - for communication with the app
globalThis.addEventListener('message', (event) => {
  if (!event.data || !event.data.type) return;

  switch (event.data.type) {
    case 'SKIP_WAITING':
      handleSkipWaiting();
      break;
    case 'CLEAR_CACHE':
      handleClearCache(event);
      break;
    case 'APP_RESUMED':
      handleAppResumed();
      break;
    case 'KEEPALIVE':
      handleKeepAlive();
      break;
    case 'FORCE_RELOAD':
      handleForceReload(event);
      break;
    case 'HEALTH_CHECK':
      handleHealthCheck(event);
      break;
    case 'CACHE_URL':
      handleCacheUrl(event);
      break;
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

// Cleanup old cached data periodically (every hour)
setInterval(async () => {
  try {
    const cacheNames = await caches.keys();
    
    for (const cacheName of cacheNames) {
      if (cacheName === SUPABASE_CACHE) {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        
        for (const request of keys) {
          const response = await cache.match(request);
          if (isCacheExpired(response)) {
            await cache.delete(request);
          }
        }
      }
    }
    console.log('[SW] Periodic cache cleanup completed');
  } catch (error) {
    console.error('[SW] Cache cleanup error:', error);
  }
}, 60 * 60 * 1000); // Every hour

console.log('[SW] Service worker loaded - v7.0.0 (Optimized caching for offline + performance)');
