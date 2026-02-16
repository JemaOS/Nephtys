// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

// WHATSAPP-LEVEL STABILITY CONFIGURATION
// Minimal intervals for maximum stability
const VISIBILITY_RECONNECT_DELAY = 1000 // 1s debounce for visibility changes
const MAX_RECONNECT_ATTEMPTS = 3

// Track if we've already scheduled a reload to prevent multiple reloads
let reloadScheduled = false

/**
 * Hook to handle Supabase reconnection when PWA comes back from background
 * WHATSAPP-STYLE: Minimal reconnection logic, only when necessary
 */
export function useSupabaseReconnect(userId: string | null) {
  const lastReconnectTime = useRef<number>(0)
  const isReconnecting = useRef<boolean>(false)

  // Debounced reconnect - only reconnect if it's been a while
  const performReconnect = useCallback(async (): Promise<boolean> => {
    const now = Date.now()
    
    // Debounce: Skip if we just reconnected
    if (now - lastReconnectTime.current < VISIBILITY_RECONNECT_DELAY) {
      return true
    }
    
    if (isReconnecting.current) {
      return true
    }

    isReconnecting.current = true
    lastReconnectTime.current = now

    try {
      // Simple session check - no aggressive reconnection
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        isReconnecting.current = false
        return false
      }

      // Dispatch event for components to refresh if needed
      window.dispatchEvent(new CustomEvent('supabase-reconnected', {
        detail: { timestamp: Date.now() }
      }))

      isReconnecting.current = false
      return true
    } catch {
      isReconnecting.current = false
      return true // Return true to not block the app
    }
  }, [])

  // Handle visibility change - WHATSAPP STYLE
  // Only reconnect after significant background time
  const handleVisibilityChange = useCallback(async () => {
    if (document.hidden) {
      return
    }

    // App coming to foreground - check if we need to reconnect
    await performReconnect()
  }, [performReconnect])

  // Handle online event
  const handleOnline = useCallback(async () => {
    await performReconnect()
  }, [performReconnect])

  // Setup minimal event listeners
  useEffect(() => {
    if (!userId) return

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('online', handleOnline)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('online', handleOnline)
    }
  }, [userId, handleVisibilityChange, handleOnline])

  // Return a manual reconnect function for components to use if needed
  return {
    reconnect: performReconnect
  }
}

/**
 * Custom event listener hook for components that need to refresh data after reconnection
 */
export function useOnSupabaseReconnect(callback: () => void) {
  useEffect(() => {
    const handler = () => {
      callback()
    }

    window.addEventListener('supabase-reconnected', handler)
    return () => window.removeEventListener('supabase-reconnected', handler)
  }, [callback])
}
