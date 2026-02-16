// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useRef, useCallback } from 'react';

// WHATSAPP-LEVEL STABILITY: Minimal keep-alive for PWA
// No aggressive reconnection, no force reload, minimal heartbeat

/**
 * Hook to keep the PWA alive on Android
 * WHATSAPP-STYLE: Minimal implementation, only Wake Lock
 */
export function useKeepAlive(
  onReconnectRequest: () => void,
  enabled: boolean = true
) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Request Wake Lock to prevent screen/app from sleeping
  const requestWakeLock = useCallback(async () => {
    const nav = navigator as any;
    
    if (!nav.wakeLock) {
      return;
    }

    try {
      // Release existing lock first
      if (wakeLockRef.current && !wakeLockRef.current.released) {
        await wakeLockRef.current.release();
      }

      wakeLockRef.current = await nav.wakeLock.request('screen');
    } catch (err: any) {
      // Wake Lock request can fail - silent fail for stability
    }
  }, []);

  // Release Wake Lock
  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current && !wakeLockRef.current.released) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      } catch (err) {
        // Silent fail
      }
    }
  }, []);

  // Handle visibility change - re-acquire Wake Lock when visible
  const handleVisibilityChange = useCallback(async () => {
    if (!document.hidden) {
      // Re-acquire Wake Lock when app becomes visible
      await requestWakeLock();
    }
  }, [requestWakeLock]);

  // Initialize Wake Lock only
  useEffect(() => {
    if (!enabled) return;

    // Check if we're in a PWA context
    const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                  window.matchMedia('(display-mode: fullscreen)').matches ||
                  (window.navigator as any).standalone === true;

    if (!isPWA) {
      return;
    }

    // Request Wake Lock
    requestWakeLock();

    // Add event listeners
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup
    return () => {
      // Release Wake Lock
      releaseWakeLock();

      // Remove event listeners
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, requestWakeLock, releaseWakeLock, handleVisibilityChange]);

  return {
    requestWakeLock,
    releaseWakeLock,
    markConnectionSuccess: () => {}, // No-op for compatibility
    forceReload: () => {}, // No-op - no force reload in WhatsApp-style
  };
}
