// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { RealtimeChannel } from '@supabase/supabase-js'

// Supabase URL for direct API calls
const SUPABASE_URL = 'https://imkfbalgviqeotpjogff.supabase.co'

interface PresenceState {
  isOnline: boolean
  lastSeen: string | null
}

interface UserPresence {
  [userId: string]: PresenceState
}

// Global presence channel - shared across all components
let globalPresenceChannel: RealtimeChannel | null = null
let globalPresenceState: UserPresence = {}
const presenceListeners: Set<(state: UserPresence) => void> = new Set()
let currentUserId: string | null = null
let heartbeatInterval: NodeJS.Timeout | null = null

// Update last_seen in database periodically
const updateLastSeen = async (userId: string) => {
  try {
    // TODO: Enable this when 'is_online' and 'last_seen' columns are added to profiles table
    // Currently disabled to prevent 400 Bad Request errors
    /*
    await supabase
      .from('profiles')
      .update({
        is_online: true,
        last_seen: new Date().toISOString()
      })
      .eq('id', userId)
    */
  } catch (error) {
    console.error('Error updating last_seen:', error)
  }
}

// Set user as offline in database
const setOffline = async (userId: string) => {
  try {
    // TODO: Enable this when 'is_online' and 'last_seen' columns are added to profiles table
    // Currently disabled to prevent 400 Bad Request errors
    /*
    await supabase
      .from('profiles')
      .update({
        is_online: false,
        last_seen: new Date().toISOString()
      })
      .eq('id', userId)
    */
  } catch (error) {
    console.error('Error setting offline:', error)
  }
}

// Initialize global presence tracking
export const initializePresence = (userId: string) => {
  if (currentUserId === userId && globalPresenceChannel) {
    return // Already initialized for this user
  }

  // Cleanup previous channel if exists
  if (globalPresenceChannel) {
    globalPresenceChannel.unsubscribe()
    globalPresenceChannel = null
  }

  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
  }

  currentUserId = userId

  // Create presence channel
  globalPresenceChannel = supabase.channel('online-users', {
    config: {
      presence: {
        key: userId,
      },
    },
  })

  globalPresenceChannel
    .on('presence', { event: 'sync' }, () => {
      const state = globalPresenceChannel?.presenceState() || {}
      
      // Convert presence state to our format
      const newPresenceState: UserPresence = {}
      
      Object.keys(state).forEach((key) => {
        const presences = state[key] as any[]
        if (presences && presences.length > 0) {
          newPresenceState[key] = {
            isOnline: true,
            lastSeen: new Date().toISOString(),
          }
        }
      })
      
      globalPresenceState = newPresenceState
      
      // Notify all listeners
      presenceListeners.forEach(listener => listener(globalPresenceState))
    })
    .on('presence', { event: 'join' }, ({ key, newPresences }) => {
      globalPresenceState[key] = {
        isOnline: true,
        lastSeen: new Date().toISOString(),
      }
      presenceListeners.forEach(listener => listener({ ...globalPresenceState }))
    })
    .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
      globalPresenceState[key] = {
        isOnline: false,
        lastSeen: new Date().toISOString(),
      }
      presenceListeners.forEach(listener => listener({ ...globalPresenceState }))
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Track this user's presence
        await globalPresenceChannel?.track({
          user_id: userId,
          online_at: new Date().toISOString(),
        })
        
        // Update database
        await updateLastSeen(userId)
        
        // Start heartbeat to keep presence alive and update last_seen
        heartbeatInterval = setInterval(() => {
          updateLastSeen(userId)
        }, 30000) // Every 30 seconds
      }
    })

  // Handle page visibility changes
  const handleVisibilityChange = () => {
    if (document.hidden) {
      // User switched tabs - still online but less active
      globalPresenceChannel?.track({
        user_id: userId,
        online_at: new Date().toISOString(),
        status: 'away',
      })
    } else {
      // User came back
      globalPresenceChannel?.track({
        user_id: userId,
        online_at: new Date().toISOString(),
        status: 'active',
      })
      updateLastSeen(userId)
    }
  }

  // Handle before unload - set offline
  const handleBeforeUnload = () => {
    // Use sendBeacon for reliable offline status update
    // Note: sendBeacon doesn't support auth headers, so we use a simple approach
    // The presence channel leaving will also trigger offline status
    setOffline(userId)
  }

  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('beforeunload', handleBeforeUnload)

  // Store cleanup functions
  ;(globalPresenceChannel as any)._cleanup = () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('beforeunload', handleBeforeUnload)
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval)
      heartbeatInterval = null
    }
    setOffline(userId)
  }
}

