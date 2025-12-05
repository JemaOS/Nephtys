// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useRef, useCallback } from 'react'
import { supabase, updateLastSuccessfulQuery, isConnectionStale, forceReconnectRealtime } from '@/lib/supabase'
import { initializePresence, cleanupPresence } from '@/hooks/usePresence'

// Configuration for reconnection - OPTIMIZED FOR PWA v6 (FORCE RELOAD STRATEGY)
const RECONNECT_DELAY_PWA = 0 // No delay for PWA - reconnect immediately
const RECONNECT_DELAY_BROWSER = 300 // Reduced delay for regular browser
const BACKGROUND_THRESHOLD_PWA = 1000 // 1 second for PWA - reconnect VERY fast
const BACKGROUND_THRESHOLD_BROWSER = 15000 // 15 seconds for regular browser (reduced)
const SESSION_CHECK_INTERVAL = 60000 // Check session every 60 seconds when visible
const KEEPALIVE_INTERVAL = 30000 // Send keepalive to SW every 30 seconds
const RECONNECT_DEBOUNCE = 2000 // Minimum time between reconnections (2 seconds)
const RECONNECT_TIMEOUT = 10000 // Maximum time for a reconnection attempt (10 seconds)
const ACTIVITY_CHECK_INTERVAL = 45000 // Check connection health every 45 seconds during active use
const STALE_CONNECTION_THRESHOLD = 90000 // Consider connection stale after 90 seconds of no successful queries

// CRITICAL: Force page reload after this duration in background (Android PWA fix)
// This is the nuclear option - if the app was in background for more than 2 minutes,
// force a full page reload to ensure clean state
const FORCE_RELOAD_THRESHOLD_PWA = 120000 // 2 minutes for PWA
const FORCE_RELOAD_THRESHOLD_BROWSER = 300000 // 5 minutes for browser

// Track if we've already scheduled a reload to prevent multiple reloads
let reloadScheduled = false

/**
 * Hook to handle Supabase reconnection when PWA comes back from background
 * This is especially important for Android PWAs where the system may kill
 * WebSocket connections after the app has been in background for a while
 * 
 * OPTIMIZED: Reconnects immediately on PWA to avoid slow loading
 */
