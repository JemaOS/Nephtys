import { useEffect, useRef, useCallback } from 'react';

// Use any for Wake Lock to avoid type conflicts with native types
// The Wake Lock API is still experimental and types vary across browsers

/**
 * Hook to keep the PWA alive on Android
 * Uses a Web Worker for heartbeat + Wake Lock API to prevent system throttling
 */
export function useKeepAlive(
  onReconnectRequest: () => void,
  enabled: boolean = true
) {
  const workerRef = useRef<Worker | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const isActiveRef = useRef(true);

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

    // Create worker
    try {
      // Use inline worker to avoid bundling issues
      const workerCode = `
        let heartbeatInterval = null;
        let lastPingTime = Date.now();
        let isActive = true;
        const HEARTBEAT_INTERVAL = 10000;
        const STALE_THRESHOLD = 30000;

        function postToMain(type, data) {
          self.postMessage({ type, ...data });
        }

        function startHeartbeat() {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
          heartbeatInterval = setInterval(() => {
            const now = Date.now();
            const timeSinceLastPing = now - lastPingTime;
            postToMain('HEARTBEAT', { timestamp: now });
            if (timeSinceLastPing > STALE_THRESHOLD) {
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
            // Only reconnect if document is visible
            if (!document.hidden) {
              onReconnectRequest();
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

        // Remove event listeners
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    } catch (error) {
      console.error('[KeepAlive] Error initializing worker:', error);
    }
  }, [enabled, onReconnectRequest, requestWakeLock, releaseWakeLock, handleVisibilityChange, handleOnline, handleOffline]);

  return {
    requestWakeLock,
    releaseWakeLock,
  };
}