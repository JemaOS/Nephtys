// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useRef, useCallback } from 'react';

// Use any for Wake Lock to avoid type conflicts with native types
// The Wake Lock API is still experimental and types vary across browsers

// Configuration for auto-reload (last resort for stuck PWA)
const MAX_RECONNECT_ATTEMPTS = 3; // After 3 failed reconnects, reload the page
const FORCE_RELOAD_THRESHOLD = 60000; // 60 seconds without successful connection = force reload

/**
 * Hook to keep the PWA alive on Android
 * Uses a Web Worker for heartbeat + Wake Lock API to prevent system throttling
 * Includes auto-reload as last resort for completely stuck connections
 */
export function useKeepAlive(
  onReconnectRequest: () => void,
  enabled: boolean = true
) {
  const workerRef = useRef<Worker | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const isActiveRef = useRef(true);
  const reconnectAttemptsRef = useRef(0);
  const lastSuccessfulConnectionRef = useRef(Date.now());
  const forceReloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Request Wake Lock to prevent screen/app from sleeping
  const requestWakeLock = useCallback(async () => {
    const nav = navigator as any;
    
    if (!nav.wakeLock) {
      console.log('[KeepAlive] Wake Lock API not supported');
      return;
    }

    try {
      // Release existing lock first
      if (wakeLockRef.current && !wakeLockRef.current.released) {
        await wakeLockRef.current.release();
      }

      wakeLockRef.current = await nav.wakeLock.request('screen');
      console.log('[KeepAlive] Wake Lock acquired');

      (wakeLockRef.current as any).addEventListener('release', () => {
        console.log('[KeepAlive] Wake Lock released');
      });
    } catch (err: any) {
      // Wake Lock request can fail if:
      // - Document is not visible
      // - Low battery mode is active
      // - System policy prevents it
      console.log('[KeepAlive] Wake Lock request failed:', err.message);
    }
  }, []);

  // Release Wake Lock
  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current && !wakeLockRef.current.released) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('[KeepAlive] Wake Lock released manually');
      } catch (err) {
        console.error('[KeepAlive] Error releasing Wake Lock:', err);
      }
    }
  }, []);

  // Handle visibility change - re-acquire Wake Lock when visible
  const handleVisibilityChange = useCallback(async () => {
    if (document.hidden) {
      isActiveRef.current = false;
      // Notify worker
      workerRef.current?.postMessage({ type: 'VISIBILITY_CHANGE', visible: false });
    } else {
      isActiveRef.current = true;
      // Re-acquire Wake Lock
      await requestWakeLock();
      // Notify worker
      workerRef.current?.postMessage({ type: 'VISIBILITY_CHANGE', visible: true });
    }
  }, [requestWakeLock]);

  // Handle network change
  const handleOnline = useCallback(() => {
    workerRef.current?.postMessage({ type: 'NETWORK_CHANGE', online: true });
  }, []);

  const handleOffline = useCallback(() => {
    workerRef.current?.postMessage({ type: 'NETWORK_CHANGE', online: false });
  }, []);

  // Force reload the page (last resort)
  const forceReload = useCallback(() => {
    console.log('[KeepAlive] FORCE RELOADING PAGE - connection stuck');
    // Clear any stored state that might be causing issues
    sessionStorage.setItem('pwa-force-reload', Date.now().toString());
    // Force a hard reload
    window.location.reload();
  }, []);

  // Mark connection as successful (call this from outside when data loads)
  const markConnectionSuccess = useCallback(() => {
    lastSuccessfulConnectionRef.current = Date.now();
    reconnectAttemptsRef.current = 0;
    // Clear any pending force reload
    if (forceReloadTimeoutRef.current) {
      clearTimeout(forceReloadTimeoutRef.current);
      forceReloadTimeoutRef.current = null;
    }
  }, []);

  // Check if we should force reload
  const checkForceReload = useCallback(() => {
    const timeSinceSuccess = Date.now() - lastSuccessfulConnectionRef.current;
    
    // If it's been too long since successful connection and document is visible
    if (timeSinceSuccess > FORCE_RELOAD_THRESHOLD && !document.hidden) {
      console.log(`[KeepAlive] No successful connection for ${Math.round(timeSinceSuccess / 1000)}s`);
      
      // Check if we've already tried reloading recently
      const lastReload = sessionStorage.getItem('pwa-force-reload');
      const timeSinceLastReload = lastReload ? Date.now() - parseInt(lastReload) : Infinity;
      
      // Only reload if we haven't reloaded in the last 2 minutes
      if (timeSinceLastReload > 120000) {
        forceReload();
      } else {
        console.log('[KeepAlive] Already reloaded recently, skipping force reload');
      }
    }
  }, [forceReload]);

  // Initialize worker and Wake Lock
  useEffect(() => {
    if (!enabled) return;

    // Check if we're in a PWA context
    const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                  window.matchMedia('(display-mode: fullscreen)').matches ||
                  (window.navigator as any).standalone === true;

    if (!isPWA) {
      console.log('[KeepAlive] Not in PWA mode, skipping keep-alive setup');
      return;
    }

    console.log('[KeepAlive] Initializing keep-alive system for PWA...');
    
    // Reset connection tracking
    lastSuccessfulConnectionRef.current = Date.now();
    reconnectAttemptsRef.current = 0;

    // Create worker
    try {
      // Use inline worker to avoid bundling issues
      const workerCode = `
        let heartbeatInterval = null;
        let lastPingTime = Date.now();
        let isActive = true;
        const HEARTBEAT_INTERVAL = 10000;
        const STALE_THRESHOLD = 30000;
        const CRITICAL_THRESHOLD = 60000;

        function postToMain(type, data) {
          self.postMessage({ type, ...data });
        }

        function startHeartbeat() {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          heartbeatInterval = setInterval(() => {
            const now = Date.now();
            const timeSinceLastPing = now - lastPingTime;
            postToMain('HEARTBEAT', { timestamp: now });
            if (timeSinceLastPing > CRITICAL_THRESHOLD) {
              postToMain('CONNECTION_CRITICAL', { elapsed: timeSinceLastPing });
            } else if (timeSinceLastPing > STALE_THRESHOLD) {
              postToMain('REQUEST_RECONNECT', { reason: 'stale', elapsed: timeSinceLastPing });
            }
          }, HEARTBEAT_INTERVAL);
        }

        function stopHeartbeat() {
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
        }

        self.onmessage = (event) => {
          const { type, ...data } = event.data;
          switch (type) {
            case 'START':
              isActive = true;
              lastPingTime = Date.now();
              startHeartbeat();
              postToMain('STARTED');
              break;
            case 'STOP':
              isActive = false;
              stopHeartbeat();
              postToMain('STOPPED');
              break;
            case 'PONG':
              lastPingTime = Date.now();
              break;
            case 'CONNECTION_SUCCESS':
              lastPingTime = Date.now();
              break;
            case 'VISIBILITY_CHANGE':
              if (data.visible) {
                lastPingTime = Date.now();
                if (isActive && !heartbeatInterval) startHeartbeat();
                postToMain('REQUEST_RECONNECT', { reason: 'visibility' });
              }
              break;
            case 'NETWORK_CHANGE':
              if (data.online) {
                lastPingTime = Date.now();
                postToMain('REQUEST_RECONNECT', { reason: 'network' });
              }
              break;
          }
        };
      `;

      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      workerRef.current = new Worker(workerUrl);

      // Handle messages from worker
      workerRef.current.onmessage = (event) => {
        const { type, ...data } = event.data;

        switch (type) {
          case 'STARTED':
            console.log('[KeepAlive] Worker started');
            break;

          case 'STOPPED':
            console.log('[KeepAlive] Worker stopped');
            break;

          case 'HEARTBEAT':
            // Respond to heartbeat
            workerRef.current?.postMessage({ type: 'PONG' });
            break;

          case 'REQUEST_RECONNECT':
            console.log('[KeepAlive] Reconnect requested:', data.reason);
            reconnectAttemptsRef.current++;
            
            // Only reconnect if document is visible
            if (!document.hidden) {
              onReconnectRequest();
              
              // If too many reconnect attempts, check if we should force reload
              if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
                console.log(`[KeepAlive] ${reconnectAttemptsRef.current} reconnect attempts, checking force reload...`);
                checkForceReload();
              }
            }
            break;
            
          case 'CONNECTION_CRITICAL':
            console.log('[KeepAlive] CONNECTION CRITICAL - no response for', data.elapsed, 'ms');
            // This is a critical situation - check if we should force reload
            if (!document.hidden) {
              checkForceReload();
            }
            break;
        }
      };

      // Start worker
      workerRef.current.postMessage({ type: 'START' });

      // Request Wake Lock
      requestWakeLock();

      // Add event listeners
      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      // Cleanup
      return () => {
        console.log('[KeepAlive] Cleaning up...');
        
        // Stop worker
        workerRef.current?.postMessage({ type: 'STOP' });
        workerRef.current?.terminate();
        workerRef.current = null;
        URL.revokeObjectURL(workerUrl);

        // Release Wake Lock
        releaseWakeLock();

        // Clear force reload timeout
        if (forceReloadTimeoutRef.current) {
          clearTimeout(forceReloadTimeoutRef.current);
          forceReloadTimeoutRef.current = null;
        }

        // Remove event listeners
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    } catch (error) {
      console.error('[KeepAlive] Error initializing worker:', error);
    }
  }, [enabled, onReconnectRequest, requestWakeLock, releaseWakeLock, handleVisibilityChange, handleOnline, handleOffline, checkForceReload]);

  return {
    requestWakeLock,
    releaseWakeLock,
    markConnectionSuccess,
    forceReload,
  };
}