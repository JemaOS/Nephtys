import { useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { initializePresence, cleanupPresence } from '@/hooks/usePresence'

// Configuration for reconnection - OPTIMIZED FOR PWA v2
const RECONNECT_DELAY_PWA = 0 // No delay for PWA - reconnect immediately
const RECONNECT_DELAY_BROWSER = 500 // Small delay for regular browser
const BACKGROUND_THRESHOLD_PWA = 3000 // 3 seconds for PWA - reconnect even faster
const BACKGROUND_THRESHOLD_BROWSER = 30000 // 30 seconds for regular browser
const SESSION_CHECK_INTERVAL = 30000 // Check session every 30 seconds when visible
const KEEPALIVE_INTERVAL = 20000 // Send keepalive to SW every 20 seconds

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
  const reconnectAttempts = useRef<number>(0)
  const sessionCheckInterval = useRef<NodeJS.Timeout | null>(null)
  const keepaliveInterval = useRef<NodeJS.Timeout | null>(null)
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

  // Force refresh the Supabase session - FAST version
  const refreshSession = useCallback(async () => {
    if (isReconnecting.current) {
      console.log('[Reconnect] Already reconnecting, skipping...')
      return false
    }

    isReconnecting.current = true
    console.log('[Reconnect] Refreshing Supabase session...')

    try {
      // Use Promise.race with a timeout to avoid hanging
      const timeoutPromise = new Promise<null>((_, reject) => 
        setTimeout(() => reject(new Error('Session refresh timeout')), 5000)
      )
      
      const refreshPromise = supabase.auth.refreshSession()
      
      const result = await Promise.race([refreshPromise, timeoutPromise]) as any
      
      if (result?.error) {
        console.error('[Reconnect] Session refresh error:', result.error)
        // Try to get current session as fallback
        const { data: { session: currentSession } } = await supabase.auth.getSession()
        if (!currentSession) {
          console.warn('[Reconnect] No valid session found')
          isReconnecting.current = false
          return false
        }
      }

      console.log('[Reconnect] Session refreshed successfully')
      reconnectAttempts.current = 0
      isReconnecting.current = false
      return true
    } catch (error) {
      console.error('[Reconnect] Error refreshing session:', error)
      reconnectAttempts.current++
      isReconnecting.current = false
      return false
    }
  }, [])

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

  // Full reconnection procedure - OPTIMIZED for speed
  const performReconnect = useCallback(async () => {
    console.log('[Reconnect] Starting fast reconnection procedure...')
    
    // Step 0: Notify Service Worker to clear dynamic cache
    sendToServiceWorker('APP_RESUMED')
    
    // Step 1: Trigger event IMMEDIATELY so components can start loading
    // This allows the UI to show loading states while we reconnect
    window.dispatchEvent(new CustomEvent('supabase-reconnected', {
      detail: { timestamp: Date.now() }
    }))
    
    // Step 2: Refresh session (with timeout)
    const sessionOk = await refreshSession()
    if (!sessionOk) {
      console.warn('[Reconnect] Session refresh failed, but event already dispatched')
      // Don't return false - the event was already dispatched
    }

    // Step 3: Reconnect realtime channels in background (non-blocking)
    reconnectRealtime()

    console.log('[Reconnect] Fast reconnection complete')
    return true
  }, [refreshSession, reconnectRealtime, sendToServiceWorker])

  // Handle visibility change - OPTIMIZED for PWA
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
      // App coming to foreground
      const backgroundDuration = lastBackgroundTime.current 
        ? now - lastBackgroundTime.current 
        : 0
      
      console.log(`[Reconnect] App coming to foreground after ${Math.round(backgroundDuration / 1000)}s (PWA: ${isPWA})`)
      lastVisibleTime.current = now

      // Determine threshold based on context
      const threshold = isPWA ? BACKGROUND_THRESHOLD_PWA : BACKGROUND_THRESHOLD_BROWSER
      const delay = isPWA ? RECONNECT_DELAY_PWA : RECONNECT_DELAY_BROWSER

      // If we were in background for more than threshold, reconnect
      if (backgroundDuration > threshold) {
        console.log(`[Reconnect] Background duration (${backgroundDuration}ms) exceeded threshold (${threshold}ms), reconnecting...`)
        
        // Add delay only for non-PWA
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay))
        }
        
        // Always perform full reconnect for PWA, or if very long background
        if (isPWA || backgroundDuration > 5 * 60 * 1000) {
          await performReconnect()
        } else {
          // For regular browser with shorter background, just refresh session
          await refreshSession()
          // Still dispatch event so components refresh
          window.dispatchEvent(new CustomEvent('supabase-reconnected', {
            detail: { timestamp: Date.now() }
          }))
        }
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
  }, [checkIsPWA, performReconnect, refreshSession, userId])

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
    
    // Send initial keepalive
    sendToServiceWorker('KEEPALIVE')

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener('focus', handleFocus)
      
      if (sessionCheckInterval.current) {
        clearInterval(sessionCheckInterval.current)
        sessionCheckInterval.current = null
      }
      
      if (keepaliveInterval.current) {
        clearInterval(keepaliveInterval.current)
        keepaliveInterval.current = null
      }
    }
  }, [userId, handleVisibilityChange, handleOnline, handlePageShow, handleFocus, refreshSession, checkIsPWA, sendToServiceWorker])

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