export function useSupabaseReconnect(userId: string | null) {
  const lastVisibleTime = useRef<number>(Date.now())
  const lastBackgroundTime = useRef<number | null>(null)
  const lastReconnectTime = useRef<number>(0) // Track last reconnection time for debouncing
  const lastActivityTime = useRef<number>(Date.now()) // Track last user activity
  const lastHealthCheckTime = useRef<number>(Date.now()) // Track last health check
  const reconnectAttempts = useRef<number>(0)
  const sessionCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const keepaliveInterval = useRef<NodeJS.Timeout | null>(null)
  const activityCheckInterval = useRef<NodeJS.Timeout | null>(null) // Activity-based health check
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null) // Safety timeout
  const isReconnecting = useRef<boolean>(false)
  const isPWARef = useRef<boolean>(false)

  // Check if we're in a PWA context - cache the result
  const checkIsPWA = useCallback(() => {
    const result = window.matchMedia('(display-mode: standalone)').matches ||
           window.matchMedia('(display-mode: fullscreen)').matches ||
           (window.navigator as any).standalone === true
    isPWARef.current = result
    return result
  }, [])

  // Send message to Service Worker
  const sendToServiceWorker = useCallback((type: string, data?: any) => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type, ...data })
      console.log(`[Reconnect] Sent ${type} to Service Worker`)
    }
  }, [])

  // Reset reconnecting state (safety function)
  const resetReconnectingState = useCallback(() => {
    isReconnecting.current = false
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
  }, [])

  // Force refresh the Supabase session - ULTRA FAST version with debounce
  const refreshSession = useCallback(async () => {
    const now = Date.now()
    
    // Debounce: Skip if we just reconnected
    if (now - lastReconnectTime.current < RECONNECT_DEBOUNCE) {
      console.log('[Reconnect] Debounced - too soon since last reconnect')
      return true // Return true to not block the app
    }
    
    if (isReconnecting.current) {
      console.log('[Reconnect] Already reconnecting, skipping...')
      return true // Return true to not block the app
    }

    isReconnecting.current = true
    lastReconnectTime.current = now
    console.log('[Reconnect] Refreshing Supabase session (fast)...')

    // Set a safety timeout to reset the flag if something hangs
    reconnectTimeoutRef.current = setTimeout(() => {
      console.warn('[Reconnect] Safety timeout - resetting reconnecting state')
      resetReconnectingState()
    }, RECONNECT_TIMEOUT)

    try {
      // Use Promise.race with a SHORT timeout to avoid hanging
      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Session refresh timeout')), 3000) // Reduced to 3s
      )
      
      const refreshPromise = supabase.auth.refreshSession()
      
      const result = await Promise.race([refreshPromise, timeoutPromise]) as any
      
      if (result?.error) {
        console.error('[Reconnect] Session refresh error:', result.error)
        // Try to get current session as fallback - but don't wait long
        try {
          const sessionPromise = supabase.auth.getSession()
          const sessionTimeout = new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error('Get session timeout')), 2000)
          )
          const sessionResult = await Promise.race([sessionPromise, sessionTimeout]) as any
          if (!sessionResult?.data?.session) {
            console.warn('[Reconnect] No valid session found')
            resetReconnectingState()
            return false
          }
        } catch (e) {
          console.warn('[Reconnect] Session check timed out, continuing anyway')
        }
      }

      console.log('[Reconnect] Session refreshed successfully')
      reconnectAttempts.current = 0
      resetReconnectingState()
      return true
    } catch (error) {
      console.error('[Reconnect] Error refreshing session:', error)
      reconnectAttempts.current++
      resetReconnectingState()
      // Return true anyway to allow the app to try loading data
      // The data fetch will fail if there's really no session
      return true
    }
  }, [resetReconnectingState])

  // Reconnect all Supabase realtime channels - FAST version (fire and forget)
  const reconnectRealtime = useCallback(() => {
    console.log('[Reconnect] Reconnecting realtime channels (async)...')

    // Do this asynchronously - don't block
    setTimeout(async () => {
      try {
        // Get all active channels
        const channels = supabase.getChannels()
        
        // Reconnect channels in parallel (faster)
        const reconnectPromises = channels.map(async (channel) => {
          const channelName = channel.topic
          try {
            await channel.unsubscribe()
            channel.subscribe((status) => {
              if (status === 'SUBSCRIBED') {
                console.log(`[Reconnect] Channel ${channelName} reconnected`)
              }
            })
          } catch (e) {
            console.error(`[Reconnect] Error reconnecting channel ${channelName}:`, e)
          }
        })

        await Promise.all(reconnectPromises)

        // Re-initialize presence if we have a user (do this in background)
        if (userId) {
          console.log('[Reconnect] Re-initializing presence...')
          cleanupPresence()
          setTimeout(() => initializePresence(userId), 200)
        }

        console.log('[Reconnect] Realtime reconnection complete')
      } catch (error) {
        console.error('[Reconnect] Error reconnecting realtime:', error)
      }
    }, 0)
  }, [userId])

  // Full reconnection procedure - ULTRA OPTIMIZED for speed with debounce
  const performReconnect = useCallback(async () => {
    const now = Date.now()
    
    // Debounce: Skip if we just reconnected (prevents multiple pull-to-refresh)
    if (now - lastReconnectTime.current < RECONNECT_DEBOUNCE) {
      console.log('[Reconnect] Debounced reconnect - too soon since last attempt')
      return true
    }
    
    console.log('[Reconnect] Starting ULTRA FAST reconnection procedure...')
    lastReconnectTime.current = now
    
    // Step 0: Notify Service Worker to clear dynamic cache
    sendToServiceWorker('APP_RESUMED')
    
    // Step 1: Trigger event IMMEDIATELY so components can start loading
    // This allows the UI to show loading states while we reconnect
    // Components should start fetching data NOW, not wait for session refresh
    window.dispatchEvent(new CustomEvent('supabase-reconnected', {
      detail: { timestamp: Date.now(), immediate: true }
    }))
    
    // Step 2: Refresh session in PARALLEL (don't block)
    // The session is likely still valid, so components can start loading
    refreshSession().then((ok) => {
      if (!ok) {
        console.warn('[Reconnect] Session refresh failed in background')
      }
    })

    // Step 3: Reconnect realtime channels in background (non-blocking)
    reconnectRealtime()

    console.log('[Reconnect] Ultra fast reconnection triggered')
    return true
  }, [refreshSession, reconnectRealtime, sendToServiceWorker])

  // Force page reload - nuclear option for stuck PWA
  const forcePageReload = useCallback(() => {
    if (reloadScheduled) {
      console.log('[Reconnect] Reload already scheduled, skipping')
      return
    }
    
    reloadScheduled = true
    console.log('[Reconnect] FORCING PAGE RELOAD - nuclear option for stuck PWA')
    
    // Clear all caches before reload
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => {
          if (name.includes('dynamic') || name.includes('nephtys-dynamic')) {
            caches.delete(name)
          }
        })
      })
    }
    
    // Notify service worker to clear cache
    sendToServiceWorker('CLEAR_CACHE')
    
    // Small delay to let cache clearing complete
    setTimeout(() => {
      // Use location.reload(true) for hard reload (bypass cache)
      // Note: The 'true' parameter is deprecated but still works in most browsers
      window.location.reload()
    }, 100)
  }, [sendToServiceWorker])

  // Test connection health with a simple query
  const testConnectionHealth = useCallback(async (): Promise<boolean> => {
    try {
      // Use Promise.race with timeout since Supabase doesn't support AbortController directly
      const timeoutPromise = new Promise<{ error: { message: string } }>((_, reject) =>
        setTimeout(() => reject(new Error('Connection test timeout')), 5000)
      )
      
      // Simple query to test connection - just check if we can reach the database
      const queryPromise = supabase
        .from('profiles')
        .select('id')
        .limit(1)
      
      const result = await Promise.race([queryPromise, timeoutPromise])
      
      // Check if we got a valid response (even empty is OK)
      if (result && 'error' in result && result.error) {
        const errorObj = result.error as any
        // Some errors are OK (like no rows found)
        if (errorObj.code === 'PGRST116') {
          console.log('[Reconnect] Connection health check passed (no rows)')
          return true
        }
        console.log('[Reconnect] Connection health check failed:', errorObj.message || 'Unknown error')
        return false
      }
      
      console.log('[Reconnect] Connection health check passed')
      return true
    } catch (e) {
      console.log('[Reconnect] Connection health check error:', e)
      return false
    }
  }, [])

  // Handle visibility change - ULTRA OPTIMIZED for PWA with FORCE RELOAD fallback
  const handleVisibilityChange = useCallback(async () => {
    const now = Date.now()
    const isPWA = checkIsPWA()

    if (document.hidden) {
      // App going to background
      lastBackgroundTime.current = now
      console.log('[Reconnect] App going to background')
      
      // Clear session check interval when in background
      if (sessionCheckInterval.current) {
        clearInterval(sessionCheckInterval.current)
        sessionCheckInterval.current = null
      }
    } else {
      // App coming to foreground - RECONNECT IMMEDIATELY
      const backgroundDuration = lastBackgroundTime.current
        ? now - lastBackgroundTime.current
        : 0
      
      console.log(`[Reconnect] App coming to foreground after ${Math.round(backgroundDuration / 1000)}s (PWA: ${isPWA})`)
      lastVisibleTime.current = now

      // Determine force reload threshold based on context
      const forceReloadThreshold = isPWA ? FORCE_RELOAD_THRESHOLD_PWA : FORCE_RELOAD_THRESHOLD_BROWSER

      // NUCLEAR OPTION: If we were in background for too long, force a full page reload
      // This is the most reliable way to recover from a stuck state on Android PWA
      if (backgroundDuration > forceReloadThreshold) {
        console.log(`[Reconnect] Background duration (${Math.round(backgroundDuration / 1000)}s) exceeded force reload threshold (${Math.round(forceReloadThreshold / 1000)}s)`)
        
        // First, try a quick connection test
        const isHealthy = await testConnectionHealth()
        
        if (!isHealthy) {
          console.log('[Reconnect] Connection unhealthy after long background, forcing page reload...')
          forcePageReload()
          return
        } else {
          console.log('[Reconnect] Connection still healthy, proceeding with normal reconnect')
        }
      }

      // Determine threshold based on context
      const threshold = isPWA ? BACKGROUND_THRESHOLD_PWA : BACKGROUND_THRESHOLD_BROWSER

      // If we were in background for more than threshold, reconnect IMMEDIATELY
      if (backgroundDuration > threshold) {
        console.log(`[Reconnect] Background duration (${backgroundDuration}ms) exceeded threshold (${threshold}ms), reconnecting IMMEDIATELY...`)
        
        // NO DELAY - reconnect immediately
        // For PWA, always do full reconnect
        // For browser, also do full reconnect if background was long enough
        const success = await performReconnect()
        
        // If reconnect failed and we're on PWA, try force reload
        if (!success && isPWA && backgroundDuration > 30000) {
          console.log('[Reconnect] Reconnect failed after 30s+ background on PWA, testing connection...')
          const isHealthy = await testConnectionHealth()
          if (!isHealthy) {
            console.log('[Reconnect] Connection test failed, forcing page reload...')
            forcePageReload()
            return
          }
        }
      } else if (isPWA && backgroundDuration > 500) {
        // For PWA, even short backgrounds should trigger a refresh event
        // This ensures data is always fresh
        console.log('[Reconnect] Short PWA background, dispatching refresh event')
        window.dispatchEvent(new CustomEvent('supabase-reconnected', {
          detail: { timestamp: Date.now(), quick: true }
        }))
      }

      // Restart session check interval
      if (userId && !sessionCheckInterval.current) {
        sessionCheckInterval.current = setInterval(async () => {
          if (!document.hidden) {
            console.log('[Reconnect] Periodic session check...')
            await refreshSession()
          }
        }, SESSION_CHECK_INTERVAL)
      }
    }
  }, [checkIsPWA, performReconnect, refreshSession, userId, forcePageReload, testConnectionHealth])

  // Handle online/offline events - FASTER
  const handleOnline = useCallback(async () => {
    console.log('[Reconnect] Network came online')
    
    // For PWA, reconnect immediately
    if (isPWARef.current) {
      await performReconnect()
    } else {
      // Wait a bit for network to stabilize on regular browser
      await new Promise(resolve => setTimeout(resolve, 1000))
      await performReconnect()
    }
  }, [performReconnect])

  // Handle page show event (for bfcache restoration)
  const handlePageShow = useCallback(async (event: PageTransitionEvent) => {
    if (event.persisted) {
      console.log('[Reconnect] Page restored from bfcache')
      await performReconnect()
    }
  }, [performReconnect])

  // Handle focus event (additional trigger for PWAs) - MORE AGGRESSIVE
  const handleFocus = useCallback(async () => {
    const now = Date.now()
    const timeSinceLastVisible = now - lastVisibleTime.current
    const isPWA = isPWARef.current

    // For PWA, be more aggressive about reconnecting
    const threshold = isPWA ? BACKGROUND_THRESHOLD_PWA : BACKGROUND_THRESHOLD_BROWSER

    if (timeSinceLastVisible > threshold) {
      console.log(`[Reconnect] Focus event after ${Math.round(timeSinceLastVisible / 1000)}s, reconnecting...`)
      await performReconnect()
    }
  }, [performReconnect])

  // Track user activity (touch, click, scroll)
  const handleUserActivity = useCallback(() => {
    lastActivityTime.current = Date.now()
  }, [])

  // Activity-based health check - runs periodically when user is active
  const performActivityHealthCheck = useCallback(async () => {
    // Only check if document is visible and user was recently active
    if (document.hidden) return
    
    const now = Date.now()
    const timeSinceActivity = now - lastActivityTime.current
    const timeSinceHealthCheck = now - lastHealthCheckTime.current
    
    // Only check if user was active in the last 2 minutes AND we haven't checked recently
    if (timeSinceActivity > 120000 || timeSinceHealthCheck < ACTIVITY_CHECK_INTERVAL) {
      return
    }
    
    // Check if connection seems stale (no successful query in a while)
    if (isConnectionStale()) {
      console.log('[Reconnect] Connection seems stale during active use, testing health...')
      lastHealthCheckTime.current = now
      
      const isHealthy = await testConnectionHealth()
      
      if (!isHealthy) {
        console.log('[Reconnect] Connection unhealthy during active use, reconnecting...')
        await performReconnect()
        
        // If still unhealthy after reconnect on PWA, force reload
        if (isPWARef.current) {
          const stillHealthy = await testConnectionHealth()
          if (!stillHealthy) {
            console.log('[Reconnect] Still unhealthy after reconnect on PWA, forcing reload...')
            forcePageReload()
          }
        }
      } else {
        console.log('[Reconnect] Connection healthy during active use')
      }
    }
  }, [testConnectionHealth, performReconnect, forcePageReload])

  // Setup event listeners
  useEffect(() => {
    if (!userId) return

    // Check PWA status on mount
    checkIsPWA()
    console.log(`[Reconnect] Setting up reconnection handlers (PWA: ${isPWARef.current})`)

    // Visibility change is the primary trigger
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    // Online event for network recovery
    window.addEventListener('online', handleOnline)
    
    // Page show for bfcache
    window.addEventListener('pageshow', handlePageShow)
    
    // Focus as additional trigger for PWAs
    window.addEventListener('focus', handleFocus)
    
    // Track user activity for health checks
    document.addEventListener('touchstart', handleUserActivity, { passive: true })
    document.addEventListener('click', handleUserActivity, { passive: true })
    document.addEventListener('scroll', handleUserActivity, { passive: true })

    // Start periodic session check
    sessionCheckInterval.current = setInterval(async () => {
      if (!document.hidden) {
        console.log('[Reconnect] Periodic session check...')
        await refreshSession()
      }
    }, SESSION_CHECK_INTERVAL)

    // Start keepalive interval for Service Worker
    keepaliveInterval.current = setInterval(() => {
      sendToServiceWorker('KEEPALIVE')
    }, KEEPALIVE_INTERVAL)
    
    // Start activity-based health check (more aggressive for PWA)
    activityCheckInterval.current = setInterval(() => {
      performActivityHealthCheck()
    }, ACTIVITY_CHECK_INTERVAL)
    
    // Send initial keepalive
    sendToServiceWorker('KEEPALIVE')

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('touchstart', handleUserActivity)
      document.removeEventListener('click', handleUserActivity)
      document.removeEventListener('scroll', handleUserActivity)
      
      if (sessionCheckInterval.current) {
        clearInterval(sessionCheckInterval.current)
        sessionCheckInterval.current = null
      }
      
      if (keepaliveInterval.current) {
        clearInterval(keepaliveInterval.current)
        keepaliveInterval.current = null
      }
      
      if (activityCheckInterval.current) {
        clearInterval(activityCheckInterval.current)
        activityCheckInterval.current = null
      }
    }
  }, [userId, handleVisibilityChange, handleOnline, handlePageShow, handleFocus, handleUserActivity, performActivityHealthCheck, refreshSession, checkIsPWA, sendToServiceWorker])

  // Return a manual reconnect function for components to use if needed
  return {
    reconnect: performReconnect,
    refreshSession,
    isPWA: isPWARef.current
  }
}

/**
 * Custom event listener hook for components that need to refresh data after reconnection
 */
export function useOnSupabaseReconnect(callback: () => void) {
  useEffect(() => {
    const handler = () => {
      console.log('[Reconnect] Received reconnect event, triggering callback...')
      callback()
    }

    window.addEventListener('supabase-reconnected', handler)
    return () => window.removeEventListener('supabase-reconnected', handler)
  }, [callback])
}