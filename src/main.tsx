// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import './critical.css'
import './index.css'
import App from './App.tsx'

// Build identifier baked at compile time. If the SW served a stale HTML
// referencing an old build, this constant won't match what the SW registers
// for, and we trigger a one-shot self-heal: unregister the SW, purge caches,
// hard-reload.
const APP_BUILD_ID = '2026-05-26-thumb-fix-v7';
const BUILD_ID_KEY = 'nephtys_app_build_id';

const selfHealStaleClient = async () => {
  if (typeof window === 'undefined') return;
  const previous = localStorage.getItem(BUILD_ID_KEY);
  if (previous === APP_BUILD_ID) return;
  // First boot OR build change: store new build, force one cache+SW purge.
  localStorage.setItem(BUILD_ID_KEY, APP_BUILD_ID);
  if (!previous) return; // first ever visit, nothing to clean
  console.log('[App] New build detected, purging old SW + caches...', { previous, current: APP_BUILD_ID });
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(k => !k.startsWith('nephtys-media'))
          .map(k => caches.delete(k))
      );
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (e) {
    console.warn('[App] Self-heal cleanup failed:', e);
  }
  // Force a hard reload to pick up the latest HTML + chunks
  window.location.reload();
};

// Register service worker for PWA support
const registerServiceWorker = async () => {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none'
      });

      console.log('[App] Service Worker registered:', registration.scope, 'build', APP_BUILD_ID);

      // Always check for an updated SW on startup
      registration.update().catch(() => {});

      // Periodic update check
      setInterval(() => {
        registration.update().catch(() => {});
      }, 60 * 60 * 1000);

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[App] New SW version available, will activate on next load');
            }
          });
        }
      });
    } catch (error) {
      console.error('[App] Service Worker registration failed:', error);
    }
  }
};

// Self-heal first (may force a reload), then register the SW.
selfHealStaleClient().then(() => registerServiceWorker());

// Render the app immediately
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}
createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
