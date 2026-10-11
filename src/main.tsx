// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'
import { I18nProvider } from './i18n'
import './critical.css'
import './index.css'
import App from './App.tsx'
import { initPerfMetrics } from './lib/perfMetrics'
import { initIceServers } from './lib/iceServers'

// Build identifier baked at compile time. If the SW served a stale HTML
// referencing an old build, this constant won't match what the SW registers
// for, and we trigger a one-shot self-heal: unregister the SW, purge caches,
// hard-reload.
// ID de build = commit git (injecté au build). Change à CHAQUE déploiement →
// déclenche l'auto-nettoyage du Service Worker/caches. (Avant : constante
// figée '2026-05-26-thumb-fix-v7' → jamais mise à jour → utilisateurs bloqués
// sur un vieux build.)
const APP_BUILD_ID = __BUILD_COMMIT__;
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

// Anti-boucle : n'autorise qu'un seul rechargement automatique par courte
// fenêtre de temps. Le rechargement relance le bundle frais ; un second
// 'controllerchange' (ou une reprise du SW) ne doit pas provoquer de boucle.
const SW_RELOAD_KEY = 'nephtys_sw_reloaded_at';
const SW_RELOAD_MIN_INTERVAL_MS = 10 * 1000;
let swReloadInFlight = false;

const reloadOnceForNewWorker = () => {
  if (typeof window === 'undefined' || swReloadInFlight) return;
  swReloadInFlight = true;
  try {
    const last = Number(sessionStorage.getItem(SW_RELOAD_KEY) || 0);
    if (!Number.isNaN(last) && Date.now() - last < SW_RELOAD_MIN_INTERVAL_MS) {
      // Rechargement déjà déclenché très récemment → on s'abstient.
      return;
    }
    sessionStorage.setItem(SW_RELOAD_KEY, String(Date.now()));
  } catch {
    /* sessionStorage indisponible : le flag en mémoire suffit */
  }
  console.log('[App] New service worker took control — reloading once');
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

      // La page était-elle déjà contrôlée par un SW au moment de
      // l'enregistrement ? Si non (tout premier enregistrement), la prise de
      // contrôle ne doit PAS déclencher de rechargement (rien de périmé).
      const hadController = !!navigator.serviceWorker.controller;

      // Le SW appelle skipWaiting() à l'install et clients.claim() à l'activate :
      // il prend donc la main tout de suite. Quand cela arrive sur une page déjà
      // contrôlée, on recharge UNE seule fois pour servir le nouveau bundle.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) return;
        reloadOnceForNewWorker();
      });

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
              // Nouveau SW prêt et une page est déjà contrôlée : on force la
              // prise de main (idempotent, le SW le fait déjà), le
              // rechargement suit via 'controllerchange' ci-dessus.
              console.log('[App] New SW version available, activating now');
              newWorker.postMessage({ type: 'SKIP_WAITING' });
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

// Baseline performance (Web Vitals + long tasks + FPS) → window.__nephtysPerf
initPerfMetrics();

// Charge les identifiants TURN éphémères (appels) puis les rafraîchit.
initIceServers();

// Render the app immediately
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}
createRoot(rootElement).render(
  <StrictMode>
    <I18nProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </I18nProvider>
  </StrictMode>,
)