// Cleanup presence tracking
export const cleanupPresence = () => {
  if (globalPresenceChannel) {
    const cleanup = (globalPresenceChannel as any)._cleanup
    if (cleanup) cleanup()
    
    globalPresenceChannel.unsubscribe()
    globalPresenceChannel = null
  }
  
  currentUserId = null
  globalPresenceState = {}
}

// Hook to use presence in components
export function usePresence(userId?: string) {
  const [presenceState, setPresenceState] = useState<UserPresence>(globalPresenceState)
  const [userStatus, setUserStatus] = useState<PresenceState>({ isOnline: false, lastSeen: null })

  useEffect(() => {
    // Subscribe to presence updates
    const listener = (state: UserPresence) => {
      setPresenceState(state)
    }
    
    presenceListeners.add(listener)
    
    // Set initial state
    setPresenceState(globalPresenceState)
    
    return () => {
      presenceListeners.delete(listener)
    }
  }, [])

  // Get specific user's status
  useEffect(() => {
    if (userId) {
      const status = presenceState[userId]
      if (status) {
        setUserStatus(status)
      } else {
        // User not in presence state - fetch from database
        fetchUserStatus(userId)
      }
    }
  }, [userId, presenceState])

  // Fetch user status from database if not in presence
  const fetchUserStatus = async (uid: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('is_online, last_seen')
        .eq('id', uid)
        .maybeSingle()

      if (!error && data) {
        setUserStatus({
          isOnline: data.is_online || false,
          lastSeen: data.last_seen,
        })
      }
    } catch (error) {
      console.error('Error fetching user status:', error)
    }
  }

  // Format last seen time like WhatsApp
  const formatLastSeen = useCallback((lastSeen: string | null): string => {
    if (!lastSeen) return ''
    
    const lastSeenDate = new Date(lastSeen)
    const now = new Date()
    const diffMs = now.getTime() - lastSeenDate.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) {
      return 'à l\'instant'
    } else if (diffMins < 60) {
      return `il y a ${diffMins} min`
    } else if (diffHours < 24) {
      return `il y a ${diffHours}h`
    } else if (diffDays === 1) {
      return `hier à ${lastSeenDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
    } else if (diffDays < 7) {
      const dayName = lastSeenDate.toLocaleDateString('fr-FR', { weekday: 'long' })
      return `${dayName} à ${lastSeenDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
    } else {
      return lastSeenDate.toLocaleDateString('fr-FR', { 
        day: 'numeric', 
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      })
    }
  }, [])

  // Get status text like WhatsApp
  const getStatusText = useCallback((): string => {
    if (userStatus.isOnline) {
      return 'en ligne'
    } else if (userStatus.lastSeen) {
      return `vu ${formatLastSeen(userStatus.lastSeen)}`
    }
    return ''
  }, [userStatus, formatLastSeen])

  return {
    presenceState,
    userStatus,
    isOnline: userStatus.isOnline,
    lastSeen: userStatus.lastSeen,
    getStatusText,
    formatLastSeen,
  }
}

// Hook to track a specific user's presence
export function useUserPresence(userId: string | undefined) {
  const { userStatus, isOnline, lastSeen, getStatusText } = usePresence(userId)
  
  // Also subscribe to profile changes for this user
  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel(`user-presence-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          // Profile updated - presence might have changed
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId])

  return {
    isOnline,
    lastSeen,
    statusText: getStatusText(),
  }
}